/**
 * Hold a pressable element for `ms` to trigger a second action without giving up its click: a
 * short press still clicks, a hold fires `onLongPress` once and the click the browser sends on
 * release is consumed by the caller through `consume()`. Built on pointer events so mouse, pen and
 * touch behave the same; moving off the element, moving the pointer more than `MOVE` px, or
 * cancelling the pointer abandons the hold.
 *
 * The move threshold matters where a hold and a pull share an element: a gift tile inside a pack
 * area follows the finger one-to-one, so the pointer never leaves it, and a slow drag used to open
 * the gift's details at one second and *then* commit the pull — leaving a sheet open for a floor
 * the run had already left.
 */
import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { useLatest } from './useLatest.ts';

/** How far the pointer may drift and still count as a hold; the gestures start moving at 8px. */
const MOVE = 8;

export interface LongPressHandlers {
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: () => void;
  onPointerLeave: () => void;
  onPointerCancel: () => void;
}

export function useLongPress(onLongPress: (() => void) | undefined, ms = 1000): { handlers: LongPressHandlers | Record<string, never>; consume: () => boolean } {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fired = useRef(false);
  const from = useRef<{ x: number; y: number } | null>(null);
  const latest = useLatest(onLongPress);

  const clear = useCallback((): void => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    from.current = null;
  }, []);
  useEffect(() => clear, [clear]);

  // On `window`, because the element may be moving with the pointer: a gesture that carries the
  // tile along never fires `pointerleave`.
  useEffect(() => {
    const onMove = (event: PointerEvent): void => {
      const start = from.current;
      if (!start) return;
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > MOVE) clear();
    };
    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, [clear]);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>): void => {
      // Only the primary button holds; a right press has its own path (the context menu).
      if (event.button !== 0) return;
      clear();
      from.current = { x: event.clientX, y: event.clientY };
      fired.current = false;
      timer.current = setTimeout(() => {
        timer.current = null;
        fired.current = true;
        latest.current?.();
      }, ms);
    },
    [clear, ms, latest],
  );

  /** True once, right after a hold fired: the click that follows must not act. */
  const consume = useCallback((): boolean => {
    const was = fired.current;
    fired.current = false;
    return was;
  }, []);

  if (!onLongPress) return { handlers: {}, consume };
  return { handlers: { onPointerDown, onPointerUp: clear, onPointerLeave: clear, onPointerCancel: clear }, consume };
}
