/**
 * The plan context's types, the context objects and their hooks.
 *
 * Split out of `PlanContext.tsx` so that file exports only the component: Vite's fast refresh gives
 * up on a module that mixes components with other exports, which turned every edit to the provider
 * into a full reload. `react-refresh/only-export-components` was the last warning `npm run check`
 * had left.
 *
 * Two contexts since M165. `usePlan()` is everything a stage-floor step does not change — the
 * plan, the judgements, the names, the selection and the run actions (which read the store when
 * they run, M160). `usePlanRun()` is what does change with it: the floor on stage, its mode and
 * the pack context with the run attached. One context held both before, so looking at another
 * floor rebuilt the whole value and re-rendered every consumer — both panels, the overlay, the
 * screen reader's hooks — for a number only the stage reads.
 */
import { createContext, useContext } from 'react';
import type { Gift, GameData } from '../../core/schema.ts';
import type { DeckStats, GameIndexes, PlanInput, RoutePlan } from '../../core/types.ts';
import type {
  ConflictGroup,
  DropAnalysis,
  ResolutionAnalysis,
  RouteVariant,
  SkillGiftLookup,
} from '../../core/index.ts';
import type { ConditionReport } from '../../core/types.ts';
import type { Lang } from '../i18n.ts';
import type { Judgement } from '../lib/judgement.ts';
import type { Block, Entanglement } from '../lib/entangle.ts';
import type { StageMode } from '../lib/stage.ts';
import type { PackContext, RunContext } from '../components/PackSheet.tsx';

export interface DropSelection {
  /** Checked goal ids, in the order they were checked. */
  selection: number[];
  /**
   * The player's observation pins a picked way releases (M144): previewed with the checks and
   * released when they are confirmed. Only a way sets them; checking a bar leaves them.
   */
  released: number[];
  toggle: (giftId: number) => void;
  set: (ids: number[]) => void;
  /** Pick a way from the list: exactly its removals checked and its releases released. */
  pick: (removals: number[], releases: number[]) => void;
  /** Uncheck everything, release nothing and end the preview. */
  clear: () => void;
  /**
   * The route without the checked goals and with the released pins let go; null when nothing is
   * chosen or it is being computed.
   */
  plan: RoutePlan | null;
  pending: boolean;
  /** Conflicting goals left in `plan` (ingredients counted as their goal), or null. */
  conflicts: number | null;
  /** Whether the map and the stage show `plan` instead of the full one. */
  previewing: boolean;
  setPreviewing: (on: boolean) => void;
}

/** What a stage-floor step leaves alone; see the module comment. */
export interface PlanBase {
  data: GameData;
  indexes: GameIndexes;
  stats: DeckStats;
  lang: Lang;
  /** Who meets which gift effect, from the season's built index (M129); undefined = compute it. */
  skillLookup: SkillGiftLookup | undefined;
  /** Every conditioned gift's reports for this deck (`conditionReportsByGift`), built once. */
  conditionByGift: ReadonlyMap<number, ConditionReport[]>;
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
  /** What leaving each candidate goal out does to the conflict (`planDropEffects`), or null. */
  analysis: DropAnalysis | null;
  /** The ways to resolve the conflict — releases and fewest removals (M144), or null. */
  resolutions: ResolutionAnalysis | null;
  /**
   * True while the route on show is still waiting for its drop analysis (it follows the route). The
   * decision card draws placeholder bars so they do not pop in.
   */
  analysisPending: boolean;
  /** Measure the candidates the analysis left out — the card's 「더 계산」 (M115). */
  analyzeMore: () => void;
  /**
   * The full plan's conflict, or null without a plan: the goals it loses (`conflictRootsOf`, a
   * starved shared ingredient's fusion among them) and the contested floors (`conflictGroups`).
   */
  conflict: { goals: number[]; groups: ConflictGroup[] } | null;
  /** The goals the decision card has checked to leave out, and the route without them. */
  drops: DropSelection;
  /** The checked set's route while it is previewed on the map; `shown` is its plan. */
  variant: (RouteVariant & { released: number[] }) | undefined;
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
  /**
   * The pack context without the run: names, judgements, rings, the observation and goal toggles.
   * Enough for the route panel, the map and the decision card. A surface that offers entering or
   * reads what was entered takes `usePlanRun().ctx`, which carries the run.
   */
  ctx: Omit<PackContext, 'run'>;
  exclusivesOf: (packId: number) => number[];
  /**
   * What the route expects a pack entered on `floor` to hand over: the plan's pickups there
   * (ingredients and pool pickups included) plus the pack's exclusives the route collects. Leaving
   * the floor fails whatever of this the player never marked.
   */
  expectedIn: (floor: number, packId: number) => number[];
  /**
   * The gifts a recorded entry answers for — `expectedIn` on its floor, the pack's exclusives and a
   * pool pickup already missed here: what the entered pack tiles, and what `leave` clears.
   */
  entryGiftsOf: (packId: number) => number[];
  /** What the run starts with: the observed gifts and the starting gift, collected on leaving floor 1. */
  startGifts: number[];
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
   * Go back from an entered pack: the entry and every status recorded for what it answered for
   * (`entryGiftsOf`) are cleared; when that reopens floor 1, the start-of-run gifts recorded on
   * leaving it go too.
   */
  leave: (packId: number) => void;
  /**
   * Record an entry the screen reader saw (M107): walk to `floor` the way the floor strip does —
   * every floor left behind settles — then enter `packId` there. The stage follows.
   */
  enterAt: (floor: number, packId: number) => void;
  /**
   * Record what the run start handed over (M138, the overlay): `got` in hand, `dropped` not, the
   * `observed` ones pinned, then the start settled (M140 — a pin on a gift not in hand comes off).
   */
  confirmStart: (picks: { got: number[]; dropped: number[]; observed: number[] }) => void;
  /** Reopen a closed start while floor 1 is still ahead; the statuses stay, its record goes. */
  reopenStart: () => void;
  /** Open the gift detail sheet (the same one the items tab uses) from anywhere in the shell. */
  openGift: (giftId: number) => void;
  /** Open a pack's details in the same sheet (M120). */
  openPack: (packId: number) => void;
}

/** What follows the floor on stage (M165). */
export interface PlanRun {
  /** The floor on stage (`run.stageFloor`). */
  stageFloor: number;
  stageMode: StageMode;
  /** The pack context with the run attached: the stage and the pack sheet read it. */
  ctx: PackContext & { run: RunContext };
}

/** Both halves — the shape one context used to hold. */
export type PlanState = PlanBase & PlanRun;

export const PlanCtx = createContext<PlanBase | null>(null);
export const PlanRunCtx = createContext<PlanRun | null>(null);

export function usePlan(): PlanBase {
  const value = useContext(PlanCtx);
  if (!value) throw new Error('usePlan needs a PlanProvider');
  return value;
}

/** The stage-floor half: only a surface that shows or acts on the floor on stage reads it. */
export function usePlanRun(): PlanRun {
  const value = useContext(PlanRunCtx);
  if (!value) throw new Error('usePlanRun needs a PlanProvider');
  return value;
}
