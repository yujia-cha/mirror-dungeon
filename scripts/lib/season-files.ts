/**
 * Which vendored file names carry a Mirror Dungeon season, and what the next season calls them.
 *
 * The suffix rules are not one rule — they are a dozen, invented at different times: `-md7`,
 * `-7`, `-07`, `mirrordungeon7`, `battle7-`, `_7`, `_MD7`, `_Mirror7`. When a season turns over,
 * `data/sources.lock.json` has to grow the new season's entry for each of them, and that was
 * hand work the runbook only described in prose.
 *
 * Every family is written out rather than inferred, because inference is what makes this
 * dangerous. `EGOgift_MirrorDungeon-StoryTheme_2.json` and `ego-gift-mirrordungeon5_2.json` end
 * in a number that is not a season, and a rule loose enough to catch `mirrordungeon7` catches
 * those too. An exact pattern per family cannot.
 *
 * Each pattern captures the season in group 2 and keeps groups 1 and 3 verbatim, so the digit
 * width survives: `-07` becomes `-08`, `-7` becomes `-8`.
 */

export interface SeasonFileFamily {
  /** Stable name, used in messages and tests. */
  id: string;
  /** `^(prefix)(season)(suffix)$` over a base name — exactly three groups. */
  pattern: RegExp;
}

/**
 * Season-bearing file families, static data first, then localization.
 *
 * Deliberately absent: `mirrordungeon-theme-floor-t{k}.json`. Its number is a pack tier, not a
 * season, so a new season does not rename it — it may *add* a tier, which nothing here can
 * predict. `lockNextSeason` mentions that separately instead of guessing a `t7`.
 */
export const SEASON_FILE_FAMILIES: readonly SeasonFileFamily[] = [
  { id: 'common-data', pattern: /^(mirror-dungeon-common-data-md)(\d+)(\.json)$/ },
  { id: 'droppool', pattern: /^(mirrordungeon-egogift-droppool-)(\d+)(\.json)$/ },
  { id: 'observation', pattern: /^(mirror-dungeon-egogift-observation-data-md)(\d+)(\.json)$/ },
  { id: 'dungeon', pattern: /^(mirrordungeon-)(\d+)((?:-(?:hard|infinite|extreme))?\.json)$/ },
  { id: 'start-buffs', pattern: /^(mirrordungeon-start-buffs-)(\d+)(\.json)$/ },
  { id: 'battle', pattern: /^(mirrordungeon-(?:ab)?battle)(\d+)(-(?:extreme|hidden)\.json)$/ },
  { id: 'ego-gift', pattern: /^(ego-gift-mirrordungeon)(\d+)((?:-hb)?\.json)$/ },
  { id: 'hidden-ego-gift', pattern: /^(hidden-ego-gift-mirrordungeon-md)(\d+)(-extreme\.json)$/ },
  { id: 'localize-gift-text', pattern: /^(EGOgift_MirrorDungeon_)(\d+)(\.json)$/ },
  { id: 'localize-battle-keywords', pattern: /^(BattleKeywords_Mirror)(\d+)(\.json)$/ },
  { id: 'localize-start-buffs', pattern: /^(DungeonStartBuffs_MD)(\d+)(\.json)$/ },
  { id: 'localize-ui', pattern: /^(MirrorDungeonUI_)(\d+)(\.json)$/ },
] as const;

function baseName(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? path : path.slice(slash + 1);
}

/**
 * The Mirror Dungeon season a file name carries, or null when it carries none.
 *
 * Unrelated static files end in numbers too — the identity records are `personality-01.json`
 * through `personality-12.json` — so anything that is not one of the families above is `null`
 * rather than a guess.
 */
export function seasonOf(path: string): number | null {
  const name = baseName(path);
  for (const family of SEASON_FILE_FAMILIES) {
    const match = family.pattern.exec(name);
    if (match) return Number(match[2]);
  }
  return null;
}

/** The family a path belongs to, for messages that want to group the additions. */
export function familyOf(path: string): string | null {
  const name = baseName(path);
  for (const family of SEASON_FILE_FAMILIES) {
    if (family.pattern.test(name)) return family.id;
  }
  return null;
}

/**
 * The same file, named for another season — keeping its directory and its digit width.
 * Returns null when the path carries no season.
 */
export function renameToSeason(path: string, to: number): string | null {
  const name = baseName(path);
  const dir = path.slice(0, path.length - name.length);
  for (const family of SEASON_FILE_FAMILIES) {
    const match = family.pattern.exec(name);
    if (!match) continue;
    const width = match[2]!.length;
    return `${dir}${match[1]}${String(to).padStart(width, '0')}${match[3]}`;
  }
  return null;
}

export interface NextSeasonFiles {
  /** Paths for `to` that the list does not already have, in the order their `from` files appear. */
  added: string[];
  /** Paths for `to` that were already listed. */
  kept: string[];
  /** Which families contributed, for the summary. */
  families: string[];
}

/**
 * Given a source's file list, the names that source will need for season `to`.
 *
 * Nothing is removed. The three upstreams do not rename a season's files when a new one lands —
 * `EGOgift_MirrorDungeon.json`, `_2`, `_6` and `_7` all sit there together, and OpenLethe's
 * Mirror Dungeon capture is frozen at md7 — so dropping the old entries would only stop
 * `data:fetch` from restoring a season we still build and ship.
 */
export function nextSeasonFileNames(files: readonly string[], from: number, to: number): NextSeasonFiles {
  const have = new Set(files);
  const added: string[] = [];
  const kept: string[] = [];
  const families = new Set<string>();
  for (const file of files) {
    if (seasonOf(file) !== from) continue;
    const next = renameToSeason(file, to);
    if (!next) continue;
    families.add(familyOf(file)!);
    if (have.has(next)) {
      if (!kept.includes(next)) kept.push(next);
    } else if (!added.includes(next)) {
      added.push(next);
    }
  }
  return { added, kept, families: [...families].sort() };
}

/** The newest season any of these paths names, or null when none do. */
export function newestSeason(files: readonly string[]): number | null {
  let newest: number | null = null;
  for (const file of files) {
    const season = seasonOf(file);
    if (season !== null && (newest === null || season > newest)) newest = season;
  }
  return newest;
}
