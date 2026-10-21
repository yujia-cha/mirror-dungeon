// @vitest-environment node
/**
 * The validate → write contract (M168): nothing reaches the disk unless every output passes its
 * schema. The fixture is the committed `public/data` itself — the one data set that is known to
 * pass — read back into a `BuildOutput`, so writing it into an empty directory must reproduce the
 * committed bytes, and breaking one file must leave that directory empty.
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readJson, repoPath } from '../io.ts';
import { BuildError } from './errors.ts';
import { validateAndWrite, validateOutput, type BuildOutput } from './output.ts';

const DATA = repoPath('public/data');
const index = readJson<{ default: number }>(join(DATA, 'index.json'));
const season = index.default;
const seasonDir = join(DATA, `md${season}`);

const SEASON_FILES = ['meta.json', 'rules.json', 'gifts.json', 'packs.json', 'skill-gifts.json'];
const SHARED_FILES = ['enums.json', 'identities.json', 'capture-layout.json', 'index.json'];

/** The committed default season, as the build would hold it just before the write phase. */
function committedOutput(): BuildOutput {
  return {
    dungeonId: season,
    meta: readJson(join(seasonDir, 'meta.json')),
    rules: readJson(join(seasonDir, 'rules.json')),
    gifts: readJson(join(seasonDir, 'gifts.json')),
    packs: readJson(join(seasonDir, 'packs.json')),
    skillGiftsText: readFileSync(join(seasonDir, 'skill-gifts.json'), 'utf8'),
    enums: readJson(join(DATA, 'enums.json')),
    identities: readJson(join(DATA, 'identities.json')),
    captureLayout: readJson(join(DATA, 'capture-layout.json')),
  };
}

let dir: string | undefined;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe.skipIf(!existsSync(seasonDir))('validateAndWrite', () => {
  it('writes the committed data back byte for byte, with an index of the one season it was given', () => {
    dir = mkdtempSync(join(tmpdir(), 'build-output-'));

    validateAndWrite(committedOutput(), dir);

    for (const name of SEASON_FILES) {
      expect(readFileSync(join(dir, `md${season}`, name), 'utf8'), name).toBe(
        readFileSync(join(seasonDir, name), 'utf8'),
      );
    }
    for (const name of SHARED_FILES.filter((n) => n !== 'index.json')) {
      expect(readFileSync(join(dir, name), 'utf8'), name).toBe(readFileSync(join(DATA, name), 'utf8'));
    }
    // The temp dir holds no frozen season, so the index lists just this one and opens it.
    const written = readJson<{ default: number; seasons: { id: number }[] }>(join(dir, 'index.json'));
    expect(written.default).toBe(season);
    expect(written.seasons.map((entry) => entry.id)).toEqual([season]);
  });

  it('writes nothing — not even the files that were fine — when one output fails its schema', () => {
    dir = mkdtempSync(join(tmpdir(), 'build-output-'));
    const out = committedOutput();
    const broken = { ...out, gifts: [{ ...out.gifts[0]!, id: 'not an id' as unknown as number }] };

    expect(() => validateAndWrite(broken, dir!)).toThrow(BuildError);
    expect(() => validateAndWrite(broken, dir!)).toThrow(/gifts\.json does not match its schema/);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('parses the capture layout before the season files are written (the M160 case)', () => {
    // Before M168 the layout was parsed after `gifts.json` was on disk, so a bad layout left a
    // season half written.
    dir = mkdtempSync(join(tmpdir(), 'build-output-'));
    const broken = { ...committedOutput(), captureLayout: { regions: 'nope' } };

    expect(() => validateAndWrite(broken, dir!)).toThrow(/capture-layout\.json does not match its schema/);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('drops the curated notes from the capture layout, like the written file never carried them', () => {
    const out = committedOutput();
    const noted = { ...out, captureLayout: { ...(out.captureLayout as object), _source: 'a note' } };
    const validated = validateOutput(noted, join(tmpdir(), 'does-not-exist'));
    expect(validated.captureLayout).toEqual(out.captureLayout);
  });
});
