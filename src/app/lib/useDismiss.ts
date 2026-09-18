import { useEffect, useRef, type RefObject } from 'react';

/**
 * Layers that currently listen for a dismissing press or Escape, oldest first.
 *
 * Every listener here is on `document`, and a sheet portals to `document.body` — so without a
 * stack a press inside the sheet reads as "outside" to every layer under it, and one tap closes
 * the whole pile (the phone bug where closing a gift sheet also closed the panel). Only the top
 * layer reacts; the ones below it wait their turn.
 */
const layers: object[] = [];

export interface DismissOptions {
  /**
   * The layer's DOM id, when it has one. A control that carries `aria-controls={id}` already opens
   * and closes this layer by itself; without this, its `pointerdown` dismissed the layer and the
   * `click` right after re-opened it, so the button could never close what it had opened.
   */
  id?: string;
}

/** Close a popover on Escape or on a pointer press outside `ref`, while `active` and topmost. */
export function useDismiss(ref: RefObject<HTMLElement | null>, onDismiss: () => void, active: boolean, options: DismissOptions = {}): void {
  // `onDismiss` is read through a ref rather than depended on: every caller passes an inline
  // closure, so a dependency on it would re-run the effect on each render of the owning tree and
  // push this layer back on top of a sheet that opened above it — the very pile-up the stack is
  // here to prevent.
  const latest = useRef(onDismiss);
  latest.current = onDismiss;
  const token = useRef({});
  const { id } = options;

  useEffect(() => {
    if (!active) return;
    const self = token.current;
    layers.push(self);
    const topmost = (): boolean => layers[layers.length - 1] === self;
    const opener = (target: Element): boolean => {
      if (!id) return false;
      const escaped = typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(id) : id;
      return target.closest(`[aria-controls="${escaped}"]`) !== null;
    };
    const onPointer = (event: PointerEvent): void => {
      if (!topmost()) return;
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      if (ref.current?.contains(target) || opener(target)) return;
      latest.current();
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && topmost()) latest.current();
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      const at = layers.lastIndexOf(self);
      if (at !== -1) layers.splice(at, 1);
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [ref, active, id]);
}

/** Arrow-key stepping over a list of `count` items; returns the next active index or null to keep. */
export function stepIndex(key: string, active: number, count: number): number | null {
  if (count === 0) return null;
  if (key === 'ArrowDown') return (active + 1) % count;
  if (key === 'ArrowUp') return (active - 1 + count) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return null;
}
