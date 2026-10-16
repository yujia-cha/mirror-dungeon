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
 * What every entry this module pushes carries: how many layer entries stand at and below it, so
 * the app's own entry is depth 0, a page over it 1, a sheet over the page 2.
 *
 * The history is reconciled to the layers by depth rather than by counting our own traversals
 * (M124). The count was the bug's accomplice: a layer closing as another opened in one commit was a
 * `history.back()` and a `pushState` back to back, and Chrome applies the push at once and the back
 * later — so the back undid the *new* entry, the new page owned nothing, and the next back (its ←
 * or the device's) left the app. Counting also drifted for good whenever two backs collapsed into
 * one traversal, which then swallowed the user's next real back. A depth read off the entry the
 * browser actually landed on cannot drift.
 */
interface Marker {
  layer: number;
}

/** The depth of an entry; 0 for the app's own entry and for anything this module did not push. */
function depthOf(state: unknown): number {
  const layer = (state as Partial<Marker> | null)?.layer;
  return typeof layer === 'number' && Number.isInteger(layer) && layer > 0 ? layer : 0;
}

/**
 * A traversal this module started and has not yet seen land. It is asynchronous, so while it is in
 * flight the current entry still reads the old depth; nothing else moves the history until it lands.
 */
let traversing = false;
let syncQueued = false;

/**
 * Make the history as deep as the open layers: push the entries a new layer needs, or go back over
 * the ones closed layers left behind — every one of them in a single traversal.
 */
function sync(): void {
  if (traversing) return;
  const current = depthOf(window.history.state);
  const want = owners.length;
  if (current < want) {
    for (let depth = current + 1; depth <= want; depth += 1) {
      window.history.pushState({ layer: depth } satisfies Marker, '');
    }
  } else if (current > want) {
    traversing = true;
    window.history.go(want - current);
  }
}

/**
 * Releases wait for the end of the tick. One layer closing as another opens is a hand-over (the
 * route page's 「기프트」 closes it and opens the items page in one commit): by then the new layer has
 * taken the old one's place, the depth already matches, and the history is not touched at all.
 */
function queueSync(): void {
  if (syncQueued) return;
  syncQueued = true;
  queueMicrotask(() => {
    syncQueued = false;
    sync();
  });
}

/**
 * One listener for every layer, installed once.
 *
 * It cannot live inside the hook: a layer that unmounts while open hands its entry back, and if
 * the listener went away with the component nothing would be left to see that traversal land.
 */
if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    const landed = depthOf(window.history.state);
    if (traversing) {
      // Our own traversal: the layers it gave back are already closed.
      traversing = false;
    } else {
      // The user went back (or a link navigated the tab): close every layer above where it landed,
      // topmost first. Clear each owner first: its entry is gone, so it must not hand it back a
      // second time when its own state catches up and the effect tears down.
      while (owners.length > landed) {
        const layer = owners.pop()!;
        layer.owner.current = null;
        layer.close();
      }
    }
    // A layer that opened while a traversal was in flight, or a forward step onto an entry no layer
    // owns, leaves the depth off by some: settle it now.
    sync();
  });
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
      queueSync();
    };
    if (!enabled || !open) {
      release();
      return;
    }
    if (token.current) return;
    token.current = Symbol('history-layer');
    owners.push({ owner: token, close: () => close.current() });
    sync();
    return release;
  }, [open, enabled, close]);
}
