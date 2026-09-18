/**
 * Group and order gifts by whether the current deck activates them.
 *
 * The planner reports one `ConditionReport` per condition; a gift is "active" when every one is
 * satisfied and "other" otherwise or when it has no condition at all. Full-resonance and unparsed
 * conditions cannot be judged from a deck, so their gifts stay in "other" and read as 판정 불가.
 *
 * Inside a group, gifts bound to a specific pack come first: a 테마팩 한정 gift (or an EXTREME
 * clear reward) is what actually decides the route, while a 범용 gift may drop anywhere.
 */
import type { Gift } from '../../core/schema.ts';
import type { ConditionReport } from '../../core/types.ts';

export type GiftGroup = 'active' | 'other';

export interface GiftEntry {
  gift: Gift;
  reports: ConditionReport[];
  group: GiftGroup;
  /** Progress of the worst condition, 0-1; null when the gift has no judgeable condition. */
  ratio: number | null;
  /** The condition still short of its threshold, for the "+n" hint. */
  lack: ConditionReport | null;
  /** True when some condition cannot be judged from a deck list. */
  unjudgeable: boolean;
}

export function classifyGift(gift: Gift, reports: ConditionReport[]): GiftEntry {
  if (reports.length === 0) return { gift, reports, group: 'other', ratio: null, lack: null, unjudgeable: false };
  const unjudgeable = reports.some((r) => r.have === null || r.need === null);
  const judgeable = reports.filter((r) => r.have !== null && r.need !== null && r.need > 0);
  const ratio =
    judgeable.length > 0 ? Math.min(...judgeable.map((r) => Math.min(1, r.have! / r.need!))) : null;
  const lack = judgeable.filter((r) => !r.satisfied).sort((a, b) => b.have! / b.need! - a.have! / a.need!)[0] ?? null;
  const group: GiftGroup = !unjudgeable && reports.every((r) => r.satisfied) ? 'active' : 'other';
  return { gift, reports, group, ratio, lack, unjudgeable };
}

/** A gift only one pack (or one EXTREME boss) hands out, as opposed to one that may drop anywhere. */
export function isPackBound(gift: Gift): boolean {
  return gift.acquisition.kind === 'packLimited' || gift.acquisition.kind === 'clearReward';
}

/** Stable order inside a group: pack-bound first, then closer first, then by id. */
export function compareEntries(a: GiftEntry, b: GiftEntry): number {
  return (
    Number(isPackBound(b.gift)) - Number(isPackBound(a.gift)) ||
    (b.ratio ?? -1) - (a.ratio ?? -1) ||
    a.gift.id - b.gift.id
  );
}

export function prioritiseGifts(
  gifts: Gift[],
  conditionByGift: Map<number, ConditionReport[]>,
): Record<GiftGroup, GiftEntry[]> {
  const groups: Record<GiftGroup, GiftEntry[]> = { active: [], other: [] };
  for (const gift of gifts) {
    const entry = classifyGift(gift, conditionByGift.get(gift.id) ?? []);
    groups[entry.group].push(entry);
  }
  for (const list of Object.values(groups)) list.sort(compareEntries);
  return groups;
}
