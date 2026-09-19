/**
 * Derivations shared by the build script and its tests: pack grouping, floor availability,
 * gift tiers, and identity keywords.
 */
import type {
  AttackType,
  Difficulty,
  IdentitySkill,
  IdentityKeywordId,
  PackGroup,
  Sin,
  SkillSlot,
  StatusKeyword,
} from '../../src/core/schema.ts';
import { IDENTITY_KEYWORDS, STATUS_KEYWORDS } from '../../src/core/schema.ts';
import type { RawPersonality, RawSkill, RawThemePack } from './raw.ts';

/**
 * The static data's skill colour -> 죄악. Verified against identity 10101 (참격/우울, 관통/질투,
 * 참격/나태) — see docs/research/mechanics.md.
 */
export const SIN_BY_COLOR: Record<string, Sin> = {
  CRIMSON: 'WRATH',
  SCARLET: 'LUST',
  AMBER: 'SLOTH',
  SHAMROCK: 'GLUTTONY',
  AZURE: 'GLOOM',
  INDIGO: 'PRIDE',
  VIOLET: 'ENVY',
};

/** `dungeonIdx` in the static data maps onto the four run modes. */
export const DIFFICULTY_BY_DUNGEON_IDX: Record<number, Difficulty> = {
  0: 'normal',
  1: 'hard',
  2: 'parallel',
  3: 'extreme',
};

/** Floors each mode covers, used when a condition omits `selectableFloors`. */
export const MODE_FLOORS: Record<Difficulty, number[]> = {
  normal: [1, 2, 3, 4, 5],
  hard: [1, 2, 3, 4, 5],
  parallel: [6, 7, 8, 9, 10],
  extreme: [11, 12, 13, 14, 15],
};

export function groupForPackId(id: number): PackGroup {
  if (id >= 1001 && id <= 1099) return 'chapter';
  if (id >= 1101 && id <= 1199) return 'event';
  if (id >= 1201 && id <= 1299) return 'attackType';
  if (id >= 1301 && id <= 1399) return 'sin';
  if (id >= 1401 && id <= 1499) return 'keyword';
  if (id >= 1501 && id <= 1599) return 'longBattle';
  return 'hidden';
}

/**
 * Resolve a pack's floors per mode.
 *
 * `selectableFloors` is 0-indexed within the mode's own range, so Normal/Hard entry `[0,1]` means
 * floors 1 and 2. Parallel and Extreme entries usually omit the list, which means "any floor of
 * that mode" — confirmed against OpenLethe's `MdMapGen.RecreateThemes`.
 */
export function availabilityFor(pack: RawThemePack): Record<Difficulty, number[]> {
  const out: Record<Difficulty, number[]> = { normal: [], hard: [], parallel: [], extreme: [] };
  for (const cond of pack.exceptionConditions ?? []) {
    const mode = DIFFICULTY_BY_DUNGEON_IDX[cond.dungeonIdx];
    if (!mode) continue;
    const floors =
      cond.selectableFloors && cond.selectableFloors.length > 0
        ? cond.selectableFloors.map((f) => f + 1).filter((f) => MODE_FLOORS[mode].includes(f))
        : [...MODE_FLOORS[mode]];
    out[mode] = [...new Set([...out[mode], ...floors])].sort((a, b) => a - b);
  }
  return out;
}


/** Korean keyword names as the game's own text writes them (pack dev names, 특수 variant lines). */
export const STATUS_KEYWORD_BY_KO: Record<string, StatusKeyword> = {
  화상: 'Combustion',
  출혈: 'Laceration',
  진동: 'Vibration',
  파열: 'Burst',
  침잠: 'Sinking',
  호흡: 'Breath',
  충전: 'Charge',
};

/**
 * The same map plus 탄환, for reading identity keywords. Pack dev names keep using the status-only
 * map above so a pack can never end up with a 탄환 affinity.
 */
export const IDENTITY_KEYWORD_BY_KO: Record<string, IdentityKeywordId> = {
  ...STATUS_KEYWORD_BY_KO,
  탄환: 'Bullet',
};

const SIN_BY_KO: Record<string, Sin> = {
  분노: 'WRATH',
  색욕: 'LUST',
  나태: 'SLOTH',
  탐식: 'GLUTTONY',
  우울: 'GLOOM',
  오만: 'PRIDE',
  질투: 'ENVY',
};

const ATTACK_BY_KO: Record<string, AttackType> = {
  참격: 'Slash',
  관통: 'Penetrate',
  타격: 'Hit',
};

/**
 * The keyword/sin/attack-type packs encode their theme in the developer `desc`
 * ("화상-1", "분노약점-1", "참격-1"), which is the only machine-readable signal for it.
 */
export function affinitiesFromDevName(devName: string): {
  keyword: StatusKeyword | null;
  sin: Sin | null;
  attackType: AttackType | null;
} {
  const head = devName.replace(/[-\s]?\d+$/, '').replace(/약점$/, '');
  return {
    keyword: STATUS_KEYWORD_BY_KO[head] ?? null,
    sin: SIN_BY_KO[head] ?? null,
    attackType: ATTACK_BY_KO[head] ?? null,
  };
}

export function tierFromTags(tags: string[]): 1 | 2 | 3 | 4 | 5 | 'EX' | null {
  if (tags.includes('TIER_EX')) return 'EX';
  for (const tag of tags) {
    const m = /^(?:EXTRA_)?TIER_?(\d)$/.exec(tag);
    if (m) {
      const n = Number(m[1]);
      if (n >= 1 && n <= 5) return n as 1 | 2 | 3 | 4 | 5;
    }
  }
  return null;
}

/** Identity id is `1SSNN`: sinner 01-12, then the identity index. */
export function sinnerIdFromIdentityId(id: number): number {
  return Math.floor(id / 100) % 100;
}

const STATUS_SET = new Set<string>(STATUS_KEYWORDS);

export type IdentityKeywordCounts = Partial<
  Record<IdentityKeywordId, { skills: number; specialSkills: number }>
>;

/**
 * A skill states the buff it needs inside its script name: `UseBullet[necessary:BulletGodok:1]`,
 * `DmgUpByBullet1091607_50[optional:AccelBullet:::…]`. This is the only place ammo is named, since
 * 탄환 is spent rather than inflicted and so never appears as a `buffKeyword`.
 */
const SKILL_REQUIREMENT = /\[(?:necessary|optional):([A-Za-z0-9_]+)/g;

/** Every ammo buff the game ships carries `Bullet` in its id: 호표탄, 포자탄, LCA 균열탄, 탄환 - 고독 … */
const AMMO_BUFF_ID = /Bullet/;

/**
 * Keywords one skill uses, split into the base keyword (`buffKeyword: "Charge"`, ammo required as
 * plain `Bullet`) and the 특수 variants.
 *
 * A 특수 variant shows up either as a `buffKeyword` of its own (`NailPersonality`, `DarkFlame`) or —
 * for 생체 재료 (특수 충전) — only in the names of the ability scripts that grant and spend it
 * (`MarkGiveChargeBodyArtTurn`, `MarkSubKeywordChargeBodyArt`), so a script name containing the
 * buff id counts too. Variant ids come from `readSpecialVariants()`, never from a hard-coded list.
 *
 * 탄환 is different: it is a resource the skill spends, so it is read off the requirement token
 * instead. An ammo id the game never localizes (`BulletLament`, `AccelBullet`) is not marked
 * 특수 anywhere, so it counts as plain 탄환.
 */
function keywordsInSkill(
  skill: RawSkill,
  specialVariants: Map<string, IdentityKeywordId>,
): { base: Set<IdentityKeywordId>; special: Set<IdentityKeywordId> } {
  const base = new Set<IdentityKeywordId>();
  const special = new Set<IdentityKeywordId>();
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (node && typeof node === 'object') {
      const obj = node as Record<string, unknown>;
      const kw = obj['buffKeyword'];
      if (typeof kw === 'string') {
        if (STATUS_SET.has(kw)) base.add(kw as StatusKeyword);
        const variant = specialVariants.get(kw);
        if (variant) special.add(variant);
      }
      const script = obj['scriptName'];
      if (typeof script === 'string') {
        for (const [id, variant] of specialVariants) if (script.includes(id)) special.add(variant);
        for (const [, required] of script.matchAll(SKILL_REQUIREMENT)) {
          if (!required || !AMMO_BUFF_ID.test(required)) continue;
          if (!specialVariants.has(required)) base.add('Bullet');
        }
      }
      for (const value of Object.values(obj)) visit(value);
    }
  };
  visit(skill.skillData ?? []);
  return { base, special };
}

/**
 * Which keywords an identity's base attack skills use, and how many skills do it.
 *
 * `attributeList` holds exactly the identity's base attack skills, so this counts attack skills
 * only — which is the unit conditional gifts measure ("부여하는 공격 스킬을 보유한 인격").
 *
 * `skills` counts the base keyword, `specialSkills` the 특수 variant (see `keywordsInSkill`).
 * The game's conditions treat them differently — 「[Charge] 횟수 또는 특수 충전을 획득하는」 counts
 * both, 「[Laceration]을 부여하는」 only the base — so they are kept apart here and in the planner.
 * `data/curated/identity-keywords.json` still overrides both when the derivation is wrong.
 */
export function deriveIdentityKeywords(
  personality: RawPersonality,
  skills: Map<number, RawSkill>,
  specialVariants: Map<string, IdentityKeywordId> = new Map(),
): IdentityKeywordCounts {
  const baseCounts = new Map<IdentityKeywordId, number>();
  const specialCounts = new Map<IdentityKeywordId, number>();
  for (const entry of personality.attributeList ?? []) {
    const skill = skills.get(entry.skillId);
    if (!skill) continue;
    if (skill.skillType && skill.skillType !== 'SKILL') continue;
    const found = keywordsInSkill(skill, specialVariants);
    for (const kw of found.base) baseCounts.set(kw, (baseCounts.get(kw) ?? 0) + 1);
    for (const kw of found.special) specialCounts.set(kw, (specialCounts.get(kw) ?? 0) + 1);
  }
  const out: IdentityKeywordCounts = {};
  for (const kw of IDENTITY_KEYWORDS) {
    const n = baseCounts.get(kw) ?? 0;
    const s = specialCounts.get(kw) ?? 0;
    if (n + s > 0) out[kw] = { skills: n, specialSkills: s };
  }
  return out;
}

/** `atkType` in the static skill data -> the attack type the app names. `NONE` is a non-attack. */
const ATTACK_BY_ATK_TYPE: Record<string, AttackType> = {
  SLASH: 'Slash',
  PENETRATE: 'Penetrate',
  HIT: 'Hit',
};

/** The slot a skill sits in, from `skillTier`, falling back to the id's last two digits. */
function slotOf(skill: RawSkill): SkillSlot | null {
  const tier = skill.skillTier ?? Number(String(skill.id).slice(-2));
  return tier === 1 || tier === 2 || tier === 3 ? tier : null;
}

/**
 * An identity's base attack skills as a table: slot, 죄악 속성, 공격 유형, and how many copies the
 * slot deck holds.
 *
 * `attributeList` is exactly the base attack skills, so this reads the same list
 * `deriveIdentityKeywords` does — but it keeps each skill apart instead of counting them, because
 * gift effects say 「참격 유형인 스킬 1」 and the flat `sins`/`attackTypes` sets cannot answer that.
 *
 * `skillData[0]` is the gaksung-1 row; the later rows are deltas and never restate 속성 or 유형.
 * A slot can hold more than one skill (a conditional alternate form, `number: 0`), so the result is
 * a list rather than one row per slot.
 */
export function deriveIdentitySkills(
  personality: RawPersonality,
  skills: Map<number, RawSkill>,
): IdentitySkill[] {
  const out: { skill: IdentitySkill; id: number }[] = [];
  for (const entry of personality.attributeList ?? []) {
    const skill = skills.get(entry.skillId);
    if (!skill) continue;
    if (skill.skillType && skill.skillType !== 'SKILL') continue;
    const slot = slotOf(skill);
    if (slot === null) continue;
    const data = skill.skillData?.[0];
    out.push({
      id: skill.id,
      skill: {
        slot,
        sin: data?.attributeType ? (SIN_BY_COLOR[data.attributeType] ?? null) : null,
        attackType: data?.atkType ? (ATTACK_BY_ATK_TYPE[data.atkType] ?? null) : null,
        copies: Math.max(0, entry.number ?? 0),
      },
    });
  }
  return sortIdentitySkills(out);
}

/**
 * One deterministic table for every layer: slot, then the always-there skill before its alternate,
 * then skill id.
 *
 * Rows that agree on all three axes are folded together, keeping the largest `copies`. An identity
 * can carry several alternate forms of the same skill (오티스 has six slot-3 rows, all 타격/질투),
 * and repeating an identical row says nothing except that the game stores it more than once.
 */
export function sortIdentitySkills(rows: { skill: IdentitySkill; id: number }[]): IdentitySkill[] {
  const byAxes = new Map<string, { skill: IdentitySkill; id: number }>();
  for (const row of rows) {
    const key = `${row.skill.slot}|${row.skill.sin ?? ''}|${row.skill.attackType ?? ''}`;
    const seen = byAxes.get(key);
    if (!seen) {
      byAxes.set(key, { id: row.id, skill: { ...row.skill } });
      continue;
    }
    if (row.skill.copies > seen.skill.copies) {
      seen.skill.copies = row.skill.copies;
      seen.id = row.id;
    }
  }
  return [...byAxes.values()]
    .sort((a, b) => a.skill.slot - b.skill.slot || b.skill.copies - a.skill.copies || a.id - b.id)
    .map((row) => row.skill);
}

/** Remove Unity rich-text markup and report whether the name was struck through (deprecated). */
export function cleanFactionName(raw: string): { name: string; deprecated: boolean } {
  const deprecated = /<s>/.test(raw);
  const name = raw.replace(/<[^>]*>/g, '').trim();
  return { name, deprecated };
}

/** Tier order for 조합 계승: 'EX' sits above 5. */
function tierRank(tier: 1 | 2 | 3 | 4 | 5 | 'EX' | null): number | null {
  if (tier === null) return null;
  return tier === 'EX' ? 6 : tier;
}

/**
 * 조합 계승 (`upgradeOf`): ingredient → the one result it upgrades into.
 *
 * An ingredient qualifies when, across every fixed recipe, it feeds exactly one result gift, the
 * two share a status keyword (never `None`), and the result's tier is strictly higher. Such a gift
 * is only ever wanted as a step towards its result, so the UI folds it under the result.
 */
export function deriveUpgradeOf(
  recipesByResult: Map<number, number[][]>,
  giftById: Map<number, { keyword: string; tier: 1 | 2 | 3 | 4 | 5 | 'EX' | null }>,
): Map<number, number> {
  const resultsByIngredient = new Map<number, Set<number>>();
  for (const [result, recipes] of recipesByResult) {
    for (const ingredients of recipes) {
      for (const ingredient of ingredients) {
        const set = resultsByIngredient.get(ingredient) ?? new Set<number>();
        set.add(result);
        resultsByIngredient.set(ingredient, set);
      }
    }
  }
  const out = new Map<number, number>();
  for (const [ingredient, results] of resultsByIngredient) {
    if (results.size !== 1) continue;
    const result = [...results][0]!;
    const lower = giftById.get(ingredient);
    const higher = giftById.get(result);
    if (!lower || !higher) continue;
    if (lower.keyword === 'None' || lower.keyword !== higher.keyword) continue;
    const lo = tierRank(lower.tier);
    const hi = tierRank(higher.tier);
    if (lo === null || hi === null || lo >= hi) continue;
    out.set(ingredient, result);
  }
  return out;
}
