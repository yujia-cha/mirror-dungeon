/**
 * Download the vendored game data listed in data/sources.lock.json into data/raw.
 *
 *   npm run data:fetch              restore exactly the pinned commits (reproducible)
 *   npm run data:fetch -- --update  move each source to the latest commit of its ref, then download
 *
 * Files that 404 are reported, not fatal: upstream renames files between seasons, and the
 * `update-game-data` skill explains how to fix the lock file when that happens.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { shaFromGit } from './lib/git-remote.ts';
import { hasFlag, readJson, repoPath } from './lib/io.ts';

/** One language of a source, when the upstream splits languages across branches rather than folders. */
interface LanguageEntry {
  ref: string;
  sha: string;
}

interface SourceEntry {
  repo: string;
  /** The revision for a single-language source. Sources with per-language branches use `languages`. */
  ref?: string;
  sha?: string;
  fetchedAt: string;
  note?: string;
  remotePrefix: string;
  localPrefix: string;
  /**
   * The languages to fetch. An array means one revision serves them all and the language is a path
   * segment; a map gives each language its own branch, which is how the localization mirror we use
   * is laid out (`Korean`, `English`). Either way the files land under `localPrefix/<lang>/`, so
   * nothing downstream has to know the difference.
   */
  languages?: string[] | Record<string, LanguageEntry>;
  /**
   * Remote paths under `remotePrefix`. A plain string is fetched for every language in
   * `languages`; an object narrows one file to a subset of them — the identity skill text is only
   * ever read in Korean, and mirroring the English copies would double the vendored bytes for
   * nothing.
   */
  files: (string | { path: string; languages?: string[] })[];
}

function languageNames(entry: SourceEntry): string[] | null {
  if (!entry.languages) return null;
  return Array.isArray(entry.languages) ? entry.languages : Object.keys(entry.languages);
}

interface Lock {
  $comment?: string;
  sources: Record<string, SourceEntry>;
}

const RAW = 'https://raw.githubusercontent.com';
const lockPath = repoPath('data/sources.lock.json');

async function shaFromApi(repo: string, ref: string): Promise<string | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/commits/${ref}`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'mirror-dungeon-router' },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { sha?: string };
    return body.sha ?? null;
  } catch {
    return null;
  }
}

/**
 * The exact commit at the tip of `ref`, so the lock file records what was downloaded. The GitHub
 * API is often blocked in sandboxes; `git ls-remote` usually still gets through, and the raw host
 * always does. Only when both fail do we download from the ref and leave the recorded sha alone —
 * and say so, because a lock that names one commit while the files come from another is the
 * quiet kind of drift this pipeline exists to catch.
 */
async function latestSha(repo: string, ref: string): Promise<{ sha: string; via: 'api' | 'git' } | null> {
  const api = await shaFromApi(repo, ref);
  if (api) return { sha: api, via: 'api' };
  const git = shaFromGit(repo, ref);
  return git ? { sha: git, via: 'git' } : null;
}

async function download(url: string): Promise<string | null> {
  const res = await fetch(url);
  if (!res.ok) return null;
  return res.text();
}

/**
 * The revision to download one part of a source from, moving the lock to the branch tip when
 * `--update` is on. Each language branch is pinned separately: they move on their own.
 */
async function revisionFor(
  label: string,
  pin: { ref: string; sha: string },
  entry: SourceEntry,
  update: boolean,
): Promise<string> {
  if (!update) return pin.sha;
  const tip = await latestSha(entry.repo, pin.ref);
  if (tip) {
    const moved = tip.sha !== pin.sha;
    const via = tip.via === 'git' ? ' (GitHub API unreachable; sha from git ls-remote)' : '';
    console.log(
      `  ${label}: ${moved ? `${pin.sha.slice(0, 8)} -> ${tip.sha.slice(0, 8)}` : `${pin.sha.slice(0, 8)} unchanged`}${via}`,
    );
    pin.sha = tip.sha;
    entry.fetchedAt = new Date().toISOString().slice(0, 10);
    return tip.sha;
  }
  console.log(
    `  ${label}: neither the GitHub API nor git ls-remote answered; downloading from ref "${pin.ref}" and leaving the recorded sha ${pin.sha.slice(0, 8)} as it is`,
  );
  return pin.ref;
}

async function fetchSource(name: string, entry: SourceEntry, update: boolean): Promise<number> {
  const perLanguage = entry.languages && !Array.isArray(entry.languages) ? entry.languages : null;
  const revByLanguage = new Map<string, string>();
  if (perLanguage) {
    for (const [lang, pin] of Object.entries(perLanguage)) {
      revByLanguage.set(lang, await revisionFor(`${name} ${lang}`, pin, entry, update));
    }
  }
  const shared = perLanguage
    ? null
    : await revisionFor(name, entry as { ref: string; sha: string }, entry, update);

  const languages = languageNames(entry);
  const targets = entry.files.flatMap((item) => {
    const file = typeof item === 'string' ? item : item.path;
    const only = typeof item === 'string' ? languages : (item.languages ?? languages);
    return only
      ? only.map((lang) => ({ lang: lang as string | null, file }))
      : [{ lang: null as string | null, file }];
  });

  let written = 0;
  const missing: string[] = [];

  for (const { lang, file } of targets) {
    const rev = (lang ? revByLanguage.get(lang) : null) ?? shared;
    if (!rev) {
      missing.push(`${lang}/${file} (no revision pinned for ${lang})`);
      continue;
    }
    // A per-language branch holds that language at its root; a shared revision keeps it in a folder.
    const remote = [entry.remotePrefix, perLanguage ? null : lang, file].filter(Boolean).join('/');
    const local = repoPath([entry.localPrefix, lang, file].filter(Boolean).join('/'));
    const text = await download(`${RAW}/${entry.repo}/${rev}/${remote}`);
    if (text === null) {
      missing.push(remote);
      continue;
    }
    mkdirSync(dirname(local), { recursive: true });
    // Normalize to a trailing newline so re-downloads do not churn the diff.
    writeFileSync(local, text.endsWith('\n') ? text : `${text}\n`, 'utf8');
    written += 1;
  }

  console.log(`  ${name}: ${written} files written${missing.length ? `, ${missing.length} missing` : ''}`);
  for (const m of missing) console.log(`    missing: ${m}`);
  return missing.length;
}

async function main(): Promise<void> {
  const update = hasFlag('--update');
  const lock = readJson<Lock>(lockPath);

  console.log(update ? 'Updating sources to latest and downloading:' : 'Downloading pinned sources:');

  let missing = 0;
  for (const [name, entry] of Object.entries(lock.sources)) {
    missing += await fetchSource(name, entry, update);
  }

  if (update) {
    // The lock is written by hand and read by people: keep its own key order (repo, ref, sha,
    // fetchedAt, note …) rather than sorting it, so an update diffs as the few lines that moved.
    writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
    console.log('data/sources.lock.json updated');
  }

  if (missing > 0) {
    console.log(
      `\n${missing} file(s) could not be downloaded. If upstream renamed them (new season), ` +
        'update data/sources.lock.json — see the update-game-data skill.',
    );
    process.exitCode = 1;
  }
}

await main();
