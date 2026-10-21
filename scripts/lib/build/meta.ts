import { join } from 'node:path';
import { readJsonIfExists, repoPath, repoRoot, stableJsonText } from '../io.ts';
import { LOCALIZE_DIR, STATIC_DIR } from '../raw.ts';
import { DERIVED_DIR } from '../derived-source.ts';
import { outRelPath } from '../out.ts';
import { dataVersionOf, jsonPartsUnder } from '../data-version.ts';
import type { Meta } from '../../../src/core/schema.ts';
import type { GiftSet } from './gifts.ts';
import type { IdentitySet } from './identities.ts';
import { CAPTURE_LAYOUT_CURATED, type Sources } from './load.ts';
import type { BuildOutput } from './output.ts';
import type { PackSet } from './packs.ts';
import { loc } from './util.ts';

/**
 * `meta.json` without its `dataVersion`, which `dataVersionFor` fills once every output exists.
 *
 * A season is provisional while a selectable pack came from the fallback: its general gift pool is
 * either missing or the owner's stand-in (`backfillAssumptions`), and a plan built on that may be
 * quietly wrong. The app shows the flag rather than presenting half a season as a whole one.
 */
export function deriveMeta(src: Sources, packSet: PackSet, giftSet: GiftSet, identitySet: IdentitySet): Meta {
  const { dungeonId, hasStatic, lock, curatedSeason, backfilledPacks } = src;

  const backfilledPackIds = new Set(backfilledPacks.map((pack) => pack.id));
  const backfilledSelectable = packSet.selectablePacks.filter((pack) => backfilledPackIds.has(pack.id));
  const provisional = curatedSeason.provisional === true || backfilledSelectable.length > 0;
  if (curatedSeason.backfillAssumptions?.generalPool === 'allGeneral' && backfilledSelectable.length > 0) {
    console.log(
      `  assumed general pool (backfillAssumptions): ${backfilledSelectable.map((pack) => pack.id).join(', ')}`,
    );
  }

  function findDungeonName(lang: 'KR' | 'EN'): string {
    const path = join(LOCALIZE_DIR, lang, `MirrorDungeonUI_${dungeonId}.json`);
    const raw = readJsonIfExists<{ dataList?: { id: string; content?: string }[] }>(path);
    const entry = raw?.dataList?.find((e) => e.id === `mirror_dungeon_progress_text_${dungeonId}`);
    // "이름과 거미의 거울 {0}층" -> "이름과 거미의 거울"
    return (entry?.content ?? '').replace(/\s*\{0\}.*$/, '').trim();
  }

  return {
    // Set once every output exists (`dataVersionFor`): the serialized outputs join the fingerprint (M163).
    dataVersion: '',
    // 2: a keyword condition names a list (`keywords`), says 부여 or 소모 (`verb`), and may
    //    carry `min: null` for a gate that only scales. A season frozen at 1 cannot be reread.
    schemaVersion: 2,
    dungeon: {
      id: dungeonId,
      name: loc(
        // The dungeon's display name lives in the per-season UI strings.
        findDungeonName('KR'),
        findDungeonName('EN'),
      ),
    },
    sources: Object.fromEntries(
      Object.entries(lock.sources).map(([name, s]) => {
        const branches = s.languages && !Array.isArray(s.languages) ? s.languages : null;
        return [
          name,
          {
            repo: s.repo,
            ...(s.sha ? { sha: s.sha } : {}),
            ...(branches
              ? {
                  languages: Object.fromEntries(
                    Object.entries(branches).map(([lang, pin]) => [lang, pin.sha]),
                  ),
                }
              : {}),
            fetchedAt: s.fetchedAt,
          },
        ];
      }),
    ),
    staticDataPresent: hasStatic,
    provisional,
    counts: {
      gifts: giftSet.gifts.length,
      packs: packSet.packs.length,
      identities: identitySet.identities.length,
      fusionRecipes:
        [...giftSet.recipesByResult.values()].reduce((n, list) => n + list.length, 0) +
        giftSet.mixedByResult.size,
    },
  };
}

/**
 * `dataVersion` (M163, `scripts/lib/data-version.ts`): every JSON the build read — the derived
 * mirror backfills identities, packs and gifts, so it is an input like any other — plus the outputs
 * exactly as they are about to be written, so a parser change that moves the data moves the
 * version. `meta.json` itself stays out: it carries the version and the lock's `fetchedAt` stamps.
 */
export function dataVersionFor(out: BuildOutput): string {
  const inputs = jsonPartsUnder([STATIC_DIR, LOCALIZE_DIR, DERIVED_DIR, repoPath('data/curated')], {
    base: repoRoot,
    exclude: [CAPTURE_LAYOUT_CURATED],
  });
  const { dungeonId } = out;
  return dataVersionOf(dungeonId, inputs, [
    { path: outRelPath('rules', dungeonId), text: stableJsonText(out.rules) },
    { path: outRelPath('gifts', dungeonId), text: stableJsonText(out.gifts) },
    { path: outRelPath('packs', dungeonId), text: stableJsonText(out.packs) },
    { path: `public/data/md${dungeonId}/skill-gifts.json`, text: out.skillGiftsText },
    { path: outRelPath('enums', dungeonId), text: stableJsonText(out.enums) },
    { path: outRelPath('identities', dungeonId), text: stableJsonText(out.identities) },
  ]);
}
