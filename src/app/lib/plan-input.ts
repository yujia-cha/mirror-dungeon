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
   * back), so a revisited decision never leaves phantom "in hand" gifts behind.
   */
  startGifts: number[];
}

export function plannedGifts(wanted: number[], fusionGoal: FusionGoalMap = {}): WantedGift[] {
  return wanted.map((id) => ({
    giftId: id,
    required: false,
    ...(fusionGoal[id] === 'resultOnly' ? { ingredientsAsGoals: false } : {}),
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
  // The run pins the packs already entered, moves the plan to the frontier floor, and settles
  // the gifts the player has recorded as collected or missed.
  const progress: Partial<PlanOptions> = run
    ? {
        pinnedPacks: { ...state.options.pinnedPacks, ...run.visits },
        currentFloor: run.currentFloor,
        ownedGifts: Object.entries(run.giftStatus).filter(([, s]) => s === 'got').map(([id]) => Number(id)),
        unobtainableGifts: Object.entries(run.giftStatus).filter(([, s]) => s === 'failed').map(([id]) => Number(id)),
      }
    : { currentFloor: 1, ownedGifts: [], unobtainableGifts: [] };
  return {
    deck: state.deck,
    wanted: plannedGifts(state.wanted, state.fusionGoal ?? {}),
    options: {
      ...state.options,
      ...progress,
      ...(season.lastFloor === undefined ? {} : { lastFloor: season.lastFloor }),
      deployed: state.deployed,
    },
  };
}
