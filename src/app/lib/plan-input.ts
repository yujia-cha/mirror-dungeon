/**
 * What the app hands the planner. Every selected gift is best-effort: the app has no per-gift
 * priority, so `required` — core's 「satisfy this one first」 — is never set from here. Giving a
 * gift up simply removes it from the selection.
 */
import type { PlanInput, PlanOptions, WantedGift } from '../../core/types.ts';

/** Fusion results the user wants only as a whole: their ingredients are not goals of their own. */
export type FusionGoalMap = Record<number, 'resultOnly'>;

export type GiftStatus = 'got' | 'failed';

/** The run being played, as the player reports it. */
export interface RunState {
  /**
   * The planner's frontier: the first floor still to plan = the floor after the last one entered
   * or skipped. 1..16 (16 = the run is over). A floor below it with no visit was skipped.
   */
  currentFloor: number;
  /**
   * The floor shown on the stage, 1..currentFloor: the player can look back at history. It reaches
   * `RUN_DONE_FLOOR` (16) once the run is over — that is the done card's own floor.
   */
  stageFloor: number;
  /** floor -> pack entered there. */
  visits: Record<number, number>;
  giftStatus: Record<number, GiftStatus>;
  /**
   * The gifts recorded as collected when floor 1 was first left: the observed gifts and the
   * starting gift. Taken back again if the run returns to floor 1 (an entry undone, a skip taken
   * back), so a revisited decision never leaves phantom "in hand" gifts behind — unless the start
   * was confirmed (`startDone` with `confirmStart`, M138): then it was set at that moment, says what
   * the game gave, and stays.
   */
  startGifts: number[];
  /**
   * Fusion goals whose remaining ingredients the player chose to keep collecting after the run
   * lost the fusion (「남은 재료 모으기」 in the route tab's notice). Past floor 1 every other
   * fusion goal stops being chased once it is lost — see `plannedGifts`.
   */
  collectRest?: number[];
  /**
   * The run start is behind the player while floor 1 is still ahead (M134): the start gifts and
   * 기프트 관측 are chosen once the observation screen is passed, before floor 1's pack. Set by
   * `markStartDone` (the screen reader, when it sees that screen confirmed or floor 1's pack
   * select) or `confirmStart` (the overlay, M138 — which also records what came in `startGifts`)
   * and kept until the run is thrown away — returning the frontier to floor 1 (an entry
   * undone) does not reopen the start: in the game the boons, start gifts and observations stay
   * spent. Device only, never shared.
   */
  startDone?: boolean;
}

/**
 * Whether the start stage (start gifts, 기프트 관측) can still be changed: the window closes the
 * moment floor 1 is left, since the starlight is spent there — or earlier, once the run records
 * that the observation screen is passed (`startDone`, M134). `runInProgress` is not the test — it
 * turns true as soon as a pack is entered on floor 1, which says nothing about the start.
 */
export function observationClosed(run: Pick<RunState, 'currentFloor' | 'startDone'>): boolean {
  return run.currentFloor > 1 || run.startDone === true;
}

/**
 * The goals as core takes them. `ingredientsAsGoals: false` only changes anything once a fusion is
 * lost — core then stops entering packs for its remaining ingredients — so it is set for every goal
 * once the run is under way: a fusion the run loses is given up whole unless the player asked to
 * keep collecting (`run.collectRest`). Before the run only 「재료는 목표가 아님」 sets it.
 */
export function plannedGifts(
  wanted: number[],
  fusionGoal: FusionGoalMap = {},
  run?: Pick<RunState, 'currentFloor' | 'collectRest'>,
): WantedGift[] {
  const underway = run !== undefined && run.currentFloor > 1;
  const collect = new Set(run?.collectRest ?? []);
  return wanted.map((id) => ({
    giftId: id,
    required: false,
    ...(fusionGoal[id] === 'resultOnly' || (underway && !collect.has(id))
      ? { ingredientsAsGoals: false }
      : {}),
  }));
}

export function planInputFor(
  state: {
    deck: number[];
    deployed: number[];
    wanted: number[];
    options: PlanOptions;
    fusionGoal?: FusionGoalMap;
    run?: RunState;
  },
  /** How far this season's run goes. Without it the saved bound stands, which is the longest run. */
  season: { lastFloor?: number } = {},
): PlanInput {
  const run = state.run;
  // The run records the packs already entered, moves the plan to the frontier floor, and settles
  // the gifts the player has recorded as collected or missed.
  const progress: Partial<PlanOptions> = run
    ? {
        pinnedPacks: { ...run.visits },
        currentFloor: run.currentFloor,
        ownedGifts: Object.entries(run.giftStatus)
          .filter(([, s]) => s === 'got')
          .map(([id]) => Number(id)),
        unobtainableGifts: Object.entries(run.giftStatus)
          .filter(([, s]) => s === 'failed')
          .map(([id]) => Number(id)),
        ...(run.startDone ? { startDecided: true } : {}),
      }
    : { currentFloor: 1, ownedGifts: [], unobtainableGifts: [] };
  return {
    deck: state.deck,
    wanted: plannedGifts(state.wanted, state.fusionGoal ?? {}, run),
    options: {
      ...state.options,
      ...progress,
      ...(season.lastFloor === undefined ? {} : { lastFloor: season.lastFloor }),
      deployed: state.deployed,
    },
  };
}
