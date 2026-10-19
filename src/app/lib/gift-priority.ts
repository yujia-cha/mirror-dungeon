/**
 * Group and order gifts by whether the current deck activates them.
 *
 * The planner reports one `ConditionReport` per condition; a gift is "active" when every one is
 * satisfied and "other" otherwise or when it has no condition at all. Full-resonance and unparsed
 * conditions cannot be judged from a deck, so their gifts stay in "other" and read as 판정 불가.
 *
 * Inside a group, gifts bound to a specific pack come first: a 테마팩 한정 gift (or an EXTREME
 * clear reward) is what actually decides the route, while a 범용 gift may drop anywhere. A fusion
 * result whose every recipe eats such a gift decides it too (M156, `isPackBound`).
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
  /** `isPackBound`, read once when the entry is made. */
  packBound: boolean;
}

export type GiftById = ReadonlyMap<number, Gift>;

export function classifyGift(gift: Gift, reports: ConditionReport[], giftById: GiftById): GiftEntry {
  const packBound = isPackBound(gift, giftById);
  // A count with no threshold is not a bar to clear, so it neither activates a gift nor holds one
  // back: a gift with only those sorts exactly like a gift with no condition at all.
  const gates = reports.filter((r) => r.gate);
  if (gates.length === 0)
    return { gift, reports, group: 'other', ratio: null, lack: null, unjudgeable: false, packBound };
  const unjudgeable = gates.some((r) => r.have === null || r.need === null);
  const judgeable = gates.filter((r) => r.have !== null && r.need !== null && r.need > 0);
  const ratio =
    judgeable.length > 0 ? Math.min(...judgeable.map((r) => Math.min(1, r.have! / r.need!))) : null;
  const lack =
    judgeable.filter((r) => !r.satisfied).sort((a, b) => b.have! / b.need! - a.have! / a.need!)[0] ?? null;
  const group: GiftGroup = !unjudgeable && gates.every((r) => r.satisfied) ? 'active' : 'other';
  return { gift, reports, group, ratio, lack, unjudgeable, packBound };
}

const packBoundMemo = new WeakMap<GiftById, Map<number, boolean>>();

/**
 * A gift that takes entering a particular pack, as opposed to one that may drop anywhere: what only
 * one pack (or one EXTREME boss) hands out — or, owner's call (M156), a fusion result every recipe of
 * which eats such a gift, an ingredient that is itself a fusion counting when it is pack-bound in
 * turn. A recipe of 범용 gifts alone can be made without any pack, so one such recipe makes the result
 * 범용. A general drop that also has a recipe stays general.
 */
export function isPackBound(gift: Gift, giftById: GiftById): boolean {
  let memo = packBoundMemo.get(giftById);
  if (!memo) packBoundMemo.set(giftById, (memo = new Map()));
  // The memo is by id, so it answers only for the season's own gift object, not for a copy.
  return giftById.get(gift.id) === gift ? packBoundOf(gift, giftById, memo) : judge(gift, giftById, memo);
}

function packBoundOf(gift: Gift, giftById: GiftById, memo: Map<number, boolean>): boolean {
  const known = memo.get(gift.id);
  if (known !== undefined) return known;
  memo.set(gift.id, false); // a recipe loop back to this gift proves nothing
  const bound = judge(gift, giftById, memo);
  memo.set(gift.id, bound);
  return bound;
}

function judge(gift: Gift, giftById: GiftById, memo: Map<number, boolean>): boolean {
  const { kind } = gift.acquisition;
  if (kind === 'packLimited' || kind === 'clearReward') return true;
  if (kind !== 'fusionOnly' || !gift.fusion || gift.fusion.recipes.length === 0) return false;
  return gift.fusion.recipes.every((recipe) =>
    recipe.ingredients.some((id) => {
      const ingredient = giftById.get(id);
      return ingredient !== undefined && packBoundOf(ingredient, giftById, memo);
    }),
  );
}

/** Stable order inside a group: pack-bound first, then closer first, then by id. */
export function compareEntries(a: GiftEntry, b: GiftEntry): number {
  return (
    Number(b.packBound) - Number(a.packBound) || (b.ratio ?? -1) - (a.ratio ?? -1) || a.gift.id - b.gift.id
  );
}

export function prioritiseGifts(
  gifts: Gift[],
  conditionByGift: ReadonlyMap<number, ConditionReport[]>,
  giftById: GiftById,
): Record<GiftGroup, GiftEntry[]> {
  const groups: Record<GiftGroup, GiftEntry[]> = { active: [], other: [] };
  for (const gift of gifts) {
    const entry = classifyGift(gift, conditionByGift.get(gift.id) ?? [], giftById);
    groups[entry.group].push(entry);
  }
  for (const list of Object.values(groups)) list.sort(compareEntries);
  return groups;
}
