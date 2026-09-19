import type { ConditionReport } from '../../core/types.ts';

/** How a gift's activation condition reads against the deck, for the icon border. */
export type Judgement = 'met' | 'unmet' | 'unknown';

/** Null when the gift has no condition; unknown when one cannot be judged from the deck. */
export function judgementOf(reports: ConditionReport[] | undefined): Judgement | null {
  if (!reports || reports.length === 0) return null;
  // A count with no threshold says how many, not whether — it is shown and draws no ring.
  const gates = reports.filter((r) => r.gate);
  if (gates.length === 0) return null;
  if (gates.some((r) => r.have === null || r.need === null)) return gates.every((r) => r.satisfied) ? 'met' : 'unknown';
  return gates.every((r) => r.satisfied) ? 'met' : 'unmet';
}

/** Group condition reports by gift so a plan's list can feed icons directly. */
export function judgementsByGift(reports: ConditionReport[]): Map<number, Judgement | null> {
  const grouped = new Map<number, ConditionReport[]>();
  for (const report of reports) grouped.set(report.giftId, [...(grouped.get(report.giftId) ?? []), report]);
  return new Map([...grouped].map(([giftId, list]) => [giftId, judgementOf(list)]));
}
