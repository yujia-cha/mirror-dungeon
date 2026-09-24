// @vitest-environment node
//
// `fetch` is stubbed, so no DOM is needed — and running this outside jsdom keeps it honest about
// using the global `fetch` the browser gives it.
/**
 * The loader the browser actually runs.
 *
 * Every other suite reads the generated data through `core/data/node.ts`, straight off disk, and
 * `app.test.tsx` mocks this module out entirely — it imported the type and handed `vi.mock` a
 * replacement. So the code that composes URLs from `import.meta.env.BASE_URL`, splits season files
 * from shared ones, and decides what a failure means to the user had **never executed in a test**.
 *
 * That is the gap worth closing first, because it is exactly where a deployment-only break lives:
 * GitHub Pages serves the app from `/mirror-dungeon/`, and an absolute `/data/...` works perfectly
 * on a dev server and 404s in production.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataLoadError, loadArtManifest, loadGameData, loadSeasonIndex } from '../load.ts';
import { loadGameDataFromDisk, readSeasonIndex } from '../node.ts';

const index = readSeasonIndex();
const season = index.default;
const data = loadGameDataFromDisk(undefined, season);

/** The real generated files, keyed by the path the loader is expected to ask for. */
function filesUnder(base: string): Record<string, unknown> {
  return {
    [`${base}data/index.json`]: index,
    [`${base}data/md${season}/meta.json`]: data.meta,
    [`${base}data/md${season}/rules.json`]: data.rules,
    [`${base}data/md${season}/gifts.json`]: data.gifts,
    [`${base}data/md${season}/packs.json`]: data.packs,
    [`${base}data/enums.json`]: data.enums,
    [`${base}data/identities.json`]: data.identities,
    [`${base}art/manifest.json`]: { gifts: [], packs: [] },
  };
}

/** Serve a fixed set of URLs; anything else is a 404, which is what a wrong base path looks like. */
function serve(
  files: Record<string, unknown>,
  overrides: Record<string, () => Promise<Response>> = {},
): string[] {
  const asked: string[] = [];
  vi.stubGlobal('fetch', async (url: string | URL): Promise<Response> => {
    const key = String(url);
    asked.push(key);
    const override = overrides[key];
    if (override) return override();
    if (!(key in files)) return new Response('not found', { status: 404 });
    return new Response(JSON.stringify(files[key]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  return asked;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('base path', () => {
  it('asks for every file under the sub-path the app is served from', async () => {
    const asked = serve(filesUnder('/mirror-dungeon/'));
    await loadGameData('/mirror-dungeon/', { season });
    expect(asked).toContain(`/mirror-dungeon/data/md${season}/gifts.json`);
    expect(asked).toContain('/mirror-dungeon/data/identities.json');
    // The bug this guards against: an absolute path that works on a dev server and 404s on Pages.
    expect(asked.filter((url) => url.startsWith('/data/'))).toEqual([]);
  });

  it('adds the trailing slash a base URL may be missing', async () => {
    const asked = serve(filesUnder('/mirror-dungeon/'));
    await loadGameData('/mirror-dungeon', { season });
    expect(asked.every((url) => !url.includes('//data'))).toBe(true);
    expect(asked).toContain(`/mirror-dungeon/data/md${season}/meta.json`);
  });

  it('defaults to the site root', async () => {
    const asked = serve(filesUnder('/'));
    await loadSeasonIndex();
    expect(asked).toEqual(['/data/index.json']);
  });
});

describe('season split', () => {
  it('reads meta, rules, gifts and packs per season, and enums and identities once', async () => {
    const asked = serve(filesUnder('/'));
    await loadGameData('/', { season });
    const seasonScoped = asked.filter((url) => url.includes(`/md${season}/`)).sort();
    expect(seasonScoped).toEqual([
      `/data/md${season}/gifts.json`,
      `/data/md${season}/meta.json`,
      `/data/md${season}/packs.json`,
      `/data/md${season}/rules.json`,
    ]);
    expect(asked).toContain('/data/enums.json');
    expect(asked).toContain('/data/identities.json');
    // `enums` and `identities` are shared, so they must not be looked for inside the season folder.
    expect(asked).not.toContain(`/data/md${season}/enums.json`);
  });

  it('asks the index which season to open when none is named', async () => {
    const asked = serve(filesUnder('/'));
    const loaded = await loadGameData('/');
    expect(asked).toContain('/data/index.json');
    expect(loaded.meta.dungeon.id).toBe(season);
  });

  it('returns data the planner can use, and validates it when asked', async () => {
    serve(filesUnder('/'));
    const loaded = await loadGameData('/', { season, validate: true });
    expect(loaded.gifts.length).toBe(data.gifts.length);
    expect(loaded.identities.length).toBe(data.identities.length);
    expect(loaded.rules.dungeonId).toBe(season);
  });
});

describe('failures reach the user as a code, not a sentence', () => {
  it('reports the status and the file for an HTTP error', async () => {
    serve({});
    const error = await loadSeasonIndex('/').catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(DataLoadError);
    expect(error).toMatchObject({ cause: 'http', label: 'index.json', status: 404 });
  });

  it('reports a network failure separately from an HTTP one', async () => {
    serve(filesUnder('/'), {
      '/data/index.json': () => Promise.reject(new TypeError('Failed to fetch')),
    });
    const error = await loadSeasonIndex('/').catch((cause: unknown) => cause);
    expect(error).toMatchObject({ cause: 'network', label: 'index.json' });
  });

  it('reports a timeout as its own cause', async () => {
    serve(filesUnder('/'), {
      '/data/index.json': () => Promise.reject(new DOMException('timed out', 'TimeoutError')),
    });
    const error = await loadSeasonIndex('/').catch((cause: unknown) => cause);
    expect(error).toMatchObject({ cause: 'timeout' });
  });

  it("calls a host's HTML 200 malformed rather than letting it reach the planner", async () => {
    // A static host that answers a missing file with its own index.html, status 200.
    serve(filesUnder('/'), {
      '/data/index.json': () =>
        Promise.resolve(new Response('<!doctype html><title>404</title>', { status: 200 })),
    });
    const error = await loadSeasonIndex('/').catch((cause: unknown) => cause);
    expect(error).toMatchObject({ cause: 'malformed', label: 'index.json' });
  });

  it('refuses a file that parses but is the wrong shape, before the planner sees it', async () => {
    // Truncated-yet-valid JSON is the case production validation would otherwise wave through:
    // `gifts` as an object becomes a TypeError deep inside the planner — a white screen.
    const files = { ...filesUnder('/'), [`/data/md${season}/gifts.json`]: { oops: true } };
    serve(files);
    const error = await loadGameData('/', { season }).catch((cause: unknown) => cause);
    expect(error).toMatchObject({ cause: 'malformed', label: `md${season}/gifts.json` });
  });
});

describe('art manifest', () => {
  it('reads the manifest from the same sub-path', async () => {
    const asked = serve(filesUnder('/mirror-dungeon/'));
    await loadArtManifest('/mirror-dungeon/');
    expect(asked).toEqual(['/mirror-dungeon/art/manifest.json']);
  });

  it('never throws — art is decoration, and the planner works with none of it', async () => {
    serve({});
    await expect(loadArtManifest('/')).resolves.toBeNull();

    serve(filesUnder('/'), { '/art/manifest.json': () => Promise.reject(new TypeError('offline')) });
    await expect(loadArtManifest('/')).resolves.toBeNull();

    // A hand-broken manifest is the interesting one: it must not take the app down with it.
    serve({ ...filesUnder('/'), '/art/manifest.json': { gifts: 'not an array' } });
    await expect(loadArtManifest('/')).resolves.toBeNull();
  });
});
