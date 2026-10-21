/**
 * M160: the run actions the plan context hands out read the run from the store the moment they
 * run, not from the render that made them — the screen reader applies a read's events one after
 * another inside one render.
 */
import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { loadGameDataFromDisk } from '../../../core/data/node.ts';
import { analyseDeck, buildIndexes } from '../../../core/index.ts';
import { exclusivesIndex } from '../../lib/stage.ts';
import { PlanProvider } from '../PlanContext.tsx';
import { usePlan, type PlanBase } from '../plan-context.ts';
import { appDefaultOptions, emptyRun, useApp } from '../../store.ts';

const data = loadGameDataFromDisk();
const indexes = buildIndexes(data);
const exclusivesOf = exclusivesIndex(data, indexes);

/** A pack with gifts of its own, and one of them: entering the pack makes the route expect it. */
const pack = data.packs.find((p) => exclusivesOf(p.id).length > 0)!;
const gift = exclusivesOf(pack.id)[0]!;
const other = data.packs.find((p) => p.id !== pack.id && exclusivesOf(p.id).length > 0)!;

function mount(): { plan: () => PlanBase } {
  let latest: PlanBase | null = null;
  function Probe() {
    latest = usePlan();
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
      <Probe />
    </PlanProvider>,
  );
  return { plan: () => latest! };
}

describe('run actions read the store (M160)', () => {
  beforeEach(() => {
    useApp.setState({
      deck: [10101],
      deployed: [10101],
      wanted: [gift],
      fusionGoal: {},
      // The start is closed: leaving floor 1 then records nothing of the plan's guess at it.
      run: { ...emptyRun(), startDone: true },
      runSnapshot: null,
      options: appDefaultOptions(),
      captureLive: false,
    });
  });

  it('settles an entry made a moment earlier in the same render when a later floor is entered', () => {
    // Arrange: the context's actions from one render.
    const { plan } = mount();
    const { enterAt } = plan();
    // Act: one read's events — floor 2 entered, then floor 4 — applied back to back.
    act(() => {
      enterAt(2, pack.id);
      enterAt(4, other.id);
    });
    // Assert: floor 2's pack was walked past, so the gift it owed is recorded as missed — which
    // the second call could only know by reading the run the first one changed.
    const { run } = useApp.getState();
    expect(run.visits).toEqual({ 2: pack.id, 4: other.id });
    expect(run.giftStatus[gift]).toBe('failed');
    expect(run.stageFloor).toBe(4);
  });

  it('clears what an entry answered for on leave, as the run stands now', () => {
    // Arrange: actions from a render before any entry.
    const { plan } = mount();
    const { enterAt, leave } = plan();
    // Act: enter, mark the gift by hand, then take the entry back — all on the stale actions.
    act(() => {
      enterAt(2, pack.id);
      useApp.getState().setGiftStatus(gift, 'got');
      leave(pack.id);
    });
    // Assert: the entry and its gift's mark are gone.
    const { run } = useApp.getState();
    expect(run.visits).toEqual({});
    expect(run.giftStatus[gift]).toBeUndefined();
  });
});
