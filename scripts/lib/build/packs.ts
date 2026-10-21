import { affinitiesFromDevName, availabilityFor, groupForPackId } from '../derive.ts';
import type { ThemePack } from '../../../src/core/schema.ts';
import type { Sources } from './load.ts';
import { applyNameOverride, loc, sortNums } from './util.ts';

export interface PackSet {
  packs: ThemePack[];
  selectablePacks: ThemePack[];
}

export function derivePacks(src: Sources): PackSet {
  const { curated, rawPacks, themeNameKo, themeNameEn, derivedPackName } = src;

  const packs: ThemePack[] = rawPacks
    .map((raw): ThemePack => {
      const devName = (raw.desc ?? '').trim();
      const availability = availabilityFor(raw);
      const exclusives = sortNums(raw.specificEgoGiftPool ?? []);
      const affinity = affinitiesFromDevName(devName);
      const group = groupForPackId(raw.id);
      const notes = curated.notes.packs?.[String(raw.id)];
      return {
        id: raw.id,
        // A pack the static data has not shipped may also be missing from the localization for a few
        // days after a patch; the derived source's English name keeps it from being nameless.
        name: applyNameOverride(
          loc(
            themeNameKo.get(raw.id) ?? derivedPackName(raw.id) ?? devName,
            themeNameEn.get(raw.id) ?? derivedPackName(raw.id) ?? devName,
          ),
          curated.names.packs?.[String(raw.id)],
        ),
        devName,
        group,
        availability,
        selectable: Object.values(availability).some((floors) => floors.length > 0),
        // The in-game pool is the union: `specificEgoGiftPool` entries are not repeated in `egoGiftPool`.
        giftPool: sortNums([...(raw.egoGiftPool ?? []), ...exclusives]),
        exclusiveGifts: exclusives,
        keywordAffinity: group === 'keyword' ? affinity.keyword : null,
        sinAffinity: group === 'sin' ? affinity.sin : null,
        attackTypeAffinity: group === 'attackType' ? affinity.attackType : null,
        bossIds: sortNums(raw.mapGenOption?.bossPool ?? []),
        sprite: raw.uiConfigs?.packSpriteId ?? String(raw.id),
        ...(notes ? { notes } : {}),
      };
    })
    .sort((a, b) => a.id - b.id);

  return { packs, selectablePacks: packs.filter((p) => p.selectable) };
}
