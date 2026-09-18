/**
 * Identity keywords read out of the localized skill text, for identities the static data does not
 * ship.
 *
 * `deriveIdentityKeywords` in `derive.ts` is the real derivation: it reads buff ids off the
 * skill's own data and is exact. This is the fallback for an identity that exists in the
 * localization and nowhere else (today only 10116 LCE E.G.O:: 차원찢개), where the only official
 * statement of what its attacks inflict is the sentence a player reads in game.
 *
 * `tests/text-derivation.test.ts` calibrates this against every identity that has both, and the
 * property it holds to is one-sided: the text may miss a keyword, it must never invent one.
 */
import { IDENTITY_KEYWORDS, type IdentityKeywordId } from '../../src/core/schema.ts';
import { IDENTITY_KEYWORD_BY_KO, type IdentityKeywordCounts } from './derive.ts';
import type { LocalizedSkill } from './raw.ts';

/** `[Charge]`, `[ChargeBodyArt]`, `[DriftingDimensionYisang]` … and the plain Korean names. */
const MENTION = /\[([A-Za-z0-9_]+)\]|(화상|출혈|진동|파열|침잠|호흡|충전|탄환)/g;

/** How much of the sentence after a mention decides whether it is an infliction. */
const TAIL = 14;

/** 「… 부여」 gives the keyword to a target, 「… 횟수 N 증가」 to oneself. Both count. */
const GRANTS = /부여|증가/;

/**
 * 「[Combustion], [Laceration], [Vibration], [Burst], [Sinking] 중 무작위 1개」 lists keywords to
 * choose between; naming one there is not inflicting it. Without this a single skill reports five
 * keywords (10109 약지 점묘파 스튜던트 is the worst case).
 */
const ENUMERATION = /중|무작위/;

/** Every ammo buff the game ships carries `Bullet` in its id, exactly as in `derive.ts`. */
const AMMO_BUFF_ID = /Bullet/;

/**
 * The family an ammo buff id belongs to: everything up to and including its last `Bullet`.
 *
 * 특수 ammo comes with state buffs the game never declares as variants themselves —
 * `MeursaultSporeBulletReloading` next to `MeursaultSporeBulletLong`/`Short` (포자탄). Counting
 * those as plain 탄환 would say an identity fires ordinary ammo when it only has the 특수 kind.
 * A bare `Bullet` family (`Bullet`, `BulletLament`, `Bullet_LogicAtelier`) is not a family at all —
 * those are the plain ammo ids — so only a prefixed family suppresses.
 */
function ammoFamily(token: string): string | null {
  const at = token.lastIndexOf('Bullet');
  const family = token.slice(0, at + 'Bullet'.length);
  return family === 'Bullet' ? null : family;
}

/**
 * Skills whose token set marks them as something other than a base attack: a counter, a guard, an
 * evasion follow-up. These three appear only on skills the game leaves out of `attributeList`.
 */
const NOT_AN_ATTACK = new Set(['DuelCounter', 'CanDuelGuard', 'OnSucceedEvade']);

/** The defense slot. Suffix 04 is never in an identity's `attributeList`. */
const DEFENSE_SUFFIX = '04';

export function identityIdOfSkill(skillId: number): number {
  return Math.floor(skillId / 100);
}

function skillSuffix(skillId: number): string {
  return String(skillId).slice(-2);
}

/** Every line of a skill's text, markup stripped, split so a grant clause cannot cross a newline. */
function linesOf(skill: LocalizedSkill): string[] {
  const out: string[] = [];
  const push = (text: string | undefined): void => {
    if (!text) return;
    // Level 2/4 rows wrap what changed in `<style="highlight">…</style>`.
    for (const line of text.replace(/<[^>]*>/g, '').split('\n')) out.push(line);
  };
  for (const level of skill.levelList ?? []) {
    push(level.desc);
    for (const coin of level.coinlist ?? []) for (const d of coin.coindescs ?? []) push(d.desc);
  }
  return out;
}

function tokensOf(skill: LocalizedSkill): Set<string> {
  const out = new Set<string>();
  for (const line of linesOf(skill)) {
    for (const [, token] of line.matchAll(/\[([A-Za-z0-9_]+)\]/g)) if (token) out.add(token);
  }
  return out;
}

/** Whether a skill is one of the identity's base attacks, as far as the text can tell. */
export function looksLikeAttackSkill(skill: LocalizedSkill): boolean {
  if (skillSuffix(skill.id) === DEFENSE_SUFFIX) return false;
  for (const token of tokensOf(skill)) if (NOT_AN_ATTACK.has(token)) return false;
  return true;
}

/** Keywords one skill's text says it inflicts, split into base and 특수 variants. */
export function keywordsInSkillText(
  skill: LocalizedSkill,
  specialVariants: Map<string, IdentityKeywordId>,
  /** Ammo families this identity declares as 특수; their undeclared state buffs are not plain ammo. */
  specialAmmoFamilies: ReadonlySet<string> = new Set(),
): { base: Set<IdentityKeywordId>; special: Set<IdentityKeywordId> } {
  const base = new Set<IdentityKeywordId>();
  const special = new Set<IdentityKeywordId>();
  for (const line of linesOf(skill)) {
    for (const match of line.matchAll(MENTION)) {
      const end = match.index + match[0].length;
      const tail = line.slice(end, end + TAIL);
      if (ENUMERATION.test(tail) || !GRANTS.test(tail)) continue;
      const korean = match[2];
      if (korean) {
        const keyword = IDENTITY_KEYWORD_BY_KO[korean];
        if (keyword) base.add(keyword);
        continue;
      }
      const token = match[1];
      if (!token) continue;
      const variant = specialVariants.get(token);
      if (variant) special.add(variant);
      else if ((IDENTITY_KEYWORDS as readonly string[]).includes(token)) base.add(token as IdentityKeywordId);
    }
  }
  // 탄환 is spent, not inflicted, so it is never written as 「부여」. Its presence anywhere in the
  // skill is the signal, exactly as the static path reads it off the requirement token.
  for (const token of tokensOf(skill)) {
    if (!AMMO_BUFF_ID.test(token)) continue;
    const variant = specialVariants.get(token);
    if (variant) {
      special.add(variant);
      continue;
    }
    const family = ammoFamily(token);
    if (family && specialAmmoFamilies.has(family)) continue;
    base.add('Bullet');
  }
  return { base, special };
}

/**
 * Which keywords an identity's attack skills inflict, counted per skill, from the localized text.
 *
 * Counts are the weaker half of the result: without `attackSkillIds`, which skills belong to
 * `attributeList` is a guess (see `looksLikeAttackSkill`) and it is wrong for a handful of
 * conditional replacements. What the planner reads is only whether a count is above zero, so the
 * calibration test compares that.
 */
export function deriveIdentityKeywordsFromText(
  skills: LocalizedSkill[],
  specialVariants: Map<string, IdentityKeywordId>,
  /**
   * The base attack skills, when something authoritative knows them — the derived source lists
   * them outright. Given this, the heuristic below is not consulted at all.
   */
  attackSkillIds?: Iterable<number>,
): IdentityKeywordCounts {
  const attacks = attackSkillIds ? new Set(attackSkillIds) : null;
  const isAttack = (skill: LocalizedSkill): boolean =>
    attacks ? attacks.has(skill.id) : looksLikeAttackSkill(skill);
  const baseCounts = new Map<IdentityKeywordId, number>();
  const specialCounts = new Map<IdentityKeywordId, number>();
  // Gathered across every skill, defense included: the reload that names the family often sits on
  // a skill the attack list leaves out.
  const specialAmmoFamilies = new Set<string>();
  for (const skill of skills) {
    for (const token of tokensOf(skill)) {
      if (specialVariants.get(token) !== 'Bullet') continue;
      const family = ammoFamily(token);
      if (family) specialAmmoFamilies.add(family);
    }
  }
  for (const skill of skills) {
    if (!isAttack(skill)) continue;
    const found = keywordsInSkillText(skill, specialVariants, specialAmmoFamilies);
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

/** The localized skills of one identity, newest-level text included, sorted by skill id. */
export function skillsOfIdentity(
  identityId: number,
  skills: Map<number, LocalizedSkill>,
): LocalizedSkill[] {
  return [...skills.values()]
    .filter((s) => identityIdOfSkill(s.id) === identityId)
    .sort((a, b) => a.id - b.id);
}
