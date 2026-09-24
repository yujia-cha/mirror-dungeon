/**
 * Register the offline service worker, or do nothing.
 *
 * Kept out of `main.tsx` so the decision of *when not to* is written down once:
 *
 * - **Dev**: never. A caching worker fights Vite's HMR, and an accidentally installed one outlives
 *   the dev server — which then serves a stale app from a port that has moved on.
 *   (`import.meta.env.DEV` is compiled out of the production bundle entirely.)
 * - **No support**: nothing to do. Offline is a bonus, never a requirement.
 * - **Failure**: swallowed. A worker that will not install must not keep the app from loading, and
 *   there is nothing a reader could do about it.
 *
 * The scope comes from `BASE_URL`, because GitHub Pages serves this app from `/mirror-dungeon/` and
 * a worker registered at the origin root would claim pages that are not ours.
 */
export function registerServiceWorker(): void {
  if (import.meta.env.DEV) return;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  const base = import.meta.env.BASE_URL.endsWith('/')
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`;
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register(`${base}sw.js`, { scope: base }).catch(() => {
      // Deliberately silent: see above.
    });
  });
}
