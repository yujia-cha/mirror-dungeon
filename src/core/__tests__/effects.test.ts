/**
 * M129: the 추천 기프트 judgement — each effect of a gift against the deployed party. Identities and
 * gifts are small fixtures so each rule is seen alone; the shipped data is checked by the app tests.
 */
import { describe, expect, it } from 'vitest';
import { giftEffectsReport, identityMeets, relevanceReason } from '../effects.ts';
import type { EffectRequirement, Gift, GiftEffect, Identity, IdentitySkill } from '../schema.ts';
import type { DeckStats } from '../types.ts';

function skill(slot: 1 | 2 | 3, over: Partial<IdentitySkill> = {}): IdentitySkill {
  return {
    slot,
    sin: 'WRATH',
    attackType: 'Slash',
    weight: 1,
    coins: { count: 3, plus: true, minus: false, unbreakable: false },
    keywords: {},
    ...over,
  };
}

function identity(id: number, over: Partial<Identity> = {}): Identity {
  return {
    id,
    sinnerId: 1,
    sinner: { ko: '이상', en: 'Yi Sang' },
    title: { ko: `인격 ${id}`, en: `Identity ${id}` },
    rank: 3,
    season: 0,
    factions: [],
    traits: [],
    keywords: {},
    keywordSource: 'derived',
    sins: ['WRATH'],
    attackTypes: ['Slash'],
    skills: [skill(1), skill(2), skill(3)],
    defenseTypes: ['guard'],
    buffs: [],
    ...over,
  };
}

function gift(effects: GiftEffect[], over: Partial<Gift> = {}): Gift {
  return {
    id: 9000,
    name: { ko: '시험', en: 'Test' },
    desc: { ko: '', en: '' },
    keyword: 'None',
    tier: 1,
    sin: null,
    price: null,
    upgradeLevels: 0,
    tags: [],
    hardOnly: false,
    obtainable: true,
    acquisition: {
      kind: 'packLimited',
      packs: [1],
      exclusiveTo: [1],
      startKeyword: null,
      clearRewardOf: null,
    },
    observable: false,
    icon: 9000,
    fusion: null,
    conditions: [],
    effects,
    upgradeOf: null,
    ...over,
  };
}

const effect = (...requires: EffectRequirement[]): GiftEffect => ({ kind: 'effect', requires });

function deckOf(deployed: Identity[], reserve: Identity[] = []) {
  const byId = new Map([...deployed, ...reserve].map((i) => [i.id, i]));
  const stats = { deployed: deployed.map((i) => i.id), reserve: reserve.map((i) => i.id) } as DeckStats;
  return { stats, byId };
}

const RUPTURE_SKILL = (slot: 1 | 2 | 3) =>
  skill(slot, { keywords: { Burst: { base: true, special: false } } });
const BURN_S1 = skill(1, { keywords: { Combustion: { base: true, special: false } } });
const BURN_S3 = skill(3, { keywords: { Combustion: { base: true, special: false } } });

describe('one identity against one requirement', () => {
  it('counts a keyword skill only in the named slot', () => {
    // Arrange: burn on S1 only, then burn on S3.
    const s1 = identity(1, { skills: [BURN_S1, skill(2), skill(3)] });
    const s3 = identity(2, { skills: [skill(1), skill(2), BURN_S3] });
    const necktie: EffectRequirement = {
      type: 'skillKeyword',
      keywords: ['Combustion'],
      includesSpecial: true,
      slot: 3,
    };

    // Act + Assert
    expect(identityMeets(s1, necktie)).toBe(false);
    expect(identityMeets(s3, necktie)).toBe(true);
  });

  it('counts a 특수-only skill only when the sentence says 「또는 특수」, except for 탄환', () => {
    const special = identity(1, {
      skills: [skill(1, { keywords: { Charge: { base: false, special: true } } }), skill(2), skill(3)],
    });
    const bullets = identity(2, {
      skills: [skill(1, { keywords: { Bullet: { base: false, special: true } } }), skill(2), skill(3)],
    });
    const charge = (includesSpecial: boolean): EffectRequirement => ({
      type: 'skillKeyword',
      keywords: ['Charge'],
      includesSpecial,
    });

    expect(identityMeets(special, charge(false))).toBe(false);
    expect(identityMeets(special, charge(true))).toBe(true);
    expect(
      identityMeets(bullets, { type: 'skillKeyword', keywords: ['Bullet'], includesSpecial: false }),
    ).toBe(true);
  });

  it('needs one skill that has both the sin and the attack type', () => {
    // Arrange: a Pride Slash and a Wrath Pierce — Pride and Pierce, but never on one skill.
    const split = identity(1, {
      skills: [
        skill(1, { sin: 'PRIDE', attackType: 'Slash' }),
        skill(2, { sin: 'WRATH', attackType: 'Penetrate' }),
      ],
    });
    const joined = identity(2, { skills: [skill(1, { sin: 'PRIDE', attackType: 'Penetrate' })] });
    const pridePierce: EffectRequirement = { type: 'skill', sins: ['PRIDE'], attackTypes: ['Penetrate'] };

    expect(identityMeets(split, pridePierce)).toBe(false);
    expect(identityMeets(joined, pridePierce)).toBe(true);
  });

  it('reads coins and attack weight, and says 「모름」 when the source has none', () => {
    const single = identity(1, {
      skills: [skill(1, { coins: { count: 1, plus: true, minus: false, unbreakable: false } })],
    });
    const unknown = identity(2, { skills: [skill(1, { coins: null, weight: null })] });
    const heavy = identity(3, { skills: [skill(1, { weight: 2 })] });

    expect(identityMeets(single, { type: 'shape', kind: 'singleCoin' })).toBe(true);
    expect(identityMeets(unknown, { type: 'shape', kind: 'singleCoin' })).toBeNull();
    expect(identityMeets(heavy, { type: 'shape', kind: 'weightAtLeast', n: 2 })).toBe(true);
    expect(identityMeets(single, { type: 'shape', kind: 'weightAtLeast', n: 2 })).toBe(false);
  });

  it('looks up identity buffs, defense kinds and factions', () => {
    const mao = identity(1, {
      factions: ['BLACK_BEAST_RABBIT'],
      buffs: ['LegStrength'],
      defenseTypes: ['counter'],
    });
    const plain = identity(2);
    const noData = identity(3, { buffs: undefined, defenseTypes: undefined });

    expect(identityMeets(mao, { type: 'identityBuff', buffs: ['LegStrength'] })).toBe(true);
    expect(identityMeets(plain, { type: 'identityBuff', buffs: ['LegStrength'] })).toBe(false);
    expect(identityMeets(noData, { type: 'identityBuff', buffs: ['LegStrength'] })).toBeNull();
    expect(identityMeets(mao, { type: 'defense', kinds: ['counter'] })).toBe(true);
    expect(identityMeets(noData, { type: 'defense', kinds: ['counter'] })).toBeNull();
    expect(identityMeets(mao, { type: 'faction', factions: ['BLACK_BEAST_RABBIT'] })).toBe(true);
  });

  it('falls back to the keyword totals when an identity has no per-skill data, but not for a slot', () => {
    const totals = identity(1, { skills: undefined, keywords: { Burst: { skills: 2, specialSkills: 0 } } });

    expect(identityMeets(totals, { type: 'skillKeyword', keywords: ['Burst'], includesSpecial: false })).toBe(
      true,
    );
    expect(
      identityMeets(totals, { type: 'skillKeyword', keywords: ['Burst'], includesSpecial: false, slot: 3 }),
    ).toBeNull();
  });
});

describe('a gift against the deployed party', () => {
  const rupture = effect({ type: 'skillKeyword', keywords: ['Burst'], includesSpecial: false });

  it('recommends a rupture gift to a rupture deck and not to a deck without it', () => {
    // Arrange
    const gum = gift([rupture]);
    const ruptureDeck = deckOf([
      identity(1, { skills: [RUPTURE_SKILL(1), skill(2), skill(3)] }),
      identity(2),
    ]);
    const burnDeck = deckOf([identity(3, { skills: [BURN_S1, skill(2), skill(3)] })]);

    // Act
    const yes = giftEffectsReport(gum, ruptureDeck.stats, ruptureDeck.byId);
    const no = giftEffectsReport(gum, burnDeck.stats, burnDeck.byId);

    // Assert
    expect(yes.relevance).toBe('deck');
    expect(relevanceReason(yes)).toBe('deck:skillKeyword/Burst');
    expect(no.relevance).toBeNull();
    expect(relevanceReason(no)).toBe('none');
  });

  it('counts only deployed identities — a reserve with the keyword does not help', () => {
    const gum = gift([rupture]);
    const deck = deckOf([identity(1)], [identity(2, { skills: [RUPTURE_SKILL(2)] })]);

    expect(giftEffectsReport(gum, deck.stats, deck.byId).relevance).toBeNull();
  });

  it('calls a gift with an unconditional effect `free`, and `deck` once a conditional one is usable', () => {
    // Arrange: 흑염 파이프 — two plain effects and a Pride Pierce one, after a slot heading.
    const pipe = gift([
      { kind: 'note', requires: [] },
      effect(),
      effect(),
      effect({ type: 'skill', sins: ['PRIDE'], attackTypes: ['Penetrate'] }),
    ]);
    const any = deckOf([identity(1)]);
    const pride = deckOf([identity(2, { skills: [skill(1, { sin: 'PRIDE', attackType: 'Penetrate' })] })]);

    // Act + Assert
    expect(giftEffectsReport(pipe, any.stats, any.byId).relevance).toBe('free');
    expect(giftEffectsReport(pipe, pride.stats, pride.byId).relevance).toBe('deck');
  });

  it('closes every effect behind an unmet gate, and opens them at the threshold', () => {
    // Arrange: 「…화상…인격이 5인 이상이면, 이번 전투 동안 발동」 then an unconditional effect.
    const requiem = gift([
      {
        kind: 'gate',
        requires: [{ type: 'skillKeyword', keywords: ['Combustion'], includesSpecial: true, min: 5 }],
      },
      effect(),
    ]);
    const burner = (id: number) => identity(id, { skills: [BURN_S1] });
    const four = deckOf([1, 2, 3, 4].map(burner));
    const five = deckOf([1, 2, 3, 4, 5].map(burner));

    // Act
    const closed = giftEffectsReport(requiem, four.stats, four.byId);
    const open = giftEffectsReport(requiem, five.stats, five.byId);

    // Assert: a met gate makes the gift the deck's, though the effect behind it is plain.
    expect(closed.gateOpen).toBe(false);
    expect(closed.relevance).toBeNull();
    expect(open.gates[0]).toMatchObject({ have: 5, need: 5, satisfied: true });
    expect(open.relevance).toBe('deck');
  });

  it('never recommends with nobody deployed, and never through a note', () => {
    const plain = gift([effect()]);
    const onlyNote = gift([{ kind: 'note', requires: [] }]);
    const empty = deckOf([]);
    const one = deckOf([identity(1)]);

    expect(giftEffectsReport(plain, empty.stats, empty.byId).relevance).toBe('free');
    expect(giftEffectsReport(gift([rupture]), empty.stats, empty.byId).relevance).toBeNull();
    expect(giftEffectsReport(onlyNote, one.stats, one.byId).relevance).toBeNull();
  });

  it('counts an unknown identity as not meeting the requirement and reports it', () => {
    const necktie = gift([
      effect({ type: 'skillKeyword', keywords: ['Combustion'], includesSpecial: true, slot: 3 }),
    ]);
    const deck = deckOf([
      identity(1, { skills: undefined, keywords: { Combustion: { skills: 3, specialSkills: 0 } } }),
    ]);

    const report = giftEffectsReport(necktie, deck.stats, deck.byId);

    expect(report.relevance).toBeNull();
    expect(report.effects[0]!.requirements[0]).toMatchObject({ have: 0, unknown: 1, satisfied: false });
  });

  it('asks the formation, not only the fighters, for a named identity', () => {
    const web = gift([effect({ type: 'identity', ids: [11201] })]);
    const deck = deckOf([identity(1)], [identity(11201)]);

    expect(giftEffectsReport(web, deck.stats, deck.byId).relevance).toBe('deck');
  });
});

describe('M129 follow-up: 하나라도, 자기 키워드, E.G.O', () => {
  it('meets 「A 또는 B」 with either option, each keeping its own threshold', () => {
    // Arrange: 「화상 스킬 또는 색욕 스킬」.
    const either: EffectRequirement = {
      type: 'anyOf',
      options: [
        { type: 'skillKeyword', keywords: ['Combustion'], includesSpecial: true },
        { type: 'skill', sins: ['LUST'] },
      ],
    };
    const lust = deckOf([identity(1, { skills: [skill(1, { sin: 'LUST' })] })]);
    const neither = deckOf([identity(2)]);

    // Act
    const yes = giftEffectsReport(gift([effect(either)]), lust.stats, lust.byId);
    const no = giftEffectsReport(gift([effect(either)]), neither.stats, neither.byId);

    // Assert
    expect(yes.relevance).toBe('deck');
    expect(yes.effects[0]!.requirements[0]).toMatchObject({ have: 1, need: 1, satisfied: true });
    expect(no.relevance).toBeNull();
  });

  it('reads 자기 진동 소모 from the skill’s own facts, not from what it inflicts', () => {
    const spender = identity(1, {
      skills: [skill(1, { self: { Vibration: { gain: false, consume: true } } })],
    });
    const inflicter = identity(2, {
      skills: [skill(1, { keywords: { Vibration: { base: true, special: false } }, self: {} })],
    });
    const unknown = identity(3, { skills: [skill(1)] });
    const consume: EffectRequirement = { type: 'selfKeyword', keywords: ['Vibration'], verb: 'consume' };

    expect(identityMeets(spender, consume)).toBe(true);
    expect(identityMeets(inflicter, consume)).toBe(false);
    expect(identityMeets(unknown, consume)).toBeNull();
  });

  it('reads 「스킬로 [진동 폭발]」 from the skills that set it off, with their slots (M150)', () => {
    // Arrange: S2 explodes; another identity only inflicts 진동; a third has no per-skill facts.
    const exploder = identity(1, {
      skills: [skill(1), skill(2, { mechanics: ['VibrationExplosion'] })],
    });
    const tremor = identity(2, {
      skills: [skill(1, { keywords: { Vibration: { base: true, special: false } } })],
    });
    const bare = identity(3, { skills: undefined });
    const explode: EffectRequirement = { type: 'skillMechanic', mechanics: ['VibrationExplosion'] };
    const convert: EffectRequirement = {
      type: 'skillMechanic',
      mechanics: ['Switch_Vibration', 'FusionVibration'],
    };
    const deck = deckOf([exploder, tremor]);

    // Act
    const report = giftEffectsReport(gift([effect(explode)]), deck.stats, deck.byId);

    // Assert
    expect(identityMeets(exploder, explode)).toBe(true);
    expect(identityMeets(exploder, convert)).toBe(false);
    expect(identityMeets(tremor, explode)).toBe(false);
    expect(identityMeets(bare, explode)).toBeNull();
    expect(report.relevance).toBe('deck');
    expect(report.effects[0]!.requirements[0]!.matches).toEqual([{ id: 1, slots: [2] }]);
  });

  it('shows who could set off a hinted explosion without ever requiring it (M150)', () => {
    // Arrange: 「[진동 폭발]이 적용된 적에게 …」 — no requirement, a hint of explosion skills.
    const explode: EffectRequirement = { type: 'skillMechanic', mechanics: ['VibrationExplosion'] };
    const bell = gift([{ kind: 'effect', requires: [], hints: [explode] }]);
    const exploder = identity(1, { skills: [skill(1), skill(2, { mechanics: ['VibrationExplosion'] })] });
    const withIt = deckOf([exploder, identity(2)]);
    const without = deckOf([identity(2)]);

    // Act
    const yes = giftEffectsReport(bell, withIt.stats, withIt.byId);
    const no = giftEffectsReport(bell, without.stats, without.byId);

    // Assert: the hint lists who has the skill; the effect stays unconditional either way.
    expect(yes.effects[0]!.hints[0]!.matches).toEqual([{ id: 1, slots: [2] }]);
    expect(no.effects[0]!.hints[0]!.have).toBe(0);
    for (const report of [yes, no]) {
      expect(report.effects[0]!.usable).toBe(true);
      expect(report.effects[0]!.unconditional).toBe(true);
    }
    expect([yes.relevance, no.relevance]).toEqual(['free', 'free']);
  });

  it('puts a gift held only by an E.G.O skill condition in a group of its own, even with nobody deployed', () => {
    // Arrange: an 조각 — 「…E.G.O 스킬 사용 시 발동」, then an effect.
    const shard = gift([{ kind: 'gate', requires: [{ type: 'egoSkill' }] }, effect()]);
    const withDeck = gift([
      { kind: 'gate', requires: [{ type: 'egoSkill' }] },
      effect({ type: 'faction', factions: ['X'] }),
    ]);
    const empty = deckOf([]);
    const x = deckOf([identity(1, { factions: ['X'] })]);

    // Act + Assert
    expect(giftEffectsReport(shard, empty.stats, empty.byId).relevance).toBe('ego');
    expect(relevanceReason(giftEffectsReport(shard, empty.stats, empty.byId))).toBe('ego');
    expect(giftEffectsReport(withDeck, x.stats, x.byId).relevance).toBe('deck');
  });
});
