/**
 * The checking half of `npm run data:import` (`scripts/import-static.ts`): which files of an
 * extracted `static-data` folder the lock asks for, which are missing or wrong, and — only when
 * nothing is wrong — copying them. Pointing the import at the wrong folder must change nothing,
 * so every candidate is checked before a single byte is written.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

/** Every `.json` file under `dir`, keyed by base name, so an extraction's own layout does not matter. */
export function indexByName(dir: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const walk = (current: string): void => {
    for (const entry of readdirSync(current).sort()) {
      const path = join(current, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (entry.endsWith('.json')) out.set(entry, [...(out.get(entry) ?? []), path]);
    }
  };
  walk(dir);
  return out;
}

/** Why a file does not look like the static record it is supposed to be, or `null` if it does. */
export function looksLikeStaticData(path: string): string | null {
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

export interface ImportPlan {
  /** Files that differ from the vendored copy: lock path, the extracted file, the target. */
  copies: { file: string; from: string; to: string }[];
  missing: string[];
  /** `<lock path> — <why>`. Any of these and nothing is written. */
  rejected: string[];
  unchanged: string[];
}

/**
 * Check every file the lock wants (`wanted`, lock paths) against the extracted folder's index
 * (`indexByName`). `targetOf` maps a lock path to where it is vendored. Reads only.
 */
export function planImport(
  wanted: readonly string[],
  available: ReadonlyMap<string, readonly string[]>,
  targetOf: (file: string) => string,
): ImportPlan {
  const plan: ImportPlan = { copies: [], missing: [], rejected: [], unchanged: [] };
  for (const file of wanted) {
    const candidates = available.get(basename(file));
    if (!candidates || candidates.length === 0) {
      plan.missing.push(file);
      continue;
    }
    if (candidates.length > 1) {
      plan.rejected.push(`${file} — ${candidates.length} files share this name; cannot tell them apart`);
      continue;
    }
    const from = candidates[0]!;
    const problem = looksLikeStaticData(from);
    if (problem) {
      plan.rejected.push(`${file} — ${problem}`);
      continue;
    }
    const to = targetOf(file);
    if (existsSync(to) && readFileSync(to, 'utf8') === readFileSync(from, 'utf8')) {
      plan.unchanged.push(file);
      continue;
    }
    plan.copies.push({ file, from, to });
  }
  return plan;
}

/** Copy the plan's files — all of them, or none when anything was rejected. Returns whether it wrote. */
export function writeImport(plan: ImportPlan): boolean {
  if (plan.rejected.length > 0) return false;
  for (const { from, to } of plan.copies) {
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(from, to);
  }
  return true;
}
