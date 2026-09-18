import type { Condition, IdentityKeywordId, Rules, StatusKeyword } from './schema.ts';
import { STATUS_KEYWORDS } from './schema.ts';
import type { ConditionReport, DeckStats, GameIndexes } from './types.ts';

type Scope = 'deployed' | 'formation' | 'reserve';

/**
 * Count what the deck brings, per counting scope.
 *
 * Conditional gifts measure three different things: the deployed party (출격 인원), the whole
 * 12-slot formation (대기 인원 포함), and sometimes the reserves alone (대기 인원에).
 *
 * `deployedOverride` names who fights, in deck order, capped at `deployment.max`; an empty list
 * means nobody is deployed. Without it the first `deployment.default` identities fight.
 */
export function analyseDeck(
  deck: number[],
  indexes: GameIndexes,
  deployment: Rules['deployment'],
  deployedOverride?: number[],
): DeckStats {
  const known = deck.filter((id) => indexes.identityById.has(id));
  const unknownIdentities = deck.filter((id) => !indexes.identityById.has(id));

  const deployed = deployedOverride
    ? known.filter((id) => deployedOverride.includes(id)).slice(0, deployment.max)
    : known.slice(0, deployment.default);
  const deployedSet = new Set(deployed);
  const reserve = known.filter((id) => !deployedSet.has(id));

  const groups: Record<Scope, number[]> = { deployed, formation: known, reserve };

  const keywordCounts = {} as DeckStats['keywordCounts'];
  const baseKeywordCounts = {} as DeckStats['baseKeywordCounts'];
  const factionCounts = {} as DeckStats['factionCounts'];
  const identitiesWithoutKeywords: number[] = [];

  for (const scope of ['deployed', 'formation', 'reserve'] as Scope[]) {
    const keywords: Partial<Record<IdentityKeywordId, number>> = {};
    const baseKeywords: Partial<Record<IdentityKeywordId, number>> = {};
    const factions: Record<string, number> = {};
    for (const id of groups[scope]) {
      const identity = indexes.identityById.get(id);
      if (!identity) continue;
      for (const [keyword, info] of Object.entries(identity.keywords) as [
        IdentityKeywordId,
        { skills: number },
      ][]) {
        // One identity counts once per keyword, however many of its skills inflict it.
        keywords[keyword] = (keywords[keyword] ?? 0) + 1;
        // A 특수-only inflictor (생체 재료, 못 …) is not a base inflictor.
        if (info.skills > 0) baseKeywords[keyword] = (baseKeywords[keyword] ?? 0) + 1;
      }
      for (const faction of identity.factions) factions[faction] = (factions[faction] ?? 0) + 1;
    }
    keywordCounts[scope] = keywords;
    baseKeywordCounts[scope] = baseKeywords;
    factionCounts[scope] = factions;
  }

  for (const id of known) {
    if (indexes.identityById.get(id)?.keywordSource === 'none') identitiesWithoutKeywords.push(id);
  }

  return { keywordCounts, baseKeywordCounts, factionCounts, deployed, reserve, unknownIdentities, identitiesWithoutKeywords };
}

/**
 * The dominant status keyword of a deck, used when the caller asks for an automatic choice.
 *
 * Only status keywords qualify: `rules.startGift.poolsByKeyword` has a pool for each of those and
 * for the attack types, but none for 탄환, so picking 탄환 would hand the player no starting gift.
 */
export function dominantKeyword(stats: DeckStats): StatusKeyword | null {
  const counts = stats.keywordCounts.formation;
  const statusOnly = new Set<string>(STATUS_KEYWORDS);
  const entries = (Object.entries(counts) as [StatusKeyword, number][]).filter(
    ([keyword, n]) => n > 0 && statusOnly.has(keyword),
  );
  if (entries.length === 0) return null;
  // Sort by count, then by keyword name so the answer is stable for tied decks.
  entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return entries[0]![0];
}

function conditionCount(condition: Condition, stats: DeckStats): number | null {
  switch (condition.type) {
    case 'keywordSkillCount': {
      // 「또는 특수 X」 counts the 특수 variants too; a plain 「[X]를 부여하는」 does not.
      const counts = condition.includesSpecial ? stats.keywordCounts : stats.baseKeywordCounts;
      return counts[condition.scope][condition.keyword] ?? 0;
    }
    case 'factionCount': {
      const counts = stats.factionCounts[condition.scope];
      // "A 또는 B" counts an identity once even if it belongs to both.
      return condition.factions.reduce((sum, faction) => sum + (counts[faction] ?? 0), 0);
    }
    default:
      return null;
  }
}

/**
 * A terse summary for the UI. Keyword and faction ids stay as ids: the caller has `enums.json`
 * and localizes them, so the planner never hard-codes display names.
 */
function describe(condition: Condition, have: number | null): { ko: string; en: string } {
  switch (condition.type) {
    case 'keywordSkillCount':
      return {
        ko: `${condition.keyword} 부여 스킬 보유 인격 ${have ?? '?'}/${condition.min} (${scopeKo(condition.scope)})`,
        en: `${have ?? '?'}/${condition.min} identities inflict ${condition.keyword} (${condition.scope})`,
      };
    case 'factionCount':
      return {
        ko: `${condition.factions.join(' 또는 ')} 소속 ${have ?? '?'}/${condition.min}인 (${scopeKo(condition.scope)})`,
        en: `${have ?? '?'}/${condition.min} identities from ${condition.factions.join(' or ')} (${condition.scope})`,
      };
    case 'fullResonance':
      return {
        ko: `완전 공명 ${condition.min} 이상 필요 (전투 중 판정이라 덱만으로는 알 수 없음)`,
        en: `needs ${condition.min}+ full resonance, which depends on in-battle play`,
      };
    case 'unparsed':
      return { ko: condition.text.ko, en: condition.text.en };
  }
}

function subjectOf(condition: Condition): ConditionReport['subject'] {
  switch (condition.type) {
    case 'keywordSkillCount':
      return { kind: 'keyword', ids: [condition.keyword], scope: condition.scope };
    case 'factionCount':
      return { kind: 'faction', ids: [...condition.factions], scope: condition.scope };
    case 'fullResonance':
      return { kind: 'resonance', ids: [], scope: null };
    case 'unparsed':
      return { kind: 'text', ids: [], scope: null };
  }
}

function scopeKo(scope: Scope): string {
  switch (scope) {
    case 'deployed':
      return '출격 인원';
    case 'formation':
      return '편성 인원';
    case 'reserve':
      return '대기 인원';
  }
}

/**
 * Report whether the deck activates each wanted gift's conditions.
 *
 * An unmet condition never blocks routing: the player may still want the gift, and some
 * conditions (full resonance) cannot be judged from a deck list at all.
 */
export function evaluateConditions(
  giftIds: number[],
  stats: DeckStats,
  indexes: GameIndexes,
): ConditionReport[] {
  const reports: ConditionReport[] = [];
  for (const giftId of [...giftIds].sort((a, b) => a - b)) {
    const gift = indexes.giftById.get(giftId);
    if (!gift) continue;
    for (const condition of gift.conditions) {
      const have = conditionCount(condition, stats);
      const need = 'min' in condition ? condition.min : null;
      const satisfied = have !== null && need !== null ? have >= need : false;
      const reachedTiers =
        have !== null && 'tiers' in condition
          ? condition.tiers.filter((tier) => have >= tier.min).map((tier) => tier.min)
          : [];
      reports.push({
        giftId,
        satisfied,
        reachedTiers,
        have,
        need,
        subject: subjectOf(condition),
        detail: describe(condition, have),
      });
    }
  }
  return reports;
}
