/**
 * The plan context's type, the context object and its hook.
 *
 * Split out of `PlanContext.tsx` so that file exports only the component: Vite's fast refresh gives
 * up on a module that mixes components with other exports, which turned every edit to the provider
 * into a full reload. `react-refresh/only-export-components` was the last warning `npm run check`
 * had left.
 */
import { createContext, useContext } from 'react';
import type { Gift, GameData, Keyword } from '../../core/schema.ts';
import type { DeckStats, GameIndexes, PlanInput, RoutePlan } from '../../core/types.ts';
import type { RouteVariant } from '../../core/index.ts';
import type { Lang } from '../i18n.ts';
import type { Judgement } from '../lib/judgement.ts';
import type { Block, Entanglement } from '../lib/entangle.ts';
import type { StageMode } from '../lib/stage.ts';
import type { PackContext } from '../components/PackSheet.tsx';

export interface PlanState {
  data: GameData;
  indexes: GameIndexes;
  stats: DeckStats;
  lang: Lang;
  input: PlanInput;
  /** The plan for the full goal list, or null without goals. */
  plan: RoutePlan | null;
  /** The plan on display: the selected alternative, or `plan`. */
  shown: RoutePlan | null;
  /**
   * True while a newer plan is still being computed off-thread; `plan` is the previous answer.
   *
   * Worth showing. Before the worker the UI simply froze, which at least told the reader that
   * something was happening; now it stays responsive while the route panel shows a route that is
   * one toggle out of date, and that needs saying.
   */
  planPending: boolean;
  variants: RouteVariant[];
  variantIndex: number;
  setVariantIndex: (index: number) => void;
  variant: RouteVariant | undefined;
  /** Goal gifts the planner works for (given-up ones excluded). */
  goals: ReadonlySet<number>;
  /** 조합 계승 children of each gift (`upgradeChildren`), computed once per data set. */
  childrenOf: ReadonlyMap<number, Gift[]>;
  /** Goals that share an ingredient with another goal, and what they share. */
  entangled: ReadonlyMap<number, Entanglement[]>;
  /** Gifts the current goals rule out, and why. */
  blocked: ReadonlyMap<number, Block>;
  /** Make a gift a goal (or drop it), taking its children and recipe tree out of the selection. */
  toggleGoal: (gift: Gift) => void;
  /** The goals and everything a fusion goal consumes on the way: what the route is out to collect. */
  needed: ReadonlySet<number>;
  judgements: Map<number, Judgement | null>;
  giftTitle: (id: number) => string | undefined;
  giftName: (id: number) => string;
  packName: (id: number) => string;
  keywordLabel: (id: Keyword) => string;
  ctx: PackContext;
  exclusivesOf: (packId: number) => number[];
  /** What the run starts with: the observed gifts and the starting gift, collected on leaving floor 1. */
  startGifts: number[];
  stageMode: StageMode;
  /** Enter a pack on the stage floor. */
  enter: (packId: number) => void;
  /** Leave the stage floor: an undecided floor is skipped, an entered pack's unmarked goals are missed. */
  next: () => void;
  /**
   * Show another floor. Looking back changes nothing; walking forward settles every floor left
   * behind, so the floor strip and 「다음 층」 can never disagree about what was missed.
   */
  goTo: (floor: number) => void;
  /**
   * Go back from an entered pack: the entry and every status recorded for that pack's own drops
   * are cleared; when that reopens floor 1, the start-of-run gifts recorded on leaving it go too.
   */
  leave: (packId: number) => void;
  /** Open the gift detail sheet (the same one the items tab uses) from anywhere in the shell. */
  openGift: (giftId: number) => void;
}

export const PlanCtx = createContext<PlanState | null>(null);

export function usePlan(): PlanState {
  const value = useContext(PlanCtx);
  if (!value) throw new Error('usePlan needs a PlanProvider');
  return value;
}
