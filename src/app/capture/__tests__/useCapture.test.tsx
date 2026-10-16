import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyRun, useApp } from '../../store.ts';
import type { SessionOptions } from '../session.ts';

/** Every session the hook made, with the callbacks it was handed. */
const sessions: { options: SessionOptions; stopped: boolean }[] = [];
vi.mock('../session.ts', () => ({
  captureSupported: () => true,
  CaptureSession: class {
    private readonly entry: { options: SessionOptions; stopped: boolean };
    constructor(options: SessionOptions) {
      this.entry = { options, stopped: false };
      sessions.push(this.entry);
    }
    async start(): Promise<void> {
      this.entry.options.onStatus('starting');
    }
    setInterval(): void {}
    stop(): void {
      this.entry.stopped = true;
      this.entry.options.onStatus('idle');
    }
  },
}));

const plan = {
  data: { packs: [], gifts: [] },
  indexes: { giftById: new Map() },
  enterAt: (floor: number, packId: number) => useApp.getState().visitPack(packId, floor),
  leave: (packId: number) => useApp.getState().unvisitPack(packId),
};
vi.mock('../../shell/plan-context.ts', () => ({ usePlan: () => plan }));

const { useCapture } = await import('../useCapture.ts');

describe('useCapture', () => {
  beforeEach(() => {
    sessions.length = 0;
    useApp.setState({ run: emptyRun() });
  });

  it('ignores what a replaced session still reports', async () => {
    // Arrange: a first session, then a second started over it.
    const { result } = renderHook(() => useCapture());
    await act(() => result.current.start());
    await act(() => result.current.start());
    const [first, second] = sessions;
    act(() => second!.options.onStatus('running'));
    // Act: the first one's share ends late, and a read of it finishes.
    act(() => {
      first!.options.onStatus('error', 'ended');
      first!.options.onEvents([{ kind: 'enter', floor: 1, packId: 1001 }]);
    });
    // Assert
    expect(result.current.status).toBe('running');
    expect(result.current.error).toBeNull();
    expect(result.current.log).toEqual([]);
    expect(useApp.getState().run.visits).toEqual({});
  });

  it('applies nothing a stopped session still hands on', async () => {
    // Arrange
    const { result } = renderHook(() => useCapture());
    await act(() => result.current.start());
    act(() => result.current.stop());
    // Act
    act(() => sessions[0]!.options.onEvents([{ kind: 'got', giftId: 9006 }]));
    // Assert
    expect(useApp.getState().run.giftStatus).toEqual({});
    expect(result.current.status).toBe('idle');
  });

  it('drops the pack question of a floor a clean read then enters', async () => {
    // Arrange: the map header of floor 2 read as two packs at once.
    const { result } = renderHook(() => useCapture());
    await act(() => result.current.start());
    const { onEvents } = sessions[0]!.options;
    act(() => onEvents([{ kind: 'unsure', about: 'enter', floor: 2, ids: [1003, 1004] }]));
    expect(result.current.questions).toHaveLength(1);
    // Act: a later frame of the same map reads clean.
    act(() => onEvents([{ kind: 'enter', floor: 2, packId: 1003 }]));
    // Assert
    expect(result.current.questions).toEqual([]);
  });

  it('keeps a bounded list of questions, newest last', async () => {
    // Arrange
    const { result } = renderHook(() => useCapture());
    await act(() => result.current.start());
    const { onEvents } = sessions[0]!.options;
    // Act: far more muddled popups than anyone answers.
    act(() => {
      for (let i = 0; i < 40; i += 1) onEvents([{ kind: 'unsure', about: 'got', ids: [i, i + 100] }]);
    });
    // Assert
    expect(result.current.questions.length).toBeLessThanOrEqual(10);
    expect(result.current.questions.at(-1)?.ask).toEqual({ kind: 'gift', ids: [39, 139] });
  });

  it('logs a re-read of an entry the run already holds as nothing', async () => {
    // Arrange: the player entered 1001 on floor 1 by hand.
    useApp.getState().visitPack(1001, 1);
    const { result } = renderHook(() => useCapture());
    await act(() => result.current.start());
    // Act: the new session's first map frame.
    act(() => sessions[0]!.options.onEvents([{ kind: 'enter', floor: 1, packId: 1001 }]));
    // Assert
    expect(result.current.log).toEqual([]);
  });
});
