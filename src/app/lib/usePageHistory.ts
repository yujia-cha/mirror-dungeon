import { useEffect, useRef, type RefObject } from 'react';
import { useLatest } from './useLatest.ts';

interface Layer {
  /** The owning hook's token, cleared from here when a back gesture consumes the entry. */
  owner: RefObject<symbol | null>;
  close: () => void;
}

/** Layers that currently own a history entry, oldest first. Only the topmost one answers a back. */
const owners: Layer[] = [];

/**
 * How many `history.back()` calls this module made itself and has not yet seen come back.
 *
 * `back()` is asynchronous, so a layer that closes itself and is replaced in the same tick (the
 * phone's panel toggle does exactly that: close the left page, open the right one) would have the
 * new layer eat the old one's `popstate`. Each self-inflicted pop is counted here and swallowed.
 */
let pendingSelfPops = 0;

/**
 * One listener for every layer, installed once.
 *
 * It cannot live inside the hook: a layer that unmounts while open hands its entry back, and if
 * the listener went away with the component nothing would be left to swallow that pop and the
 * count would drift for good.
 */
if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    if (pendingSelfPops > 0) {
      pendingSelfPops -= 1;
      return;
    }
    const layer = owners.pop();
    if (!layer) return;
    // Clear the owner first: the entry is gone, so the layer must not hand it back a second time
    // when its own state catches up and the effect tears down.
    layer.owner.current = null;
    layer.close();
  });
}

function giveBack(): void {
  pendingSelfPops += 1;
  window.history.back();
}

/**
 * Bind an open layer to one history entry, so the phone's back gesture closes it instead of
 * leaving the app. Layers stack: with a sheet over a panel page, one back closes the sheet and the
 * next one the page.
 *
 * `pushState` is called with an empty URL, which keeps the address exactly as it is: the share
 * link lives in the hash (`#s=`, consumed once on load in `App.tsx`) and the GitHub Pages fallback
 * serves from a subpath, so writing a URL here would disturb both. The entry is a marker, not a
 * route.
 *
 * Closing the layer any other way hands the entry back, so the stack never grows. Pass
 * `enabled: false` on a desktop, where panels are layout rather than pages.
 */
export function usePageHistory(open: boolean, onClose: () => void, enabled: boolean): void {
  const token = useRef<symbol | null>(null);
  const close = useLatest(onClose);

  useEffect(() => {
    const release = (): void => {
      if (!token.current) return;
      const at = owners.findIndex((layer) => layer.owner === token);
      if (at !== -1) owners.splice(at, 1);
      token.current = null;
      giveBack();
    };
    if (!enabled || !open) {
      release();
      return;
    }
    if (token.current) return;
    token.current = Symbol('history-layer');
    owners.push({ owner: token, close: () => close.current() });
    window.history.pushState({ layer: true }, '');
    return release;
  }, [open, enabled, close]);
}
