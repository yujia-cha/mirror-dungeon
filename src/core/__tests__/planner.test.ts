/**
 * Scenario tests for the planner, run against the real generated game data.
 *
 * Each case encodes a rule a player would recognise, so a regression here means the tool would
 * give bad advice — not merely that an implementation detail moved.
 */
import { describe, expect, it } from 'vitest';
import { loadGameDataFromDisk } from '../data/node.ts';
import {
  alternativePacksOn,
  assignPacks,
  buildIndexes,
  conflictGroups,
  conflictRootsOf,
  contestedFloors,
  createDropEffects,
  defaultOptions,
  planDropEffects,
  planResolutions,
  planRoute,
  startGiftBudget,
  wantedRoots,
} from '../index.ts';
import { beforeCantoX } from './before-canto-x.ts';
import { analyseDeck, dominantKeyword, evaluateConditions } from '../deck.ts';
import { expandRequirements, goalRoots } from '../requirements.ts';
import { modeForFloor, observationCost } from '../search.ts';
import type { PlanInput, PlanOptions, RoutePlan } from '../types.ts';

const data = loadGameDataFromDisk();
const indexes = buildIndexes(data);
/** The same season with 기프트 관측 switched off, for tests about the pack search alone. */
const noObservation = {
  ...data,
  rules: { ...data.rules, giftObservation: { ...data.rules.giftObservation, max: 0 } },
};

/**
 * The season as M82–M87 measured it. Their optima were checked offline with an integer program over
 * these packs, so this reads the frozen md7 output rather than whichever season is live (MD8 moved
 * 9205 into pack pools, which reshuffles every seeded board); the Canto X packs that arrived on 10-15
 * (1028–1031) carry an assumed general pool there (`backfillAssumptions`), so they and their
 * exclusives are left out and the boards stay the same.
 */
const measuredSeason = (() => {
  const season = beforeCantoX(loadGameDataFromDisk(undefined, 7));
  return {
    data: season,
    indexes: buildIndexes(season),
    noObservation: {
      ...season,
      rules: { ...season.rules, giftObservation: { ...season.rules.giftObservation, max: 0 } },
    },
  };
})();

/** Identity ids used below, chosen because their factions and keywords are stable. */
const BLADE_LINEAGE_DECK = [10403, 10308, 10208, 10108, 11005, 10104];
const MIXED_DECK = [10101, 10203, 10312, 10403, 10505, 10601];

function options(overrides: Partial<PlanOptions> = {}): PlanOptions {
  return { ...defaultOptions(), ...overrides };
}

function planWithout(input: Partial<PlanInput> & { wanted: PlanInput['wanted'] }) {
  return planRoute(
    { deck: input.deck ?? MIXED_DECK, wanted: input.wanted, options: input.options ?? options() },
    noObservation,
    indexes,
  );
}

function plan(input: Partial<PlanInput> & { wanted: PlanInput['wanted'] }) {
  return planRoute(
    { deck: input.deck ?? MIXED_DECK, wanted: input.wanted, options: input.options ?? options() },
    data,
    indexes,
  );
}

function want(...giftIds: number[]): PlanInput['wanted'] {
  return giftIds.map((giftId) => ({ giftId, required: true }));
}

describe('floor modes', () => {
  it('maps floors onto the four run modes around the Hard switch point', () => {
    const normalRun = options({ hardFromFloor: null });
    expect(modeForFloor(1, normalRun, indexes)).toBe('normal');
    expect(modeForFloor(5, normalRun, indexes)).toBe('normal');

    const switchAtThree = options({ hardFromFloor: 3 });
    expect(modeForFloor(2, switchAtThree, indexes)).toBe('normal');
    expect(modeForFloor(3, switchAtThree, indexes)).toBe('hard');

    expect(modeForFloor(6, normalRun, indexes)).toBe('parallel');
    expect(modeForFloor(10, normalRun, indexes)).toBe('parallel');
    expect(modeForFloor(11, normalRun, indexes)).toBe('extreme');
    expect(modeForFloor(15, normalRun, indexes)).toBe('extreme');
  });
});

describe('general gifts', () => {
  it('never forces a pack for a gift that any pack can drop', () => {
    // 재에서 재로 is in two thirds of the packs and exclusive to none.
    const result = plan({ wanted: want(9003) });
    expect(result.generalDrops).toContain(9003);
    expect(result.floors.every((floor) => floor.packId === null)).toBe(true);
    expect(result.stats.requiredPacks).toBe(0);
  });

  it('says plainly that a general drop is not guaranteed', () => {
    const result = plan({ wanted: want(9003) });
    expect(result.warnings.map((w) => w.code)).toContain('general-drop-not-guaranteed');
  });
});

describe('pack-exclusive gifts', () => {
  it('routes 상납된 시가 to 교본 on Hard floor 5', () => {
    const result = plan({ wanted: want(9283), options: options({ hardFromFloor: 1 }) });
    const floor5 = result.floors.find((f) => f.floor === 5)!;
    expect(floor5.packId).toBe(1025);
    expect(floor5.mode).toBe('hard');
    expect(floor5.pickups).toEqual([{ giftId: 9283, kind: 'exclusive', neededFor: null }]);
    expect(result.unresolved).toEqual([]);
  });

  it('cannot reach a Hard-only pack on a Normal plan', () => {
    const result = planWithout({
      wanted: want(9283),
      options: options({ hardFromFloor: null }),
    });
    expect(result.unresolved.map((u) => u.giftId)).toContain(9283);
    expect(result.unresolved.find((u) => u.giftId === 9283)?.reason).toBe('no-pack-in-range');
    expect(result.warnings.map((w) => w.code)).toContain('hard-required');
  });

  it('suggests Hard only for a gift the Normal plan could not place whose every pack is Hard-only (M160)', () => {
    // Arrange: 해진 삿갓 (9719) comes from 육참골단 (1104, Normal 4~5) and its 복각 (1116, Hard only).
    const normal = options({ hardFromFloor: null });
    // Act
    const routed = planWithout({ wanted: want(9719), options: normal });
    const both = planWithout({ wanted: want(9719, 9283), options: normal });
    const banned = planWithout({
      wanted: want(9719),
      options: options({ hardFromFloor: null, bannedPacks: [1104] }),
    });
    // Assert: placed on a Normal floor, so Hard would change nothing — no warning (41 MD8 gifts
    // with a Normal pack used to get one).
    expect(routed.unresolved).toEqual([]);
    expect(routed.floors.some((f) => f.packId === 1104 && f.pickups.some((p) => p.giftId === 9719))).toBe(
      true,
    );
    expect(routed.warnings.map((w) => w.code)).not.toContain('hard-required');
    // Beside 상납된 시가, whose only pack is Hard-only and which the plan could not place, it is warned.
    expect(both.unresolved.map((u) => u.giftId)).toEqual([9283]);
    expect(both.warnings.map((w) => w.code)).toContain('hard-required');
    // With the Normal pack banned, only the Hard-only one is left: Hard is what would reach it.
    expect(banned.unresolved.find((u) => u.giftId === 9719)?.reason).toBe('pack-banned');
    expect(banned.warnings.map((w) => w.code)).toContain('hard-required');
  });

  it('reports a conflict when two exclusives need the same single floor', () => {
    // 상납된 시가 is exclusive to 교본 and 새하얀 캔버스 to 검과 작품; both packs only appear on
    // Hard floor 5, so one run cannot hold both.
    const result = planWithout({
      wanted: want(9283, 9222),
      options: options({ hardFromFloor: 1 }),
    });
    expect(result.unresolved).toHaveLength(1);
    expect(result.unresolved[0]!.reason).toBe('pack-conflict');
    expect(result.stats.coveredWanted).toBe(1);
  });

  it('resolves that conflict by observing the gift that occupies the contested floor', () => {
    // 상납된 시가 itself is not in the observation pool, so the planner observes 새하얀 캔버스 and
    // gives floor 5 to 교본 instead.
    const result = plan({
      wanted: want(9283, 9222),
      options: options({ hardFromFloor: 1 }),
    });
    expect(result.unresolved).toEqual([]);
    expect(result.start.observed).toEqual([{ giftId: 9222, pinned: false, freedPack: 1026 }]);
    expect(result.start.starlight).toBe(70);
    expect(result.floors.find((f) => f.floor === 5)!.packId).toBe(1025);
    // The cost table now comes from the season data, so no caveat.
    expect(result.warnings.map((w) => w.code)).not.toContain('gift-observation-unverified');
  });

  it('still warns about the cost table when the rules say it is unverified', () => {
    const unverified = {
      ...data,
      rules: { ...data.rules, giftObservation: { ...data.rules.giftObservation, verified: false } },
    };
    const result = planRoute(
      { deck: BLADE_LINEAGE_DECK, wanted: want(9283, 9222), options: options({ hardFromFloor: 1 }) },
      unverified,
      indexes,
    );
    expect(result.start.observed).toHaveLength(1);
    expect(result.warnings.map((w) => w.code)).toContain('gift-observation-unverified');
  });

  it('frees up a second floor when the plan extends into 평행중첩', () => {
    const result = planWithout({
      wanted: want(9283, 9222),
      options: options({ lastFloor: 10 }),
    });
    expect(result.unresolved).toEqual([]);
    const used = result.floors.filter((f) => f.packId !== null);
    expect(used.map((f) => f.packId).sort()).toEqual([1025, 1026]);
    // One of them has to sit on a 평행중첩 floor.
    expect(used.some((f) => f.mode === 'parallel')).toBe(true);
  });

  it('forces Hard from floor 1 when planning past floor 5, and says why', () => {
    const result = plan({ wanted: want(9283), options: options({ lastFloor: 10, hardFromFloor: null }) });
    expect(result.floors.filter((f) => f.floor <= 5).every((f) => f.mode === 'hard')).toBe(true);
    expect(result.warnings.map((w) => w.code)).toContain('parallel-requires-hard');
  });
});

describe('fusion', () => {
  it('expands 진혼 into a two-step chain that fits the shop', () => {
    const result = plan({ wanted: want(9088) });
    expect(result.fusions.map((f) => f.result)).toEqual([9157, 9088]);
    // Ingredients before results: 요리 비법 전서 is consumed by 진혼.
    expect(result.fusions[1]!.ingredients).toContain(9157);
    for (const fusion of result.fusions) {
      expect(fusion.ingredients.length).toBeLessThanOrEqual(data.rules.fusion.maxShopSlots);
      expect(fusion.unreachable).toBe(false);
    }
  });

  it('prefers the recipe that fits the shop over the spelled-out one', () => {
    const expansion = expandRequirements(
      want(9088),
      indexes,
      analyseDeck(MIXED_DECK, indexes, data.rules.deployment),
      data.rules.fusion.maxShopSlots,
    );
    const top = expansion.fusions.find((f) => f.result === 9088)!;
    expect(top.ingredients).toEqual([9003, 9053, 9157]);
  });

  it('fuses a goal into the goal it feeds once instead of spelling its ingredients out again', () => {
    // 생강꽃, 안경 그리고 전해진 편지 (9248) = 생강꽃 가지 + 부치지 못한 편지 (9424), or the long
    // 해진 우산 + 생강꽃 가지 + 깨진 안경. Alone it takes the long one (no nested fusion); with
    // 부치지 못한 편지 also a goal, the long one asked for 해진 우산 and 깨진 안경 twice.
    const stats = analyseDeck(MIXED_DECK, indexes, data.rules.deployment);
    const slots = data.rules.fusion.maxShopSlots;
    const alone = expandRequirements(want(9248), indexes, stats, slots);
    expect(alone.fusions).toEqual([{ result: 9248, ingredients: [9119, 9419, 9423] }]);

    const both = expandRequirements(want(9424, 9248), indexes, stats, slots);
    expect(both.fusions).toEqual([
      { result: 9424, ingredients: [9119, 9423] },
      { result: 9248, ingredients: [9419, 9424] },
    ]);
    expect(both.requirements.map((r) => r.giftId).sort((a, b) => a - b)).toEqual([9119, 9419, 9423]);

    const route = plan({ wanted: want(9248, 9424), options: options({ lastFloor: 15, hardFromFloor: 1 }) });
    expect(route.warnings.map((w) => w.code)).not.toContain('shared-ingredient');
    expect(route.unresolved).toEqual([]);
  });

  it('warns when a recipe would need more fusion slots than a shop has', () => {
    const result = planRoute(
      { deck: MIXED_DECK, wanted: want(9088), options: options() },
      { ...data, rules: { ...data.rules, fusion: { ...data.rules.fusion, maxShopSlots: 2 } } },
      indexes,
    );
    expect(result.warnings.map((w) => w.code)).toContain('fusion-slots');
  });

  it('schedules a fusion no earlier than the floor that supplies its last ingredient', () => {
    const result = plan({ wanted: want(9280), options: options({ hardFromFloor: 1 }) });
    const fusion = result.fusions.find((f) => f.result === 9280)!;
    const supplyFloors = result.floors
      .filter((f) => f.pickups.some((p) => fusion.ingredients.includes(p.giftId)))
      .map((f) => f.floor);
    for (const floor of supplyFloors) expect(fusion.earliestFloor).toBeGreaterThanOrEqual(floor);
  });

  it('picks keyword capstones matching the deck for the cross-keyword recipe', () => {
    const burnDeck = [11216, 10716];
    const expansion = expandRequirements(
      want(9083),
      indexes,
      analyseDeck(burnDeck, indexes, data.rules.deployment),
      data.rules.fusion.maxShopSlots,
    );
    const mixed = expansion.fusions.find((f) => f.result === 9083)!;
    // Three attack-type capstones are mandatory, plus two of the seven keyword ones.
    expect(mixed.ingredients).toHaveLength(5);
    for (const id of [9142, 9147, 9152]) expect(mixed.ingredients).toContain(id);
  });
});

describe('deck conditions', () => {
  it('counts identities that inflict a keyword, not identities tagged with it', () => {
    const stats = analyseDeck([10101, 10914], indexes, data.rules.deployment);
    // 10101 inflicts Sinking; 10914 inflicts Sinking and Charge.
    expect(stats.keywordCounts.formation.Sinking).toBe(2);
    expect(stats.keywordCounts.formation.Charge).toBe(1);
  });

  it('counts a 특수-only inflictor only for conditions that say 「또는 특수 X」', () => {
    // 10504 N사 큰 망치 inflicts 못 (특수 출혈) and no plain 출혈; 10403 inflicts plain 출혈.
    const stats = analyseDeck([10504, 10403], indexes, data.rules.deployment);
    expect(indexes.identityById.get(10504)!.keywords.Laceration).toEqual({ skills: 0, specialSkills: 2 });
    expect(stats.keywordCounts.formation.Laceration).toBe(2);
    expect(stats.baseKeywordMembers.formation.Laceration).toEqual([10403]);
    // 혈향도래 reads 「[Laceration] … 또는 특수 출혈 …」 over the formation, so 못 counts.
    const gift = indexes.giftById.get(9206)!;
    const condition = gift.conditions.find((c) => c.type === 'keywordSkillCount')!;
    expect(condition).toMatchObject({ keywords: ['Laceration'], scope: 'formation', includesSpecial: true });
    expect(evaluateConditions([9206], stats, indexes).find((r) => r.subject.kind === 'keyword')!.have).toBe(
      2,
    );
    // The same sentence without 「또는 특수 출혈」 would not count it.
    const strict = buildIndexes({
      ...data,
      gifts: data.gifts.map((g) =>
        g.id === 9206
          ? {
              ...g,
              conditions: g.conditions.map((c) =>
                c.type === 'keywordSkillCount' ? { ...c, includesSpecial: false } : c,
              ),
            }
          : g,
      ),
    });
    expect(evaluateConditions([9206], stats, strict).find((r) => r.subject.kind === 'keyword')!.have).toBe(1);
  });

  it('counts an identity once when a condition names two keywords', () => {
    // 9802 전격부 wants 파열 OR 충전 over the formation. 10601 홍루 LCB 수감자 has 파열 and 침잠;
    // an identity carrying both of a condition's keywords is still one identity.
    const both = data.identities.filter((i) => i.keywords.Burst && i.keywords.Charge).map((i) => i.id);
    expect(both.length).toBeGreaterThan(0);
    const deck = [...both.slice(0, 2), 10101, 10301, 10401, 10501];
    const stats = analyseDeck(deck, indexes, data.rules.deployment, deck);
    const condition = data.gifts.find((g) => g.id === 9802)!.conditions[0]!;
    const seen = new Set(
      deck.filter((id) => {
        const kw = indexes.identityById.get(id)!.keywords;
        return kw.Burst || kw.Charge;
      }),
    );
    expect(evaluateConditions([9802], stats, indexes)[0]!.have).toBe(seen.size);
    expect(condition).toMatchObject({ keywords: ['Burst', 'Charge'] });
  });

  it('counts 특수-only ammo for the 탄환 gate, which never says 「또는 특수 탄환」', () => {
    // 10414 잔향・외로움 spends only 탄환 - 고독, so it is 특수-only. 데스페라도's sentence has no
    // 「또는 특수」 — the game writes none for 탄환 — so honouring includesSpecial would drop the
    // seven 특수-only ammo identities and read the gate as unreached on a full ammo deck.
    const ammo = data.identities.filter((i) => i.keywords.Bullet).map((i) => i.id);
    expect(ammo.length).toBe(13);
    const stats = analyseDeck(ammo.slice(0, 12), indexes, data.rules.deployment, ammo.slice(0, 12));
    const report = evaluateConditions([9235], stats, indexes)[0]!;
    expect(data.gifts.find((g) => g.id === 9235)!.conditions[0]).toMatchObject({ includesSpecial: false });
    expect(report.have).toBe(12);
    expect(report.satisfied).toBe(true);
  });

  it('reports a count with no threshold as a number, not a gate', () => {
    // 9842 scales with the count and has no bar, so there is nothing to meet or miss.
    const deck = data.identities.filter((i) => i.keywords.BloodDinner).map((i) => i.id);
    const stats = analyseDeck(deck, indexes, data.rules.deployment, deck);
    const report = evaluateConditions([9842], stats, indexes)[0]!;
    expect(report).toMatchObject({ gate: false, have: 5, need: null });
  });

  it('judges the 혈찬 gate against the deck instead of giving up on it', () => {
    // 9795 wants three 혈찬 users among the deployed; it used to be unparsed and never judged.
    const bloodfiends = data.identities.filter((i) => i.keywords.BloodDinner).map((i) => i.id);
    const enough = analyseDeck(bloodfiends, indexes, data.rules.deployment, bloodfiends.slice(0, 3));
    expect(evaluateConditions([9795], enough, indexes)[0]).toMatchObject({
      have: 3,
      need: 3,
      satisfied: true,
    });
    const short = analyseDeck(bloodfiends, indexes, data.rules.deployment, bloodfiends.slice(0, 2));
    expect(evaluateConditions([9795], short, indexes)[0]).toMatchObject({ have: 2, satisfied: false });
  });

  it('counts 특수 충전 (생체 재료) for 사원증, which says 「또는 특수 충전」', () => {
    const stats = analyseDeck([10215, 10614], indexes, data.rules.deployment);
    for (const id of [10215, 10614]) {
      expect(indexes.identityById.get(id)!.keywords.Charge!.specialSkills).toBeGreaterThan(0);
    }
    const [report] = evaluateConditions([9043], stats, indexes);
    // 사원증 has no formation condition; its text is an effect, so it may carry none at all.
    if (report) expect(report.have).toBe(2);
    expect(stats.keywordCounts.formation.Charge).toBe(2);
    expect(stats.baseKeywordMembers.formation.Charge).toHaveLength(2);
  });

  it('deploys the first `deployment.default` identities when nobody is named', () => {
    const eight = [10101, 10102, 10403, 10505, 10601, 10707, 10808, 10914];
    const stats = analyseDeck(eight, indexes, data.rules.deployment);
    expect(data.rules.deployment.default).toBe(6);
    expect(stats.deployed).toEqual(eight.slice(0, 6));
    expect(stats.reserve).toEqual([10808, 10914]);
    expect(stats.keywordCounts.reserve.Sinking).toBe(1);
  });

  it('deploys exactly who is named, in deck order, up to `deployment.max`', () => {
    const eight = [10101, 10102, 10403, 10505, 10601, 10707, 10808, 10914];
    expect(data.rules.deployment.max).toBe(7);
    const seven = analyseDeck(
      eight,
      indexes,
      data.rules.deployment,
      [10914, 10101, 10102, 10403, 10505, 10601, 10707],
    );
    expect(seven.deployed).toEqual([10101, 10102, 10403, 10505, 10601, 10707, 10914]);
    expect(seven.reserve).toEqual([10808]);
    // 10808 (피쿼드호 선장) inflicts no Sinking, so the reserve count is empty.
    expect(seven.keywordCounts.reserve.Sinking).toBeUndefined();

    const capped = analyseDeck(eight, indexes, data.rules.deployment, eight);
    expect(capped.deployed).toEqual(eight.slice(0, 7));

    const nobody = analyseDeck(eight, indexes, data.rules.deployment, []);
    expect(nobody.deployed).toEqual([]);
    expect(nobody.reserve).toEqual(eight);
  });

  it('normalises `options.deployed` inside planRoute: dedupes, drops strangers, caps at max', () => {
    const eight = [10101, 10102, 10403, 10505, 10601, 10707, 10808, 10914];
    const result = plan({
      deck: eight,
      wanted: want(9088),
      options: options({ deployed: [10914, 10914, 99999, ...eight] }),
    });
    // Seven deployed (max), so the eighth (10914 is first in the override but last in deck order)
    // is still reserve: order comes from the deck, not the override.
    expect(result.conditions.length).toBeGreaterThan(0);
    expect(result.warnings.map((w) => w.code)).not.toContain('search-capped');
  });

  it('reports an unmet faction condition with the real counts', () => {
    const result = plan({ deck: [10101], wanted: want(9283), options: options({ hardFromFloor: 1 }) });
    const report = result.conditions.find((c) => c.giftId === 9283)!;
    expect(report.satisfied).toBe(false);
    expect(report.have).toBe(0);
    expect(report.need).toBe(3);
    expect(result.warnings.map((w) => w.code)).toContain('condition-unmet');
  });

  it('satisfies a Blade Lineage condition with a Blade Lineage deck', () => {
    const bladeIdentities = data.identities
      .filter((identity) => identity.factions.includes('BLADE_LINEAGE'))
      .slice(0, 3)
      .map((identity) => identity.id);
    expect(bladeIdentities.length).toBeGreaterThanOrEqual(3);
    const result = plan({
      deck: bladeIdentities,
      wanted: want(9280),
      options: options({ hardFromFloor: 1 }),
    });
    const report = result.conditions.find((c) => c.giftId === 9280)!;
    expect(report.satisfied).toBe(true);
    expect(report.have).toBeGreaterThanOrEqual(3);
  });

  it('still routes a gift whose condition the deck fails', () => {
    const result = plan({ deck: [10101], wanted: want(9283), options: options({ hardFromFloor: 1 }) });
    expect(result.floors.find((f) => f.floor === 5)?.packId).toBe(1025);
    expect(result.unresolved).toEqual([]);
  });

  it('ignores a start keyword with no pool, rather than handing out no starting gift', () => {
    // 범용 (`None`) is a gift keyword with no starting pool. The picker no longer offers it, but a
    // saved run or a share link made before that filter can still name it.
    expect(Object.keys(data.rules.startGift.poolsByKeyword)).not.toContain('None');
    const withNone = plan({ wanted: want(9003), options: options({ startKeyword: 'None' }) });
    const auto = plan({ wanted: want(9003), options: options({ startKeyword: 'auto' }) });
    expect(withNone.start.keyword).toBe(auto.start.keyword);
    expect(withNone.start.keyword).not.toBe('None');
    expect(withNone.start.startGifts).toEqual(auto.start.startGifts);
  });

  it('never picks 탄환 as the automatic start keyword, however many ammo identities the deck has', () => {
    // Five ammo users; 탄환 outnumbers every status keyword in this formation.
    const ammoDeck = [10611, 10711, 10414, 10512, 10514];
    const stats = analyseDeck(ammoDeck, indexes, data.rules.deployment);
    expect(stats.keywordCounts.formation.Bullet).toBe(5);
    const keyword = dominantKeyword(stats);
    expect(keyword).not.toBe('Bullet');
    expect(keyword).not.toBeNull();
    // 탄환 has no starting pool, so choosing it would leave the player with no starting gift.
    expect(Object.keys(data.rules.startGift.poolsByKeyword)).not.toContain('Bullet');
    const result = plan({ deck: ammoDeck, wanted: want(9003) });
    expect(result.start.keyword).toBe(keyword);
    expect(data.rules.startGift.poolsByKeyword[keyword!]!.length).toBeGreaterThan(0);
  });

  it('falls back to the deck dominant keyword when no starting pool holds a goal', () => {
    const stats = analyseDeck(BLADE_LINEAGE_DECK, indexes, data.rules.deployment);
    const keyword = dominantKeyword(stats);
    expect(keyword).not.toBeNull();
    // 9003 (재에서 재로) and 9283 (상납된 시가) are in no starting pool.
    const pooled = new Set(Object.values(data.rules.startGift.poolsByKeyword).flat());
    expect(pooled.has(9003) || pooled.has(9283)).toBe(false);
    const result = plan({ deck: BLADE_LINEAGE_DECK, wanted: want(9003, 9283) });
    expect(result.start).toMatchObject({
      keyword,
      startGifts: [],
      autoKeyword: keyword,
      autoStartGifts: [],
    });
  });

  it('follows the goals on auto: the keyword whose pool holds a wanted gift wins over the dominant one', () => {
    // MIXED_DECK is dominantly 파열, but 지옥나비의 꿈 (9001) sits only in the 화상 starting pool.
    const stats = analyseDeck(MIXED_DECK, indexes, data.rules.deployment);
    expect(dominantKeyword(stats)).toBe('Burst');
    expect(data.rules.startGift.poolsByKeyword.Combustion).toContain(9001);
    const result = plan({ wanted: want(9001) });
    expect(result.start).toMatchObject({
      keyword: 'Combustion',
      startGifts: [9001],
      autoKeyword: 'Combustion',
      autoStartGifts: [9001],
    });
    // Taken as the starting gift, so it is no longer a general drop the plan hopes for.
    expect(result.generalDrops).not.toContain(9001);
  });

  it('breaks a tie between helpful pools by the dominant keyword, then by keyword id', () => {
    // 9001 is in the 화상 pool and 9005 (상처붙이) in the 출혈 pool; both are general drops, so
    // neither is harder to route than the other.
    expect(data.rules.startGift.poolsByKeyword.Laceration).toContain(9005);
    // MIXED_DECK is 파열: neither pool is its own, so the keyword id decides.
    expect(plan({ wanted: want(9005, 9001) }).start).toMatchObject({
      keyword: 'Combustion',
      startGifts: [9001],
    });
    // BLADE_LINEAGE_DECK is 출혈: its own pool helps, so it wins.
    const blade = plan({ deck: BLADE_LINEAGE_DECK, wanted: want(9001, 9005) });
    expect(blade.start).toMatchObject({ keyword: 'Laceration', startGifts: [9005] });
  });

  it('keeps a requested keyword as it was, but reports what auto would have taken', () => {
    const result = plan({ wanted: want(9001), options: options({ startKeyword: 'Sinking' }) });
    expect(result.start).toMatchObject({
      keyword: 'Sinking',
      startGifts: [],
      autoKeyword: 'Combustion',
      autoStartGifts: [9001],
    });
    expect(result.generalDrops).toContain(9001);
    const asked = plan({ wanted: want(9001), options: options({ startKeyword: 'Combustion' }) });
    expect(asked.start).toMatchObject({ keyword: 'Combustion', startGifts: [9001], autoStartGifts: [9001] });
  });

  it('chooses the same start whatever order the goals come in', () => {
    const a = plan({ wanted: want(9005, 9001, 9283) });
    const b = plan({ wanted: want(9283, 9001, 9005) });
    const c = plan({ wanted: want(9005, 9001, 9283) });
    expect(JSON.stringify(a.start)).toBe(JSON.stringify(b.start));
    expect(JSON.stringify(a.start)).toBe(JSON.stringify(c.start));
  });

  it('suggests no starting gift mid-run, when the start is long past', () => {
    const result = plan({
      wanted: want(9001),
      options: options({ lastFloor: 15, hardFromFloor: 1, currentFloor: 3 }),
    });
    expect(result.start.startGifts).toEqual([]);
    expect(result.start.autoStartGifts).toEqual([]);
    expect(result.start.autoKeyword).toBe('Burst');
  });
});

describe('priority', () => {
  /** The app's 반드시/보통: only the named gifts are `required`, the rest are best-effort. */
  const wantWithMust = (giftIds: number[], must: number[]) =>
    giftIds.map((giftId) => ({ giftId, required: must.includes(giftId) }));

  it('never covers less when one gift is raised to 반드시', () => {
    // Reported case: these 32 goals all fitted with everything 보통, and marking 데스페라도(9235)
    // 반드시 dropped two others. Raising a priority may reorder the route, never shrink it — not
    // when the visit order decides an approximate answer (the old failure), and not when the
    // objective would rather route a required gift than let 기프트 관측 hand it over (9410, whose
    // ingredient 얼어붙은 아우성 costs a floor that three other goals were using).
    const goals = [
      9092, 9096, 9167, 9176, 9191, 9211, 9214, 9235, 9239, 9254, 9274, 9410, 9703, 9704, 9705, 9726, 9728,
      9729, 9730, 9731, 9746, 9747, 9750, 9761, 9765, 9767, 9768, 9770, 9771, 9814, 9816, 9828,
    ];
    const deck = [10104, 10214, 10313, 10414, 10608, 10716, 10813, 10916, 11114, 11214, 11004, 10510];
    const run = (must: number[]) =>
      planRoute(
        {
          deck,
          wanted: wantWithMust(goals, must),
          options: options({
            lastFloor: 15,
            hardFromFloor: 1,
            observedGifts: [9191],
            deployed: [10104, 10414, 10716, 10813, 10916, 11114, 11214],
          }),
        },
        data,
        indexes,
      );
    const base = run([]);
    expect(base.stats.coveredWanted).toBe(goals.length);
    for (const giftId of [9235, 9410, 9761]) {
      const raised = run([giftId]);
      expect(raised.stats.coveredWanted).toBe(base.stats.coveredWanted);
      expect(raised.unresolved.map((u) => u.giftId)).not.toContain(giftId);
    }
    // Raising every goal at once is the same question from the other end.
    expect(run(goals).stats.coveredWanted).toBe(base.stats.coveredWanted);
    // And this board is settled exhaustively, so those answers are optimal, not merely good.
    expect(base.warnings.map((w) => w.code)).not.toContain('search-capped');
  });

  it('still keeps a 반드시 gift when the floors genuinely cannot hold everything', () => {
    // Five EXTREME clear rewards, five floors: one has to go, and it is never the required one.
    const goals = [9250, 9251, 9252, 9253, 9254, 9255];
    const run = (must: number[]) =>
      planRoute(
        { deck: BLADE_LINEAGE_DECK, wanted: wantWithMust(goals, must), options: options({ lastFloor: 15 }) },
        noObservation,
        indexes,
      );
    const dropped = (plan: ReturnType<typeof run>) => plan.unresolved.map((u) => u.giftId);
    expect(dropped(run([])).length).toBeGreaterThan(0);
    for (const giftId of goals) expect(dropped(run([giftId]))).not.toContain(giftId);
  });

  it('takes an observation rescue that keeps a 반드시 goal even where it loses more 보통 goals (M160)', () => {
    // Arrange: the season reshaped so that the rescue costs floors. 생강꽃, 안경 그리고 전해진 편지
    // (9248) eats 상납된 시가 (9283, 교본 1025 on floor 5 only), 생강꽃 가지 (9419, 낙화 1010 on
    // floor 4 only) and 깨진 안경 (9423, 변하지 않는 1012 on floors 3~5); 부치지 못한 편지 (9424) eats
    // 9423 too, and 1012 is 9423's only pack. One observation slot. 도시를 사랑하는 당신을 위한 (9209,
    // 허세짙은 오만 1316 on floor 4 only) and 굴절 유리관 (9436, 1018 on floor 5 only) are 보통 goals
    // the observation pool does not hold.
    const floorsOf: Record<number, number[]> = { 1010: [4], 1012: [3, 4, 5], 1316: [4] };
    const season = {
      ...data,
      packs: data.packs.map((pack) =>
        floorsOf[pack.id]
          ? {
              ...pack,
              availability: { ...pack.availability, normal: [], hard: floorsOf[pack.id]!, parallel: [] },
            }
          : pack,
      ),
      gifts: data.gifts.map((gift) =>
        gift.id === 9248
          ? { ...gift, fusion: { ...gift.fusion!, recipes: [{ ingredients: [9283, 9419, 9423] }] } }
          : gift,
      ),
    };
    const reshaped = buildIndexes(season);
    const run = (required: boolean) =>
      planRoute(
        {
          deck: MIXED_DECK,
          wanted: [
            { giftId: 9248, required },
            { giftId: 9424, required },
            { giftId: 9209, required: false },
            { giftId: 9436, required: false },
          ],
          options: options({ lastFloor: 5, hardFromFloor: 1, observationSlots: 1 }),
        },
        season,
        reshaped,
      );
    // Act
    const must = run(true);
    const optional = run(false);
    // Assert: without observation the search keeps 9424 and the two 보통 goals and loses 9248 — one
    // 반드시 goal. Observing 9423 keeps both letters but 1010 and 1025 push the two 보통 goals out:
    // more goals lost, yet none that must be kept. The rescue is judged the way the search judges
    // itself, 반드시 before 보통, so it is taken; by the bare count it was turned down.
    expect(must.start.observed).toEqual([{ giftId: 9423, pinned: false, freedPack: null }]);
    expect(must.unresolved.map((u) => [u.giftId, u.reason])).toEqual([
      [9209, 'pack-conflict'],
      [9436, 'pack-conflict'],
    ]);
    expect(must.floors.filter((f) => f.packId !== null).map((f) => f.packId)).toEqual([1012, 1010, 1025]);
    // With every goal 보통 the same rescue loses two where the plain plan loses one: turned down.
    expect(optional.unresolved.map((u) => u.giftId)).toEqual([9248, 9283]);
    expect(optional.stats.coveredWanted).toBe(3);
  });
});

describe('shared ingredients', () => {
  /*
   * 장관 = 녹슨 칼자루(9713) + 조각난 칼날, 부동 = 9713 + 부서진 칼날.
   * 절경 = 조각난 칼날 + 낡은 칼자루(9782), 탁마 = 부서진 칼날 + 9782.
   * 9713 comes from 육참골단 and its 복각; 9782 only from the 복각.
   */
  const hard15 = (overrides: Partial<PlanOptions> = {}) =>
    options({ lastFloor: 15, hardFromFloor: 1, ...overrides });
  const floorOf = (result: RoutePlan, giftId: number): number[] =>
    result.floors.filter((f) => f.pickups.some((p) => p.giftId === giftId)).map((f) => f.floor);

  it('buys a copy per fusion from two different packs, and says the order matters', () => {
    const result = planWithout({ wanted: want(9717, 9718), options: hard15() });
    expect(result.stats.coveredWanted).toBe(2);
    expect(result.unresolved).toEqual([]);
    // Two floors, two packs: the game never offers a gift you are already holding.
    expect(floorOf(result, 9713)).toHaveLength(2);
    const packs = result.floors.filter((f) => f.pickups.some((p) => p.giftId === 9713)).map((f) => f.packId);
    expect(new Set(packs).size).toBe(2);
    const warning = result.warnings.find((w) => w.code === 'shared-ingredient');
    expect(warning?.giftIds).toEqual([9713]);
  });

  it('reports the copy it cannot buy, not a pack conflict, when only one pack supplies it', () => {
    const result = planWithout({ wanted: want(9783, 9784), options: hard15() });
    expect(result.stats.coveredWanted).toBe(1);
    const missing = result.unresolved.find((u) => u.giftId === 9782);
    expect(missing?.reason).toBe('ingredient-shared');
    expect(missing?.detail.ko).toContain('절경');
    expect(missing?.detail.ko).toContain('탁마');
    expect(result.unresolved.find((u) => u.giftId === 9784)?.reason).toBe('fusion-ingredient-unresolved');
    // Nothing is promised twice, so the order warning has nothing to say either.
    expect(result.warnings.map((w) => w.code)).not.toContain('shared-ingredient');
  });

  it('lets 기프트 관측 stand in for the second copy, saving the second pack', () => {
    const result = plan({ wanted: want(9717, 9718), options: hard15() });
    expect(result.stats.coveredWanted).toBe(2);
    expect(result.start.observed.map((o) => o.giftId)).toContain(9713);
    expect(result.stats.requiredPacks).toBe(1);
    // One copy still comes off the floor; the observed one is in hand from the start.
    expect(floorOf(result, 9713)).toHaveLength(1);
  });

  it('never revisits an entered pack for the second copy: that copy is ingredient-shared', () => {
    // With 육참골단 (1104) given up, its 복각 (1116) is the only source of 녹슨 칼자루 — and it was
    // entered on floor 7. The search used to place 1116 a second time for the second copy.
    const pinned = hard15({ currentFloor: 8, pinnedPacks: { 7: 1116 }, bannedPacks: [1104] });
    const result = planWithout({ wanted: want(9717, 9718), options: pinned });
    expect(result.floors.filter((f) => f.packId === 1116).map((f) => f.floor)).toEqual([7]);
    expect(result.floors.find((f) => f.floor === 7)).toMatchObject({ reason: 'pinned' });
    expect(floorOf(result, 9713)).toEqual([7]);
    expect(result.floors.find((f) => f.floor === 7)!.pickups.filter((p) => p.giftId === 9713)).toHaveLength(
      1,
    );
    expect(result.unresolved.find((u) => u.giftId === 9713)?.reason).toBe('ingredient-shared');
    expect(result.unresolved.filter((u) => u.reason === 'fusion-ingredient-unresolved')).toHaveLength(1);
    // The entered pack is the run's history, not a pack the plan still has to take.
    expect(result.stats).toMatchObject({ requiredPacks: 0, coveredWanted: 1 });
    expect(result.warnings.map((w) => w.code)).not.toContain('shared-ingredient');
  });

  it('reports a pack conflict, not a shared copy, when the other copy was given up on (M160)', () => {
    // Arrange: floors 1~4 are played with packs that carry none of these gifts, so floor 5 is
    // all that is left: 육참골단 복각 (1116, 조각난 칼날 9714 and 녹슨 칼자루 9713) against 교본
    // (1025, 달궈진 망치 9214). 장관 (9717 = 9713 + 9714) and 절경 (9783 = 9714 + 9782) both eat
    // 9714. The plan keeps 9214; 9717 is lost to 9713 and its 9714 copy is given up on, and
    // 9783's 9714 copy is the one that lost the floor. No copy of 9714 is planned at all, so
    // 「두 번째 몫을 줄 팩이 더 없습니다」 was false — the given-up copy counted as planned — and
    // the floor clash was hidden from the decision card.
    const played = hard15({
      lastFloor: 5,
      currentFloor: 5,
      pinnedPacks: { 1: 1001, 2: 1004, 3: 1008, 4: 1011 },
    });
    // Act
    const result = planWithout({ wanted: want(9717, 9783, 9214), options: played });
    // Assert
    expect(result.floors.find((f) => f.floor === 5)).toMatchObject({ packId: 1025 });
    expect(floorOf(result, 9714)).toEqual([]);
    expect(result.unresolved.find((u) => u.giftId === 9714)).toMatchObject({
      reason: 'pack-conflict',
      detail: { ko: expect.stringContaining('층이 겹쳐') },
    });
    expect(result.unresolved.find((u) => u.giftId === 9717)).toMatchObject({
      reason: 'fusion-ingredient-unresolved',
      missing: [9713],
      droppedIngredients: [9714],
    });
    expect(result.unresolved.map((u) => u.reason)).not.toContain('ingredient-shared');
    expect(result.warnings.map((w) => w.code)).not.toContain('shared-ingredient');
    // The floor the copy lost is contested: the decision card lists its occupant.
    expect([...contestedFloors(result, played, indexes)]).toEqual([5]);
    expect(result.stats.coveredWanted).toBe(1);
  });
});

describe('observation cost', () => {
  it('rises by the step for each use in a run', () => {
    expect(observationCost(0, data.rules, false)).toBe(0);
    expect(observationCost(1, data.rules, false)).toBe(20);
    expect(observationCost(2, data.rules, false)).toBe(50);
    expect(observationCost(3, data.rules, false)).toBe(90);
  });

  it('applies the unvisited-pack multiplier when asked', () => {
    expect(observationCost(1, data.rules, true)).toBe(30);
  });

  it('does not charge for an EXTREME floor, where observation is impossible', () => {
    const result = planWithout({
      wanted: want(9283),
      options: options({ lastFloor: 15 }),
    });
    for (const floor of result.floors.filter((f) => f.mode === 'extreme')) {
      expect(floor.observation.possible).toBe(false);
      expect(floor.observation.starlight).toBe(0);
    }
  });
});

describe('pins and bans', () => {
  it('keeps the pack entered on a played floor and charges no observation for it', () => {
    const result = plan({
      wanted: want(9283),
      options: options({ hardFromFloor: 1, currentFloor: 6, pinnedPacks: { 5: 1025 } }),
    });
    const floor5 = result.floors.find((f) => f.floor === 5)!;
    expect(floor5).toMatchObject({ packId: 1025, reason: 'pinned', passed: true });
    expect(floor5.observation.needed).toBe(false);
  });

  it('forces no pack onto a floor still ahead: the goals decide the route (M118)', () => {
    // 1012 is one of the packs that offer 깨진 안경 (9423); a pin used to put it on floor 5.
    const free = planWithout({ wanted: want(9423), options: options({ hardFromFloor: 1 }) });
    const pinned = planWithout({
      wanted: want(9423),
      options: options({ hardFromFloor: 1, pinnedPacks: { 5: 1012, 2: 1402 } }),
    });
    expect(pinned.floors).toEqual(free.floors);
    expect(pinned.floors.some((f) => f.reason === 'pinned')).toBe(false);
    expect(pinned.warnings.find((w) => w.code === 'pack-option-dropped')?.packIds).toEqual([1402, 1012]);
  });

  it('never uses a banned pack', () => {
    const result = planWithout({
      wanted: want(9283),
      options: options({ hardFromFloor: 1, bannedPacks: [1025] }),
    });
    expect(result.floors.every((f) => f.packId !== 1025)).toBe(true);
    expect(result.unresolved.map((u) => u.giftId)).toContain(9283);
  });
});

describe('guarantees', () => {
  it('is deterministic: the same input produces byte-identical output', () => {
    const input = {
      deck: MIXED_DECK,
      wanted: want(9283, 9222, 9088, 9003),
      options: options({ lastFloor: 10 }),
    };
    const first = planRoute(input, data, indexes);
    const second = planRoute(input, data, indexes);
    // Core keeps no clock (M160): `elapsedMs` is 0 until a caller times the call, so the whole
    // plan compares.
    expect(second).toEqual(first);
    expect(first.stats.elapsedMs).toBe(0);
  });

  it('never assigns the same pack to two floors', () => {
    const result = plan({
      wanted: want(9283, 9222, 9217, 9214, 9273),
      options: options({ lastFloor: 15 }),
    });
    const used = result.floors.map((f) => f.packId).filter((id): id is number => id !== null);
    expect(new Set(used).size).toBe(used.length);
  });

  it('only assigns packs that are actually available on their floor and mode', () => {
    const result = plan({
      wanted: want(9283, 9222, 9217, 9214, 9273),
      options: options({ lastFloor: 15 }),
    });
    for (const floor of result.floors) {
      if (floor.packId === null) continue;
      const pack = indexes.packById.get(floor.packId)!;
      expect(pack.availability[floor.mode], `floor ${floor.floor} pack ${floor.packId}`).toContain(
        floor.floor,
      );
    }
  });

  it('accounts for every wanted gift, either in the plan or in unresolved', () => {
    const wanted = want(9283, 9222, 9088, 9003, 9999999);
    const result = plan({ wanted, options: options({ lastFloor: 10 }) });
    const pickedUp = new Set(result.floors.flatMap((f) => f.pickups.map((p) => p.giftId)));
    const accountedFor = new Set([
      ...pickedUp,
      ...result.generalDrops,
      ...result.start.observed.map((o) => o.giftId),
      ...result.start.startGifts,
      ...result.fusions.map((f) => f.result),
      ...result.unresolved.map((u) => u.giftId),
    ]);
    for (const entry of wanted) expect(accountedFor.has(entry.giftId), String(entry.giftId)).toBe(true);
  });

  it('plans a 15-floor run with twenty wanted gifts inside the time budget', () => {
    const wanted = data.gifts
      .filter((g) => g.acquisition.kind === 'packLimited')
      .slice(0, 20)
      .map((g) => ({ giftId: g.id, required: true }));
    const started = performance.now();
    const result = planRoute(
      { deck: MIXED_DECK, wanted, options: options({ lastFloor: 15 }) },
      data,
      indexes,
    );
    const elapsed = performance.now() - started;
    expect(elapsed).toBeLessThan(100);
    expect(result.floors).toHaveLength(15);
  });

  it('handles an empty request without inventing work', () => {
    const result = plan({ wanted: [] });
    expect(result.floors.every((f) => f.packId === null)).toBe(true);
    expect(result.unresolved).toEqual([]);
    expect(result.stats.totalWanted).toBe(0);
  });

  it('reports an unknown gift id instead of crashing', () => {
    const result = plan({ wanted: want(9999999) });
    expect(result.unresolved).toEqual([
      expect.objectContaining({ giftId: 9999999, reason: 'not-obtainable' }),
    ]);
  });
});

describe('floor windows', () => {
  it('pins a pack that is offered on a single Hard floor', () => {
    const result = planWithout({ wanted: want(9283), options: options({ hardFromFloor: 1 }) });
    const floor5 = result.floors.find((f) => f.floor === 5)!;
    expect(floor5.packId).toBe(1025);
    expect(floor5.window).toEqual({ from: 5, to: 5 });
    expect(result.floors.filter((f) => f.packId === null).every((f) => f.window === null)).toBe(true);
  });

  it('reports the whole 4-5 range for 변하지 않는 when nothing else competes', () => {
    // 9423 깨진 안경 is exclusive to pack 1012, offered on Hard floors 4 and 5.
    const result = planWithout({ wanted: want(9423), options: options({ hardFromFloor: 1 }) });
    const used = result.floors.find((f) => f.packId === 1012)!;
    expect(used.window).toEqual({ from: 4, to: 5 });
  });

  it('shrinks the window when another required pack takes one of its floors', () => {
    // 9208 인연 얽힘 needs 해방된 분노 (1302), which only appears on Hard floor 5.
    const result = planWithout({ wanted: want(9423, 9208), options: options({ hardFromFloor: 1 }) });
    const unchanging = result.floors.find((f) => f.packId === 1012)!;
    const wrath = result.floors.find((f) => f.packId === 1302)!;
    expect(wrath.floor).toBe(5);
    expect(wrath.window).toEqual({ from: 5, to: 5 });
    expect(unchanging.floor).toBe(4);
    expect(unchanging.window).toEqual({ from: 4, to: 4 });
  });

  it('reports joint possibilities: two packs that could swap floors both keep a window', () => {
    // 9427 마을을 지킬 작살 → 기어오는 심연 (1014, Hard 3-4); 9423 깨진 안경 → 변하지 않는 (1012, Hard 4-5).
    // 1014@3+1012@4, 1014@3+1012@5 and 1014@4+1012@5 are all valid, so neither pack is fixed.
    const result = planWithout({ wanted: want(9427, 9423), options: options({ hardFromFloor: 1 }) });
    const abyss = result.floors.find((f) => f.packId === 1014)!;
    const unchanging = result.floors.find((f) => f.packId === 1012)!;
    expect(abyss.window).toEqual({ from: 3, to: 4 });
    expect(unchanging.window).toEqual({ from: 4, to: 5 });
  });

  it('spans the whole run of floors a pack is offered on, across the band boundary', () => {
    // 상납된 시가 (1025) and 새하얀 캔버스 (1026) are both offered on Hard 5 and on 평행중첩 6-10.
    // Two packs over six floors, so either may sit anywhere in 5-10 while the other takes a
    // different floor — the window says so rather than stopping at the band the search happened to
    // place the pack in.
    const result = planWithout({
      wanted: want(9283, 9222),
      options: options({ lastFloor: 10 }),
    });
    const parallel = result.floors.find((f) => f.packId !== null && f.mode === 'parallel')!;
    expect(parallel.window).toEqual({ from: 5, to: 10 });
    const hard = result.floors.find((f) => f.packId !== null && f.mode === 'hard')!;
    expect(hard.window).toEqual({ from: 5, to: 10 });
  });

  it('lets a window cross the Hard / 평행중첩 boundary when the pack is offered on both sides', () => {
    // This is the shape the reporter hit: 1호선 (1108, Hard 5 + 6~10) and 2호선 (1109, Hard 4-5 +
    // 6~10) both have to be visited, and either may take floor 5 while the other goes above it.
    // Clipping each window at the band it was placed in used to offer only one pack on floor 5.
    const result = planWithout({
      wanted: want(9751, 9753),
      options: options({ hardFromFloor: 1, lastFloor: 10 }),
    });
    const first = result.floors.find((f) => f.packId === 1108)!;
    const second = result.floors.find((f) => f.packId === 1109)!;
    expect(first.window).toEqual({ from: 5, to: 10 });
    expect(second.window).toEqual({ from: 4, to: 10 });
  });

  it('stops a window at a floor the pack is not offered on, so two bands never merge', () => {
    // 1호선 : 광기 (1513) is EXTREME-only, so nothing can stretch a window across 6~10 into it.
    const result = planWithout({
      wanted: want(9751),
      options: options({ hardFromFloor: 1, lastFloor: 15 }),
    });
    const railway = result.floors.find((f) => f.packId === 1108)!;
    expect(railway.window).toEqual({ from: 5, to: 10 });
  });

  it('clamps lastFloor into 1-15', () => {
    const result = planWithout({ wanted: want(9283), options: options({ lastFloor: 99 }) });
    expect(result.floors.at(-1)!.floor).toBe(15);
  });
});

describe('upgradeOf', () => {
  it('folds 요리 비법 전서 under 진혼 and leaves shared ingredients alone', () => {
    expect(indexes.giftById.get(9157)!.upgradeOf).toBe(9088);
    expect(indexes.giftById.get(9088)!.upgradeOf).toBeNull();
    const pairs = data.gifts.filter((g) => g.upgradeOf !== null);
    // 76 → 78 (OpenLethe af2aa4df): 9262 모든 것의 뼈대 and 9268 모든 것의 본능 gained their
    // 출혈 keyword in ego-gift-story-twth.json, so they now fold under 9263 / 9264.
    expect(pairs.length).toBe(78);
    for (const g of pairs) {
      const parent = indexes.giftById.get(g.upgradeOf!)!;
      expect(parent.keyword, `${g.id}`).toBe(g.keyword);
    }
  });
});

describe('gift observation', () => {
  it('honours a pinned observation and routes the rest', () => {
    const result = plan({
      wanted: want(9283, 9222),
      options: options({ hardFromFloor: 1, observedGifts: [9222] }),
    });
    expect(result.start.observed).toEqual([{ giftId: 9222, pinned: true, freedPack: null }]);
    expect(result.floors.find((f) => f.floor === 5)!.packId).toBe(1025);
    expect(result.unresolved).toEqual([]);
  });

  it('recommends observing a gift whose pack the route would otherwise be forced to visit', () => {
    const result = plan({ wanted: want(9423), options: options({ hardFromFloor: 1 }) });
    expect(result.start.observed).toEqual([{ giftId: 9423, pinned: false, freedPack: 1012 }]);
    expect(result.stats.requiredPacks).toBe(0);
    expect(result.start.starlight).toBe(70);
    expect(result.floors.every((f) => f.packId === null)).toBe(true);
  });

  it('frees several packs while slots remain', () => {
    const result = plan({ wanted: want(9427, 9423), options: options({ hardFromFloor: 1 }) });
    expect(result.start.observed.map((o) => o.giftId)).toEqual([9423, 9427]);
    expect(result.start.observed.map((o) => o.freedPack)).toEqual([1012, 1014]);
    expect(result.stats.requiredPacks).toBe(0);
  });

  it('spends only the slots the player left on, pins included (M120 「관측하지 않기」)', () => {
    // Five single-source exclusives on Hard floor 5: with every slot the planner observes three.
    const wanted = want(9283, 9222, 9217, 9435, 9751);
    const all = plan({ wanted, options: options({ hardFromFloor: 1 }) });
    expect(all.start.observed).toHaveLength(3);
    // One slot off: two observations, and one goal more is left to the packs.
    const two = plan({ wanted, options: options({ hardFromFloor: 1, observationSlots: 2 }) });
    expect(two.start.observed).toHaveLength(2);
    expect(two.stats.coveredWanted).toBe(all.stats.coveredWanted - 1);
    // Every slot off: none, even a pin; out of range is clamped.
    const none = plan({
      wanted,
      options: options({ hardFromFloor: 1, observationSlots: 0, observedGifts: [9283] }),
    });
    expect(none.start.observed).toEqual([]);
    expect(
      plan({ wanted, options: options({ hardFromFloor: 1, observationSlots: 9 }) }).start.observed,
    ).toHaveLength(3);
  });

  it('rescues first and leaves a conflict it cannot afford', () => {
    // Five single-source exclusives whose packs all sit on Hard floor 5: three observations plus
    // one routed pack cover four; the fifth stays a conflict.
    const result = plan({
      wanted: want(9283, 9222, 9217, 9435, 9751),
      options: options({ hardFromFloor: 1 }),
    });
    expect(result.start.observed).toHaveLength(3);
    expect(result.start.observed.every((o) => !o.pinned)).toBe(true);
    expect(result.stats.coveredWanted).toBe(4);
    expect(result.unresolved.map((u) => u.reason)).toEqual(['pack-conflict']);
  });

  it('rescues a must-have before the others when observations run short', () => {
    const wanted = [9283, 9222, 9217, 9435, 9751].map((giftId) => ({ giftId, required: giftId === 9751 }));
    const result = plan({ wanted, options: options({ hardFromFloor: 1 }) });
    expect(result.unresolved.map((u) => u.giftId)).not.toContain(9751);
    expect(result.stats.coveredWanted).toBe(4);
  });

  it('drops pinned gifts that cannot be observed and says so', () => {
    const result = plan({
      wanted: want(9283),
      options: options({ hardFromFloor: 1, observedGifts: [9283, 9283, 999999] }),
    });
    expect(result.start.observed).toEqual([]);
    expect(result.warnings.map((w) => w.code)).toContain('observation-trimmed');
    expect(result.floors.find((f) => f.floor === 5)!.packId).toBe(1025);
  });

  it('follows the observation pool from the season data', () => {
    expect(indexes.giftById.get(9222)!.observable).toBe(true);
    expect(indexes.giftById.get(9283)!.observable).toBe(false);
    expect(indexes.giftById.get(9250)!.observable).toBe(false);
    expect(data.rules.giftObservation).toMatchObject({ max: 3, costTable: [70, 160, 270], verified: true });
  });
});

describe('clear rewards and hidden battles', () => {
  it('routes a 클리어 보상 gift to its EXTREME pack as an exclusive pickup, never on the last floor', () => {
    const result = plan({ wanted: want(9250), options: options({ lastFloor: 15 }) });
    const floor = result.floors.find((f) => f.packId === 1511)!;
    expect(floor.mode).toBe('extreme');
    expect(floor.pickups).toEqual([{ giftId: 9250, kind: 'exclusive', neededFor: null }]);
    // The run ends with floor 15's boss before the pack's clear reward is handed out (M173), so
    // the window stops a floor short of the band even though the pack is offered on 15.
    expect(indexes.finalFloor).toBe(15);
    expect(indexes.packsByFloor.extreme.get(15)).toContain(1511);
    expect(floor.window).toEqual({ from: 11, to: 14 });
    expect(result.unresolved).toEqual([]);
    expect(result.start.observed).toEqual([]);
  });

  it('fits four clear rewards below the last floor and reports the fifth as a floor clash (M173)', () => {
    // Arrange: five EXTREME packs' rewards; floors 11~14 hold four packs and 15 hands out none.
    const rewards = [9250, 9251, 9252, 9253, 9254];
    // Act
    const result = plan({ wanted: want(...rewards), options: options({ lastFloor: 15 }) });
    // Assert
    const placed = result.floors.filter((f) => f.packId !== null && f.packId >= 1511 && f.packId <= 1520);
    expect(placed.map((f) => f.floor)).toEqual([11, 12, 13, 14]);
    expect(result.floors.find((f) => f.floor === 15)?.packId ?? null).toBeNull();
    expect(result.unresolved).toHaveLength(1);
    expect(result.unresolved[0]).toMatchObject({ reason: 'pack-conflict' });
    expect(rewards).toContain(result.unresolved[0]!.giftId);
    // The clash is over 11~14, not the floor that gives no reward.
    expect([...contestedFloors(result, options({ lastFloor: 15 }), indexes)]).toEqual([11, 12, 13, 14]);
  });

  it('names a clear reward lost to the last floor: the pack is still ahead, but only there (M173)', () => {
    // Arrange: floors 11~14 are played with other EXTREME packs; 코드 퍼플 could only be entered on 15.
    const played = options({
      lastFloor: 15,
      hardFromFloor: 1,
      currentFloor: 15,
      pinnedPacks: { 11: 1512, 12: 1513, 13: 1514, 14: 1515 },
    });
    // Act
    const result = plan({ wanted: want(9250), options: played });
    // Assert
    expect(result.floors.find((f) => f.floor === 15)?.packId ?? null).toBeNull();
    expect(result.unresolved).toEqual([
      {
        giftId: 9250,
        reason: 'final-floor',
        detail: {
          ko: '보급형 K사 앰플은 클리어 보상이라 15층의 팩에서는 얻지 못합니다 — 마지막 층의 보스를 잡으면 런이 끝납니다.',
          en: "Mid-range K Corp. Ampule is a clear reward, and a pack on floor 15 hands out none — the run ends with the last floor's boss.",
        },
      },
    ]);
    expect([...contestedFloors(result, played, indexes)]).toEqual([]);
  });

  it('still lets a pack take the last floor when its clear reward is not wanted', () => {
    // Arrange: five EXTREME packs asked for as packs (CLI `--prefer`), no reward among the goals.
    const packs = [1511, 1512, 1513, 1514, 1515];
    // Act
    const result = plan({ wanted: [], options: options({ lastFloor: 15, preferredPacks: packs }) });
    // Assert: all five fit, one of them on the floor that gives no reward.
    expect(result.warnings.map((w) => w.code)).not.toContain('pack-option-dropped');
    expect(result.floors.filter((f) => f.packId !== null).map((f) => f.floor)).toEqual([11, 12, 13, 14, 15]);
    expect(packs).toContain(result.floors.find((f) => f.floor === 15)!.packId);
  });

  it('reports a clear reward as out of range below floor 11', () => {
    const result = plan({ wanted: want(9250), options: options({ lastFloor: 5 }) });
    expect(result.unresolved).toEqual([
      expect.objectContaining({ giftId: 9250, reason: 'no-pack-in-range' }),
    ]);
  });

  it('reports event and material gifts as having no pack path, not as out of range', () => {
    // 9227 (귀기 서린 환도) comes from a choice event and 9991 (어두운 잔영) is a fusion/sale
    // material. Neither sits in any pack pool, so the search would otherwise blame the floor range.
    expect(indexes.giftById.get(9227)!.acquisition).toMatchObject({ kind: 'event', packs: [] });
    expect(indexes.giftById.get(9991)!.acquisition).toMatchObject({ kind: 'material', packs: [] });
    expect(indexes.packsByGift.get(9227) ?? []).toEqual([]);
    expect(indexes.packsByGift.get(9991) ?? []).toEqual([]);

    const result = plan({ wanted: want(9227, 9991), options: options({ lastFloor: 15 }) });
    expect(result.unresolved).toEqual([
      {
        giftId: 9227,
        reason: 'no-pack-path',
        detail: {
          ko: '선택지·이벤트로만 얻는 기프트라 팩 루트로 계획할 수 없습니다.',
          en: 'Only obtained through a choice event, so no pack route can plan for it.',
        },
      },
      {
        giftId: 9991,
        reason: 'no-pack-path',
        detail: {
          ko: '잔영은 조합·판매용 재료라 팩 루트로 계획할 수 없습니다.',
          en: 'A fusion/sale material; no pack route can plan for it.',
        },
      },
    ]);
    expect(result.unresolved.filter((u) => u.giftId === 9227)).toHaveLength(1);
    expect(result.unresolved.filter((u) => u.giftId === 9991)).toHaveLength(1);
    expect(result.stats.coveredWanted).toBe(0);
    expect(result.stats.requiredPacks).toBe(0);
    expect(result.floors.every((f) => f.packId === null)).toBe(true);
  });

  it('never plans for a hidden-battle gift', () => {
    const result = plan({ wanted: want(9256), options: options({ lastFloor: 15 }) });
    expect(result.unresolved).toEqual([expect.objectContaining({ giftId: 9256, reason: 'chance-only' })]);
    expect(result.stats.requiredPacks).toBe(0);
    expect(result.unresolved[0]!.detail.ko).toContain('11~15층');
  });

  it('classifies the four researched gifts', () => {
    expect(indexes.giftById.get(9828)!.acquisition).toMatchObject({
      kind: 'clearReward',
      clearRewardOf: 1519,
      packs: [1519],
    });
    expect(indexes.giftById.get(9251)!.acquisition).toMatchObject({
      kind: 'clearReward',
      clearRewardOf: 1512,
    });
    expect(indexes.giftById.get(9254)!.acquisition).toMatchObject({
      kind: 'clearReward',
      clearRewardOf: 1515,
    });
    expect(indexes.giftById.get(9256)!.acquisition.kind).toBe('hiddenBattle');
  });
});

describe('drop effects (M80)', () => {
  it('measures every candidate goal by the conflicts leaving it out alone clears', () => {
    const input = {
      deck: BLADE_LINEAGE_DECK,
      wanted: want(9283, 9222, 9423),
      options: options({ hardFromFloor: 1 }),
    };
    const analysis = planDropEffects(input, noObservation, indexes);
    expect(analysis.conflicts).toBe(1);
    const reduces = Object.fromEntries(analysis.effects.map((e) => [e.giftId, e.reduces]));
    expect(reduces[9283]).toBe(1);
    expect(reduces[9222]).toBe(1);
    // Most helpful first, and a single drop that clears it is the resolving set.
    expect(analysis.effects[0]!.reduces).toBe(1);
    expect(analysis.resolving!.dropped).toHaveLength(1);
  });

  it('falls back to the bundle when no single drop clears the conflicts', () => {
    const input = {
      deck: BLADE_LINEAGE_DECK,
      wanted: want(9277, 9744, 9751, 9766, 9842),
      options: options({ hardFromFloor: 1 }),
    };
    const analysis = planDropEffects(input, noObservation, indexes);
    expect(analysis.conflicts).toBe(2);
    expect(analysis.effects.every((e) => e.reduces < 2)).toBe(true);
    expect(analysis.resolving!.dropped).toEqual([9751, 9842]);
    expect(conflictRootsOf(analysis.resolving!.plan, input, noObservation, indexes)).toEqual([]);
  });

  it('counts observed goals (an observation slot frees up) and gives a shared pack no bar', () => {
    // Floors 1~4 only: three 1층 gifts ride the observation slots and two goals are still left out.
    // 도둑맞은 해결사 잡지 (9220) and 열선 무기 (9221) come from the same pack: neither alone frees it.
    const deck = [10112, 10216, 10311, 10415, 10512, 10604, 10715, 10808, 10916, 11009, 11115, 11216];
    const input = {
      deck,
      wanted: [9403, 9413, 9431, 9407, 9701, 9415, 9428, 9221, 9220, 9433].map((giftId) => ({
        giftId,
        required: false,
      })),
      options: options({ lastFloor: 15, hardFromFloor: 1, deployed: deck.slice(0, 7) }),
    };
    const main = planRoute(input, data, indexes);
    expect(main.start.observed.map((o) => o.giftId)).toContain(9413);
    const analysis = planDropEffects(input, data, indexes, main);
    const reduces = Object.fromEntries(analysis.effects.map((e) => [e.giftId, e.reduces]));
    expect(analysis.conflicts).toBe(2);
    expect(reduces[9413]).toBe(1);
    expect(reduces[9220]).toBe(0);
    expect(reduces[9221]).toBe(0);
    expect(analysis.effects.map((e) => e.giftId).slice(-2)).toEqual([9220, 9221]);
  });

  it('steps one bar at a time to the same answer, with sorted bars in between (M81)', () => {
    const input = {
      deck: BLADE_LINEAGE_DECK,
      wanted: want(9277, 9744, 9751, 9766, 9842),
      options: options({ hardFromFloor: 1 }),
    };
    const whole = planDropEffects(input, noObservation, indexes);
    const steps = createDropEffects(input, noObservation, indexes);
    expect(steps.conflicts).toBe(2);
    let count = 0;
    while (!steps.done()) {
      steps.step();
      count += 1;
      const partial = steps.snapshot().effects;
      // The first steps are the forced plans (M115, one per lost goal); a bar per step follows.
      expect(partial).toHaveLength(Math.max(0, count - 2));
      expect(partial.map((e) => e.reduces)).toEqual([...partial.map((e) => e.reduces)].sort((x, y) => y - x));
    }
    const final = steps.finish();
    expect(final.effects.map((e) => [e.giftId, e.reduces])).toEqual(
      whole.effects.map((e) => [e.giftId, e.reduces]),
    );
    expect(final.resolving!.dropped).toEqual(whole.resolving!.dropped);
    // A partial snapshot only knows single drops; the bundle comes with `finish`.
    expect(steps.snapshot().resolving).toBeNull();
    expect(steps.finish()).toBe(final);
  });

  it('plans the bundle once, whether or not it fits (M160)', () => {
    // Arrange: a planner that counts its calls. On the first board the bundle fits; on the second
    // the two 반드시 goals fight over floor 5 and the bundle (the lost 보통 pair) cannot clear that,
    // so it does not fit — and used to be planned again on every `finish()`.
    const boards = [
      { wanted: want(9277, 9744, 9751, 9766, 9842), fits: true },
      {
        wanted: [9283, 9222, 9290, 9291, 9744, 9745, 9427, 9428].map((giftId) => ({
          giftId,
          required: giftId === 9283 || giftId === 9222,
        })),
        fits: false,
      },
    ];
    for (const { wanted, fits } of boards) {
      const input = { deck: BLADE_LINEAGE_DECK, wanted, options: options({ hardFromFloor: 1 }) };
      let calls = 0;
      const planner = (of: PlanInput) => {
        calls += 1;
        return planRoute(of, noObservation, indexes);
      };
      const steps = createDropEffects(input, noObservation, indexes, undefined, { planner, maxRuns: 3 });
      expect(steps.conflicts).toBeGreaterThanOrEqual(2);
      // Act: finish early (the bundle is planned here), then step on and finish twice more.
      while (steps.forcing()) steps.step();
      const early = steps.finish();
      const afterBundle = calls;
      steps.step();
      const later = steps.finish();
      const again = steps.finish();
      // Assert: one plan for the step, none for the bundle again.
      expect(early.resolving === null).toBe(!fits);
      expect(later.resolving).toBe(early.resolving);
      expect(again).toBe(later);
      expect(calls).toBe(afterBundle + 1);
    }
  });

  it('never measures a goal the user must have, and stays deterministic', () => {
    const wanted = [9250, 9251, 9252, 9253, 9254, 9255].map((giftId) => ({
      giftId,
      required: giftId === 9255,
    }));
    const input = { deck: BLADE_LINEAGE_DECK, wanted, options: options({ lastFloor: 15 }) };
    const main = planRoute(input, data, indexes);
    expect(main.unresolved.map((u) => u.giftId)).not.toContain(9255);
    const analysis = planDropEffects(input, data, indexes, main, { maxRuns: Infinity });
    expect(analysis.effects.length).toBeGreaterThan(0);
    expect(analysis.effects.map((e) => e.giftId)).not.toContain(9255);
    expect(analysis.resolving?.dropped ?? []).not.toContain(9255);
    const again = planDropEffects(input, data, indexes, main, { maxRuns: Infinity });
    const key = (a: typeof analysis) =>
      JSON.stringify(a.effects.map((e) => [e.giftId, e.reduces, e.plan.floors.map((f) => f.packId)]));
    expect(key(again)).toBe(key(analysis));
  });

  it('spends no runs without a conflict, and stays within the budget', () => {
    expect(
      planDropEffects(
        { deck: BLADE_LINEAGE_DECK, wanted: want(9423), options: options({ hardFromFloor: 1 }) },
        data,
        indexes,
      ),
    ).toEqual({ conflicts: 0, effects: [], resolving: null, tradeoffs: [], skipped: 0 });
    const input = {
      deck: BLADE_LINEAGE_DECK,
      wanted: want(9250, 9251, 9252, 9253, 9254, 9255),
      options: options({ lastFloor: 15 }),
    };
    const capped = planDropEffects(input, data, indexes, undefined, { maxRuns: 3 });
    expect(capped.effects).toHaveLength(3);
    // What the cap left out is said, not hidden (M115).
    expect(capped.skipped).toBeGreaterThan(0);
  });
});

describe('drop causes (M115)', () => {
  it('names the goal a lost goal fights, puts it first and marks why each goal is a candidate', () => {
    const input = {
      deck: BLADE_LINEAGE_DECK,
      wanted: want(9283, 9222, 9423),
      options: options({ hardFromFloor: 1 }),
    };
    const analysis = planDropEffects(input, noObservation, indexes);
    expect(analysis.tradeoffs).toEqual([{ lost: 9283, causes: [9222], rivals: [9222] }]);
    const roles = Object.fromEntries(analysis.effects.map((e) => [e.giftId, e.role]));
    // 9423 was picked last: the likeliest cause, measured right after the two sides.
    expect(roles).toEqual({ 9222: 'cause', 9283: 'lost', 9423: 'recent' });
  });

  it('finds a cause for each lost goal, and every rival the bars show keeps it', () => {
    const input = {
      deck: BLADE_LINEAGE_DECK,
      wanted: want(9277, 9744, 9751, 9766, 9842),
      options: options({ hardFromFloor: 1 }),
    };
    const analysis = planDropEffects(input, noObservation, indexes);
    // The forced plan for 9842 gives up 9766; leaving 9744 out alone keeps 9842 too.
    expect(analysis.tradeoffs).toEqual([
      { lost: 9751, causes: [9277], rivals: [9277] },
      { lost: 9842, causes: [9766], rivals: [9744, 9766] },
    ]);
  });

  it('counts a fusion starved of its shared ingredient as one conflict, with the other fusion its cause', () => {
    // 절경 (9783) and 탁마 (9784) both eat 낡은 칼자루 (9782), which only one pack drops.
    const input = {
      deck: MIXED_DECK,
      wanted: want(9783, 9784),
      options: options({ lastFloor: 15, hardFromFloor: 1 }),
    };
    const main = planRoute(input, noObservation, indexes);
    expect(main.unresolved.find((u) => u.giftId === 9782)?.reason).toBe('ingredient-shared');
    expect(conflictRootsOf(main, input, noObservation, indexes)).toEqual([9784]);
    const analysis = planDropEffects(input, noObservation, indexes, main);
    expect(analysis.conflicts).toBe(1);
    expect(analysis.tradeoffs).toEqual([{ lost: 9784, causes: [9783], rivals: [9783] }]);
    expect(analysis.resolving?.dropped).toHaveLength(1);
  });

  it('measures the goal holding the start gift, which no forced plan can name', () => {
    const input = {
      deck: BLADE_LINEAGE_DECK,
      wanted: want(9150, 9758, 9178, 9440, 9245),
      options: options({ hardFromFloor: 1, lastFloor: 5 }),
    };
    const main = planRoute(input, noObservation, indexes);
    expect(main.start.startGifts).toEqual([9150]);
    const analysis = planDropEffects(input, noObservation, indexes, main);
    expect(analysis.effects.find((e) => e.giftId === 9150)?.role).toBe('start');
  });

  it('says which goals share the pack when leaving one out alone frees nothing', () => {
    const deck = [10112, 10216, 10311, 10415, 10512, 10604, 10715, 10808, 10916, 11009, 11115, 11216];
    const input = {
      deck,
      wanted: [9403, 9413, 9431, 9407, 9701, 9415, 9428, 9221, 9220, 9433].map((giftId) => ({
        giftId,
        required: false,
      })),
      options: options({ lastFloor: 15, hardFromFloor: 1, deployed: deck.slice(0, 7) }),
    };
    const analysis = planDropEffects(input, data, indexes);
    const byId = new Map(analysis.effects.map((e) => [e.giftId, e]));
    expect(byId.get(9220)?.sharesPackWith).toContain(9221);
    expect(byId.get(9221)?.sharesPackWith).toContain(9220);
    expect(analysis.effects.filter((e) => e.reduces > 0).every((e) => e.sharesPackWith === undefined)).toBe(
      true,
    );
  });

  it('measures the rest on demand once the cap stopped it', () => {
    const input = {
      deck: BLADE_LINEAGE_DECK,
      wanted: want(9250, 9251, 9252, 9253, 9254, 9255),
      options: options({ lastFloor: 15 }),
    };
    const steps = createDropEffects(input, data, indexes, undefined, { maxRuns: 2 });
    while (!steps.done()) steps.step();
    const first = steps.finish();
    expect(first.effects).toHaveLength(2);
    expect(first.skipped).toBeGreaterThan(0);
    steps.extend();
    expect(steps.done()).toBe(false);
    while (!steps.done()) steps.step();
    const all = steps.finish();
    expect(all).not.toBe(first);
    expect(all.effects).toHaveLength(2 + first.skipped);
    expect(all.skipped).toBe(0);
    expect(all.effects.map((e) => e.giftId).sort()).toEqual(
      planDropEffects(input, data, indexes, undefined, { maxRuns: Infinity })
        .effects.map((e) => e.giftId)
        .sort(),
    );
  });
});

describe('floor-window lower bound (M82) and tie-break budget (M83)', () => {
  const { data, indexes } = measuredSeason;
  const all = Array.from({ length: 15 }, (_, i) => i + 1);
  const run = (ids: number[], lowerBound: boolean, tieBreakNodes = Number.POSITIVE_INFINITY, seed = true) => {
    const stats = analyseDeck(BLADE_LINEAGE_DECK, indexes, data.rules.deployment);
    const { requirements } = expandRequirements(
      ids.map((giftId) => ({ giftId, required: false })),
      indexes,
      stats,
      data.rules.fusion.maxShopSlots,
    );
    return assignPacks({
      requirements,
      floors: all,
      options: options({ lastFloor: 15, hardFromFloor: 1 }),
      rules: data.rules,
      indexes,
      lowerBound,
      tieBreakNodes,
      seed,
    });
  };
  const same = (ids: number[]) => {
    const on = run(ids, true);
    const off = run(ids, false);
    if (on.capped || off.capped) return null;
    expect(on.unresolvedKeys).toEqual(off.unresolvedKeys);
    expect([...on.assignment].sort((a, b) => a[0] - b[0])).toEqual(
      [...off.assignment].sort((a, b) => a[0] - b[0]),
    );
    expect([...on.supplier].sort()).toEqual([...off.supplier].sort());
    expect(on.nodes).toBeLessThanOrEqual(off.nodes);
    return on.nodes < off.nodes;
  };

  it('changes no answer the search finishes, and never costs nodes', () => {
    // The two examples the decision card was built on: seven goals for five EXTREME floors, and ten
    // 1~4층 goals whose packs crowd floors 1~4.
    same([9250, 9251, 9252, 9253, 9254, 9255, 9827]);
    expect(same([9403, 9413, 9431, 9407, 9701, 9415, 9428, 9221, 9220, 9433])).toBe(true);
    // Seeded random boards of pack-bound gifts, small enough to finish without the node cap.
    const pool = data.gifts
      .filter(
        (g) => g.acquisition.kind === 'packLimited' && (indexes.packsByGift.get(g.id) ?? []).length <= 2,
      )
      .map((g) => g.id)
      .sort((a, b) => a - b);
    let seed = 20261005;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    let finished = 0;
    for (let board = 0; board < 40; board += 1) {
      const ids = new Set<number>();
      const size = 6 + Math.floor(next() * 10);
      while (ids.size < size) ids.add(pool[Math.floor(next() * pool.length)]!);
      if (same([...ids]) !== null) finished += 1;
    }
    expect(finished).toBeGreaterThan(30);
  });

  /*
   * M83: once the best plan's misses meet the root bound they are optimal, and the search only
   * breaks ties on packs and floors for `tieBreakNodes` more nodes.
   */
  const giftsOf = (kind: string) =>
    data.gifts
      .filter((g) => g.obtainable && g.acquisition.kind === kind && !indexes.freelyAvailableGifts.has(g.id))
      .map((g) => g.id);
  const mixed = [...giftsOf('fusionOnly').slice(0, 20), ...giftsOf('packLimited')].sort((a, b) => a - b);
  const every = (n: number) => mixed.filter((_, i) => i % Math.floor(mixed.length / n) === 0).slice(0, n);

  it('stops breaking ties once the misses are proven, without missing more', () => {
    // Fifteen goals this deck cannot all fit: four misses, and without the budget the whole node cap
    // goes into comparing plans that miss four on packs and floors.
    const ids = every(15);
    const cut = run(ids, true, 5_000);
    const full = run(ids, true);
    expect(full.capped).toBe(true);
    expect(cut.capped).toBe(false);
    expect(cut.tieBreakCut).toBe(true);
    expect(cut.nodes).toBeLessThan(full.nodes / 10);
    expect(cut.unresolvedKeys.length).toBe(full.unresolvedKeys.length);
  });

  it('never misses more however small the tie-break budget', () => {
    // A budget of 20 cuts nearly every board right after its first optimal plan; the misses hold.
    const pool = data.gifts
      .filter(
        (g) => g.acquisition.kind === 'packLimited' && (indexes.packsByGift.get(g.id) ?? []).length <= 2,
      )
      .map((g) => g.id)
      .sort((a, b) => a - b);
    let seed = 20261006;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    let cut = 0;
    for (let board = 0; board < 30; board += 1) {
      const ids = new Set<number>();
      const size = 6 + Math.floor(next() * 10);
      while (ids.size < size) ids.add(pool[Math.floor(next() * pool.length)]!);
      const full = run([...ids], true);
      if (full.capped) continue;
      const small = run([...ids], true, 20);
      expect(small.capped).toBe(false);
      expect(small.unresolvedKeys.length).toBe(full.unresolvedKeys.length);
      if (small.tieBreakCut) cut += 1;
      // The default budget lets every one of these finish as before.
      const budget = run([...ids], true, 5_000);
      expect(budget.unresolvedKeys).toEqual(full.unresolvedKeys);
      expect([...budget.assignment].sort((a, b) => a[0] - b[0])).toEqual(
        [...full.assignment].sort((a, b) => a[0] - b[0]),
      );
    }
    expect(cut).toBeGreaterThan(10);
  });
});

describe('greedy seed, linear root bound and dominance (M84)', () => {
  const { data, indexes } = measuredSeason;
  const all = Array.from({ length: 15 }, (_, i) => i + 1);
  const run = (ids: number[], seed = true, tieBreakNodes?: number) => {
    const stats = analyseDeck(BLADE_LINEAGE_DECK, indexes, data.rules.deployment);
    const { requirements } = expandRequirements(
      ids.map((giftId) => ({ giftId, required: false })),
      indexes,
      stats,
      data.rules.fusion.maxShopSlots,
    );
    return assignPacks({
      requirements,
      floors: all,
      options: options({ lastFloor: 15, hardFromFloor: 1 }),
      rules: data.rules,
      indexes,
      seed,
      tieBreakNodes,
    });
  };
  const giftsOf = (kind: string) =>
    data.gifts
      .filter((g) => g.obtainable && g.acquisition.kind === kind && !indexes.freelyAvailableGifts.has(g.id))
      .map((g) => g.id);
  const mixed = [...giftsOf('fusionOnly').slice(0, 20), ...giftsOf('packLimited')].sort((a, b) => a - b);
  const every = (n: number) => mixed.filter((_, i) => i % Math.floor(mixed.length / n) === 0).slice(0, n);

  it('proves the exact optimum on boards the node cap used to stop', () => {
    // The optima were checked offline with an integer program over the same packs and floors. Before
    // M84 the search stopped at the cap on all four, one to eight copies short.
    for (const [n, optimum] of [
      [20, 5],
      [30, 11],
      [60, 24],
      [80, 32],
    ] as const) {
      const result = run(every(n));
      expect(result.capped).toBe(false);
      expect(result.unresolvedKeys.length).toBe(optimum);
    }
  });

  it('only sets the bar: a search that finishes returns what it did without the seed', () => {
    const pool = data.gifts
      .filter(
        (g) => g.acquisition.kind === 'packLimited' && (indexes.packsByGift.get(g.id) ?? []).length <= 2,
      )
      .map((g) => g.id);
    const boards = [every(10), [9403, 9413, 9431, 9407, 9701, 9415, 9428, 9221, 9220, 9433]];
    let seed = 20261007;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let board = 0; board < 30; board += 1) {
      const ids = new Set<number>();
      const size = 6 + Math.floor(next() * 14);
      while (ids.size < size) {
        // Mostly pack-bound gifts, some fusions for gifts with several copies.
        const source = next() < 0.3 ? mixed : pool;
        ids.add(source[Math.floor(next() * source.length)]!);
      }
      boards.push([...ids]);
    }
    let compared = 0;
    for (const ids of boards) {
      const seeded = run(ids, true, Number.POSITIVE_INFINITY);
      const plain = run(ids, false, Number.POSITIVE_INFINITY);
      if (seeded.capped || plain.capped) continue;
      compared += 1;
      expect(seeded.unresolvedKeys).toEqual(plain.unresolvedKeys);
      expect([...seeded.assignment].sort((a, b) => a[0] - b[0])).toEqual(
        [...plain.assignment].sort((a, b) => a[0] - b[0]),
      );
      expect([...seeded.supplier].sort()).toEqual([...plain.supplier].sort());
    }
    expect(compared).toBeGreaterThan(20);
  });
});

describe('goals, not copies (M87)', () => {
  const { data, indexes, noObservation } = measuredSeason;
  const FIRE_DECK = [10112, 10216, 10311, 10415, 10512, 10604, 10715, 10808, 10916, 11009, 11115, 11216];
  const all = Array.from({ length: 15 }, (_, i) => i + 1);
  const giftsOf = (kind: string) =>
    data.gifts
      .filter((g) => g.obtainable && g.acquisition.kind === kind && !indexes.freelyAvailableGifts.has(g.id))
      .map((g) => g.id)
      .sort((a, b) => a - b);
  /**
   * The seeded random boards M87 was measured on (3~82 goals, pack-bound and fusion-only, the fire
   * deck with seven deployed on even boards and the 검계 deck on odd ones). Board n is the n-th.
   */
  const randomBoards = (() => {
    const pool = giftsOf('packLimited');
    const fusions = giftsOf('fusionOnly');
    let seed = 20261006;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    return Array.from({ length: 120 }, (_, b) => {
      const size = 3 + Math.floor(next() * 80);
      const ids = new Set<number>();
      while (ids.size < size) {
        const source = next() < 0.3 ? fusions : pool;
        ids.add(source[Math.floor(next() * source.length)]!);
      }
      const fire = b % 2 === 0;
      return {
        deck: fire ? FIRE_DECK : BLADE_LINEAGE_DECK,
        wanted: [...ids].map((giftId) => ({ giftId, required: false })),
        options: options({
          lastFloor: 15,
          hardFromFloor: 1,
          ...(fire ? { deployed: FIRE_DECK.slice(0, 7) } : {}),
        }),
      };
    });
  })();

  it('keeps the most goals rather than the most copies', () => {
    // 조그맣고 근사한 바이올린(9249) is three copies: 부서진 바이올린 (1016, floor 1 only) and two from
    // 우.미.다 (1102). 완전함(9416) needs 1007 and 1008, 만화경(9420) is 1010's. Floors 1~3 hold three
    // of those packs. Counting copies, the violin's two from 1102 beat 만화경's one, and the plan kept
    // one goal; counting goals, the violin is lost either way, so 1010 takes floor 3.
    const result = planWithout({
      deck: BLADE_LINEAGE_DECK,
      wanted: [9249, 9416, 9420].map((giftId) => ({ giftId, required: false })),
      options: options({ lastFloor: 15, hardFromFloor: 1 }),
    });
    expect(result.stats.coveredWanted).toBe(2);
    expect(result.floors.find((f) => f.packId === 1010)?.pickups.map((p) => p.giftId)).toEqual([9420]);
    expect(result.floors.some((f) => f.packId === 1102)).toBe(false);
    // The violin's other copies are not chased for nothing, and its entry says so.
    expect(result.unresolved.find((u) => u.giftId === 9249)).toMatchObject({
      reason: 'fusion-ingredient-unresolved',
      droppedIngredients: [9706, 9707],
    });
  });

  it('reaches the integer optimum by goals on fusion-heavy boards', () => {
    // Optima from an integer program over the same packs, floors and copies (M87.md). M84, which
    // counted copies, kept 22, 15, 10 and 25.
    for (const [board, optimum] of [
      [25, 24],
      [75, 16],
      [80, 11],
      [94, 27],
    ] as const) {
      const result = planRoute(randomBoards[board]!, noObservation, indexes);
      expect(result.stats.searchCapped).toBe(false);
      expect(result.stats.coveredWanted).toBe(optimum);
    }
  });

  it('weighs the observation slots inside the search', () => {
    // Without observation this board keeps 11 of 14. The slots go where the search says — three
    // copies whose observation frees what all 14 need — not to the misses one by one.
    const board = randomBoards[32]!;
    expect(planRoute(board, noObservation, indexes).stats.coveredWanted).toBe(11);
    const result = planRoute(board, data, indexes);
    expect(result.stats.coveredWanted).toBe(14);
    expect(result.start.observed).toHaveLength(3);
    expect(result.unresolved).toEqual([]);
  });

  it('finishes with the same plan with or without the seeds, the branch and bound and the window bound', () => {
    const run = (input: PlanInput, toggles: { seed?: boolean; branch?: boolean; lowerBound?: boolean }) => {
      const stats = analyseDeck(input.deck, indexes, data.rules.deployment, input.options.deployed);
      const { requirements, fusions } = expandRequirements(
        input.wanted,
        indexes,
        stats,
        data.rules.fusion.maxShopSlots,
      );
      const roots = goalRoots(input.wanted, fusions);
      return assignPacks({
        requirements,
        floors: all,
        options: input.options,
        rules: data.rules,
        indexes,
        goals: {
          roots: new Map(
            requirements.map((r) => [`${r.giftId}:${r.neededFor ?? 'direct'}`, roots.ofRequirement(r)]),
          ),
        },
        tieBreakNodes: Number.POSITIVE_INFINITY,
        ...toggles,
      });
    };
    let compared = 0;
    for (const input of randomBoards.filter((b) => b.wanted.length <= 16)) {
      const plain = run(input, { seed: false, branch: false, lowerBound: false });
      if (plain.capped) continue;
      compared += 1;
      for (const toggles of [{}, { branch: false }, { seed: false }, { lowerBound: false }]) {
        const other = run(input, toggles);
        expect(other.capped).toBe(false);
        expect(other.lostGoals).toEqual(plain.lostGoals);
        expect(other.unresolvedKeys).toEqual(plain.unresolvedKeys);
        expect([...other.assignment].sort((a, b) => a[0] - b[0])).toEqual(
          [...plain.assignment].sort((a, b) => a[0] - b[0]),
        );
      }
    }
    expect(compared).toBeGreaterThan(10);
  });
});

describe('alternativePacksOn', () => {
  it('names every pack on the floor whose pool carries all the gifts', () => {
    // 인연 얽힘 (9208) drops from all seven 죄악 packs, which share Hard 5 + 평행중첩 6~10.
    expect(alternativePacksOn(10, 'parallel', [9208], indexes, { exclude: 1302 })).toEqual([
      1305, 1308, 1311, 1314, 1317, 1320,
    ]);
    expect(alternativePacksOn(5, 'hard', [9208], indexes, { exclude: 1302 })).toEqual([
      1305, 1308, 1311, 1314, 1317, 1320,
    ]);
  });

  it('leaves out the banned packs and asks for nothing when there are no gifts', () => {
    expect(
      alternativePacksOn(10, 'parallel', [9208], indexes, { exclude: 1302, banned: new Set([1305, 1308]) }),
    ).toEqual([1311, 1314, 1317, 1320]);
    expect(alternativePacksOn(10, 'parallel', [], indexes)).toEqual([]);
  });

  it('has nothing to offer for a gift only one pack on the floor carries', () => {
    // 뱀 허물 (9751) is 1호선's alone.
    expect(alternativePacksOn(5, 'hard', [9751], indexes, { exclude: 1108 })).toEqual([]);
  });
});

describe('pack choices', () => {
  it('includes a preferred pack somewhere in its window and never observes it away', () => {
    // 깨진 안경 is observable, so without a preference the planner observes it and needs no pack.
    const free = plan({ wanted: want(9423), options: options({ hardFromFloor: 1, lastFloor: 15 }) });
    expect(free.stats.requiredPacks).toBe(0);
    const kept = plan({
      wanted: want(9423),
      options: options({ hardFromFloor: 1, lastFloor: 15, preferredPacks: [1012] }),
    });
    const floor = kept.floors.find((f) => f.packId === 1012)!;
    expect(floor).toBeDefined();
    expect(floor.reason).toBe('required');
    // 변하지 않는 (1012) is offered on Hard 4-5 and again across 평행중첩 6-10.
    expect(floor.window).toEqual({ from: 4, to: 10 });
    expect(floor.pickups.map((p) => p.giftId)).toEqual([9423]);
    expect(kept.start.observed).toEqual([]);
  });

  it('places a preferred pack even when no wanted gift needs it', () => {
    const result = planWithout({
      wanted: [],
      options: options({ hardFromFloor: 1, lastFloor: 15, preferredPacks: [1402] }),
    });
    expect(result.floors.filter((f) => f.packId === 1402)).toHaveLength(1);
    expect(result.warnings.map((w) => w.code)).not.toContain('pack-option-dropped');
  });

  it('validates an entry against the Hard plan it is about to force, not the Normal one it was given', () => {
    // 변하지 않는 (1012) is Hard-only on 4-5; a 15-floor plan is Hard from floor 1 anyway. The entry
    // used to be checked before the switch, dropped with a warning, and then placed there regardless.
    const pinnedOnNormal = options({
      hardFromFloor: null,
      lastFloor: 15,
      currentFloor: 5,
      pinnedPacks: { 4: 1012 },
    });
    const result = planWithout({ wanted: want(9423), options: pinnedOnNormal });
    expect(result.warnings.map((w) => w.code)).toContain('parallel-requires-hard');
    expect(result.warnings.map((w) => w.code)).not.toContain('pack-option-dropped');
    expect(result.floors.find((f) => f.floor === 4)).toMatchObject({
      packId: 1012,
      reason: 'pinned',
      pickups: [{ giftId: 9423, kind: 'exclusive', neededFor: null }],
    });
  });

  it('reports pack-banned when every pack that supplies a gift was given up', () => {
    const result = planWithout({
      wanted: want(9754),
      options: options({ hardFromFloor: 1, lastFloor: 15, bannedPacks: [1109] }),
    });
    expect(result.unresolved).toEqual([expect.objectContaining({ giftId: 9754, reason: 'pack-banned' })]);
    expect(result.floors.every((f) => f.packId !== 1109)).toBe(true);
  });

  it('drops a pin on a floor that does not offer the pack, and a preference that is also a ban', () => {
    const result = planWithout({
      wanted: want(9754),
      options: options({
        hardFromFloor: 1,
        lastFloor: 15,
        pinnedPacks: { 1: 1402 },
        preferredPacks: [1109],
        bannedPacks: [1109],
      }),
    });
    const warning = result.warnings.find((w) => w.code === 'pack-option-dropped');
    expect(warning?.packIds).toEqual([1402, 1109]);
    expect(result.floors[0]!.reason).toBe('free');
    expect(result.unresolved.map((u) => u.reason)).toEqual(['pack-banned']);
  });

  it("leaves banned packs out of a floor's alternative packs", () => {
    // 달궈진 놋쇠 comes from 해방된 분노 or 화왕지절; ban one and it must not be listed as an alternative.
    const result = planWithout({
      wanted: want(9267),
      options: options({ hardFromFloor: 1, lastFloor: 15, bannedPacks: [1302] }),
    });
    const floor = result.floors.find((f) => f.packId === 1402)!;
    expect(floor.alternatives).not.toContain(1302);
  });
});

describe('conflict groups', () => {
  it('groups the contested floors', () => {
    const input = {
      deck: BLADE_LINEAGE_DECK,
      wanted: want(9250, 9251, 9252, 9253, 9254, 9255),
      options: options({ lastFloor: 15 }),
    };
    const result = planRoute(input, data, indexes);
    // The last floor gives no clear reward, so it is not one the rewards' packs contest (M173).
    expect(conflictGroups(result, input.options, indexes)).toEqual([{ floors: [11, 12, 13, 14] }]);
  });

  it('is empty without a pack conflict and maps a fusion ingredient back to its wanted result', () => {
    const input = {
      deck: MIXED_DECK,
      wanted: want(9249),
      options: options({ hardFromFloor: 1, lastFloor: 5 }),
    };
    expect(conflictGroups(planRoute(input, noObservation, indexes), input.options, indexes)).toEqual([]);
    const roots = wantedRoots(input, noObservation, indexes);
    expect(roots(9706)).toEqual([9249]);
    expect(roots(9249)).toEqual([9249]);
  });
});

describe('conflicts in a run in progress (M154)', () => {
  // 장관 (9717) and 부동 (9718) are both fusions over the 칼자루/칼날 ingredients; with 장관 in hand
  // only 부동 still needs 녹슨 칼자루 (9713), and that one copy loses its floor.
  const input: PlanInput = {
    deck: MIXED_DECK,
    wanted: [9717, 9718, 9220, 9221, 9290, 9291, 9403].map((giftId) => ({ giftId, required: false })),
    options: options({ lastFloor: 3, hardFromFloor: 1, ownedGifts: [9717] }),
  };
  const plan = planRoute(input, data, indexes);

  it('does not count a goal already in hand as lost to the conflict', () => {
    expect(plan.unresolved.map((u) => `${u.giftId}:${u.reason}`)).toEqual([
      '9713:pack-conflict',
      '9718:fusion-ingredient-unresolved',
    ]);
    // The ingredient serves the goal the run still has to fuse, not the one in hand.
    expect(wantedRoots(input, data, indexes)(9713)).toEqual([9718]);
    expect(conflictRootsOf(plan, input, data, indexes)).toEqual([9718]);
    expect(planDropEffects(input, data, indexes, plan).conflicts).toBe(1);
    const resolutions = planResolutions(input, data, indexes, plan);
    expect(resolutions.conflicts).toBe(1);
    expect(resolutions.methods[0]!.removals).toEqual([9718]);
    expect(resolutions.methods.every((m) => !m.removals.includes(9717) || !m.minimal)).toBe(true);
  });

  it('names the ingredients a fusion cannot get, in both languages', () => {
    const entry = plan.unresolved.find((u) => u.reason === 'fusion-ingredient-unresolved')!;
    const name = (id: number) => indexes.giftById.get(id)!.name;
    for (const id of [...entry.missing!, ...(entry.droppedIngredients ?? [])]) {
      expect(entry.detail.ko).toContain(name(id).ko);
      expect(entry.detail.en).toContain(name(id).en);
      expect(entry.detail.ko).not.toContain(String(id));
    }
  });
});

describe('condition warnings (M154)', () => {
  it('does not call a condition no deck list can judge unmet', () => {
    // 인연 얽힘 (9208) asks for 완전 공명 7: a battle state, so `have` is null for every deck.
    const result = planWithout({ wanted: want(9208), options: options({ hardFromFloor: 1, lastFloor: 15 }) });
    const report = result.conditions.find((c) => c.giftId === 9208)!;
    expect(report.have).toBeNull();
    expect(result.warnings.find((w) => w.code === 'condition-unmet')).toBeUndefined();
  });

  it('still warns about a gate the deck misses', () => {
    // 부동 (9718) wants three 검계 identities deployed; the mixed deck has none.
    const result = planWithout({ wanted: want(9718), options: options({ hardFromFloor: 1, lastFloor: 15 }) });
    expect(result.conditions.find((c) => c.giftId === 9718)).toMatchObject({
      gate: true,
      have: 0,
      satisfied: false,
    });
    expect(result.warnings.find((w) => w.code === 'condition-unmet')?.giftIds).toEqual([9718]);
  });
});

describe('run progress', () => {
  // 조그맣고 근사한 바이올린(9249) = 부서진 바이올린(9431, 저택의 부산물 1016 on Hard 1 only)
  // + 기름때 찌든 스패너(9706) + 반짝이는 폐품(9707) (both 우.미.다 1102, Hard 2-3).
  const violin = (extra: Partial<PlanOptions>, ingredientsAsGoals?: boolean) =>
    planWithout({
      wanted: [
        { giftId: 9249, required: true, ...(ingredientsAsGoals === undefined ? {} : { ingredientsAsGoals }) },
      ],
      options: options({ lastFloor: 15, hardFromFloor: 1, ...extra }),
    });

  it('keeps chasing the remaining ingredients once a floor has passed, unless the result alone is the goal', () => {
    const asGoals = violin({ currentFloor: 2 });
    expect(asGoals.floors.map((f) => f.passed)).toEqual([true, ...Array.from({ length: 14 }, () => false)]);
    expect(asGoals.floors.find((f) => f.packId === 1102)?.floor).toBe(2);
    expect(asGoals.unresolved.map((u) => [u.giftId, u.reason])).toEqual([
      [9249, 'fusion-ingredient-unresolved'],
      [9431, 'no-pack-in-range'],
    ]);
    expect(asGoals.unresolved[0]!.missing).toEqual([9431]);

    const resultOnly = violin({ currentFloor: 2 }, false);
    expect(resultOnly.floors.some((f) => f.packId === 1102)).toBe(false);
    expect(resultOnly.stats.requiredPacks).toBe(0);
    const entry = resultOnly.unresolved.find((u) => u.giftId === 9249)!;
    expect(entry.missing).toEqual([9431]);
    expect(entry.droppedIngredients).toEqual([9706, 9707]);
    expect(entry.detail.ko).toContain('취소');
  });

  it('shows a visited pack on its played floor with the pickups still owed, and never revisits it', () => {
    const plan = violin({ currentFloor: 3, pinnedPacks: { 1: 1016, 2: 1102 }, ownedGifts: [9706, 9431] });
    const second = plan.floors.find((f) => f.floor === 2)!;
    expect(second).toMatchObject({
      passed: true,
      packId: 1102,
      reason: 'pinned',
      window: { from: 2, to: 2 },
    });
    expect(second.pickups.map((p) => p.giftId)).toEqual([9707]);
    expect(second.observation).toEqual({ needed: false, possible: true, starlight: 0 });
    expect(plan.floors.filter((f) => f.packId === 1102)).toHaveLength(1);
    expect(plan.fusions[0]).toMatchObject({ unreachable: false, earliestFloor: 3 });
    expect(plan.unresolved).toEqual([]);
    expect(plan.stats).toMatchObject({ requiredPacks: 0, coveredWanted: 1 });
  });

  // 기쁜 봉제인형(9765) = 털방울 모자(9709) + 거대한 선물 보따리(9710) + 슬픈 봉제인형(9711), all three
  // carried by 크리스마스 파티 1103 (Hard 3-4) and its 복각 1113 (Hard 4-5, 평행중첩 6-10).
  const plush = (extra: Partial<PlanOptions>) =>
    planWithout({
      wanted: [{ giftId: 9765, required: true }],
      options: options({ lastFloor: 15, hardFromFloor: 1, ...extra }),
    });
  const FAILED_KO = '미획득인 채로 층을 떠나 이 런에서는 더 얻을 수 없는 기프트입니다.';

  it('routes a gift missed on a visited pack again from a later pack, and the fusion waits for it', () => {
    const plan = plush({
      currentFloor: 4,
      pinnedPacks: { 3: 1103 },
      ownedGifts: [9710, 9711],
      unobtainableGifts: [9709],
    });
    const third = plan.floors.find((f) => f.floor === 3)!;
    expect(third).toMatchObject({ passed: true, packId: 1103 });
    expect(third.pickups).toEqual([]);
    const again = plan.floors.find((f) => f.packId === 1113)!;
    expect(again.floor).toBeGreaterThanOrEqual(4);
    expect(again.pickups.map((p) => p.giftId)).toEqual([9709]);
    expect(plan.floors.filter((f) => f.packId === 1103)).toHaveLength(1);
    expect(plan.unresolved).toEqual([]);
    expect(plan.fusions[0]).toMatchObject({ unreachable: false, earliestFloor: again.floor });
    expect(plan.stats).toMatchObject({ requiredPacks: 1, coveredWanted: 1 });
  });

  it('routes a missed pool gift from any later pack that carries it', () => {
    // 파란 별조각(9817) is in the pool of 1017 (Hard 3-4), 1018, 1123, 1410 and every EXTREME pack —
    // 22 packs, rare enough to route for. The Canto X packs' assumed pool (every general gift) puts
    // it at 26, over the 20% share, so the case is held on the season as it stood before them.
    const { indexes } = measuredSeason;
    const plan = planRoute(
      {
        deck: MIXED_DECK,
        wanted: [{ giftId: 9817, required: true }],
        options: options({
          lastFloor: 15,
          hardFromFloor: 1,
          currentFloor: 4,
          pinnedPacks: { 3: 1017 },
          unobtainableGifts: [9817],
        }),
      },
      measuredSeason.noObservation,
      indexes,
    );
    expect(plan.floors.find((f) => f.floor === 3)!.pickups).toEqual([]);
    const supplier = plan.floors.find((f) => f.pickups.some((p) => p.giftId === 9817))!;
    expect(supplier.floor).toBeGreaterThanOrEqual(4);
    expect(indexes.packsByGift.get(9817)).toContain(supplier.packId);
    expect(supplier.packId).not.toBe(1017);
    expect(plan.unresolved).toEqual([]);
    expect(plan.generalDrops).toEqual([]);
    expect(plan.stats.coveredWanted).toBe(1);
  });

  it('reports a missed gift as out of range when no floor ahead offers another supplier', () => {
    const plan = plush({
      currentFloor: 11,
      pinnedPacks: { 10: 1113 },
      ownedGifts: [9710, 9711],
      unobtainableGifts: [9709],
    });
    expect(plan.floors.every((f) => f.passed || f.packId === null)).toBe(true);
    expect(plan.unresolved.map((u) => [u.giftId, u.reason])).toEqual([
      [9709, 'no-pack-in-range'],
      [9765, 'fusion-ingredient-unresolved'],
    ]);
    expect(plan.unresolved[0]!.detail.ko).toContain('남은 층에 없습니다');
    expect(plan.unresolved[1]!.missing).toEqual([9709]);

    // 도시를 사랑하는 당신을 위한(9209): 1316 (Hard 3-4) or 1504 (EXTREME). Missed on 1316, it is
    // out of reach in a 10-floor run and back on the table when the run goes to 15.
    const city = (lastFloor: number) =>
      planWithout({
        wanted: [{ giftId: 9209, required: true }],
        options: options({
          lastFloor,
          hardFromFloor: 1,
          currentFloor: 4,
          pinnedPacks: { 3: 1316 },
          unobtainableGifts: [9209],
        }),
      });
    expect(city(10).unresolved.map((u) => [u.giftId, u.reason])).toEqual([[9209, 'no-pack-in-range']]);
    expect(city(15).floors.find((f) => f.packId === 1504)).toMatchObject({
      floor: 11,
      pickups: [{ giftId: 9209, kind: 'exclusive', neededFor: null }],
    });
  });

  it('gives up on a gift missed on the only pack that carries it, and drops the rest only when the result alone is the goal', () => {
    const asGoals = violin({ currentFloor: 2, pinnedPacks: { 1: 1016 }, unobtainableGifts: [9431] });
    expect(asGoals.floors.filter((f) => f.packId !== null).map((f) => f.packId)).toEqual([1016, 1102]);
    expect(asGoals.unresolved.map((u) => [u.giftId, u.reason])).toEqual([
      [9249, 'fusion-ingredient-unresolved'],
      [9431, 'failed'],
    ]);
    expect(asGoals.unresolved[1]!.detail.ko).toBe(FAILED_KO);
    expect(asGoals.unresolved[0]!.droppedIngredients).toBeUndefined();

    const resultOnly = violin(
      { currentFloor: 2, pinnedPacks: { 1: 1016 }, unobtainableGifts: [9431] },
      false,
    );
    expect(resultOnly.floors.every((f) => f.passed || f.packId === null)).toBe(true);
    expect(resultOnly.unresolved.find((u) => u.giftId === 9249)).toMatchObject({
      missing: [9431],
      droppedIngredients: [9706, 9707],
    });

    // A clear reward comes from one pack only, too.
    const reward = planWithout({
      wanted: [{ giftId: 9250, required: true }],
      options: options({
        lastFloor: 15,
        hardFromFloor: 1,
        currentFloor: 12,
        pinnedPacks: { 11: 1511 },
        unobtainableGifts: [9250],
      }),
    });
    expect(reward.unresolved.map((u) => [u.giftId, u.reason])).toEqual([[9250, 'failed']]);
    expect(reward.floors.every((f) => f.passed || f.packId === null)).toBe(true);
  });

  it('never plans a missed fusion result again', () => {
    const plan = violin({ currentFloor: 3, pinnedPacks: { 1: 1016, 2: 1102 }, unobtainableGifts: [9249] });
    expect(plan.unresolved.map((u) => [u.giftId, u.reason])).toEqual([[9249, 'failed']]);
    expect(plan.fusions).toEqual([]);
    expect(plan.floors.every((f) => f.passed || f.packId === null)).toBe(true);
  });

  it('leaves a missed general drop to the general pool', () => {
    // 재에서 재로(9003) can drop from any pack, so missing it on one floor settles nothing.
    const plan = planWithout({
      wanted: [{ giftId: 9003, required: true }],
      options: options({
        lastFloor: 15,
        hardFromFloor: 1,
        currentFloor: 2,
        pinnedPacks: { 1: 1016 },
        unobtainableGifts: [9003],
      }),
    });
    expect(plan.generalDrops).toEqual([9003]);
    expect(plan.unresolved).toEqual([]);
  });

  it('plans only the floors ahead, reports every row, and stops recommending observations mid-run', () => {
    const plan = planRoute(
      {
        deck: MIXED_DECK,
        wanted: [
          { giftId: 9283, required: true },
          { giftId: 9250, required: true },
        ],
        options: options({
          lastFloor: 15,
          hardFromFloor: 1,
          currentFloor: 6,
          pinnedPacks: { 1: 1016, 5: 1025 },
        }),
      },
      data,
      indexes,
    );
    expect(plan.floors).toHaveLength(15);
    expect(plan.floors.filter((f) => f.passed).map((f) => f.floor)).toEqual([1, 2, 3, 4, 5]);
    expect(plan.floors.find((f) => f.floor === 5)).toMatchObject({
      packId: 1025,
      reason: 'pinned',
      passed: true,
    });
    expect(plan.floors.find((f) => f.floor === 5)!.pickups.map((p) => p.giftId)).toEqual([9283]);
    expect(plan.floors.find((f) => f.packId === 1511)).toMatchObject({
      floor: 11,
      window: { from: 11, to: 14 },
    });
    expect(plan.start.observed).toEqual([]);
    expect(plan.start.startGifts).toEqual([]);
    expect(plan.stats).toMatchObject({ requiredPacks: 1, coveredWanted: 2 });
  });

  it('plans no floor once the run is over, and shows the last floor as played', () => {
    // Arrange: the app's finished run stands one past the last floor (`runDoneFloor`), floor 15
    // either skipped or entered.
    const finished = (pinnedPacks: Record<number, number>) =>
      planRoute(
        {
          deck: MIXED_DECK,
          wanted: [{ giftId: 9250, required: false }],
          options: options({ lastFloor: 15, hardFromFloor: 1, currentFloor: 16, pinnedPacks }),
        },
        data,
        indexes,
      );

    // Act
    const skipped = finished({});
    const entered = finished({ 15: 1511 });

    // Assert: nothing is left to enter, so the clear reward is not counted as collected.
    expect(skipped.floors.every((f) => f.passed)).toBe(true);
    expect(skipped.floors.find((f) => f.floor === 15)!.packId).toBeNull();
    expect(skipped.stats).toMatchObject({ requiredPacks: 0, coveredWanted: 0 });
    expect(skipped.unresolved.map((u) => u.giftId)).toEqual([9250]);
    // Entered on the last floor, the pack is played — but the run ended with its boss before the
    // clear reward was handed out, so it is not in hand either (M173).
    expect(entered.floors.find((f) => f.floor === 15)).toMatchObject({
      packId: 1511,
      reason: 'pinned',
      passed: true,
      pickups: [],
    });
    expect(entered.stats.coveredWanted).toBe(0);
    expect(entered.unresolved).toEqual([expect.objectContaining({ giftId: 9250, reason: 'final-floor' })]);
  });

  it('counts an owned gift as covered and never plans for it, and lets in-hand win over missed', () => {
    const plan = planWithout({
      wanted: [{ giftId: 9754, required: true }],
      options: options({ lastFloor: 15, hardFromFloor: 1, ownedGifts: [9754], unobtainableGifts: [9754] }),
    });
    expect(plan.floors.every((f) => f.packId === null)).toBe(true);
    expect(plan.unresolved).toEqual([]);
    expect(plan.stats.coveredWanted).toBe(1);
  });

  it('clamps the current floor to one past the plan, a finished run', () => {
    const plan = violin({ currentFloor: 99 });
    expect(plan.floors).toHaveLength(15);
    expect(plan.floors.filter((f) => !f.passed).map((f) => f.floor)).toEqual([]);
  });
});

describe('observation pins', () => {
  /** The twelve LCB 수감자, the app's default deck; its dominant keyword is Burst. */
  const LCB_DECK = [10101, 10201, 10301, 10401, 10501, 10601, 10701, 10801, 10901, 11001, 11101, 11201];
  /** What the app always plans: floors 1-15 on Hard. */
  const hard15 = (overrides: Partial<PlanOptions> = {}): PlanOptions =>
    options({ lastFloor: 15, hardFromFloor: 1, ...overrides });
  /** The reported scenario: three pins, one of them a general drop, and a fusion whose ingredients sit on floors 1-2. */
  const SCENARIO = [9191, 9410, 9419, 9423];
  const PINS = [9191, 9419, 9423];
  const codes = (result: ReturnType<typeof planRoute>): string[] => result.warnings.map((w) => w.code);
  const packAt = (result: ReturnType<typeof planRoute>, floor: number) =>
    result.floors.find((f) => f.floor === floor)!;

  it.each([true, false])(
    'honours a pin on a general drop and routes the fusion ingredients (required=%s)',
    (required) => {
      const wanted = SCENARIO.map((giftId) => ({ giftId, required }));
      const result = plan({ deck: LCB_DECK, wanted, options: hard15({ observedGifts: PINS }) });
      expect(result.start.observed).toEqual([
        { giftId: 9191, pinned: true, freedPack: null },
        { giftId: 9419, pinned: true, freedPack: null },
        { giftId: 9423, pinned: true, freedPack: null },
      ]);
      expect(result.start.starlight).toBe(270);
      expect(result.stats.requiredPacks).toBe(2);
      expect(packAt(result, 1)).toMatchObject({
        packId: 1004,
        reason: 'required',
        window: { from: 1, to: 2 },
        pickups: [{ giftId: 9408, kind: 'exclusive', neededFor: 9410 }],
      });
      expect(packAt(result, 2)).toMatchObject({
        packId: 1005,
        reason: 'required',
        window: { from: 1, to: 2 },
        pickups: [{ giftId: 9409, kind: 'exclusive', neededFor: 9410 }],
      });
      expect(result.floors.filter((f) => f.floor >= 3).every((f) => f.packId === null)).toBe(true);
      expect(result.fusions).toEqual([
        {
          result: 9410,
          ingredients: [9408, 9409],
          earliestFloor: 2,
          unreachable: false,
          exceedsShopSlots: false,
        },
      ]);
      expect(result.generalDrops).toEqual([]);
      expect(codes(result)).not.toContain('general-drop-not-guaranteed');
      expect(codes(result)).not.toContain('observation-trimmed');
      expect(result.unresolved).toEqual([]);
      expect(result.stats).toMatchObject({ coveredWanted: 4, totalWanted: 4, starlight: 320 });
    },
  );

  it('turns a pinned general drop into a certainty instead of a "may drop"', () => {
    const result = plan({ wanted: want(9191), options: hard15({ observedGifts: [9191] }) });
    expect(result.start.observed).toEqual([{ giftId: 9191, pinned: true, freedPack: null }]);
    expect(result.generalDrops).toEqual([]);
    expect(codes(result)).not.toContain('general-drop-not-guaranteed');
    expect(result.floors.every((f) => f.packId === null)).toBe(true);
    expect(result.stats).toMatchObject({ requiredPacks: 0, coveredWanted: 1 });
  });

  it('reports a pin on a gift that is no goal, and keeps the slot for its own recommendation', () => {
    const result = plan({ wanted: want(9423), options: hard15({ observedGifts: [9419] }) });
    expect(result.start.observed).toEqual([{ giftId: 9423, pinned: false, freedPack: 1012 }]);
    expect(result.warnings.find((w) => w.code === 'observation-trimmed')?.giftIds).toEqual([9419]);
    expect(result.stats.requiredPacks).toBe(0);
  });

  it('on floor 1, keeps the slot of a pin already in hand without a word, and observes the rest', () => {
    const result = plan({
      wanted: want(9419, 9423),
      options: options({ hardFromFloor: 1, ownedGifts: [9419], observedGifts: [9419] }),
    });
    expect(result.start.observed).toEqual([
      { giftId: 9419, pinned: true, freedPack: null },
      { giftId: 9423, pinned: false, freedPack: 1012 },
    ]);
    expect(codes(result)).not.toContain('observation-trimmed');
    expect(result.stats.coveredWanted).toBe(2);
  });

  describe('a pin already in hand on floor 1 is an observation spent (M134)', () => {
    /**
     * The owner's run: 프레스티지 카드 (9191, a general drop) pinned, and three pack-bound goals the
     * planner fills the other slots with. Without any pin it would observe all three of those.
     * Screen capture records the observed gift as 획득 while the run is still on floor 1.
     */
    const GOALS = [9191, 9245, 9745, 9809];
    const run = (overrides: Partial<PlanOptions>, goals = GOALS) =>
      plan({ deck: LCB_DECK, wanted: want(...goals), options: hard15(overrides) });

    it('lists the owned pin as observed and recommends only what the slots it left can hold', () => {
      const unpinned = run({});
      const pinned = run({ observedGifts: [9191] });

      const result = run({ observedGifts: [9191], ownedGifts: [9191] });

      expect(unpinned.start.observed.filter((o) => !o.pinned)).toHaveLength(3);
      const budget = data.rules.giftObservation.max;
      expect(result.start.observed).toHaveLength(budget);
      expect(result.start.observed[0]).toEqual({ giftId: 9191, pinned: true, freedPack: null });
      expect(result.start.observed.filter((o) => !o.pinned).length).toBeLessThanOrEqual(budget - 1);
      // The same plan as the pin before capture recorded it: the slot was spent either way.
      expect(result.start).toEqual(pinned.start);
      expect(result.floors).toEqual(pinned.floors);
      expect(codes(result)).not.toContain('observation-trimmed');
      expect(result.unresolved).toEqual([]);
    });

    it('keeps the owned gift owned: observing it does not reroute it', () => {
      const result = run({ observedGifts: [9191], ownedGifts: [9191] });

      expect(result.generalDrops).not.toContain(9191);
      expect(result.floors.some((f) => f.pickups.some((p) => p.giftId === 9191))).toBe(false);
      expect(result.stats.coveredWanted).toBe(GOALS.length);
    });

    it('after floor 1, keeps the old behaviour: nothing observed, the owned pin unreported', () => {
      const result = run({ observedGifts: [9191], ownedGifts: [9191], currentFloor: 2 });

      expect(result.start.observed).toEqual([]);
      expect(result.start.starlight).toBe(0);
      expect(codes(result)).not.toContain('observation-trimmed');
      expect(codes(result)).not.toContain('observation-after-start');
    });

    it('with one slot, the owned pin takes it and nothing is recommended', () => {
      const result = run({ observedGifts: [9191], ownedGifts: [9191], observationSlots: 1 });

      expect(result.start.observed).toEqual([{ giftId: 9191, pinned: true, freedPack: null }]);
    });

    it('two owned pins with three slots leave room for one recommendation', () => {
      const result = run({ observedGifts: [9191, 9745], ownedGifts: [9191, 9745] });

      expect(result.start.observed.map((o) => [o.giftId, o.pinned])).toEqual([
        [9191, true],
        [9745, true],
        [expect.any(Number), false],
      ]);
      expect(result.start.observed.filter((o) => !o.pinned)).toHaveLength(1);
    });

    it('still holds the slot in a plan without that goal, so the drop analysis gets no slot back', () => {
      const result = run({ observedGifts: [9191], ownedGifts: [9191] }, [9245, 9745, 9809]);

      expect(result.start.observed[0]).toEqual({ giftId: 9191, pinned: true, freedPack: null });
      expect(result.start.observed.filter((o) => !o.pinned)).toHaveLength(2);
    });
  });

  describe('start gift count (M134)', () => {
    /** 진동 pool: 9044 진동형 팔찌, 9086 잔향, 9113 시큼한 주향. 9001 sits in the 화상 pool. */
    const VIBRATION = data.rules.startGift.poolsByKeyword.Vibration!;
    const run = (overrides: Partial<PlanOptions>, goals: number[], season = data) =>
      planRoute({ deck: LCB_DECK, wanted: want(...goals), options: hard15(overrides) }, season, indexes);

    it('clamps the count into 0..the largest pool, and defaults to the rules', () => {
      // Arrange
      const rules = data.rules;
      // Act / Assert
      expect(startGiftBudget({}, rules)).toBe(rules.startGift.pickCount);
      expect(startGiftBudget({ startGiftCount: 0 }, rules)).toBe(0);
      expect(startGiftBudget({ startGiftCount: -2 }, rules)).toBe(0);
      expect(startGiftBudget({ startGiftCount: 2 }, rules)).toBe(2);
      expect(startGiftBudget({ startGiftCount: 9 }, rules)).toBe(VIBRATION.length);
      expect(startGiftBudget({ startGiftCount: Number.NaN }, rules)).toBe(rules.startGift.pickCount);
    });

    it('takes nothing with 0: every pool goal stays a general drop', () => {
      const result = run({ startGiftCount: 0 }, [9044, 9086]);

      expect(result.start.startGifts).toEqual([]);
      expect(result.start.autoStartGifts).toEqual([]);
      // Nothing is taken from any pool, so no keyword is chosen — requested or not.
      expect(result.start.keyword).toBeNull();
      expect(result.start.autoKeyword).toBeNull();
      expect(run({ startGiftCount: 0, startKeyword: 'Vibration' }, [9044]).start.keyword).toBeNull();
      expect(result.generalDrops).toEqual([9044, 9086]);
    });

    it('with 1, plans exactly as before the option existed', () => {
      const goals = [9044, 9086, 9001, 9245];

      const omitted = run({}, goals);
      const one = run({ startGiftCount: 1 }, goals);

      expect(omitted.start.startGifts).toHaveLength(1);
      expect(JSON.stringify({ ...one, stats: null })).toBe(JSON.stringify({ ...omitted, stats: null }));
    });

    it('with 2, prefers the keyword whose pool holds two goals over a pool holding one', () => {
      // 화상 sorts before 진동, so with one pick the tie between them goes to 화상.
      const single = run({ startGiftCount: 1 }, [9001, 9044, 9086]);

      const double = run({ startGiftCount: 2 }, [9001, 9044, 9086]);

      expect(single.start).toMatchObject({ keyword: 'Combustion', startGifts: [9001] });
      expect(double.start).toMatchObject({ keyword: 'Vibration', startGifts: [9044, 9086] });
      expect(double.start.autoStartGifts).toEqual([9044, 9086]);
      expect(double.generalDrops).toEqual([9001]);
    });

    it('with 3, takes the whole pool when all three are goals', () => {
      const result = run({ startGiftCount: 3 }, [...VIBRATION]);

      expect(result.start.keyword).toBe('Vibration');
      expect([...result.start.startGifts].sort((a, b) => a - b)).toEqual(
        [...VIBRATION].sort((a, b) => a - b),
      );
      expect(result.generalDrops).toEqual([]);
      expect(result.stats.coveredWanted).toBe(3);
    });

    it('never takes more than the pool holds, nor a gift that is no goal', () => {
      const result = run({ startGiftCount: 5 }, [9044, 9086]);

      expect(result.start.startGifts).toEqual([9044, 9086]);
    });

    it('keeps a requested keyword, and says what auto would take with the same count', () => {
      const result = run({ startGiftCount: 2, startKeyword: 'Combustion' }, [9001, 9044, 9086]);

      expect(result.start).toMatchObject({
        keyword: 'Combustion',
        startGifts: [9001],
        autoKeyword: 'Vibration',
        autoStartGifts: [9044, 9086],
      });
      expect(result.generalDrops).toEqual([9044, 9086]);
    });

    it('fills the picks with the goal the route would visit a pack for first, then general drops', () => {
      // A season whose 진동 pool also holds 상납된 시가 (9283), which only pack 1025 drops.
      const pools = data.rules.startGift.poolsByKeyword;
      const season = {
        ...data,
        rules: {
          ...data.rules,
          startGift: { ...data.rules.startGift, poolsByKeyword: { ...pools, Vibration: [9044, 9086, 9283] } },
        },
      };
      // 화상 holds two general-drop goals, 진동 one routed goal and one general drop.
      const goals = [9001, 9009, 9044, 9283];

      const result = run({ startGiftCount: 2 }, goals, season);

      expect(result.start).toMatchObject({ keyword: 'Vibration', startGifts: [9283, 9044] });
      expect(result.floors.some((f) => f.pickups.some((p) => p.giftId === 9283))).toBe(false);
      expect(result.generalDrops).toEqual([9001, 9009]);
    });

    it('takes no start gift once floor 1 is left, whatever the count', () => {
      const result = run({ startGiftCount: 3, currentFloor: 2 }, [...VIBRATION]);

      expect(result.start.startGifts).toEqual([]);
      expect(result.start.autoStartGifts).toEqual([]);
    });
  });

  describe('a start decided before floor 1 is left (M134)', () => {
    const GOALS = [9191, 9245, 9745, 9809, 9044];
    const run = (overrides: Partial<PlanOptions>) =>
      plan({ deck: LCB_DECK, wanted: want(...GOALS), options: hard15(overrides) });

    it('chooses no start gift and recommends no observation, but plans every floor', () => {
      const open = run({});

      const decided = run({ startDecided: true });

      expect(open.start.startGifts).toEqual([9044]);
      expect(open.start.observed.length).toBeGreaterThan(0);
      expect(decided.start.startGifts).toEqual([]);
      expect(decided.start.autoStartGifts).toEqual([]);
      expect(decided.start.observed).toEqual([]);
      expect(decided.start.starlight).toBe(0);
      expect(decided.floors.filter((f) => f.passed)).toEqual([]);
      expect(decided.floors[0]!.floor).toBe(1);
      expect(decided.generalDrops).toContain(9044);
    });

    it('still lists a pin already in hand as a spent observation', () => {
      const result = run({ startDecided: true, observedGifts: [9191], ownedGifts: [9191] });

      expect(result.start.observed).toEqual([{ giftId: 9191, pinned: true, freedPack: null }]);
      expect(codes(result)).not.toContain('observation-after-start');
    });

    it('warns about a pin on a gift still to be found instead of applying it', () => {
      const result = run({ startDecided: true, observedGifts: [9191, 9245], ownedGifts: [9191] });

      expect(result.start.observed).toEqual([{ giftId: 9191, pinned: true, freedPack: null }]);
      expect(result.warnings.find((w) => w.code === 'observation-after-start')?.giftIds).toEqual([9245]);
    });

    it('changes nothing when false', () => {
      expect(JSON.stringify({ ...run({ startDecided: false }), stats: null })).toBe(
        JSON.stringify({ ...run({}), stats: null }),
      );
    });
  });

  it('carries the app mid-run state: pins owned after floor 1, the first pack visited, the second still to come', () => {
    const result = plan({
      deck: LCB_DECK,
      wanted: want(...SCENARIO),
      options: hard15({ observedGifts: PINS, ownedGifts: PINS, currentFloor: 2, pinnedPacks: { 1: 1004 } }),
    });
    expect(result.start.observed).toEqual([]);
    expect(codes(result)).not.toContain('observation-trimmed');
    expect(packAt(result, 1)).toMatchObject({ passed: true, packId: 1004 });
    expect(packAt(result, 2)).toMatchObject({ packId: 1005, reason: 'required' });
    expect(result.stats).toMatchObject({ requiredPacks: 1, coveredWanted: 4 });
    expect(result.unresolved).toEqual([]);
  });

  it('mid-run, does not apply a pin on a gift still to be found, and reports it as observation-after-start', () => {
    // Observation is spent when floor 1 is left. On floor 11 a pin on 9423 (not in hand) cannot
    // become a certainty any more; the owned pin on 9419 stays silent, and a pin on 9191 (no goal
    // of this plan) is still trimmed as before.
    const result = plan({
      deck: LCB_DECK,
      wanted: want(9419, 9423),
      options: hard15({ observedGifts: [9191, 9423, 9419], ownedGifts: [9419], currentFloor: 11 }),
    });
    expect(result.start.observed).toEqual([]);
    expect(result.start.starlight).toBe(0);
    const afterStart = result.warnings.find((w) => w.code === 'observation-after-start');
    expect(afterStart?.giftIds).toEqual([9423]);
    expect(afterStart?.detail.ko).toBe(
      '기프트 관측은 1층을 떠나기 전에만 할 수 있어, 그 뒤에 지정한 관측은 적용하지 않았습니다.',
    );
    expect(result.warnings.find((w) => w.code === 'observation-trimmed')?.giftIds).toEqual([9191]);
    // 9423 is neither observed nor covered through observation: it is routed or unresolved, honestly.
    expect(result.stats.coveredWanted).toBe(1 + (result.unresolved.length === 0 ? 1 : 0));
    const later = result.floors.filter((f) => f.floor >= 11 && f.packId !== null);
    if (result.unresolved.length === 0) {
      expect(later.some((f) => f.pickups.some((p) => p.giftId === 9423))).toBe(true);
    } else {
      expect(result.unresolved).toEqual([expect.objectContaining({ giftId: 9423 })]);
    }
  });

  it('mid-run, the pins scenario with one pin not yet owned: that pin alone is reported, nothing observed', () => {
    const result = plan({
      deck: LCB_DECK,
      wanted: want(...SCENARIO),
      options: hard15({
        observedGifts: PINS,
        ownedGifts: [9191, 9419, 9410],
        currentFloor: 11,
      }),
    });
    expect(result.start.observed).toEqual([]);
    expect(codes(result)).not.toContain('observation-trimmed');
    expect(result.warnings.find((w) => w.code === 'observation-after-start')?.giftIds).toEqual([9423]);
    expect(result.floors.filter((f) => f.floor < 11).every((f) => f.passed && f.packId === null)).toBe(true);
  });

  it('at floor 1, a pin still applies (the observation window is open until floor 1 is left)', () => {
    const result = plan({
      deck: LCB_DECK,
      wanted: want(9419, 9423),
      options: hard15({ observedGifts: [9423], currentFloor: 1 }),
    });
    expect(result.start.observed.filter((o) => o.pinned)).toEqual([
      { giftId: 9423, pinned: true, freedPack: null },
    ]);
    expect(codes(result)).not.toContain('observation-after-start');
    expect(result.stats.coveredWanted).toBe(2);
  });

  it('takes the free starting gift for a wanted general drop, and a pinned one is not taken twice', () => {
    // 9047 and 9093 are both in the Burst starting pool and both general drops.
    const free = plan({ deck: LCB_DECK, wanted: want(9047, 9093), options: hard15() });
    expect(free.start).toMatchObject({ keyword: 'Burst', startGifts: [9047], observed: [] });
    expect(free.generalDrops).toEqual([9093]);

    const pinned = plan({
      deck: LCB_DECK,
      wanted: want(9047, 9093),
      options: hard15({ observedGifts: [9047] }),
    });
    expect(pinned.start.observed).toEqual([{ giftId: 9047, pinned: true, freedPack: null }]);
    expect(pinned.start.startGifts).toEqual([9093]);
    expect(pinned.generalDrops).toEqual([]);
  });

  it('keeps the first three pins in the order they were pinned and names the fourth', () => {
    const result = plan({
      deck: LCB_DECK,
      wanted: want(...SCENARIO),
      options: hard15({ observedGifts: [9423, 9419, 9191, 9408] }),
    });
    expect(result.start.observed.map((o) => o.giftId)).toEqual([9423, 9419, 9191]);
    expect(result.start.observed.every((o) => o.pinned)).toBe(true);
    expect(result.warnings.find((w) => w.code === 'observation-trimmed')?.giftIds).toEqual([9408]);
  });

  it('does not spend a slot on a pin the plan already gave up on (Hard-only gift, Normal plan)', () => {
    const result = plan({
      wanted: want(9423, 9419),
      options: options({ hardFromFloor: null, lastFloor: 5, observedGifts: [9423] }),
    });
    expect(result.unresolved).toEqual([expect.objectContaining({ giftId: 9423, reason: 'hard-only' })]);
    expect(result.start.observed).toEqual([{ giftId: 9419, pinned: false, freedPack: 1010 }]);
    expect(codes(result)).not.toContain('observation-trimmed');
    expect(result.stats.coveredWanted).toBe(1);
  });

  it('mid-run, reports the fusion as lost once both ingredient floors are behind, and recommends nothing', () => {
    const result = plan({ deck: LCB_DECK, wanted: want(...SCENARIO), options: hard15({ currentFloor: 3 }) });
    expect(result.start.observed).toEqual([]);
    expect(packAt(result, 3).packId).toBe(1010);
    expect(packAt(result, 4)).toMatchObject({ packId: 1012, window: { from: 4, to: 10 } });
    expect(result.unresolved).toEqual([
      expect.objectContaining({ giftId: 9408, reason: 'no-pack-in-range' }),
      expect.objectContaining({ giftId: 9409, reason: 'no-pack-in-range' }),
      expect.objectContaining({
        giftId: 9410,
        reason: 'fusion-ingredient-unresolved',
        missing: [9408, 9409],
      }),
    ]);
    // The particle follows the name's final consonant: 「귀신 들린 신발을」, never 「신발를」.
    expect(result.unresolved[0]!.detail.ko).toBe('귀신 들린 신발을 주는 팩이 남은 층에 없습니다.');
    expect(result.stats).toMatchObject({ requiredPacks: 2, coveredWanted: 3 });
  });

  it('mid-run, after the first ingredient pack, still plans the second and fuses on floor 2', () => {
    const result = plan({
      wanted: want(9410),
      options: hard15({ currentFloor: 2, pinnedPacks: { 1: 1004 } }),
    });
    expect(packAt(result, 1)).toMatchObject({
      passed: true,
      packId: 1004,
      pickups: [expect.objectContaining({ giftId: 9408 })],
    });
    expect(packAt(result, 2)).toMatchObject({ packId: 1005, reason: 'required', window: { from: 2, to: 2 } });
    expect(result.fusions[0]).toMatchObject({ result: 9410, earliestFloor: 2 });
    expect(result.unresolved).toEqual([]);
    expect(result.stats.requiredPacks).toBe(1);
  });

  it('lets a pinned ingredient be observed and spends any free slot on the other one', () => {
    const free = plan({ wanted: want(9410), options: hard15({ observedGifts: [9408] }) });
    expect(free.start.observed).toEqual([
      { giftId: 9408, pinned: true, freedPack: null },
      { giftId: 9409, pinned: false, freedPack: 1005 },
    ]);
    expect(free.stats.requiredPacks).toBe(0);
    expect(free.fusions[0]).toMatchObject({ earliestFloor: 1 });

    const full = plan({
      wanted: want(9410, 9419, 9423),
      options: hard15({ observedGifts: [9408, 9419, 9423] }),
    });
    expect(full.start.observed.map((o) => o.giftId)).toEqual([9408, 9419, 9423]);
    expect(packAt(full, 1)).toMatchObject({ packId: 1005, window: { from: 1, to: 2 } });
    expect(full.stats.requiredPacks).toBe(1);
    expect(full.fusions[0]).toMatchObject({ earliestFloor: 1 });
  });

  it('keeps the pins even when rescuing would have spent the slots differently', () => {
    const result = plan({
      wanted: want(9283, 9222, 9217, 9435, 9751),
      options: options({ hardFromFloor: 1, observedGifts: [9222, 9217, 9435] }),
    });
    expect(result.start.observed.map((o) => [o.giftId, o.pinned])).toEqual([
      [9222, true],
      [9217, true],
      [9435, true],
    ]);
    expect(packAt(result, 5).packId).toBe(1025);
    expect(result.unresolved).toEqual([expect.objectContaining({ giftId: 9751, reason: 'pack-conflict' })]);
    expect(result.stats.coveredWanted).toBe(4);
  });

  it('stays deterministic and within the invariants with pins', () => {
    const input: PlanInput = {
      deck: LCB_DECK,
      wanted: want(...SCENARIO),
      options: hard15({ observedGifts: PINS }),
    };
    const a = planRoute(input, data, indexes);
    const b = planRoute(input, data, indexes);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.start.observed.length).toBeLessThanOrEqual(data.rules.giftObservation.max);
    for (const entry of a.start.observed.filter((o) => o.pinned)) expect(PINS).toContain(entry.giftId);
    const packs = a.floors.filter((f) => f.packId !== null).map((f) => f.packId);
    expect(new Set(packs).size).toBe(packs.length);
    for (const floor of a.floors) {
      if (floor.packId === null) continue;
      expect(indexes.packsByFloor[floor.mode].get(floor.floor)).toContain(floor.packId);
    }
  });

  it('routes every pack when observation is off and reports the pins it could not use', () => {
    const result = planWithout({
      deck: LCB_DECK,
      wanted: want(...SCENARIO),
      options: hard15({ observedGifts: PINS }),
    });
    expect(result.start.observed).toEqual([]);
    expect(result.warnings.find((w) => w.code === 'observation-trimmed')?.giftIds).toEqual(PINS);
    expect(result.floors.filter((f) => f.packId !== null).map((f) => [f.floor, f.packId])).toEqual([
      [1, 1004],
      [2, 1005],
      [3, 1010],
      [4, 1012],
    ]);
    expect(result.stats.requiredPacks).toBe(4);
    expect(result.generalDrops).toEqual([9191]);
  });

  it('keeps three pins first under a twenty-gift load', () => {
    const extra = data.gifts
      .filter((g) => g.acquisition.kind === 'packLimited' && ![9408, 9409, 9419, 9423].includes(g.id))
      .slice(0, 14)
      .map((g) => g.id);
    const wanted = want(...SCENARIO, 9088, 9249, ...extra);
    expect(wanted).toHaveLength(20);
    const started = performance.now();
    const result = planRoute(
      { deck: LCB_DECK, wanted, options: hard15({ observedGifts: PINS }) },
      data,
      indexes,
    );
    expect(performance.now() - started).toBeLessThan(500);
    expect(result.start.observed.length).toBeLessThanOrEqual(3);
    expect(result.start.observed.filter((o) => o.pinned).map((o) => o.giftId)).toEqual(PINS);
    const packs = result.floors.filter((f) => f.packId !== null).map((f) => f.packId);
    expect(new Set(packs).size).toBe(packs.length);
  });
});
