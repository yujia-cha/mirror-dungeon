/**
 * `meta.dataVersion` (M163): `<dungeonId>.<8 hex>`, a content hash of what the build read *and*
 * what it wrote.
 *
 * Until M163 the hash covered the inputs only — `data/raw`, the derived mirror, `data/curated` and
 * the finished `skill-gifts.json` — so a parser change (`parse-effects`, `parse-conditions`,
 * `derive.ts`) that moved every gift's effects kept the same `dataVersion`, and a feedback report
 * naming that version named two different data sets. The serialized outputs join the hash here, so
 * the version moves whenever the shipped data moves. The inputs stay in it on purpose (see the
 * review doc): `data-update.yml` names its branch after the version and commits the raw files too,
 * so two refreshes whose raw files differ must not share a name even when nothing we generate
 * from them changed.
 *
 * Every part is keyed by a repo-relative path with a `\0` after the path and after the text, so
 * `a` + `bc` and `ab` + `c` cannot collide and a file moving between directories is a change.
 * Parts are sorted by path before hashing, so the caller's order does not matter.
 *
 * Deliberately absent: `data/curated/capture-layout.json` — it describes the game's screen, not
 * its data, so moving a region must not announce a new data version — and `meta.json` itself,
 * which carries the version and the lock's `fetchedAt` stamps (a re-fetch that changed no bytes
 * is not a data change).
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export interface FingerprintPart {
  /** Repo-relative, forward slashes: `data/raw/static/…`, `public/data/md8/gifts.json`. */
  path: string;
  text: string;
}

/** The hex length after the dot — eight, as every version since M5 has been. */
export const DATA_VERSION_HEX = 8;

/**
 * Every `.json` under `roots` (recursively, sorted), each as its repo-relative path and its JSON
 * re-serialized without whitespace — so reformatting a vendored file is not a data change.
 * `exclude` lists absolute paths to leave out.
 */
export function jsonPartsUnder(
  roots: readonly string[],
  options: { base: string; exclude?: readonly string[] },
): FingerprintPart[] {
  const excluded = new Set(options.exclude ?? []);
  const parts: FingerprintPart[] = [];
  const walk = (dir: string): void => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir).sort()) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith('.json') && !excluded.has(full)) {
        parts.push({
          path: relative(options.base, full).split(sep).join('/'),
          text: JSON.stringify(JSON.parse(readFileSync(full, 'utf8'))),
        });
      }
    }
  };
  for (const root of roots) walk(root);
  return parts;
}

/** The content hash of `parts`, order-insensitive, as `DATA_VERSION_HEX` hex characters. */
export function contentFingerprint(parts: readonly FingerprintPart[]): string {
  const hash = createHash('sha256');
  for (const part of [...parts].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    hash.update(part.path);
    hash.update('\0');
    hash.update(part.text);
    hash.update('\0');
  }
  return hash.digest('hex').slice(0, DATA_VERSION_HEX);
}

/** `<dungeonId>.<hash>` over the inputs the build read and the outputs it is about to write. */
export function dataVersionOf(
  dungeonId: number,
  inputs: readonly FingerprintPart[],
  outputs: readonly FingerprintPart[],
): string {
  return `${dungeonId}.${contentFingerprint([...inputs, ...outputs])}`;
}
