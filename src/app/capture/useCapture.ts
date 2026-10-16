/**
 * The screen reader as the app uses it (M107; held by `CaptureProvider` since M111): one
 * `CaptureSession`, its status, a log of what it did to the run (each entry undoable), and the
 * questions it could not settle on its own.
 *
 * Events are applied the moment they arrive (the owner's choice: high-confidence reads apply
 * automatically, with undo). The run state is read from the store at that moment rather than from
 * the render that started the session, so a long session never applies to a stale run.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { giftIconUrl } from '../lib/assets.ts';
import { usePlan } from '../shell/plan-context.ts';
import { useApp } from '../store.ts';
import {
  actionsFor,
  enterAction,
  execute,
  inverseOf,
  type CaptureAction,
  type CaptureAsk,
  type CaptureStep,
  type RunOps,
} from './apply.ts';
import { READ_INTERVALS } from './loop.ts';
import {
  CaptureSession,
  captureSupported,
  type CaptureContext,
  type CaptureError,
  type CaptureStatus,
  type FrameSource,
  type ReadReport,
} from './session.ts';
import type { CaptureEvent } from './tracker.ts';

export interface CaptureLogEntry {
  id: number;
  /** What was seen, or `answer` for a question the player settled. */
  event: CaptureEvent | { kind: 'answer'; ask: CaptureAsk; picked: number[] };
  actions: CaptureAction[];
  undone: boolean;
}

export interface CaptureQuestion {
  id: number;
  ask: CaptureAsk;
}

/** The log keeps the latest entries only; older ones cannot be undone from the panel anyway. */
const LOG_LIMIT = 20;
/** Questions nobody answers pile up over a long run; the oldest give way (M116). */
const QUESTION_LIMIT = 10;

/** What the owner's diagnostics (M112) hear from the session. All optional. */
export interface CaptureHooks {
  onRead?: (report: ReadReport, frame: FrameSource | null) => void;
  wantImage?: () => boolean;
  /** An entry went into the log; `fromRead` is false for an answered question. */
  onApplied?: (logId: number, event: { kind: string }, actions: unknown[], fromRead: boolean) => void;
  onUndo?: (logId: number) => void;
  onAnswer?: (ask: CaptureAsk, picked: number[]) => void;
  onSession?: (status: CaptureStatus, error: CaptureError | null) => void;
}

export function useCapture(hooks: CaptureHooks = {}) {
  const { data, indexes, enterAt, leave } = usePlan();
  const interval = useApp((s) => s.ui.captureInterval);
  const gameLang = useApp((s) => s.ui.captureLang);
  const [status, setStatus] = useState<CaptureStatus>('idle');
  const [error, setError] = useState<CaptureError | null>(null);
  const [log, setLog] = useState<CaptureLogEntry[]>([]);
  const [questions, setQuestions] = useState<CaptureQuestion[]>([]);
  const session = useRef<CaptureSession | null>(null);
  const nextId = useRef(1);

  // The session calls back long after the render that created it: it must see the latest of these.
  const latest = useRef({ data, indexes, enterAt, leave, gameLang, hooks });
  useEffect(() => {
    latest.current = { data, indexes, enterAt, leave, gameLang, hooks };
  });
  /**
   * True while the reader is changing the run, so a store listener can tell its changes from the
   * player's (zustand's `set` is synchronous: the listener runs inside this window).
   */
  const applying = useRef(false);

  /** Play steps on the run as it is now: the plan's entry and leave, the store for the rest. */
  const run = useCallback((steps: readonly CaptureStep[]): CaptureAction[] => {
    const ops: RunOps = {
      run: () => useApp.getState().run,
      enterAt: (floor, packId) => latest.current.enterAt(floor, packId),
      leave: (packId) => latest.current.leave(packId),
      visit: (floor, packId) => useApp.getState().visitPack(packId, floor),
      setStageFloor: (floor) => useApp.getState().setStageFloor(floor),
      setGiftStatus: (giftId, to) => useApp.getState().setGiftStatus(giftId, to),
    };
    applying.current = true;
    try {
      return execute(steps, ops);
    } finally {
      applying.current = false;
    }
  }, []);

  const record = useCallback((event: CaptureLogEntry['event'], actions: CaptureAction[]) => {
    if (actions.length === 0) return;
    const entry: CaptureLogEntry = { id: nextId.current++, event, actions, undone: false };
    setLog((all) => [entry, ...all].slice(0, LOG_LIMIT));
    latest.current.hooks.onApplied?.(entry.id, event, actions, event.kind !== 'answer');
  }, []);

  const ask = useCallback((question: CaptureAsk) => {
    setQuestions((all) => [...all, { id: nextId.current++, ask: question }].slice(-QUESTION_LIMIT));
  }, []);

  const onEvents = useCallback(
    (events: CaptureEvent[]) => {
      for (const event of events) {
        const { run: now } = useApp.getState();
        const applied = actionsFor(event, {
          giftStatus: now.giftStatus,
          giftById: latest.current.indexes.giftById,
          visits: now.visits,
          stageFloor: now.stageFloor,
        });
        record(event, run(applied.actions));
        // A clean read of a floor settles the question its muddled read left (M116).
        if (event.kind === 'enter')
          setQuestions((all) => all.filter((q) => !(q.ask.kind === 'pack' && q.ask.floor === event.floor)));
        if (applied.ask) ask(applied.ask);
      }
    },
    [ask, record, run],
  );

  /** The season's names in the game's language, made once per season and language (M116). */
  const candidates = useRef<{ key: unknown; lang: string; value: Omit<CaptureContext, 'held' | 'iconUrl'> }>(
    null,
  );
  const context = useCallback((): CaptureContext => {
    const { data: d, indexes: idx, gameLang: lang } = latest.current;
    if (candidates.current?.key !== d || candidates.current.lang !== lang)
      candidates.current = {
        key: d,
        lang,
        value: {
          lang,
          packs: d.packs.map((p) => ({ id: p.id, name: p.name[lang] })),
          gifts: d.gifts.map((g) => ({ id: g.id, name: g.name[lang] })),
          materials: d.gifts.filter((g) => g.acquisition.kind === 'material').map((g) => g.id),
        },
      };
    const giftStatus = useApp.getState().run.giftStatus;
    return {
      ...candidates.current.value,
      held: Object.entries(giftStatus)
        .filter(([, s]) => s === 'got')
        .map(([id]) => Number(id)),
      iconUrl: (id) => {
        const gift = idx.giftById.get(id);
        return gift ? (giftIconUrl(gift.icon)?.url ?? null) : null;
      },
    };
  }, []);

  const start = useCallback(async () => {
    session.current?.stop();
    setError(null);
    /**
     * Callbacks that speak only while their session is the current one (M116): a session replaced
     * or stopped can still finish a read or see its share end, and must not overwrite the status
     * of the one after it or touch the run.
     */
    const own =
      <A extends unknown[]>(fn: (...args: A) => void) =>
      (...args: A): void => {
        if (session.current === created) fn(...args);
      };
    const created: CaptureSession = new CaptureSession({
      intervalMs: READ_INTERVALS[useApp.getState().ui.captureInterval],
      context,
      onEvents: own(onEvents),
      onStatus: own((next: CaptureStatus, why?: CaptureError) => {
        setStatus(next);
        if (why) setError(why);
        latest.current.hooks.onSession?.(next, why ?? null);
      }),
      onRead: own((report: ReadReport, frame: FrameSource | null) =>
        latest.current.hooks.onRead?.(report, frame),
      ),
      wantImage: () => latest.current.hooks.wantImage?.() ?? false,
    });
    session.current = created;
    await created.start();
  }, [context, onEvents]);

  const stop = useCallback(() => {
    session.current?.stop();
    session.current = null;
  }, []);

  // A new interval takes effect at once; the session survives it.
  useEffect(() => {
    session.current?.setInterval(READ_INTERVALS[interval]);
  }, [interval]);

  // Closing the app (the provider unmounting) ends the share.
  useEffect(() => () => session.current?.stop(), []);

  const undo = useCallback(
    (id: number) => {
      const entry = log.find((e) => e.id === id);
      if (!entry || entry.undone) return;
      run(inverseOf(entry.actions));
      setLog((all) => all.map((e) => (e.id === id ? { ...e, undone: true } : e)));
      latest.current.hooks.onUndo?.(id);
    },
    [log, run],
  );

  /** Settle a question with the player's pick (none = dismiss). */
  const answer = useCallback(
    (id: number, picked: number[]) => {
      const question = questions.find((q) => q.id === id);
      setQuestions((all) => all.filter((q) => q.id !== id));
      if (!question) return;
      latest.current.hooks.onAnswer?.(question.ask, picked);
      if (picked.length === 0) return;
      const { ask: asked } = question;
      const now = useApp.getState().run;
      const entry = asked.kind === 'pack' ? enterAction(asked.floor, picked[0]!, now) : null;
      const steps: CaptureAction[] =
        asked.kind === 'pack'
          ? entry
            ? [entry]
            : []
          : [
              {
                kind: 'status',
                changes: picked.map((giftId) => ({
                  giftId,
                  from: now.giftStatus[giftId] ?? null,
                  to: asked.kind === 'gift' ? ('got' as const) : null,
                })),
              },
            ];
      record({ kind: 'answer', ask: asked, picked }, run(steps));
    },
    [questions, record, run],
  );

  // One object while nothing in it changes, so the provider's value holds still (M116).
  return useMemo(
    () => ({
      supported: captureSupported(),
      status,
      error,
      log,
      questions,
      start,
      stop,
      undo,
      answer,
      applying,
    }),
    [status, error, log, questions, start, stop, undo, answer],
  );
}
