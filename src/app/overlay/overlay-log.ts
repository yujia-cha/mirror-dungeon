/**
 * What the overlay's 「방금 한 행동」 tells (M151): the run's changes as facts, for the window to
 * say in a sentence with names — 「3층 「헬스치킨」에 입장했습니다」, not the feedback log's
 * `enter F3 pack 1012`. The feedback log keeps its short machine lines for the owner's issues;
 * this is a second listener on the same store with its own small ring.
 *
 * Only what a player in the game cares about is a fact: goals, entries, gift marks, floors
 * skipped, the run start, a run begun, rolled back or cleared, the deck. Tabs, theme, sizes and
 * options say nothing about the run and are left out. One store change can mark many gifts at
 * once (leaving a floor settles its misses); those are one fact per kind of mark. A run begun,
 * rolled back or cleared is that fact alone — the gift marks it wiped are its consequence.
 *
 * `runFacts` is pure; `installOverlayLog` is the one place that subscribes, called by `main.tsx`.
 */
import { Ring } from '../lib/feedback-log.ts';
import type { GiftStatus, RunState } from '../lib/plan-input.ts';

export type RunFact =
  | { kind: 'goal'; added: number[]; removed: number[] }
  | { kind: 'enter'; floor: number; packId: number }
  | { kind: 'leave'; floor: number; packId: number }
  | { kind: 'skip'; floor: number }
  | { kind: 'status'; from: GiftStatus | null; to: GiftStatus | null; ids: number[] }
  | { kind: 'start'; done: boolean }
  | { kind: 'runNew' }
  | { kind: 'rollback' }
  | { kind: 'runCleared' }
  | { kind: 'deck' };

export interface FactEntry {
  t: number;
  fact: RunFact;
}

/** The slice of the store the facts read. */
export interface FactState {
  deck: readonly number[];
  wanted: readonly number[];
  run: RunState;
  runSnapshot?: { run: RunState } | null;
}

const added = (prev: readonly number[], next: readonly number[]): number[] => {
  const before = new Set(prev);
  return next.filter((id) => !before.has(id));
};

const hasProgress = (run: RunState): boolean =>
  Object.keys(run.visits).length > 0 || Object.keys(run.giftStatus).length > 0 || run.currentFloor > 1;

/** The run's changes between two store states, in the order a player would tell them. */
export function runFacts(prev: FactState, next: FactState): RunFact[] {
  const out: RunFact[] = [];
  if (prev.deck !== next.deck && JSON.stringify(prev.deck) !== JSON.stringify(next.deck))
    out.push({ kind: 'deck' });
  if (prev.wanted !== next.wanted) {
    const plus = added(prev.wanted, next.wanted);
    const minus = added(next.wanted, prev.wanted);
    if (plus.length || minus.length) out.push({ kind: 'goal', added: plus, removed: minus });
  }
  if (prev.run === next.run && (prev.runSnapshot ?? null) === (next.runSnapshot ?? null)) return out;

  const before = prev.runSnapshot ?? null;
  const after = next.runSnapshot ?? null;
  if (before !== after && after) return [...out, { kind: 'runNew' }];
  if (before !== after && before && JSON.stringify(next.run) === JSON.stringify(before.run))
    return [...out, { kind: 'rollback' }];
  if (hasProgress(prev.run) && !hasProgress(next.run)) return [...out, { kind: 'runCleared' }];

  const a = prev.run;
  const b = next.run;
  const floors = new Set([...Object.keys(a.visits), ...Object.keys(b.visits)].map(Number));
  for (const floor of [...floors].sort((x, y) => x - y)) {
    const from = a.visits[floor];
    const to = b.visits[floor];
    if (from === to) continue;
    if (from !== undefined) out.push({ kind: 'leave', floor, packId: from });
    if (to !== undefined) out.push({ kind: 'enter', floor, packId: to });
  }
  // Floors the frontier walked past with no entry on them were skipped.
  for (let floor = a.currentFloor; floor < b.currentFloor; floor++)
    if (b.visits[floor] === undefined) out.push({ kind: 'skip', floor });

  const groups = new Map<string, Extract<RunFact, { kind: 'status' }>>();
  const gifts = new Set([...Object.keys(a.giftStatus), ...Object.keys(b.giftStatus)].map(Number));
  for (const id of [...gifts].sort((x, y) => x - y)) {
    const from = a.giftStatus[id] ?? null;
    const to = b.giftStatus[id] ?? null;
    if (from === to) continue;
    const key = `${from}>${to}`;
    const group = groups.get(key) ?? { kind: 'status', from, to, ids: [] };
    group.ids.push(id);
    groups.set(key, group);
  }
  out.push(...groups.values());
  if ((a.startDone === true) !== (b.startDone === true))
    out.push({ kind: 'start', done: b.startDone === true });
  return out;
}

/**
 * The gifts and packs a fact is about, as `g{id}` / `p{id}` — what lets the window drop a store
 * fact the screen reader's own entry already said (`recentLines`).
 */
export function factKeys(fact: RunFact): string[] {
  switch (fact.kind) {
    case 'enter':
    case 'leave':
      return [`p${fact.packId}`];
    case 'status':
      return fact.ids.map((id) => `g${id}`);
    case 'start':
      return fact.done ? ['start'] : [];
    default:
      return [];
  }
}

const CAPACITY = 30;

/** A ring of facts the window can subscribe to, like the feedback log. */
export class FactLog {
  private ring = new Ring<FactEntry>(CAPACITY);
  private listeners = new Set<() => void>();
  private changes = 0;
  constructor(private now: () => number = Date.now) {}

  push(facts: readonly RunFact[]): void {
    if (facts.length === 0) return;
    const t = this.now();
    for (const fact of facts) this.ring.push({ t, fact });
    this.changes += 1;
    for (const listener of this.listeners) listener();
  }

  entries(): FactEntry[] {
    return this.ring.toArray();
  }

  get revision(): number {
    return this.changes;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export const overlayFacts = new FactLog();

interface Subscribable<S> {
  subscribe: (fn: (state: S, prev: S) => void) => () => void;
}

/** Wire the facts to the store; returns the undo. `main.tsx` calls it once, before the first render. */
export function installOverlayLog<S extends FactState>(store: Subscribable<S>, log: FactLog = overlayFacts) {
  return store.subscribe((state, prev) => log.push(runFacts(prev, state)));
}
