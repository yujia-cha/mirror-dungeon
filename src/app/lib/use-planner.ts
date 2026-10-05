/**
 * Run the planner without blocking the render thread.
 *
 * Why this exists, with measurements (`docs/review/M49.md`): at 40 goals whose recipes conflict,
 * one plan is ~180ms and the alternatives that follow it are ~920ms — so every gift toggle froze
 * the UI for about a second, and a quick series of toggles queued a second of work each time.
 * `planRoute` itself was never the problem; `planAlternatives` calling it six more times was.
 *
 * A worker fixes it without touching any of that code: the same planner runs there, the result is
 * plain data (`RoutePlan` holds no Map or Set), and the panel keeps showing the previous answer
 * until the new one lands.
 *
 * Since M52 the worker answers **twice**: the route (`plan`), then its alternatives (`variants`).
 * `pending` is about the route only, so 「갱신 중…」 clears after ~180ms rather than ~1s, and a
 * newer question skips the older one's alternatives altogether (`createPlanner`).
 *
 * **The fallback is not a lesser path.** Where a module worker cannot be constructed — jsdom in
 * tests, a browser that refuses — the same function runs inline and the hook answers synchronously
 * on the first render. Behaviour is identical; only the timing differs. That is what keeps the
 * shell tests meaningful: they exercise `runPlan` for real rather than a stub.
 *
 * It is also the recovery path, and that matters more than the optimisation. `new Worker` does not
 * throw when its script 404s or fails to parse — it reports an `error` event later — so without
 * listening for that, a worker the browser could construct but not run would leave the panel
 * waiting forever with no route at all. Any failure from the worker side falls back to inline for
 * the rest of the session, which is exactly the behaviour this app had before the worker existed.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { GameData } from '../../core/schema.ts';
import type { GameIndexes, PlanInput } from '../../core/types.ts';
import {
  runDrop,
  runPlan,
  type PlanResponse,
  type PlanResult,
  type PlannerResponse,
} from './planner-protocol.ts';
import type { DropAnalysis } from '../../core/index.ts';
import type { RoutePlan } from '../../core/types.ts';

export interface PlannerState extends PlanResult {
  /** True while the worker is still answering; what is on show is the previous answer. */
  pending: boolean;
  /**
   * True while the route on show is waiting for its drop analysis (M52: it arrives after it). Until
   * then `analysis` is null rather than the previous plan's — that answers a different question.
   */
  analysisPending: boolean;
  /** The plan with the `dropped` goals left out, or null when nothing is dropped (or left). */
  dropPlan: RoutePlan | null;
  /** True while `dropPlan` is still being computed for the current `dropped`. */
  dropPending: boolean;
  /** False when the plan is computed inline — the fallback, and what tests run on. */
  offThread: boolean;
}

/**
 * Build the worker, or `null` when this environment cannot.
 *
 * `new Worker(new URL(...))` is the form Vite understands statically, so the worker is bundled and
 * hashed like any other entry. It throws in jsdom, which is the fallback's main customer.
 */
function makeWorker(): Worker | null {
  try {
    if (typeof Worker === 'undefined') return null;
    return new Worker(new URL('./planner.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return null;
  }
}

/**
 * One worker for the page, built on first use.
 *
 * Module scope rather than a ref or lazy state, for three reasons. A ref cannot be read during
 * render (`react-hooks/refs`), and the thing has to be known on the *first* render or the plan
 * appears and then vanishes. `useState`'s initializer runs twice under StrictMode, which would
 * build two workers and leak one. And there is only ever one `PlanProvider`, so a page-scoped
 * worker is the honest lifetime: it lives as long as the app, and `undefined` vs `null` keeps
 * "not yet asked" apart from "this environment has no workers".
 */
let cached: Worker | null | undefined;

const NONE: readonly number[] = [];

function plannerWorker(): Worker | null {
  if (cached === undefined) cached = makeWorker();
  return cached;
}

/** Tests only: drop the cached worker so the next render builds one from the current global. */
export function resetPlannerWorker(): void {
  cached?.terminate();
  cached = undefined;
}

export function usePlanner(
  data: GameData,
  indexes: GameIndexes,
  input: PlanInput,
  dropped: readonly number[] = NONE,
): PlannerState {
  // Known on the first render, so the plan never appears and then vanishes.
  const worker = plannerWorker();

  const [answer, setAnswer] = useState<PlanResponse | null>(null);
  const [alternatives, setAlternatives] = useState<{ id: number; analysis: DropAnalysis } | null>(null);
  const [dropAnswer, setDropAnswer] = useState<{ id: number; plan: RoutePlan | null } | null>(null);
  const [dropSent, setDropSent] = useState(0);
  const dropKey = [...dropped].sort((a, b) => a - b).join(',');
  const nextId = useRef(0);
  const [sentId, setSentId] = useState(0);
  /** Set when the worker reports an error; from then on the plan is computed inline. */
  const [broken, setBroken] = useState(false);
  const active = broken ? null : worker;

  useEffect(() => {
    if (!active) return undefined;
    const onMessage = (event: MessageEvent<PlannerResponse>): void => {
      const message = event.data;
      // Answers can arrive out of order after a season change; the newest question wins.
      if (message.type === 'plan')
        setAnswer((current) => (current && current.id > message.id ? current : message));
      if (message.type === 'analysis') {
        setAlternatives((current) =>
          current && current.id > message.id ? current : { id: message.id, analysis: message.analysis },
        );
      }
      if (message.type === 'drop')
        setDropAnswer((current) => (current && current.id > message.id ? current : message));
    };
    // A script that 404s, a parse error, an exception inside the planner: all arrive here, and all
    // mean the same thing — stop waiting and compute inline instead.
    const onError = (): void => setBroken(true);
    active.addEventListener('message', onMessage);
    active.addEventListener('error', onError);
    active.addEventListener('messageerror', onError);
    return () => {
      active.removeEventListener('message', onMessage);
      active.removeEventListener('error', onError);
      active.removeEventListener('messageerror', onError);
    };
  }, [active]);

  // The season's data goes over once per season. A change also invalidates the answer on show,
  // which the id comparison below handles: the next plan request carries a higher id.
  useEffect(() => {
    active?.postMessage({ type: 'init', data });
  }, [active, data]);

  useEffect(() => {
    if (!active) return;
    nextId.current += 1;
    setSentId(nextId.current);
    active.postMessage({ type: 'plan', id: nextId.current, input });
  }, [active, input, data]);

  // The checked set, asked after the plan so the worker answers it against the same input. Ids
  // come from the same counter, so a drop answer is newer than the plan it was asked after.
  useEffect(() => {
    if (!active || dropKey === '') return;
    nextId.current += 1;
    setDropSent(nextId.current);
    active.postMessage({ type: 'drop', id: nextId.current, dropped: dropKey.split(',').map(Number) });
  }, [active, input, data, dropKey]);

  // No worker, or a worker that failed: compute inline, once per input, as the provider used to.
  const inline = useMemo(
    () => (active ? null : runPlan(input, data, indexes)),
    [active, input, data, indexes],
  );

  const inlineDrop = useMemo(
    () => (active || dropKey === '' ? null : runDrop(input, dropKey.split(',').map(Number), data, indexes)),
    [active, input, data, indexes, dropKey],
  );

  if (!active)
    return {
      ...inline!,
      pending: false,
      analysisPending: false,
      dropPlan: inlineDrop,
      dropPending: false,
      offThread: false,
    };
  // The analysis belongs to one plan; shown only beside the plan it was computed for.
  const matched = answer !== null && alternatives?.id === answer.id;
  const dropFresh = dropKey !== '' && dropAnswer !== null && dropAnswer.id === dropSent;
  return {
    plan: answer?.plan ?? null,
    analysis: matched ? alternatives.analysis : null,
    pending: answer === null || answer.id < sentId,
    analysisPending: answer !== null && answer.analysisPending && !matched,
    dropPlan: dropFresh ? dropAnswer.plan : null,
    dropPending: dropKey !== '' && !dropFresh,
    offThread: true,
  };
}
