/**
 * What every modal surface owes the page while it is open: the background stops scrolling, focus
 * moves into the surface, and focus goes back to whatever opened it when it closes.
 *
 * Without the last part a sheet closed with Escape left focus on `<body>`, so the next Tab
 * restarted at the top of the document instead of returning to the tile that was pressed. Without
 * the first, a flick on the dimmed backdrop scrolled the run stage underneath.
 */
import { useEffect, type RefObject } from 'react';

/** How many modal surfaces are holding the background still; the last one out unlocks it. */
let locks = 0;

function lockScroll(): () => void {
  const { style } = document.body;
  if (locks === 0) {
    style.setProperty('--overlay-locked-overflow', style.overflow);
    style.overflow = 'hidden';
  }
  locks += 1;
  return () => {
    locks -= 1;
    if (locks > 0) return;
    style.overflow = style.getPropertyValue('--overlay-locked-overflow');
    style.removeProperty('--overlay-locked-overflow');
  };
}

export function useOverlayChrome(ref: RefObject<HTMLElement | null>, active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const opener = document.activeElement;
    const unlock = lockScroll();
    ref.current?.querySelector<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')?.focus();
    return () => {
      unlock();
      // Only take focus back if it is still adrift in the surface that is going away; a close that
      // moved focus somewhere deliberate (a newly opened sheet) keeps it.
      const now = document.activeElement;
      if (opener instanceof HTMLElement && opener.isConnected && (now === null || now === document.body)) opener.focus();
    };
  }, [ref, active]);
}
