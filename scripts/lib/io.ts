import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

export const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));

export function repoPath(...parts: string[]): string {
  return resolve(repoRoot, ...parts);
}

export function readJson<T = unknown>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

export function readJsonIfExists<T = unknown>(path: string): T | null {
  return existsSync(path) ? readJson<T>(path) : null;
}

/**
 * Write JSON with sorted object keys so regenerating the data produces no spurious diffs.
 * Arrays keep their order — callers sort them deliberately.
 */
export function writeJsonStable(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(sortKeysDeep(value), null, 2)}\n`, 'utf8');
}

export function sortKeysDeep<T>(value: T): T {
  if (Array.isArray(value)) return value.map(sortKeysDeep) as unknown as T;
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) out[key] = sortKeysDeep(source[key]);
    return out as unknown as T;
  }
  return value;
}

/** A `list`-wrapped static-data file, or a bare array. */
export function staticList<T>(raw: unknown): T[] {
  if (Array.isArray(raw)) return raw as T[];
  if (raw && typeof raw === 'object' && Array.isArray((raw as { list?: unknown }).list)) {
    return (raw as { list: T[] }).list;
  }
  return [];
}

/** A `dataList`-wrapped localization file, or a bare array. */
export function localizeList<T>(raw: unknown): T[] {
  if (Array.isArray(raw)) return raw as T[];
  if (raw && typeof raw === 'object' && Array.isArray((raw as { dataList?: unknown }).dataList)) {
    return (raw as { dataList: T[] }).dataList;
  }
  return [];
}

export function hasFlag(flag: string): boolean {
  return process.argv.slice(2).includes(flag);
}

export function flagValue(flag: string): string | undefined {
  const args = process.argv.slice(2);
  const eq = args.find((a) => a.startsWith(`${flag}=`));
  if (eq) return eq.slice(flag.length + 1);
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : undefined;
}
