/**
 * Drag a selected-gift chip onto an observation slot. Pointer events, no library: the chip's
 * pointerdown arms a candidate, a move past `START` px starts the drag (so a tap still clicks the
 * chip's buttons), window listeners follow the pointer and finish it, and the click the browser
 * fires on release is swallowed once. The slot under the pointer is found by hit-testing when the
 * platform offers it (touch pointers are implicitly captured, so enter/leave never reach the
 * slots) and by the slots' own enter/leave callbacks otherwise.
 *
 * **Touch starts on a long press (M54).** The chip keeps `touch-action: pan-y` so a list of chips
 * can still be scrolled by touching one — but that means a finger moving up toward the slots (which
 * sit *above* the chips) is a scroll, and the browser sends `pointercancel` before the 8px start
 * threshold is ever reached. So on touch a still finger held for `LONG_PRESS` ms picks the chip up
 * instead, and while a drag is live a non-passive `touchmove` listener cancels the scroll the
 * browser would otherwise start. A finger that moves first is a scroll, exactly as before.
 */
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useLatest } from './useLatest.ts';
import { swallowNextClick } from './usePullGesture.ts';

const START = 8;
/** How long a still finger holds a chip before it is picked up (touch only). */
export const LONG_PRESS = 300;

export interface ChipDragState {
  /** The gift being dragged, or null. */
  dragging: number | null;
  /** Pointer position for the ghost. */
  x: number;
  y: number;
  /** Index of the slot under the pointer, or null. */
  over: number | null;
}

const IDLE: ChipDragState = { dragging: null, x: 0, y: 0, over: null };

function slotAt(x: number, y: number): number | null | undefined {
  if (typeof document.elementFromPoint !== 'function') return undefined;
  const hit = document.elementFromPoint(x, y);
  const slot = hit && typeof hit.closest === 'function' ? hit.closest('[data-observe-slot]') : null;
  const value = slot?.getAttribute('data-observe-slot');
  return value === undefined || value === null ? null : Number(value);
}

export function useChipDrag(onDrop: (giftId: number, slot: number | null) => void): {
  state: ChipDragState;
  /** Handlers for a chip: spread onto the chip element. */
  handleFor: (giftId: number) => { onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void };
  /** Slots report the pointer entering (index) or leaving (null) them. */
  setOver: (slot: number | null) => void;
} {
  const [state, setState] = useState<ChipDragState>(IDLE);
  const pending = useRef<{ giftId: number; x: number; y: number; pointerId: number; touch: boolean } | null>(
    null,
  );
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const active = useRef<number | null>(null);
  const over = useRef<number | null>(null);
  const latest = useLatest(onDrop);

  const setOver = useCallback((slot: number | null): void => {
    over.current = slot;
    if (active.current !== null)
      setState((current) => (current.over === slot ? current : { ...current, over: slot }));
  }, []);

  useEffect(() => {
    const clearTimer = (): void => {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
    };
    const onMove = (event: PointerEvent): void => {
      // A second finger must not take over a drag the first one started, nor end it on release.
      if (pending.current && event.pointerId !== pending.current.pointerId) return;
      if (pending.current && active.current === null) {
        if (Math.hypot(event.clientX - pending.current.x, event.clientY - pending.current.y) < START) return;
        // A finger that moves before the long press is a scroll: let it go.
        if (pending.current.touch) {
          clearTimer();
          pending.current = null;
          return;
        }
        active.current = pending.current.giftId;
      }
      if (active.current === null) return;
      const found = slotAt(event.clientX, event.clientY);
      if (found !== undefined) over.current = found;
      setState({ dragging: active.current, x: event.clientX, y: event.clientY, over: over.current });
    };
    const finish = (event: PointerEvent): void => {
      if (pending.current && event.pointerId !== pending.current.pointerId) return;
      clearTimer();
      if (active.current !== null) {
        swallowNextClick();
        latest.current(active.current, over.current);
        setState(IDLE);
      }
      pending.current = null;
      active.current = null;
      over.current = null;
    };
    // While a chip is held, the finger belongs to the drag, not to the page's scroll.
    const holdScroll = (event: TouchEvent): void => {
      if (active.current !== null && event.cancelable) event.preventDefault();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    window.addEventListener('touchmove', holdScroll, { passive: false });
    return () => {
      clearTimer();
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      window.removeEventListener('touchmove', holdScroll);
    };
  }, [latest]);

  const handleFor = useCallback(
    (giftId: number) => ({
      onPointerDown: (event: ReactPointerEvent<HTMLElement>): void => {
        if (event.button !== 0) return;
        if ((event.target as HTMLElement).closest('a, input, select, textarea')) return;
        const touch = event.pointerType === 'touch';
        const start = { giftId, x: event.clientX, y: event.clientY, pointerId: event.pointerId, touch };
        pending.current = start;
        if (!touch) return;
        if (timer.current !== null) clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          timer.current = null;
          if (pending.current !== start) return;
          // Picked up where the finger rests; the ghost appears so the hold has an answer.
          active.current = giftId;
          setState({ dragging: giftId, x: start.x, y: start.y, over: null });
        }, LONG_PRESS);
      },
    }),
    [],
  );

  return { state, handleFor, setOver };
}
