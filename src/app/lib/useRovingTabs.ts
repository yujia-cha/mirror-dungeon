import { useCallback, type KeyboardEvent, type RefObject } from 'react';

/**
 * Arrow-key movement inside a `role="tablist"`, as the ARIA tabs pattern requires.
 *
 * Both tab strips in the app — the panel's 덱 / 아이템 and the route panel's alternatives — were
 * plain buttons in a row: every tab took its own Tab stop, and the arrow keys did nothing. The
 * pattern asks for the opposite, and for a reason that is not pedantry: with four alternative
 * routes, tabbing through the strip costs four stops before reaching the route itself, and a
 * screen-reader user who hears "tab, 1 of 5" has no key that moves to 2.
 *
 * So: one Tab stop for the whole strip (the selected tab), and ←/→/Home/End move *and select*.
 * Selection follows focus, which is the right choice here because switching tabs is instant and
 * has no side effect to undo — the ARIA guidance reserves manual activation for tabs that are
 * expensive to open.
 *
 * `tabIndex` is the caller's job: give the selected tab `0` and the rest `-1`.
 */
export function useRovingTabs(
  container: RefObject<HTMLElement | null>,
  count: number,
  index: number,
  onSelect: (next: number) => void,
): (event: KeyboardEvent) => void {
  return useCallback(
    (event: KeyboardEvent) => {
      if (count === 0) return;
      const step =
        event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : event.key === 'Home' ? -Infinity : event.key === 'End' ? Infinity : null;
      if (step === null) return;
      event.preventDefault();
      // Wrapping is what the pattern specifies: from the last tab, → returns to the first.
      const next = step === -Infinity ? 0 : step === Infinity ? count - 1 : (index + step + count) % count;
      onSelect(next);
      // Focus has to follow, or the next arrow press starts from the old tab.
      const tabs = container.current?.querySelectorAll<HTMLElement>('[role="tab"]');
      tabs?.[next]?.focus();
    },
    [container, count, index, onSelect],
  );
}
