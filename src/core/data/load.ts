import {
  enumsSchema,
  giftsFileSchema,
  identitiesFileSchema,
  metaSchema,
  packsFileSchema,
  rulesSchema,
  seasonIndexSchema,
  type GameData,
  type SeasonIndex,
} from '../schema.ts';

/** Files a Mirror Dungeon season owns, under `data/md{n}/`. */
const SEASON_FILES = ['meta', 'rules', 'gifts', 'packs'] as const;
/** Files no season owns, at `data/`. Neither looks at the dungeon. */
const SHARED_FILES = ['enums', 'identities'] as const;

function normaliseBase(baseUrl: string): string {
  return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
}

async function fetchJson(url: string, label: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`게임 데이터를 불러올 수 없습니다: ${label} (${response.status})`);
  return response.json() as Promise<unknown>;
}

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

  const [[meta, rules, gifts, packs], [enums, identities]] = await Promise.all([
    Promise.all(
      SEASON_FILES.map((name) => fetchJson(`${base}data/md${season}/${name}.json`, `md${season}/${name}.json`)),
    ),
    Promise.all(SHARED_FILES.map((name) => fetchJson(`${base}data/${name}.json`, `${name}.json`))),
  ]);

  if (options.validate) {
    return {
      meta: metaSchema.parse(meta),
      enums: enumsSchema.parse(enums),
      rules: rulesSchema.parse(rules),
      gifts: giftsFileSchema.parse(gifts),
      packs: packsFileSchema.parse(packs),
      identities: identitiesFileSchema.parse(identities),
    };
  }

  return {
    meta,
    enums,
    rules,
    gifts,
    packs,
    identities,
  } as GameData;
}
