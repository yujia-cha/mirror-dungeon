/**
 * Reading a deck back against the gifts whose effects key off a SKILL, rather than an identity.
 *
 * The fixtures are hand-built rather than drawn from the live data: what is under test is the
 * matching rule, and a season patch must not be able to make it pass or fail.
 */
import { describe, expect, it } from 'vitest';
import { loadGameDataFromDisk } from '../data/node.ts';
import { buildIndexes, matchSkillTriggers, skillsOf, triggerMatches } from '../index.ts';
import type { Gift, Identity, SkillTrigger } from '../schema.ts';
import type { GameIndexes } from '../types.ts';
import type { SkillRef } from '../skills.ts';

const live = loadGameDataFromDisk();
const liveIndexes = buildIndexes(live);

function identity(id: number, skills: Identity['skills']): Identity {
  return {
    id,
    sinnerId: Math.floor(id / 100) % 100,
    sinner: { ko: '테스트', en: 'Test' },
    title: { ko: '테스트 인격', en: 'Test identity' },
    rank: 1,
    season: 0,
    factions: [],
    traits: [],
    keywords: {},
    keywordSource: 'none',
    sins: [...new Set(skills.map((s) => s.sin).filter((s) => s !== null))],
    attackTypes: [...new Set(skills.map((s) => s.attackType).filter((s) => s !== null))],
    skills,
  };
}

/** A trigger with only the axes a test cares about; the rest stay at their "asks nothing" value. */
function trigger(partial: Partial<SkillTrigger>): SkillTrigger {
  return {
    sin: null,
    attackType: null,
    keywords: [],
    verb: 'inflict',
    includesSpecial: false,
    subject: 'skill',
    slots: [],
    effect: 'gate',
    ...partial,
  };
}

/** A skill row; `keywords` defaults to none, which is what most of these fixtures want. */
function skillRow(
  partial: Partial<Identity['skills'][number]> & { slot: 1 | 2 | 3 },
): Identity['skills'][number] {
  return { sin: null, attackType: null, copies: 1, keywords: { base: [], special: [] }, ...partial };
}

function gift(id: number, skillTriggers: SkillTrigger[]): Gift {
  const base = live.gifts[0]!;
  return { ...base, id, name: { ko: `기프트 ${id}`, en: `Gift ${id}` }, skillTriggers, formationSlots: [] };
}

const WRATH_SLASH = identity(10101, [
  skillRow({ slot: 1, sin: 'WRATH', attackType: 'Slash', copies: 3 }),
  skillRow({ slot: 2, sin: 'GLOOM', attackType: 'Hit', copies: 2 }),
  skillRow({ slot: 3, sin: 'WRATH', attackType: 'Penetrate', copies: 1 }),
]);
const ENVY_HIT = identity(10201, [
  skillRow({ slot: 1, sin: 'ENVY', attackType: 'Hit', copies: 3 }),
  skillRow({ slot: 2, sin: 'ENVY', attackType: 'Hit', copies: 0 }),
]);
const NO_SKILLS = identity(10301, []);

function indexesOf(identities: Identity[], gifts: Gift[]): GameIndexes {
  return buildIndexes({ ...live, identities, gifts });
}

describe('skillsOf', () => {
  const indexes = indexesOf([WRATH_SLASH, ENVY_HIT, NO_SKILLS], live.gifts);

  it('keeps the identities in the order it was given them, then slot order', () => {
    const { skills } = skillsOf([ENVY_HIT.id, WRATH_SLASH.id], indexes);
    expect(skills.map((s) => [s.identityId, s.slot])).toEqual([
      [10201, 1],
      [10201, 2],
      [10101, 1],
      [10101, 2],
      [10101, 3],
    ]);
  });

  it('says which identities it could not read rather than dropping them silently', () => {
    const { skills, unknownSkillIdentities } = skillsOf([NO_SKILLS.id, 99999], indexes);
    expect(skills).toEqual([]);
    expect(unknownSkillIdentities).toEqual([10301, 99999]);
  });
});

describe('triggerMatches', () => {
  const skill: SkillRef = {
    identityId: 1,
    slot: 2,
    sin: 'WRATH',
    attackType: 'Slash',
    copies: 2,
    keywords: { base: ['Combustion'], special: ['Charge'] },
    identityKeywords: { base: ['Combustion', 'Sinking'], special: ['Charge'] },
  };

  it('ignores an axis the trigger leaves null', () => {
    expect(triggerMatches(trigger({ sin: 'WRATH', attackType: null, slots: [], effect: 'gate' }), skill)).toBe(true);
    expect(triggerMatches(trigger({ sin: null, attackType: 'Slash', slots: [], effect: 'gate' }), skill)).toBe(true);
  });

  it('needs every axis the trigger does state', () => {
    expect(triggerMatches(trigger({ sin: 'WRATH', attackType: 'Slash', slots: [], effect: 'gate' }), skill)).toBe(true);
    expect(triggerMatches(trigger({ sin: 'WRATH', attackType: 'Hit', slots: [], effect: 'gate' }), skill)).toBe(false);
  });

  it('asks the SKILL for its keyword when the trigger is 스킬 단위', () => {
    // 「[화상]을 부여하는 스킬 2」 — the skill itself carries 화상, so it matches.
    expect(triggerMatches(trigger({ keywords: ['Combustion'], slots: [2] }), skill)).toBe(true);
    // 침잠 is the identity's elsewhere, never this skill's: 스킬 단위 must not borrow it.
    expect(triggerMatches(trigger({ keywords: ['Sinking'] }), skill)).toBe(false);
  });

  it('asks the IDENTITY when the trigger is 인격 단위', () => {
    // 「[침잠]을 부여하는 인격이 사용하는 스킬 2」 — the slot only says where the effect lands.
    expect(triggerMatches(trigger({ keywords: ['Sinking'], subject: 'identity' }), skill)).toBe(true);
    expect(triggerMatches(trigger({ keywords: ['Breath'], subject: 'identity' }), skill)).toBe(false);
  });

  it('counts a 특수 변형 only when the sentence said 또는 특수 X', () => {
    expect(triggerMatches(trigger({ keywords: ['Charge'] }), skill)).toBe(false);
    expect(triggerMatches(trigger({ keywords: ['Charge'], includesSpecial: true }), skill)).toBe(true);
  });

  it('matches any one of the keywords, and keeps the other axes binding', () => {
    expect(triggerMatches(trigger({ keywords: ['Breath', 'Combustion'] }), skill)).toBe(true);
    // The keyword is right but the slot is not — a trigger is an AND over what it states.
    expect(triggerMatches(trigger({ keywords: ['Combustion'], slots: [1] }), skill)).toBe(false);
  });

  it('reads verb as wording only, never as a filter', () => {
    // The static data names the buff, never whether the skill grants or spends it, so 소모 and
    // 부여 must select the same skills — anything else would be a guess.
    expect(triggerMatches(trigger({ keywords: ['Combustion'], verb: 'consume' }), skill)).toBe(true);
    expect(triggerMatches(trigger({ keywords: ['Combustion'], verb: 'any' }), skill)).toBe(true);
  });

  it('limits itself to the named slots, and to no slot when none are named', () => {
    expect(triggerMatches(trigger({ sin: null, attackType: 'Slash', slots: [2], effect: 'gate' }), skill)).toBe(true);
    expect(triggerMatches(trigger({ sin: null, attackType: 'Slash', slots: [1, 3], effect: 'gate' }), skill)).toBe(false);
  });
});

describe('matchSkillTriggers', () => {
  const anySlash = gift(1, [trigger({ sin: null, attackType: 'Slash', slots: [], effect: 'gate' })]);
  const slot1Slash = gift(2, [trigger({ sin: null, attackType: 'Slash', slots: [1], effect: 'gate' })]);
  const hitOrWrath = gift(3, [
    trigger({ sin: 'WRATH', attackType: null, slots: [], effect: 'gate' }),
    trigger({ sin: null, attackType: 'Hit', slots: [], effect: 'boost' }),
  ]);
  const lustOnly = gift(4, [trigger({ sin: 'LUST', attackType: null, slots: [], effect: 'gate' })]);
  const plain = gift(5, []);
  const gifts = [hitOrWrath, plain, anySlash, lustOnly, slot1Slash];

  const indexes = indexesOf([WRATH_SLASH, ENVY_HIT], gifts);
  const { skills } = skillsOf([WRATH_SLASH.id, ENVY_HIT.id], indexes);
  const matches = matchSkillTriggers(gifts, skills);

  it('reports only the gifts some skill sets off, sorted by id', () => {
    expect(matches.map((m) => m.giftId)).toEqual([1, 2, 3]);
  });

  it('names the skills that satisfied the triggers, deduped', () => {
    const slot1 = matches.find((m) => m.giftId === 2)!;
    expect(slot1.skills.map((s) => [s.identityId, s.slot])).toEqual([[10101, 1]]);
  });

  it('keeps every trigger a skill satisfies, and drops the ones none does', () => {
    const both = matches.find((m) => m.giftId === 3)!;
    expect(both.triggers.map((t) => t.effect)).toEqual(['gate', 'boost']);
    expect(both.skills.map((s) => [s.identityId, s.slot])).toEqual([
      [10101, 1],
      [10101, 3],
      [10101, 2],
      [10201, 1],
      [10201, 2],
    ]);
  });

  it('is stable across calls', () => {
    expect(matchSkillTriggers(gifts, skills)).toEqual(matches);
  });

  it('answers nothing, and throws nothing, for a deck it cannot read', () => {
    expect(matchSkillTriggers(gifts, [])).toEqual([]);
  });
});

describe('matchSkillTriggers on the shipped season', () => {
  it('lets the LCB starting deck set off most of the season, but not the gifts it has no sin for', () => {
    const deck = live.identities
      .slice()
      .sort((a, b) => a.sinnerId - b.sinnerId || a.id - b.id)
      .filter((i, index, all) => index === 0 || all[index - 1]!.sinnerId !== i.sinnerId)
      .slice(0, 6)
      .map((i) => i.id);
    const { skills, unknownSkillIdentities } = skillsOf(deck, liveIndexes);
    expect(unknownSkillIdentities).toEqual([]);
    const matches = matchSkillTriggers(live.gifts, skills);
    expect(matches.length).toBeGreaterThan(50);
    expect(matches.length).toBeLessThan(live.gifts.filter((g) => g.skillTriggers.length > 0).length + 1);
  });
});
