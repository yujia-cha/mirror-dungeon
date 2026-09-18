/**
 * Parse conditional-gift activation clauses out of the Korean effect text.
 *
 * Two sentence families carry almost all of them:
 *
 *   키워드형: "[Combustion] 횟수 또는 특수 화상을 부여하는 공격 스킬을 보유한 인격이 5인 이상"
 *   소속형:   "편성된 피쿼드호 소속 인격이 3인 이상일 때 발동 (대기 인원 포함)"
 *
 * The keyword family counts identities whose ATTACK SKILLS inflict the keyword, not identities
 * tagged with it — that distinction is the whole reason this parser exists.
 *
 * Anything that looks like a threshold but does not match becomes an `unparsed` condition so the
 * UI can still show the sentence and `data/curated/conditions.json` can correct it.
 */
import type { Condition, ConditionScope, Localized, StatusKeyword } from '../../src/core/schema.ts';
import { STATUS_KEYWORDS } from '../../src/core/schema.ts';

/** Internal status token -> Korean display name, used to recognise "특수 화상" style wording. */
const KEYWORD_KO: Record<StatusKeyword, string> = {
  Combustion: '화상',
  Laceration: '출혈',
  Vibration: '진동',
  Burst: '파열',
  Sinking: '침잠',
  Breath: '호흡',
  Charge: '충전',
};

const STATUS_SET = new Set<string>(STATUS_KEYWORDS);

/** Strip Unity rich-text markup so the regexes see plain Korean. */
export function stripMarkup(text: string): string {
  return text
    .replace(/<\/?noparse>/g, '')
    .replace(/<style=[^>]*>/g, '')
    .replace(/<\/style>/g, '')
    .replace(/<color=[^>]*>/g, '')
    .replace(/<\/color>/g, '')
    .replace(/<\/?s>/g, '')
    .replace(/<\/?b>/g, '')
    .replace(/<\/?i>/g, '');
}

/**
 * Which units the count applies to.
 * 출격 인원 = the deployed party (see rules.deployment); 대기 인원 포함 / 편성된 = all 12 in the formation.
 */
function scopeFrom(sentence: string, tail: string): ConditionScope {
  const haystack = `${sentence} ${tail}`;
  if (/대기\s*인원에/.test(haystack)) return 'reserve';
  if (/대기\s*인원\s*포함|편성\s*인원|편성된/.test(haystack)) return 'formation';
  return 'deployed';
}

/** Look a little past the match for the parenthetical that names the scope. */
function tailAfter(text: string, index: number): string {
  return text.slice(index, index + 90);
}

const KEYWORD_RE =
  /\[([A-Za-z]+)\][^[\]\n]{0,80}?(?:부여|획득)(?:하거나\s*획득)?하는\s*공격\s*스킬을\s*보유한\s*인격이\s*(\d+)\s*(?:인|명)\s*이상/g;

/**
 * Faction clauses. The name can be a single faction or "A 또는 B"; we keep the raw Korean and
 * resolve it to ids with the caller's lookup so an unknown name fails loudly instead of silently.
 */
const FACTION_RE =
  /([가-힣A-Za-z0-9.\s]{2,20}?)(?:\s*또는\s*([가-힣A-Za-z0-9.\s]{2,20}?))?\s*소속(?:\s*인격)?이\s*(\d+)\s*(?:인|명)\s*이상/g;

const RESONANCE_RE = /완전\s*공명이\s*(\d+)\s*이상/g;

/** "- 5인 이상이면" style follow-ups that strengthen an already-matched condition. */
const TIER_RE = /(\d+)\s*(?:인|명)\s*이상(?:이면|일\s*(?:때|경우))/g;

/** Sentences that mention a threshold but that we failed to model. */
const THRESHOLD_HINT_RE = /(\d+)\s*(?:인|명)\s*이상/;

export interface ParseContext {
  /** Korean faction display name (markup stripped) -> faction id. */
  factionIdByName: Map<string, string>;
}

export interface ParseResult {
  conditions: Condition[];
  /** Sentences that looked like conditions but could not be parsed — useful for reporting. */
  unparsedCount: number;
}

function dedupeKey(c: Condition): string {
  switch (c.type) {
    case 'keywordSkillCount':
      return `k:${c.keyword}:${c.min}:${c.scope}`;
    case 'factionCount':
      return `f:${[...c.factions].sort().join('|')}:${c.min}:${c.scope}`;
    case 'fullResonance':
      return `r:${c.min}`;
    case 'unparsed':
      return `u:${c.text.ko}`;
  }
}

/** Extra thresholds mentioned after the first match, e.g. 3인 이상 ... 5인 이상이면. */
function tiersAfter(text: string, from: number, baseMin: number): { min: number; label: string }[] {
  const rest = text.slice(from);
  const tiers: { min: number; label: string }[] = [];
  TIER_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TIER_RE.exec(rest)) !== null) {
    const min = Number(m[1]);
    if (min > baseMin && !tiers.some((t) => t.min === min)) {
      tiers.push({ min, label: `${min}인 이상` });
    }
  }
  return tiers.sort((a, b) => a.min - b.min);
}

export function parseConditions(desc: Localized, ctx: ParseContext): ParseResult {
  const ko = stripMarkup(desc.ko);
  const en = stripMarkup(desc.en);
  const found: Condition[] = [];
  const seen = new Set<string>();
  let unparsedCount = 0;

  const push = (c: Condition): void => {
    const key = dedupeKey(c);
    if (seen.has(key)) return;
    seen.add(key);
    found.push(c);
  };

  KEYWORD_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = KEYWORD_RE.exec(ko)) !== null) {
    const token = m[1]!;
    if (!STATUS_SET.has(token)) continue;
    const keyword = token as StatusKeyword;
    const min = Number(m[2]);
    const clause = m[0];
    const tail = tailAfter(ko, m.index + clause.length);
    push({
      type: 'keywordSkillCount',
      keyword,
      min,
      scope: scopeFrom(clause, tail),
      includesSpecial: clause.includes(`특수 ${KEYWORD_KO[keyword]}`),
      tiers: tiersAfter(ko, m.index + clause.length, min),
      text: { ko: clause.trim(), en: en.trim().slice(0, 400) },
    });
  }

  FACTION_RE.lastIndex = 0;
  while ((m = FACTION_RE.exec(ko)) !== null) {
    const rawNames = [m[1], m[2]].filter((s): s is string => Boolean(s)).map((s) => s.trim());
    // The capture can swallow leading words ("턴 시작 시 중지"); try progressively shorter suffixes.
    const ids: string[] = [];
    for (const raw of rawNames) {
      const id = resolveFaction(raw, ctx.factionIdByName);
      if (id) ids.push(id);
    }
    if (ids.length !== rawNames.length) {
      unparsedCount += 1;
      push({ type: 'unparsed', text: { ko: m[0].trim(), en: en.trim().slice(0, 400) } });
      continue;
    }
    const min = Number(m[3]);
    const clause = m[0];
    const tail = tailAfter(ko, m.index + clause.length);
    push({
      type: 'factionCount',
      factions: ids,
      min,
      scope: scopeFrom(ko.slice(Math.max(0, m.index - 30), m.index + clause.length), tail),
      tiers: tiersAfter(ko, m.index + clause.length, min),
      text: { ko: clause.trim(), en: en.trim().slice(0, 400) },
    });
  }

  RESONANCE_RE.lastIndex = 0;
  while ((m = RESONANCE_RE.exec(ko)) !== null) {
    push({
      type: 'fullResonance',
      min: Number(m[1]),
      text: { ko: m[0].trim(), en: en.trim().slice(0, 400) },
    });
  }

  // A threshold sentence with no condition at all means the parser missed a shape.
  if (found.length === 0 && THRESHOLD_HINT_RE.test(ko) && /인격|소속/.test(ko)) {
    const line = ko.split('\n').find((l) => THRESHOLD_HINT_RE.test(l) && /인격|소속/.test(l));
    if (line) {
      unparsedCount += 1;
      push({ type: 'unparsed', text: { ko: line.trim(), en: en.trim().slice(0, 400) } });
    }
  }

  return { conditions: found, unparsedCount };
}

/**
 * Resolve a Korean faction name that may have leading words attached by the greedy capture.
 * "턴 시작 시 중지" -> 중지. Longest suffix wins so "남부 세븐 협회" beats "협회".
 */
export function resolveFaction(raw: string, byName: Map<string, string>): string | null {
  const cleaned = raw.replace(/\s+/g, ' ').trim();
  if (byName.has(cleaned)) return byName.get(cleaned)!;

  const words = cleaned.split(' ');
  for (let start = 0; start < words.length; start += 1) {
    const candidate = words.slice(start).join(' ');
    if (byName.has(candidate)) return byName.get(candidate)!;
  }
  // Some clauses write the name without the space the localization uses (새벽사무소).
  const squashed = cleaned.replace(/\s/g, '');
  for (const [name, id] of byName) {
    if (name.replace(/\s/g, '') === squashed) return id;
  }
  return null;
}
