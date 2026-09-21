/**
 * Add the next Mirror Dungeon season's file names to `data/sources.lock.json`.
 *
 *   npm run data:lock-next-season -- 8            show what would be added
 *   npm run data:lock-next-season -- 8 --write    write it
 *   npm run data:lock-next-season -- 8 --from 7   pick the season to copy from (default: newest)
 *
 * This is the step `update-game-data` used to leave to hand: the lock names each season's files
 * with a dozen different suffix rules (`-md7`, `-7`, `-07`, `mirrordungeon7`, `battle7-`, `_7`,
 * `_MD7`, `_Mirror7`), and getting one wrong means `data:fetch` silently skips a file the build
 * then treats as absent. `scripts/lib/season-files.ts` holds the rules; this puts them in the file.
 *
 * Nothing is ever removed. The upstreams keep every season's files side by side, and the seasons
 * we already built still need theirs to be restorable.
 *
 * It does not fetch anything. After writing, run `npm run data:fetch` and read what arrives:
 * a 404 here means the season is not on that upstream (OpenLethe's Mirror Dungeon capture is
 * frozen at md7, so its files will not appear — that is the case `npm run data:import` exists for).
 */
import { writeFileSync } from 'node:fs';
import { hasFlag, flagValue, readJson, repoPath } from './lib/io.ts';
import { familyOf, newestSeason, renameToSeason, seasonOf } from './lib/season-files.ts';

type LockFile = string | { path: string; languages?: string[] };

interface Lock {
  $comment?: string;
  mirrorDungeonSeason?: number;
  sources: Record<string, { localPrefix: string; files: LockFile[] }>;
}

const LOCK_PATH = repoPath('data/sources.lock.json');

function usage(message: string): never {
  console.error(message);
  console.error('usage: npm run data:lock-next-season -- <season> [--from <season>] [--write]');
  process.exit(1);
}

function pathOf(file: LockFile): string {
  return typeof file === 'string' ? file : file.path;
}

/** The same lock entry pointed at another season — a bare path stays bare, an object keeps its keys. */
function renamedEntry(file: LockFile, to: number): LockFile | null {
  const next = renameToSeason(pathOf(file), to);
  if (next === null) return null;
  return typeof file === 'string' ? next : { ...file, path: next };
}

function main(): void {
  const write = hasFlag('--write');
  const positional = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
  const fromFlag = flagValue('--from');
  // `--from 7` puts 7 in the positional list too; the target is the one that is not the flag's value.
  const target = Number(positional.find((arg) => arg !== fromFlag));
  if (!Number.isInteger(target)) usage('give the season to add, e.g. `-- 8`.');

  const lock = readJson<Lock>(LOCK_PATH);
  const allPaths = Object.values(lock.sources).flatMap((source) => source.files.map(pathOf));

  const from = fromFlag !== undefined ? Number(fromFlag) : newestSeason(allPaths);
  if (from === null) usage('the lock names no season to copy from. Pass --from <season>.');
  if (!Number.isInteger(from)) usage(`--from takes a season number, not ${String(fromFlag)}.`);
  if (from === target) usage(`the lock already sits on season ${target}. Give a newer one.`);

  let added = 0;
  const report: string[] = [];

  for (const [name, source] of Object.entries(lock.sources)) {
    const have = new Set(source.files.map(pathOf));
    const next: LockFile[] = [];
    const addedHere: string[] = [];
    for (const file of source.files) {
      next.push(file);
      if (seasonOf(pathOf(file)) !== from) continue;
      const renamed = renamedEntry(file, target);
      if (!renamed || have.has(pathOf(renamed))) continue;
      have.add(pathOf(renamed));
      next.push(renamed);
      addedHere.push(pathOf(renamed));
    }
    if (addedHere.length === 0) continue;
    source.files = next;
    added += addedHere.length;
    report.push(`  ${name} (+${addedHere.length})`);
    for (const path of addedHere) report.push(`    + ${path}  [${familyOf(path)}]`);
  }

  if (lock.mirrorDungeonSeason !== undefined) {
    report.push(`  mirrorDungeonSeason ${lock.mirrorDungeonSeason} → ${target}`);
    lock.mirrorDungeonSeason = target;
  }

  console.log(`${write ? 'Added' : 'Would add'} season ${target} (copied from ${from}): ${added} file(s)`);
  for (const line of report) console.log(line);

  // The theme-floor files are numbered by pack tier, not by season, so nothing above touches them.
  // A season that introduces a new tier arrives as a file no rule can predict.
  const tiers = allPaths.filter((path) => /mirrordungeon-theme-floor-t(\d+)\.json$/.test(path));
  const highest = Math.max(...tiers.map((path) => Number(/-t(\d+)\.json$/.exec(path)![1])));
  console.log(
    `\n  Not covered (by design): mirrordungeon-theme-floor-t1..t${highest}.json are pack tiers, not seasons.` +
      `\n  If ${target} adds a pack tier, t${highest + 1} has to be added by hand once you see it upstream.`,
  );

  if (added === 0) {
    console.log(`\nNothing to add — the lock already names season ${target} for every family it tracks.`);
    return;
  }
  if (!write) {
    console.log('\nNothing was written. Re-run with --write to apply, then: npm run data:fetch');
    return;
  }
  // Written by hand rather than through writeJsonStable: the lock's key order is meaningful
  // (`$comment` first, sources in fetch order) and sorting it would rewrite the whole file.
  writeFileSync(LOCK_PATH, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
  console.log(`\nWrote data/sources.lock.json. Next: npm run data:fetch`);
}

main();
