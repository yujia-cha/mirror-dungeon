/**
 * What the feedback form attaches as 「오류·조작 기록」 (M127): the last errors and the last
 * changes the visitor made, held in memory for this tab only.
 *
 * - **Errors** come from the crash boundary (`ErrorBoundary`), a data load that failed
 *   (`DataLoadError`) and the window's own `error` / `unhandledrejection` events. Each keeps its
 *   message and the first lines of its stack — enough to find the throwing module, short enough
 *   for an issue URL.
 * - **Actions** are what changed in the store, said in a word (`describeChange`): a goal added, a
 *   pack entered, a gift marked, the deck replaced. Not the deck's contents (the share link in the
 *   issue says those) and nothing the app does not already hold.
 *
 * Nothing leaves the page from here. The form reads `entries()` when the visitor opens it and the
 * visitor decides whether to send it. Listeners (`subscribe`) let the visitor's own diagnostics
 * record (`feedback/visitor-diagnostics.ts`, opt-in and kept on the device) copy the same entries.
 *
 * The ring and the describing are pure; `installFeedbackLog` is the one place that touches the
 * window and the store, and it takes both as arguments so a test can hand in its own.
 */
import type { RunState } from './plan-input.ts';

export type FeedbackLogEntry =
  | {
      t: number;
      kind: 'error';
      /** Where it was caught. */
      source: 'render' | 'load' | 'window' | 'promise';
      message: string;
      /** The first lines of the stack (or the component stack), trimmed. */
      stack?: string;
    }
  | { t: number; kind: 'action'; text: string };

/** How many entries the ring keeps: the last ~50 is what a report needs, and what fits a URL. */
export const LOG_CAPACITY = 50;
const STACK_LINES = 4;
const MESSAGE_MAX = 300;

/** A fixed-size ring: the oldest entry goes when a new one would overflow it. */
export class Ring<T> {
  private items: T[] = [];
  constructor(readonly capacity: number) {}
  push(item: T): void {
    this.items.push(item);
    if (this.items.length > this.capacity) this.items.splice(0, this.items.length - this.capacity);
  }
  /** Oldest first. A copy, so a reader cannot change the ring. */
  toArray(): T[] {
    return [...this.items];
  }
  clear(): void {
    this.items = [];
  }
  get size(): number {
    return this.items.length;
  }
}

/** The first lines of a stack, with the page's origin cut off each frame so lines stay short. */
export function shortStack(stack: string | undefined | null, origin = ''): string | undefined {
  if (!stack) return undefined;
  const lines = stack
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, STACK_LINES)
    .map((line) => (origin ? line.split(origin).join('') : line).slice(0, 200));
  return lines.length ? lines.join('\n') : undefined;
}

function clip(text: string, max = MESSAGE_MAX): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** An error-ish value as a message and a stack. */
export function describeError(cause: unknown): { message: string; stack?: string } {
  if (cause instanceof Error) {
    const label = cause.name && cause.name !== 'Error' ? `${cause.name}: ${cause.message}` : cause.message;
    return { message: clip(label || cause.name || 'Error'), stack: cause.stack };
  }
  if (typeof cause === 'string') return { message: clip(cause) };
  try {
    return { message: clip(JSON.stringify(cause) ?? String(cause)) };
  } catch {
    return { message: clip(String(cause)) };
  }
}

type Listener = (entry: FeedbackLogEntry) => void;

export class FeedbackLog {
  private ring: Ring<FeedbackLogEntry>;
  private listeners = new Set<Listener>();
  private changes = 0;
  constructor(
    capacity = LOG_CAPACITY,
    private now: () => number = Date.now,
    private origin = '',
  ) {
    this.ring = new Ring(capacity);
  }

  private add(entry: FeedbackLogEntry): void {
    this.ring.push(entry);
    this.changes += 1;
    for (const listener of this.listeners) listener(entry);
  }

  error(
    source: Extract<FeedbackLogEntry, { kind: 'error' }>['source'],
    cause: unknown,
    extraStack?: string,
  ): void {
    const { message, stack } = describeError(cause);
    const lines = shortStack(extraStack ?? stack, this.origin);
    this.add({ t: this.now(), kind: 'error', source, message, ...(lines ? { stack: lines } : {}) });
  }

  action(text: string): void {
    this.add({ t: this.now(), kind: 'action', text: clip(text, 160) });
  }

  entries(): FeedbackLogEntry[] {
    return this.ring.toArray();
  }

  clear(): void {
    this.ring.clear();
    this.changes += 1;
  }

  /**
   * Goes up with every entry (and a clear): a snapshot for `useSyncExternalStore`, which the
   * overlay window (M132) reads the log through — `entries()` is a fresh copy on each call.
   */
  get revision(): number {
    return this.changes;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

/** The page's one log. */
export const feedbackLog = new FeedbackLog(
  LOG_CAPACITY,
  Date.now,
  typeof window === 'undefined' ? '' : window.location.origin,
);

/** The slice of the store `describeChange` reads. */
export interface LoggedState {
  deck: readonly number[];
  deployed: readonly number[];
  wanted: readonly number[];
  fusionGoal: Readonly<Record<number, unknown>>;
  /** Enhancement steps per gift (M130). */
  upgrades?: Readonly<Record<number, number>>;
  options: unknown;
  run: RunState;
  /** The state to go back to before the reader started the run (M143). */
  runSnapshot?: { run: RunState } | null;
  lang: string;
  dark: boolean;
  season: number | undefined;
  ui: { leftTab: string; rightTab: string };
}

function added(prev: readonly number[], next: readonly number[]): number[] {
  const before = new Set(prev);
  return next.filter((id) => !before.has(id));
}

/**
 * What changed between two store states, one short line per change. Ids, not names: the issue
 * carries the share link, and the owner decodes ids against the data anyway. Panel widths, icon
 * size and the like are left out — they never explain a bug and would crowd the ring.
 */
export function describeChange(prev: LoggedState, next: LoggedState): string[] {
  const out: string[] = [];
  if (prev.season !== next.season) out.push(`season ${prev.season ?? '-'} → ${next.season ?? '-'}`);
  if (prev.deck !== next.deck) {
    const plus = added(prev.deck, next.deck);
    const minus = added(next.deck, prev.deck);
    if (plus.length || minus.length)
      out.push(`deck ${[...plus.map((id) => `+${id}`), ...minus.map((id) => `-${id}`)].join(' ')}`);
  }
  if (prev.deployed !== next.deployed) {
    const plus = added(prev.deployed, next.deployed);
    const minus = added(next.deployed, prev.deployed);
    if (plus.length || minus.length)
      out.push(`deployed ${[...plus.map((id) => `+${id}`), ...minus.map((id) => `-${id}`)].join(' ')}`);
  }
  if (prev.wanted !== next.wanted) {
    const plus = added(prev.wanted, next.wanted);
    const minus = added(next.wanted, prev.wanted);
    if (plus.length || minus.length)
      out.push(`goal ${[...plus.map((id) => `+${id}`), ...minus.map((id) => `-${id}`)].join(' ')}`);
  }
  if (
    prev.fusionGoal !== next.fusionGoal &&
    JSON.stringify(prev.fusionGoal) !== JSON.stringify(next.fusionGoal)
  )
    out.push(`fusion goal ${JSON.stringify(next.fusionGoal)}`);
  if (prev.upgrades !== next.upgrades) {
    const before = prev.upgrades ?? {};
    const after = next.upgrades ?? {};
    const ids = [...new Set([...Object.keys(before), ...Object.keys(after)].map(Number))].sort(
      (a, b) => a - b,
    );
    for (const id of ids) {
      if (before[id] !== after[id]) out.push(`upgrade ${id} ${before[id] ?? 0} → ${after[id] ?? 0}`);
    }
  }
  if (prev.options !== next.options && JSON.stringify(prev.options) !== JSON.stringify(next.options)) {
    const before = (prev.options ?? {}) as Record<string, unknown>;
    const after = (next.options ?? {}) as Record<string, unknown>;
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])]
      .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
      .sort();
    out.push(`options ${keys.map((key) => `${key}=${JSON.stringify(after[key])}`).join(' ')}`);
  }
  if (prev.run !== next.run) out.push(...describeRun(prev.run, next.run));
  const before = prev.runSnapshot ?? null;
  const after = next.runSnapshot ?? null;
  if (before !== after) {
    // A rollback puts the snapshot's run back and spends it; any other way it goes is a run thrown away.
    if (after) out.push('run snapshot saved');
    else if (before && JSON.stringify(next.run) === JSON.stringify(before.run)) out.push('run rolled back');
    else out.push('run snapshot cleared');
  }
  if (prev.lang !== next.lang) out.push(`lang ${next.lang}`);
  if (prev.dark !== next.dark) out.push(`theme ${next.dark ? 'dark' : 'light'}`);
  if (prev.ui.leftTab !== next.ui.leftTab) out.push(`left tab ${next.ui.leftTab}`);
  if (prev.ui.rightTab !== next.ui.rightTab) out.push(`right tab ${next.ui.rightTab}`);
  return out;
}

/** The run's changes: floors moved, packs entered or taken back, gifts marked. */
export function describeRun(prev: RunState, next: RunState): string[] {
  const out: string[] = [];
  const floors = new Set([...Object.keys(prev.visits), ...Object.keys(next.visits)].map(Number));
  for (const floor of [...floors].sort((a, b) => a - b)) {
    const from = prev.visits[floor];
    const to = next.visits[floor];
    if (from === to) continue;
    out.push(to === undefined ? `leave F${floor} pack ${from}` : `enter F${floor} pack ${to}`);
  }
  const gifts = new Set([...Object.keys(prev.giftStatus), ...Object.keys(next.giftStatus)].map(Number));
  for (const giftId of [...gifts].sort((a, b) => a - b)) {
    const from = prev.giftStatus[giftId];
    const to = next.giftStatus[giftId];
    if (from !== to) out.push(`gift ${giftId} ${from ?? '-'} → ${to ?? '-'}`);
  }
  if (prev.currentFloor !== next.currentFloor)
    out.push(`frontier F${prev.currentFloor} → F${next.currentFloor}`);
  if (prev.stageFloor !== next.stageFloor) out.push(`stage F${prev.stageFloor} → F${next.stageFloor}`);
  if ((prev.startDone === true) !== (next.startDone === true))
    out.push(next.startDone ? 'start done' : 'start open');
  return out;
}

interface ErrorTarget {
  addEventListener: (type: string, fn: (event: Event) => void) => void;
  removeEventListener: (type: string, fn: (event: Event) => void) => void;
}

interface Subscribable<S> {
  subscribe: (fn: (state: S, prev: S) => void) => () => void;
}

/**
 * Wire the log to the page: the window's uncaught errors and rejected promises, and every store
 * change. Returns the undo. `main.tsx` calls it once, before the first render.
 */
export function installFeedbackLog<S extends LoggedState>(
  target: ErrorTarget,
  store: Subscribable<S>,
  log: FeedbackLog = feedbackLog,
): () => void {
  const onError = (event: Event): void => {
    const e = event as ErrorEvent;
    log.error('window', e.error ?? e.message ?? 'error');
  };
  const onRejection = (event: Event): void => {
    log.error('promise', (event as PromiseRejectionEvent).reason ?? 'rejection');
  };
  target.addEventListener('error', onError);
  target.addEventListener('unhandledrejection', onRejection);
  const unsubscribe = store.subscribe((state, prev) => {
    for (const line of describeChange(prev, state)) log.action(line);
  });
  return () => {
    target.removeEventListener('error', onError);
    target.removeEventListener('unhandledrejection', onRejection);
    unsubscribe();
  };
}
