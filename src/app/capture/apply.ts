/**
 * What a recognised event does to the run, and how to take it back (M107).
 *
 * The screen reader only says what it saw (`tracker.ts`); this decides the run changes, as data,
 * so the UI can apply them, log them and undo them, and the rules can be tested without a screen:
 *
 * - `enter` → enter the pack on that floor (the floors walked past settle, as on the floor strip).
 *   An entry the run already holds does nothing — every new session reads the map it stands on
 *   again, and a duplicate would carry an undo that deletes the player's own entry (M116).
 * - `got` → mark the gift collected, unless it already is. A 잔영 is held always and never
 *   marked (M152).
 * - `sold` → unmark a collected gift: it is no longer held, and the route may send the player for it
 *   again — which is true. A gift the run does not mark held changes nothing, and neither does a
 *   잔영 material (M151): held in any number, one mark cannot say whether this was the last one —
 *   the rule the fusion has always kept.
 * - `fused` → the ingredients it ate are no longer held (the result itself came as its own `got`).
 *   When the result is a gift the route collects — a goal or a goal's ingredient — they went up
 *   into it: `used`, not lost (M149), so they show as dealt with and no floor settles them as
 *   missed. Otherwise they are unmarked and the route may send the player for them again. The 잔영
 *   materials are held in any number and the run keeps one mark per gift, so a fusion never
 *   touches theirs. For the mixed recipe (달의 기억) whatever needs no reading is settled even when
 *   the screen read nothing, and a recipe result (조합식) takes its ingredients from its recipe
 *   (`recipeConsumed`, M151) — the icons only choose between its recipes, and a held gift the icons
 *   matched that no recipe names is a misread, left alone. Only held gifts change. What stays
 *   unclear is asked, not guessed.
 * - `unsure` → nothing changes; the player is asked to pick. A muddled fusion result carries the
 *   fusion along (M151): the answer records the result and settles what it ate (`answerActions`).
 * - At the run start (M135): a popup's gift from the observation (`got` with source `observation`)
 *   is also pinned as observed — a spent observation on floor 1 (M134) — when the pin is legal
 *   (`recordObserved`); `startDone` settles the start (`settleStart`, M140): what the popups
 *   recorded is what it gave, and a pin on a gift no popup showed comes off. Only a popup records a
 *   gift (M136): nothing is marked from what a picker showed picked.
 *
 * Pure: event and run state in, actions and questions out. `execute` runs them through the run
 * actions it is handed, so the same steps play forward and back in tests against the real store.
 */
import type { Gift } from '../../core/schema.ts';
import { consumedStatus, type GiftStatus, type RunState } from '../lib/plan-input.ts';
import { mixedFusionConsumed, recipeConsumed, type Consumed } from './fusion.ts';
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
  /**
   * The run start closed (M135) and settled (M140). `unpinned` is filled in by `execute`: the pins
   * the settlement took off, which its undo puts back.
   */
  | { kind: 'startDone'; unpinned?: number[] };

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
  /** Which gift did the popup name? `fusing`: it was a fusion's result (M151). */
  | { kind: 'gift'; ids: number[]; fusing?: Consumed }
  | { kind: 'pack'; floor: number; ids: number[] }
  /** Which of these did the fusion eat — tick the ones to unmark (or mark used up, M149). */
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
  /**
   * What the route collects: the goals and their ingredients (`collectedGifts`). A fusion making
   * one of these uses its ingredients up rather than losing them (M149). Omitted = none.
   */
  collected?: ReadonlySet<number>;
  /**
   * Reprint (BokGak) pack → its original (M159, `reprintsOf`). A read never steps an entry down
   * from a reprint to its original: the reprint's logo is never on the original's map header, so a
   * reprint once read or answered stands, and a later read that lost the logo is not news.
   */
  reprints?: ReadonlyMap<number, number>;
}

export interface Applied {
  actions: CaptureAction[];
  ask: CaptureAsk | null;
}

const NONE: Applied = { actions: [], ask: null };

/** A gift's status in the run, or null. */
function statusIn(ctx: ApplyContext, id: number): GiftStatus | null {
  return ctx.giftStatus[id] ?? null;
}

/** The status action that sets `ids` to `to` — those it changes; none when it changes nothing. */
function setStatus(ctx: ApplyContext, ids: readonly number[], to: GiftStatus | null): CaptureAction[] {
  const changes = ids
    .filter((id) => statusIn(ctx, id) !== to)
    .map((id) => ({ giftId: id, from: statusIn(ctx, id), to }));
  return changes.length > 0 ? [{ kind: 'status', changes }] : [];
}

/**
 * The run changes for the player's answer to a question (M151, from `useCapture.answer`). An
 * entry for a pack; 「획득」 for the gift a popup meant — and when that popup was a fusion's result,
 * what the fusion ate, settled as if the name had been read (which may ask once more); for 「합성에
 * 쓴 기프트」 the ticked gifts still held, used up or unmarked like any fusion's ingredients. A gift
 * the player ticked that the run no longer marks held (they changed it meanwhile) is left alone.
 */
export function answerActions(ask: CaptureAsk, picked: readonly number[], ctx: ApplyContext): Applied {
  if (picked.length === 0) return NONE;
  if (ask.kind === 'pack') {
    const entry = enterAction(ask.floor, picked[0]!, ctx);
    return entry ? { actions: [entry], ask: null } : NONE;
  }
  const status = (id: number) => statusIn(ctx, id);
  const change = (ids: readonly number[], to: GiftStatus | null) => setStatus(ctx, ids, to);
  if (ask.kind === 'consumed') {
    const held = picked.filter(
      (id) => status(id) === 'got' && ctx.giftById.get(id)?.acquisition.kind !== 'material',
    );
    return { actions: change(held, consumedStatus(ask.resultId, ctx.collected)), ask: null };
  }
  // A 잔영 is held always and never marked (M152).
  const got = change(
    picked.filter((id) => ctx.giftById.get(id)?.acquisition.kind !== 'material'),
    'got',
  );
  if (!ask.fusing || picked.length !== 1) return { actions: got, ask: null };
  const fused = actionsFor({ kind: 'fused', resultId: picked[0]!, ...ask.fusing }, ctx);
  return { actions: [...got, ...fused.actions], ask: fused.ask };
}

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
  const status = (id: number) => statusIn(ctx, id);
  const isMaterial = (id: number) => ctx.giftById.get(id)?.acquisition.kind === 'material';
  const change = (ids: readonly number[], to: GiftStatus | null) => setStatus(ctx, ids, to);
  switch (event.kind) {
    case 'enter': {
      const entered = ctx.visits[event.floor];
      if (entered !== undefined && ctx.reprints?.get(entered) === event.packId) return NONE;
      const action = enterAction(event.floor, event.packId, ctx);
      return action ? { actions: [action], ask: null } : NONE;
    }
    case 'got': {
      // A 잔영 is held always (M152): the run keeps no mark for it.
      if (isMaterial(event.giftId)) return NONE;
      const observe: CaptureAction[] =
        event.source === 'observation' && !(ctx.observed ?? []).includes(event.giftId)
          ? [{ kind: 'observe', giftId: event.giftId }]
          : [];
      return { actions: [...change([event.giftId], 'got'), ...observe], ask: null };
    }
    case 'place':
      // In or out of the shop (M148): the overlay follows it; the run is untouched.
      return NONE;
    case 'startDone':
      // Past floor 1 the start is long over; nothing to record.
      return ctx.startDone || (ctx.currentFloor ?? 1) > 1
        ? NONE
        : { actions: [{ kind: 'startDone' }], ask: null };
    case 'sold':
      return status(event.giftId) === 'got' && !isMaterial(event.giftId)
        ? { actions: change([event.giftId], null), ask: null }
        : NONE;
    case 'fused': {
      const held = new Set(
        Object.entries(ctx.giftStatus)
          .filter(([, s]) => s === 'got')
          .map(([id]) => Number(id)),
      );
      held.delete(event.resultId);
      // Held in any number: one mark cannot say whether this fusion ate the last one.
      for (const id of [...held]) if (isMaterial(id)) held.delete(id);
      let consumed = event.consumed.filter((id) => held.has(id));
      let unsure = event.unsure.filter((id) => held.has(id) && !consumed.includes(id));
      const fusion = ctx.giftById.get(event.resultId)?.fusion;
      if (fusion?.mixed) {
        // The confirm's five slots may not have been read; the recipe still settles what it can.
        const fallback = mixedFusionConsumed(fusion.mixed, held);
        consumed = [...new Set([...consumed, ...fallback.consumed])];
        unsure = [...new Set([...unsure, ...fallback.unsure])].filter((id) => !consumed.includes(id));
      }
      const byRecipe = fusion
        ? recipeConsumed(fusion.recipes, held, { consumed, unsure, filled: event.filled }, isMaterial)
        : null;
      if (byRecipe) ({ consumed, unsure } = byRecipe);
      return {
        actions: change(
          consumed.sort((a, b) => a - b),
          consumedStatus(event.resultId, ctx.collected),
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
            : event.fusing
              ? { kind: 'gift', ids: event.ids, fusing: event.fusing }
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
    if (action.kind === 'startDone')
      return [
        { kind: 'startOpen' },
        ...(action.unpinned ?? []).map((giftId): CaptureStep => ({ kind: 'observe', giftId })),
      ];
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
  /** Settle and close the run start (`settleStart`); the pins it took off. */
  settleStart(): number[];
  /** Reopen the run start (`markStartDone(false)`). */
  reopenStart(): void;
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
        applied.push({ kind: 'startDone', unpinned: ops.settleStart() });
        break;
      case 'startOpen':
        ops.reopenStart();
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
