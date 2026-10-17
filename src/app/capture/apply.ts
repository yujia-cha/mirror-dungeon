/**
 * What a recognised event does to the run, and how to take it back (M107).
 *
 * The screen reader only says what it saw (`tracker.ts`); this decides the run changes, as data,
 * so the UI can apply them, log them and undo them, and the rules can be tested without a screen:
 *
 * - `enter` → enter the pack on that floor (the floors walked past settle, as on the floor strip).
 *   An entry the run already holds does nothing — every new session reads the map it stands on
 *   again, and a duplicate would carry an undo that deletes the player's own entry (M116).
 * - `got` → mark the gift collected, unless it already is.
 * - `sold` → unmark a collected gift: it is no longer held, and the route may send the player for it
 *   again — which is true.
 * - `fused` → unmark the ingredients it ate (the result itself came as its own `got`). For the mixed
 *   recipe (달의 기억) whatever needs no reading is settled even when the screen read nothing.
 *   What stays unclear is asked, not guessed.
 * - `unsure` → nothing changes; the player is asked to pick.
 * - At the run start (M135): a popup's gift from the observation (`got` with source `observation`)
 *   is also pinned as observed — a spent observation on floor 1 (M134) — when the pin is legal
 *   (`recordObserved`); `startDone` closes the start (`markStartDone`). Only a popup records a
 *   gift (M136): nothing is marked from what a picker showed picked.
 *
 * Pure: event and run state in, actions and questions out. `execute` runs them through the run
 * actions it is handed, so the same steps play forward and back in tests against the real store.
 */
import type { Gift } from '../../core/schema.ts';
import type { GiftStatus, RunState } from '../lib/plan-input.ts';
import { mixedFusionConsumed } from './fusion.ts';
import type { CaptureEvent } from './tracker.ts';

export interface StatusChange {
  giftId: number;
  from: GiftStatus | null;
  to: GiftStatus | null;
}

/**
 * An entry, with what taking it back needs (M116): the pack it replaced on its floor, the floor the
 * same pack stood on before (an entry moves it), the stage floor it walked from, and the statuses
 * the walk changed — the misses settled on the floors walked past and the run start on leaving
 * floor 1. `changes` is filled by `execute`, which sees the run before and after.
 */
export interface EnterAction {
  kind: 'enter';
  floor: number;
  packId: number;
  replaced: number | null;
  movedFrom: number | null;
  stageFrom: number;
  changes: StatusChange[];
}

export type CaptureAction =
  | EnterAction
  | { kind: 'status'; changes: StatusChange[] }
  /** A gift pinned as observed (M135). Kept only when the store took the pin. */
  | { kind: 'observe'; giftId: number }
  /** The run start closed (M135). */
  | { kind: 'startDone' };

/**
 * A step that takes an action back. `revisit` re-enters a pack without settling anything (it was
 * settled when first entered); `rewind` walks the stage back to where an entry found it and
 * restores the statuses the walk changed — but only while the stage still stands on the entry's
 * floor: a player who moved on keeps the floors they settled since, and only the entry goes.
 */
export type CaptureStep =
  | CaptureAction
  | { kind: 'leave'; packId: number }
  | { kind: 'revisit'; floor: number; packId: number }
  | { kind: 'rewind'; from: number; to: number; changes: StatusChange[] }
  | { kind: 'unobserve'; giftId: number }
  | { kind: 'startOpen' };

/** A question for the player: which of these did the screen mean? */
export type CaptureAsk =
  | { kind: 'gift'; ids: number[] }
  | { kind: 'pack'; floor: number; ids: number[] }
  /** Which of these did the fusion eat — tick the ones to unmark. */
  | { kind: 'consumed'; resultId: number; ids: number[] };

export interface ApplyContext {
  giftStatus: Readonly<Record<number, GiftStatus>>;
  giftById: ReadonlyMap<number, Gift>;
  /** The run's entries, floor → pack. */
  visits: Readonly<Record<number, number>>;
  stageFloor: number;
  /** The run's observation pins, the start's state and frontier (M135). Omitted = none, open, 1. */
  observed?: readonly number[];
  startDone?: boolean;
  currentFloor?: number;
}

export interface Applied {
  actions: CaptureAction[];
  ask: CaptureAsk | null;
}

const NONE: Applied = { actions: [], ask: null };

/** The entry action for `packId` on `floor` in this run; null when the run already holds it. */
export function enterAction(
  floor: number,
  packId: number,
  ctx: Pick<ApplyContext, 'visits' | 'stageFloor'>,
): EnterAction | null {
  const replaced = ctx.visits[floor] ?? null;
  if (replaced === packId) return null;
  const moved = Object.entries(ctx.visits).find(([, id]) => id === packId);
  return {
    kind: 'enter',
    floor,
    packId,
    replaced,
    movedFrom: moved ? Number(moved[0]) : null,
    stageFrom: ctx.stageFloor,
    changes: [],
  };
}

/** The run changes for one event. Nothing to do yields no actions (the log skips it). */
export function actionsFor(event: CaptureEvent, ctx: ApplyContext): Applied {
  const status = (id: number): GiftStatus | null => ctx.giftStatus[id] ?? null;
  const change = (ids: readonly number[], to: GiftStatus | null): CaptureAction[] => {
    const changes = ids.filter((id) => status(id) !== to).map((id) => ({ giftId: id, from: status(id), to }));
    return changes.length > 0 ? [{ kind: 'status', changes }] : [];
  };
  switch (event.kind) {
    case 'enter': {
      const action = enterAction(event.floor, event.packId, ctx);
      return action ? { actions: [action], ask: null } : NONE;
    }
    case 'got': {
      const observe: CaptureAction[] =
        event.source === 'observation' && !(ctx.observed ?? []).includes(event.giftId)
          ? [{ kind: 'observe', giftId: event.giftId }]
          : [];
      return { actions: [...change([event.giftId], 'got'), ...observe], ask: null };
    }
    case 'startDone':
      // Past floor 1 the start is long over; nothing to record.
      return ctx.startDone || (ctx.currentFloor ?? 1) > 1
        ? NONE
        : { actions: [{ kind: 'startDone' }], ask: null };
    case 'sold':
      return status(event.giftId) === 'got' ? { actions: change([event.giftId], null), ask: null } : NONE;
    case 'fused': {
      const held = new Set(
        Object.entries(ctx.giftStatus)
          .filter(([, s]) => s === 'got')
          .map(([id]) => Number(id)),
      );
      held.delete(event.resultId);
      let consumed = event.consumed.filter((id) => held.has(id));
      let unsure = event.unsure.filter((id) => held.has(id) && !consumed.includes(id));
      const mixed = ctx.giftById.get(event.resultId)?.fusion?.mixed;
      if (mixed) {
        // The confirm's five slots may not have been read; the recipe still settles what it can.
        const fallback = mixedFusionConsumed(mixed, held, null);
        consumed = [...new Set([...consumed, ...fallback.consumed])];
        unsure = [...new Set([...unsure, ...fallback.unsure])].filter((id) => !consumed.includes(id));
      }
      return {
        actions: change(
          consumed.sort((a, b) => a - b),
          null,
        ),
        ask:
          unsure.length > 0
            ? { kind: 'consumed', resultId: event.resultId, ids: unsure.sort((a, b) => a - b) }
            : null,
      };
    }
    case 'unsure':
      return {
        actions: [],
        ask:
          event.about === 'enter'
            ? { kind: 'pack', floor: event.floor, ids: event.ids }
            : { kind: 'gift', ids: event.ids },
      };
  }
}

/** Every gift whose status differs between two runs, by id. */
export function statusDiff(
  before: Readonly<Record<number, GiftStatus>>,
  after: Readonly<Record<number, GiftStatus>>,
): StatusChange[] {
  const ids = new Set([...Object.keys(before), ...Object.keys(after)].map(Number));
  return [...ids]
    .sort((a, b) => a - b)
    .flatMap((giftId) => {
      const from = before[giftId] ?? null;
      const to = after[giftId] ?? null;
      return from === to ? [] : [{ giftId, from, to }];
    });
}

const swap = (changes: readonly StatusChange[]): StatusChange[] =>
  changes.map((c) => ({ giftId: c.giftId, from: c.to, to: c.from }));

/**
 * The steps that take `actions` back, in reverse order. An entry goes by leaving the pack, putting
 * back what it displaced, and rewinding the walk that led to it.
 */
export function inverseOf(actions: readonly CaptureAction[]): CaptureStep[] {
  return [...actions].reverse().flatMap((action): CaptureStep[] => {
    if (action.kind === 'status') return [{ kind: 'status', changes: swap(action.changes) }];
    if (action.kind === 'observe') return [{ kind: 'unobserve', giftId: action.giftId }];
    if (action.kind === 'startDone') return [{ kind: 'startOpen' }];
    const steps: CaptureStep[] = [{ kind: 'leave', packId: action.packId }];
    if (action.movedFrom !== null)
      steps.push({ kind: 'revisit', floor: action.movedFrom, packId: action.packId });
    if (action.replaced !== null)
      steps.push({ kind: 'revisit', floor: action.floor, packId: action.replaced });
    steps.push({ kind: 'rewind', from: action.floor, to: action.stageFrom, changes: swap(action.changes) });
    return steps;
  });
}

/** The run actions `execute` plays steps through: the plan's for an entry, the store's otherwise. */
export interface RunOps {
  run(): RunState;
  /** Enter wherever the stage stands, settling the floors walked past (`PlanContext.enterAt`). */
  enterAt(floor: number, packId: number): void;
  /** Take an entry back and clear what it answered for (`PlanContext.leave`). */
  leave(packId: number): void;
  /** Record an entry without settling anything. */
  visit(floor: number, packId: number): void;
  /** Show a floor without settling anything. */
  setStageFloor(floor: number): void;
  setGiftStatus(giftId: number, status: GiftStatus | null): void;
  /** Pin a gift as observed under the store's rules (`recordObserved`); whether it was pinned. */
  observe(giftId: number): boolean;
  unobserve(giftId: number): void;
  /** Close or reopen the run start (`markStartDone`). */
  setStartDone(done: boolean): void;
}

/**
 * Play `steps` on the run. Returns the actions as applied: an entry comes back with the statuses
 * its walk changed, which its undo restores.
 */
export function execute(steps: readonly CaptureStep[], ops: RunOps): CaptureAction[] {
  const applied: CaptureAction[] = [];
  for (const step of steps) {
    switch (step.kind) {
      case 'enter': {
        const before = ops.run().giftStatus;
        ops.enterAt(step.floor, step.packId);
        applied.push({ ...step, changes: statusDiff(before, ops.run().giftStatus) });
        break;
      }
      case 'status':
        for (const change of step.changes) ops.setGiftStatus(change.giftId, change.to);
        applied.push(step);
        break;
      case 'observe':
        if (ops.observe(step.giftId)) applied.push(step);
        break;
      case 'unobserve':
        ops.unobserve(step.giftId);
        break;
      case 'startDone':
        ops.setStartDone(true);
        applied.push(step);
        break;
      case 'startOpen':
        ops.setStartDone(false);
        break;
      case 'leave':
        ops.leave(step.packId);
        break;
      case 'revisit':
        ops.visit(step.floor, step.packId);
        break;
      case 'rewind': {
        if (ops.run().stageFloor !== step.from) break;
        // One floor at a time: stepping back onto a skip right before the frontier takes it back,
        // so each skip the walk made is undone in turn.
        if (step.to < step.from) for (let f = step.from - 1; f >= step.to; f -= 1) ops.setStageFloor(f);
        else if (step.to > step.from) ops.setStageFloor(step.to);
        for (const change of step.changes) ops.setGiftStatus(change.giftId, change.to);
        break;
      }
    }
  }
  return applied;
}
