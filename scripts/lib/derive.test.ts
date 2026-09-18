import { describe, expect, it } from 'vitest';
import {
  affinitiesFromDevName,
  availabilityFor,
  cleanFactionName,
  deriveIdentityKeywords,
  deriveUpgradeOf,
  groupForPackId,
  sinnerIdFromIdentityId,
  tierFromTags,
} from './derive.ts';
import type { IdentityKeywordId, StatusKeyword } from '../../src/core/schema.ts';
import type { RawSkill } from './raw.ts';

describe('availabilityFor', () => {
  it('shifts 0-indexed selectableFloors to 1-based floors per mode', () => {
    expect(
      availabilityFor({
        id: 1003,
        exceptionConditions: [
          { dungeonIdx: 0, selectableFloors: [0, 1] },
          { dungeonIdx: 1, selectableFloors: [0] },
        ],
      }),
    ).toEqual({ normal: [1, 2], hard: [1], parallel: [], extreme: [] });
  });

  it('expands a parallel entry with no floor list to the whole 6-10 range', () => {
    expect(
      availabilityFor({
        id: 1012,
        exceptionConditions: [{ dungeonIdx: 1, selectableFloors: [3, 4] }, { dungeonIdx: 2 }],
      }),
    ).toEqual({ normal: [], hard: [4, 5], parallel: [6, 7, 8, 9, 10], extreme: [] });
  });

  it('expands an extreme entry to floors 11-15', () => {
    expect(availabilityFor({ id: 1501, exceptionConditions: [{ dungeonIdx: 3 }] })).toEqual({
      normal: [],
      hard: [],
      parallel: [],
      extreme: [11, 12, 13, 14, 15],
    });
  });

  it('returns empty lists for a pack with no conditions, so it reads as unselectable', () => {
    expect(availabilityFor({ id: 1122, exceptionConditions: [] })).toEqual({
      normal: [],
      hard: [],
      parallel: [],
      extreme: [],
    });
  });

  it('ignores an unknown dungeonIdx rather than guessing a mode', () => {
    expect(
      availabilityFor({ id: 9999, exceptionConditions: [{ dungeonIdx: 9, selectableFloors: [0] }] }),
    ).toEqual({
      normal: [],
      hard: [],
      parallel: [],
      extreme: [],
    });
  });
});

describe('groupForPackId', () => {
  it.each([
    [1001, 'chapter'],
    [1027, 'chapter'],
    [1101, 'event'],
    [1206, 'attackType'],
    [1321, 'sin'],
    [1401, 'keyword'],
    [1520, 'longBattle'],
    [3001, 'hidden'],
  ])('maps %i to %s', (id, group) => {
    expect(groupForPackId(id)).toBe(group);
  });
});

describe('affinitiesFromDevName', () => {
  it('reads the keyword out of a keyword pack dev name', () => {
    expect(affinitiesFromDevName('화상-2').keyword).toBe('Combustion');
    expect(affinitiesFromDevName('침잠-1').keyword).toBe('Sinking');
  });

  it('reads the sin out of both the plain and 약점 forms', () => {
    expect(affinitiesFromDevName('분노-1').sin).toBe('WRATH');
    expect(affinitiesFromDevName('질투약점-1').sin).toBe('ENVY');
  });

  it('reads the attack type', () => {
    expect(affinitiesFromDevName('참격-1').attackType).toBe('Slash');
    expect(affinitiesFromDevName('타격약점-1').attackType).toBe('Hit');
  });

  it('returns nulls for a chapter pack name', () => {
    expect(affinitiesFromDevName('잊혀진 자들')).toEqual({ keyword: null, sin: null, attackType: null });
  });
});

describe('tierFromTags', () => {
  it('reads the tier number', () => {
    expect(tierFromTags(['TIER_2'])).toBe(2);
    expect(tierFromTags(['TIER_4', 'NO_SALE'])).toBe(4);
  });

  it('treats EXTRA_TIER3 as tier 3', () => {
    expect(tierFromTags(['EXTRA_TIER3'])).toBe(3);
  });

  it('prefers TIER_EX when present', () => {
    expect(tierFromTags(['TIER_5', 'TIER_EX'])).toBe('EX');
  });

  it('returns null when no tier tag is present', () => {
    expect(tierFromTags(['HARDSHIP'])).toBeNull();
    expect(tierFromTags([])).toBeNull();
  });
});

describe('sinnerIdFromIdentityId', () => {
  it('extracts the sinner number from a 1SSNN id', () => {
    expect(sinnerIdFromIdentityId(10101)).toBe(1);
    expect(sinnerIdFromIdentityId(11216)).toBe(12);
    expect(sinnerIdFromIdentityId(10914)).toBe(9);
  });
});

describe('deriveIdentityKeywords', () => {
  const skill = (id: number, keywords: string[]): RawSkill => ({
    id,
    skillType: 'SKILL',
    skillData: [
      {
        coinList: keywords.map((buffKeyword) => ({
          abilityScriptList: [{ scriptName: 'GiveBuffOnSucceedAttack', buffData: { buffKeyword } }],
        })),
      },
    ],
  });

  it('counts the attack skills that inflict each keyword, not the skill copies', () => {
    const skills = new Map<number, RawSkill>([
      [1, skill(1, ['Sinking'])],
      [2, skill(2, ['Sinking', 'Charge'])],
      [3, skill(3, [])],
    ]);
    expect(
      deriveIdentityKeywords(
        {
          id: 10101,
          attributeList: [
            { skillId: 1, number: 3 },
            { skillId: 2, number: 2 },
            { skillId: 3, number: 1 },
          ],
        },
        skills,
      ),
    ).toEqual({
      Sinking: { skills: 2, specialSkills: 0 },
      Charge: { skills: 1, specialSkills: 0 },
    });
  });

  it('ignores non-status buffs', () => {
    const skills = new Map<number, RawSkill>([[1, skill(1, ['AttackUp', 'Protection'])]]);
    expect(deriveIdentityKeywords({ id: 10101, attributeList: [{ skillId: 1, number: 3 }] }, skills)).toEqual(
      {},
    );
  });

  it('skips skills that are not plain attack skills', () => {
    const defensive: RawSkill = { ...skill(1, ['Sinking']), skillType: 'DEFENSE' };
    expect(
      deriveIdentityKeywords(
        { id: 10101, attributeList: [{ skillId: 1, number: 3 }] },
        new Map([[1, defensive]]),
      ),
    ).toEqual({});
  });

  it('counts a 특수 variant separately, whether it is a buffKeyword or only a script name', () => {
    const variants = new Map<string, StatusKeyword>([
      ['ChargeBodyArt', 'Charge'],
      ['NailPersonality', 'Laceration'],
    ]);
    const bodyArt: RawSkill = {
      id: 1,
      skillType: 'SKILL',
      skillData: [{ coinList: [{ abilityScriptList: [{ scriptName: 'MarkGiveChargeBodyArtTurn' }] }] }],
    };
    const skills = new Map<number, RawSkill>([
      [1, bodyArt],
      [2, skill(2, ['Charge', 'NailPersonality'])],
      [3, skill(3, ['Laceration'])],
    ]);
    const attributeList = [1, 2, 3].map((skillId) => ({ skillId, number: 1 }));
    expect(deriveIdentityKeywords({ id: 10215, attributeList }, skills, variants)).toEqual({
      Laceration: { skills: 1, specialSkills: 1 },
      Charge: { skills: 1, specialSkills: 1 },
    });
    // Without the variant table the special buffs are invisible, as before.
    expect(deriveIdentityKeywords({ id: 10215, attributeList }, skills)).toEqual({
      Laceration: { skills: 1, specialSkills: 0 },
      Charge: { skills: 1, specialSkills: 0 },
    });
  });

  it('reads 탄환 off the skill requirement tokens, not from a buffKeyword', () => {
    const variants = new Map<string, IdentityKeywordId>([['BulletGodok', 'Bullet']]);
    const script = (id: number, scriptName: string): RawSkill => ({
      id,
      skillType: 'SKILL',
      skillData: [{ coinList: [{ abilityScriptList: [{ scriptName }] }] }],
    });
    const skills = new Map<number, RawSkill>([
      [1, script(1, 'UseBullet[necessary:Bullet:1]')],
      [2, script(2, 'UseBullet[necessary:BulletGodok:1]')],
      // An ammo the game never localizes is still ammo, just not a 특수 one.
      [3, script(3, 'DmgUpByBullet1091607_50[optional:AccelBullet:1]')],
      // A requirement that is not ammo, and a bare mention with no requirement, both count for nothing.
      [4, script(4, 'GiveBuffOnSucceedAttack[necessary:Sinking:1]')],
      [5, script(5, 'FullStopHongluAttackDmgUpByRatioUseOneBullet')],
    ]);
    const of = (skillIds: number[]) =>
      deriveIdentityKeywords(
        { id: 10611, attributeList: skillIds.map((skillId) => ({ skillId, number: 1 })) },
        skills,
        variants,
      );
    expect(of([1, 3])).toEqual({ Bullet: { skills: 2, specialSkills: 0 } });
    expect(of([2])).toEqual({ Bullet: { skills: 0, specialSkills: 1 } });
    expect(of([1, 2])).toEqual({ Bullet: { skills: 1, specialSkills: 1 } });
    expect(of([4, 5])).toEqual({});
  });

  it('returns an empty map when the skill data is missing', () => {
    expect(
      deriveIdentityKeywords({ id: 10101, attributeList: [{ skillId: 99, number: 3 }] }, new Map()),
    ).toEqual({});
  });
});

describe('cleanFactionName', () => {
  it('strips markup and flags struck-through names as deprecated', () => {
    expect(cleanFactionName('<color=#d40000><s>가씨 가문</s></color>')).toEqual({
      name: '가씨 가문',
      deprecated: true,
    });
    expect(cleanFactionName('검계')).toEqual({ name: '검계', deprecated: false });
  });
});

describe('deriveUpgradeOf', () => {
  const gifts = new Map<number, { keyword: string; tier: 1 | 2 | 3 | 4 | 5 | 'EX' | null }>([
    [9088, { keyword: 'Combustion', tier: 4 }],
    [9157, { keyword: 'Combustion', tier: 3 }],
    [9003, { keyword: 'Combustion', tier: 1 }],
    [9101, { keyword: 'Combustion', tier: 1 }],
    [9155, { keyword: 'Combustion', tier: 2 }],
    [9090, { keyword: 'Laceration', tier: 4 }],
    [9089, { keyword: 'Laceration', tier: 1 }],
    [9999, { keyword: 'None', tier: 1 }],
    [9998, { keyword: 'Combustion', tier: 'EX' }],
  ]);

  it('points a same-keyword, lower-tier ingredient at its single result', () => {
    const recipes = new Map([
      [9088, [[9003, 9157], [9003, 9101, 9155]]],
      [9157, [[9101, 9155]]],
    ]);
    const out = deriveUpgradeOf(recipes, gifts);
    expect(out.get(9157)).toBe(9088);
    expect(out.get(9003)).toBe(9088);
  });

  it('leaves out an ingredient that feeds more than one result', () => {
    const recipes = new Map([
      [9088, [[9003, 9157]]],
      [9157, [[9101, 9155]]],
      [9090, [[9089, 9101]]],
    ]);
    const out = deriveUpgradeOf(recipes, gifts);
    // 9101 is in both 9157's and 9090's recipes.
    expect(out.has(9101)).toBe(false);
    expect(out.get(9155)).toBe(9157);
    expect(out.get(9089)).toBe(9090);
  });

  it('ignores keyword mismatches, the None keyword and equal or higher tiers', () => {
    const recipes = new Map([
      [9088, [[9999, 9089, 9998]]],
    ]);
    const out = deriveUpgradeOf(recipes, gifts);
    expect(out.size).toBe(0);
  });

  it('ranks EX above tier 5', () => {
    const recipes = new Map([[9998, [[9088]]]]);
    expect(deriveUpgradeOf(recipes, gifts).get(9088)).toBe(9998);
  });
});
