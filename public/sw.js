/**
 * Offline support, deliberately small.
 *
 * This file is copied verbatim by Vite — it is not bundled, so it cannot import anything from
 * `src/`, which also means **nothing here is covered by a test**. M48 spent a milestone adding
 * tests to `src/core/data/load.ts` for exactly that reason, so the rule applied here is: keep the
 * logic to a decision a reader can check by eye, and put nothing in it that the app depends on for
 * correctness. Everything still works with the service worker absent or disabled.
 *
 * **Precache (M55).** The worker takes control only after the first load, so everything that load
 * fetched went around it; before M55 an offline open failed after one online visit because the
 * page, its scripts and `data/index.json` were never cached. The build now writes the shell into
 * `PRECACHE` (`scripts/lib/precache.ts`, via the `precache` plugin in `vite.config.ts`), and
 * install fetches it. The very first visit still needs the network — nothing can change that.
 *
 * Three strategies, by what the URL is:
 *
 *   navigation      network first, cache as the fallback. A deploy must never be shadowed by a
 *                   cached shell, and offline must still open the app.
 *   hashed asset    cache first. `assets/index-D3cfCpYc.js` never changes content; a new build is
 *                   a new name, so there is nothing to revalidate. Only files under `assets/` with
 *                   Vite's 8-character hash count (M160): `apple-touch-icon.png` and
 *                   `guide/route-conflict.webp` looked hashed to the old pattern and were frozen.
 *   everything else stale-while-revalidate: `data/md7/gifts.json` and `art/*.png` keep their
 *                   names across deploys, so serve what we have and refresh in the background. The
 *                   refresh is handed to `waitUntil`, so the worker is not stopped before it lands.
 *
 * `VERSION` names the cache. It is a hash of the precache list *and* of the data files' content
 * (`scripts/lib/precache.ts`), so a deploy that changed only the data still drops the old cache on
 * activation — the stale-while-revalidate copies would otherwise outlive the deploy.
 *
 * Every lookup ignores `Vary`. A module script is a CORS request carrying `Origin`; a precached
 * copy was fetched without one, and a server that answers `Vary: Origin` (Vite's preview does)
 * makes the two never match — the page opened offline and every script failed. The files are
 * static, so no header can make one response wrong for another request.
 */
/** Filled in by the build; the source keeps these two lines verbatim (`injectPrecache` checks). */
const PRECACHE = [];
const VERSION = 'dev';
const CACHE = `md-planner-${VERSION}`;
const MATCH = { ignoreVary: true };

/**
 * `name-8charhash.ext` — what Vite emits under `assets/` (the hash alphabet is base64url, so `-`
 * and `_` are in it: `subset.33--0OT__YQ.woff2`). Tested on the path below `assets/` only.
 */
const HASHED = /^[^/]+-[A-Za-z0-9_-]{8}\.[a-z0-9]+$/;

/** True for a bundled asset: directly under the app's `assets/`, with Vite's hash in its name. */
function isHashedAsset(pathname) {
  const assets = new URL('./assets/', self.registration.scope).pathname;
  return pathname.startsWith(assets) && HASHED.test(pathname.slice(assets.length));
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // One file at a time rather than `addAll`: one failed fetch must not keep the worker from
      // installing, and a file missed here is still cached the first time it is used.
      await Promise.all(
        PRECACHE.map(async (path) => {
          try {
            const request = new Request(path, { cache: 'reload' });
            const response = await fetch(request);
            if (response.ok) await cache.put(request, response);
          } catch {
            // Offline mid-install, or a file gone: the runtime strategies below still apply.
          }
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // A new worker version drops every older cache: stale hashed assets from a previous deploy
      // are dead weight, and stale data files would be served forever otherwise.
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name)));
      await self.clients.claim();
    })(),
  );
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (error) {
    // A navigation with a query string still gets the app shell precached as `./`.
    const cached =
      (await cache.match(request, { ...MATCH, ignoreSearch: true })) ??
      (await cache.match(new URL('./', self.registration.scope).href, MATCH));
    if (cached) return cached;
    throw error;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request, MATCH);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

async function staleWhileRevalidate(event) {
  const { request } = event;
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request, MATCH);
  const fresh = fetch(request)
    .then(async (response) => {
      if (response.ok) await cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  if (cached) {
    // The cached copy answers now; the refresh must still be allowed to finish and be stored.
    event.waitUntil(fresh);
    return cached;
  }
  const response = await fresh;
  if (response) return response;
  throw new Error(`offline and not cached: ${request.url}`);
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  // Only our own GETs. A cross-origin request (an external asset host, if one is ever configured)
  // is left to the browser, and anything but GET must never be served from a cache.
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(new URL('./', self.registration.scope).pathname)) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }
  event.respondWith(isHashedAsset(url.pathname) ? cacheFirst(request) : staleWhileRevalidate(event));
});
