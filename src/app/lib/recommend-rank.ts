/**
 * 추천 기프트의 순위 (M131): how the recommended gifts are ordered inside a section.
 *
 * The ranking lives here and only here on purpose (owner's request): `lib/recommend.ts` decides
 * *which* gifts are recommended and in which section, this file decides *in what order*. To change
 * the criterion later, change `recommendationScore` (and, if need be, `compareRecommended`) — no
 * caller computes or compares a score itself.
 *
 * The criterion today: **how many identities the gift's effect applies to** — more first.
 *
 * - The identities that meet a requirement of the gift's open gates or of an effect the deck can use
 *   (`RequirementReport.matches`), counted once however many effects and requirements name them.
 *   They are mostly the deployed; a 「…가 편성되어 있으면」 requirement asks the formation, and its
 *   identity counts too.
 * - A closed gate scores 0 (nothing fires).
 * - A gift whose usable effects ask nothing of any identity — 「조건 없이 발동」 (`free`) and the
 *   E.G.O-only ones (`ego`, whose condition names no identity) — applies to whoever fights, so it
 *   scores the number deployed. Sections never mix, so this only has to be consistent within one.
 *
 * Ties keep the tab's usual order (`compareEntries`: pack-bound first, closer first, id). The score is
 * never shown; tiles carry it as `data-score` and `npm run recommend` prints it, for debugging.
 * Pure.
 */
import type { GiftEffectsReport } from '../../core/index.ts';
import { ATTACK_TYPES, type Keyword } from '../../core/schema.ts';
import { compareEntries, type GiftEntry } from './gift-priority.ts';

/** What a score may depend on beyond the gift's own report. */
export interface RankContext {
  /** The deployed identities — whom an effect that asks nothing applies to. */
  deployed: readonly number[];
}

export function recommendationScore(report: GiftEffectsReport, context: RankContext): number {
  if (!report.gateOpen) return 0;
  const usable = report.effects.filter((effect) => effect.usable);
  if (usable.length === 0) return 0;
  const met = [...report.gates, ...usable.flatMap((effect) => effect.requirements)];
  const ids = new Set(met.flatMap((requirement) => requirement.matches.map((match) => match.id)));
  // Nothing met names an identity (unconditional or E.G.O-only): it applies to the party.
  return ids.size > 0 ? ids.size : context.deployed.length;
}

export type ScoreOf = (giftId: number) => number;

/** Higher score first; a tie falls back to `fallback` (the tab's usual order by default). */
export function compareRecommended(
  a: GiftEntry,
  b: GiftEntry,
  scoreOf: ScoreOf,
  fallback: (a: GiftEntry, b: GiftEntry) => number = compareEntries,
): number {
  return scoreOf(b.gift.id) - scoreOf(a.gift.id) || fallback(a, b);
}

/** 「팩 전용 먼저」: pack-bound first, then by score, then the usual order. */
export function comparePackFirst(a: GiftEntry, b: GiftEntry, scoreOf: ScoreOf): number {
  return Number(b.packBound) - Number(a.packBound) || compareRecommended(a, b, scoreOf);
}

/**
 * The order of the keyword groups under 「키워드별」 (owner's call, M133): the deck's own keywords first,
 * most deployed identities first — a 충전·진동 deck (5 each) shows 진동·충전, then the 화상·출혈 it
 * also has — then 키워드 없음, then the status keywords it lacks, then the attack types. A tie keeps
 * the enums order. `deployedCounts` is `DeckStats.keywordCounts.deployed`.
 */
export function keywordGroupOrder(
  keywords: readonly Keyword[],
  deployedCounts: Partial<Record<string, number>>,
): Keyword[] {
  const isAttack = (keyword: Keyword): boolean => (ATTACK_TYPES as readonly string[]).includes(keyword);
  const count = (keyword: Keyword): number =>
    keyword === 'None' || isAttack(keyword) ? 0 : (deployedCounts[keyword] ?? 0);
  // 0 the deck's keywords · 1 키워드 없음 · 2 the status keywords it lacks · 3 attack types.
  const tier = (keyword: Keyword): number =>
    isAttack(keyword) ? 3 : keyword === 'None' ? 1 : count(keyword) > 0 ? 0 : 2;
  return keywords
    .map((keyword, index) => ({ keyword, index }))
    .sort(
      (a, b) => tier(a.keyword) - tier(b.keyword) || count(b.keyword) - count(a.keyword) || a.index - b.index,
    )
    .map(({ keyword }) => keyword);
}

/**
 * A section's entries in the chosen order: 「키워드별」 (`keyword`) is the score order — the keyword
 * groups keep it inside each group — and 「팩 전용 먼저」 (`pack`) puts pack-bound first.
 */
export function orderRecommended(
  entries: readonly GiftEntry[],
  sort: 'keyword' | 'pack',
  scoreOf: ScoreOf,
): GiftEntry[] {
  const compare =
    sort === 'pack'
      ? (a: GiftEntry, b: GiftEntry) => comparePackFirst(a, b, scoreOf)
      : (a: GiftEntry, b: GiftEntry) => compareRecommended(a, b, scoreOf);
  return [...entries].sort(compare);
}
