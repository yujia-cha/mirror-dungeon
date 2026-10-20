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
 * what they claim to be, and copies the ones the lock asks for — all of them, or none if any was
 * rejected (`scripts/lib/import-static.ts`). It never edits the lock — a new
 * season's file names are printed for a person to read and decide on.
 */
import { existsSync, statSync } from 'node:fs';
import { basename, relative } from 'node:path';
import { indexByName, planImport, writeImport } from './lib/import-static.ts';
import { hasFlag, repoPath } from './lib/io.ts';
import { lockFilePath, readLock } from './lib/lock.ts';
import { seasonOf } from './lib/season-files.ts';

const STATIC_PREFIX = 'data/raw/static';

function usage(message: string): never {
  console.error(message);
  console.error('usage: npm run data:import -- <extracted static-data folder> [--write]');
  process.exit(1);
}

function main(): void {
  const write = hasFlag('--write');
  const args = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
  const source = args[0];
  if (!source) usage('no folder given.');
  if (!existsSync(source) || !statSync(source).isDirectory()) usage(`${source} is not a folder.`);

  const lock = readLock();
  const entry = Object.values(lock.sources).find((s) => s.localPrefix === STATIC_PREFIX);
  if (!entry) usage(`no source in the lock writes to ${STATIC_PREFIX}.`);

  const wanted = entry.files.map(lockFilePath);
  const available = indexByName(source);
  const seasonsWanted = new Set(
    wanted.map((file) => seasonOf(basename(file))).filter((n): n is number => n !== null),
  );

  // Every file is checked first; with --write they are copied only if none was rejected.
  const plan = planImport(wanted, available, (file) => repoPath(STATIC_PREFIX, file));
  const wrote = write && writeImport(plan);
  const copied = plan.copies.map((c) => c.file);
  const { missing, rejected, unchanged } = plan;

  // A new season arrives as files the lock has never heard of. Naming them is this script's job;
  // deciding to track them is a person's.
  const newSeasonFiles: string[] = [];
  for (const [name, paths] of available) {
    if (wanted.some((file) => basename(file) === name)) continue;
    const season = seasonOf(name);
    if (season === null || seasonsWanted.has(season)) continue;
    newSeasonFiles.push(`${name} (season ${season}) — ${relative(source, paths[0]!)}`);
  }

  console.log(`${wrote ? 'Imported' : 'Would import'} from ${source}:`);
  console.log(`  ${copied.length} file(s) ${wrote ? 'written' : 'to write'}, ${unchanged.length} unchanged`);
  for (const file of copied) console.log(`    ${wrote ? '+' : '·'} ${file}`);
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
  if (write && !wrote)
    console.log(`\nNothing was written: ${rejected.length} file(s) were rejected. Fix them and re-run.`);
  else if (!write && copied.length > 0) console.log('\nNothing was written. Re-run with --write to apply.');
  if (rejected.length > 0) process.exitCode = 1;
}

main();
