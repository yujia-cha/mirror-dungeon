/**
 * Parse, out of the Korean effect text, which SKILLS a gift's effect keys off.
 *
 * This is the other half of 「조건부 기프트」 and it is not a `Condition`. A condition gates whether
 * the gift works at all, and the game writes it as a threshold over the party
 * (「…인격이 5인 이상」). A trigger says which of an identity's skills the effect lands on, and the
 * game writes it inline:
 *
 *   「참격 스킬을 사용할 경우, 효과가 강화되어 [출혈] 위력 4 부여」   → 공격 유형, 강화
 *   「질투 속성 스킬을 사용하여 적에게 적중 시…」                     → 죄악 속성, 발동
 *   「참격 유형인 스킬 1의 합 위력 +1」                                → 유형 + 슬롯
 *   「관통, 타격 기본 공격 스킬」 「우울 또는 분노 속성 공격 스킬」     → 두 주체 (OR)
 *   「오만 관통 스킬의 피해량 +…」                                     → 죄악과 유형을 함께 (AND)
 *   「[편성 3번 인격 전용 효과]」                                      → 편성 자리 제한
 *
 * The two live apart because they are counted apart: a condition is judged against the party as a
 * whole, a trigger against one identity's one skill.
 *
 * **The word 스킬 must follow the subject.** That single requirement is what keeps 「참격 내성」,
 * 「분노 완전 공명」 and 「타격 피해량」 out — each names a sin or an attack type and none of them is
 * about a skill. Measured over the MD7 season it finds triggers in 92 of 446 gifts with no false
 * positive; 「적에게 탐식 속성 스킬을 사용하여」 reads as an enemy clause but the subject is still an
 * ally, so it is kept.
 *
 * What it deliberately does NOT model:
 *
 * - **A faction-limited variant of the same effect.** 9195 (흑운회), 9199 (기술해방연합), 9194 (세븐 협회),
 *   9786 (중지) read 「…소속 인격은 효과가 변경되어」: they change how much happens, not whether it
 *   happens. Counting them would narrow a true answer into a false one, so the base clause is
 *   reported and the refinement is left to the gift's own text in the detail sheet.
 * - **E.G.O and defence skills.** The identity tables only ever hold base attack skills, so there is
 *   nothing to confuse them with.
 * - **Uptie changes.** Only the first `skillData` row is read; later rows are deltas and no Mirror
 *   Dungeon clause depends on them.
 *
 * A gift whose sentence this misses is corrected in `data/curated/conditions.json`, the same file
 * that corrects conditions — and `data:validate` re-scans the text loosely so a missed one is loud.
 */
import type {
  AttackType,
  IdentityKeywordId,
  Localized,
  Sin,
  SkillSlot,
  SkillTrigger,
} from '../../src/core/schema.ts';
import { ATTACK_TYPES, IDENTITY_KEYWORDS, SINS } from '../../src/core/schema.ts';
import { stripRichText } from '../../src/core/text.ts';
import { KEYWORD_KO } from './parse-conditions.ts';

/** Korean sin name -> the id the app uses. */
const SIN_BY_KO: Record<string, Sin> = {
  분노: 'WRATH',
  색욕: 'LUST',
  나태: 'SLOTH',
  탐식: 'GLUTTONY',
  우울: 'GLOOM',
  오만: 'PRIDE',
  질투: 'ENVY',
};

/** Korean attack type name -> the id the app uses. */
const ATTACK_BY_KO: Record<string, AttackType> = {
  참격: 'Slash',
  관통: 'Penetrate',
  타격: 'Hit',
};

const SINS_KO = Object.keys(SIN_BY_KO).join('|');
const ATTACKS_KO = Object.keys(ATTACK_BY_KO).join('|');
const SUBJECT = `${SINS_KO}|${ATTACKS_KO}`;

/** 「분노 속성」, 「참격 유형인」, or the bare word — one member of a subject run. */
const MEMBER = `(?:${SUBJECT})\\s*(?:속성|유형)?(?:인|의)?`;

/**
 * The subject run that qualifies one 스킬, plus any slot restriction after it.
 *
 * Every word between a subject and 스킬 is optional because the game varies them independently:
 * 「분노 속성 스킬」, 「오만 속성 공격 스킬」, 「탐식 속성의 스킬」, 「참격 기본 공격 스킬」,
 * 「참격 유형인 스킬 1」. Members join with 「,」 or 「또는」 (an OR list), or with nothing at all —
 * 「오만 관통 스킬」, where the two words narrow each other instead (an AND).
 *
 * Group 1 is the whole run, rescanned for its words; group 2 is the 「스킬 1, 스킬 2」 run, rescanned
 * for its digits. A list cannot swallow the next clause of 「참격 스킬 또는 질투 속성 스킬」, because
 * the first member is already followed by 스킬.
 */
const TRIGGER_RE = new RegExp(
  `((?:${MEMBER}\\s*(?:,|또는)\\s*)*${MEMBER}(?:\\s+(?:${SUBJECT}))?)` +
    `\\s*(?:기본\\s*)?(?:공격\\s*)?스킬\\s*((?:[123](?:\\s*,\\s*스킬\\s*[123])*)?)`,
  'g',
);

/**
 * 「[편성 3번 인격 전용 효과]」 — the whole effect is limited to those formation positions.
 *
 * Two orders exist (「[편성 1번 …]」 and the one-off 「[1번 편성 전용 효과]」) and the digits come in
 * every shape the writers felt like (「1번, 2번」, 「1, 2, 7, 8번」, 「편성 순서 2, 4번」, a stray
 * double space). What matters more is what must NOT match: the same bracket also introduces
 * identity- and faction-limited effects (「[라만차랜드 인격 전용 효과]」,
 * 「[새벽 사무소 소속 인격 전용 효과]」, 「[검계 우두머리 뫼르소 전용 효과]」), which are a different
 * mechanic entirely. Requiring 편성 to sit directly against the digits keeps those out.
 */
const FORMATION_RES = [
  /\[\s*편성\s*(?:순서\s*)?((?:\d+\s*번?\s*,\s*)*\d+\s*번)[^\]]*전용\s*효과\s*\]/g,
  /\[\s*((?:\d+\s*번?\s*,\s*)*\d+\s*번)\s*편성[^\]]*전용\s*효과\s*\]/g,
];

/**
 * Wording that means the skill only makes the effect stronger, rather than making it happen.
 *
 * Judged over the line the match sits on, because that is the unit the game writes one effect in.
 * It is a reading of phrasing, not a grammar, so it can mislabel — which costs a word on screen and
 * never a missing gift.
 */
const BOOST_RE = /효과가\s*강화|효과를\s*대신하여|효과가\s*변경|우선으로\s*적용|효과\s*적용/;

const SUBJECT_RE = new RegExp(SUBJECT, 'g');

// ---------------------------------------------------------------------------
// Keyword triggers — 「[충전] 횟수 또는 특수 충전을 증가시키는 스킬 1」
// ---------------------------------------------------------------------------

/**
 * Korean keyword name -> the id the app uses. 탄환·혈찬 are identity-only keywords and no gift
 * sentence names them this way today, but they are the same grammar, so the table stays whole.
 */
const KEYWORD_BY_KO: Record<string, IdentityKeywordId> = {
  ...Object.fromEntries(
    Object.entries(KEYWORD_KO).map(([id, ko]) => [ko, id as IdentityKeywordId]),
  ),
  탄환: 'Bullet',
  혈찬: 'BloodDinner',
};

/**
 * The same keywords under the ids the game writes, because **this parser runs before the buff ids
 * are localized**. The raw sentence is 「[Charge] 횟수 또는 특수 충전을 증가시키는 스킬 1」: the
 * bracketed token is still English and only the 특수 variant is Korean prose. Matching Korean
 * alone would start the clause at 「특수 충전」 and lose both the 특수 flag and, where the sentence
 * never spells the keyword out in Korean (9098 복주머니, 9177·9179), the trigger entirely.
 * `parse-conditions.ts` reads both forms for the same reason.
 */
const KEYWORD_BY_NAME: Record<string, IdentityKeywordId> = {
  ...KEYWORD_BY_KO,
  ...Object.fromEntries(IDENTITY_KEYWORDS.map((id) => [id, id])),
};

// Longest first so 「[Combustion]」 never matches as a prefix of something else.
const KEYWORDS_ANY = Object.keys(KEYWORD_BY_NAME)
  .sort((a, b) => b.length - a.length)
  .join('|');

/** Every verb the sentences use for touching a keyword. 얻 covers 「소모하거나 얻는」. */
const VERB = '부여|획득|증가|감소|소모|얻';

/**
 * A keyword clause that qualifies one 스킬, with its slot.
 *
 * Shape: a keyword mention, the OR-list the game spells out (「위력 또는 [화상] 횟수 또는 특수
 * 화상을」), the verb run (「부여하는」, 「증가시키는」, 「획득하거나 소모하는」), an optional
 * 「인격이 사용하는」, then the slot. The whole match is re-read afterwards for the other keywords
 * in the list, for 특수, and for every verb word — the regex only has to find the clause.
 *
 * **The slot must not be negated.** 9216 제식 복장 says 「…부여하는 스킬 3이 아닌 스킬의 피해량」 in
 * one line and 「…부여하는 스킬 3의 더하기 코인 위력」 in the next. Reading the first would claim the
 * opposite of what the gift does, so a slot followed by 「이 아닌」 is rejected — the second line
 * still matches and carries the truth.
 *
 * **The verb must run straight into the ending**, either by itself (「부여하는」, 「증가시키는」) or
 * through 「하거나 <verb>」 (「획득하거나 소모하는」, 「소모하거나 얻는」). Allowing any words between
 * them lets a clause boundary through, and then 9771 근접 전술 교본's 「[탄환]을 얻으면, 이번 턴과
 * 다음 턴에 사용하는 스킬 3」 reads as 「탄환을 얻는 스킬 3」 — but there the keyword is a separate
 * event and the slot is only what the effect lands on, so the gift would be described backwards.
 */
const KEYWORD_TRIGGER_RE = new RegExp(
  `\\[?(?:${KEYWORDS_ANY})\\]?` +
    `[^.\\n]{0,80}?(?:${VERB})(?:\\s*하?거나\\s*(?:${VERB}))?(?:하는|시키는|는)\\s*` +
    `((?:인격|아군)이\\s*사용하는\\s*)?` +
    `스킬\\s*([123])(?!\\s*이?\\s*아닌)`,
  'g',
);

const KEYWORD_MENTION_RE = new RegExp(`\\[?(${KEYWORDS_ANY})\\]?`, 'g');
const VERB_RE = new RegExp(VERB, 'g');

/**
 * Read one matched clause into a trigger.
 *
 * 「또는 특수 충전」 is the only thing that makes 특수 변형 count — the same rule conditions follow,
 * and the reason 탄환 is exempt elsewhere does not apply here because no bullet gift exists.
 */
function keywordTriggerOf(clause: string, identityScope: boolean, slot: SkillSlot, effect: SkillTrigger['effect']): SkillTrigger | null {
  KEYWORD_MENTION_RE.lastIndex = 0;
  const keywords = [
    ...new Set([...clause.matchAll(KEYWORD_MENTION_RE)].map((m) => KEYWORD_BY_NAME[m[1]!]!)),
  ].sort();
  if (keywords.length === 0) return null;
  VERB_RE.lastIndex = 0;
  const verbs = new Set(clause.match(VERB_RE) ?? []);
  const consumes = verbs.has('소모');
  const gains = verbs.has('부여') || verbs.has('획득') || verbs.has('증가') || verbs.has('얻');
  const verb = consumes && gains ? 'any' : consumes ? 'consume' : 'inflict';
  const includesSpecial = keywords.some((kw) => {
    const ko = KEYWORD_BY_KO_REVERSE[kw];
    return ko ? new RegExp(`특수\\s*${ko}`).test(clause) : false;
  });
  return {
    sin: null,
    attackType: null,
    keywords,
    verb,
    includesSpecial,
    subject: identityScope ? 'identity' : 'skill',
    slots: [slot],
    effect,
  };
}

/** Back to the Korean name, which is the only form 「특수 X」 is ever written in. */
const KEYWORD_BY_KO_REVERSE: Partial<Record<IdentityKeywordId, string>> = Object.fromEntries(
  Object.entries(KEYWORD_BY_KO).map(([ko, id]) => [id, ko]),
);

function triggerOf(
  words: string[],
  slots: SkillSlot[],
  effect: SkillTrigger['effect'],
): SkillTrigger {
  const sin = words.map((w) => SIN_BY_KO[w]).find(Boolean) ?? null;
  const attackType = words.map((w) => ATTACK_BY_KO[w]).find(Boolean) ?? null;
  return {
    sin,
    attackType,
    keywords: [],
    verb: 'inflict',
    includesSpecial: false,
    subject: 'skill',
    slots,
    effect,
  };
}

/** The line a match sits on — the game writes one effect per line. */
function lineAt(text: string, index: number): string {
  const start = text.lastIndexOf('\n', index) + 1;
  const end = text.indexOf('\n', index);
  return text.slice(start, end === -1 ? text.length : end);
}

/** Sins in the game's own order, then attack types — the order the panel lists its groups in. */
function subjectRank(trigger: SkillTrigger): number {
  if (trigger.sin) return SINS.indexOf(trigger.sin);
  if (trigger.attackType) return SINS.length + ATTACK_TYPES.indexOf(trigger.attackType);
  return SINS.length + ATTACK_TYPES.length;
}

/**
 * What makes two triggers the same subject, and so foldable.
 *
 * The keyword axes join the key rather than being folded into it: 「[충전]을 획득하는 스킬 1」 and
 * 「[충전]을 소모하는 스킬 3」 are two different demands on the deck, and 스킬 단위 vs 인격 단위 is
 * the whole distinction the panel draws.
 */
function keyOf(trigger: SkillTrigger): string {
  return [
    trigger.sin ?? '',
    trigger.attackType ?? '',
    trigger.keywords.join(','),
    trigger.keywords.length > 0 ? trigger.verb : '',
    trigger.keywords.length > 0 ? trigger.subject : '',
    trigger.keywords.length > 0 && trigger.includesSpecial ? 'special' : '',
  ].join('|');
}

/**
 * Collapse what the same subject says more than once.
 *
 * 9203 차원지각변환체 says 「타격 유형인 스킬 1, 스킬 2」 in one paragraph and 「타격 유형 스킬」 in
 * the next: the unrestricted mention is the wider truth, so it swallows the slot-limited one rather
 * than sitting beside it and implying the gift reacts twice. Likewise a subject that gates the
 * effect does not also need a row saying it strengthens it.
 */
function normalise(triggers: SkillTrigger[]): SkillTrigger[] {
  // The first trigger of a key carries the axes the key already pins down; only `slots` and
  // `effect` are merged across the group, so it can stand for the whole of it.
  const bySubject = new Map<string, { first: SkillTrigger; slots: SkillSlot[] | null; gate: boolean }>();
  for (const trigger of triggers) {
    const key = keyOf(trigger);
    const seen = bySubject.get(key);
    if (!seen) {
      bySubject.set(key, {
        first: trigger,
        slots: trigger.slots.length === 0 ? null : [...trigger.slots],
        gate: trigger.effect === 'gate',
      });
      continue;
    }
    if (trigger.effect === 'gate') seen.gate = true;
    if (seen.slots === null) continue;
    if (trigger.slots.length === 0) seen.slots = null;
    else for (const slot of trigger.slots) if (!seen.slots.includes(slot)) seen.slots.push(slot);
  }
  return [...bySubject.values()]
    .map((value) => ({
      ...value.first,
      slots: (value.slots ?? []).sort((a, b) => a - b),
      effect: (value.gate ? 'gate' : 'boost') as SkillTrigger['effect'],
    }))
    // Keyword triggers all share the last rank, so the key breaks the tie — output order must not
    // depend on where in the text the clauses happened to sit.
    .sort((a, b) => subjectRank(a) - subjectRank(b) || (keyOf(a) < keyOf(b) ? -1 : keyOf(a) > keyOf(b) ? 1 : 0));
}

export interface SkillTriggerResult {
  triggers: SkillTrigger[];
  /** 1-based formation positions the effect is limited to, ascending. Empty means no limit. */
  formationSlots: number[];
}

export function parseSkillTriggers(desc: Localized): SkillTriggerResult {
  const ko = stripRichText(desc.ko ?? '');
  const found: SkillTrigger[] = [];

  TRIGGER_RE.lastIndex = 0;
  for (const match of ko.matchAll(TRIGGER_RE)) {
    const run = match[1]!;
    const words = run.match(SUBJECT_RE) ?? [];
    if (words.length === 0) continue;
    const slots = [...new Set((match[2] ?? '').match(/[123]/g) ?? [])]
      .map(Number)
      .sort((a, b) => a - b) as SkillSlot[];
    const effect = BOOST_RE.test(lineAt(ko, match.index)) ? 'boost' : 'gate';
    // A run joined by 「,」 or 「또는」 lists alternatives; one joined by nothing narrows itself.
    if (/,|또는/.test(run)) for (const word of words) found.push(triggerOf([word], slots, effect));
    else found.push(triggerOf(words, slots, effect));
  }

  KEYWORD_TRIGGER_RE.lastIndex = 0;
  for (const match of ko.matchAll(KEYWORD_TRIGGER_RE)) {
    const slot = Number(match[2]) as SkillSlot;
    const effect = BOOST_RE.test(lineAt(ko, match.index)) ? 'boost' : 'gate';
    const trigger = keywordTriggerOf(match[0], Boolean(match[1]), slot, effect);
    if (trigger) found.push(trigger);
  }

  const formationSlots = new Set<number>();
  for (const re of FORMATION_RES) {
    re.lastIndex = 0;
    for (const match of ko.matchAll(re)) {
      for (const digits of match[1]!.match(/\d+/g) ?? []) formationSlots.add(Number(digits));
    }
  }

  return {
    triggers: normalise(found),
    formationSlots: [...formationSlots].sort((a, b) => a - b),
  };
}
