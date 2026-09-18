import type { ConditionReport } from '../../core/types.ts';

/** How a gift's activation condition reads against the deck, for the icon border. */
export type Judgement = 'met' | 'unmet' | 'unknown';

/** Null when the gift has no condition; unknown when one cannot be judged from the deck. */
export function judgementOf(reports: ConditionReport[] | undefined): Judgement | null {
  if (!reports || reports.length === 0) return null;
  if (reports.some((r) => r.have === null || r.need === null)) return reports.every((r) => r.satisfied) ? 'met' : 'unknown';
  return reports.every((r) => r.satisfied) ? 'met' : 'unmet';
}

/** Group condition reports by gift so a plan's list can feed icons directly. */
export function judgementsByGift(reports: ConditionReport[]): Map<number, Judgement | null> {
  const grouped = new Map<number, ConditionReport[]>();
  for (const report of reports) grouped.set(report.giftId, [...(grouped.get(report.giftId) ?? []), report]);
  return new Map([...grouped].map(([giftId, list]) => [giftId, judgementOf(list)]));
}
