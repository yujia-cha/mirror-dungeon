/**
 * M165: a stage-floor step (looking at another floor) re-renders only what reads the floor on
 * stage. The plan context used to be one value built from the whole `run`, so `setStageFloor`
 * rebuilt it — judgements, titles, the pack context — and re-rendered every `usePlan` consumer:
 * both panels, the overlay, the screen reader's hooks. Now `usePlan()` is the half the step
 * leaves alone and `usePlanRun()` the half that follows it.
 */
import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { loadGameDataFromDisk } from '../../../core/data/node.ts';
import { analyseDeck, buildIndexes } from '../../../core/index.ts';
import { exclusivesIndex } from '../../lib/stage.ts';
import { PlanProvider } from '../PlanContext.tsx';
import { usePlan, usePlanRun, type PlanBase, type PlanRun } from '../plan-context.ts';
import { appDefaultOptions, emptyRun, useApp } from '../../store.ts';

const data = loadGameDataFromDisk();
const indexes = buildIndexes(data);
const exclusivesOf = exclusivesIndex(data, indexes);

/** A pack with gifts of its own, and one of them as the goal, so the plan has something to route. */
const pack = data.packs.find((p) => exclusivesOf(p.id).length > 0)!;
const gift = exclusivesOf(pack.id)[0]!;
const other = data.packs.find((p) => p.id !== pack.id && exclusivesOf(p.id).length > 0)!;

/** Mounts a consumer of each half and counts their renders. */
function mount(): {
  base: { renders: () => number; latest: () => PlanBase };
  run: { renders: () => number; latest: () => PlanRun };
} {
  let baseRenders = 0;
  let runRenders = 0;
  let base: PlanBase | null = null;
  let run: PlanRun | null = null;
  function BaseProbe() {
    base = usePlan();
    baseRenders += 1;
    return null;
  }
  function RunProbe() {
    run = usePlanRun();
    runRenders += 1;
    return null;
  }
  const { deck, deployed } = useApp.getState();
  render(
    <PlanProvider
      data={data}
      indexes={indexes}
      stats={analyseDeck(deck, indexes, data.rules.deployment, deployed)}
      lang="ko"
    >
      <BaseProbe />
      <RunProbe />
    </PlanProvider>,
  );
  return {
    base: { renders: () => baseRenders, latest: () => base! },
    run: { renders: () => runRenders, latest: () => run! },
  };
}

describe('a stage-floor step re-renders only the run half (M165)', () => {
  beforeEach(() => {
    useApp.setState({
      deck: [10101],
      deployed: [10101],
      wanted: [gift],
      fusionGoal: {},
      // Floor 1 entered and the start closed: the stage stands on floor 2 and may look back at 1
      // without changing the frontier (an entered floor is a record, not a skip).
      run: { ...emptyRun(), startDone: true, visits: { 1: pack.id }, currentFloor: 2, stageFloor: 2 },
      runSnapshot: null,
      options: appDefaultOptions(),
      captureLive: false,
    });
  });

  it('keeps the base value, and every usePlan consumer, as they were', () => {
    // Arrange: both halves settled after the first render (the plan is computed inline in tests).
    const probes = mount();
    const before = probes.base.latest();
    const baseRenders = probes.base.renders();
    const runRenders = probes.run.renders();
    expect(probes.run.latest().stageFloor).toBe(2);
    // Act: look back at floor 1.
    act(() => useApp.getState().setStageFloor(1));
    // Assert: the run half followed, the base half did not even re-render.
    expect(useApp.getState().run.stageFloor).toBe(1);
    expect(probes.run.renders()).toBe(runRenders + 1);
    expect(probes.run.latest().stageFloor).toBe(1);
    expect(probes.run.latest().stageMode).toBe('entered');
    expect(probes.run.latest().ctx.run.enteredHere).toBe(pack.id);
    expect(probes.base.renders()).toBe(baseRenders);
    expect(probes.base.latest()).toBe(before);
  });

  it('hands the run half the base it left alone, so the derived objects keep their identity', () => {
    // Arrange
    const probes = mount();
    const { judgements, giftTitle, needed } = probes.base.latest();
    const ctxBefore = probes.run.latest().ctx;
    // Act
    act(() => useApp.getState().setStageFloor(1));
    // Assert: the pack context is a new object (its run changed) over the same judgements, titles
    // and rings — a memoised child keyed on those does not redraw.
    const ctx = probes.run.latest().ctx;
    expect(ctx).not.toBe(ctxBefore);
    expect(ctx.judgements).toBe(judgements);
    expect(ctx.giftTitle).toBe(giftTitle);
    expect(ctx.needed).toBe(needed);
    expect(ctx.run.stageFloor).toBe(1);
  });

  it('still re-renders both halves when the run itself changes', () => {
    // Arrange
    const probes = mount();
    const baseRenders = probes.base.renders();
    const runRenders = probes.run.renders();
    // Act: a gift marked — the plan's input (`PlannedRun`) changes.
    act(() => useApp.getState().setGiftStatus(gift, 'got'));
    // Assert
    expect(probes.base.renders()).toBeGreaterThan(baseRenders);
    expect(probes.run.renders()).toBeGreaterThan(runRenders);
    expect(probes.run.latest().ctx.run.giftStatus(gift)).toBe('got');
  });

  it('acts on the floor on stage at the press, not the one rendered (M160 rule)', () => {
    // Arrange: `enter` taken from a render with the stage on floor 2.
    const probes = mount();
    const { enter } = probes.base.latest();
    // Act: the stage moves to floor 1 and the stale `enter` is pressed.
    act(() => useApp.getState().setStageFloor(1));
    act(() => enter(other.id));
    // Assert: floor 1's entry is replaced — a read of the rendered floor would have entered floor 2.
    expect(useApp.getState().run.visits).toEqual({ 1: other.id });
  });
});
