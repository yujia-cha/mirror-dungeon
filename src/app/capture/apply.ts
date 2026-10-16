/**
 * What a recognised event does to the run, and how to take it back (M107).
 *
 * The screen reader only says what it saw (`tracker.ts`); this decides the run changes, as data,
 * so the UI can apply them, log them and undo them, and the rules can be tested without a screen:
 *
 * - `enter` → enter the pack on that floor (the floors walked past settle, as on the floor strip).
 * - `got` → mark the gift collected, unless it already is.
 * - `sold` → unmark a collected gift: it is no longer held, and the route may send the player for it
 *   again — which is true.
 * - `fused` → unmark the ingredients it ate (the result itself came as its own `got`). For the mixed
 *   recipe (달의 기억) whatever needs no reading is settled even when the screen read nothing.
 *   What stays unclear is asked, not guessed.
 * - `unsure` → nothing changes; the player is asked to pick.
 *
 * Pure: event and run state in, actions and questions out.
 */
import type { Gift } from '../../core/schema.ts';
import type { GiftStatus } from '../lib/plan-input.ts';
import { mixedFusionConsumed } from './fusion.ts';
import type { CaptureEvent } from './tracker.ts';

export interface StatusChange {
  giftId: number;
  from: GiftStatus | null;
  to: GiftStatus | null;
}

export type CaptureAction =
  { kind: 'enter'; floor: number; packId: number } | { kind: 'status'; changes: StatusChange[] };

/** A question for the player: which of these did the screen mean? */
export type CaptureAsk =
  | { kind: 'gift'; ids: number[] }
  | { kind: 'pack'; floor: number; ids: number[] }
  /** Which of these did the fusion eat — tick the ones to unmark. */
  | { kind: 'consumed'; resultId: number; ids: number[] };

export interface ApplyContext {
  giftStatus: Readonly<Record<number, GiftStatus>>;
  giftById: ReadonlyMap<number, Gift>;
}

export interface Applied {
  actions: CaptureAction[];
  ask: CaptureAsk | null;
}

const NONE: Applied = { actions: [], ask: null };

/** The run changes for one event. Nothing to do yields no actions (the log skips it). */
export function actionsFor(event: CaptureEvent, ctx: ApplyContext): Applied {
  const status = (id: number): GiftStatus | null => ctx.giftStatus[id] ?? null;
  const change = (ids: readonly number[], to: GiftStatus | null): CaptureAction[] => {
    const changes = ids.filter((id) => status(id) !== to).map((id) => ({ giftId: id, from: status(id), to }));
    return changes.length > 0 ? [{ kind: 'status', changes }] : [];
  };
  switch (event.kind) {
    case 'enter':
      return { actions: [{ kind: 'enter', floor: event.floor, packId: event.packId }], ask: null };
    case 'got':
      return { actions: change([event.giftId], 'got'), ask: null };
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

/** The actions that take `actions` back, in reverse order. An entry is taken back by leaving the pack. */
export function inverseOf(
  actions: readonly CaptureAction[],
): (CaptureAction | { kind: 'leave'; packId: number })[] {
  return [...actions].reverse().map((action) =>
    action.kind === 'enter'
      ? { kind: 'leave' as const, packId: action.packId }
      : {
          kind: 'status' as const,
          changes: action.changes.map((c) => ({ giftId: c.giftId, from: c.to, to: c.from })),
        },
  );
}
