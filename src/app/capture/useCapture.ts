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
import { observable, observationBudget } from '../../core/index.ts';
import { giftIconUrl } from '../lib/assets.ts';
import { observationClosed } from '../lib/plan-input.ts';
import { feedbackLog } from '../lib/feedback-log.ts';
import type { RunState } from '../lib/plan-input.ts';
import { heldGifts } from '../lib/run-gifts.ts';
import { usePlan } from '../shell/plan-context.ts';
import { collectedGifts, runHasProgress, useApp } from '../store.ts';
import {
  actionsFor,
  answerActions,
  execute,
  inverseOf,
  type ApplyContext,
  type CaptureAction,
  type CaptureAsk,
  type CaptureStep,
  type RunOps,
} from './apply.ts';
import { READ_INTERVALS } from './loop.ts';
import { reprintsOf } from './reprint.ts';
import {
  CaptureSession,
  captureSupported,
  type CaptureContext,
  type CaptureError,
  type CaptureGeometry,
  type CaptureStatus,
  type EnvReport,
  type FrameSource,
  type ReadReport,
  type TickReport,
} from './session.ts';
import type { CaptureEvent } from './tracker.ts';

export interface CaptureLogEntry {
  id: number;
  /** What was seen, or `answer` for a question the player settled. */
  event: CaptureEvent | { kind: 'answer'; ask: CaptureAsk; picked: number[] };
  actions: CaptureAction[];
  undone: boolean;
  /** When it was recorded (ms since the epoch) — the overlay window interleaves it with the store's changes (M132). */
  at: number;
}

export interface CaptureQuestion {
  id: number;
  ask: CaptureAsk;
}

/** The log keeps the latest entries only; older ones cannot be undone from the panel anyway. */
const LOG_LIMIT = 20;
/**
 * What an event or an answer meets in the run (M151 shares it between the two): read from the
 * store the moment it lands, not from the render that started the session.
 */
function applyContext(giftById: ApplyContext['giftById'], reprints: ApplyContext['reprints']): ApplyContext {
  const { run: now, options, wanted, fusionGoal } = useApp.getState();
  return {
    giftStatus: now.giftStatus,
    giftById,
    visits: now.visits,
    stageFloor: now.stageFloor,
    observed: options.observedGifts,
    startDone: now.startDone === true,
    currentFloor: now.currentFloor,
    collected: collectedGifts(wanted, fusionGoal),
    reprints,
  };
}

/** Questions nobody answers pile up over a long run; the oldest give way (M116). */
const QUESTION_LIMIT = 10;

/** What the owner's diagnostics (M112) hear from the session. All optional. */
export interface CaptureHooks {
  onRead?: (report: ReadReport, frame: FrameSource | null) => void;
  wantImage?: () => boolean;
  /** Every tick of the session, with its preview when `wantImage()` (M134). */
  onTick?: (tick: TickReport, preview: FrameSource | null) => void;
  /** The latest read raised a question (M134). */
  onAsk?: (ask: CaptureAsk) => void;
  /** An entry went into the log; `fromRead` is false for an answered question. */
  onApplied?: (logId: number, event: { kind: string }, actions: unknown[], fromRead: boolean) => void;
  onUndo?: (logId: number) => void;
  onAnswer?: (ask: CaptureAsk, picked: number[]) => void;
  onSession?: (status: CaptureStatus, error: CaptureError | null) => void;
  /** The shared picture's size and title bar, on the first read and whenever they change (M134). */
  onGeometry?: (geometry: CaptureGeometry) => void;
  /** The run was started with the reader (new or continued), or rolled back to before it (M143). */
  onRunMark?: (mark: RunMark) => void;
  /** The environment the reader runs in (M142): every 10 s, and when the load level moves. */
  onEnv?: (env: EnvReport) => void;
}

/** A run-start marker (M143): what the player chose, and the run it was chosen on. */
export interface RunMark {
  mark: 'new' | 'continue' | 'rollback';
  /** The run before the choice held progress (`runHasProgress`). */
  hadProgress: boolean;
  /** That run, in counts. */
  run: RunSummary;
}

export interface RunSummary {
  currentFloor: number;
  visits: number;
  got: number;
  failed: number;
  startDone: boolean;
}

export function runSummary(run: RunState): RunSummary {
  const statuses = Object.values(run.giftStatus);
  return {
    currentFloor: run.currentFloor,
    visits: Object.keys(run.visits).length,
    got: statuses.filter((s) => s === 'got').length,
    failed: statuses.filter((s) => s === 'failed').length,
    startDone: run.startDone === true,
  };
}

export function useCapture(hooks: CaptureHooks = {}) {
  const { data, indexes, enterAt, leave } = usePlan();
  const interval = useApp((s) => s.ui.captureInterval);
  const gameLang = useApp((s) => s.ui.captureLang);
  const [status, setStatus] = useState<CaptureStatus>('idle');
  // The store hears whether the reader is watching (M140): a start left with it running is
  // settled on what it saw, not on the plan's guess.
  useEffect(() => {
    useApp.getState().setCaptureLive(status === 'running');
  }, [status]);
  useEffect(() => () => useApp.getState().setCaptureLive(false), []);
  const [error, setError] = useState<CaptureError | null>(null);
  /** The machine is strained: the reader cut optional reads (M142, `pace.ts`). */
  const [strained, setStrained] = useState(false);
  const [log, setLog] = useState<CaptureLogEntry[]>([]);
  const [questions, setQuestions] = useState<CaptureQuestion[]>([]);
  /** The player is in a pack's shop, as the reader last saw (M148). Off whenever it is not reading. */
  const [inShop, setInShop] = useState(false);
  const session = useRef<CaptureSession | null>(null);
  const nextId = useRef(1);

  /** Reprint → original (M159): an entry read later never steps down from a reprint. */
  const reprints = useMemo(() => reprintsOf(data.packs.map((p) => ({ id: p.id, name: p.name.en }))), [data]);
  // The session calls back long after the render that created it: it must see the latest of these.
  const latest = useRef({ data, indexes, reprints, enterAt, leave, gameLang, hooks });
  useEffect(() => {
    latest.current = { data, indexes, reprints, enterAt, leave, gameLang, hooks };
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
      observe: (giftId) => {
        const { data: d, indexes: idx } = latest.current;
        const store = useApp.getState();
        store.recordObserved(giftId, {
          max: observationBudget(store.options, d),
          observable: (id) => {
            const gift = idx.giftById.get(id);
            return gift ? observable(gift, d.rules) : false;
          },
        });
        return useApp.getState().options.observedGifts.includes(giftId);
      },
      unobserve: (giftId) => {
        const store = useApp.getState();
        // Taking a pin off needs no limits.
        if (store.options.observedGifts.includes(giftId))
          store.toggleObserved(giftId, { max: 0, observable: () => false });
      },
      settleStart: () => useApp.getState().settleStart(),
      reopenStart: () => useApp.getState().markStartDone(false),
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
    const entry: CaptureLogEntry = { id: nextId.current++, event, actions, undone: false, at: Date.now() };
    setLog((all) => [entry, ...all].slice(0, LOG_LIMIT));
    latest.current.hooks.onApplied?.(entry.id, event, actions, event.kind !== 'answer');
  }, []);

  const ask = useCallback((question: CaptureAsk) => {
    setQuestions((all) => [...all, { id: nextId.current++, ask: question }].slice(-QUESTION_LIMIT));
  }, []);

  const onEvents = useCallback(
    (events: CaptureEvent[]) => {
      for (const event of events) {
        const applied = actionsFor(
          event,
          applyContext(latest.current.indexes.giftById, latest.current.reprints),
        );
        if (event.kind === 'place') setInShop(event.shop);
        record(event, run(applied.actions));
        // A clean read of a floor settles the question its muddled read left (M116).
        if (event.kind === 'enter')
          setQuestions((all) => all.filter((q) => !(q.ask.kind === 'pack' && q.ask.floor === event.floor)));
        if (applied.ask) {
          ask(applied.ask);
          latest.current.hooks.onAsk?.(applied.ask);
        }
      }
    },
    [ask, record, run],
  );

  /** The season's names in the game's language, made once per season and language (M116). */
  const candidates = useRef<{
    key: unknown;
    lang: string;
    value: Omit<CaptureContext, 'held' | 'iconUrl' | 'startOpen'>;
  }>(null);
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
          // 「EX」 has no numeral of bars: unknown, so the slots never drop it.
          tiers: new Map(d.gifts.map((g) => [g.id, typeof g.tier === 'number' ? g.tier : null])),
        },
      };
    const { run: now } = useApp.getState();
    return {
      ...candidates.current.value,
      startOpen: !observationClosed(now),
      held: heldGifts(now.giftStatus),
      iconUrl: (id) => {
        const gift = idx.giftById.get(id);
        return gift ? (giftIconUrl(gift.icon)?.url ?? null) : null;
      },
    };
  }, []);

  const start = useCallback(async () => {
    session.current?.stop();
    setError(null);
    // A new session's tracker starts outside the shop (M148).
    setInShop(false);
    setStrained(false);
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
      interval: READ_INTERVALS[useApp.getState().ui.captureInterval],
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
      onGeometry: own((geometry: CaptureGeometry) => latest.current.hooks.onGeometry?.(geometry)),
      onEnv: own((env: EnvReport) => {
        setStrained(env.level > 0);
        latest.current.hooks.onEnv?.(env);
      }),
      // Not `own`: a preview a stale session hands over must still be freed.
      onTick: (tick: TickReport, preview: FrameSource | null) => {
        const onTick = session.current === created ? latest.current.hooks.onTick : undefined;
        if (onTick) onTick(tick, preview);
        else preview?.close();
      },
    });
    session.current = created;
    await created.start();
  }, [context, onEvents]);

  const stop = useCallback(() => {
    session.current?.stop();
    session.current = null;
  }, []);

  /** The log and questions belong to the run they were made on; its undo cannot apply to another. */
  const forgetRun = useCallback(() => {
    setLog([]);
    setQuestions([]);
  }, []);

  // A run thrown away anywhere else — 「같은 목표로 새 런」, the header's 초기화, a share link, a
  // season that dropped it — takes the log with it (M160): an undo left over would write the old
  // run's statuses onto the new one. The reader's own undo may empty the run too; that one keeps
  // the log, which is where it came from.
  useEffect(
    () =>
      useApp.subscribe((state, prev) => {
        if (state.run === prev.run || applying.current) return;
        if (runHasProgress(prev.run) && !runHasProgress(state.run)) forgetRun();
      }),
    [forgetRun],
  );

  /**
   * Starting the reader is starting the run (M143): `'new'` snapshots the state and starts the run
   * over (`beginRun`), `'continue'` reads on the run as it is (a reload mid-run). Called straight
   * from the press — `start()` asks for the share at once, inside the gesture.
   */
  const begin = useCallback(
    (mode: 'new' | 'continue') => {
      const before = useApp.getState().run;
      const hadProgress = runHasProgress(before);
      useApp.getState().beginRun(mode);
      if (mode === 'new' && hadProgress) forgetRun();
      feedbackLog.action(`capture run ${mode}`);
      latest.current.hooks.onRunMark?.({ mark: mode, hadProgress, run: runSummary(before) });
      return start();
    },
    [forgetRun, start],
  );

  /** 「런 중단 · 시작 전으로 되돌리기」 (M143): stop reading and put the snapshot back. */
  const rollback = useCallback(() => {
    const before = useApp.getState().run;
    stop();
    if (!useApp.getState().rollbackRun()) return;
    forgetRun();
    latest.current.hooks.onRunMark?.({
      mark: 'rollback',
      hadProgress: runHasProgress(before),
      run: runSummary(before),
    });
  }, [forgetRun, stop]);

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
      const applied = answerActions(
        asked,
        picked,
        applyContext(latest.current.indexes.giftById, latest.current.reprints),
      );
      record({ kind: 'answer', ask: asked, picked }, run(applied.actions));
      // A fusion's result named by the answer may leave what it ate to ask about (M151).
      if (applied.ask) {
        ask(applied.ask);
        latest.current.hooks.onAsk?.(applied.ask);
      }
    },
    [ask, questions, record, run],
  );

  // One object while nothing in it changes, so the provider's value holds still (M116).
  return useMemo(
    () => ({
      supported: captureSupported(),
      status,
      error,
      log,
      questions,
      inShop: inShop && status === 'running',
      start,
      begin,
      stop,
      rollback,
      undo,
      answer,
      applying,
      // Only while reading: a stopped session's last level says nothing.
      strained: strained && status === 'running',
    }),
    [status, error, log, questions, inShop, start, begin, stop, rollback, undo, answer, strained],
  );
}
