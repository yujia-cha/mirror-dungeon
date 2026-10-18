/**
 * Per-skill identity facts (M129): what each base attack skill S1~S3 is — sin, attack type, attack
 * weight, coins and the keywords it uses — plus the identity's defense kinds and the buffs it
 * brings. The 추천 기프트 judgement reads these against one gift effect at a time (「참격 스킬」,
 * 「단일 코인 스킬」, 「반격 스킬」, 「[각력【묘】]」 …), so nothing here may guess: a field a source does
 * not state is null.
 */
import type {
  AttackType,
  DefenseType,
  Identity,
  IdentityKeywordId,
  IdentitySkill,
  SkillMechanic,
} from '../../src/core/schema.ts';
import { IDENTITY_KEYWORDS, STATUS_KEYWORDS } from '../../src/core/schema.ts';
import type { SelfUse, SkillKeywords } from './derive.ts';
import {
  ATTACK_BY_TYPE,
  derivedAttackSkillIds,
  SIN_BY_AFFINITY,
  type DerivedIdentity,
} from './derived-source.ts';
import { SIN_BY_COLOR, type RawSkill, type RawSkillData } from './raw.ts';

export const ATTACK_TYPE_BY_RAW: Record<string, AttackType> = {
  SLASH: 'Slash',
  PENETRATE: 'Penetrate',
  HIT: 'Hit',
};

/** `defType` of a defense skill. ATTACK (an attack skill) and anything new map to nothing. */
export const DEFENSE_TYPE_BY_RAW: Record<string, DefenseType> = {
  GUARD: 'guard',
  EVADE: 'evade',
  COUNTER: 'counter',
};

/** S1/S2/S3 by the id suffix 01–03 — the same suffixes `baseAttackSkillIds` picks on every identity. */
export function slotOfSkill(skillId: number): 1 | 2 | 3 | null {
  const suffix = skillId % 100;
  return suffix === 1 || suffix === 2 || suffix === 3 ? suffix : null;
}

/**
 * The value of one field at the highest uptie level that states it. `skillData` is a list of
 * deltas, so the last entry holding the field is what the identity has at full uptie.
 */
function latest<K extends keyof RawSkillData>(skill: RawSkill, key: K): RawSkillData[K] | undefined {
  let value: RawSkillData[K] | undefined;
  for (const data of skill.skillData ?? []) {
    const v = data[key];
    if (v !== undefined && !(Array.isArray(v) && v.length === 0)) value = v;
  }
  return value;
}

/** The keyword flags of one skill, in `IDENTITY_KEYWORDS` order, only keywords it uses. */
export function skillKeywordFlags(found: SkillKeywords | undefined): IdentitySkill['keywords'] {
  const out: IdentitySkill['keywords'] = {};
  if (!found) return out;
  for (const kw of IDENTITY_KEYWORDS) {
    const base = found.base.has(kw);
    const special = found.special.has(kw);
    if (base || special) out[kw as IdentityKeywordId] = { base, special };
  }
  return out;
}

/**
 * `skills[].self` from the readings of one skill, joined (any reading that saw a gain or a spend
 * counts), keys in `STATUS_KEYWORDS` order and only keywords with something true.
 */
export function selfFlags(...readings: (SelfUse | undefined)[]): NonNullable<IdentitySkill['self']> {
  const out: NonNullable<IdentitySkill['self']> = {};
  for (const kw of STATUS_KEYWORDS) {
    const gain = readings.some((r) => r?.get(kw)?.gain === true);
    const consume = readings.some((r) => r?.get(kw)?.consume === true);
    if (gain || consume) out[kw] = { gain, consume };
  }
  return out;
}

/**
 * One base skill from the static data. Sin and attack type are read off the first `skillData`
 * entry, exactly as the identity's `sins`/`attackTypes` are, so the two can never disagree; the
 * weight and the coins off the highest uptie level that states them. None of the four moves across
 * uptie levels on any base skill today (checked at M129) — `data:validate` would see the sins split.
 */
export function staticSkillFacts(
  skillId: number,
  skill: RawSkill | undefined,
  keywords: SkillKeywords | undefined,
  /** `selfFlags` of the skill's scripts and sentence. The scripts are always there, so it is always set. */
  self: NonNullable<IdentitySkill['self']> = {},
  /** `mechanicsInSkillText` of the skill's sentence (M150); none leaves the field out. */
  mechanics: SkillMechanic[] = [],
): IdentitySkill {
  const slot = slotOfSkill(skillId);
  if (slot === null) throw new Error(`skill ${skillId} is a base attack skill without suffix 01–03`);
  const first = skill?.skillData?.[0];
  const coins = skill ? latest(skill, 'coinList') : undefined;
  const weight = skill ? latest(skill, 'targetNum') : undefined;
  return {
    slot,
    sin: (first?.attributeType && SIN_BY_COLOR[first.attributeType]) || null,
    attackType: (first?.atkType && ATTACK_TYPE_BY_RAW[first.atkType]) || null,
    weight: typeof weight === 'number' && weight > 0 ? weight : null,
    coins: coins
      ? {
          count: coins.length,
          plus: coins.some((coin) => coin.operatorType === 'ADD'),
          minus: coins.some((coin) => coin.operatorType === 'SUB'),
          unbreakable: coins.some((coin) => coin.color === 'GREY'),
        }
      : null,
    keywords: skillKeywordFlags(keywords),
    self,
    ...(mechanics.length > 0 ? { mechanics } : {}),
  };
}

/** Defense kinds of the given `defType` values (any uptie level), sorted, and the values that mapped to none. */
export function defenseTypesOf(defTypes: Iterable<string | undefined>): {
  types: DefenseType[];
  unknown: string[];
} {
  const types = new Set<DefenseType>();
  const unknown = new Set<string>();
  for (const raw of defTypes) {
    if (!raw) continue;
    const type = DEFENSE_TYPE_BY_RAW[raw];
    if (type) types.add(type);
    else unknown.add(raw);
  }
  return { types: [...types].sort(), unknown: [...unknown].sort() };
}

/** The `defType` values of a static skill, every uptie level. */
export function defTypesOfSkill(skill: RawSkill | undefined): string[] {
  return (skill?.skillData ?? [])
    .map((data) => data.defType)
    .filter((t): t is string => typeof t === 'string');
}

/**
 * The base skills of an identity the static data does not ship, from the derived mirror: slot by
 * the id suffix, sin and attack type from its `type`. The mirror states neither the attack weight
 * nor the coins, so both are null; the keywords are the Korean skill text's (`keywords`).
 */
export function derivedSkillFacts(
  entry: DerivedIdentity,
  keywords: Map<number, SkillKeywords>,
  /**
   * The sentence's `selfKeywordsInSkillText`, by skill id. With no scripts behind it, a sentence that
   * says nothing about the user's own 디버프 is not proof of none (it misses a bare 「[화상] 7 얻음」),
   * so `self` is set only when the sentence names something — otherwise it stays out, 「모름」.
   */
  self: Map<number, SelfUse> = new Map(),
  /** `mechanicsInSkillText` by skill id (M150). */
  mechanics: Map<number, SkillMechanic[]> = new Map(),
): IdentitySkill[] {
  const out: IdentitySkill[] = [];
  const base = new Set(derivedAttackSkillIds(entry));
  for (const skill of entry.skillTypes ?? []) {
    const id = Number(skill.id);
    const slot = slotOfSkill(id);
    if (!base.has(id) || slot === null) continue;
    out.push({
      slot,
      sin: (skill.type?.affinity && SIN_BY_AFFINITY[skill.type.affinity]) || null,
      attackType: (skill.type?.type && ATTACK_BY_TYPE[skill.type.type]) || null,
      weight: null,
      coins: null,
      keywords: skillKeywordFlags(keywords.get(id)),
      ...(self.has(id) && self.get(id)!.size > 0 ? { self: selfFlags(self.get(id)) } : {}),
      ...(mechanics.get(id)?.length ? { mechanics: mechanics.get(id)! } : {}),
    });
  }
  return out.sort((a, b) => a.slot - b.slot);
}

function sameSet(a: Iterable<string>, b: Iterable<string>): boolean {
  const x = new Set(a);
  const y = new Set(b);
  return x.size === y.size && [...x].every((v) => y.has(v));
}

/**
 * What is wrong with one identity's per-skill data, as messages (empty when nothing is). The
 * per-skill keyword flags must add up to the identity's counts — `base` to `keywords[K].skills`,
 * `special` to `specialSkills`, each skill on its own (a skill with both counts in both) — and the
 * sins and attack types the skills name must be the identity's. A curated identity's keywords are
 * written by hand and are no sum of anything, so only the slot check applies to it.
 */
export function identitySkillProblems(identity: Identity): string[] {
  const skills = identity.skills;
  if (!skills) return [];
  const problems: string[] = [];
  const slots = skills.map((s) => s.slot);
  if (new Set(slots).size !== slots.length) problems.push(`two skills share a slot (${slots.join(', ')})`);
  if (identity.keywordSource === 'curated') return problems;
  for (const kw of IDENTITY_KEYWORDS) {
    const base = skills.filter((s) => s.keywords[kw]?.base).length;
    const special = skills.filter((s) => s.keywords[kw]?.special).length;
    const counts = identity.keywords[kw] ?? { skills: 0, specialSkills: 0 };
    if (base !== counts.skills || special !== counts.specialSkills) {
      problems.push(
        `${kw}: skills say ${base} base / ${special} special, keywords say ${counts.skills} / ${counts.specialSkills}`,
      );
    }
  }
  const sins = skills.flatMap((s) => (s.sin ? [s.sin] : []));
  if (!sameSet(sins, identity.sins))
    problems.push(`skill sins ${sins.join('/')} differ from sins ${identity.sins.join('/')}`);
  const types = skills.flatMap((s) => (s.attackType ? [s.attackType] : []));
  if (!sameSet(types, identity.attackTypes))
    problems.push(
      `skill attack types ${types.join('/')} differ from attackTypes ${identity.attackTypes.join('/')}`,
    );
  return problems;
}
