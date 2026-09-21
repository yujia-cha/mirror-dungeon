/**
 * Walk a Mirror Dungeon season turnover end to end, without the game.
 *
 *   npm run data:rehearse              all three variants
 *   npm run data:rehearse -- --variant full
 *   npm run data:rehearse -- --keep    leave the sandbox on disk and print where
 *   npm run data:rehearse -- --json    machine-readable result
 *
 * `npm run data:import` is the escape hatch for the one thing no community source provides — each
 * pack's general gift pool — and until now it had never been run. The day it is needed is the day
 * a new season lands and the app is planning the wrong one, which is a bad day to discover a typo
 * in the runbook. So: synthesise the next season from the one on disk, then run the real commands
 * the runbook lists, in order, against a sandbox copy of `data/`.
 *
 * Everything happens under `MD_REPO_ROOT` (see `scripts/lib/io.ts`). The working tree is read, and
 * never written — the rehearsal asserts that too.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';
import { flagValue, hasFlag } from './lib/io.ts';
import { copyTreePreservingTimes, synthesiseSeason, type SynthVariant } from './lib/synth-season.ts';

/** This checkout, whatever `MD_REPO_ROOT` says — the commands themselves live here. */
const REAL_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

/** What the sandbox needs to be a complete repo as far as the pipeline is concerned. */
const SANDBOX_INPUTS = ['data/raw', 'data/curated', 'data/sources.lock.json', 'public/data', 'public/art'];

export interface StepResult {
  name: string;
  command: string;
  ok: boolean;
  /** Combined stdout+stderr, trimmed. */
  output: string;
}

export interface RehearsalResult {
  variant: SynthVariant;
  from: number;
  to: number;
  sandbox: string;
  steps: StepResult[];
  /** Season ids `public/data/index.json` lists after the build, and which one is default. */
  seasons: number[];
  defaultSeason: number | null;
  provisional: Record<number, boolean>;
  /** True when every byte under `public/data/md{from}` survived the new season's build. */
  previousSeasonUntouched: boolean;
  /** Validation errors, as `data:validate` printed them. */
  validationErrors: string[];
  validationWarnings: string[];
  newPackIds: number[];
  newGiftIds: number[];
  /** Base names `data:import` reported as belonging to a newer season, before the lock knew them. */
  detectedNewSeasonFiles: string[];
  /** A summary of what the build produced for the season it built, or null when it produced none. */
  built: BuiltSummary | null;
  ok: boolean;
}

/**
 * Enough of the generated season to tell a good build from a quiet one.
 *
 * `observable` and `event` are the two counts the `partial` variant silently zeroes: the
 * observation list is what makes a gift observable, and the drop pool is what classes one as
 * `event`. Neither absence is an error today, which is the whole point of measuring them.
 */
export interface BuiltSummary {
  season: number;
  gifts: number;
  packs: number;
  selectablePacks: number;
  observable: number;
  event: number;
  dungeonNameKo: string;
  newPacksPresent: number[];
  newGiftsPresent: number[];
}

function run(name: string, args: string[], sandbox: string): StepResult {
  const command = `npm run -s ${args.join(' ')}`;
  try {
    const output = execFileSync('npm', ['run', '-s', ...args], {
      cwd: REAL_ROOT,
      env: { ...process.env, MD_REPO_ROOT: sandbox },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
    });
    return { name, command, ok: true, output: output.trim() };
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; message?: string };
    const output = `${err.stdout ?? ''}${err.stderr ?? ''}`.trim() || (err.message ?? 'failed');
    return { name, command, ok: false, output };
  }
}

/** A content hash of every file under `dir`, so "did anything change" is one comparison. */
function treeHash(dir: string): string {
  if (!existsSync(dir)) return 'absent';
  const hash = createHash('sha256');
  const walk = (current: string, prefix: string): void => {
    for (const entry of readdirSync(current).sort()) {
      const path = join(current, entry);
      if (statSync(path).isDirectory()) walk(path, `${prefix}${entry}/`);
      else hash.update(`${prefix}${entry}\0`).update(readFileSync(path));
    }
  };
  walk(dir, '');
  return hash.digest('hex');
}

function makeSandbox(): string {
  const sandbox = mkdtempSync(join(tmpdir(), 'md-rehearse-'));
  for (const input of SANDBOX_INPUTS) {
    const src = join(REAL_ROOT, input);
    if (!existsSync(src)) continue;
    const dst = join(sandbox, input);
    if (statSync(src).isDirectory()) {
      mkdirSync(dst, { recursive: true });
      copyTreePreservingTimes(src, dst);
    } else {
      mkdirSync(join(sandbox, input.slice(0, input.lastIndexOf('/'))), { recursive: true });
      cpSync(src, dst, { preserveTimestamps: true });
    }
  }
  return sandbox;
}

/** The lines `data:import` prints under "A newer season is in this folder". */
function newSeasonFilesFrom(output: string): string[] {
  const start = output.indexOf('A newer season is in this folder');
  if (start === -1) return [];
  return output
    .slice(start)
    .split('\n')
    .filter((line) => line.trim().startsWith('* '))
    .map((line) => line.trim().slice(2).split(' ')[0]!)
    .sort();
}

export function messagesFrom(output: string, prefix: 'warn' | 'error'): string[] {
  return output
    .split('\n')
    .filter((line) => line.startsWith(`${prefix} `))
    .map((line) => line.slice(prefix.length + 1).trim());
}

/**
 * Run `data:validate` against a sandbox again, for a caller that has changed something in it.
 * `tests/season-rollover.test.ts` uses this to add artwork and watch the season turnover break.
 */
export function validateIn(sandbox: string): StepResult {
  return run('validate', ['data:validate'], sandbox);
}

export function rehearse(variant: SynthVariant, options: { keep?: boolean } = {}): RehearsalResult {
  const sandbox = makeSandbox();
  const steps: StepResult[] = [];
  try {
    const lock = JSON.parse(readFileSync(join(sandbox, 'data/sources.lock.json'), 'utf8')) as {
      sources: Record<string, { localPrefix: string; files: (string | { path: string })[] }>;
    };
    const from = newestSeasonInLock(lock);
    const to = from + 1;

    const fixture = join(sandbox, 'fixture');
    const synth = synthesiseSeason({ outDir: fixture, from, to, variant });

    const previousSeasonBefore = treeHash(join(sandbox, 'public/data', `md${from}`));
    const rawBefore = treeHash(join(sandbox, 'data/raw/static'));

    let detectedNewSeasonFiles: string[] = [];

    if (variant === 'derived-only') {
      // Nothing was extracted; only the mirror moved. Replace the vendored mirror and build.
      rmSync(join(sandbox, 'data/raw/derived/eldritchtools'), { recursive: true, force: true });
      mkdirSync(join(sandbox, 'data/raw/derived/eldritchtools'), { recursive: true });
      copyTreePreservingTimes(synth.derivedDir!, join(sandbox, 'data/raw/derived/eldritchtools'));
      // Nothing is written to `data/curated`: the build marks a season provisional by itself when
      // a selectable pack has no general pool, and that is the behaviour being rehearsed.
    } else {
      // 1. The first import, before anyone touches the lock. It must change nothing on disk and
      //    name the season's files instead.
      const preview = run('import (before the lock knows the season)', ['data:import', '--', synth.staticDir], sandbox);
      steps.push(preview);
      detectedNewSeasonFiles = newSeasonFilesFrom(preview.output);
      if (treeHash(join(sandbox, 'data/raw/static')) !== rawBefore) {
        steps.push({
          name: 'import preview wrote to data/raw/static',
          command: '(assertion)',
          ok: false,
          output: 'a preview run must not write',
        });
      }

      // 2. Teach the lock the new season's file names, then import for real.
      steps.push(run('lock the next season', ['data:lock-next-season', '--', String(to), '--write'], sandbox));
      steps.push(run('import', ['data:import', '--', synth.staticDir, '--write'], sandbox));

      // 3. What `data:fetch` would have brought down. The localization mirror does keep up with
      //    seasons, so this is a copy rather than a gap — except in the `partial` variant, which
      //    has none, and where the empty dungeon name is part of what is being rehearsed.
      if (synth.localizeDir) {
        copyTreePreservingTimes(synth.localizeDir, join(sandbox, 'data/raw/localize'));
      }
    }

    steps.push(run('build', ['data:build'], sandbox));
    const validate = run('validate', ['data:validate'], sandbox);
    steps.push(validate);

    const builtSeason = variant === 'derived-only' ? from : to;
    const built = summariseBuilt(sandbox, builtSeason, synth.newPackIds, synth.newGiftIds);

    const index = readJsonIfAny<{
      default?: number;
      seasons?: { id: number; provisional?: boolean }[];
    }>(join(sandbox, 'public/data/index.json'));
    const seasons = (index?.seasons ?? []).map((entry) => entry.id).sort((a, b) => a - b);
    const provisional: Record<number, boolean> = {};
    for (const entry of index?.seasons ?? []) provisional[entry.id] = Boolean(entry.provisional);

    const result: RehearsalResult = {
      variant,
      from,
      to,
      sandbox,
      steps,
      seasons,
      defaultSeason: index?.default ?? null,
      provisional,
      previousSeasonUntouched: treeHash(join(sandbox, 'public/data', `md${from}`)) === previousSeasonBefore,
      validationErrors: messagesFrom(validate.output, 'error'),
      validationWarnings: messagesFrom(validate.output, 'warn'),
      newPackIds: synth.newPackIds,
      newGiftIds: synth.newGiftIds,
      detectedNewSeasonFiles,
      built,
      // `validate` failing is a result, not a crash: `derived-only` is *supposed* to be refused.
      // Whether each variant ended the way it should is `tests/season-rollover.test.ts`'s call.
      ok: steps.every((step) => step.ok || step.name === 'validate'),
    };
    return result;
  } finally {
    if (!options.keep) rmSync(sandbox, { recursive: true, force: true });
  }
}

function summariseBuilt(
  sandbox: string,
  season: number,
  newPackIds: number[],
  newGiftIds: number[],
): BuiltSummary | null {
  const dir = join(sandbox, 'public/data', `md${season}`);
  const gifts = readJsonIfAny<{ id: number; observable?: boolean; acquisition: { kind: string } }[]>(
    join(dir, 'gifts.json'),
  );
  const packs = readJsonIfAny<{ id: number; selectable?: boolean }[]>(join(dir, 'packs.json'));
  const meta = readJsonIfAny<{ dungeon: { name: { ko: string } } }>(join(dir, 'meta.json'));
  if (!gifts || !packs || !meta) return null;
  return {
    season,
    gifts: gifts.length,
    packs: packs.length,
    selectablePacks: packs.filter((pack) => pack.selectable).length,
    observable: gifts.filter((gift) => gift.observable).length,
    event: gifts.filter((gift) => gift.acquisition.kind === 'event').length,
    dungeonNameKo: meta.dungeon.name.ko,
    newPacksPresent: newPackIds.filter((id) => packs.some((pack) => pack.id === id)).sort((a, b) => a - b),
    newGiftsPresent: newGiftIds.filter((id) => gifts.some((gift) => gift.id === id)).sort((a, b) => a - b),
  };
}

function readJsonIfAny<T>(path: string): T | null {
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as T) : null;
}

function newestSeasonInLock(lock: {
  sources: Record<string, { files: (string | { path: string })[] }>;
}): number {
  const paths = Object.values(lock.sources).flatMap((source) =>
    source.files.map((file) => (typeof file === 'string' ? file : file.path)),
  );
  const seasons = paths
    .map((path) => /-md(\d+)\.json$/.exec(path)?.[1])
    .filter((n): n is string => n !== undefined)
    .map(Number);
  if (seasons.length === 0) throw new Error('the lock names no season');
  return Math.max(...seasons);
}

function report(result: RehearsalResult): void {
  const mark = (ok: boolean): string => (ok ? 'ok  ' : 'FAIL');
  console.log(`\n=== ${result.variant}: season ${result.from} → ${result.to}`);
  for (const step of result.steps) {
    console.log(`  ${mark(step.ok)} ${step.name}`);
    if (!step.ok) for (const line of step.output.split('\n').slice(-12)) console.log(`         ${line}`);
  }
  if (result.detectedNewSeasonFiles.length > 0) {
    console.log(`  import named ${result.detectedNewSeasonFiles.length} file(s) of the new season before the lock knew it`);
  }
  console.log(`  seasons on disk: ${result.seasons.join(', ') || 'none'}; default ${result.defaultSeason ?? 'none'}`);
  console.log(`  provisional: ${JSON.stringify(result.provisional)}`);
  console.log(`  md${result.from} output untouched: ${result.previousSeasonUntouched}`);
  if (result.built) {
    const b = result.built;
    console.log(
      `  built md${b.season}: ${b.gifts} gifts (${b.observable} observable, ${b.event} event), ` +
        `${b.packs} packs (${b.selectablePacks} selectable), name ${JSON.stringify(b.dungeonNameKo)}`,
    );
    console.log(`  new content present: packs ${b.newPacksPresent.join(',') || 'none'}, gifts ${b.newGiftsPresent.length}`);
  }
  for (const error of result.validationErrors) console.log(`  validate error  ${error}`);
  for (const warning of result.validationWarnings) console.log(`  validate warn   ${warning}`);
}

function main(): void {
  const only = flagValue('--variant') as SynthVariant | undefined;
  const keep = hasFlag('--keep');
  const variants: SynthVariant[] = only ? [only] : ['full', 'derived-only', 'partial'];
  const results = variants.map((variant) => rehearse(variant, { keep }));
  if (hasFlag('--json')) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }
  for (const result of results) {
    report(result);
    if (keep) console.log(`  sandbox kept at ${result.sandbox}`);
  }
  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} variant(s) ran every step.`);
  if (failed.length > 0) process.exitCode = 1;
}

// Run only as a command; `tests/season-rollover.test.ts` imports `rehearse` instead.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
