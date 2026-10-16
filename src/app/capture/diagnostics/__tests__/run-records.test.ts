import { describe, expect, it } from 'vitest';
import type { RunState } from '../../../lib/plan-input.ts';
import { emptyRun } from '../../../store.ts';
import { FRESH_RUN, runStep, type RunMemory } from '../run-records.ts';

const LAST = 5;
const run = (over: Partial<RunState>): RunState => ({ ...emptyRun(), ...over });

/** Walk a run through states, as the store listener sees them, and collect what it records. */
function walk(...states: RunState[]) {
  let memory: RunMemory = FRESH_RUN;
  const floors: number[] = [];
  const runs: string[] = [];
  for (let i = 1; i < states.length; i += 1) {
    const step = runStep(states[i - 1]!, states[i]!, LAST, memory);
    memory = step.memory;
    floors.push(...step.floors);
    if (step.done) runs.push('done');
    if (step.reset) runs.push('reset');
  }
  return { floors, runs, memory };
}

describe('runStep', () => {
  it('records a floor when the stage leaves it, not when its pack is entered', () => {
    // Arrange: enter 1001 on floor 1 (the frontier jumps to 2 at once), then 「다음 층」.
    const start = emptyRun();
    const entered = run({ currentFloor: 2, stageFloor: 1, visits: { 1: 1001 } });
    const next = run({ currentFloor: 2, stageFloor: 2, visits: { 1: 1001 } });
    // Act
    const onEntry = walk(start, entered);
    const onLeave = walk(start, entered, next);
    // Assert
    expect(onEntry.floors).toEqual([]);
    expect(onLeave.floors).toEqual([1]);
  });

  it('records each floor walked past at once', () => {
    const at2 = run({ currentFloor: 2, stageFloor: 2, visits: { 1: 1001 } });
    const at4 = run({ currentFloor: 5, stageFloor: 4, visits: { 1: 1001, 4: 1004 } });
    expect(walk(at2, at4).floors).toEqual([2, 3]);
  });

  it('records a floor once, however often the stage goes back and forth over it', () => {
    // Arrange
    const at3 = run({ currentFloor: 3, stageFloor: 3, visits: { 1: 1001, 2: 1002 } });
    const back = { ...at3, stageFloor: 1 };
    // Act
    const { floors } = walk(run({ currentFloor: 3, stageFloor: 2, visits: at3.visits }), at3, back, at3);
    // Assert
    expect(floors).toEqual([2]);
  });

  it('says the run is done only when the last floor is left, once', () => {
    // Arrange: the last floor entered, then left, then looked back at and left again.
    const before = run({ currentFloor: LAST, stageFloor: LAST });
    const entered = run({ currentFloor: LAST + 1, stageFloor: LAST, visits: { [LAST]: 1009 } });
    const left = { ...entered, stageFloor: LAST + 1 };
    const back = { ...entered, stageFloor: 2 };
    // Act
    const onEntry = walk(before, entered);
    const all = walk(before, entered, left, back, left);
    // Assert
    expect(onEntry.runs).toEqual([]);
    expect(all.runs).toEqual(['done']);
    expect(all.floors).toEqual([LAST]);
  });

  it('calls a run thrown away for a new one a reset', () => {
    const deep = run({
      currentFloor: 4,
      stageFloor: 4,
      visits: { 1: 1001, 3: 1003 },
      giftStatus: { 7: 'got' },
    });
    expect(walk(deep, emptyRun()).runs).toEqual(['reset']);
  });

  it('does not call undoing the only floor-1 entry, or stepping back onto a floor-1 skip, a reset', () => {
    // Arrange
    const entered = run({
      currentFloor: 2,
      stageFloor: 2,
      visits: { 1: 1001 },
      startGifts: [7],
      giftStatus: { 7: 'got' },
    });
    const skipped = run({ currentFloor: 2, stageFloor: 2, startGifts: [7], giftStatus: { 7: 'got' } });
    // Act
    const undone = walk(entered, emptyRun());
    const steppedBack = walk(skipped, emptyRun());
    // Assert
    expect(undone.runs).toEqual([]);
    expect(steppedBack.runs).toEqual([]);
  });

  it('writes no reset for a run already done, and starts the next run afresh', () => {
    // Arrange
    const before = run({ currentFloor: LAST + 1, stageFloor: LAST, visits: { 1: 1001, [LAST]: 1009 } });
    const left = { ...before, stageFloor: LAST + 1 };
    // Act
    const { runs, memory } = walk(before, left, emptyRun());
    // Assert
    expect(runs).toEqual(['done']);
    expect(memory).toEqual(FRESH_RUN);
  });
});
