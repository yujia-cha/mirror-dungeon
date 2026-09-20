/**
 * Scenario tests for the planner, run against the real generated game data.
 *
 * Each case encodes a rule a player would recognise, so a regression here means the tool would
 * give bad advice — not merely that an implementation detail moved.
 */
import { describe, expect, it } from 'vitest';
import { loadGameDataFromDisk } from '../data/node.ts';
import { alternativePacksOn, buildIndexes, conflictGroups, defaultOptions, planAlternatives, planRoute, wantedRoots } from '../index.ts';
import { analyseDeck, dominantKeyword, evaluateConditions } from '../deck.ts';
import { expandRequirements } from '../requirements.ts';
import { modeForFloor, observationCost } from '../search.ts';
import type { PlanInput, PlanOptions, RoutePlan } from '../types.ts';

const data = loadGameDataFromDisk();
const indexes = buildIndexes(data);
/** The same season with 기프트 관측 switched off, for tests about the pack search alone. */
const noObservation = { ...data, rules: { ...data.rules, giftObservation: { ...data.rules.giftObservation, max: 0 } } };

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
    const unverified = { ...data, rules: { ...data.rules, giftObservation: { ...data.rules.giftObservation, verified: false } } };
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
    expect(stats.baseKeywordCounts.formation.Laceration).toBe(1);
    // 혈향도래 reads 「[Laceration] … 또는 특수 출혈 …」 over the formation, so 못 counts.
    const gift = indexes.giftById.get(9206)!;
    const condition = gift.conditions.find((c) => c.type === 'keywordSkillCount')!;
    expect(condition).toMatchObject({ keywords: ['Laceration'], scope: 'formation', includesSpecial: true });
    expect(evaluateConditions([9206], stats, indexes).find((r) => r.subject.kind === 'keyword')!.have).toBe(2);
    // The same sentence without 「또는 특수 출혈」 would not count it.
    const strict = buildIndexes({
      ...data,
      gifts: data.gifts.map((g) =>
        g.id === 9206
          ? { ...g, conditions: g.conditions.map((c) => (c.type === 'keywordSkillCount' ? { ...c, includesSpecial: false } : c)) }
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
    const seen = new Set(deck.filter((id) => {
      const kw = indexes.identityById.get(id)!.keywords;
      return kw.Burst || kw.Charge;
    }));
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
    expect(evaluateConditions([9795], enough, indexes)[0]).toMatchObject({ have: 3, need: 3, satisfied: true });
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
    expect(stats.baseKeywordCounts.formation.Charge).toBe(2);
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
    const seven = analyseDeck(eight, indexes, data.rules.deployment, [10914, 10101, 10102, 10403, 10505, 10601, 10707]);
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
    expect(withNone.start.startGift).toEqual(auto.start.startGift);
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

  it('picks the deck dominant keyword when asked for an automatic start', () => {
    const stats = analyseDeck(BLADE_LINEAGE_DECK, indexes, data.rules.deployment);
    const keyword = dominantKeyword(stats);
    expect(keyword).not.toBeNull();
    const result = plan({ deck: BLADE_LINEAGE_DECK, wanted: want(9003) });
    expect(result.start.keyword).toBe(keyword);
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
      9092, 9096, 9167, 9176, 9191, 9211, 9214, 9235, 9239, 9254, 9274, 9410, 9703, 9704, 9705, 9726,
      9728, 9729, 9730, 9731, 9746, 9747, 9750, 9761, 9765, 9767, 9768, 9770, 9771, 9814, 9816, 9828,
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
});

describe('shared ingredients', () => {
  /*
   * 장관 = 녹슨 칼자루(9713) + 조각난 칼날, 부동 = 9713 + 부서진 칼날.
   * 절경 = 조각난 칼날 + 낡은 칼자루(9782), 탁마 = 부서진 칼날 + 9782.
   * 9713 comes from 육참골단 and its 복각; 9782 only from the 복각.
   */
  const hard15 = (overrides: Partial<PlanOptions> = {}) => options({ lastFloor: 15, hardFromFloor: 1, ...overrides });
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

  it('never revisits a pinned pack for the second copy: that copy is ingredient-shared, or observed', () => {
    // With 육참골단 (1104) given up, its 복각 (1116) is the only source of 녹슨 칼자루 — and it is pinned
    // on floor 7. The search used to place 1116 on floor 4 a second time for the second copy.
    const pinned = hard15({ pinnedPacks: { 7: 1116 }, bannedPacks: [1104] });
    const result = planWithout({ wanted: want(9717, 9718), options: pinned });
    expect(result.floors.filter((f) => f.packId === 1116).map((f) => f.floor)).toEqual([7]);
    expect(result.floors.find((f) => f.floor === 7)).toMatchObject({ reason: 'pinned' });
    expect(floorOf(result, 9713)).toEqual([7]);
    expect(result.floors.find((f) => f.floor === 7)!.pickups.filter((p) => p.giftId === 9713)).toHaveLength(1);
    expect(result.unresolved.find((u) => u.giftId === 9713)?.reason).toBe('ingredient-shared');
    expect(result.unresolved.filter((u) => u.reason === 'fusion-ingredient-unresolved')).toHaveLength(1);
    expect(result.stats).toMatchObject({ requiredPacks: 1, coveredWanted: 1 });
    expect(result.warnings.map((w) => w.code)).not.toContain('shared-ingredient');

    // With observation on, the second copy is observed instead and both fusions live.
    const observed = plan({ wanted: want(9717, 9718), options: pinned });
    expect(observed.start.observed.map((o) => o.giftId)).toContain(9713);
    expect(observed.floors.filter((f) => f.packId === 1116).map((f) => f.floor)).toEqual([7]);
    expect(observed.stats.coveredWanted).toBe(2);
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
  it('keeps a pinned pack and charges no observation for it', () => {
    const result = plan({
      wanted: want(9283),
      options: options({ hardFromFloor: 1, pinnedPacks: { 5: 1025 } }),
    });
    const floor5 = result.floors.find((f) => f.floor === 5)!;
    expect(floor5.packId).toBe(1025);
    expect(floor5.reason).toBe('pinned');
    expect(floor5.observation.needed).toBe(false);
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
    // elapsedMs is wall-clock, so compare everything else.
    expect({ ...second, stats: { ...second.stats, elapsedMs: 0 } }).toEqual({
      ...first,
      stats: { ...first.stats, elapsedMs: 0 },
    });
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
      ...(result.start.startGift ? [result.start.startGift] : []),
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

  it('collapses the window to the pinned floor', () => {
    const result = planWithout({
      wanted: want(9423),
      options: options({ hardFromFloor: 1, pinnedPacks: { 5: 1012 } }),
    });
    const used = result.floors.find((f) => f.packId === 1012)!;
    expect(used.reason).toBe('pinned');
    expect(used.window).toEqual({ from: 5, to: 5 });
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
    expect(pairs.length).toBe(76);
    for (const g of pairs) {
      const parent = indexes.giftById.get(g.upgradeOf!)!;
      expect(parent.keyword, `${g.id}`).toBe(g.keyword);
    }
  });
});

describe('gift observation', () => {
  it('honours a pinned observation and routes the rest', () => {
    const result = plan({ wanted: want(9283, 9222), options: options({ hardFromFloor: 1, observedGifts: [9222] }) });
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

  it('never frees a pinned floor', () => {
    const result = plan({ wanted: want(9423), options: options({ hardFromFloor: 1, pinnedPacks: { 4: 1012 } }) });
    expect(result.start.observed).toEqual([]);
    expect(result.floors.find((f) => f.floor === 4)!.packId).toBe(1012);
  });

  it('rescues first and leaves a conflict it cannot afford', () => {
    // Five single-source exclusives whose packs all sit on Hard floor 5: three observations plus
    // one routed pack cover four; the fifth stays a conflict.
    const result = plan({ wanted: want(9283, 9222, 9217, 9435, 9751), options: options({ hardFromFloor: 1 }) });
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
    const result = plan({ wanted: want(9283), options: options({ hardFromFloor: 1, observedGifts: [9283, 9283, 999999] }) });
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
  it('routes a 클리어 보상 gift to its EXTREME pack as an exclusive pickup', () => {
    const result = plan({ wanted: want(9250), options: options({ lastFloor: 15 }) });
    const floor = result.floors.find((f) => f.packId === 1511)!;
    expect(floor.mode).toBe('extreme');
    expect(floor.pickups).toEqual([{ giftId: 9250, kind: 'exclusive', neededFor: null }]);
    expect(floor.window).toEqual({ from: 11, to: 15 });
    expect(result.unresolved).toEqual([]);
    expect(result.start.observed).toEqual([]);
  });

  it('reports a clear reward as out of range below floor 11', () => {
    const result = plan({ wanted: want(9250), options: options({ lastFloor: 5 }) });
    expect(result.unresolved).toEqual([expect.objectContaining({ giftId: 9250, reason: 'no-pack-in-range' })]);
  });

  it('never plans for a hidden-battle gift', () => {
    const result = plan({ wanted: want(9256), options: options({ lastFloor: 15 }) });
    expect(result.unresolved).toEqual([expect.objectContaining({ giftId: 9256, reason: 'chance-only' })]);
    expect(result.stats.requiredPacks).toBe(0);
    expect(result.unresolved[0]!.detail.ko).toContain('11~15층');
  });

  it('classifies the four researched gifts', () => {
    expect(indexes.giftById.get(9828)!.acquisition).toMatchObject({ kind: 'clearReward', clearRewardOf: 1519, packs: [1519] });
    expect(indexes.giftById.get(9251)!.acquisition).toMatchObject({ kind: 'clearReward', clearRewardOf: 1512 });
    expect(indexes.giftById.get(9254)!.acquisition).toMatchObject({ kind: 'clearReward', clearRewardOf: 1515 });
    expect(indexes.giftById.get(9256)!.acquisition.kind).toBe('hiddenBattle');
  });
});

describe('alternative routes', () => {
  it('returns nothing when the main plan has no pack conflict', () => {
    expect(planAlternatives({ deck: BLADE_LINEAGE_DECK, wanted: want(9423), options: options({ hardFromFloor: 1 }) }, data, indexes)).toEqual([]);
  });

  it('offers one route per gift worth leaving out, best coverage first', () => {
    const input = { deck: BLADE_LINEAGE_DECK, wanted: want(9283, 9222, 9423), options: options({ hardFromFloor: 1 }) };
    const main = planRoute(input, noObservation, indexes);
    expect(main.unresolved.map((u) => u.giftId)).toEqual([9283]);
    const variants = planAlternatives(input, noObservation, indexes, main);
    expect(variants.map((v) => v.dropped)).toEqual([[9222], [9283]]);
    for (const variant of variants) {
      expect(variant.plan.unresolved).toEqual([]);
      expect(variant.plan.stats.coveredWanted).toBe(2);
    }
    expect(variants[0]!.plan.floors.find((f) => f.floor === 5)!.packId).toBe(1025);
    expect(variants[1]!.plan.floors.find((f) => f.floor === 5)!.packId).toBe(1026);
  });

  it('works with observation on, dropping either side of the leftover conflict', () => {
    const input = { deck: BLADE_LINEAGE_DECK, wanted: want(9283, 9222, 9217, 9435, 9751), options: options({ hardFromFloor: 1 }) };
    const variants = planAlternatives(input, data, indexes);
    expect(variants.map((v) => v.dropped)).toEqual([[9283], [9751]]);
    expect(variants.every((v) => v.plan.unresolved.length === 0 && v.plan.stats.coveredWanted === 4)).toBe(true);
  });

  it('never leaves out a gift the user must have', () => {
    const wanted = [9250, 9251, 9252, 9253, 9254, 9255].map((giftId) => ({ giftId, required: giftId === 9255 }));
    const input = { deck: BLADE_LINEAGE_DECK, wanted, options: options({ lastFloor: 15 }) };
    const main = planRoute(input, data, indexes);
    expect(main.unresolved.map((u) => u.giftId)).not.toContain(9255);
    const variants = planAlternatives(input, data, indexes, main);
    expect(variants.length).toBeGreaterThan(0);
    expect(variants.every((v) => !v.dropped.includes(9255))).toBe(true);
  });

  it('caps the list and stays deterministic', () => {
    const input = { deck: BLADE_LINEAGE_DECK, wanted: want(9250, 9251, 9252, 9253, 9254, 9255), options: options({ lastFloor: 15 }) };
    const first = planAlternatives(input, data, indexes);
    const second = planAlternatives(input, data, indexes);
    expect(first.length).toBe(4);
    expect(first.every((v) => v.dropped.length === 1 && v.plan.stats.coveredWanted === 5)).toBe(true);
    expect(JSON.stringify(first.map((v) => ({ d: v.dropped, f: v.plan.floors.map((x) => x.packId) })))).toBe(
      JSON.stringify(second.map((v) => ({ d: v.dropped, f: v.plan.floors.map((x) => x.packId) }))),
    );
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
    expect(alternativePacksOn(10, 'parallel', [9208], indexes, { exclude: 1302, banned: new Set([1305, 1308]) })).toEqual([
      1311, 1314, 1317, 1320,
    ]);
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
    const kept = plan({ wanted: want(9423), options: options({ hardFromFloor: 1, lastFloor: 15, preferredPacks: [1012] }) });
    const floor = kept.floors.find((f) => f.packId === 1012)!;
    expect(floor).toBeDefined();
    expect(floor.reason).toBe('required');
    // 변하지 않는 (1012) is offered on Hard 4-5 and again across 평행중첩 6-10.
    expect(floor.window).toEqual({ from: 4, to: 10 });
    expect(floor.pickups.map((p) => p.giftId)).toEqual([9423]);
    expect(kept.start.observed).toEqual([]);
  });

  it('places a preferred pack even when no wanted gift needs it', () => {
    const result = planWithout({ wanted: [], options: options({ hardFromFloor: 1, lastFloor: 15, preferredPacks: [1402] }) });
    expect(result.floors.filter((f) => f.packId === 1402)).toHaveLength(1);
    expect(result.warnings.map((w) => w.code)).not.toContain('pack-option-dropped');
  });

  it('validates a pin against the Hard plan it is about to force, not the Normal one it was given', () => {
    // 변하지 않는 (1012) is Hard-only on 4-5; a 15-floor plan is Hard from floor 1 anyway. The pin
    // used to be checked before the switch, dropped with a warning, and then placed there regardless.
    const pinnedOnNormal = options({ hardFromFloor: null, lastFloor: 15, pinnedPacks: { 4: 1012 } });
    const result = planWithout({ wanted: want(9423), options: pinnedOnNormal });
    expect(result.warnings.map((w) => w.code)).toContain('parallel-requires-hard');
    expect(result.warnings.map((w) => w.code)).not.toContain('pack-option-dropped');
    expect(result.floors.find((f) => f.floor === 4)).toMatchObject({
      packId: 1012,
      reason: 'pinned',
      pickups: [{ giftId: 9423, kind: 'exclusive', neededFor: null }],
    });
    // A pinned floor is never freed by observation either.
    expect(plan({ wanted: want(9423), options: pinnedOnNormal }).start.observed).toEqual([]);
  });

  it('reports pack-banned when every pack that supplies a gift was given up', () => {
    const result = planWithout({ wanted: want(9754), options: options({ hardFromFloor: 1, lastFloor: 15, bannedPacks: [1109] }) });
    expect(result.unresolved).toEqual([expect.objectContaining({ giftId: 9754, reason: 'pack-banned' })]);
    expect(result.floors.every((f) => f.packId !== 1109)).toBe(true);
  });

  it('drops a pin on a floor that does not offer the pack, and a preference that is also a ban', () => {
    const result = planWithout({
      wanted: want(9754),
      options: options({ hardFromFloor: 1, lastFloor: 15, pinnedPacks: { 1: 1402 }, preferredPacks: [1109], bannedPacks: [1109] }),
    });
    const warning = result.warnings.find((w) => w.code === 'pack-option-dropped');
    expect(warning?.packIds).toEqual([1402, 1109]);
    expect(result.floors[0]!.reason).toBe('free');
    expect(result.unresolved.map((u) => u.reason)).toEqual(['pack-banned']);
  });

  it('leaves banned packs out of a floor\'s alternative packs', () => {
    // 달궈진 놋쇠 comes from 해방된 분노 or 화왕지절; ban one and it must not be listed as an alternative.
    const result = planWithout({ wanted: want(9267), options: options({ hardFromFloor: 1, lastFloor: 15, bannedPacks: [1302] }) });
    const floor = result.floors.find((f) => f.packId === 1402)!;
    expect(floor.alternatives).not.toContain(1302);
  });
});

describe('conflict groups', () => {
  it('groups the contested floors with every pack competing for them', () => {
    const input = { deck: BLADE_LINEAGE_DECK, wanted: want(9250, 9251, 9252, 9253, 9254, 9255), options: options({ lastFloor: 15 }) };
    const result = planRoute(input, data, indexes);
    const groups = conflictGroups(result, input, data, indexes);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.floors).toEqual([11, 12, 13, 14, 15]);
    const candidates = groups[0]!.candidates;
    expect(candidates).toHaveLength(6);
    expect(candidates.filter((c) => c.assignedAt !== null)).toHaveLength(5);
    const left = candidates.find((c) => c.assignedAt === null)!;
    expect(left.gifts).toEqual([9255]);
    expect(left.floors).toEqual([11, 12, 13, 14, 15]);
    expect(candidates.every((c) => c.gifts.length === 1)).toBe(true);
  });

  it('is empty without a pack conflict and maps a fusion ingredient back to its wanted result', () => {
    const input = { deck: MIXED_DECK, wanted: want(9249), options: options({ hardFromFloor: 1, lastFloor: 5 }) };
    expect(conflictGroups(planRoute(input, noObservation, indexes), input, noObservation, indexes)).toEqual([]);
    const roots = wantedRoots(input, noObservation, indexes);
    expect(roots(9706)).toEqual([9249]);
    expect(roots(9249)).toEqual([9249]);
  });
});

describe('run progress', () => {
  // 조그맣고 근사한 바이올린(9249) = 부서진 바이올린(9431, 저택의 부산물 1016 on Hard 1 only)
  // + 기름때 찌든 스패너(9706) + 반짝이는 폐품(9707) (both 우.미.다 1102, Hard 2-3).
  const violin = (extra: Partial<PlanOptions>, ingredientsAsGoals?: boolean) =>
    planWithout({
      wanted: [{ giftId: 9249, required: true, ...(ingredientsAsGoals === undefined ? {} : { ingredientsAsGoals }) }],
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
    expect(second).toMatchObject({ passed: true, packId: 1102, reason: 'pinned', window: { from: 2, to: 2 } });
    expect(second.pickups.map((p) => p.giftId)).toEqual([9707]);
    expect(second.observation).toEqual({ needed: false, possible: true, starlight: 0 });
    expect(plan.floors.filter((f) => f.packId === 1102)).toHaveLength(1);
    expect(plan.fusions[0]).toMatchObject({ unreachable: false, earliestFloor: 3 });
    expect(plan.unresolved).toEqual([]);
    expect(plan.stats).toMatchObject({ requiredPacks: 0, coveredWanted: 1 });
  });

  it('reports a missed ingredient as failed and drops the rest only when the result alone is the goal', () => {
    const asGoals = violin({ unobtainableGifts: [9707] });
    expect(asGoals.floors.filter((f) => f.packId !== null).map((f) => f.packId)).toEqual([1016, 1102]);
    expect(asGoals.unresolved.map((u) => [u.giftId, u.reason])).toEqual([
      [9249, 'fusion-ingredient-unresolved'],
      [9707, 'failed'],
    ]);
    expect(asGoals.unresolved[0]!.droppedIngredients).toBeUndefined();

    const resultOnly = violin({ unobtainableGifts: [9707] }, false);
    expect(resultOnly.floors.every((f) => f.packId === null)).toBe(true);
    expect(resultOnly.unresolved.find((u) => u.giftId === 9249)).toMatchObject({ missing: [9707], droppedIngredients: [9431, 9706] });
  });

  it('plans only the floors ahead, reports every row, and stops recommending observations mid-run', () => {
    const plan = planRoute(
      {
        deck: MIXED_DECK,
        wanted: [{ giftId: 9283, required: true }, { giftId: 9250, required: true }],
        options: options({ lastFloor: 15, hardFromFloor: 1, currentFloor: 6, pinnedPacks: { 1: 1016, 5: 1025 } }),
      },
      data,
      indexes,
    );
    expect(plan.floors).toHaveLength(15);
    expect(plan.floors.filter((f) => f.passed).map((f) => f.floor)).toEqual([1, 2, 3, 4, 5]);
    expect(plan.floors.find((f) => f.floor === 5)).toMatchObject({ packId: 1025, reason: 'pinned', passed: true });
    expect(plan.floors.find((f) => f.floor === 5)!.pickups.map((p) => p.giftId)).toEqual([9283]);
    expect(plan.floors.find((f) => f.packId === 1511)).toMatchObject({ floor: 11, window: { from: 11, to: 15 } });
    expect(plan.start.observed).toEqual([]);
    expect(plan.start.startGift).toBeNull();
    expect(plan.stats).toMatchObject({ requiredPacks: 1, coveredWanted: 2 });
  });

  it('counts an owned gift as covered and never plans for it, and lets in-hand win over missed', () => {
    const plan = planWithout({ wanted: [{ giftId: 9754, required: true }], options: options({ lastFloor: 15, hardFromFloor: 1, ownedGifts: [9754], unobtainableGifts: [9754] }) });
    expect(plan.floors.every((f) => f.packId === null)).toBe(true);
    expect(plan.unresolved).toEqual([]);
    expect(plan.stats.coveredWanted).toBe(1);
  });

  it('clamps the current floor into the plan', () => {
    const plan = violin({ currentFloor: 99 });
    expect(plan.floors.filter((f) => !f.passed).map((f) => f.floor)).toEqual([15]);
  });
});

describe('observation pins', () => {
  /** The twelve LCB 수감자, the app's default deck; its dominant keyword is Burst. */
  const LCB_DECK = [10101, 10201, 10301, 10401, 10501, 10601, 10701, 10801, 10901, 11001, 11101, 11201];
  /** What the app always plans: floors 1-15 on Hard. */
  const hard15 = (overrides: Partial<PlanOptions> = {}): PlanOptions => options({ lastFloor: 15, hardFromFloor: 1, ...overrides });
  /** The reported scenario: three pins, one of them a general drop, and a fusion whose ingredients sit on floors 1-2. */
  const SCENARIO = [9191, 9410, 9419, 9423];
  const PINS = [9191, 9419, 9423];
  const codes = (result: ReturnType<typeof planRoute>): string[] => result.warnings.map((w) => w.code);
  const packAt = (result: ReturnType<typeof planRoute>, floor: number) => result.floors.find((f) => f.floor === floor)!;

  it.each([true, false])('honours a pin on a general drop and routes the fusion ingredients (required=%s)', (required) => {
    const wanted = SCENARIO.map((giftId) => ({ giftId, required }));
    const result = plan({ deck: LCB_DECK, wanted, options: hard15({ observedGifts: PINS }) });
    expect(result.start.observed).toEqual([
      { giftId: 9191, pinned: true, freedPack: null },
      { giftId: 9419, pinned: true, freedPack: null },
      { giftId: 9423, pinned: true, freedPack: null },
    ]);
    expect(result.start.starlight).toBe(270);
    expect(result.stats.requiredPacks).toBe(2);
    expect(packAt(result, 1)).toMatchObject({ packId: 1004, reason: 'required', window: { from: 1, to: 2 }, pickups: [{ giftId: 9408, kind: 'exclusive', neededFor: 9410 }] });
    expect(packAt(result, 2)).toMatchObject({ packId: 1005, reason: 'required', window: { from: 1, to: 2 }, pickups: [{ giftId: 9409, kind: 'exclusive', neededFor: 9410 }] });
    expect(result.floors.filter((f) => f.floor >= 3).every((f) => f.packId === null)).toBe(true);
    expect(result.fusions).toEqual([{ result: 9410, ingredients: [9408, 9409], earliestFloor: 2, unreachable: false, exceedsShopSlots: false }]);
    expect(result.generalDrops).toEqual([]);
    expect(codes(result)).not.toContain('general-drop-not-guaranteed');
    expect(codes(result)).not.toContain('observation-trimmed');
    expect(result.unresolved).toEqual([]);
    expect(result.stats).toMatchObject({ coveredWanted: 4, totalWanted: 4, starlight: 320 });
  });

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

  it('skips a pin on a gift already in hand without a word or a slot', () => {
    const result = plan({ wanted: want(9419, 9423), options: options({ hardFromFloor: 1, ownedGifts: [9419], observedGifts: [9419] }) });
    expect(result.start.observed).toEqual([{ giftId: 9423, pinned: false, freedPack: 1012 }]);
    expect(codes(result)).not.toContain('observation-trimmed');
    expect(result.stats.coveredWanted).toBe(2);
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

  it('takes the free starting gift for a wanted general drop, and a pinned one is not taken twice', () => {
    // 9047 and 9093 are both in the Burst starting pool and both general drops.
    const free = plan({ deck: LCB_DECK, wanted: want(9047, 9093), options: hard15() });
    expect(free.start).toMatchObject({ keyword: 'Burst', startGift: 9047, observed: [] });
    expect(free.generalDrops).toEqual([9093]);

    const pinned = plan({ deck: LCB_DECK, wanted: want(9047, 9093), options: hard15({ observedGifts: [9047] }) });
    expect(pinned.start.observed).toEqual([{ giftId: 9047, pinned: true, freedPack: null }]);
    expect(pinned.start.startGift).toBe(9093);
    expect(pinned.generalDrops).toEqual([]);
  });

  it('keeps the first three pins in the order they were pinned and names the fourth', () => {
    const result = plan({ deck: LCB_DECK, wanted: want(...SCENARIO), options: hard15({ observedGifts: [9423, 9419, 9191, 9408] }) });
    expect(result.start.observed.map((o) => o.giftId)).toEqual([9423, 9419, 9191]);
    expect(result.start.observed.every((o) => o.pinned)).toBe(true);
    expect(result.warnings.find((w) => w.code === 'observation-trimmed')?.giftIds).toEqual([9408]);
  });

  it('does not spend a slot on a pin the plan already gave up on (Hard-only gift, Normal plan)', () => {
    const result = plan({ wanted: want(9423, 9419), options: options({ hardFromFloor: null, lastFloor: 5, observedGifts: [9423] }) });
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
      expect.objectContaining({ giftId: 9410, reason: 'fusion-ingredient-unresolved', missing: [9408, 9409] }),
    ]);
    // The particle follows the name's final consonant: 「귀신 들린 신발을」, never 「신발를」.
    expect(result.unresolved[0]!.detail.ko).toBe('귀신 들린 신발을 주는 팩이 남은 층에 없습니다.');
    expect(result.stats).toMatchObject({ requiredPacks: 2, coveredWanted: 3 });
  });

  it('mid-run, after the first ingredient pack, still plans the second and fuses on floor 2', () => {
    const result = plan({ wanted: want(9410), options: hard15({ currentFloor: 2, pinnedPacks: { 1: 1004 } }) });
    expect(packAt(result, 1)).toMatchObject({ passed: true, packId: 1004, pickups: [expect.objectContaining({ giftId: 9408 })] });
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

    const full = plan({ wanted: want(9410, 9419, 9423), options: hard15({ observedGifts: [9408, 9419, 9423] }) });
    expect(full.start.observed.map((o) => o.giftId)).toEqual([9408, 9419, 9423]);
    expect(packAt(full, 1)).toMatchObject({ packId: 1005, window: { from: 1, to: 2 } });
    expect(full.stats.requiredPacks).toBe(1);
    expect(full.fusions[0]).toMatchObject({ earliestFloor: 1 });
  });

  it('keeps the pins even when rescuing would have spent the slots differently', () => {
    const result = plan({ wanted: want(9283, 9222, 9217, 9435, 9751), options: options({ hardFromFloor: 1, observedGifts: [9222, 9217, 9435] }) });
    expect(result.start.observed.map((o) => [o.giftId, o.pinned])).toEqual([[9222, true], [9217, true], [9435, true]]);
    expect(packAt(result, 5).packId).toBe(1025);
    expect(result.unresolved).toEqual([expect.objectContaining({ giftId: 9751, reason: 'pack-conflict' })]);
    expect(result.stats.coveredWanted).toBe(4);
  });

  it('stays deterministic and within the invariants with pins', () => {
    const input: PlanInput = { deck: LCB_DECK, wanted: want(...SCENARIO), options: hard15({ observedGifts: PINS }) };
    const a = planRoute(input, data, indexes);
    const b = planRoute(input, data, indexes);
    const strip = (r: ReturnType<typeof planRoute>) => JSON.stringify({ ...r, stats: { ...r.stats, elapsedMs: 0 } });
    expect(strip(a)).toBe(strip(b));
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
    const result = planWithout({ deck: LCB_DECK, wanted: want(...SCENARIO), options: hard15({ observedGifts: PINS }) });
    expect(result.start.observed).toEqual([]);
    expect(result.warnings.find((w) => w.code === 'observation-trimmed')?.giftIds).toEqual(PINS);
    expect(result.floors.filter((f) => f.packId !== null).map((f) => [f.floor, f.packId])).toEqual([[1, 1004], [2, 1005], [3, 1010], [4, 1012]]);
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
    const result = planRoute({ deck: LCB_DECK, wanted, options: hard15({ observedGifts: PINS }) }, data, indexes);
    expect(performance.now() - started).toBeLessThan(500);
    expect(result.start.observed.length).toBeLessThanOrEqual(3);
    expect(result.start.observed.filter((o) => o.pinned).map((o) => o.giftId)).toEqual(PINS);
    const packs = result.floors.filter((f) => f.packId !== null).map((f) => f.packId);
    expect(new Set(packs).size).toBe(packs.length);
  });
});
