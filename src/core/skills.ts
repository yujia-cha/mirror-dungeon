/**
 * Which of a deck's skills a gift's effect lands on.
 *
 * Some gifts do not care what an identity is, only what one of its skills is: 「참격 스킬을 사용할
 * 경우」, 「질투 속성 스킬을 사용하여 적에게 적중 시」, 「참격 유형인 스킬 1의 합 위력 +1」. The
 * build reads those clauses into `gift.skillTriggers`; this reads them back against a deck, and
 * answers the question the player actually has — 「이 기프트가 내 덱에서 걸리나, 누구의 몇 번
 * 스킬로?」.
 *
 * It is not part of route planning and the planner never calls it: a trigger changes how well a
 * gift performs, not whether a pack can hand it over. It is a reading of the deck, kept here
 * because it is pure and because the app must not reimplement it.
 */
import type { AttackType, Gift, IdentityKeywordId, SkillKeywords, Sin, SkillSlot, SkillTrigger } from './schema.ts';
import type { GameIndexes } from './types.ts';

/** One base attack skill of one identity in the deck. */
export interface SkillRef {
  identityId: number;
  slot: SkillSlot;
  sin: Sin | null;
  attackType: AttackType | null;
  /** 0 marks an alternate skill in that slot (an awakened or transformed form). */
  copies: number;
  /** The keywords this one skill uses — what 「[화상]을 부여하는 스킬 3」 asks about. */
  keywords: SkillKeywords;
  /** Every keyword the whole identity uses, for the 「…하는 인격이 사용하는 스킬 3」 shape. */
  identityKeywords: SkillKeywords;
  /** The identity's 소속, for 「약지 소속 인격의 색욕 … 스킬」. */
  factions: readonly string[];
}

export interface GiftSkillMatch {
  giftId: number;
  /** The gift's own triggers that at least one of the given skills satisfies, in gift order. */
  triggers: SkillTrigger[];
  /** The skills that satisfied them, deduped, in the order `skillsOf` produced them. */
  skills: SkillRef[];
}

/**
 * The base attack skills of the given identities, in the order they were given.
 *
 * `identityIds` is whoever the caller is counting — the app passes the deployed party, because only
 * a deployed identity swings a skill. An identity no source knows the skills of contributes
 * nothing; `unknownSkillIdentities` names them so a caller can say 「모른다」 instead of 「없다」.
 */
export function skillsOf(
  identityIds: readonly number[],
  indexes: GameIndexes,
): { skills: SkillRef[]; unknownSkillIdentities: number[] } {
  const skills: SkillRef[] = [];
  const unknownSkillIdentities: number[] = [];
  for (const identityId of identityIds) {
    const identity = indexes.identityById.get(identityId);
    if (!identity || identity.skills.length === 0) {
      unknownSkillIdentities.push(identityId);
      continue;
    }
    // What the identity uses anywhere, flattened once per identity: the 「…하는 인격이 사용하는
    // 스킬 N」 shape asks about the whole kit, and `identity.keywords` is the count of exactly that.
    const identityKeywords: SkillKeywords = { base: [], special: [] };
    for (const [keyword, counts] of Object.entries(identity.keywords)) {
      if (counts.skills > 0) identityKeywords.base.push(keyword as IdentityKeywordId);
      if (counts.specialSkills > 0) identityKeywords.special.push(keyword as IdentityKeywordId);
    }
    identityKeywords.base.sort();
    identityKeywords.special.sort();
    for (const skill of identity.skills) {
      skills.push({
        identityId,
        slot: skill.slot,
        sin: skill.sin,
        attackType: skill.attackType,
        copies: skill.copies,
        keywords: skill.keywords,
        identityKeywords,
        factions: identity.factions,
      });
    }
  }
  return { skills, unknownSkillIdentities };
}

/**
 * Does this skill satisfy this trigger?
 *
 * Every field the trigger states must match, and a field it leaves null it does not care about —
 * 「오만 관통 스킬」 states both, 「참격 스킬」 only the type. An empty `slots` means any slot.
 */
export function triggerMatches(trigger: SkillTrigger, skill: SkillRef): boolean {
  if (trigger.sin !== null && trigger.sin !== skill.sin) return false;
  if (trigger.attackType !== null && trigger.attackType !== skill.attackType) return false;
  if (trigger.slots.length > 0 && !trigger.slots.includes(skill.slot)) return false;
  // 소속 gates the identity swinging the skill, not the skill itself — 9223 범작 wants 약지's
  // 색욕 or 참격, and saying 「색욕 스킬」 alone would promise the gift to a deck it never fires for.
  if (trigger.factions.length > 0 && !trigger.factions.some((f) => skill.factions.includes(f)))
    return false;
  if (trigger.keywords.length > 0) {
    // `subject` decides WHOSE keyword is asked for. 「[화상]을 부여하는 스킬 3」 wants that skill to
    // do it; 「[진동]을 부여하는 아군이 사용하는 스킬 3」 wants the identity to do it somewhere and
    // only uses the slot to say which skill the effect lands on. Folding the two would put a
    // 진동 identity's unrelated slot-3 skill under the first wording, which is not what it says.
    const owned = trigger.subject === 'identity' ? skill.identityKeywords : skill.keywords;
    // 「또는 특수 X」 is what pulls the 특수 변형 in, the same rule `keywordSkillCount` follows.
    const pool = trigger.includesSpecial ? [...owned.base, ...owned.special] : owned.base;
    if (!trigger.keywords.some((keyword) => pool.includes(keyword))) return false;
  }
  return true;
}

/**
 * Every gift among `gifts` that some skill in `skills` sets off, sorted by gift id.
 *
 * `gift.formationSlots` is deliberately not consulted. The game limits a few effects to 「편성 3번
 * 인격」, but nothing in this app lets a player choose a formation seat — the deck array's order is
 * whatever order they happened to pick sinners in — so judging on it would invent an answer they
 * could neither check nor change. The field is carried through to the caller to print as a caveat.
 */
export function matchSkillTriggers(
  gifts: Iterable<Gift>,
  skills: readonly SkillRef[],
): GiftSkillMatch[] {
  const out: GiftSkillMatch[] = [];
  for (const gift of gifts) {
    if (gift.skillTriggers.length === 0) continue;
    const triggers: SkillTrigger[] = [];
    const matched: SkillRef[] = [];
    const seen = new Set<string>();
    for (const trigger of gift.skillTriggers) {
      let any = false;
      for (const skill of skills) {
        if (!triggerMatches(trigger, skill)) continue;
        any = true;
        const key = `${skill.identityId}:${skill.slot}`;
        if (seen.has(key)) continue;
        seen.add(key);
        matched.push(skill);
      }
      if (any) triggers.push(trigger);
    }
    if (triggers.length > 0) out.push({ giftId: gift.id, triggers, skills: matched });
  }
  return out.sort((a, b) => a.giftId - b.giftId);
}
