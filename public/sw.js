/**
 * Offline support, deliberately small.
 *
 * This file is copied verbatim by Vite — it is not bundled, so it cannot import anything from
 * `src/`, which also means **nothing here is covered by a test**. M48 spent a milestone adding
 * tests to `src/core/data/load.ts` for exactly that reason, so the rule applied here is: keep the
 * logic to a decision a reader can check by eye, and put nothing in it that the app depends on for
 * correctness. Everything still works with the service worker absent or disabled.
 *
 * Why runtime caching rather than a precache manifest: a precache list needs the build's hashed
 * asset names, which is what `vite-plugin-pwa` exists to generate. The cost is a dependency and a
 * build step; the benefit is that a *first* visit works offline. This app is opened online, then
 * consulted during a run — so caching what the first visit fetched is enough, and the honest
 * limitation is stated in `docs/review/M49.md`: the very first load needs the network.
 *
 * Three strategies, by what the URL is:
 *
 *   navigation      network first, cache as the fallback. A deploy must never be shadowed by a
 *                   cached shell, and offline must still open the app.
 *   hashed asset    cache first. `index-D3cfCpYc.js` never changes content; a new build is a new
 *                   name, so there is nothing to revalidate.
 *   everything else stale-while-revalidate. `data/md7/gifts.json` and `art/*.png` keep their names
 *                   across deploys, so serve what we have and refresh in the background.
 */
const CACHE = 'md-planner-v1';

/** `name-8charhash.ext` — what Vite emits for a bundled asset. */
const HASHED = /-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/;

self.addEventListener('install', () => {
  // No precache, so there is nothing to wait for; take over as soon as possible.
  self.skipWaiting();
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
    const cached = await cache.match(request);
    if (cached) return cached;
    throw error;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
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
