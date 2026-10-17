import type {
  ConditionScope,
  EffectRequirement,
  Gift,
  GiftEffect,
  Identity,
  IdentitySkill,
  SkillGiftIndex,
} from './schema.ts';
import { STATUS_KEYWORDS } from './schema.ts';
import type { DeckStats } from './types.ts';

/**
 * Whether the deck can use a gift (M129, 추천 기프트). A gift is read as effects (`gift.effects`, built
 * from its description); an effect is usable when the deck meets every requirement it and the gift's
 * gates name. Requirements the deck can never fail — a state on an enemy, a battle situation — were
 * left out at build time, so an effect without requirements is unconditional.
 */

const STATUS_SET = new Set<string>(STATUS_KEYWORDS);

/**
 * `deck`: a usable effect asks something of the deck. `ego`: only an E.G.O skill condition (always
 * met, M129) does. `free`: only unconditional effects are usable.
 */
export type GiftRelevance = 'deck' | 'ego' | 'free';

export interface RequirementReport {
  requirement: EffectRequirement;
  /** Identities in the requirement's scope that meet it. */
  have: number;
  need: number;
  satisfied: boolean;
  /** Identities the data cannot judge (no per-skill facts) — never counted as meeting it. */
  unknown: number;
  /** The identities that meet it, in deck order, with the base skills that do (empty: the identity as a whole). */
  matches: Array<{ id: number; slots: Array<1 | 2 | 3> }>;
}

export interface EffectReport {
  /** Position in `gift.effects`. */
  index: number;
  kind: GiftEffect['kind'];
  requirements: RequirementReport[];
  /** Every requirement here is met. A note is never usable. */
  usable: boolean;
  unconditional: boolean;
  unclassified: boolean;
}

export interface GiftEffectsReport {
  giftId: number;
  /** Requirements of the gift's gates; all must hold before any effect counts. */
  gates: RequirementReport[];
  gateOpen: boolean;
  effects: EffectReport[];
  relevance: GiftRelevance | null;
}

type Verdict = boolean | null;

function scopeMembers(stats: DeckStats, scope: ConditionScope): number[] {
  if (scope === 'deployed') return stats.deployed;
  if (scope === 'reserve') return stats.reserve;
  return [...stats.deployed, ...stats.reserve];
}

/** True, false, or null when some skill could not be judged and none matched. */
function anySkill(skills: readonly IdentitySkill[], test: (skill: IdentitySkill) => Verdict): Verdict {
  let unknown = false;
  for (const skill of skills) {
    const verdict = test(skill);
    if (verdict === true) return true;
    if (verdict === null) unknown = true;
  }
  return unknown ? null : false;
}

/**
 * 탄환·혈찬 have no 특수 variant, so their 특수 entries are the keyword itself; the status keywords count
 * a 특수-only skill only when the sentence says 「또는 특수 X」.
 */
function countsSpecial(keyword: string, includesSpecial: boolean): boolean {
  return includesSpecial || !STATUS_SET.has(keyword);
}

function shapeMatches(skill: IdentitySkill, kind: string, n: number | undefined): Verdict {
  const { coins, weight } = skill;
  switch (kind) {
    case 'singleCoin':
      return coins ? coins.count === 1 : null;
    case 'coinsAtMost':
      return coins && n !== undefined ? coins.count <= n : null;
    case 'coinsAtLeast':
      return coins && n !== undefined ? coins.count >= n : null;
    case 'plusCoin':
      return coins ? coins.plus : null;
    case 'minusCoin':
      return coins ? coins.minus : null;
    case 'unbreakableCoin':
      return coins ? coins.unbreakable : null;
    case 'weightAtLeast':
      return weight !== null && n !== undefined ? weight >= n : null;
    case 'weightExactly':
      return weight !== null && n !== undefined ? weight === n : null;
    default:
      return null;
  }
}

type SkillTest = (skill: IdentitySkill) => Verdict;

/**
 * The per-skill test of a requirement that one base skill meets (keyword, slot, sin and type, coins,
 * own keyword), or null for one the identity as a whole meets (faction, buff, defense …).
 */
function skillTest(requirement: EffectRequirement): SkillTest | null {
  switch (requirement.type) {
    case 'skillKeyword': {
      const { keywords, includesSpecial, slot } = requirement;
      return (skill) =>
        (slot === undefined || skill.slot === slot) &&
        keywords.some((keyword) => {
          const use = skill.keywords[keyword];
          return !!use && (use.base || (use.special && countsSpecial(keyword, includesSpecial)));
        });
    }
    case 'skill':
    case 'resonance': {
      const sins = requirement.sins;
      const attackTypes = requirement.type === 'skill' ? requirement.attackTypes : undefined;
      return (skill) => {
        if (sins && (skill.sin === null || !sins.includes(skill.sin)))
          return skill.sin === null ? null : false;
        if (attackTypes && (skill.attackType === null || !attackTypes.includes(skill.attackType)))
          return skill.attackType === null ? null : false;
        return true;
      };
    }
    case 'shape':
      return (skill) => shapeMatches(skill, requirement.kind, requirement.n);
    case 'selfKeyword': {
      const { keywords, verb } = requirement;
      return (skill) =>
        skill.self ? keywords.some((keyword) => skill.self![keyword]?.[verb] === true) : null;
    }
    default:
      return null;
  }
}

/** Does one identity meet the requirement? Null when its data cannot tell. */
export function identityMeets(identity: Identity, requirement: EffectRequirement): Verdict {
  const skills = identity.skills && identity.skills.length > 0 ? identity.skills : null;
  const test = skillTest(requirement);
  if (test && skills) return anySkill(skills, test);
  switch (requirement.type) {
    case 'skillKeyword': {
      // Without per-skill facts only a slot-free requirement can be read off the totals.
      const { keywords, includesSpecial, slot } = requirement;
      if (slot !== undefined) return null;
      return keywords.some((keyword) => {
        const info = identity.keywords[keyword];
        return (
          !!info && (info.skills > 0 || (info.specialSkills > 0 && countsSpecial(keyword, includesSpecial)))
        );
      });
    }
    case 'skill':
    case 'resonance': {
      const sins = requirement.sins;
      const attackTypes = requirement.type === 'skill' ? requirement.attackTypes : undefined;
      // The totals cannot tell whether one skill has both.
      if (sins && attackTypes) return null;
      if (sins) return sins.some((sin) => identity.sins.includes(sin));
      if (attackTypes) return attackTypes.some((type) => identity.attackTypes.includes(type));
      return null;
    }
    case 'shape':
    case 'selfKeyword':
      return null;
    case 'identityBuff':
      return identity.buffs ? requirement.buffs.some((buff) => identity.buffs!.includes(buff)) : null;
    case 'faction':
      return requirement.factions.some((faction) => identity.factions.includes(faction));
    case 'identity':
      return requirement.ids.includes(identity.id);
    case 'defense':
      return identity.defenseTypes
        ? requirement.kinds.some((kind) => identity.defenseTypes!.includes(kind))
        : null;
    case 'egoSkill':
      // No identity's E.G.O is in our data; the owner counts it as always met.
      return true;
    case 'anyOf': {
      let unknown = false;
      for (const option of requirement.options) {
        const verdict = identityMeets(identity, option);
        if (verdict === true) return true;
        if (verdict === null) unknown = true;
      }
      return unknown ? null : false;
    }
  }
}

/**
 * Which of its base skills carry a met requirement — 「이상 1.3」 in the sheet's chips. Empty for
 * a requirement the identity meets as a whole (소속, 버프, 방어 스킬) or one read off the totals.
 */
export function slotsMeeting(identity: Identity, requirement: EffectRequirement): Array<1 | 2 | 3> {
  if (requirement.type === 'anyOf') {
    const slots = new Set(requirement.options.flatMap((option) => slotsMeeting(identity, option)));
    return [...slots].sort((a, b) => a - b);
  }
  const test = skillTest(requirement);
  if (!test || !identity.skills) return [];
  const slots = new Set(identity.skills.filter((skill) => test(skill) === true).map((skill) => skill.slot));
  return [...slots].sort((a, b) => a - b);
}

function defaultScope(requirement: EffectRequirement): ConditionScope {
  // 「…가 덱에 편성되어 있으면」 asks about the formation; everything else about who fights.
  if (requirement.type === 'identity') return 'formation';
  if ((requirement.type === 'skillKeyword' || requirement.type === 'faction') && requirement.scope)
    return requirement.scope;
  return 'deployed';
}

/**
 * The built index (`skill-gifts.json`, M129) read for lookups: identity → `gift:effect:requirement` →
 * the base skills that meet it (empty: the identity as a whole). `data:build` writes it with
 * `identityMeets`/`slotsMeeting`, so a lookup answers what the computation would.
 */
export type SkillGiftLookup = ReadonlyMap<number, ReadonlyMap<string, Array<1 | 2 | 3>>>;

/** The file as written: identity → slot ("0" = the identity as a whole) → `[gift, effect, requirement]`. */
export type SkillGiftIndexFile = SkillGiftIndex;

export function skillGiftLookup(index: SkillGiftIndexFile): SkillGiftLookup {
  const out = new Map<number, Map<string, Array<1 | 2 | 3>>>();
  for (const [identity, bySlot] of Object.entries(index)) {
    const map = new Map<string, Array<1 | 2 | 3>>();
    for (const [slotKey, entries] of Object.entries(bySlot)) {
      const slot = Number(slotKey);
      for (const [gift, effect, req] of entries ?? []) {
        const key = `${gift}:${effect}:${req}`;
        const slots = map.get(key) ?? [];
        if (slot >= 1 && slot <= 3 && !slots.includes(slot as 1 | 2 | 3)) slots.push(slot as 1 | 2 | 3);
        map.set(key, slots);
      }
    }
    for (const slots of map.values()) slots.sort((a, b) => a - b);
    out.set(Number(identity), map);
  }
  return out;
}

/** Where a requirement sits, for an index lookup. */
interface IndexedAt {
  lookup: SkillGiftLookup;
  key: string;
}

function needOf(requirement: EffectRequirement): number {
  return (requirement.type === 'skillKeyword' || requirement.type === 'faction') && requirement.min
    ? requirement.min
    : 1;
}

export function reportRequirement(
  requirement: EffectRequirement,
  stats: DeckStats,
  identityById: ReadonlyMap<number, Identity>,
  at?: IndexedAt,
): RequirementReport {
  if (requirement.type === 'egoSkill')
    return { requirement, have: 0, need: 0, satisfied: true, unknown: 0, matches: [] };
  // 「A 또는 B」: one identity meeting any option counts — over the widest scope an option names,
  // against the smallest threshold. The index path and the computed path count the same way.
  const scope =
    requirement.type === 'anyOf'
      ? requirement.options.some((o) => defaultScope(o) === 'formation')
        ? 'formation'
        : 'deployed'
      : defaultScope(requirement);
  const need =
    requirement.type === 'anyOf' ? Math.min(...requirement.options.map(needOf)) : needOf(requirement);
  let unknown = 0;
  const matches: RequirementReport['matches'] = [];
  for (const id of scopeMembers(stats, scope)) {
    if (at) {
      // The index already says who meets it; only the counting is done here.
      const slots = at.lookup.get(id)?.get(at.key);
      if (slots) matches.push({ id, slots: [...slots] });
      continue;
    }
    const identity = identityById.get(id);
    if (!identity) continue;
    const verdict = identityMeets(identity, requirement);
    if (verdict === true) matches.push({ id, slots: slotsMeeting(identity, requirement) });
    else if (verdict === null) unknown += 1;
  }
  return { requirement, have: matches.length, need, satisfied: matches.length >= need, unknown, matches };
}

/**
 * Every effect of the gift on the deck. With `lookup` (the built index) who meets what is read, not
 * computed — the app's path; without it, computed — the CLI's and the tests'.
 */
export function giftEffectsReport(
  gift: Gift,
  stats: DeckStats,
  identityById: ReadonlyMap<number, Identity>,
  lookup?: SkillGiftLookup,
): GiftEffectsReport {
  const effects = gift.effects ?? [];
  const reportAt = (effectIndex: number) => (requirement: EffectRequirement, reqIndex: number) =>
    reportRequirement(
      requirement,
      stats,
      identityById,
      lookup ? { lookup, key: `${gift.id}:${effectIndex}:${reqIndex}` } : undefined,
    );
  const gates = effects.flatMap((effect, effectIndex) =>
    effect.kind === 'gate' ? effect.requires.map(reportAt(effectIndex)) : [],
  );
  const gateOpen = gates.every((report) => report.satisfied);
  const reports: EffectReport[] = effects.map((effect, index) => {
    const requirements = effect.requires.map(reportAt(index));
    const isEffect = effect.kind === 'effect';
    return {
      index,
      kind: effect.kind,
      requirements,
      usable: isEffect && gateOpen && requirements.every((report) => report.satisfied),
      unconditional: isEffect && requirements.length === 0,
      unclassified: effect.unclassified === true,
    };
  });
  return { giftId: gift.id, gates, gateOpen, effects: reports, relevance: relevanceOf(gates, reports) };
}

function relevanceOf(gates: RequirementReport[], effects: EffectReport[]): GiftRelevance | null {
  const usable = effects.filter((effect) => effect.usable);
  if (usable.length === 0) return null;
  const met = [...gates, ...usable.flatMap((effect) => effect.requirements)];
  // A met gate is something the deck brings, so even an unconditional effect behind it is the deck's.
  if (met.some((report) => report.requirement.type !== 'egoSkill')) return 'deck';
  // Only an E.G.O skill condition stands between the deck and the gift: a group of its own, last.
  if (met.length > 0) return 'ego';
  return 'free';
}

/**
 * A short machine-readable reason for debugging — `deck:skillKeyword/Burst+faction/BLADE_LINEAGE`,
 * `free`, or `none`. Never shown to visitors.
 */
export function relevanceReason(report: GiftEffectsReport): string {
  if (report.relevance === null) return 'none';
  if (report.relevance === 'free' || report.relevance === 'ego') return report.relevance;
  const met = [...report.gates, ...report.effects.filter((e) => e.usable).flatMap((e) => e.requirements)];
  const labels = [...new Set(met.map((r) => requirementLabel(r.requirement)))];
  return `deck:${labels.join('+')}`;
}

export function requirementLabel(requirement: EffectRequirement): string {
  switch (requirement.type) {
    case 'skillKeyword':
      return `skillKeyword/${requirement.keywords.join('|')}${requirement.slot ? `@S${requirement.slot}` : ''}`;
    case 'identityBuff':
      return `identityBuff/${requirement.buffs.join('|')}`;
    case 'faction':
      return `faction/${requirement.factions.join('|')}`;
    case 'identity':
      return `identity/${requirement.ids.join('|')}`;
    case 'skill':
      return `skill/${[...(requirement.sins ?? []), ...(requirement.attackTypes ?? [])].join('|')}`;
    case 'resonance':
      return `resonance/${requirement.sins.join('|')}`;
    case 'shape':
      return `shape/${requirement.kind}${requirement.n ?? ''}`;
    case 'defense':
      return `defense/${requirement.kinds.join('|')}`;
    case 'selfKeyword':
      return `selfKeyword/${requirement.keywords.join('|')}:${requirement.verb}`;
    case 'egoSkill':
      return 'egoSkill';
    case 'anyOf':
      return `anyOf(${requirement.options.map(requirementLabel).join(',')})`;
  }
}
