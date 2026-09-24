/**
 * How the hook behaves with a worker, without one, and with one that breaks.
 *
 * The third case is the one worth the effort. `new Worker` does not throw when its script 404s or
 * fails to parse — the failure arrives as an `error` event, later — so a worker the browser can
 * construct but not run would otherwise leave the route panel waiting forever with no route at all.
 * A deployment-path bug that shows up as "the app does nothing" is the worst kind, and it is
 * exactly the shape `src/core/data/load.ts` had before M48 gave it tests.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { RoutePlan } from '../../../core/types.ts';
import { loadGameDataFromDisk } from '../../../core/data/node.ts';
import { buildIndexes, defaultOptions } from '../../../core/index.ts';
import { defaultDeck } from '../default-deck.ts';
import { createPlanner, type PlannerRequest, type PlannerResponse } from '../planner-protocol.ts';
import { resetPlannerWorker, usePlanner } from '../use-planner.ts';

const data = loadGameDataFromDisk();
const indexes = buildIndexes(data);
const deck = defaultDeck(data);
const lastFloor = Math.max(...Object.values(data.rules.floors).flat());
const wantedIds = data.gifts
  .filter((gift) => gift.acquisition.kind === 'packLimited')
  .map((gift) => gift.id)
  .sort((a, b) => a - b)
  .slice(0, 4);

const input = {
  deck,
  wanted: wantedIds.map((giftId) => ({ giftId, required: false })),
  options: { ...defaultOptions(), lastFloor, deployed: deck.slice(0, 6) },
};

/**
 * A worker that answers for real, on a microtask.
 *
 * It runs the same `createPlanner` the worker file wraps, so this is the real protocol rather than a
 * canned reply; `mode` decides whether it answers, reports an error, or stays silent.
 */
class FakeWorker implements Partial<Worker> {
  readonly posted: PlannerRequest[] = [];
  terminated = false;
  private readonly listeners = new Map<string, Set<(event: unknown) => void>>();
  private readonly planner = createPlanner();

  /** Alternatives held back until `release()`, to look at the moment between the two answers. */
  private held: (() => void)[] = [];

  constructor(
    private readonly mode: 'answers' | 'errors' | 'silent' = 'answers',
    private readonly holdAlternatives = false,
  ) {}

  release(): void {
    const held = this.held;
    this.held = [];
    for (const send of held) send();
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.set(type, (this.listeners.get(type) ?? new Set()).add(listener));
  }
  removeEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.get(type)?.delete(listener);
  }
  terminate(): void {
    this.terminated = true;
  }
  postMessage(request: PlannerRequest): void {
    this.posted.push(request);
    if (this.mode === 'silent') return;
    if (this.mode === 'errors') {
      queueMicrotask(() => this.emit('error', new Event('error')));
      return;
    }
    const response = this.planner.handle(request);
    if (!response) return;
    queueMicrotask(() => this.emit('message', { data: response satisfies PlannerResponse }));
    // As `planner.worker.ts` does: the alternatives follow on a later task, and only if still wanted.
    if (response.type === 'plan' && response.variantsPending) {
      const send = (): void => {
        const variants = this.planner.alternatives(response.id);
        if (variants) this.emit('message', { data: variants satisfies PlannerResponse });
      };
      if (this.holdAlternatives) this.held.push(send);
      else setTimeout(send, 0);
    }
  }
  private emit(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

function stubWorker(factory: () => FakeWorker): { latest: () => FakeWorker | null } {
  let latest: FakeWorker | null = null;
  vi.stubGlobal(
    'Worker',
    class {
      constructor() {
        latest = factory();
        return latest as unknown as Worker;
      }
    },
  );
  return { latest: () => latest };
}

afterEach(() => {
  cleanup();
  // The worker is cached for the page, so each test has to forget it before restoring the global.
  resetPlannerWorker();
  vi.unstubAllGlobals();
});

describe('without a worker', () => {
  it('answers on the first render, synchronously', () => {
    // jsdom has no `Worker`, which is also every test that renders the shell.
    const { result } = renderHook(() => usePlanner(data, indexes, input));
    expect(result.current.offThread).toBe(false);
    expect(result.current.pending).toBe(false);
    expect(result.current.plan).not.toBeNull();
    expect(result.current.plan!.stats.totalWanted).toBe(wantedIds.length);
  });
});

describe('with a worker', () => {
  it('sends the season once, then the plan request, and shows the answer', async () => {
    const { latest } = stubWorker(() => new FakeWorker('answers'));
    const { result } = renderHook(() => usePlanner(data, indexes, input));

    expect(result.current.offThread).toBe(true);
    // Nothing to show yet, and it says so rather than looking like "no goals".
    expect(result.current.pending).toBe(true);

    await waitFor(() => expect(result.current.plan).not.toBeNull());
    expect(result.current.pending).toBe(false);
    expect(result.current.plan!.stats.totalWanted).toBe(wantedIds.length);

    const posted = latest()!.posted;
    expect(posted[0]).toMatchObject({ type: 'init' });
    expect(posted[1]).toMatchObject({ type: 'plan', id: 1 });
  });

  it('matches what the inline path computes', async () => {
    stubWorker(() => new FakeWorker('answers'));
    const viaWorker = renderHook(() => usePlanner(data, indexes, input));
    await waitFor(() => expect(viaWorker.result.current.plan).not.toBeNull());

    cleanup();
    resetPlannerWorker();
    vi.unstubAllGlobals();
    const inline = renderHook(() => usePlanner(data, indexes, input));

    // `stats.elapsedMs` is a measurement, so it differs by a millisecond between two runs.
    const strip = (plan: RoutePlan | null): unknown =>
      plan && { ...plan, stats: { ...plan.stats, elapsedMs: 0 } };
    expect(strip(viaWorker.result.current.plan)).toEqual(strip(inline.result.current.plan));
    expect(viaWorker.result.current.variants.map((v) => v.dropped)).toEqual(
      inline.result.current.variants.map((v) => v.dropped),
    );
  });

  it('keeps the previous answer on show while a newer one is computed', async () => {
    stubWorker(() => new FakeWorker('answers'));
    const { result, rerender } = renderHook(({ value }) => usePlanner(data, indexes, value), {
      initialProps: { value: input },
    });
    await waitFor(() => expect(result.current.plan).not.toBeNull());
    const first = result.current.plan;

    // A new input object with the same meaning still counts as a new question.
    rerender({ value: { ...input } });
    expect(result.current.pending).toBe(true);
    expect(result.current.plan).toBe(first);

    await waitFor(() => expect(result.current.pending).toBe(false));
  });

  it('builds one worker for the page, not one per mount', () => {
    // Page-scoped on purpose: StrictMode renders twice, and a per-mount worker would leak one.
    const built: FakeWorker[] = [];
    stubWorker(() => {
      const worker = new FakeWorker('answers');
      built.push(worker);
      return worker;
    });
    const first = renderHook(() => usePlanner(data, indexes, input));
    first.unmount();
    renderHook(() => usePlanner(data, indexes, input));
    expect(built).toHaveLength(1);
  });
});

describe('alternatives arrive after the route (M52)', () => {
  const conflictInput = {
    ...input,
    wanted: [9250, 9251, 9252, 9253, 9254, 9255].map((giftId) => ({ giftId, required: false })),
  };

  it('shows the route as soon as it is ready, then the alternatives', async () => {
    const { latest } = stubWorker(() => new FakeWorker('answers', true));
    const { result } = renderHook(() => usePlanner(data, indexes, conflictInput));

    await waitFor(() => expect(result.current.plan).not.toBeNull());
    // The route is done: the panel must not keep saying 「갱신 중…」 for the alternatives.
    expect(result.current.pending).toBe(false);
    expect(result.current.variantsPending).toBe(true);
    expect(result.current.variants).toEqual([]);

    act(() => latest()!.release());
    await waitFor(() => expect(result.current.variants.length).toBeGreaterThan(0));
    expect(result.current.variantsPending).toBe(false);
  });

  it('does not show one plan\'s alternatives beside the next plan', async () => {
    const { latest } = stubWorker(() => new FakeWorker('answers', true));
    const { result, rerender } = renderHook(({ value }) => usePlanner(data, indexes, value), {
      initialProps: { value: conflictInput },
    });
    await waitFor(() => expect(result.current.plan).not.toBeNull());
    act(() => latest()!.release());
    await waitFor(() => expect(result.current.variants.length).toBeGreaterThan(0));

    rerender({ value: { ...conflictInput } });
    await waitFor(() => expect(result.current.pending).toBe(false));
    expect(result.current.variants).toEqual([]);
    expect(result.current.variantsPending).toBe(true);
  });
});

describe('when the worker breaks', () => {
  it('falls back to computing inline instead of waiting forever', async () => {
    // What a 404'd or unparseable worker script looks like from here.
    stubWorker(() => new FakeWorker('errors'));
    const { result } = renderHook(() => usePlanner(data, indexes, input));

    await waitFor(() => expect(result.current.offThread).toBe(false));
    expect(result.current.pending).toBe(false);
    expect(result.current.plan).not.toBeNull();
    expect(result.current.plan!.stats.totalWanted).toBe(wantedIds.length);
  });

  it('a silent worker leaves the panel pending, which is why the error listener matters', async () => {
    // Pinned as the counter-example: without the `error` handling above, *this* is what a broken
    // worker would look like — no route, no explanation, no recovery.
    stubWorker(() => new FakeWorker('silent'));
    const { result } = renderHook(() => usePlanner(data, indexes, input));
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.offThread).toBe(true);
    expect(result.current.pending).toBe(true);
    expect(result.current.plan).toBeNull();
  });
});
