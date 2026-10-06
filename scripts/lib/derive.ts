/**
 * Derivations shared by the build script and its tests: pack grouping, floor availability,
 * gift tiers, and identity keywords.
 */
import type {
  AttackType,
  Difficulty,
  IdentityKeywordId,
  PackGroup,
  Sin,
  StatusKeyword,
} from '../../src/core/schema.ts';
import { IDENTITY_KEYWORDS, STATUS_KEYWORDS } from '../../src/core/schema.ts';
import type { RawPersonality, RawSkill, RawThemePack } from './raw.ts';

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

/** 디버프: they count only when given to the other side. */
const DEBUFF_KEYWORDS = new Set<IdentityKeywordId>([
  'Combustion',
  'Laceration',
  'Vibration',
  'Burst',
  'Sinking',
]);

/**
 * Script names that give the buff in their `buffData`. Everything with one of these words gives;
 * `CheckAdditionalBuff*` is how 10110 and 10508 inflict a second status on the target.
 */
const GIVES = /GiveBuff|CheckAdditionalBuff/;

/**
 * Script names that only read a buff: a threshold (「호흡이 6 이상이면」, `…ViaBuffCheck`), a scale
 * (「대상의 화상과 출혈의 합 6당」, `…DivideBySumOfTwoBuffStack…`), a trigger on a buff already
 * there (진동 폭발, 침잠 쇄도), or removing it. None of them puts the keyword anywhere.
 */
const READS_ONLY =
  /Check|LoseBuff|LoseTarget|Explosion|Surge|Activ|Heal|Dmg|CoinScale|Power|Parr|Critical|TagetNum|Replace|Divide|Devide|ByBuff|Sum/;

/** Script names that spend the owner's own buff (`…ViaBuffCheckAndUse`, `UseAllChargeTurn…`). */
const SPENDS = /AndUse|Using|UseAll|UseBuffTurn|UseBuffAll|UseBuffStack/;

/** The 버프 a script spends when it names it as a suffix (`…UsingBuffTurn_Charge3`). */
const SPENT_IN_NAME = /_(Breath|Charge)\d*$/;

/**
 * Who receives a given buff. A 버프 counts for the skill user's own side — itself, or allies it
 * may be among (`LowestMpAlly1`, `EveryAlly`, a `…ToAlly…` script; the user's call, M86).
 * `Custom` scripts pick at run time: 10808's lowest-SP allies, 11211's 연료 on the enemy.
 */
const TO_OTHER_SIDE = /^(Target|Both|Custom|RandomEnemy\d*)$/;
const TO_OWN_SIDE = /^(Self|Both|Custom)$|Ally/;
const GIVES_TO_ALLY = /ToAlly/;

/**
 * Whether one `buffData` makes the skill an identity with that keyword — the rule the user set:
 * a 디버프 (화상·진동·침잠·출혈·파열) counts when the skill inflicts it on the other side, a 버프
 * (호흡·충전) when the skill gives it to itself — or to allies, which it may be among — or spends
 * its own.
 *
 * `keyword` is the base keyword the buff belongs to (a 특수 variant passes its base). The script
 * name decides give vs read; `target` decides the side, `buffOwner` whose buff is spent.
 */
export function buffCounts(
  keyword: IdentityKeywordId,
  scriptName: string,
  buffData: { target?: unknown; buffOwner?: unknown },
): boolean {
  const target = typeof buffData.target === 'string' ? buffData.target : '';
  const gives = target !== '' && (GIVES.test(scriptName) || !READS_ONLY.test(scriptName));
  if (DEBUFF_KEYWORDS.has(keyword)) return gives && TO_OTHER_SIDE.test(target);
  if (gives && (TO_OWN_SIDE.test(target) || GIVES_TO_ALLY.test(scriptName))) return true;
  return buffData.buffOwner === 'Self' && SPENDS.test(scriptName);
}

/**
 * Keywords one skill uses, split into the base keyword (`buffKeyword: "Charge"`, ammo required as
 * plain `Bullet`) and the 특수 variants.
 *
 * A status counts only when `buffCounts` says the skill gives or spends it — a skill that merely
 * reads a keyword (「[Breath]이 6 이상이면」) is not an identity of that keyword. `buffData` and a
 * conditional ability's `resultBuffData` are read against the nearest script name above them;
 * `conditionBuffData` is the condition and never counts. `anyMention` is the old reading, where a
 * mention anywhere counted — the validator compares the derived source against it.
 *
 * A 특수 variant shows up either as a `buffKeyword` of its own (`NailPersonality`, `DarkFlame`) or —
 * for 생체 재료 (특수 충전) — only in the names of the ability scripts that grant and spend it
 * (`MarkGiveChargeBodyArtTurn`, `MarkSubKeywordChargeBodyArt`), so a script name containing the
 * buff id counts too. For a 디버프 variant the name must say it gives that variant
 * (`GiveSinkingWhitePerConsumedBulletLamentToHitedTarget`, 10110) — elsewhere the name can just as
 * well be a check (`GiveBuffOnSucceedAttackIfHasStack_NailPersonality1`).
 * Variant ids come from `readSpecialVariants()`, never from a hard-coded list.
 *
 * 탄환 is different: it is a resource the skill spends, so it is read off the requirement token
 * instead. An ammo id the game never localizes (`BulletLament`, `AccelBullet`) is not marked
 * 특수 anywhere, so it counts as plain 탄환.
 */
function keywordsInSkill(
  skill: RawSkill,
  specialVariants: Map<string, IdentityKeywordId>,
  anyMention = false,
): { base: Set<IdentityKeywordId>; special: Set<IdentityKeywordId> } {
  const base = new Set<IdentityKeywordId>();
  const special = new Set<IdentityKeywordId>();
  const visit = (node: unknown, key: string, scriptName: string): void => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item, key, scriptName);
      return;
    }
    if (!node || typeof node !== 'object') return;
    const obj = node as Record<string, unknown>;
    const script = typeof obj['scriptName'] === 'string' ? obj['scriptName'] : scriptName;
    const kw = obj['buffKeyword'];
    if (typeof kw === 'string' && key !== 'conditionBuffData') {
      const variant = specialVariants.get(kw);
      const keyword = STATUS_SET.has(kw) ? (kw as StatusKeyword) : variant;
      if (keyword && (anyMention || buffCounts(keyword, script, obj))) {
        if (STATUS_SET.has(kw)) base.add(keyword);
        else special.add(keyword);
      }
    }
    if (typeof obj['scriptName'] === 'string') {
      // A spend named only in the script: `GiveBuffOnSuccessAttackUsingBuffTurn_Charge3` gives a
      // different buff in its `buffData`, paid for with the user's own 충전 (10503, 10506).
      const spent = SPENT_IN_NAME.exec(script)?.[1] as IdentityKeywordId | undefined;
      if (spent && SPENDS.test(script)) base.add(spent);
      for (const [id, variant] of specialVariants) {
        if (!script.includes(id)) continue;
        if (anyMention || !DEBUFF_KEYWORDS.has(variant) || script.includes(`Give${id}`)) special.add(variant);
      }
      for (const [, required] of script.matchAll(SKILL_REQUIREMENT)) {
        if (!required || !AMMO_BUFF_ID.test(required)) continue;
        if (!specialVariants.has(required)) base.add('Bullet');
      }
    }
    for (const [childKey, value] of Object.entries(obj)) visit(value, childKey, script);
  };
  visit(skill.skillData ?? [], '', '');
  return { base, special };
}

/**
 * The identity's base attack skills — S1, S2 and S3.
 *
 * `attributeList[].number` is how many copies of the skill go into the deck: 3/2/1 for S1/S2/S3,
 * and 0 for an enhanced skill that only replaces one of them under a condition (suffix 05 and up;
 * 40 of 188 identities have at least one). The identity's keywords, sins and attack types are read
 * off the base three only, as the game shows them.
 */
export function baseAttackSkillIds(personality: RawPersonality): number[] {
  return (personality.attributeList ?? []).filter((entry) => entry.number > 0).map((entry) => entry.skillId);
}

/**
 * Which keywords an identity's base attack skills use, and how many skills do it.
 *
 * Only the base S1/S2/S3 count (`baseAttackSkillIds`) — the unit conditional gifts measure
 * ("부여하는 공격 스킬을 보유한 인격"). An enhanced skill an S3 turns into under a condition (10212's
 * 「흑수 묘 오의 - 운해현현」 is the only one that grants 호흡) is not a skill the identity has.
 * And a skill counts for a keyword only when it inflicts the 디버프 on the other side, or gives
 * itself / spends the 버프 (`buffCounts`): reading 「[Breath]이 6 이상이면」 makes 10916 no 호흡 user.
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
  {
    includeExtra = false,
    anyMention = false,
    alsoFrom,
  }: {
    /**
     * Count the enhanced skills too, and (`anyMention`) any keyword a skill so much as names. Only
     * the validator's cross-check wants these — the derived source's list was built that way, so
     * it needs the same reading to tell a keyword we dropped on purpose from one we lost.
     */
    includeExtra?: boolean;
    anyMention?: boolean;
    /**
     * Keywords the same skill gives by another reading — the build passes the Korean skill text
     * (`keywordsInSkillText`). Some grants have no machine-readable `buffData` at all: 11115's
     * 화상 comes from `GiveBuffOnSuccedAttackIfHasSwordBuff11115`, which only the sentence explains.
     * The two are joined per skill, so a skill is counted once whichever reading saw it.
     */
    alsoFrom?: (
      skillId: number,
    ) => { base: Set<IdentityKeywordId>; special: Set<IdentityKeywordId> } | undefined;
  } = {},
): IdentityKeywordCounts {
  const baseCounts = new Map<IdentityKeywordId, number>();
  const specialCounts = new Map<IdentityKeywordId, number>();
  const ids = includeExtra
    ? (personality.attributeList ?? []).map((entry) => entry.skillId)
    : baseAttackSkillIds(personality);
  for (const id of ids) {
    const skill = skills.get(id);
    if (!skill) continue;
    if (skill.skillType && skill.skillType !== 'SKILL') continue;
    const found = keywordsInSkill(skill, specialVariants, anyMention);
    const more = alsoFrom?.(id);
    for (const kw of more?.base ?? []) found.base.add(kw);
    for (const kw of more?.special ?? []) found.special.add(kw);
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
