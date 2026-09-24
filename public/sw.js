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
 *   hashed asset    cache first. `index-D3cfCpYc.js` never changes content; a new build is a new
 *                   name, so there is nothing to revalidate.
 *   everything else stale-while-revalidate.
 *
 * Every lookup ignores `Vary`. A module script is a CORS request carrying `Origin`; a precached
 * copy was fetched without one, and a server that answers `Vary: Origin` (Vite's preview does)
 * makes the two never match — the page opened offline and every script failed. The files are
 * static, so no header can make one response wrong for another request. `data/md7/gifts.json` and `art/*.png` keep their names
 *                   across deploys, so serve what we have and refresh in the background.
 */
/** Filled in by the build; the source keeps these two lines verbatim (`injectPrecache` checks). */
const PRECACHE = [];
const VERSION = 'dev';
const CACHE = `md-planner-${VERSION}`;
const MATCH = { ignoreVary: true };

/** `name-8charhash.ext` — what Vite emits for a bundled asset. */
const HASHED = /-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/;

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

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request, MATCH);
  const fresh = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  if (cached) return cached;
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
  event.respondWith(HASHED.test(url.pathname) ? cacheFirst(request) : staleWhileRevalidate(request));
});
