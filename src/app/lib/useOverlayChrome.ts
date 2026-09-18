/**
 * What every modal surface owes the page while it is open: the background stops scrolling, focus
 * moves into the surface, stays inside it while it is open, and goes back to whatever opened it
 * when it closes.
 *
 * Without the return part a sheet closed with Escape left focus on `<body>`, so the next Tab
 * restarted at the top of the document instead of returning to the tile that was pressed. Without
 * the scroll lock, a flick on the dimmed backdrop scrolled the run stage underneath. Without the
 * containment, Tab walked straight out of a surface that had told assistive tech the rest of the
 * page was not there (`aria-modal="true"`) — the sheets are portalled to `document.body`, so
 * everything behind them is a sibling and perfectly tabbable.
 */
import { useEffect, type RefObject } from 'react';

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The surface's focusable children, in tab order.
 *
 * No visibility filter: `offsetParent` is the obvious one and it is wrong twice over — it is null
 * for a `position: fixed` element, which every sheet is, and jsdom reports null for everything
 * because it does no layout. The selector already excludes what is disabled or taken out of the
 * tab order, and these surfaces do not hide focusable children; `checkVisibility` could refine
 * this once jsdom implements it.
 */
function focusableIn(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)];
}

/** How many modal surfaces are holding the background still; the last one out unlocks it. */
let locks = 0;

/**
 * The open surfaces, innermost last. Only the top one traps Tab: a gift sheet opened from a pack
 * sheet would otherwise have both of them pulling focus in opposite directions.
 */
const stack: HTMLElement[] = [];

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
    const surface = ref.current;
    focusableIn(surface ?? document.body)[0]?.focus();
    if (surface) stack.push(surface);

    /**
     * Wrap Tab at the two ends instead of letting it leave.
     *
     * This has to listen on the surface, not on `document`: `DetailSurface` stops propagation on
     * its own key handler (see the note there about Escape), which stops the native event too, so
     * a document listener never sees a key pressed inside the sheet.
     */
    const onSurfaceKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab' || !surface || stack[stack.length - 1] !== surface) return;
      const items = focusableIn(surface);
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const at = document.activeElement;
      if (event.shiftKey ? at === first : at === last) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    };

    /**
     * The other half: focus that is already outside (a press on the backdrop leaves it on `body`,
     * and Tab from there walks the page behind the sheet). Those keys do reach `document`.
     */
    const onDocumentKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab' || !surface || stack[stack.length - 1] !== surface) return;
      if (surface.contains(document.activeElement)) return;
      const items = focusableIn(surface);
      if (items.length === 0) return;
      event.preventDefault();
      (event.shiftKey ? items[items.length - 1]! : items[0]!).focus();
    };

    surface?.addEventListener('keydown', onSurfaceKeyDown);
    document.addEventListener('keydown', onDocumentKeyDown);

    return () => {
      surface?.removeEventListener('keydown', onSurfaceKeyDown);
      document.removeEventListener('keydown', onDocumentKeyDown);
      const at = stack.lastIndexOf(surface as HTMLElement);
      if (at !== -1) stack.splice(at, 1);
      unlock();
      // Only take focus back if it is still adrift in the surface that is going away; a close that
      // moved focus somewhere deliberate (a newly opened sheet) keeps it.
      const now = document.activeElement;
      if (opener instanceof HTMLElement && opener.isConnected && (now === null || now === document.body))
        opener.focus();
    };
  }, [ref, active]);
}
