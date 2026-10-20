import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyRun, useApp } from '../../store.ts';
import { feedbackLog } from '../../lib/feedback-log.ts';
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
    useApp.setState({ run: emptyRun(), runSnapshot: null });
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

  it('starts a new run over the old one: snapshot, run reset, log cleared, marker heard (M143)', async () => {
    // Arrange: a run on floor 3 and a log entry from a session on it.
    useApp.getState().visitPack(1001, 1);
    useApp.getState().visitPack(1003, 2);
    const onRunMark = vi.fn();
    const { result } = renderHook(() => useCapture({ onRunMark }));
    await act(() => result.current.start());
    act(() => sessions[0]!.options.onEvents([{ kind: 'got', giftId: 9006 }]));
    expect(result.current.log).toHaveLength(1);
    // Act
    await act(() => result.current.begin('new'));
    // Assert: the share was asked for, on a fresh run with the old one kept to go back to.
    expect(sessions).toHaveLength(2);
    expect(useApp.getState().run).toEqual(emptyRun());
    expect(useApp.getState().runSnapshot?.run.visits).toEqual({ 1: 1001, 2: 1003 });
    expect(result.current.log).toEqual([]);
    expect(onRunMark).toHaveBeenCalledWith({
      mark: 'new',
      hadProgress: true,
      run: { currentFloor: 3, visits: 2, got: 1, failed: 0, startDone: false },
    });
    expect(feedbackLog.entries().at(-1)).toMatchObject({ kind: 'action', text: 'capture run new' });
  });

  it('continues on the run as it is (M143)', async () => {
    // Arrange
    useApp.getState().visitPack(1001, 1);
    const onRunMark = vi.fn();
    const { result } = renderHook(() => useCapture({ onRunMark }));
    // Act
    await act(() => result.current.begin('continue'));
    // Assert
    expect(useApp.getState().run.visits).toEqual({ 1: 1001 });
    expect(useApp.getState().runSnapshot).toBeNull();
    expect(onRunMark.mock.calls[0]![0]).toMatchObject({ mark: 'continue', hadProgress: true });
  });

  it('stops reading and puts the run back on rollback (M143)', async () => {
    // Arrange: a new run started over one entry, then the reader recorded on it.
    useApp.getState().visitPack(1001, 1);
    const onRunMark = vi.fn();
    const { result } = renderHook(() => useCapture({ onRunMark }));
    await act(() => result.current.begin('new'));
    act(() => sessions[0]!.options.onStatus('running'));
    act(() => sessions[0]!.options.onEvents([{ kind: 'got', giftId: 9006 }]));
    // Act
    act(() => result.current.rollback());
    // Assert
    expect(sessions[0]!.stopped).toBe(true);
    expect(result.current.status).toBe('idle');
    expect(useApp.getState().run.visits).toEqual({ 1: 1001 });
    expect(useApp.getState().run.giftStatus).toEqual({});
    expect(useApp.getState().runSnapshot).toBeNull();
    expect(result.current.log).toEqual([]);
    expect(onRunMark.mock.calls.at(-1)![0]).toMatchObject({ mark: 'rollback', run: { got: 1 } });
  });

  it('takes a run without a snapshot back to its beginning on rollback (M158)', async () => {
    // Arrange
    useApp.getState().visitPack(1001, 1);
    const onRunMark = vi.fn();
    const { result } = renderHook(() => useCapture({ onRunMark }));
    // Act
    act(() => result.current.rollback());
    // Assert
    expect(useApp.getState().run.visits).toEqual({});
    expect(onRunMark.mock.calls.at(-1)![0]).toMatchObject({ mark: 'rollback', hadProgress: true });
  });

  it('forgets the log and the questions when the run is thrown away elsewhere (M160)', async () => {
    // Arrange: a session recorded a gift and left a question on the run.
    const { result } = renderHook(() => useCapture());
    await act(() => result.current.start());
    act(() => {
      sessions[0]!.options.onEvents([{ kind: 'got', giftId: 9006 }]);
      sessions[0]!.options.onEvents([{ kind: 'unsure', about: 'got', ids: [1, 2] }]);
    });
    expect(result.current.log).toHaveLength(1);
    expect(result.current.questions).toHaveLength(1);
    // Act: 「같은 목표로 새 런」 on the stage.
    act(() => useApp.getState().resetRun());
    // Assert: an undo of the old run cannot reach the new one.
    expect(result.current.log).toEqual([]);
    expect(result.current.questions).toEqual([]);
  });

  it('forgets the log when a share link replaces the run (M160)', async () => {
    // Arrange
    const { result } = renderHook(() => useCapture());
    await act(() => result.current.start());
    act(() => sessions[0]!.options.onEvents([{ kind: 'got', giftId: 9006 }]));
    expect(result.current.log).toHaveLength(1);
    // Act
    act(() =>
      useApp
        .getState()
        .applyShared({ deck: [10101], deployed: [], wanted: [], options: useApp.getState().options }),
    );
    // Assert
    expect(result.current.log).toEqual([]);
  });

  it('keeps the log when its own undo is what empties the run (M160)', async () => {
    // Arrange: the one entry of the run is the reader's.
    const { result } = renderHook(() => useCapture());
    await act(() => result.current.start());
    act(() => sessions[0]!.options.onEvents([{ kind: 'got', giftId: 9006 }]));
    const entry = result.current.log[0]!;
    // Act
    act(() => result.current.undo(entry.id));
    // Assert: the run is empty again, and the entry stays, marked undone.
    expect(useApp.getState().run.giftStatus).toEqual({});
    expect(result.current.log).toEqual([{ ...entry, undone: true }]);
  });

  it('does nothing on rollback with no snapshot and no progress but stop (M143)', async () => {
    // Arrange
    const onRunMark = vi.fn();
    const { result } = renderHook(() => useCapture({ onRunMark }));
    // Act
    act(() => result.current.rollback());
    // Assert
    expect(onRunMark).not.toHaveBeenCalled();
  });
});
