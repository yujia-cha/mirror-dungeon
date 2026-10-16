/**
 * When the owner's diagnostics write route feedback (M116): which floors a run change left
 * behind, whether it ended the run, and whether it threw the run away.
 *
 * - **A floor is left when the stage moves past it**, not when its pack is entered. Entering sets
 *   the frontier to the next floor at once, while the player is still on that floor collecting
 *   its gifts — a record written then said every expected gift was still unmarked. The floors
 *   below both the stage and the frontier are left; walking forward several floors leaves each.
 * - **Once per run**: the highest floor written is remembered, so stepping back to look and
 *   forward again writes nothing new. A memory that starts mid-run (a reload, recording turned
 *   on) starts from what the run had already left.
 * - **Done** is the last floor being left, once per run.
 * - **Reset** is a run with progress coming back pristine — what `resetRun`, `resetAll`, a season
 *   change and an opened share link do. The store does not say which action ran, and taking back
 *   the run's first decision (undoing the only floor-1 entry, stepping back onto a floor-1 skip)
 *   also ends pristine; those start from the frontier at floor 2 with nothing decided past floor
 *   1, so a run there is not called reset. The price: throwing away a run that never got past its
 *   first decision writes no reset record — it has nothing to say yet. A run already done writes
 *   none either. Either way a pristine run starts the memory afresh.
 *
 * Pure: two run states and the memory in, what to write and the new memory out.
 */
import type { RunState } from '../../lib/plan-input.ts';

export interface RunMemory {
  /** Every floor up to this one was left and written this run; null before the first change seen. */
  through: number | null;
  done: boolean;
}

export const FRESH_RUN: RunMemory = { through: null, done: false };

/** The state a new run starts in. */
function pristine(run: RunState): boolean {
  return (
    run.currentFloor === 1 &&
    run.stageFloor === 1 &&
    Object.keys(run.visits).length === 0 &&
    Object.keys(run.giftStatus).length === 0 &&
    run.startGifts.length === 0
  );
}

/** Whether going back to pristine from `run` can only be a reset, not a decision taken back. */
function pastFirstDecision(run: RunState): boolean {
  return run.currentFloor > 2 || Object.keys(run.visits).some((floor) => Number(floor) > 1);
}

/** The floors at and below which a run has left everything: under the stage and the frontier. */
function leftThrough(run: RunState): number {
  return Math.min(run.stageFloor, run.currentFloor) - 1;
}

export function runStep(
  prev: RunState,
  next: RunState,
  lastFloor: number,
  memory: RunMemory,
): { floors: number[]; done: boolean; reset: boolean; memory: RunMemory } {
  if (pristine(next)) {
    const finished = memory.done || leftThrough(prev) >= lastFloor;
    const reset = !pristine(prev) && pastFirstDecision(prev) && !finished;
    return { floors: [], done: false, reset, memory: FRESH_RUN };
  }
  const from = memory.through ?? leftThrough(prev);
  const through = Math.min(lastFloor, leftThrough(next));
  const floors: number[] = [];
  for (let floor = from + 1; floor <= through; floor += 1) floors.push(floor);
  const done = !memory.done && floors.includes(lastFloor);
  return {
    floors,
    done,
    reset: false,
    memory: { through: Math.max(from, through), done: memory.done || done },
  };
}
