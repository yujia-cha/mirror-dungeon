/**
 * Has this week's patch reached our sources? The gate the weekly routine runs before importing.
 *
 *   npm run data:upstream              one line: verdict and why
 *   npm run data:upstream -- --json    the full status, for the routine to branch on
 *
 * Read-only: `git ls-remote`, a commits-only fetch of the localize branches and the mirror's
 * `meta.json` from the raw host — the paths that work where the GitHub API is blocked. The decision
 * itself is `judgeUpstream` in `lib/upstream-status.ts`, which says what each verdict means.
 * Exit code is 0 whatever the verdict; 2 only when the facts could not be gathered at all.
 */
import { execFileSync } from 'node:child_process';
import { recentCommits, shaFromGit, tipOf } from './lib/git-remote.ts';
import { hasFlag, repoPath } from './lib/io.ts';
import { RAW, parseLock, readLock, type Lock } from './lib/lock.ts';
import {
  judgeUpstream,
  patchDayOf,
  LOCALIZE_LANGS,
  type LocalizeLang,
  type PinnedShas,
} from './lib/upstream-status.ts';

/** The per-language pins of a source, or none when it keeps languages as folders. */
function languagePins(lock: Lock, name: string): Record<string, { ref: string; sha: string }> {
  const languages = lock.sources[name]?.languages;
  return languages && !Array.isArray(languages) ? languages : {};
}

function pinnedFrom(lock: Lock): PinnedShas {
  const loc = languagePins(lock, 'localize');
  return {
    localize: { KR: loc['KR']?.sha ?? null, EN: loc['EN']?.sha ?? null },
    eldritchtools: lock.sources['eldritchtools']?.sha ?? null,
    openLethe: lock.sources['openLethe']?.sha ?? null,
  };
}

async function mirrorUpdatedAt(repo: string, sha: string): Promise<string | null> {
  try {
    const res = await fetch(`${RAW}/${repo}/${sha}/meta.json`);
    if (!res.ok) return null;
    const { datetime } = (await res.json()) as { datetime?: string };
    return datetime ? new Date(datetime).toISOString() : null;
  } catch {
    return null;
  }
}

/** The lock on this week's branch in our own repo, if that branch exists. */
function todayBranchLock(branch: string): PinnedShas | null {
  const cwd = repoPath();
  if (!tipOf('origin', branch, cwd)) return null;
  try {
    execFileSync('git', ['fetch', '-q', 'origin', `refs/heads/${branch}`], {
      cwd,
      stdio: 'ignore',
      timeout: 60_000,
    });
    const text = execFileSync('git', ['show', 'FETCH_HEAD:data/sources.lock.json'], {
      cwd,
      encoding: 'utf8',
    });
    return pinnedFrom(parseLock(JSON.parse(text), `${branch}:data/sources.lock.json`));
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const lock = readLock();
  const src = lock.sources;
  const loc = src['localize'];
  const mirror = src['eldritchtools'];
  const lethe = src['openLethe'];
  const locPins = languagePins(lock, 'localize');
  if (!loc || Object.keys(locPins).length === 0 || !mirror?.ref || !lethe?.ref) {
    console.error('upstream: data/sources.lock.json is missing localize/eldritchtools/openLethe');
    process.exit(2);
  }

  const heads: PinnedShas = {
    localize: { KR: null, EN: null },
    eldritchtools: shaFromGit(mirror.repo, mirror.ref),
    openLethe: shaFromGit(lethe.repo, lethe.ref),
  };
  const localizeCommits = {} as Record<LocalizeLang, string[] | null>;
  for (const lang of LOCALIZE_LANGS) {
    const ref = locPins[lang]?.ref;
    const commits = ref ? recentCommits(loc.repo, ref) : null;
    heads.localize[lang] = commits?.[0]?.sha ?? null;
    localizeCommits[lang] = commits?.map((c) => c.committedAt) ?? null;
  }

  const now = new Date();
  const status = judgeUpstream({
    now,
    heads,
    localizeCommits,
    mirrorUpdatedAt: heads.eldritchtools ? await mirrorUpdatedAt(mirror.repo, heads.eldritchtools) : null,
    lock: pinnedFrom(lock),
    todayBranchLock: todayBranchLock(`data/weekly-${patchDayOf(now)}`),
  });

  if (hasFlag('--json')) console.log(JSON.stringify(status, null, 2));
  else console.log(`upstream: ${status.verdict} — ${status.summary}`);
}

await main();
