/**
 * Summarise how public/data changed against git HEAD, so a data refresh can be reviewed by reading
 * a few lines instead of a 10k-line JSON diff.
 *
 *   npm run data:diff
 *   npm run data:diff -- --ref HEAD~3
 *   npm run data:diff -- --season 7
 *
 * Season-owned files are compared inside their own directory; `identities.json` is shared, so it
 * is compared once whatever season is selected.
 */
import { execFileSync } from 'node:child_process';
import { flagValue, readJson, repoPath } from './lib/io.ts';
import { defaultSeason, outPath, outRelPath } from './lib/out.ts';
import type { Gift, Identity, Meta, ThemePack } from '../src/core/schema.ts';
import { sourceRevision } from './lib/changelog.ts';

const ref = flagValue('--ref') ?? 'HEAD';
const season = Number(flagValue('--season') ?? defaultSeason() ?? 7);

function fromGit<T>(path: string): T | null {
  try {
    const text = execFileSync('git', ['show', `${ref}:${path}`], {
      cwd: repoPath(''),
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

interface Named {
  id: number;
  name?: { ko: string };
  title?: { ko: string };
}

function label(entity: Named | undefined, id: number): string {
  const name = entity?.name?.ko ?? entity?.title?.ko;
  return name ? `${id} ${name}` : String(id);
}

function diffSet<T extends Named>(kind: string, before: T[] | null, after: T[]): void {
  if (!before) {
    console.log(`${kind}: no previous version at ${ref} (new file) — ${after.length} entries`);
    return;
  }
  const beforeById = new Map(before.map((e) => [e.id, e]));
  const afterById = new Map(after.map((e) => [e.id, e]));

  const added = after.filter((e) => !beforeById.has(e.id));
  const removed = before.filter((e) => !afterById.has(e.id));
  const changed = after.filter((e) => {
    const prev = beforeById.get(e.id);
    return prev && JSON.stringify(prev) !== JSON.stringify(e);
  });

  console.log(
    `${kind}: ${before.length} -> ${after.length}` +
      ` (+${added.length} / -${removed.length} / ~${changed.length})`,
  );
  const show = (title: string, entries: T[]): void => {
    if (entries.length === 0) return;
    const head = entries.slice(0, 15).map((e) => label(e, e.id));
    console.log(`  ${title}: ${head.join(', ')}${entries.length > 15 ? ` … +${entries.length - 15}` : ''}`);
  };
  show('added', added);
  show('removed', removed);
  show('changed', changed);
}

const meta = readJson<Meta>(outPath('meta', season));
const prevMeta = fromGit<Meta>(outRelPath('meta', season));

console.log(`dataVersion: ${prevMeta?.dataVersion ?? '(none)'} -> ${meta.dataVersion}`);
if (prevMeta) {
  for (const [name, source] of Object.entries(meta.sources)) {
    const from = sourceRevision(prevMeta.sources[name]);
    const to = sourceRevision(source);
    if (from && to && from !== to) console.log(`source ${name}: ${from} -> ${to}`);
  }
}

diffSet('gifts', fromGit<Gift[]>(outRelPath('gifts', season)), readJson<Gift[]>(outPath('gifts', season)));
diffSet(
  'packs',
  fromGit<ThemePack[]>(outRelPath('packs', season)),
  readJson<ThemePack[]>(outPath('packs', season)),
);
diffSet(
  'identities',
  fromGit<Identity[]>(outRelPath('identities', season)),
  readJson<Identity[]>(outPath('identities', season)),
);

// rules.json is small but high impact: show the literal lines that moved.
const prevRules = fromGit<unknown>(outRelPath('rules', season));
const nextRules = readJson<unknown>(outPath('rules', season));
if (prevRules && JSON.stringify(prevRules) !== JSON.stringify(nextRules)) {
  console.log('rules: changed');
  const a = JSON.stringify(prevRules, null, 2).split('\n');
  const b = JSON.stringify(nextRules, null, 2).split('\n');
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if (a[i] !== b[i]) console.log(`  - ${a[i] ?? ''}\n  + ${b[i] ?? ''}`);
  }
} else if (prevRules) {
  console.log('rules: unchanged');
}
