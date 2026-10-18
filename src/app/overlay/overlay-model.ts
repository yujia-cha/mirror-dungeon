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
 * - **In the shop** (M148) the window shows what a shop decides instead of the next pack: the gifts
 *   only the pack entered last hands out (all of them, whatever the route wants), the tracker's
 *   tier-4 gifts without the 조각 series, and the goals not yet in hand.
 * - **The start candidates** (M138) are what the plan expects the run start to hand over while it
 *   is still open — the start gifts and the observations, pinned or recommended — and what floor 1
 *   already collected (M140). With the screen reader off the player says which ones the game
 *   actually gave (`confirmStart`); while it runs, its record is the answer and it settles the start
 *   itself (M141). Either way the rest is routed again.
 */
import type { GameIndexes, RoutePlan } from '../../core/types.ts';
import type { FeedbackLogEntry } from '../lib/feedback-log.ts';
import { giftDone, observationClosed, type RunState } from '../lib/plan-input.ts';
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
  | { kind: 'pack'; floor: number; packs: NextPackRow[] };

/** A route pack the frontier floor can take: its window covers the floor. */
export interface NextPackRow {
  packId: number;
  /** The plan seated it on this very floor (the stage puts it first). */
  planned: boolean;
  /** Packs off the route that hand over the same gifts on this floor (「외 N」). */
  alternatives: number;
}

/**
 * Every route pack the frontier floor can take, in the stage's order (the one planned there
 * first). A route pack's window often spans floors, so one seated further on may be entered here
 * too — showing only the first left the player guessing when the game offered another (M148).
 */
export function nextPack(
  plan: RoutePlan | null,
  run: Pick<RunState, 'currentFloor'>,
  lastFloor: number,
  indexes: GameIndexes,
): NextPack {
  const floor = run.currentFloor;
  if (floor >= runDoneFloor(lastFloor)) return { kind: 'done' };
  if (!plan) return { kind: 'noPlan', floor };
  const packs = enterablePacks(plan, floor, indexes).map((entry) => ({
    packId: entry.packId,
    planned: entry.recommended,
    alternatives: entry.alternatives.length,
  }));
  if (packs.length === 0) return { kind: 'none', floor };
  return { kind: 'pack', floor, packs };
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

export type StartCandidateKind = 'start' | 'pinned' | 'recommended' | 'got';

export interface StartCandidate {
  giftId: number;
  /**
   * How it came up: a start gift, a pin of the player's, the planner's recommendation — or a gift
   * already marked collected on floor 1 that the plan did not expect (another observation, a boon).
   */
  kind: StartCandidateKind;
}

/** The gifts marked collected on floor 1 so far: what the run start has handed over (M140). */
export function startEvidence(run: Pick<RunState, 'currentFloor' | 'giftStatus'>): number[] {
  if (run.currentFloor !== 1) return [];
  return Object.entries(run.giftStatus)
    .filter(([, status]) => status === 'got')
    .map(([id]) => Number(id));
}

/**
 * The run start, while it is open (`observationClosed` false): the start gifts first, then the
 * observations in the plan's order, then what floor 1 already collected beyond them. Null once the
 * start is closed, without a plan, or when there is nothing to list.
 */
export function startCandidates(
  plan: Pick<RoutePlan, 'start'> | null,
  run: Pick<RunState, 'currentFloor' | 'startDone' | 'giftStatus'>,
): StartCandidate[] | null {
  if (!plan || observationClosed(run)) return null;
  const out: StartCandidate[] = [];
  const seen = new Set<number>();
  const add = (giftId: number, kind: StartCandidateKind): void => {
    if (seen.has(giftId)) return;
    seen.add(giftId);
    out.push({ giftId, kind });
  };
  for (const id of plan.start.startGifts) add(id, 'start');
  for (const o of plan.start.observed) add(o.giftId, o.pinned ? 'pinned' : 'recommended');
  for (const id of startEvidence(run)) add(id, 'got');
  return out.length > 0 ? out : null;
}

/**
 * Which candidates are on (M140). With the screen reader running, what it recorded is the answer —
 * a popup it did not see was not collected — so only the evidence is on; the overlay shows that
 * without toggles and the reader settles it (M141). Without it, the plan's guess: everything on,
 * for the player to correct.
 */
export function startInitiallyOn(
  candidates: readonly StartCandidate[],
  evidence: readonly number[],
  live: boolean,
): Set<number> {
  return new Set(live ? evidence : candidates.map((c) => c.giftId));
}

/** What 「확인하고 진행」 records for the candidates the player left on (`taken`). */
export function startPicks(
  candidates: readonly StartCandidate[],
  taken: ReadonlySet<number>,
): { got: number[]; dropped: number[]; observed: number[] } {
  const isObservation = (c: StartCandidate): boolean => c.kind === 'pinned' || c.kind === 'recommended';
  return {
    got: candidates.filter((c) => taken.has(c.giftId)).map((c) => c.giftId),
    dropped: candidates.filter((c) => !taken.has(c.giftId)).map((c) => c.giftId),
    observed: candidates.filter((c) => isObservation(c) && taken.has(c.giftId)).map((c) => c.giftId),
  };
}

/** What the window lists while the player is in a pack's shop (M148). */
export interface ShopView {
  /** The pack entered last, whose shop this is; null before the first entry. */
  packId: number | null;
  /** Every gift only that pack hands out. */
  exclusive: number[];
  /** The tracker's tier-4 gifts without the 조각 series. */
  t4: number[];
  /** The goals not marked 「획득」, in the order they were picked. */
  goals: number[];
}

export function shopView(
  run: Pick<RunState, 'visits' | 'giftStatus'>,
  exclusivesOf: (packId: number) => number[],
  trackerGroups: readonly { id: string; gifts: readonly { id: number }[] }[],
  wanted: readonly number[],
): ShopView {
  const entry = lastEntry(run);
  return {
    packId: entry?.packId ?? null,
    exclusive: entry ? exclusivesOf(entry.packId) : [],
    t4: trackerGroups
      .filter((group) => group.id !== 'shard')
      .flatMap((group) => group.gifts.map((g) => g.id)),
    goals: wanted.filter((id) => !giftDone(run.giftStatus[id])),
  };
}
