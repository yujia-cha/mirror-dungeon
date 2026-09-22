/**
 * One plan for the whole shell. The route is computed once from the store (goals, deck, options
 * and the run record) and handed to the stage and both side panels, together with the pack
 * context every pack surface takes and the run actions that settle gifts as floors are left.
 */
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { evaluateConditions } from '../../core/index.ts';
import type { GameData, Gift, Keyword } from '../../core/schema.ts';
import { observable, planAlternatives, planRoute } from '../../core/index.ts';
import type { DeckStats, GameIndexes } from '../../core/types.ts';
import { pick, t, type Lang } from '../i18n.ts';
import { useApp } from '../store.ts';
import { keywordName } from '../format.ts';
import { conditionText } from '../condition-text.ts';
import { judgementsByGift } from '../lib/judgement.ts';
import { planInputFor } from '../lib/plan-input.ts';
import { autoFailedFor, exclusivesIndex, lastFloorOf, stageModeFor } from '../lib/stage.ts';
import { blockedGifts, entanglements, ingredientsOf } from '../lib/entangle.ts';
import { carriedBy } from '../lib/goal-toggle.ts';
import { upgradeChildren } from '../lib/upgrade-children.ts';
import { useDesktop } from '../lib/useMediaQuery.ts';
import { usePageHistory } from '../lib/usePageHistory.ts';
import { GiftDetailSheet } from '../components/GiftDetailSheet.tsx';
import type { PackContext } from '../components/PackSheet.tsx';
import { PlanCtx, type PlanState } from './plan-context.ts';

export function PlanProvider({ data, indexes, stats, lang, children }: { data: GameData; indexes: GameIndexes; stats: DeckStats; lang: Lang; children: ReactNode }) {
  const deck = useApp((s) => s.deck);
  const deployed = useApp((s) => s.deployed);
  const wanted = useApp((s) => s.wanted);
  const options = useApp((s) => s.options);
  const fusionGoal = useApp((s) => s.fusionGoal);
  const run = useApp((s) => s.run);
  const preferPack = useApp((s) => s.preferPack);
  const banPack = useApp((s) => s.banPack);
  const restorePack = useApp((s) => s.restorePack);
  const toggleObserved = useApp((s) => s.toggleObserved);
  const toggleWanted = useApp((s) => s.toggleWanted);
  const removeWanted = useApp((s) => s.removeWanted);
  const visitPack = useApp((s) => s.visitPack);
  const unvisitPack = useApp((s) => s.unvisitPack);
  const setGiftStatus = useApp((s) => s.setGiftStatus);
  const nextFloor = useApp((s) => s.nextFloor);
  const setStageFloor = useApp((s) => s.setStageFloor);
  // The alternative on display is remembered by the gift it drops, not by its position: a run
  // mark recomputes the plan, and the same variant is re-found in the new list. Gone (the conflict
  // resolved, the gift deselected) means back to the main plan. An index reset on every input
  // change used to flip the panel back to the main plan on any gift mark.
  const [variantKey, setVariantKey] = useState<number | null>(null);
  const [detailGift, setDetailGift] = useState<number | null>(null);
  const desktop = useDesktop();
  const closeSheet = useCallback(() => setDetailGift(null), []);
  // On a phone the sheet owns a history entry of its own, above the panel page's, so one back
  // gesture closes the sheet and the next one the page.
  usePageHistory(detailGift !== null, closeSheet, !desktop);

  // How far the run goes is the season's, not the app's: `options.lastFloor` only bounds what a
  // saved or shared plan may claim.
  const lastFloor = useMemo(() => lastFloorOf(data), [data]);
  const input = useMemo(
    () => planInputFor({ deck, deployed, wanted, options, fusionGoal, run }, { lastFloor }),
    [deck, deployed, wanted, options, fusionGoal, run, lastFloor],
  );
  const plan = useMemo(() => (input.wanted.length === 0 ? null : planRoute(input, data, indexes)), [input, data, indexes]);
  const variants = useMemo(
    () => (plan && plan.unresolved.some((u) => u.reason === 'pack-conflict') ? planAlternatives(input, data, indexes, plan) : []),
    [plan, input, data, indexes],
  );
  const variantIndex = variantKey === null ? 0 : variants.findIndex((v) => v.dropped[0] === variantKey) + 1;
  const setVariantIndex = useCallback(
    (index: number) => setVariantKey(index > 0 ? (variants[index - 1]?.dropped[0] ?? null) : null),
    [variants],
  );
  const variant = variantIndex > 0 ? variants[variantIndex - 1] : undefined;
  const shown = variant?.plan ?? plan;
  const exclusivesOf = useMemo(() => exclusivesIndex(data, indexes), [data, indexes]);
  const childrenOf = useMemo(() => upgradeChildren(data), [data]);
  const entangled = useMemo(() => entanglements(wanted, indexes, data.rules.fusion.maxShopSlots), [wanted, indexes, data]);
  const blocked = useMemo(() => blockedGifts(wanted, indexes, data.rules.fusion.maxShopSlots), [wanted, indexes, data]);
  // One selection rule for every surface: see `lib/goal-toggle.ts`.
  const carryIndex = useMemo(
    () => ({ indexes, childrenOf, maxShopSlots: data.rules.fusion.maxShopSlots }),
    [indexes, childrenOf, data],
  );
  const toggleGoal = useCallback((gift: Gift): void => toggleWanted(gift.id, carriedBy(gift, carryIndex)), [toggleWanted, carryIndex]);

  const value = useMemo<PlanState>(() => {
    const giftName = (id: number): string => pick(indexes.giftById.get(id)?.name, lang);
    const packName = (id: number): string => pick(indexes.packById.get(id)?.name, lang);
    const keywordLabel = (id: Keyword): string => keywordName(id, data.enums, lang);
    const judgements = judgementsByGift(shown?.conditions ?? []);
    /*
     * Fusion goals the plan has given up on — a missed ingredient is the usual way, and core says
     * so with `fusion-ingredient-unresolved` and even drops the visits that served only them.
     * The app has to read that: what the route no longer chases must stop looking chased.
     */
    const deadFusions = new Set(
      (shown?.unresolved ?? [])
        .filter((entry) => entry.reason === 'fusion-ingredient-unresolved')
        .map((entry) => entry.giftId),
    );
    /** Ingredient -> the dead fusions that wanted it, so a tile can say why it stopped mattering. */
    const deadFusionOf = new Map<number, number[]>();
    for (const resultId of deadFusions) {
      const result = indexes.giftById.get(resultId);
      if (!result?.fusion) continue;
      for (const id of ingredientsOf(result, indexes, data.rules.fusion.maxShopSlots)) {
        deadFusionOf.set(id, [...(deadFusionOf.get(id) ?? []), resultId]);
      }
    }
    const giftTitle = (id: number): string | undefined => {
      const reports = (shown?.conditions ?? []).filter((c) => c.giftId === id);
      const parts = reports.map((r) => conditionText(r, data.enums, lang));
      // Only when nothing live still wants it: an ingredient two fusions share is still chased by
      // the other one, and saying 「조합 불가」 there would be false.
      const dead = deadFusionOf.get(id);
      if (dead && !needed.has(id)) {
        parts.push(t('giftFusionDead', lang, { result: dead.map(giftName).join(', ') }));
      }
      return parts.length > 0 ? parts.join(' / ') : undefined;
    };
    const goals = new Set(input.wanted.map((w) => w.giftId));
    /*
     * What the route is actually out to collect. A fusion goal is a promise about its ingredients
     * too — the search chases them, and a pack that drops one is worth entering — so they wear the
     * goal's ring wherever a pack lists its drops. A goal marked 「재료는 목표가 아님」
     * (`ingredientsAsGoals: false`) keeps its ingredients out, exactly as it keeps them out of the plan.
     */
    const needed = new Set(goals);
    for (const want of input.wanted) {
      if (want.ingredientsAsGoals === false) continue;
      // A fusion the plan gave up on promises nothing about its ingredients any more. Leaving them
      // ringed sent the player after pieces that could no longer finish anything — and core had
      // already dropped the visits that served only them, so the ring outlived the route.
      if (deadFusions.has(want.giftId)) continue;
      const gift = indexes.giftById.get(want.giftId);
      if (!gift?.fusion) continue;
      for (const id of ingredientsOf(gift, indexes, data.rules.fusion.maxShopSlots)) needed.add(id);
    }
    // The plan on screen decides, not the base one: entering a pack while an alternative route is
    // selected must hand over that route's observations, never the ones it replaced.
    const startGifts = shown ? [...shown.start.observed.map((o) => o.giftId), ...(shown.start.startGift ? [shown.start.startGift] : [])] : [];
    // Leaving floor 1 for the first time is when the start-of-run gifts land in hand.
    const startSettle = run.currentFloor === 1 ? startGifts : [];
    /**
     * What leaving `floor` records: the start-of-run gifts when floor 1 is behind for the first
     * time, and the goal drops of a pack entered there that the player never marked. Every way off
     * a floor settles the same — 「다음 층」 and a forward step on the floor strip alike.
     */
    const settleFor = (floor: number): { got: number[]; failed: number[] } => {
      const entered = run.visits[floor];
      return { got: startSettle, failed: entered !== undefined ? autoFailedFor(entered, goals, run.giftStatus, exclusivesOf) : [] };
    };
    const enter = (packId: number): void => visitPack(packId, run.stageFloor, { got: startSettle });
    const next = (): void => nextFloor(settleFor(run.stageFloor));
    /** Show `floor`; walking forward settles every floor left behind on the way. */
    const goTo = (floor: number): void => {
      const from = run.stageFloor;
      if (floor <= from) return setStageFloor(floor);
      const got = startSettle;
      const failed = new Set<number>();
      for (let f = from; f < floor; f += 1) for (const id of settleFor(f).failed) failed.add(id);
      return setStageFloor(floor, { got, failed: [...failed] });
    };
    const leave = (packId: number): void => unvisitPack(packId, { reset: exclusivesOf(packId) });
    const canObserve = (id: number): boolean => {
      const gift = indexes.giftById.get(id);
      return gift ? observable(gift, data.rules) : false;
    };
    const ctx: PackContext = {
      indexes,
      judgements,
      giftTitle,
      giftName,
      packName,
      observable: canObserve,
      observed: new Set((shown?.start.observed ?? []).filter((o) => o.pinned).map((o) => o.giftId)),
      wanted: goals,
      needed,
      preferred: new Set(options.preferredPacks),
      banned: new Set(options.bannedPacks),
      assignedAt: (packId) => shown?.floors.find((f) => f.packId === packId && f.reason !== 'free')?.floor ?? null,
      onPrefer: variant ? undefined : preferPack,
      onBan: variant ? undefined : banPack,
      onRestore: variant ? undefined : restorePack,
      onToggleObserved: variant ? undefined : (giftId) => toggleObserved(giftId, { max: data.rules.giftObservation.max, observable: canObserve }),
      onToggleWanted: variant
        ? undefined
        : (giftId) => {
            const gift = indexes.giftById.get(giftId);
            if (gift) toggleGoal(gift);
          },
      onGiveUpGift: variant ? undefined : removeWanted,
      run: {
        currentFloor: run.currentFloor,
        stageFloor: run.stageFloor,
        enteredHere: run.visits[run.stageFloor] ?? null,
        visitedAt: (packId) => {
          const entry = Object.entries(run.visits).find(([, id]) => id === packId);
          return entry ? Number(entry[0]) : null;
        },
        giftStatus: (giftId) => run.giftStatus[giftId] ?? null,
        onEnter: variant ? undefined : enter,
        // The sheet's 「입장 취소」 clears what the stage's 「돌아가기」 clears: one undo, one rule.
        onUnvisit: leave,
        onGiftStatus: setGiftStatus,
      },
      lang,
    };
    return {
      data,
      indexes,
      stats,
      lang,
      input,
      plan,
      shown,
      variants,
      variantIndex,
      setVariantIndex,
      variant,
      goals,
      childrenOf,
      entangled,
      blocked,
      toggleGoal,
      needed,
      judgements,
      giftTitle,
      giftName,
      packName,
      keywordLabel,
      ctx,
      exclusivesOf,
      startGifts,
      stageMode: stageModeFor(run, run.stageFloor, lastFloor),
      enter,
      next,
      goTo,
      leave,
      openGift: setDetailGift,
    };
  }, [
    data,
    indexes,
    stats,
    lang,
    lastFloor,
    input,
    plan,
    shown,
    variants,
    variantIndex,
    setVariantIndex,
    variant,
    options,
    run,
    exclusivesOf,
    childrenOf,
    entangled,
    blocked,
    preferPack,
    banPack,
    restorePack,
    toggleObserved,
    toggleGoal,
    removeWanted,
    visitPack,
    unvisitPack,
    setGiftStatus,
    nextFloor,
    setStageFloor,
  ]);

  // The sheet is hosted here and nowhere else, so a tile on the stage, in the tracker, in the
  // route panel or in the items tab opens the same details — and the sheet outlives the surface
  // that opened it. A sheet hosted inside a panel would die with the panel on a phone, where the
  // panel is a full-screen page that unmounts when it closes.
  const sheetGift = detailGift !== null ? indexes.giftById.get(detailGift) : undefined;
  return (
    <PlanCtx.Provider value={value}>
      {children}
      {sheetGift ? (
        <GiftDetailSheet
          gift={sheetGift}
          reports={evaluateConditions([sheetGift.id], stats, indexes)}
          entangled={entangled.get(sheetGift.id) ?? []}
          data={data}
          indexes={indexes}
          lang={lang}
          onToggleWanted={toggleGoal}
          blocked={wanted.includes(sheetGift.id) ? undefined : blocked.get(sheetGift.id)}
          onClose={closeSheet}
        />
      ) : null}
    </PlanCtx.Provider>
  );
}
