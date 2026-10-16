/**
 * The screen reader as the stage uses it (M107): one `CaptureSession`, its status, a log of what it
 * did to the run (each entry undoable), and the questions it could not settle on its own.
 *
 * Events are applied the moment they arrive (the owner's choice: high-confidence reads apply
 * automatically, with undo). The run state is read from the store at that moment rather than from
 * the render that started the session, so a long session never applies to a stale run.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { giftIconUrl } from '../lib/assets.ts';
import { usePlan } from '../shell/plan-context.ts';
import { useApp } from '../store.ts';
import { actionsFor, inverseOf, type CaptureAction, type CaptureAsk } from './apply.ts';
import { READ_INTERVALS } from './loop.ts';
import {
  CaptureSession,
  captureSupported,
  type CaptureContext,
  type CaptureError,
  type CaptureStatus,
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

export function useCapture() {
  const { data, indexes, enterAt, leave } = usePlan();
  const setGiftStatus = useApp((s) => s.setGiftStatus);
  const interval = useApp((s) => s.ui.captureInterval);
  const gameLang = useApp((s) => s.ui.captureLang);
  const [status, setStatus] = useState<CaptureStatus>('idle');
  const [error, setError] = useState<CaptureError | null>(null);
  const [log, setLog] = useState<CaptureLogEntry[]>([]);
  const [questions, setQuestions] = useState<CaptureQuestion[]>([]);
  const session = useRef<CaptureSession | null>(null);
  const nextId = useRef(1);

  // The session calls back long after the render that created it: it must see the latest of these.
  const latest = useRef({ data, indexes, enterAt, leave, setGiftStatus, gameLang });
  useEffect(() => {
    latest.current = { data, indexes, enterAt, leave, setGiftStatus, gameLang };
  });

  const run = useCallback((actions: readonly (CaptureAction | { kind: 'leave'; packId: number })[]) => {
    const { enterAt: doEnter, leave: doLeave, setGiftStatus: setStatusOf } = latest.current;
    for (const action of actions) {
      if (action.kind === 'enter') doEnter(action.floor, action.packId);
      else if (action.kind === 'leave') doLeave(action.packId);
      else for (const change of action.changes) setStatusOf(change.giftId, change.to);
    }
  }, []);

  const record = useCallback((event: CaptureLogEntry['event'], actions: CaptureAction[]) => {
    if (actions.length === 0) return;
    const entry: CaptureLogEntry = { id: nextId.current++, event, actions, undone: false };
    setLog((all) => [entry, ...all].slice(0, LOG_LIMIT));
  }, []);

  const onEvents = useCallback(
    (events: CaptureEvent[]) => {
      for (const event of events) {
        const { indexes: idx } = latest.current;
        const applied = actionsFor(event, {
          giftStatus: useApp.getState().run.giftStatus,
          giftById: idx.giftById,
        });
        run(applied.actions);
        record(event, applied.actions);
        if (applied.ask) {
          const ask = applied.ask;
          setQuestions((all) => [...all, { id: nextId.current++, ask }]);
        }
      }
    },
    [record, run],
  );

  const context = useCallback((): CaptureContext => {
    const { data: d, indexes: idx, gameLang: lang } = latest.current;
    const giftStatus = useApp.getState().run.giftStatus;
    return {
      lang,
      packs: d.packs.map((p) => ({ id: p.id, name: p.name[lang] })),
      gifts: d.gifts.map((g) => ({ id: g.id, name: g.name[lang] })),
      held: Object.entries(giftStatus)
        .filter(([, s]) => s === 'got')
        .map(([id]) => Number(id)),
      materials: d.gifts.filter((g) => g.acquisition.kind === 'material').map((g) => g.id),
      iconUrl: (id) => {
        const gift = idx.giftById.get(id);
        return gift ? (giftIconUrl(gift.icon)?.url ?? null) : null;
      },
    };
  }, []);

  const start = useCallback(async () => {
    session.current?.stop();
    setError(null);
    const created = new CaptureSession({
      intervalMs: READ_INTERVALS[useApp.getState().ui.captureInterval],
      context,
      onEvents,
      onStatus: (next, why) => {
        setStatus(next);
        if (why) setError(why);
      },
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

  // Leaving the stage ends the share.
  useEffect(() => () => session.current?.stop(), []);

  const undo = useCallback(
    (id: number) => {
      const entry = log.find((e) => e.id === id);
      if (!entry || entry.undone) return;
      run(inverseOf(entry.actions));
      setLog((all) => all.map((e) => (e.id === id ? { ...e, undone: true } : e)));
    },
    [log, run],
  );

  /** Settle a question with the player's pick (none = dismiss). */
  const answer = useCallback(
    (id: number, picked: number[]) => {
      const question = questions.find((q) => q.id === id);
      setQuestions((all) => all.filter((q) => q.id !== id));
      if (!question || picked.length === 0) return;
      const { ask } = question;
      const giftStatus = useApp.getState().run.giftStatus;
      const actions: CaptureAction[] =
        ask.kind === 'pack'
          ? [{ kind: 'enter', floor: ask.floor, packId: picked[0]! }]
          : [
              {
                kind: 'status',
                changes: picked.map((giftId) => ({
                  giftId,
                  from: giftStatus[giftId] ?? null,
                  to: ask.kind === 'gift' ? ('got' as const) : null,
                })),
              },
            ];
      run(actions);
      record({ kind: 'answer', ask, picked }, actions);
    },
    [questions, record, run],
  );

  return { supported: captureSupported(), status, error, log, questions, start, stop, undo, answer };
}
