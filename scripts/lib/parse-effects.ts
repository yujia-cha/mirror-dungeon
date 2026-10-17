/**
 * What each effect of a gift asks of the deck (M129) — the 추천 기프트 judgement.
 *
 * A gift's text is split into effects: a line together with the 「- 」 bullets under it. Each
 * effect then gets the requirements the deployed party can fail. The owner's rule decides what
 * counts (see `effectRequirementSchema`):
 *
 *   a state on an enemy or oneself, a battle situation, a formation slot  →  nothing
 *   a base skill that inflicts / gains / spends a keyword                →  skillKeyword
 *   a buff no gift hands out (special variants, identity buffs)          →  identityBuff
 *   「X 소속」, a named identity                                          →  faction, identity
 *   a sin or attack type skill, a sin's resonance                         →  skill, resonance
 *   coins and attack weight, a defense skill kind                         →  shape, defense
 *   a skill that puts a debuff on its own user or spends the user's own   →  selfKeyword
 *   a discarding skill (「버림 스킬」, 「다른 스킬을 [Discard]하였다면」)       →  identityBuff Discard
 *   an E.G.O skill (always met, owner's call)                             →  egoSkill
 *   「A 또는 B」 across kinds                                              →  anyOf (options never nest)
 *
 * The bullets under a line extend or strengthen it, so only the line itself is read for
 * requirements. A line that reads like a condition no rule covers is kept with no requirement of
 * its own and marked `unclassified`, so the review table (`npm run gift-effects:report`) lists it.
 *
 * The parser reads the raw Korean text, where the game still writes buffs as their ids
 * (`[Combustion]`, `[LegStrength]`) — `identityBuff` has to store ids, and the localized names are
 * the same words a status keyword would use (「진동 - 작열」).
 */
import { readJsonIfExists } from './io.ts';
import { parseConditions, resolveFaction, type ParseContext } from './parse-conditions.ts';
import {
  ATTACK_TYPES,
  DEFENSE_TYPES,
  IDENTITY_KEYWORDS,
  SINS,
  curatedGiftEffectSchema,
  type AttackType,
  type DefenseType,
  type EffectRequirement,
  type SingleRequirement,
  type StatusKeyword,
  type GiftEffect,
  type IdentityKeywordId,
  type Sin,
} from '../../src/core/schema.ts';
import { RUNTIME_PLACEHOLDER, stripRichText } from '../../src/core/text.ts';

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

const KEYWORD_KO: Record<IdentityKeywordId, string> = {
  Combustion: '화상',
  Laceration: '출혈',
  Vibration: '진동',
  Burst: '파열',
  Sinking: '침잠',
  Breath: '호흡',
  Charge: '충전',
  Bullet: '탄환',
  BloodDinner: '혈찬',
};
const KEYWORD_BY_KO = new Map(Object.entries(KEYWORD_KO).map(([id, ko]) => [ko, id as IdentityKeywordId]));
const KEYWORD_SET = new Set<string>(IDENTITY_KEYWORDS);
const KO_ALT = Object.values(KEYWORD_KO).join('|');
/**
 * Debuffs: a skill that puts one on its own user (「자신에게 [화상]을 부여하는」) or spends the user's
 * own stack (「자신의 [진동] 횟수를 소모하는」) is a `selfKeyword`. 호흡·충전 are the user's own anyway,
 * and `skillKeyword` already counts gaining or spending them.
 */
const SELF_DEBUFFS = new Set<string>(['Combustion', 'Laceration', 'Vibration', 'Burst', 'Sinking']);

const SIN_KO: Record<string, Sin> = {
  분노: 'WRATH',
  색욕: 'LUST',
  나태: 'SLOTH',
  탐식: 'GLUTTONY',
  우울: 'GLOOM',
  오만: 'PRIDE',
  질투: 'ENVY',
};
const ATTACK_KO: Record<string, AttackType> = { 참격: 'Slash', 관통: 'Penetrate', 타격: 'Hit' };
const SIN_ALT = Object.keys(SIN_KO).join('|');
const ATK_ALT = Object.keys(ATTACK_KO).join('|');

/** The game's colour names for the sins, as they appear in per-sin buff ids (`ScarletResultUp`). */
const SIN_BY_COLOR_WORD: Record<string, Sin> = {
  Crimson: 'WRATH',
  Scarlet: 'LUST',
  Amber: 'SLOTH',
  Shamrock: 'GLUTTONY',
  Azure: 'GLOOM',
  Indigo: 'PRIDE',
  Violet: 'ENVY',
};
const ATTACK_BY_WORD: Record<string, AttackType> = { Slash: 'Slash', Penetrate: 'Penetrate', Hit: 'Hit' };

/**
 * Buff ids that are read by a dedicated rule rather than as an identity buff: coin shapes, the
 * per-type and per-sin power buffs, the vibration conversions a vibration skill performs, retreat
 * and discard (battle mechanics), and the accumulators of 혈찬.
 */
const DEDICATED_IDS =
  /^(?:SuperCoin|(?:Slash|Penetrate|Hit|Crimson|Scarlet|Amber|Shamrock|Azure|Indigo|Violet)(?:Damage|Result)Up|Switch_Vibration|FusionVibration|RetreatForCommon|Discard|BloodDinner_\w+)$/;

// Private-use characters stand in for a keyword run (「[Combustion] 위력, 횟수 또는 특수 화상」)
// once it has been read, so the rules below see one token and no inner commas.
const RUN_BASE = 0xe000;
const RUN_CHAR = '[\\uE000-\\uE0FF]';

// ---------------------------------------------------------------------------
// Splitting
// ---------------------------------------------------------------------------

import { BULLET_RE, splitEffectBlocks, type EffectBlock } from '../../src/core/effect-blocks.ts';

export { splitEffectBlocks, type EffectBlock };

/** The raw text as the parser reads it: markup gone, `{0}` counter lines gone. */
export function prepareText(raw: string): string {
  return stripRichText(raw.replace(/\r/g, ''))
    .split('\n')
    .filter((line) => !new RegExp(`^${RUNTIME_PLACEHOLDER.source}$`).test(line.trim()))
    .join('\n');
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export interface IdentityName {
  id: number;
  /** 「거미집의 검」 */
  title: string;
  /** 「료슈」 */
  sinner: string;
}

export interface EffectContext extends ParseContext {
  /** Buff ids some gift of the season hands out (`giftGrantedBuffs`) — those are states. */
  grantedBuffs: ReadonlySet<string>;
  identities: readonly IdentityName[];
}

/**
 * Buff ids some gift hands out: 「[X] N 부여」, 「[X] N 얻음」, 「[X]을 얻음」, 「[X] 효과 부여」. A
 * buff a gift can put on the field is a state the deck does not have to bring, so it is never an
 * `identityBuff`. 「[X] 부여 시」 is a trigger, not a grant, and a conversion (「[X]로 [Switch_Vibration]」)
 * is not a grant either — 진동 - 작열 is handed out by no gift even though two gifts convert to it.
 */
export function giftGrantedBuffs(texts: Iterable<string>): Set<string> {
  const out = new Set<string>();
  const re =
    /\[([A-Za-z0-9_]+)\]\s*(?:효과(?:를|을)?\s*)?(?:을|를|이|가)?\s*(?:\d+(?:\s*~\s*\d+)?\s*(?:을|를)?\s*)?(?:부여|얻|획득|생성)(?!\s*시(?![작])|할|하면|된|될|하는|했|하였)/g;
  // 「[ObjectOfExploration]이 [PaintingMaterial]로 교체됨」: the gift puts the new buff on the field.
  const replaced = /\[([A-Za-z0-9_]+)\]\s*(?:로|으로)\s*(?:교체|변경)/g;
  for (const text of texts) {
    const prepared = prepareText(text);
    for (const m of [...prepared.matchAll(re), ...prepared.matchAll(replaced)]) {
      if (!KEYWORD_SET.has(m[1]!)) out.add(m[1]!);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Line analysis
// ---------------------------------------------------------------------------

interface Hit {
  start: number;
  end: number;
  req: EffectRequirement;
}

interface Run {
  keywords: IdentityKeywordId[];
}

interface LineAnalysis {
  requires: EffectRequirement[];
  unclassified: boolean;
}

/** Bare Korean keyword names written without the bracket id: 「호흡 위력」, 「파열 혹은 파열 횟수」, 「혈찬」. */
function normalizeKeywords(text: string): string {
  let out = text.replace(/특수\s*\[([A-Za-z]+)\]/g, (whole, id: string) =>
    KEYWORD_SET.has(id) ? `특수 ${KEYWORD_KO[id as IdentityKeywordId]}` : whole,
  );
  out = out.replace(/(특수\s*(?:화상|출혈|진동|파열|침잠|호흡|충전|탄환))\s*\(위력\s*고정\)/g, '$1');
  out = out.replace(
    new RegExp(`(?<![가-힣\\]]|특수\\s)(${KO_ALT})(?=\\s*(?:위력|횟수|혹은|또는|\\d))`, 'g'),
    (_, ko: string) => `[${KEYWORD_BY_KO.get(ko)!}]`,
  );
  out = out.replace(/(?<![가-힣])혈찬/g, '[BloodDinner]');
  return out;
}

/** Remove parentheticals: priorities, caps and scope notes are never what an effect asks for. */
function removeParens(text: string): string {
  let out = text;
  for (let i = 0; i < 4; i += 1) {
    // A formula — 「(이번 전투 동안 공격 스킬을 사용하여 누적 소모한 [Charge] 횟수/4)만큼」 — is what
    // the effect scales with, so it stays as text.
    const next = out.replace(/\(([^()]*)\)(\s*(?:만큼|%|당))?/g, (_, inner: string, formula?: string) =>
      formula ? ` ${inner}${formula}` : '',
    );
    if (next === out) break;
    out = next;
  }
  return out;
}

/**
 * Drop the strengthening tail of a line: a later sentence that adds a bonus (「… 했으면, 해당 인격이
 * … 추가로 얻음」), or the clause from 「효과가 강화되어」 / 「추가로」 on when it is not the line's first
 * clause. What strengthens an effect is not what the effect needs.
 */
function cutStrengthening(text: string): string {
  const MARKER = /효과가\s*(?:더욱\s*|최대로\s*)?(?:강화|변경)|효과를\s*대신하여|추가로|(?:^|,\s*)대신\s/;
  // 「추가로」 sits right before the verb it modifies (「… 1 추가로 얻음」), so the cut starts there.
  const ADVERB = /추가로/;
  const sentences = text.split(/(?<=\.)\s+/);
  const kept: string[] = [];
  sentences.forEach((sentence, index) => {
    // A later sentence that adds a bonus or names who gets it first is not what the effect needs.
    if (index > 0 && (MARKER.test(sentence) || /우선으로\s*적용|이\s*경우에는/.test(sentence))) return;
    // Clause boundaries: a comma followed by a space.
    let offset = 0;
    const clauses = sentence.split(/(?<=,)\s+/);
    for (let c = 0; c < clauses.length; c += 1) {
      const clause = clauses[c]!;
      const blockMarker = MARKER.exec(clause.replace(ADVERB, '\u0000\u0000\u0000'));
      if (c > 0 && blockMarker) {
        kept.push(sentence.slice(0, offset));
        return;
      }
      const adverb = ADVERB.exec(clause);
      if (adverb) {
        kept.push(sentence.slice(0, offset + adverb.index));
        return;
      }
      offset += clause.length + 1;
    }
    kept.push(sentence);
  });
  return kept.join(' ');
}

const KW_UNIT = `(?:\\[(?:${IDENTITY_KEYWORDS.join('|')})\\](?:\\s*(?:위력|횟수))?|특수\\s*(?:${KO_ALT})|위력|횟수)`;
const KW_RUN = new RegExp(
  `(?:\\[(?:${IDENTITY_KEYWORDS.join('|')})\\]|특수\\s*(?:${KO_ALT}))(?:\\s*(?:위력|횟수))?(?:\\s*(?:,|또는|및|과|와|이나|나|혹은)\\s*${KW_UNIT})*`,
  'g',
);

/** Replace each keyword run by one private-use character and remember what it holds. */
function tokenizeRuns(text: string): { text: string; runs: Run[] } {
  const runs: Run[] = [];
  const out = text.replace(KW_RUN, (whole) => {
    const keywords = new Set<IdentityKeywordId>();
    for (const m of whole.matchAll(/\[([A-Za-z]+)\]/g)) keywords.add(m[1] as IdentityKeywordId);
    for (const m of whole.matchAll(new RegExp(`특수\\s*(${KO_ALT})`, 'g')))
      keywords.add(KEYWORD_BY_KO.get(m[1]!)!);
    // 「위력, 횟수」 alone after a comma is the previous keyword's other counter, already counted.
    if (keywords.size === 0) return whole;
    runs.push({ keywords: sortKeywords([...keywords]) });
    return String.fromCharCode(RUN_BASE + runs.length - 1);
  });
  return { text: out, runs };
}

function sortKeywords(keywords: IdentityKeywordId[]): IdentityKeywordId[] {
  return [...new Set(keywords)].sort((a, b) => IDENTITY_KEYWORDS.indexOf(a) - IDENTITY_KEYWORDS.indexOf(b));
}

function runOf(text: string, index: number, runs: Run[]): Run {
  return runs[text.charCodeAt(index) - RUN_BASE]!;
}

/** Whether the line says 「특수 X」 for a keyword without excluding it (「… 특수 충전 제외」). */
function saysSpecial(full: string, keyword: IdentityKeywordId): boolean {
  const re = new RegExp(`특수\\s*${KEYWORD_KO[keyword]}(?![^,.)]{0,8}(?:제외|적용되지))`);
  return re.test(full);
}

/** The verb of a keyword clause: a skill inflicts, gains or spends the keyword. */
const VERB = '(?:부여|획득|얻|소모|증가시키|증가하|증가|생성)';
/** Adjectival and conditional endings — 「부여하는 스킬」, 「소모한 스킬」, 「부여할 때」 — not a gift's own 「부여.」 */
const ADJ = '(?:하거나[^.]{0,32}?(?:하는|한|시키는|는)|거나[^.]{0,32}?(?:하는|한|는)|하는|한|시키는|는)';
const COND = '(?:할|하는|\\s*시(?![작])|했|하였|하면|한|하거나|된|될|는)';

/**
 * A run spoken of the skill's own user — 「자신에게 [화상]을 부여하는」, 「자신의 [진동] 횟수를 소모하는」 —
 * as a `selfKeyword` when every keyword in it is a debuff, else null.
 */
function selfRequirement(t: string, index: number, runs: Run[], verbText: string): SingleRequirement | null {
  const before = /자신(?:의|에게)\s*$/.test(t.slice(Math.max(0, index - 6), index));
  const after = /^\s*(?:을|를|이|가)?\s*자신에게/.test(t.slice(index + 1));
  if (!before && !after) return null;
  const keywords = runOf(t, index, runs).keywords;
  if (!keywords.every((k) => SELF_DEBUFFS.has(k))) return null;
  return {
    type: 'selfKeyword',
    keywords: keywords as StatusKeyword[],
    verb: /소모/.test(verbText) ? 'consume' : 'gain',
  };
}

/** Returns whether the line names an E.G.O skill that inflicts or gains a keyword (an `egoSkill`). */
function scanSkillKeywords(
  t: string,
  runs: Run[],
  hits: Hit[],
  usedRuns: Set<number>,
  full: string,
): boolean {
  let egoSkill = false;
  const skillReq = (index: number, slot?: number): SingleRequirement => {
    const keywords = runOf(t, index, runs).keywords;
    return {
      type: 'skillKeyword',
      keywords,
      includesSpecial: keywords.some((k) => saysSpecial(full, k)),
      ...(slot ? { slot: slot as 1 | 2 | 3 } : {}),
    };
  };

  // A: 「[X]을 부여하는 (공격) 스킬」, 「[X]을 획득하는 인격」, 「[X] 위력을 부여하는 코인 효과」.
  const A = new RegExp(
    `(${RUN_CHAR})\\s*(?:을|를|이|가)?\\s*(?:적에게\\s*|대상에게\\s*|자신에게\\s*)?(?:\\d+\\s*이상\\s*)?(?:추가로\\s*|처음으로\\s*|누적\\s*)?${VERB}(?:\\s*(?:또는|및)\\s*${VERB})?(?:${ADJ}|(?=\\s*스킬))\\s*((?:더하기\\s*코인\\s*|빼기\\s*코인\\s*|기본\\s*|공격\\s*|E\\.G\\.O\\s*)*)(스킬|인격|아군|코인\\s*효과)`,
    'g',
  );
  for (const m of t.matchAll(A)) {
    const index = m.index;
    if (/^\s*으로\s*취급/.test(t.slice(index + m[0].length))) continue;
    usedRuns.add(index);
    // 「…을 부여하는 E.G.O 스킬」: the keyword is the E.G.O's, and an E.G.O skill always holds (owner).
    if (/E\.G\.O/.test(m[2]!)) {
      egoSkill = true;
      continue;
    }
    let slot: number | undefined;
    if (m[3] === '스킬') {
      const after = t.slice(index + m[0].length);
      const s = /^\s*([123])(?!\d)(?!\s*이\s*아닌)(?!\s*,\s*스킬)/.exec(after);
      if (s) slot = Number(s[1]);
    }
    const own = selfRequirement(t, index, runs, m[0]);
    let req: EffectRequirement = own ?? skillReq(index, slot);
    // 「[진동] 위력을 부여하거나 자신의 [진동] 횟수를 소모하는 스킬」: either skill qualifies.
    const second = new RegExp(`자신의\\s*(${RUN_CHAR})\\s*(?:을|를)?\\s*(?:\\d+\\s*)?(${VERB})`).exec(m[0]);
    if (!own && second) {
      const at = index + second.index + second[0].indexOf(second[1]!);
      const alt = selfRequirement(t, at, runs, second[2]!);
      if (alt) {
        usedRuns.add(at);
        req = { type: 'anyOf', options: [req as SingleRequirement, alt] };
      }
    }
    hits.push({ start: index, end: index + m[0].length, req });
  }

  // C: the skill is the subject — 「스킬로 적에게 [X] 부여 시」, 「스킬 효과로 획득하는 [X]」,
  // 「공격 스킬을 사용하여 소모한 [X]」, 「아군이 [X]을 부여할 때마다」.
  const MARKER =
    /(?:스킬(?:,\s*코인)?\s*(?:효과)?\s*(?:로|으로|을\s*사용하여|를\s*사용하여)|아군이)([^,.\n]{0,40})/g;
  for (const m of t.matchAll(MARKER)) {
    const window = m[1]!;
    const base = m.index + m[0].length - window.length;
    const after = new RegExp(
      `^[^\\d\\uE000-\\uE0FF]{0,14}?(${RUN_CHAR})\\s*(?:을|를)?\\s*(?:\\d+\\s*이상\\s*)?(?:적에게\\s*|처음으로\\s*|추가로\\s*)?${VERB}${COND}`,
    ).exec(window);
    const before = new RegExp(`^[^\\d\\uE000-\\uE0FF]{0,14}?${VERB}(?:하는|한|는)\\s*(${RUN_CHAR})`).exec(
      window,
    );
    const found = after ?? before;
    if (!found) continue;
    const index = after ? base + found[0].indexOf(found[1]!) : base + found[0].length - 1;
    if (usedRuns.has(index)) continue;
    usedRuns.add(index);
    hits.push({ start: m.index, end: base + found[0].length, req: skillReq(index) });
  }

  // Spending 충전 is only ever done by a skill: 「[Charge] 횟수를 10 소모할 때마다」.
  for (const m of t.matchAll(
    new RegExp(`(${RUN_CHAR})\\s*(?:을|를)?\\s*(?:\\d+\\s*(?:이상\\s*)?)?소모(?:했|하였|하면|할|한)`, 'g'),
  )) {
    if (usedRuns.has(m.index)) continue;
    if (!runOf(t, m.index, runs).keywords.includes('Charge')) continue;
    usedRuns.add(m.index);
    hits.push({
      start: m.index,
      end: m.index + m[0].length,
      req: { type: 'skillKeyword', keywords: ['Charge'], includesSpecial: saysSpecial(full, 'Charge') },
    });
  }

  // 탄환 and 혈찬 exist only on identities: any mention that is not the gift handing them out asks
  // for an identity that uses them.
  for (let i = 0; i < t.length; i += 1) {
    const code = t.charCodeAt(i);
    if (code < RUN_BASE || code > RUN_BASE + 0xff || usedRuns.has(i)) continue;
    const own = runOf(t, i, runs).keywords.filter((k) => k === 'Bullet' || k === 'BloodDinner');
    if (own.length === 0) continue;
    const rest = t.slice(i + 1);
    const before = t.slice(Math.max(0, i - 4), i);
    if (
      /^\s*(?:을|를)?\s*(?:[^,.]{0,20}?만큼\s*|\d+\s*)?(?:얻음|얻고|얻는다|생성(?!될)|부여(?!\s*시))/.test(
        rest,
      )
    )
      continue;
    if (/만큼\s*$/.test(before)) continue;
    usedRuns.add(i);
    hits.push({ start: i, end: i + 1, req: { type: 'skillKeyword', keywords: own, includesSpecial: false } });
  }
  return egoSkill;
}

/** 「분노 속성 공격 스킬」, 「오만 관통 스킬」, 「참격 유형인 스킬 1」, 「질투 속성이나 타격 속성 기본 스킬」. */
function scanSkills(t: string, hits: Hit[]): void {
  const LIST = (alt: string): string => `(?:(?:${alt})(?:\\s*(?:,|또는|이나|나)\\s*(?:${alt}))*)`;
  const re = new RegExp(
    `(${LIST(SIN_ALT)})?\\s*(?:속성\\s*)?(이나|또는|,)?\\s*(${LIST(ATK_ALT)})?\\s*(?:속성|유형인?)?\\s*(?:의\\s*)?(?:기본\\s*)?(?:공격\\s*)?스킬`,
    'g',
  );
  for (const m of t.matchAll(re)) {
    if (!m[1] && !m[3]) continue;
    // Words glued to the front (「…하는스킬」) are not a sin or a type.
    const sins = m[1] ? [...m[1].matchAll(new RegExp(SIN_ALT, 'g'))].map((s) => SIN_KO[s[0]]!) : [];
    const attackTypes = m[3] ? [...m[3].matchAll(new RegExp(ATK_ALT, 'g'))].map((s) => ATTACK_KO[s[0]]!) : [];
    const start = m.index + (m[0].length - m[0].trimStart().length);
    // 「색욕 속성 또는 참격 속성 스킬」: a skill of either, not one skill of both.
    if (sins.length > 0 && attackTypes.length > 0 && m[2]) {
      hits.push({
        start,
        end: m.index + m[0].length,
        req: { type: 'anyOf', options: [skillRequirement(sins, []), skillRequirement([], attackTypes)] },
      });
      continue;
    }
    hits.push({ start, end: m.index + m[0].length, req: skillRequirement(sins, attackTypes) });
  }
  // 「보유한 모든 기본 공격 스킬이 참격 유형인 아군」
  // 「사용한 공격 스킬 속성 중 색욕이 존재할 경우」
  for (const m of t.matchAll(new RegExp(`스킬\\s*속성\\s*중\\s*(${SIN_ALT})`, 'g'))) {
    hits.push({ start: m.index, end: m.index + m[0].length, req: skillRequirement([SIN_KO[m[1]!]!], []) });
  }
  for (const m of t.matchAll(new RegExp(`스킬이\\s*(${ATK_ALT})\\s*유형`, 'g'))) {
    hits.push({ start: m.index, end: m.index + m[0].length, req: skillRequirement([], [ATTACK_KO[m[1]!]!]) });
  }
  // An ally boost to a type: 「참격 피해량 +35%」, 「참격 위력 증가 1 얻음」.
  for (const m of t.matchAll(new RegExp(`(?<!받는\\s)(${ATK_ALT})\\s*(?:피해량|위력\\s*증가)`, 'g'))) {
    hits.push({ start: m.index, end: m.index + m[0].length, req: skillRequirement([], [ATTACK_KO[m[1]!]!]) });
  }
  // The same boost as a buff id an ally gains: [SlashDamageUp], [ScarletResultUp].
  for (const m of t.matchAll(/\[([A-Za-z]+?)(?:Damage|Result)Up\]([^.]*)/g)) {
    if (!/얻|획득/.test(m[2]!)) continue;
    const word = m[1]!;
    const req = ATTACK_BY_WORD[word]
      ? skillRequirement([], [ATTACK_BY_WORD[word]!])
      : SIN_BY_COLOR_WORD[word]
        ? skillRequirement([SIN_BY_COLOR_WORD[word]!], [])
        : null;
    if (req) hits.push({ start: m.index, end: m.index + word.length + 12, req });
  }
}

function skillRequirement(sins: Sin[], attackTypes: AttackType[]): SingleRequirement {
  return {
    type: 'skill',
    ...(sins.length > 0 ? { sins: sortSins(sins) } : {}),
    ...(attackTypes.length > 0 ? { attackTypes: sortAttack(attackTypes) } : {}),
  };
}

const sortSins = (xs: Sin[]): Sin[] => [...new Set(xs)].sort((a, b) => SINS.indexOf(a) - SINS.indexOf(b));
const sortAttack = (xs: AttackType[]): AttackType[] =>
  [...new Set(xs)].sort((a, b) => ATTACK_TYPES.indexOf(a) - ATTACK_TYPES.indexOf(b));

function scanResonance(t: string, hits: Hit[]): void {
  const re = new RegExp(`((?:${SIN_ALT})(?:\\s*(?:또는|,)\\s*(?:${SIN_ALT}))*)\\s*(?:완전\\s*)?공명`, 'g');
  for (const m of t.matchAll(re)) {
    const sins = [...m[1]!.matchAll(new RegExp(SIN_ALT, 'g'))].map((s) => SIN_KO[s[0]]!);
    hits.push({
      start: m.index,
      end: m.index + m[0].length,
      req: { type: 'resonance', sins: sortSins(sins) },
    });
  }
}

function scanShapes(t: string, hits: Hit[]): void {
  const rules: [RegExp, (m: RegExpMatchArray) => EffectRequirement][] = [
    [/단일\s*코인/g, () => ({ type: 'shape', kind: 'singleCoin' })],
    [/코인\s*수가\s*(\d+)\s*개?\s*이하/g, (m) => ({ type: 'shape', kind: 'coinsAtMost', n: Number(m[1]) })],
    [/코인\s*수가\s*(\d+)\s*개?\s*이상/g, (m) => ({ type: 'shape', kind: 'coinsAtLeast', n: Number(m[1]) })],
    [
      /더하기\s*코인(?:을\s*(?:굴리|사용하)는)?\s*(?:기본\s*)?(?:공격\s*)?(?:스킬|공격)/g,
      () => ({ type: 'shape', kind: 'plusCoin' }),
    ],
    [
      new RegExp(
        `(?:빼기|마이너스)\\s*코인(?:을\\s*(?:굴리|사용하)는)?\\s*(?:(?:${ATK_ALT})\\s*)?(?:기본\\s*)?(?:공격\\s*)?(?:스킬|이면|인\\s*아군)`,
        'g',
      ),
      () => ({ type: 'shape', kind: 'minusCoin' }),
    ],
    [
      /파괴\s*불가\s*코인|\[SuperCoin\](?!\s*으로\s*(?:변경|피해를\s*받))/g,
      () => ({ type: 'shape', kind: 'unbreakableCoin' }),
    ],
    [/공격\s*가중치가\s*(\d+)\s*이상인/g, (m) => ({ type: 'shape', kind: 'weightAtLeast', n: Number(m[1]) })],
    [/공격\s*가중치가\s*(\d+)인/g, (m) => ({ type: 'shape', kind: 'weightExactly', n: Number(m[1]) })],
  ];
  for (const [re, make] of rules) {
    for (const m of t.matchAll(re)) hits.push({ start: m.index, end: m.index + m[0].length, req: make(m) });
  }
}

function scanDefense(t: string, hits: Hit[]): void {
  const rules: [RegExp, DefenseType[]][] = [
    [/반격\s*스킬/g, ['counter']],
    [/회피\s*스킬|회피를\s*\d+\s*회\s*성공/g, ['evade']],
    [/가드\s*스킬/g, ['guard']],
    [/수비\s*스킬/g, [...DEFENSE_TYPES]],
  ];
  for (const [re, kinds] of rules) {
    for (const m of t.matchAll(re))
      hits.push({ start: m.index, end: m.index + m[0].length, req: { type: 'defense', kinds } });
  }
}

/** 「X (또는 Y) 소속」. A name that resolves to no faction leaves the line unclassified. */
function scanFactions(t: string, hits: Hit[], ctx: EffectContext): boolean {
  let unresolved = false;
  const squashedNames = [...ctx.factionIdByName].map(([name, id]) => [squash(name), id] as const);
  /** The faction named by the longest run of trailing words, and how many words it took. */
  const trailing = (words: string[]): { id: string; used: number } | null => {
    for (let start = 0; start < words.length; start += 1) {
      const candidate = words.slice(start).join(' ');
      const id =
        ctx.factionIdByName.get(candidate) ?? squashedNames.find(([name]) => name === squash(candidate))?.[1];
      if (id) return { id, used: words.length - start };
    }
    return null;
  };
  const SEGMENT_STOP = new RegExp(`[,.\\n[\\](){}]|${RUN_CHAR}`);
  // 「중지 인격의 경우」: a faction name standing right before 「인격」 as the condition's subject.
  for (const m of t.matchAll(/(?:^|[\s,])([^\s,.]+)\s*인격(?:의\s*경우|이면|일\s*경우)/g)) {
    const id = ctx.factionIdByName.get(m[1]!);
    if (id)
      hits.push({ start: m.index, end: m.index + m[0].length, req: { type: 'faction', factions: [id] } });
  }
  // 「T사 직원이면」 names the company without 「소속」.
  for (const m of t.matchAll(/([A-Z가-힣]+사)\s*(?:\d등급\s*)?직원/g)) {
    const id = ctx.factionIdByName.get(m[1]!);
    if (id)
      hits.push({ start: m.index, end: m.index + m[0].length, req: { type: 'faction', factions: [id] } });
  }
  for (const m of t.matchAll(/소속/g)) {
    const before = t.slice(Math.max(0, m.index - 30), m.index);
    const segment = before.split(SEGMENT_STOP).pop()!.trim();
    if (segment === '' || /(?:같은|동일한|해당|다른)$/.test(segment)) continue;
    // Read names backwards from 「소속」: 「검계 또는 흑운회」 is two, joined by 또는.
    let words = segment.split(/\s+/);
    const ids: string[] = [];
    for (;;) {
      const found = trailing(words);
      if (!found) break;
      ids.push(found.id);
      words = words.slice(0, words.length - found.used);
      if (words.length > 0 && /^(?:또는|혹은|이나)$/.test(words[words.length - 1]!))
        words = words.slice(0, -1);
      else break;
    }
    if (ids.length === 0) {
      unresolved = true;
      continue;
    }
    hits.push({
      start: m.index - Math.min(segment.length, 12),
      end: m.index + 2,
      req: { type: 'faction', factions: [...new Set(ids)].sort() },
    });
  }
  return unresolved;
}

function squash(text: string): string {
  return text.replace(/\s+/g, '');
}

/** Named identities — 「거미집의 검 료슈가 덱에 편성되어 있으면」 — but not an E.G.O of the same name. */
function scanIdentities(text: string, ctx: EffectContext): EffectRequirement[] {
  const hay = squash(text);
  const names = ctx.identities
    .map((i) => ({ id: i.id, name: squash(`${i.title}${i.sinner}`) }))
    .filter((i) => i.name.length > 2)
    .sort((a, b) => b.name.length - a.name.length || a.id - b.id);
  const taken: [number, number][] = [];
  const out: EffectRequirement[] = [];
  for (const { id, name } of names) {
    let from = 0;
    for (;;) {
      const at = hay.indexOf(name, from);
      if (at < 0) break;
      from = at + 1;
      if (taken.some(([s, e]) => at < e && at + name.length > s)) continue;
      if (hay.slice(at + name.length).startsWith('E.G.O')) continue;
      taken.push([at, at + name.length]);
      out.push({ type: 'identity', ids: [id] });
    }
  }
  return out;
}

/** An identity buff in condition position — 「[LegStrength]가 있으면」, 「보유한 [VibrationIgnition] 1당」. */
function scanIdentityBuffs(t: string, hits: Hit[], ctx: EffectContext): void {
  const COND_AFTER =
    /^\s*(?:(?:이|가|을|를|은|는)\s*)?(?:있|없|보유|상태|수치|가진|\d+\s*당|당|이면|으면|일\s*때|일\s*경우|얻을\s*때|사망|효과로|시[\s,]|부여\s*시|하였다면|했다면|했으면)|^\s*의\s/;
  for (const m of t.matchAll(/\[([A-Za-z0-9_]+)\]/g)) {
    const id = m[1]!;
    const end = m.index + m[0].length;
    if (/^Switch_Vibration$|^FusionVibration$/.test(id)) {
      // A vibration conversion is something a vibration skill does; a gift doing it (「[X]로 [Switch_Vibration]」) is not a condition.
      if (/로\s*$/.test(t.slice(Math.max(0, m.index - 3), m.index))) continue;
      hits.push({
        start: m.index,
        end,
        req: { type: 'skillKeyword', keywords: ['Vibration'], includesSpecial: false },
      });
      continue;
    }
    if (/^BloodDinner_/.test(id)) {
      hits.push({
        start: m.index,
        end,
        req: { type: 'skillKeyword', keywords: ['BloodDinner'], includesSpecial: false },
      });
      continue;
    }
    if (DEDICATED_IDS.test(id) || KEYWORD_SET.has(id) || ctx.grantedBuffs.has(id)) continue;
    const before = t.slice(Math.max(0, m.index - 10), m.index);
    const after = t.slice(end);
    const verbObject = new RegExp(
      `^\\s*(?:을|를)\\s*${VERB}${ADJ}\\s*(?:기본\\s*|공격\\s*)*(?:스킬|인격|아군)`,
    ).test(after);
    if (!COND_AFTER.test(after) && !/(?:보유한|가진|있는)\s*(?:모든\s*)?$/.test(before) && !verbObject)
      continue;
    hits.push({ start: m.index, end, req: { type: 'identityBuff', buffs: [id] } });
  }
}

/**
 * An E.G.O skill of a sin or keyword — 「분노 속성 E.G.O 스킬의 경우」, 「아군이 E.G.O 스킬 효과로」. No
 * identity's E.G.O is in the data and the owner counts it as always met, so the sin or keyword in the
 * clause asks nothing more (`egoSkill`). 「(E.G.O 스킬 제외 …)」 went with the parentheses, and
 * 「E.G.O 자원」 is a resource, not a skill.
 */
const EGO_SKILL = new RegExp(
  `(?:하는|속성(?:의)?|(?:${SIN_ALT}))\\s*E\\.G\\.O\\s*스킬|E\\.G\\.O\\s*스킬\\s*효과로|E\\.G\\.O\\s*장비를`,
);

/**
 * A skill that discards (「버림 스킬을 사용하여」, 「다른 스킬을 [Discard]하였다면」) asks for an identity
 * whose base skill discards — its `buffs` carry `Discard`. Not 「소수점 버림」·「버림하여 처리」 (rounding).
 */
const DISCARD = /버림\s*(?:스킬|효과가\s*있는)|\[Discard\]\s*(?:하였다면|했다면|하면|한\s|하는)/g;

function scanDiscard(t: string, hits: Hit[]): void {
  for (const m of t.matchAll(DISCARD))
    hits.push({
      start: m.index,
      end: m.index + m[0].length,
      req: { type: 'identityBuff', buffs: ['Discard'] },
    });
}

const UNCLASSIFIED: RegExp[] = [
  // A trait of an ally (<혈귀>), which no requirement type holds.
  /아군에\s*<|혈귀인/,
];

function analyzeLine(text: string, bullets: readonly string[], ctx: EffectContext): LineAnalysis {
  const full = normalizeKeywords(text);
  const scanText = removeParens(full.replace(/※.*$/, ''));
  const tokenized = tokenizeRuns(scanText);
  const t = cutStrengthening(tokenized.text);
  const runs = tokenized.runs;
  const hits: Hit[] = [];
  const usedRuns = new Set<number>();
  let unclassified = false;

  const egoSkill = scanSkillKeywords(t, runs, hits, usedRuns, full) || EGO_SKILL.test(scanText);
  scanSkills(t, hits);
  scanResonance(t, hits);
  scanShapes(t, hits);
  scanDefense(t, hits);
  if (scanFactions(t, hits, ctx)) unclassified = true;
  scanIdentityBuffs(t, hits, ctx);
  scanDiscard(t, hits);
  if (UNCLASSIFIED.some((re) => re.test(scanText))) unclassified = true;

  // Alternatives: hits joined by 또는 / 이나 / 거나. Same-kind alternatives merge (`keywords` and
  // `sins` already mean ANY); alternatives across kinds become one `anyOf`.
  hits.sort((a, b) => a.start - b.start || a.end - b.end);
  const groups: Hit[][] = [];
  for (const hit of hits) {
    const last = groups[groups.length - 1];
    const prev = last?.[last.length - 1];
    if (prev && hit.start >= prev.end) {
      const between = t.slice(prev.end, hit.start);
      if (between.length <= 16 && !/[,.]/.test(between) && /또는|혹은|거나|이나/.test(between)) {
        last!.push(hit);
        continue;
      }
    }
    groups.push([hit]);
  }
  const reqs: EffectRequirement[] = groups.map((group) => mergeAlternatives(group.map((h) => h.req)));
  if (egoSkill) reqs.push({ type: 'egoSkill' });

  // Shapes offered as alternatives within the effect (「더하기 코인 스킬 … - 빼기 코인 스킬일 경우,
  // 대신 …」) mean any skill qualifies.
  const effectText = [scanText, ...bullets].join('\n');
  const hasPlus = reqs.some((r) => r.type === 'shape' && r.kind === 'plusCoin');
  const hasMinus =
    reqs.some((r) => r.type === 'shape' && r.kind === 'minusCoin') ||
    /(?:빼기|마이너스)\s*코인/.test(bullets.join('\n'));
  let requires = reqs;
  if (hasPlus && hasMinus && /더하기\s*코인/.test(effectText)) {
    requires = reqs.filter((r) => !(r.type === 'shape' && (r.kind === 'plusCoin' || r.kind === 'minusCoin')));
  }

  requires.push(...scanIdentities(scanText, ctx));

  // Thresholds the condition parser reads (「…보유한 인격이 5인 이상」, 「중지 소속 인격이 4인 이상」).
  const { conditions } = parseConditions({ ko: full, en: '' }, ctx);
  for (const c of conditions) {
    if (c.type === 'unparsed') unclassified = true;
    if (c.type === 'keywordSkillCount') {
      requires.push({
        type: 'skillKeyword',
        keywords: sortKeywords(c.keywords),
        includesSpecial: c.includesSpecial,
        ...(c.min !== null ? { min: c.min, scope: c.scope } : {}),
      });
    }
    if (c.type === 'factionCount') {
      requires.push({ type: 'faction', factions: [...c.factions].sort(), min: c.min, scope: c.scope });
    }
  }

  return { requires: normalizeRequirements(requires), unclassified };
}

/**
 * One requirement for alternatives joined by 또는: same-kind ones merge (`keywords`, `sins`, `factions`
 * already mean ANY), the rest become the options of one `anyOf`. An option may itself be a merged
 * requirement; an `anyOf` among the alternatives is flattened, so options never nest.
 */
function mergeAlternatives(reqs: readonly EffectRequirement[]): EffectRequirement {
  const flat = reqs.flatMap((r): SingleRequirement[] => (r.type === 'anyOf' ? r.options : [r]));
  const options: SingleRequirement[] = [];
  for (const type of [...new Set(flat.map((r) => r.type))]) {
    const same = flat.filter((r) => r.type === type);
    if (type === 'skill') {
      // A sin skill and an attack-type skill are different skills; each list merges on its own.
      const all = same as Extract<SingleRequirement, { type: 'skill' }>[];
      const sinsOnly = all.filter((r) => r.sins && !r.attackTypes);
      const typesOnly = all.filter((r) => r.attackTypes && !r.sins);
      if (sinsOnly.length > 0) options.push(mergeSameKind(sinsOnly) ?? sinsOnly[0]!);
      if (typesOnly.length > 0) options.push(mergeSameKind(typesOnly) ?? typesOnly[0]!);
      options.push(...all.filter((r) => !sinsOnly.includes(r) && !typesOnly.includes(r)));
      continue;
    }
    const merged = same.length === 1 ? same[0]! : mergeSameKind(same);
    if (merged) options.push(merged);
    else options.push(...same);
  }
  return normalizeAnyOf(options);
}

/** One requirement for options, or `anyOf` of them sorted and deduplicated. */
function normalizeAnyOf(options: readonly SingleRequirement[]): EffectRequirement {
  const unique = [...new Map(options.map((o) => [JSON.stringify(o), o])).values()].sort(compareRequirements);
  return unique.length === 1 ? unique[0]! : { type: 'anyOf', options: unique };
}

/** Same-kind alternatives as one requirement, or null when they cannot be one. */
function mergeSameKind(reqs: readonly SingleRequirement[]): SingleRequirement | null {
  const type = reqs[0]!.type;
  if (reqs.some((r) => r.type !== type)) return null;
  switch (type) {
    case 'skillKeyword': {
      const all = reqs as Extract<SingleRequirement, { type: 'skillKeyword' }>[];
      const slot = all.every((r) => r.slot === all[0]!.slot) ? all[0]!.slot : undefined;
      return {
        type,
        keywords: sortKeywords(all.flatMap((r) => r.keywords)),
        includesSpecial: all.some((r) => r.includesSpecial),
        ...(slot ? { slot } : {}),
      };
    }
    case 'skill': {
      const all = reqs as Extract<SingleRequirement, { type: 'skill' }>[];
      if (all.every((r) => r.sins && !r.attackTypes))
        return skillRequirement(
          all.flatMap((r) => r.sins!),
          [],
        );
      if (all.every((r) => r.attackTypes && !r.sins))
        return skillRequirement(
          [],
          all.flatMap((r) => r.attackTypes!),
        );
      return null;
    }
    case 'faction':
      return {
        type,
        factions: [
          ...new Set((reqs as Extract<SingleRequirement, { type: 'faction' }>[]).flatMap((r) => r.factions)),
        ].sort(),
      };
    case 'resonance':
      return {
        type,
        sins: sortSins((reqs as Extract<SingleRequirement, { type: 'resonance' }>[]).flatMap((r) => r.sins)),
      };
    case 'defense':
      return {
        type,
        kinds: [
          ...new Set((reqs as Extract<SingleRequirement, { type: 'defense' }>[]).flatMap((r) => r.kinds)),
        ].sort((a, b) => DEFENSE_TYPES.indexOf(a) - DEFENSE_TYPES.indexOf(b)),
      };
    case 'identityBuff':
      return {
        type,
        buffs: [
          ...new Set(
            (reqs as Extract<SingleRequirement, { type: 'identityBuff' }>[]).flatMap((r) => r.buffs),
          ),
        ].sort(),
      };
    case 'identity':
      return {
        type,
        ids: [
          ...new Set((reqs as Extract<SingleRequirement, { type: 'identity' }>[]).flatMap((r) => r.ids)),
        ].sort((a, b) => a - b),
      };
    case 'shape':
    case 'egoSkill':
      return reqs.every((r) => JSON.stringify(r) === JSON.stringify(reqs[0])) ? reqs[0]! : null;
    case 'selfKeyword': {
      const all = reqs as Extract<SingleRequirement, { type: 'selfKeyword' }>[];
      if (!all.every((r) => r.verb === all[0]!.verb)) return null;
      const keywords = [...new Set(all.flatMap((r) => r.keywords))].sort(
        (a, b) => IDENTITY_KEYWORDS.indexOf(a) - IDENTITY_KEYWORDS.indexOf(b),
      );
      return { type, keywords, verb: all[0]!.verb };
    }
    default:
      return null;
  }
}

const TYPE_ORDER: EffectRequirement['type'][] = [
  'skillKeyword',
  'identityBuff',
  'faction',
  'identity',
  'skill',
  'resonance',
  'shape',
  'defense',
  'selfKeyword',
  'egoSkill',
  'anyOf',
];

function compareRequirements(a: EffectRequirement, b: EffectRequirement): number {
  return (
    TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) ||
    JSON.stringify(a).localeCompare(JSON.stringify(b))
  );
}

/**
 * Merge duplicates and order deterministically. Two `skillKeyword` on the same keywords and slot
 * are one requirement — the one carrying a threshold wins its `min` and `scope`; the same for two
 * `faction` on the same factions. An `anyOf` has its options sorted and deduplicated and collapses to
 * its option when only one is left. It stays even when the line also requires one of its options
 * (「타격 스킬 또는 나태 속성 스킬로 … 타격 스킬 위력 +2」): the judgement is the same, and the 나태
 * skill is still what sets the effect off.
 */
export function normalizeRequirements(input: readonly EffectRequirement[]): EffectRequirement[] {
  const byKey = new Map<string, EffectRequirement>();
  const reqs = input.map((req) => (req.type === 'anyOf' ? normalizeAnyOf(req.options) : req));
  for (const req of reqs) {
    let key: string;
    if (req.type === 'skillKeyword') key = `k:${req.keywords.join('+')}:${req.slot ?? ''}`;
    else if (req.type === 'faction') key = `f:${req.factions.join('|')}`;
    else key = JSON.stringify(req);
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, req);
      continue;
    }
    if (req.type === 'skillKeyword' && prev.type === 'skillKeyword') {
      const min = Math.max(prev.min ?? 0, req.min ?? 0);
      const scope = (req.min ?? 0) >= (prev.min ?? 0) ? (req.scope ?? prev.scope) : (prev.scope ?? req.scope);
      byKey.set(key, {
        type: 'skillKeyword',
        keywords: prev.keywords,
        includesSpecial: prev.includesSpecial || req.includesSpecial,
        ...(prev.slot ? { slot: prev.slot } : {}),
        ...(min > 0 ? { min } : {}),
        ...(scope ? { scope } : {}),
      });
    } else if (req.type === 'faction' && prev.type === 'faction') {
      const min = Math.max(prev.min ?? 0, req.min ?? 0);
      const scope = (req.min ?? 0) >= (prev.min ?? 0) ? (req.scope ?? prev.scope) : (prev.scope ?? req.scope);
      byKey.set(key, {
        type: 'faction',
        factions: prev.factions,
        ...(min > 0 ? { min } : {}),
        ...(scope ? { scope } : {}),
      });
    }
  }
  // A keyword requirement covered by a stricter one on the same keywords (a threshold, a slot) is redundant.
  const list = [...byKey.values()];
  const kept = list.filter((req) => {
    if (req.type !== 'skillKeyword' || req.min || req.slot) return true;
    return !list.some(
      (other) =>
        other !== req &&
        other.type === 'skillKeyword' &&
        other.keywords.join('+') === req.keywords.join('+') &&
        (other.min || other.slot),
    );
  });
  return kept.sort(compareRequirements);
}

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

/** 「[편성 1번, 2번 인격 전용 효과]」, 「[1번 편성 전용 효과]」 and the like: the player picks the slot. */
const HEADING_RE = /^\[([^\]]*?)\s*전용\s*효과\]\s*(.*)$/;
const SLOT_RE = /\d+\s*번|편성/;
const TIER_RE = /^[-•]\s*(\d+)\s*(?:인|명)\s*이상\s*$/;
const NOTE_RE = /^(?:※|\[중첩\s*발동\s*불가\])/;
/** A line that only switches effects on: 「…이면, 이번 전투 동안 발동」, 「… 인격에게 효과 적용.」 */
const GATE_END = /(?:발동|(?:아래|다음)\s*효과\s*적용|효과\s*적용|에게?\s*적용됨?)$/;
/** A line that modifies the effect above it. */
const STRENGTHEN_RE = /효과가\s*(?:더욱\s*|최대로\s*)?(?:강화|변경)|효과를\s*대신하여/;
const INHERIT_RE =
  /^(?:해당\s|위\s*효과|이후,?\s)|효과가\s*(?:더욱\s*|최대로\s*)?(?:강화|변경)|효과를\s*대신하여/;

export interface ParsedEffects {
  effects: GiftEffect[];
  /** Per effect, the line it was read from (head only) — for tests and the build's report. */
  lines: string[];
}

/**
 * The heading of an exclusive section (「[검지 소속 인격 전용 효과]」, 「[거미집의 검 료슈 전용 효과]」)
 * as a requirement on the effects under it. Null when the name resolves to nothing.
 */
function headingRequirements(inner: string, ctx: EffectContext): EffectRequirement[] | null {
  const identities = scanIdentities(inner, ctx);
  if (identities.length > 0) return identities;
  const name = inner.replace(/\s*(?:소속\s*)?인격$|\s*소속$/, '').trim();
  const faction = resolveFaction(name, ctx.factionIdByName);
  return faction ? [{ type: 'faction', factions: [faction] }] : null;
}

export function parseEffects(rawKo: string, ctx: EffectContext): ParsedEffects {
  const blocks = splitEffectBlocks(prepareText(rawKo));
  const effects: GiftEffect[] = [];
  const lines: string[] = [];
  let anyEffect = false;
  /** Requirements of a mid-text gate, binding every effect after it. */
  const pushdown: EffectRequirement[] = [];
  /** Requirements of the current exclusive section. */
  let section: EffectRequirement[] = [];
  /** The keyword condition of a 「편성된 수에 따라」 heading whose steps follow as 「- N인 이상」. */
  let scaling: Extract<EffectRequirement, { type: 'skillKeyword' }> | null = null;
  let tier: { paragraph: number; req: EffectRequirement } | null = null;
  let previous: EffectRequirement[] = [];

  const emit = (effect: GiftEffect, line: string): void => {
    effects.push(effect);
    lines.push(line);
  };

  blocks.forEach((block, index) => {
    let head = block.head.replace(BULLET_RE, '').trim();
    const line = block.head;

    // 「※ …」, 「[중첩 발동 불가] …」, and a line that is all parenthesis (「(강제 흐트러짐 제외, 전투당 2회 발동)」).
    if (NOTE_RE.test(head) || /^\([^()]*\)$/.test(head)) return emit({ kind: 'note', requires: [] }, line);

    const heading = HEADING_RE.exec(head);
    let headingUnresolved = false;
    if (heading) {
      const inner = heading[1]!;
      if (SLOT_RE.test(inner) && !/소속/.test(inner)) section = [];
      else {
        const reqs = headingRequirements(inner, ctx);
        headingUnresolved = reqs === null;
        section = reqs ?? [];
      }
      head = heading[2]!.trim();
      if (head === '') {
        return emit(
          { kind: 'note', requires: [], ...(headingUnresolved ? { unclassified: true as const } : {}) },
          line,
        );
      }
    }

    const tierMatch = TIER_RE.exec(block.head);
    if (tierMatch) {
      if (scaling) tier = { paragraph: block.paragraph, req: { ...scaling, min: Number(tierMatch[1]) } };
      return emit({ kind: 'note', requires: [] }, line);
    }
    if (tier && tier.paragraph !== block.paragraph) tier = null;

    const analysis = analyzeLine(head, block.bullets, ctx);
    const own = analysis.unclassified ? [] : analysis.requires;
    const unclassified = analysis.unclassified || headingUnresolved;

    // 「…을 부여하는 인격이 편성된 수에 따라 기프트 효과 강화」: with steps below it, the steps carry the
    // threshold; without, the gift scales from the first such identity, so it gates on one.
    if (/편성된\s*수에\s*따라/.test(head)) {
      const keywordReq = own.find((r) => r.type === 'skillKeyword');
      const laterTiers = blocks.slice(index + 1).some((b) => TIER_RE.test(b.head));
      if (keywordReq && keywordReq.type === 'skillKeyword' && laterTiers) {
        const counted = parseConditions({ ko: head, en: '' }, ctx).conditions.find(
          (c) => c.type === 'keywordSkillCount',
        );
        const scope = counted?.type === 'keywordSkillCount' ? counted.scope : keywordReq.scope;
        scaling = {
          type: 'skillKeyword',
          keywords: keywordReq.keywords,
          includesSpecial: keywordReq.includesSpecial,
          ...(scope ? { scope } : {}),
        };
        return emit({ kind: 'note', requires: [] }, line);
      }
    }

    const bare = removeParens(head).replace(/[.\s]+$/, '');
    const scalingGate = /편성된\s*수에\s*따라/.test(head);
    const gateLike =
      block.bullets.length === 0 && (GATE_END.test(bare) || /^아래\s*효과는/.test(bare) || scalingGate);
    if (gateLike) {
      const reqs = normalizeRequirements([...section, ...own]);
      if (!anyEffect) {
        return emit(
          { kind: 'gate', requires: reqs, ...(unclassified ? { unclassified: true as const } : {}) },
          line,
        );
      }
      pushdown.push(...reqs);
      return emit(
        { kind: 'note', requires: [], ...(unclassified ? { unclassified: true as const } : {}) },
        line,
      );
    }

    const inherited = INHERIT_RE.test(head) ? previous : [];
    const tierReqs = tier && tier.paragraph === block.paragraph ? [tier.req] : [];
    const requires = normalizeRequirements([...own, ...section, ...pushdown, ...tierReqs, ...inherited]);
    // A line that strengthens the one above it is not what a later 「해당 …」 line refers to.
    if (!STRENGTHEN_RE.test(head)) previous = requires;
    anyEffect = true;
    emit({ kind: 'effect', requires, ...(unclassified ? { unclassified: true as const } : {}) }, line);
  });

  return { effects, lines };
}

// ---------------------------------------------------------------------------
// Curated override
// ---------------------------------------------------------------------------

export interface CuratedGiftEffects {
  byId: Map<number, GiftEffect[]>;
  errors: string[];
}

/**
 * `data/curated/gift-effects.json`: by gift id, `{ _source, effects }` replacing that gift's parsed
 * effects wholesale. Keys starting with `_` are comments.
 */
export function readCuratedGiftEffects(path: string): CuratedGiftEffects {
  const raw = readJsonIfExists<Record<string, unknown>>(path) ?? {};
  const byId = new Map<number, GiftEffect[]>();
  const errors: string[] = [];
  for (const [key, value] of Object.entries(raw)) {
    if (key.startsWith('_')) continue;
    if (!/^\d+$/.test(key)) {
      errors.push(`key "${key}" is not a gift id`);
      continue;
    }
    const parsed = curatedGiftEffectSchema.safeParse(value);
    if (!parsed.success) {
      errors.push(`${key}: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
      continue;
    }
    byId.set(Number(key), parsed.data.effects);
  }
  return { byId, errors };
}
