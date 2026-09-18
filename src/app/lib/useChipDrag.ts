/**
 * Drag a selected-gift chip onto an observation slot. Pointer events, no library: the chip's
 * pointerdown arms a candidate, a move past `START` px starts the drag (so a tap still clicks the
 * chip's buttons), window listeners follow the pointer and finish it, and the click the browser
 * fires on release is swallowed once. The slot under the pointer is found by hit-testing when the
 * platform offers it (touch pointers are implicitly captured, so enter/leave never reach the
 * slots) and by the slots' own enter/leave callbacks otherwise.
 */
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { swallowNextClick } from './usePullGesture.ts';

const START = 8;

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
  const pending = useRef<{ giftId: number; x: number; y: number; pointerId: number } | null>(null);
  const active = useRef<number | null>(null);
  const over = useRef<number | null>(null);
  const latest = useRef(onDrop);
  latest.current = onDrop;

  const setOver = useCallback((slot: number | null): void => {
    over.current = slot;
    if (active.current !== null) setState((current) => (current.over === slot ? current : { ...current, over: slot }));
  }, []);

  useEffect(() => {
    const onMove = (event: PointerEvent): void => {
      // A second finger must not take over a drag the first one started, nor end it on release.
      if (pending.current && event.pointerId !== pending.current.pointerId) return;
      if (pending.current && active.current === null) {
        if (Math.hypot(event.clientX - pending.current.x, event.clientY - pending.current.y) < START) return;
        active.current = pending.current.giftId;
      }
      if (active.current === null) return;
      const found = slotAt(event.clientX, event.clientY);
      if (found !== undefined) over.current = found;
      setState({ dragging: active.current, x: event.clientX, y: event.clientY, over: over.current });
    };
    const finish = (event: PointerEvent): void => {
      if (pending.current && event.pointerId !== pending.current.pointerId) return;
      if (active.current !== null) {
        swallowNextClick();
        latest.current(active.current, over.current);
        setState(IDLE);
      }
      pending.current = null;
      active.current = null;
      over.current = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
    };
  }, []);

  const handleFor = useCallback(
    (giftId: number) => ({
      onPointerDown: (event: ReactPointerEvent<HTMLElement>): void => {
        if (event.button !== 0) return;
        if ((event.target as HTMLElement).closest('a, input, select, textarea')) return;
        pending.current = { giftId, x: event.clientX, y: event.clientY, pointerId: event.pointerId };
      },
    }),
    [],
  );

  return { state, handleFor, setOver };
}
