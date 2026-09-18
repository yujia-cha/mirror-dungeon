/**
 * A ref that always holds the newest value, for listeners that must stay stable.
 *
 * The gesture and dismissal hooks attach their listeners once and must not re-attach them every
 * time a parent re-renders with a fresh callback — re-attaching mid-gesture drops the gesture, and
 * for `useDismiss` it also pushes the layer back to the top of the stack. So the listener reads
 * the callback out of a ref instead of closing over it.
 *
 * The assignment lives in an effect rather than in the render body. Writing a ref during render is
 * a render side-effect: React may render without committing (StrictMode's double render, a
 * discarded concurrent attempt), which would publish a value from a render that never happened.
 * `react-hooks/refs` flags it for that reason.
 *
 * Safe for the listeners here because the initial `useRef(value)` is already correct for the first
 * commit, and this effect is declared before the ones that attach listeners, so it has run by the
 * time any event can fire.
 */
import { useEffect, useRef, type RefObject } from 'react';

export function useLatest<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}
