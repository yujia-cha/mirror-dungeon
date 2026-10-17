/**
 * What the overlay window (M132) shows, derived from the run, the plan and the logs. Pure, so the
 * four sections can be checked without a second window.
 *
 * - **The last entered pack** is the entry on the highest floor of `run.visits`. The player in the
 *   game only moves forward, so that is the pack they are in (or just left), whatever floor the
 *   stage happens to be looking back at — the floor strip lets the player look at history, and the
 *   overlay must not follow that look.
 * - **The gifts left in it** are what the route expects of that entry (`expectedIn` — the same list
 *   the stage settles on leaving) still unrecorded. A gift marked 「획득」 is in hand; one marked
 *   「미획득」 is not left either: only leaving the floor writes it, so the pack is behind the player
 *   and the planner already routes the gift elsewhere (or has given it up). Counting it as left
 *   would tell the player to look for it in a pack they cannot go back to.
 * - **The next pack** is the route pack the stage would put first on the frontier
 *   (`run.currentFloor`), the floor the player decides next.
 */
import type { GameIndexes, RoutePlan } from '../../core/types.ts';
import type { FeedbackLogEntry } from '../lib/feedback-log.ts';
import type { RunState } from '../lib/plan-input.ts';
import { enterablePacks } from '../lib/stage.ts';
import { runDoneFloor } from '../store.ts';

export interface LastEntry {
  floor: number;
  packId: number;
}

/** The entry on the highest floor, or null before the first entry. */
export function lastEntry(run: Pick<RunState, 'visits'>): LastEntry | null {
  let best: LastEntry | null = null;
  for (const [key, packId] of Object.entries(run.visits)) {
    const floor = Number(key);
    if (!best || floor > best.floor) best = { floor, packId };
  }
  return best;
}

export interface Remaining extends LastEntry {
  /** What the route expects of the entry, by id. */
  expected: number[];
  /** Of those, the ones neither collected nor missed yet. */
  remaining: number[];
}

/** The last entry and what is still to collect there; null before the first entry. */
export function remainingIn(
  run: Pick<RunState, 'visits' | 'giftStatus'>,
  expectedIn: (floor: number, packId: number) => number[],
): Remaining | null {
  const entry = lastEntry(run);
  if (!entry) return null;
  const expected = expectedIn(entry.floor, entry.packId);
  return { ...entry, expected, remaining: expected.filter((id) => run.giftStatus[id] === undefined) };
}

export type NextPack =
  /** The run is over: the frontier stands past the season's last floor. */
  | { kind: 'done' }
  /** No goals, so no plan to take a pack from. */
  | { kind: 'noPlan'; floor: number }
  /** The plan seats no pack on the frontier (a floor it passes). */
  | { kind: 'none'; floor: number }
  | { kind: 'pack'; floor: number; packId: number; alternatives: number };

/** The route pack for the frontier floor, as the stage orders them (the one planned there first). */
export function nextPack(
  plan: RoutePlan | null,
  run: Pick<RunState, 'currentFloor'>,
  lastFloor: number,
  indexes: GameIndexes,
): NextPack {
  const floor = run.currentFloor;
  if (floor >= runDoneFloor(lastFloor)) return { kind: 'done' };
  if (!plan) return { kind: 'noPlan', floor };
  const first = enterablePacks(plan, floor, indexes)[0];
  if (!first) return { kind: 'none', floor };
  return { kind: 'pack', floor, packId: first.packId, alternatives: first.alternatives.length };
}

/** One line of 「방금 한 행동」. */
export interface RecentLine {
  /** When it happened (ms since the epoch). */
  at: number;
  kind: 'action' | 'error' | 'capture';
  /** For `action` / `error` the log's own text; for `capture` the caller's words for the entry. */
  text: string;
  /** A screen reader entry the player took back. */
  undone?: boolean;
  /** A stable key for the list. */
  key: string;
}

/** The fields of a screen reader log entry this needs (`CaptureLogEntry` carries more). */
export interface CaptureLine {
  id: number;
  at: number;
  undone: boolean;
}

/**
 * The newest `limit` lines of both logs, newest first: the store changes and errors the feedback
 * log holds (`lib/feedback-log.ts`) and the screen reader's entries. A tie keeps the reader's entry
 * on top — it is the cause of the store change logged in the same millisecond.
 */
export function recentLines<C extends CaptureLine>(
  feedback: readonly FeedbackLogEntry[],
  capture: readonly C[],
  captureText: (entry: C) => string,
  limit = 5,
): RecentLine[] {
  const lines: RecentLine[] = [
    ...feedback.map((entry, i): RecentLine => ({
      at: entry.t,
      kind: entry.kind,
      text: entry.kind === 'error' ? entry.message : entry.text,
      key: `f${entry.t}-${i}`,
    })),
    ...capture.map((entry): RecentLine => ({
      at: entry.at,
      kind: 'capture',
      text: captureText(entry),
      undone: entry.undone,
      key: `c${entry.id}`,
    })),
  ];
  const rank = (line: RecentLine) => (line.kind === 'capture' ? 1 : 0);
  return lines
    .map((line, order) => ({ line, order }))
    .sort((a, b) => b.line.at - a.line.at || rank(b.line) - rank(a.line) || b.order - a.order)
    .slice(0, limit)
    .map(({ line }) => line);
}

/** 「14:03:07」 in the viewer's local time. */
export function clockOf(at: number): string {
  const date = new Date(at);
  return [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');
}
