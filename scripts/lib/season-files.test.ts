import { describe, expect, it } from 'vitest';
import { familyOf, newestSeason, nextSeasonFileNames, renameToSeason, seasonOf } from './season-files.ts';

/** The season-bearing entries of `data/sources.lock.json`, verbatim. */
const LOCK_MD7 = [
  'mirror-dungeon-common-data/mirror-dungeon-common-data-md7.json',
  'mirrordungeon-egogift-droppool/mirrordungeon-egogift-droppool-7.json',
  'mirror-dungeon-egogift-observation-data/mirror-dungeon-egogift-observation-data-md7.json',
  'mirrordungeon/mirrordungeon-07.json',
  'mirrordungeon/mirrordungeon-07-hard.json',
  'mirrordungeon/mirrordungeon-07-infinite.json',
  'mirrordungeon/mirrordungeon-07-extreme.json',
  'mirrordungeon-start-buffs/mirrordungeon-start-buffs-07.json',
  'battle-mirrordungeon/mirrordungeon-abbattle7-extreme.json',
  'battle-mirrordungeon/mirrordungeon-battle7-extreme.json',
  'battle-mirrordungeon/mirrordungeon-abbattle7-hidden.json',
  'ego-gift-mirrordungeon/ego-gift-mirrordungeon7.json',
  'ego-gift-mirrordungeon/ego-gift-mirrordungeon7-hb.json',
  'ego-gift-mirrordungeon/hidden-ego-gift-mirrordungeon-md7-extreme.json',
  'EGOgift_MirrorDungeon_7.json',
  'BattleKeywords_Mirror7.json',
  'DungeonStartBuffs_MD7.json',
  'MirrorDungeonUI_7.json',
];

/**
 * Names in the lock that look season-like but are not. A rule loose enough to read
 * `mirrordungeon7` as a season reads these wrong, which is why every family is spelled out.
 */
const NOT_SEASONS = [
  'mirrordungeon-theme-floor/mirrordungeon-theme-floor-t6.json', // pack tier
  'ego-gift-mirrordungeon/ego-gift-mirrordungeon5_2.json', // season 5's second file
  'ego-gift-mirrordungeon/ego-gift-mirrordungeon-extreme.json',
  'ego-gift-mirrordungeon/ego-gift-story-7-5-1.json', // a story chapter
  'ego-gift-mirrordungeon/ego-gift-walpu8.json', // Walpurgis, not Mirror Dungeon
  'EGOgift_MirrorDungeon-StoryTheme_2.json',
  'EGOgift_MirrorDungeon-EventTheme_2.json',
  'MirrorDungeonTheme-1.json',
  'personality/personality-07.json',
  'Skills_personality-01.json',
];

describe('seasonOf', () => {
  it('reads the season off every season-bearing family in the lock', () => {
    for (const file of LOCK_MD7) expect([file, seasonOf(file)]).toEqual([file, 7]);
  });

  it('reads no season from names whose number means something else', () => {
    for (const file of NOT_SEASONS) expect([file, seasonOf(file)]).toEqual([file, null]);
  });

  it('reads two-digit seasons', () => {
    expect(seasonOf('mirror-dungeon-common-data/mirror-dungeon-common-data-md10.json')).toBe(10);
    expect(seasonOf('mirrordungeon/mirrordungeon-10-hard.json')).toBe(10);
  });
});

describe('renameToSeason', () => {
  it('keeps the directory, the family and the digit width', () => {
    expect(renameToSeason('mirrordungeon/mirrordungeon-07-hard.json', 8)).toBe(
      'mirrordungeon/mirrordungeon-08-hard.json',
    );
    expect(renameToSeason('mirrordungeon-egogift-droppool/mirrordungeon-egogift-droppool-7.json', 8)).toBe(
      'mirrordungeon-egogift-droppool/mirrordungeon-egogift-droppool-8.json',
    );
    expect(renameToSeason('BattleKeywords_Mirror7.json', 8)).toBe('BattleKeywords_Mirror8.json');
    expect(renameToSeason('DungeonStartBuffs_MD7.json', 8)).toBe('DungeonStartBuffs_MD8.json');
  });

  it('widens past the padding when the season needs the digits', () => {
    expect(renameToSeason('mirrordungeon/mirrordungeon-07.json', 10)).toBe(
      'mirrordungeon/mirrordungeon-10.json',
    );
  });

  it('returns null for a name that carries no season', () => {
    for (const file of NOT_SEASONS) expect(renameToSeason(file, 8)).toBeNull();
  });
});

describe('nextSeasonFileNames', () => {
  it('names md8 for every md7 family, and removes nothing', () => {
    const { added, kept, families } = nextSeasonFileNames(LOCK_MD7, 7, 8);
    expect(added).toEqual([
      'mirror-dungeon-common-data/mirror-dungeon-common-data-md8.json',
      'mirrordungeon-egogift-droppool/mirrordungeon-egogift-droppool-8.json',
      'mirror-dungeon-egogift-observation-data/mirror-dungeon-egogift-observation-data-md8.json',
      'mirrordungeon/mirrordungeon-08.json',
      'mirrordungeon/mirrordungeon-08-hard.json',
      'mirrordungeon/mirrordungeon-08-infinite.json',
      'mirrordungeon/mirrordungeon-08-extreme.json',
      'mirrordungeon-start-buffs/mirrordungeon-start-buffs-08.json',
      'battle-mirrordungeon/mirrordungeon-abbattle8-extreme.json',
      'battle-mirrordungeon/mirrordungeon-battle8-extreme.json',
      'battle-mirrordungeon/mirrordungeon-abbattle8-hidden.json',
      'ego-gift-mirrordungeon/ego-gift-mirrordungeon8.json',
      'ego-gift-mirrordungeon/ego-gift-mirrordungeon8-hb.json',
      'ego-gift-mirrordungeon/hidden-ego-gift-mirrordungeon-md8-extreme.json',
      'EGOgift_MirrorDungeon_8.json',
      'BattleKeywords_Mirror8.json',
      'DungeonStartBuffs_MD8.json',
      'MirrorDungeonUI_8.json',
    ]);
    expect(kept).toEqual([]);
    expect(families).toEqual([
      'battle',
      'common-data',
      'droppool',
      'dungeon',
      'ego-gift',
      'hidden-ego-gift',
      'localize-battle-keywords',
      'localize-gift-text',
      'localize-start-buffs',
      'localize-ui',
      'observation',
      'start-buffs',
    ]);
  });

  it('is idempotent — a second pass adds nothing', () => {
    const first = nextSeasonFileNames(LOCK_MD7, 7, 8);
    const second = nextSeasonFileNames([...LOCK_MD7, ...first.added], 7, 8);
    expect(second.added).toEqual([]);
    expect(second.kept).toEqual(first.added);
  });

  it('leaves names that carry no season alone', () => {
    const { added } = nextSeasonFileNames(NOT_SEASONS, 7, 8);
    expect(added).toEqual([]);
  });

  it('does not touch older seasons that stay listed', () => {
    const withOlder = [...LOCK_MD7, 'EGOgift_MirrorDungeon_6.json', 'BattleKeywords_Mirror6.json'];
    const { added } = nextSeasonFileNames(withOlder, 7, 8);
    expect(added).not.toContain('EGOgift_MirrorDungeon_7.json');
    expect(added.filter((f) => f.includes('_6') || f.includes('Mirror6'))).toEqual([]);
  });
});

describe('newestSeason / familyOf', () => {
  it('finds the newest season a list names', () => {
    expect(newestSeason([...LOCK_MD7, 'EGOgift_MirrorDungeon_6.json'])).toBe(7);
    expect(newestSeason(NOT_SEASONS)).toBeNull();
  });

  it('names the family a path belongs to', () => {
    expect(familyOf('mirrordungeon/mirrordungeon-07-extreme.json')).toBe('dungeon');
    expect(familyOf('MirrorDungeonUI_7.json')).toBe('localize-ui');
    expect(familyOf('MirrorDungeonTheme-1.json')).toBeNull();
  });
});
