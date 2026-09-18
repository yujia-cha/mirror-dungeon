/**
 * Pull a card or panel vertically to commit an action: down to enter a pack or move on, up to go
 * back. Built on pointer events without a library: listeners go on `window` so the gesture
 * survives leaving the element, and only a mostly-vertical move past `start` begins a pull, so a
 * tap stays a click. The element carries `touch-action: none` (`pullStyle`): every touch on it is
 * the gesture's from the first move, never the browser's — with `pan-x` the browser judged the
 * direction first and, on a phone, could take a vertical drag for a scroll and cancel the pull
 * under us. Nothing on the stage scrolls sideways, so no pan is lost. A pull may start on a button
 * (the handles and the card's foot are buttons, and a tap on them still clicks), but never on a
 * link, an input or a `<details>` summary. The pointer is not captured, so a plain click reaches
 * its button; the click a browser fires after a committed pull is swallowed once, since the
 * element moves with the pointer and would otherwise act twice. Releasing past `threshold`
 * commits; short of it the element springs back (the CSS transition is the caller's, applied
 * while `pulling` is false). A direction the caller does not allow moves with resistance and
 * never commits.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';

export type PullDirection = 'down' | 'up';

export interface PullState {
  /** Current vertical offset in px (positive = down); 0 when idle. */
  offset: number;
  /** A pull is in progress (no transition while true). */
  pulling: boolean;
  /** The direction the pull has passed the threshold in, if any. */
  past: PullDirection | null;
}

export interface PullHandlers {
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
}

const NEVER_PULL = 'a, input, select, textarea, summary';

/** Swallow the click the browser fires right after a committed pull (same target under a moved pointer). */
export function swallowNextClick(): void {
  const onClick = (event: MouseEvent): void => {
    event.stopPropagation();
    event.preventDefault();
    window.removeEventListener('click', onClick, true);
    window.clearTimeout(timer);
  };
  // The browser dispatches that click in the same task as the pointerup, so the guard need not outlive it.
  const timer = window.setTimeout(() => window.removeEventListener('click', onClick, true), 0);
  window.addEventListener('click', onClick, true);
}

export function usePullGesture({
  onCommit,
  directions,
  threshold = 72,
  start = 8,
  resistance = 0.3,
}: {
  onCommit: (direction: PullDirection) => void;
  directions: readonly PullDirection[];
  threshold?: number;
  start?: number;
  resistance?: number;
}): PullState & { handlers: PullHandlers } {
  const [state, setState] = useState<PullState>({ offset: 0, pulling: false, past: null });
  const pending = useRef<{ pointerId: number; x: number; y: number; dragging: boolean; past: PullDirection | null } | null>(null);
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;
  const directionsRef = useRef(directions);
  directionsRef.current = directions;

  const finish = useCallback((): void => {
    pending.current = null;
    setState({ offset: 0, pulling: false, past: null });
  }, []);

  useEffect(() => {
    const onMove = (event: PointerEvent): void => {
      const current = pending.current;
      if (!current || event.pointerId !== current.pointerId) return;
      const dx = event.clientX - current.x;
      const dy = event.clientY - current.y;
      if (!current.dragging) {
        if (Math.abs(dy) <= start || Math.abs(dy) < Math.abs(dx)) return;
        current.dragging = true;
      }
      const direction: PullDirection = dy > 0 ? 'down' : 'up';
      const allowed = directionsRef.current.includes(direction);
      const offset = allowed ? dy : dy * resistance;
      const past = allowed && Math.abs(dy) >= threshold ? direction : null;
      current.past = past;
      setState({ offset, pulling: true, past });
    };
    const onUp = (event: PointerEvent): void => {
      const current = pending.current;
      if (!current || event.pointerId !== current.pointerId) return;
      const past = current.dragging ? current.past : null;
      finish();
      if (past) {
        swallowNextClick();
        commitRef.current(past);
      }
    };
    const onCancel = (event: PointerEvent): void => {
      if (pending.current && event.pointerId === pending.current.pointerId) finish();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };
  }, [finish, resistance, start, threshold]);

  const handlers: PullHandlers = {
    onPointerDown: (event) => {
      if (event.button !== 0) return;
      if (event.target instanceof Element && event.target.closest(NEVER_PULL)) return;
      // A release outside the window (a second monitor, another app) never reaches these
      // listeners, so a leftover candidate used to refuse every later press. A fresh press simply
      // replaces it — the abandoned one can no longer commit anything.
      pending.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, dragging: false, past: null };
      setState({ offset: 0, pulling: false, past: null });
    },
  };

  return { ...state, handlers };
}

/** True while the reader has asked for less motion; read live, so a change mid-session is honoured. */
function reduceMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** The transform a pulled element carries, springing back when the pointer lets go short of the threshold. */
export function pullStyle(state: PullState): CSSProperties {
  // The spring-back is an inline style, which outranks the `motion-reduce:transition-none` class
  // on the same element — so the media query has to be read here or it does nothing at all.
  const springBack = reduceMotion() ? 'none' : 'transform 180ms ease-out';
  // No transform at rest: a transformed ancestor would turn a fixed-position sheet inside into an
  // absolutely positioned one.
  if (!state.pulling && state.offset === 0) return { touchAction: 'none', transition: springBack };
  return {
    touchAction: 'none',
    transform: `translateY(${state.offset}px)`,
    transition: state.pulling ? 'none' : springBack,
  };
}
