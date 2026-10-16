/**
 * The visitor's diagnostics wired into the shell (M127): floors left, and the screen reader's
 * reads, applies, undos, answers and session changes, written to `visitorDiagnostics` while the
 * visitor has it on. Errors and store changes reach it from `feedbackLog` (`install.ts`).
 *
 * Mounted by `CaptureProvider` next to the owner's `useDiagnostics`, whose hooks it is merged with
 * (`mergeCaptureHooks`). The two never share state: the owner's recorder keeps frames and OCR
 * passes in IndexedDB; this one keeps a few text lines in `localStorage` and never takes a frame —
 * its `onRead` reads the report and leaves the frame to the owner's hook (which closes it).
 */
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { CaptureHooks } from '../capture/useCapture.ts';
import { FRESH_RUN, runStep, type RunMemory } from '../capture/diagnostics/run-records.ts';
import { usePlan } from '../shell/plan-context.ts';
import { useApp } from '../store.ts';
import { eventText, visitorDiagnostics, type VisitorDiagnostics } from './visitor-diagnostics.ts';

/** The record's on/off and size, for the feedback form. */
export function useVisitorDiagSnapshot(diag: VisitorDiagnostics = visitorDiagnostics) {
  return useSyncExternalStore(
    (fn) => diag.subscribe(fn),
    () => diag.snapshot(),
    () => diag.snapshot(),
  );
}

/** Both sets of hooks, each called in turn. The owner's `onRead` goes last: it owns the frame. */
export function mergeCaptureHooks(first: CaptureHooks, owner: CaptureHooks): CaptureHooks {
  return {
    onRead: (report, frame) => {
      first.onRead?.(report, null);
      if (owner.onRead) owner.onRead(report, frame);
      else frame?.close();
    },
    wantImage: () => owner.wantImage?.() ?? false,
    onApplied: (...args) => {
      first.onApplied?.(...args);
      owner.onApplied?.(...args);
    },
    onUndo: (logId) => {
      first.onUndo?.(logId);
      owner.onUndo?.(logId);
    },
    onAnswer: (ask, picked) => {
      first.onAnswer?.(ask, picked);
      owner.onAnswer?.(ask, picked);
    },
    onSession: (status, error) => {
      first.onSession?.(status, error);
      owner.onSession?.(status, error);
    },
  };
}

export function useVisitorDiagnostics(diag: VisitorDiagnostics = visitorDiagnostics): CaptureHooks {
  const { shown, expectedIn } = usePlan();
  const on = useVisitorDiagSnapshot(diag).on;
  const latest = useRef({ shown, expectedIn });
  useEffect(() => {
    latest.current = { shown, expectedIn };
  });

  // Floors the stage leaves behind, once each per run (the owner's `runStep` rule, reused as is).
  useEffect(() => {
    if (!on) return undefined;
    let memory: RunMemory = FRESH_RUN;
    return useApp.subscribe((state, prev) => {
      if (state.run === prev.run) return;
      const step = runStep(prev.run, state.run, state.lastFloor, memory);
      memory = step.memory;
      const { shown: plan, expectedIn: expected } = latest.current;
      for (const floor of step.floors) {
        const fp = plan?.floors.find((f) => f.floor === floor);
        const entered = state.run.visits[floor] ?? null;
        diag.add({
          kind: 'floor',
          floor,
          recommended: fp?.packId ?? null,
          alternatives: fp?.alternatives ?? [],
          entered,
          expected:
            entered === null
              ? []
              : expected(floor, entered).map((giftId) => [giftId, state.run.giftStatus[giftId] ?? null]),
        });
      }
    });
  }, [on, diag]);

  return useMemo<CaptureHooks>(
    () => ({
      onRead: (report) => {
        if (!diag.recording) return;
        const frame = report.frame;
        diag.onRead({
          screen: frame.screen,
          floor: frame.floor,
          pack: frame.pack?.status === 'match' ? frame.pack.id : null,
          gift: frame.gift?.status === 'match' ? frame.gift.id : null,
          events: report.events.map(eventText),
        });
      },
      onApplied: (_logId, event, actions, fromRead) =>
        diag.add({ kind: 'applied', event: eventText(event), actions: actions.length, fromRead }),
      onUndo: (logId) => diag.add({ kind: 'undo', logId }),
      onAnswer: (ask, picked) => diag.add({ kind: 'answer', ask: ask.kind, picked }),
      onSession: (status, error) => diag.add({ kind: 'session', status, error }),
    }),
    [diag],
  );
}
