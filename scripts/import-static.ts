/**
 * Vendor game data extracted from a local client copy.
 *
 *   npm run data:import -- <folder>          preview what would change
 *   npm run data:import -- <folder> --write  write it into data/raw/static
 *
 * This is the escape hatch for the one thing no community source provides: each theme pack's
 * *general* gift pool. OpenLethe's Mirror Dungeon capture is frozen, so a new season will never
 * arrive there, and `eldritchtools/limbus-assets` — which does keep up — has no per-pack pool, no
 * prices and no observation list. Extracting the game's own `static-data` is the only way to get
 * them back.
 *
 * The extraction itself is not done here: see `docs/research/data-sources.md` for the catalog →
 * bundle → UnityPy route. This script takes the folder that comes out of it, checks the files are
 * what they claim to be, and copies the ones the lock asks for. It never edits the lock — a new
 * season's file names are printed for a person to read and decide on.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { hasFlag, readJson, repoPath } from './lib/io.ts';
import { seasonOf } from './lib/season-files.ts';

interface Lock {
  sources: Record<string, { localPrefix: string; files: (string | { path: string })[] }>;
}

const STATIC_PREFIX = 'data/raw/static';

function usage(message: string): never {
  console.error(message);
  console.error('usage: npm run data:import -- <extracted static-data folder> [--write]');
  process.exit(1);
}

/** Every file under `dir`, keyed by base name, so an extraction's own layout does not matter. */
function indexByName(dir: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const walk = (current: string): void => {
    for (const entry of readdirSync(current)) {
      const path = join(current, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (entry.endsWith('.json')) out.set(entry, [...(out.get(entry) ?? []), path]);
    }
  };
  walk(dir);
  return out;
}

/**
 * Whether a file looks like the static record it is supposed to be.
 *
 * Pointing this at the wrong folder should change nothing, so every candidate is parsed and shape-
 * checked before a single byte is written.
 */
function looksLikeStaticData(path: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return 'not valid JSON';
  }
  if (parsed === null || typeof parsed !== 'object') return 'not a JSON object';
  const record = parsed as Record<string, unknown>;
  const hasList = Array.isArray(record['list']) || Array.isArray(record['dataList']);
  // Some static files are a bare object of settings rather than a list, so an id-bearing object counts.
  if (!hasList && !('id' in record) && Object.keys(record).length === 0) return 'empty';
  return null;
}

function main(): void {
  const write = hasFlag('--write');
  const args = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
  const source = args[0];
  if (!source) usage('no folder given.');
  if (!existsSync(source) || !statSync(source).isDirectory()) usage(`${source} is not a folder.`);

  const lock = readJson<Lock>(repoPath('data/sources.lock.json'));
  const entry = Object.values(lock.sources).find((s) => s.localPrefix === STATIC_PREFIX);
  if (!entry) usage(`no source in the lock writes to ${STATIC_PREFIX}.`);

  const wanted = entry.files.map((file) => (typeof file === 'string' ? file : file.path));
  const available = indexByName(source);
  const seasonsWanted = new Set(
    wanted.map((file) => seasonOf(basename(file))).filter((n): n is number => n !== null),
  );

  const copied: string[] = [];
  const missing: string[] = [];
  const rejected: string[] = [];
  const unchanged: string[] = [];

  for (const file of wanted) {
    const name = basename(file);
    const candidates = available.get(name);
    if (!candidates || candidates.length === 0) {
      missing.push(file);
      continue;
    }
    if (candidates.length > 1) {
      rejected.push(`${file} — ${candidates.length} files share this name; cannot tell them apart`);
      continue;
    }
    const from = candidates[0]!;
    const problem = looksLikeStaticData(from);
    if (problem) {
      rejected.push(`${file} — ${problem}`);
      continue;
    }
    const to = repoPath(STATIC_PREFIX, file);
    if (existsSync(to) && readFileSync(to, 'utf8') === readFileSync(from, 'utf8')) {
      unchanged.push(file);
      continue;
    }
    if (write) {
      mkdirSync(dirname(to), { recursive: true });
      copyFileSync(from, to);
    }
    copied.push(file);
  }

  // A new season arrives as files the lock has never heard of. Naming them is this script's job;
  // deciding to track them is a person's.
  const newSeasonFiles: string[] = [];
  for (const [name, paths] of available) {
    if (wanted.some((file) => basename(file) === name)) continue;
    const season = seasonOf(name);
    if (season === null || seasonsWanted.has(season)) continue;
    newSeasonFiles.push(`${name} (season ${season}) — ${relative(source, paths[0]!)}`);
  }

  console.log(`${write ? 'Imported' : 'Would import'} from ${source}:`);
  console.log(`  ${copied.length} file(s) ${write ? 'written' : 'to write'}, ${unchanged.length} unchanged`);
  for (const file of copied) console.log(`    ${write ? '+' : '·'} ${file}`);
  if (missing.length > 0) {
    console.log(`  ${missing.length} not found in the folder:`);
    for (const file of missing) console.log(`    ? ${file}`);
  }
  if (rejected.length > 0) {
    console.log(`  ${rejected.length} rejected:`);
    for (const file of rejected) console.log(`    ! ${file}`);
  }
  if (newSeasonFiles.length > 0) {
    console.log(`\n  A newer season is in this folder. Add these to data/sources.lock.json:`);
    console.log('    npm run data:lock-next-season -- <season>   (preview; --write to apply)');
    for (const file of newSeasonFiles) console.log(`    * ${file}`);
  }
  if (!write && copied.length > 0) console.log('\nNothing was written. Re-run with --write to apply.');
  if (rejected.length > 0) process.exitCode = 1;
}

main();
