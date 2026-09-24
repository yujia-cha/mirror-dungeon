/**
 * Typed readers for the vendored game data under data/raw.
 *
 * Everything here is deliberately tolerant: upstream adds fields between seasons, and files can
 * be absent when the pipeline runs without the static data (`--lenient`).
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { localizeList, readJson, repoPath, staticList } from './io.ts';
import type { IdentityKeywordId, Sin } from '../../src/core/schema.ts';
import { IDENTITY_KEYWORD_BY_KO } from './derive.ts';

export const STATIC_DIR = repoPath('data/raw/static');
export const LOCALIZE_DIR = repoPath('data/raw/localize');

/** Verified against identity 10101 (참격/우울, 관통/질투, 참격/나태) — see docs/research/mechanics.md. */
export const SIN_BY_COLOR: Record<string, Sin> = {
  CRIMSON: 'WRATH',
  SCARLET: 'LUST',
  AMBER: 'SLOTH',
  SHAMROCK: 'GLUTTONY',
  AZURE: 'GLOOM',
  INDIGO: 'PRIDE',
  VIOLET: 'ENVY',
};

export interface RawThemePack {
  id: number;
  desc?: string;
  exceptionConditions?: { dungeonIdx: number; selectableFloors?: number[] }[];
  egoGiftPool?: number[];
  specificEgoGiftPool?: number[];
  mapGenOption?: { bossPool?: number[] };
  uiConfigs?: { packSpriteId?: string; bossSpriteId?: string };
  unlockCondition?: unknown;
}

export interface RawGift {
  id: number;
  /** Sprite-atlas key when it differs from the gift id. */
  iconId?: number;
  attributeType?: string;
  keyword?: string;
  tag?: string[];
  price?: number;
  lockType?: boolean;
  upgradeDataList?: { upgradeLevel: number; localizeID: number }[] | null;
}

export interface RawPersonality {
  id: number;
  rank?: number;
  season?: number;
  associationList?: string[];
  unitKeywordList?: string[];
  uniqueAttribute?: string;
  attributeList?: { skillId: number; number: number }[];
}

export interface RawSkill {
  id: number;
  skillType?: string;
  skillData?: RawSkillData[];
}

export interface RawSkillData {
  gaksungLevel?: number;
  attributeType?: string;
  atkType?: string;
  defType?: string;
  coinList?: RawCoin[];
}

interface RawCoin {
  abilityScriptList?: { scriptName?: string; buffData?: { buffKeyword?: string } }[];
}

export interface RawCommonData {
  currentDungeonId?: number;
  themePoolNum?: number;
  themePoolRecreateCount?: number;
  selectNewStartEgoGiftCategoryChip?: number;
  starlightInfo?: {
    initPoint?: number;
    detectThemeFloorDefaultPoint?: number;
    detectThemeFloorPointMultiplier?: number;
    detectunentrancedThemeFloorPointMultiplier?: number;
    startBuffEgoGiftRefreshDefaultPoint?: number;
    rewardInfo?: { normalDifficultyBonusMultiplier?: number; hardDifficultyBonusMultiplier?: number };
  };
  egoGiftUpgradeCostTable?: { table?: { tier: number; cost: number[] }[] };
  egoGiftCombineTierTable?: {
    combineScoreByEgoGiftTier?: { egoGiftTier: number; combineScore: number }[];
    combineTierResultByCombineScore?: {
      combineScoreRangeMin: number;
      combineScoreRangeMax: number;
      tierResult: number;
    }[];
  };
  egoGiftCombineFixedTable?: {
    combineFixed?: { resultEgoGiftId: number; requiredEgoGiftIds?: number[] }[];
    combineMixed?: {
      aEgoGiftIds: number[];
      aEgoGiftRequiredNum: number;
      bEgoGiftIds: number[];
      bEgoGiftRequiredNum: number;
      resultEgoGiftId: number;
    }[];
    nonAcquireableInEasyIds?: number[];
  };
  egogiftRandomCombineProbs?: {
    origin?: { materialCount: number; prob: number }[];
    enabledStarlight?: { materialCount: number; prob: number }[];
  };
  startEgoGiftPools?: { keyword: string; normalpool?: number[]; buffpool?: number[] }[];
  pieceEgoGiftIds?: number[];
  /** A random extra battle offered on EXTREME floors; its stages carry the 히든 전투 reward gifts. */
  hiddenBattleInfo?: {
    minFloorCondition?: number;
    pool?: number[];
    probInfo?: { floor: number; prob: number }[];
  };
}

/** A battle stage; `rewardList` is how boss stages hand out 클리어 보상 gifts. */
export interface RawStage {
  id: number;
  stageType?: string;
  rewardList?: { type?: string; rewardId?: number; num?: number; prob?: number }[] | null;
}

/** `mirror-dungeon-egogift-observation-data-*.json`: what 기프트 관측 can offer and what it costs. */
export interface RawObservationData {
  mirrordungeonId: number;
  observationEgoGiftCostDataList?: { egogiftCount: number; starlightCost: number }[];
  observationEgoGiftDataList?: { uiKeyword?: string; egogiftKeyword?: string; egogiftIdList?: number[] }[];
  unobservableEgoGiftIds?: number[];
}

export interface RawDropPool {
  dungeonId: number;
  egoGifts?: number[];
  excludeEgoGifts?: number[];
}

function listFiles(dir: string, match: RegExp): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => match.test(f))
    .sort()
    .map((f) => join(dir, f));
}

export function staticDataPresent(): boolean {
  return existsSync(join(STATIC_DIR, 'mirrordungeon-theme-floor'));
}

export function readThemePacks(): RawThemePack[] {
  const files = listFiles(join(STATIC_DIR, 'mirrordungeon-theme-floor'), /\.json$/);
  return files.flatMap((f) => staticList<RawThemePack>(readJson(f)));
}

export function readGiftStatics(): RawGift[] {
  const files = listFiles(join(STATIC_DIR, 'ego-gift-mirrordungeon'), /\.json$/);
  return files.flatMap((f) => staticList<RawGift>(readJson(f)));
}

export function readPersonalities(): RawPersonality[] {
  // Newer identities ship in chapter-suffixed files (personality-a1c9p2.json), not just 01-12.
  const files = listFiles(join(STATIC_DIR, 'personality'), /^personality-[\w-]+\.json$/);
  return files.flatMap((f) => staticList<RawPersonality>(readJson(f)));
}

export function readPersonalitySkills(): Map<number, RawSkill> {
  const files = listFiles(join(STATIC_DIR, 'skill'), /^personality-skill-[\w-]+\.json$/);
  const out = new Map<number, RawSkill>();
  for (const f of files) for (const s of staticList<RawSkill>(readJson(f))) out.set(s.id, s);
  return out;
}

function eachCommonData(): { data: RawCommonData; file: string }[] {
  const files = listFiles(join(STATIC_DIR, 'mirror-dungeon-common-data'), /\.json$/);
  return files.map((file) => {
    const raw = readJson<RawCommonData | { list?: RawCommonData[] }>(file);
    const data = (
      Array.isArray((raw as { list?: RawCommonData[] }).list)
        ? (raw as { list: RawCommonData[] }).list[0]
        : raw
    ) as RawCommonData;
    return { data, file };
  });
}

/**
 * The season's rule table from `mirror-dungeon-common-data-*.json`.
 *
 * Without `dungeonId` this is the newest one, which is what the vendored snapshot describes.
 * With one it is that exact season, so a build can be asked for a season the snapshot still holds.
 */
export function readCommonData(dungeonId?: number): { data: RawCommonData; file: string } | null {
  const all = eachCommonData();
  if (all.length === 0) return null;
  if (dungeonId !== undefined) return all.find((c) => c.data.currentDungeonId === dungeonId) ?? null;
  let best: { data: RawCommonData; file: string } | null = null;
  for (const entry of all) {
    if (!best || (entry.data.currentDungeonId ?? 0) > (best.data.currentDungeonId ?? 0)) best = entry;
  }
  return best;
}

/** Every season the vendored static data can build, ascending. */
export function listSeasons(): number[] {
  return [...new Set(eachCommonData().map((c) => c.data.currentDungeonId ?? 0))]
    .filter((id) => id > 0)
    .sort((a, b) => a - b);
}

/** Mirror Dungeon battle stages (`battle-mirrordungeon/*.json`), keyed by stage id. */
export function readStages(): Map<number, RawStage> {
  const files = listFiles(join(STATIC_DIR, 'battle-mirrordungeon'), /\.json$/);
  const out = new Map<number, RawStage>();
  for (const f of files) for (const stage of staticList<RawStage>(readJson(f))) out.set(stage.id, stage);
  return out;
}

export function readObservationData(dungeonId: number): RawObservationData | null {
  const files = listFiles(join(STATIC_DIR, 'mirror-dungeon-egogift-observation-data'), /\.json$/);
  for (const f of files) {
    for (const entry of staticList<RawObservationData>(readJson(f))) {
      if (entry.mirrordungeonId === dungeonId) return entry;
    }
  }
  return null;
}

export function readDropPool(dungeonId: number): RawDropPool | null {
  const files = listFiles(join(STATIC_DIR, 'mirrordungeon-egogift-droppool'), /\.json$/);
  for (const f of files) {
    for (const p of staticList<RawDropPool>(readJson(f))) {
      if (p.dungeonId === dungeonId) return p;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Localization
// ---------------------------------------------------------------------------

export type Lang = 'KR' | 'EN';

export interface LocalizedEntry {
  id: number | string;
  name?: string;
  content?: string;
  desc?: string;
  title?: string;
  simpleDesc?: { abilityID: number; simpleDesc: string }[];
}

function localizeFile(lang: Lang, file: string): LocalizedEntry[] {
  const path = join(LOCALIZE_DIR, lang, file);
  if (!existsSync(path)) return [];
  return localizeList<LocalizedEntry>(readJson(path));
}

export function localizeFiles(lang: Lang, match: RegExp): LocalizedEntry[] {
  return listFiles(join(LOCALIZE_DIR, lang), match).flatMap((f) => localizeList<LocalizedEntry>(readJson(f)));
}

export function readGiftTexts(lang: Lang): Map<number, LocalizedEntry> {
  const out = new Map<number, LocalizedEntry>();
  for (const e of localizeFiles(lang, /^EGOgift.*\.json$/)) {
    const id = Number(e.id);
    if (!Number.isFinite(id)) continue;
    // Keep the first definition: base files come before season patches alphabetically, and a
    // later file re-declaring an id is an upgrade variant we look up by localizeID instead.
    if (!out.has(id)) out.set(id, e);
  }
  return out;
}

export function readThemeNames(lang: Lang): Map<number, string> {
  const out = new Map<number, string>();
  for (const e of localizeFiles(lang, /^MirrorDungeonTheme.*\.json$/)) {
    const id = Number(e.id);
    if (Number.isFinite(id) && e.name) out.set(id, e.name);
  }
  return out;
}

export function readPersonalityTexts(lang: Lang): Map<number, LocalizedEntry> {
  const out = new Map<number, LocalizedEntry>();
  for (const e of localizeFile(lang, 'Personalities.json')) {
    const id = Number(e.id);
    if (Number.isFinite(id)) out.set(id, e);
  }
  return out;
}

/** Faction/trait display names, gathered from UnitKeyword*.json and the formation filter list. */
export function readFactionNames(lang: Lang): Map<string, string> {
  const out = new Map<string, string>();
  const add = (rawId: string, value: string | undefined): void => {
    if (!value) return;
    const id = rawId.replace(/^UnitKeyword_/, '').replace(/^formation_name_filter_Etc_/, '');
    if (!out.has(id)) out.set(id, value);
  };
  for (const e of localizeFiles(lang, /^UnitKeyword.*\.json$/)) add(String(e.id), e.content ?? e.name);
  for (const e of localizeFile(lang, 'FormationNameEtcFilter.json')) add(String(e.id), e.content ?? e.name);
  return out;
}

export const SPECIAL_VARIANT_LINE =
  /^-?\s*특수 (화상|출혈|진동|파열|침잠|호흡|충전|탄환)(?:\s*\([^)\n]*\))?\s*$/m;

/**
 * Buff ids the game declares as a 특수 variant of a keyword, e.g. `ChargeBodyArt`
 * (생체 재료 → 특수 충전) or `NailPersonality` (못 → 특수 출혈).
 *
 * The only machine-readable signal is a bullet in the buff's Korean description that reads
 * 「특수 충전」 on its own, optionally followed by a parenthetical — 적안·참회 (10410) and 검은 눈물
 * (10913) write 「- 특수 충전 (위력 고정)」, and requiring the bare form silently dropped their
 * 충전 until M60. Buffs that merely *mention* a 특수 variant in a longer sentence are not
 * variants themselves, which is why the line has to stand alone.
 *
 * Read from every `BattleKeywords*` file, like the names: the chapter tables are where
 * `AccelBullet` and `BulletLament` are finally declared — M20 had to count them as base 탄환
 * for want of a row.
 */
export function readSpecialVariants(): Map<string, IdentityKeywordId> {
  const out = new Map<string, IdentityKeywordId>();
  for (const e of localizeFiles('KR', BATTLE_KEYWORD_FILES)) {
    const m = typeof e.desc === 'string' ? SPECIAL_VARIANT_LINE.exec(e.desc) : null;
    const keyword = m ? IDENTITY_KEYWORD_BY_KO[m[1]!] : undefined;
    if (keyword) out.set(String(e.id), keyword);
  }
  return out;
}

/** One identity skill as the localization writes it: `Skills_personality-*.json`. */
export interface LocalizedSkill {
  id: number;
  levelList?: {
    level?: number;
    name?: string;
    desc?: string;
    coinlist?: { coindescs?: { desc?: string }[] }[] | null;
  }[];
}

/**
 * Identity skill text, keyed by skill id (`<identityId><2-digit suffix>`).
 *
 * Only Korean is vendored: this is read to work out which keywords a skill inflicts, and the
 * grammar that marks an infliction (「… 부여」, 「… 증가」) is Korean. Coverage is partial — the
 * mirror ships these files for the newer identities only — so callers must treat a missing skill
 * as "unknown", never as "no keywords".
 */
export function readLocalizedPersonalitySkills(lang: Lang = 'KR'): Map<number, LocalizedSkill> {
  const out = new Map<number, LocalizedSkill>();
  for (const f of listFiles(join(LOCALIZE_DIR, lang), /^Skills_personality-[\w-]+\.json$/)) {
    for (const s of localizeList<LocalizedSkill>(readJson(f))) {
      const id = Number(s.id);
      // First definition wins, as everywhere else in the localization readers.
      if (Number.isFinite(id) && !out.has(id)) out.set(id, { ...s, id });
    }
  }
  return out;
}

/** Every buff-name table the game ships: the base one plus the per-chapter and per-season files. */
const BATTLE_KEYWORD_FILES = /^BattleKeywords.*\.json$/;

/**
 * Battle keyword display names (탄환, 혈찬, 진동 - 작열 …), used both for keywords the gift
 * categories do not carry and to write the bracketed buff ids in gift text out in full.
 *
 * **All** `BattleKeywords*` files are read, not just the base one. The base file holds the 577
 * buffs common to every mode; the buffs a Mirror Dungeon gift refers to live in the season and
 * chapter tables (`BattleKeywords_Mirror7.json`, `BattleKeywords-a1c7p1.json` …), which is why
 * 37 ids used to reach the screen as `[BloodDinner]`. Together they name 1744 ids and — checked
 * across the whole set — no id is given two different names, so merge order does not matter.
 *
 * Names are trimmed: the game ships `AttackDown` as `공격 레벨 감소 ` / `Offense Level Down `, and
 * pasting that into the text verbatim reads 「[공격 레벨 감소 ] 5」 with the bracket adrift.
 */
export function readBattleKeywordNames(lang: Lang): Map<string, string> {
  const out = new Map<string, string>();
  for (const e of localizeFiles(lang, BATTLE_KEYWORD_FILES)) {
    const name = e.name?.trim();
    if (name && !out.has(String(e.id))) out.set(String(e.id), name);
  }
  return out;
}

export function readGiftCategoryNames(lang: Lang): Map<string, string> {
  const out = new Map<string, string>();
  for (const e of localizeFile(lang, 'EgoGiftCategory.json')) {
    if (e.name) out.set(String(e.id), e.name);
  }
  return out;
}

export function readLockedDescs(): Map<number, string> {
  const out = new Map<number, string>();
  for (const e of localizeFile('KR', 'MirrorDungeonEgoGiftLockedDesc.json')) {
    const id = Number(e.id);
    if (Number.isFinite(id) && e.content) out.set(id, e.content);
  }
  return out;
}
