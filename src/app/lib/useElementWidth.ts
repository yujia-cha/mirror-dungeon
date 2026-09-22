import { useLayoutEffect, useState, type RefObject } from 'react';

/**
 * Measurements — the one kind of state an effect legitimately owns.
 *
 * Everything else that used to write state from an effect in this app has been moved into render
 * (see `docs/review/M48.md`), but a box's size is only knowable *after* layout, so there is no
 * render-time answer to derive. `useLayoutEffect` is React's own prescription here.
 *
 * Note for anyone reading the lint config: `react-hooks/set-state-in-effect` does not flag these,
 * because the setter is reached through a local function rather than called directly. That is a
 * limitation of the rule, not the reason this code is shaped this way — the shape comes from
 * needing to re-measure from the same code path as the first measurement.
 */

/** The element's current content width, kept up to date on resize; `fallback` before layout. */
export function useElementWidth(ref: RefObject<HTMLElement | null>, fallback: number): number {
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = (): void => {
      const next = Math.round(element.getBoundingClientRect().width);
      if (next > 0) setWidth(next);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

/**
 * Heights of a set of elements, keyed however the caller keys them, re-measured when `deps` change.
 *
 * Returns the previous object when nothing moved, so a consumer can use it as a dependency without
 * re-rendering on every measurement pass.
 */
export function useMeasuredHeights(
  elements: RefObject<Map<string, HTMLElement>>,
  deps: readonly unknown[],
): Record<string, number> {
  const [heights, setHeights] = useState<Record<string, number>>({});
  useLayoutEffect(() => {
    const measure = (): void => {
      const next: Record<string, number> = {};
      for (const [key, element] of elements.current ?? []) {
        const height = Math.round(element.getBoundingClientRect().height);
        if (height > 0) next[key] = height;
      }
      setHeights((previous) => {
        const keys = Object.keys(next);
        const same =
          keys.length === Object.keys(previous).length && keys.every((key) => previous[key] === next[key]);
        return same ? previous : next;
      });
    };
    measure();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the caller states what invalidates a measurement
  }, deps);
  return heights;
}
