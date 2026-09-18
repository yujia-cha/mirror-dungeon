import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  enumsSchema,
  giftsFileSchema,
  identitiesFileSchema,
  metaSchema,
  packsFileSchema,
  rulesSchema,
  seasonIndexSchema,
  type GameData,
  type SeasonIndex,
} from '../schema.ts';

export const DEFAULT_DATA_ROOT = resolve(process.cwd(), 'public/data');

/** Which seasons are on disk and which one to open. */
export function readSeasonIndex(root = DEFAULT_DATA_ROOT): SeasonIndex {
  return seasonIndexSchema.parse(JSON.parse(readFileSync(resolve(root, 'index.json'), 'utf8')));
}

/**
 * Read the generated data straight off disk, for Vitest and scripts/route-cli.ts.
 * Always validates: a test or CLI run that silently accepts malformed data is worse than slow.
 *
 * `season` defaults to whatever `index.json` opens, so a caller that does not care about seasons
 * keeps working when a new one arrives.
 */
export function loadGameDataFromDisk(root = DEFAULT_DATA_ROOT, season?: number): GameData {
  const id = season ?? readSeasonIndex(root).default;
  const read = (dir: string, name: string): unknown =>
    JSON.parse(readFileSync(resolve(dir, `${name}.json`), 'utf8'));
  const seasonDir = resolve(root, `md${id}`);
  return {
    meta: metaSchema.parse(read(seasonDir, 'meta')),
    enums: enumsSchema.parse(read(root, 'enums')),
    rules: rulesSchema.parse(read(seasonDir, 'rules')),
    gifts: giftsFileSchema.parse(read(seasonDir, 'gifts')),
    packs: packsFileSchema.parse(read(seasonDir, 'packs')),
    identities: identitiesFileSchema.parse(read(root, 'identities')),
  };
}
