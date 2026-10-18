import {
  artManifestSchema,
  enumsSchema,
  giftIconManifestSchema,
  giftsFileSchema,
  identitiesFileSchema,
  keywordIconManifestSchema,
  packImageManifestSchema,
  metaSchema,
  packsFileSchema,
  rulesSchema,
  seasonIndexSchema,
  skillGiftIndexSchema,
  type ArtManifest,
  type GameData,
  type GiftIconManifest,
  type KeywordIconManifest,
  type PackImageManifest,
  type SeasonIndex,
} from '../schema.ts';

/** Files a Mirror Dungeon season owns, under `data/md{n}/`. */
const SEASON_FILES = ['meta', 'rules', 'gifts', 'packs'] as const;
/**
 * A season file a season frozen before it existed does not have (M129 `skill-gifts.json`): a 404
 * leaves it out of `GameData`; any other failure is an error like the rest.
 */
const OPTIONAL_SEASON_FILE = 'skill-gifts';
/** Files no season owns, at `data/`. Neither looks at the dungeon. */
const SHARED_FILES = ['enums', 'identities'] as const;
/** Written by `npm run art`; says which hand-drawn files exist so the app requests only those. */
const ART_MANIFEST_PATH = 'art/manifest.json';
/** Written by `npm run data:icons`; the game gift icons the site ships (M92). */
const GIFT_ICON_MANIFEST_PATH = 'icons/gifts/manifest.json';
/** Written by `npm run data:icons`; the game keyword icons the gift badge draws (M99). */
const KEYWORD_ICON_MANIFEST_PATH = 'icons/keywords/manifest.json';
/** Written by `npm run data:icons`; the game theme pack art the pack cards draw (M100). */
const PACK_IMAGE_MANIFEST_PATH = 'icons/packs/manifest.json';

function normaliseBase(baseUrl: string): string {
  return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
}

/** A stalled connection never rejects on its own, and the app shows its skeleton while it waits. */
const FETCH_TIMEOUT_MS = 15_000;

/**
 * Why this carries a code and not a sentence: the message reaches the user through the app's error
 * card, next to strings the app has localized. A Korean sentence thrown from core showed up
 * beside English ones for a reader in English mode. The app turns `cause` into its own text and
 * falls back to `message` for anything it does not know.
 */
export class DataLoadError extends Error {
  constructor(
    readonly cause: 'http' | 'timeout' | 'network' | 'malformed',
    readonly label: string,
    readonly status?: number,
  ) {
    super(`data load failed (${cause}): ${label}${status === undefined ? '' : ` (${status})`}`);
    this.name = 'DataLoadError';
  }
}

async function fetchJson(url: string, label: string, optional = false): Promise<unknown> {
  // `AbortSignal.timeout` is Safari 16 / iOS 16, the app's floor, so no polyfill is needed.
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch (cause) {
    const timedOut =
      cause instanceof DOMException && (cause.name === 'TimeoutError' || cause.name === 'AbortError');
    throw new DataLoadError(timedOut ? 'timeout' : 'network', label);
  }
  if (optional && response.status === 404) return undefined;
  if (!response.ok) throw new DataLoadError('http', label, response.status);
  try {
    return (await response.json()) as unknown;
  } catch {
    // A host that answers a missing data file with its own HTML 200 lands here rather than deep
    // inside the planner.
    throw new DataLoadError('malformed', label);
  }
}

/**
 * Production skips Zod (parsing 446 gifts on every load is wasted work — CI already validated the
 * files), but it must not skip *everything*: a truncated-yet-parseable file would otherwise become
 * a `TypeError` several frames inside the planner, which is a white screen rather than the error
 * card. This is the cheap middle: the shape each file must have for any reader to work.
 */
function assertShape(label: string, value: unknown, kind: 'array' | 'object'): void {
  const ok =
    kind === 'array'
      ? Array.isArray(value)
      : value !== null && typeof value === 'object' && !Array.isArray(value);
  if (!ok) throw new DataLoadError('malformed', label);
}

/**
 * A manifest the site may or may not ship, or `null` when there is none to read.
 *
 * Deliberately never throws: art and icons are decoration, and the planner works without a single
 * image. A missing, half-written or hand-broken manifest must leave the app running with plain
 * tiles, not send it to the error card — which is why this does not use `fetchJson`.
 */
async function loadOptionalManifest<T>(
  baseUrl: string,
  path: string,
  schema: { parse: (value: unknown) => T },
): Promise<T | null> {
  try {
    const response = await fetch(`${normaliseBase(baseUrl)}${path}`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return schema.parse(await response.json());
  } catch {
    return null;
  }
}

/** Which hand-drawn art files exist, or `null`. */
export const loadArtManifest = (baseUrl = '/'): Promise<ArtManifest | null> =>
  loadOptionalManifest(baseUrl, ART_MANIFEST_PATH, artManifestSchema);

/** Which game gift icons ship (M92), or `null`: a tile without a picture is a finished tile. */
export const loadGiftIconManifest = (baseUrl = '/'): Promise<GiftIconManifest | null> =>
  loadOptionalManifest(baseUrl, GIFT_ICON_MANIFEST_PATH, giftIconManifestSchema);

/** Which game keyword icons ship (M99), or `null` — the badge then draws its coloured dot. */
export const loadKeywordIconManifest = (baseUrl = '/'): Promise<KeywordIconManifest | null> =>
  loadOptionalManifest(baseUrl, KEYWORD_ICON_MANIFEST_PATH, keywordIconManifestSchema);

/** Which game pack images ship (M100), or `null` — the cards then stay empty boxes. */
export const loadPackImageManifest = (baseUrl = '/'): Promise<PackImageManifest | null> =>
  loadOptionalManifest(baseUrl, PACK_IMAGE_MANIFEST_PATH, packImageManifestSchema);

/**
 * Which seasons are published and which one to open. Always validated: it is one small object, and
 * everything else depends on getting the season right.
 */
export async function loadSeasonIndex(baseUrl = '/'): Promise<SeasonIndex> {
  const base = normaliseBase(baseUrl);
  return seasonIndexSchema.parse(await fetchJson(`${base}data/index.json`, 'index.json'));
}

/**
 * Load the generated game data for one season.
 *
 * `baseUrl` must end in a slash and is normally `import.meta.env.BASE_URL`: GitHub Pages serves
 * the app from a sub-path, so an absolute `/data/...` would 404 there.
 *
 * Validation runs only when asked, because parsing 446 gifts through Zod on every page load is
 * wasted work in production — the data was already validated in CI.
 */
export async function loadGameData(
  baseUrl = '/',
  options: { validate?: boolean; season?: number } = {},
): Promise<GameData> {
  const base = normaliseBase(baseUrl);
  const season = options.season ?? (await loadSeasonIndex(baseUrl)).default;

  const skillGiftsLabel = `md${season}/${OPTIONAL_SEASON_FILE}.json`;
  const [[meta, rules, gifts, packs], [enums, identities], skillGifts] = await Promise.all([
    Promise.all(
      SEASON_FILES.map((name) =>
        fetchJson(`${base}data/md${season}/${name}.json`, `md${season}/${name}.json`),
      ),
    ),
    Promise.all(SHARED_FILES.map((name) => fetchJson(`${base}data/${name}.json`, `${name}.json`))),
    fetchJson(`${base}data/${skillGiftsLabel}`, skillGiftsLabel, true),
  ]);

  assertShape(`md${season}/meta.json`, meta, 'object');
  assertShape(`md${season}/rules.json`, rules, 'object');
  assertShape(`md${season}/gifts.json`, gifts, 'array');
  assertShape(`md${season}/packs.json`, packs, 'array');
  assertShape('enums.json', enums, 'object');
  assertShape('identities.json', identities, 'array');
  if (skillGifts !== undefined) assertShape(skillGiftsLabel, skillGifts, 'object');

  if (options.validate) {
    return {
      meta: metaSchema.parse(meta),
      enums: enumsSchema.parse(enums),
      rules: rulesSchema.parse(rules),
      gifts: giftsFileSchema.parse(gifts),
      packs: packsFileSchema.parse(packs),
      identities: identitiesFileSchema.parse(identities),
      ...(skillGifts !== undefined ? { skillGifts: skillGiftIndexSchema.parse(skillGifts) } : {}),
    };
  }

  return {
    meta,
    enums,
    rules,
    gifts,
    packs,
    identities,
    ...(skillGifts !== undefined ? { skillGifts } : {}),
  } as GameData;
}
