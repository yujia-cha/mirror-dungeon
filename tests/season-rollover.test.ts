// @vitest-environment node
//
// The rehearsal runs the real pipeline commands as child processes, which needs a node
// environment, not jsdom.
/**
 * A Mirror Dungeon season turnover, walked end to end.
 *
 * `npm run data:import` is the only way to get a new season's per-pack general gift pool, and
 * until this suite existed it had never been run — the path that matters most on the worst day
 * was the one path with no evidence behind it. `scripts/rehearse-season.ts` synthesises the next
 * season out of the one on disk and runs `data:import` → `data:build` → `data:validate` against a
 * sandbox, so the runbook's own commands are what gets tested, not a reimplementation of them.
 *
 * Three shapes the extraction can arrive in, and what each one proves:
 *
 *   full          it works, and the new season becomes the default.
 *   derived-only  the fallback backfills packs and floors, and validation refuses the result
 *                 because no source can supply a general gift pool. Refusing is correct.
 *   partial       the drop pool and observation list never arrived. The build still produces a
 *                 season — every gift unobservable, none classed as `event`, no dungeon name —
 *                 and until M47 nothing complained. `checkSeasonSnapshot` now refuses it by
 *                 name, and the assertions below hold both halves: the build's silence, and the
 *                 validator's refusal.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { messagesFrom, rehearse, validateIn, type RehearsalResult } from '../scripts/rehearse-season.ts';
import { staticDataPresent } from '../scripts/lib/raw.ts';
import { derivedMdPresent } from '../scripts/lib/derived-md.ts';
import { loadGameDataFromDisk, readSeasonIndex } from '../src/core/data/node.ts';
import { buildIndexes, defaultOptions, planRoute } from '../src/core/index.ts';

const hasRaw = staticDataPresent() && derivedMdPresent();

/** Each variant runs once: the three together take about ten seconds. */
const results: Partial<Record<'full' | 'derived-only' | 'partial', RehearsalResult>> = {};

describe.skipIf(!hasRaw)('a season rollover, rehearsed end to end', () => {
  beforeAll(() => {
    results.full = rehearse('full', { keep: true });
    results['derived-only'] = rehearse('derived-only', { keep: true });
    results.partial = rehearse('partial', { keep: true });
  }, 600_000);

  afterAll(() => {
    for (const result of Object.values(results)) {
      if (result) rmSync(result.sandbox, { recursive: true, force: true });
    }
  });

  describe('full — the extraction arrived complete', () => {
    it('runs every command the runbook lists', () => {
      const result = results.full!;
      const failed = result.steps.filter((step) => !step.ok);
      expect(failed.map((step) => `${step.name}: ${step.output.split('\n').slice(-3).join(' | ')}`)).toEqual([]);
    });

    it('validates with no errors', () => {
      expect(results.full!.validationErrors).toEqual([]);
    });

    it('names the new season\'s files before the lock knows them, and writes nothing while previewing', () => {
      const result = results.full!;
      // The preview step asserts "nothing written" inside the rehearsal; it shows up as a failed
      // step if it ever does, which the first test would catch. Here: it recognised the season.
      expect(result.detectedNewSeasonFiles.length).toBeGreaterThan(0);
      expect(result.detectedNewSeasonFiles).toContain(
        `mirror-dungeon-common-data-md${result.to}.json`,
      );
      expect(result.detectedNewSeasonFiles).toContain(`mirrordungeon-egogift-droppool-${result.to}.json`);
    });

    it('leaves the previous season\'s generated output untouched', () => {
      expect(results.full!.previousSeasonUntouched).toBe(true);
    });

    it('lists both seasons and makes the new one the default', () => {
      const result = results.full!;
      expect(result.seasons).toEqual([result.from, result.to]);
      expect(result.defaultSeason).toBe(result.to);
      expect(result.provisional[result.to]).toBe(false);
    });

    it('carries the new packs and their exclusive gifts into the build', () => {
      const built = results.full!.built!;
      expect(built.newPacksPresent).toEqual(results.full!.newPackIds);
      expect(built.newGiftsPresent).toEqual(results.full!.newGiftIds);
      expect(built.observable).toBeGreaterThan(0);
      expect(built.event).toBeGreaterThan(0);
      expect(built.dungeonNameKo).not.toBe('');
    });

    it('produces a season the app can load and plan a route through', () => {
      const result = results.full!;
      const root = resolve(result.sandbox, 'public/data');
      expect(readSeasonIndex(root).default).toBe(result.to);
      const data = loadGameDataFromDisk(root, result.to);
      const indexes = buildIndexes(data);
      const deck = data.identities.slice(0, 12).map((identity) => identity.id);
      const lastFloor = Math.max(...Object.values(data.rules.floors).flat());
      const plan = planRoute(
        { deck, wanted: [], options: { ...defaultOptions(), lastFloor, deployed: deck.slice(0, 6) } },
        data,
        indexes,
      );
      expect(plan.floors.length).toBeGreaterThan(0);
      expect(plan.floors.at(-1)!.floor).toBe(lastFloor);
    });
  });

  describe('derived-only — only the community mirror knows the season', () => {
    it('backfills the new packs from the mirror', () => {
      const result = results['derived-only']!;
      expect(result.built!.newPacksPresent).toEqual(result.newPackIds);
    });

    it('is refused, by name, for the one thing no source can supply', () => {
      const errors = results['derived-only']!.validationErrors.join('\n');
      expect(errors).toMatch(/have no general gift pool/);
      expect(errors).toMatch(/npm run data:import/);
    });

    it('also loses the keyword affinity, which the runbook did not warn about', () => {
      // `derivedPackAsRaw` ships no `desc`, and `affinitiesFromDevName` reads the pack's keyword
      // out of exactly that. A backfilled keyword pack therefore cannot state its affinity. It is
      // an error rather than a silent null, so the season is blocked either way — but the message
      // is one the runbook has to explain, because it appears the moment md8 adds a keyword pack.
      const errors = results['derived-only']!.validationErrors.join('\n');
      expect(errors).toMatch(/keyword pack \d+ \(\) has no keywordAffinity/);
    });

    it('marks the season provisional, so it cannot become the default on its own', () => {
      const result = results['derived-only']!;
      expect(result.provisional[result.from]).toBe(true);
    });
  });

  describe('partial — the drop pool and observation list never arrived', () => {
    it('is refused by name, listing the files that never arrived', () => {
      // The check M46 asked for. Before it, this variant validated clean.
      const errors = results.partial!.validationErrors.join('\n');
      expect(errors).toMatch(/is only half vendored/);
      expect(errors).toMatch(/mirrordungeon-egogift-droppool-\d+\.json/);
      expect(errors).toMatch(/mirror-dungeon-egogift-observation-data-md\d+\.json/);
      expect(errors).toMatch(/MirrorDungeonUI_\d+\.json/);
    });

    it('explains what a season built this way would get wrong', () => {
      // The message has to carry the symptoms, because the build itself shows none: it succeeds,
      // and the damage is only visible as counts nobody looks at.
      const errors = results.partial!.validationErrors.join('\n');
      expect(errors).toMatch(/no gift is classed as `event`/);
      expect(errors).toMatch(/nothing is observable/);
      expect(errors).toMatch(/the dungeon name is empty/);
    });

    it('still builds and would still have become the default — the refusal is the only thing stopping it', () => {
      const result = results.partial!;
      expect(result.steps.find((step) => step.name === 'build')!.ok).toBe(true);
      expect(result.defaultSeason).toBe(result.to);
      expect(result.provisional[result.to]).toBe(false);
    });

    it('ships a season where nothing is observable and nothing is an event gift', () => {
      const built = results.partial!.built!;
      expect(built.gifts).toBeGreaterThan(0);
      expect(built.observable).toBe(0);
      expect(built.event).toBe(0);
    });

    it('ships an empty dungeon name as a warning, not an error', () => {
      const result = results.partial!;
      expect(result.built!.dungeonNameKo).toBe('');
      expect(result.validationWarnings.join('\n')).toMatch(/meta\.dungeon\.name\.ko is empty/);
    });
  });

  describe('the artwork cliff', () => {
    /** A 1x1 PNG. `checkArt` only looks at the extension, but a real file keeps `npm run art` happy. */
    const PNG_1X1 = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
      'base64',
    );

    it('blocks the new season when a drawing belongs to the old one', () => {
      // `public/art` is not season-split, and `checkArt` errors on any file that is not an icon of
      // the season being validated. Today `manifest.json` is empty so nothing can trip it — but the
      // moment the owner draws the first of the 558 planned pieces, a gift that md8 drops takes the
      // season turnover down with it. Proven here rather than discovered later.
      const sandbox = results.full!.sandbox;
      const orphan = 9999999;
      mkdirSync(join(sandbox, 'public/art/gifts'), { recursive: true });
      writeFileSync(join(sandbox, 'public/art/gifts', `${orphan}.png`), PNG_1X1);
      writeFileSync(
        join(sandbox, 'public/art/manifest.json'),
        `${JSON.stringify({ gifts: [orphan], packs: [] }, null, 2)}\n`,
      );

      const validate = validateIn(sandbox);
      const errors = messagesFrom(validate.output, 'error');
      expect(validate.ok).toBe(false);
      expect(errors.join('\n')).toMatch(
        new RegExp(`public/art/gifts/${orphan}\\.png is not a gift icon of this season`),
      );

      // Leave the sandbox as it was, so nothing after this reads a broken one.
      rmSync(join(sandbox, 'public/art/gifts'), { recursive: true, force: true });
      writeFileSync(
        join(sandbox, 'public/art/manifest.json'),
        `${JSON.stringify({ gifts: [], packs: [] }, null, 2)}\n`,
      );
    });
  });

  it('never writes to the working tree', () => {
    // Every sandbox is a temp directory; the rehearsal only ever reads this checkout. If
    // `MD_REPO_ROOT` failed to take effect, the build would have rewritten public/data here and
    // `previousSeasonUntouched` would be measuring the wrong tree — so assert the paths too.
    for (const result of Object.values(results)) {
      expect(result!.sandbox).not.toBe(process.cwd());
      expect(result!.sandbox.startsWith(process.cwd())).toBe(false);
    }
  });
});
