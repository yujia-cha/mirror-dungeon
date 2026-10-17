import { describe, expect, it } from 'vitest';
import type { Identity, IdentityKeywordId } from '../../src/core/schema.ts';
import { buffIdsInSkill, selfUseInSkill, skillDiscards, type SkillKeywords } from './derive.ts';
import { buffIdsInText, selfKeywordsInSkillText, skillTextDiscards } from './derive-text.ts';
import {
  defenseTypesOf,
  derivedSkillFacts,
  identitySkillProblems,
  selfFlags,
  slotOfSkill,
  staticSkillFacts,
} from './identity-skills.ts';
import type { LocalizedSkill, RawSkill } from './raw.ts';

const kw = (base: IdentityKeywordId[], special: IdentityKeywordId[] = []): SkillKeywords => ({
  base: new Set(base),
  special: new Set(special),
});

describe('staticSkillFacts', () => {
  it('reads slot, sin, attack type, weight and coins off the skill data', () => {
    // Arrange: an S3 whose uptie-4 entry repeats the coins, as `skillData` deltas do.
    const skill: RawSkill = {
      id: 1011103,
      skillType: 'SKILL',
      skillData: [
        {
          gaksungLevel: 1,
          attributeType: 'SHAMROCK',
          atkType: 'HIT',
          defType: 'ATTACK',
          targetNum: 3,
          coinList: [{ operatorType: 'SUB' }, { operatorType: 'ADD', color: 'GREY' }],
        },
        { gaksungLevel: 2 },
        { gaksungLevel: 4, coinList: [{ operatorType: 'SUB' }, { operatorType: 'ADD', color: 'GREY' }] },
      ],
    };

    // Act
    const facts = staticSkillFacts(skill.id, skill, kw(['Burst']));

    // Assert
    expect(facts).toEqual({
      slot: 3,
      sin: 'GLUTTONY',
      attackType: 'Hit',
      weight: 3,
      coins: { count: 2, plus: true, minus: true, unbreakable: true },
      keywords: { Burst: { base: true, special: false } },
      self: {},
    });
  });

  it('leaves what the static data does not hold as null rather than guessing', () => {
    // Arrange / Act
    const facts = staticSkillFacts(1099901, undefined, undefined);

    // Assert
    expect(facts).toEqual({
      slot: 1,
      sin: null,
      attackType: null,
      weight: null,
      coins: null,
      keywords: {},
      self: {},
    });
  });

  it('refuses a base skill that is not S1~S3 by its suffix', () => {
    expect(() => staticSkillFacts(1010104, undefined, undefined)).toThrow(/suffix/);
  });

  it('flags a keyword used both plainly and as its 특수 variant on the same skill', () => {
    // Arrange / Act
    const facts = staticSkillFacts(1101602, { id: 1101602, skillData: [{}] }, kw(['Charge'], ['Charge']));

    // Assert
    expect(facts.keywords).toEqual({ Charge: { base: true, special: true } });
  });
});

describe('slotOfSkill', () => {
  it('maps suffix 01–03 to S1~S3 and nothing else', () => {
    expect([1010101, 1010102, 1010103, 1010104, 1021205].map(slotOfSkill)).toEqual([1, 2, 3, null, null]);
  });
});

describe('defenseTypesOf', () => {
  it('maps GUARD/EVADE/COUNTER, sorted and unique, and reports what it cannot map', () => {
    // Arrange / Act
    const result = defenseTypesOf(['GUARD', 'COUNTER', undefined, 'GUARD', 'ATTACK']);

    // Assert
    expect(result).toEqual({ types: ['counter', 'guard'], unknown: ['ATTACK'] });
  });
});

describe('derivedSkillFacts', () => {
  it('builds the base skills of a mirror-only identity, unknown weight and coins as null', () => {
    // Arrange: the mirror lists an enhanced skill (num 0) next to the base three.
    const entry = {
      skillTypes: [
        { id: '1101603', num: 1, type: { affinity: 'lust', type: 'pierce' } },
        { id: '1101601', num: 3, type: { affinity: 'gluttony', type: 'pierce' } },
        { id: '1101605', num: 0, type: { affinity: 'pride', type: 'pierce' } },
        { id: '1101602', num: 2, type: { affinity: 'wrath', type: 'blunt' } },
      ],
    };
    const texts = new Map([[1101603, kw(['Laceration'])]]);

    // Act
    const skills = derivedSkillFacts(entry, texts);

    // Assert
    expect(skills.map((s) => [s.slot, s.sin, s.attackType, s.weight, s.coins])).toEqual([
      [1, 'GLUTTONY', 'Penetrate', null, null],
      [2, 'WRATH', 'Hit', null, null],
      [3, 'LUST', 'Penetrate', null, null],
    ]);
    expect(skills[2]!.keywords).toEqual({ Laceration: { base: true, special: false } });
  });
});

describe('identitySkillProblems', () => {
  const identity = (over: Partial<Identity>): Identity => ({
    id: 10101,
    sinnerId: 1,
    sinner: { ko: '이상', en: 'Yi Sang' },
    title: { ko: '', en: '' },
    rank: 1,
    season: 0,
    factions: [],
    traits: [],
    keywords: { Sinking: { skills: 2, specialSkills: 0 } },
    keywordSource: 'derived',
    sins: ['GLOOM', 'ENVY'],
    attackTypes: ['Slash'],
    skills: [
      {
        slot: 1,
        sin: 'GLOOM',
        attackType: 'Slash',
        weight: 1,
        coins: null,
        keywords: { Sinking: { base: true, special: false } },
      },
      {
        slot: 2,
        sin: 'ENVY',
        attackType: 'Slash',
        weight: 1,
        coins: null,
        keywords: { Sinking: { base: true, special: false } },
      },
    ],
    ...over,
  });

  it('accepts skills that add up to the keyword counts', () => {
    expect(identitySkillProblems(identity({}))).toEqual([]);
  });

  it('reports a keyword whose per-skill flags do not add up to its count', () => {
    // Arrange
    const wrong = identity({ keywords: { Sinking: { skills: 3, specialSkills: 0 } } });

    // Act
    const problems = identitySkillProblems(wrong);

    // Assert
    expect(problems).toEqual(['Sinking: skills say 2 base / 0 special, keywords say 3 / 0']);
  });

  it('reports skill sins that are not the identity sins', () => {
    expect(identitySkillProblems(identity({ sins: ['GLOOM'] }))[0]).toMatch(/sins/);
  });

  it('leaves the hand-written keywords of a curated identity alone', () => {
    const curated = identity({ keywordSource: 'curated', keywords: {} });
    expect(identitySkillProblems(curated)).toEqual([]);
  });
});

describe('buffIdsInSkill', () => {
  it('collects every buff the scripts give or spend, but not a condition', () => {
    // Arrange: 진동 - 작열 is given by `SwitchVibrationOnSucceedAttack` with no target at all.
    const skill = {
      id: 1021603,
      skillData: [
        {
          coinList: [
            {
              abilityScriptList: [
                {
                  scriptName: 'SwitchVibrationOnSucceedAttack',
                  buffData: { buffKeyword: 'VibrationIgnition' },
                },
                { scriptName: 'UseBullet[necessary:BulletGodok:1]', buffData: { buffKeyword: '' } },
                {
                  scriptName: 'GiveBuffIfHas',
                  conditionBuffData: { buffKeyword: 'Breath' },
                  resultBuffData: { buffKeyword: 'Burst', target: 'Target' },
                },
              ],
            },
          ],
        },
      ],
    } as unknown as RawSkill;

    // Act
    const buffs = buffIdsInSkill(skill, new Map());

    // Assert
    expect([...buffs].sort()).toEqual(['BulletGodok', 'Burst', 'VibrationIgnition']);
  });
});

describe('buffIdsInText', () => {
  const known = new Set([
    'LegStrength',
    'EnhanceZilu',
    'VibrationIgnition',
    'WhenUse',
    'Burst',
    'BurstVulnerableZilu',
  ]);

  it('reads the buffs a sentence grants, not the ones it checks or the timing tag before them', () => {
    // Arrange
    const text =
      '[WhenUse] [LegStrength] 3 얻음\n' +
      '- 자신이 발동시켰으면, [EnhanceZilu] 추가로 1 얻음\n' +
      '[OnSucceedAttack] 대상에게 [VibrationIgnition]이 10 이상 있으면, [Burst] 횟수 2 증가\n' +
      '[BurstZilu]의 수치가 0이 되어 소멸시, [BurstVulnerableZilu]이 부여됨\n' +
      '[Unnamed] 2 부여';

    // Act
    const buffs = buffIdsInText(text, known);

    // Assert
    expect([...buffs].sort()).toEqual(['Burst', 'BurstVulnerableZilu', 'EnhanceZilu', 'LegStrength']);
  });
});

/** A raw skill holding one coin with the given scripts — the shape `abilityScriptList` has. */
const scripted = (
  id: number,
  scripts: { scriptName: string; buffData?: Record<string, unknown> }[],
): RawSkill => ({
  id,
  skillType: 'SKILL',
  skillData: [{ gaksungLevel: 1, coinList: [{ abilityScriptList: scripts }] }],
});
const sentence = (id: number, ...lines: string[]): LocalizedSkill => ({
  id,
  levelList: [{ level: 1, desc: lines.join('\n') }],
});

describe('selfUseInSkill (skills[].self, M129)', () => {
  it('reads a 디버프 given to the user and the user’s own stack spent (1030903, 10207)', () => {
    // Arrange — script names and buffData verbatim from the static data.
    const skill = scripted(1020702, [
      { scriptName: 'GiveBuffOnUse', buffData: { buffKeyword: 'Vibration', target: 'Self', buffOwner: '' } },
      {
        scriptName: 'TagetNumAdderOnCompleteCommandUsingBuffTurn1',
        buffData: { buffKeyword: 'Vibration', buffOwner: 'Self' },
      },
      {
        scriptName: 'GiveBuffOnSucceedAttack',
        buffData: { buffKeyword: 'Vibration', target: 'Target', buffOwner: '' },
      },
    ]);
    // Act
    const use = selfUseInSkill(skill);
    // Assert
    expect(Object.fromEntries(use)).toEqual({ Vibration: { gain: true, consume: true } });
  });

  it('takes the spent buff from a script suffix, not the buff the script gives (11211, 10807)', () => {
    const fuel = scripted(1121101, [
      {
        scriptName: 'GiveBuffOnSuccessAttackUsingBuffStack_FirePunchFuel15',
        buffData: { buffKeyword: 'Combustion', target: 'Target', buffOwner: 'Self' },
      },
    ]);
    const vibration = scripted(1080703, [
      {
        scriptName: 'GiveBuffOnSuccessAttackUsingBuffTurn_Vibration5',
        buffData: { buffKeyword: 'Vulnerable', target: 'Target', buffOwner: 'Self' },
      },
    ]);
    expect(Object.fromEntries(selfUseInSkill(fuel))).toEqual({});
    expect(Object.fromEntries(selfUseInSkill(vibration))).toEqual({
      Vibration: { gain: false, consume: true },
    });
  });

  it('ignores a check on the user’s own stack and a 디버프 on the target', () => {
    const skill = scripted(1040902, [
      {
        scriptName: 'CoinScaleAdderViaBuffCheck',
        buffData: { buffKeyword: 'Vibration', target: 'Self', buffOwner: 'Self' },
      },
      { scriptName: 'GiveBuffOnSucceedAttack', buffData: { buffKeyword: 'Combustion', target: 'Target' } },
    ]);
    expect(Object.fromEntries(selfUseInSkill(skill))).toEqual({});
  });
});

describe('selfKeywordsInSkillText (skills[].self, M129)', () => {
  it('reads a gain, a spend, and a spend whose 「자신의」 came earlier on the line (verbatim KR)', () => {
    expect(
      Object.fromEntries(
        selfKeywordsInSkillText(
          sentence(1071401, '[StartDuel] 대상과 자신에게 [Combustion] 1 부여, [Combustion] 횟수 1 증가'),
        ),
      ),
    ).toEqual({ Combustion: { gain: true, consume: false } });
    expect(
      Object.fromEntries(
        selfKeywordsInSkillText(
          sentence(
            1100703,
            '[OnSucceedAttack] 자신의 진동 횟수가 10 이상이면, 진동 횟수를 전부 소모하여 대상에게 동일한 값의 진동 횟수 부여',
          ),
        ),
      ),
    ).toEqual({ Vibration: { gain: false, consume: true } });
  });

  it('the first verb decides, and the target’s stack or a check is neither (1101003, 1030902, 9164-like)', () => {
    expect(
      Object.fromEntries(
        selfKeywordsInSkillText(
          sentence(
            1101003,
            '[OnSucceedAttack] 자신의 [Vibration] 횟수를 최대 8 소모하여, 소모한 값만큼 대상의 [Vibration] 횟수 증가',
          ),
        ),
      ),
    ).toEqual({ Vibration: { gain: false, consume: true } });
    expect(
      Object.fromEntries(
        selfKeywordsInSkillText(sentence(1030902, '[OnSucceedAttack] 대상의 [Vibration]을 최대 3 소모')),
      ),
    ).toEqual({});
    expect(
      Object.fromEntries(
        selfKeywordsInSkillText(sentence(1, '[WhenUse] 자신의 [Combustion]이 10 이상이면, 피해량 +10%')),
      ),
    ).toEqual({});
  });
});

describe('selfFlags', () => {
  it('joins the readings per keyword in STATUS_KEYWORDS order, only keywords with something true', () => {
    const scripts = new Map([['Vibration' as const, { gain: true, consume: false }]]);
    const text = new Map([
      ['Vibration' as const, { gain: false, consume: true }],
      ['Combustion' as const, { gain: false, consume: false }],
    ]);
    expect(selfFlags(scripts, text, undefined)).toEqual({ Vibration: { gain: true, consume: true } });
  });
});

describe('skillDiscards / skillTextDiscards (버림 → buffs Discard, M129)', () => {
  it('a script whose name starts with Discard discards; reacting to being discarded does not', () => {
    expect(skillDiscards(scripted(1081301, [{ scriptName: 'Discard10813' }]))).toBe(true);
    expect(skillDiscards(scripted(1110503, [{ scriptName: 'DiscardAllSkillsDescendingOnUse' }]))).toBe(true);
    expect(
      skillDiscards(
        scripted(1010501, [
          { scriptName: 'GiveBuffOnDiscarded', buffData: { buffKeyword: 'Vibration', target: 'Self' } },
        ]),
      ),
    ).toBe(false);
    expect(
      skillDiscards(
        scripted(1010803, [{ scriptName: 'AddShieldOnDiscardedByHpRatioViaBuffCheckDeivdeByStack' }]),
      ),
    ).toBe(false);
  });

  it('reads 「… 스킬 1개를 버림」 and 「다르면 [Discard]」, not rounding or another identity’s skill (verbatim KR)', () => {
    expect(
      skillTextDiscards(
        sentence(1060801, '[WhenUse] 자신의 모든 스킬 슬롯에서 등급이 가장 높은 스킬 1개를 버림'),
      ),
    ).toBe(true);
    expect(
      skillTextDiscards(
        sentence(1081301, '[WhenUse] 이 스킬 슬롯의 장착하지 않은 스킬이 이 스킬과 다르면 [Discard]'),
      ),
    ).toBe(true);
    expect(
      skillTextDiscards(
        sentence(
          1071502,
          '[StartBattle] (가장 높은 공명 수 / 2)만큼 이 스킬의 공격 레벨이 증가 (최대 3, 소수점 버림)',
        ),
      ),
    ).toBe(false);
    expect(
      skillTextDiscards(
        sentence(
          1051002,
          '[StartBattle] 무작위 아군 하나와 자신에게 [KnowledgeExplored]만큼 [KnowledgeTraining] 부여 ([Discard]을 사용하는 아군 중 [KnowledgeTraining]이 낮은 아군에게 우선 적용)',
        ),
      ),
    ).toBe(false);
  });
});
