/**
 * Alternative routes: when the wanted gifts cannot all fit in one run, plan again with one of the
 * conflicting gifts left out, so the user can pick which gift to give up.
 *
 * Single drops that clear every conflict come first. When none does, the gifts the main plan
 * itself left out are tried together as one bundle: the search minimises missed requirements, so
 * dropping exactly those is the smallest set it knows to fit (see `minDrops`).
 */
import type { GameData } from './schema.ts';
import type { GameIndexes, PlanInput, RoutePlan } from './types.ts';
import { wantedRoots } from './conflicts.ts';
import { planRoute } from './index.ts';
import { modeForFloor } from './search.ts';

export interface RouteVariant {
  /** Wanted gift ids this variant leaves out: one, or the bundle when no single drop clears. */
  dropped: number[];
  plan: RoutePlan;
}

export interface AlternativeOptions {
  /** Variants returned, best first. */
  max?: number;
  /** Candidate drops tried, which bounds the number of extra `planRoute` calls. */
  maxRuns?: number;
}

export function planAlternatives(
  input: PlanInput,
  data: GameData,
  indexes: GameIndexes,
  main?: RoutePlan,
  opts: AlternativeOptions = {},
): RouteVariant[] {
  const max = opts.max ?? 4;
  const maxRuns = opts.maxRuns ?? 6;
  const base = main ?? planRoute(input, data, indexes);

  const conflicts = base.unresolved.filter((u) => u.reason === 'pack-conflict').map((u) => u.giftId);
  if (conflicts.length === 0) return [];

  const wantedIds = new Set(input.wanted.map((w) => w.giftId));
  const options =
    base.floors.length > 0
      ? { ...input.options, lastFloor: base.floors[base.floors.length - 1]!.floor }
      : input.options;

  // A fusion ingredient that lost its floor drops the wanted result it feeds, not itself.
  const roots = wantedRoots({ ...input, options }, data, indexes);

  // Floors a conflicting gift's pack could have taken, honouring pins and bans.
  const banned = new Set(options.bannedPacks);
  const contested = new Set<number>();
  for (const giftId of conflicts) {
    const packs = (indexes.packsByGift.get(giftId) ?? []).filter((id) => !banned.has(id));
    for (const floor of base.floors) {
      const offered =
        indexes.packsByFloor[modeForFloor(floor.floor, options, indexes)].get(floor.floor) ?? [];
      const pinned = options.pinnedPacks[floor.floor];
      if (packs.some((id) => offered.includes(id) && (pinned === undefined || pinned === id)))
        contested.add(floor.floor);
    }
  }
  const occupants = base.floors
    .filter((floor) => floor.reason === 'required' && contested.has(floor.floor))
    .flatMap((floor) => floor.pickups.flatMap((p) => roots(p.giftId)));

  // A gift the user marked as required is never the one to give up — as long as the input tells
  // required gifts apart from the rest. When everything is required (the CLI default) there is no
  // preference to honour and every side of the conflict is a candidate.
  const tiered = input.wanted.some((w) => !w.required);
  const required = new Set(tiered ? input.wanted.filter((w) => w.required).map((w) => w.giftId) : []);
  // Sides of the conflict first, then the gifts holding the contested floors: with one conflict
  // the former always clear it, so the cap never cuts off a drop that would.
  const conflictRoots = [...new Set(conflicts.flatMap((id) => roots(id)))]
    .filter((id) => !required.has(id))
    .sort((a, b) => a - b);
  const others = [...new Set(occupants)]
    .filter((id) => !required.has(id) && !conflictRoots.includes(id))
    .sort((a, b) => a - b);
  const candidates = [...conflictRoots, ...others].slice(0, maxRuns);
  const conflictsLeft = (plan: RoutePlan): number =>
    new Set(plan.unresolved.filter((u) => u.reason === 'pack-conflict').flatMap((u) => roots(u.giftId))).size;

  const covered = (plan: RoutePlan, wanted: number[]): string => {
    const unresolved = new Set(plan.unresolved.map((u) => u.giftId));
    return wanted
      .filter((id) => !unresolved.has(id))
      .sort((a, b) => a - b)
      .join(',');
  };
  const unresolvedKey = (plan: RoutePlan): string =>
    plan.unresolved.map((u) => `${u.giftId}:${u.reason}`).join(',');
  const mainCovered = covered(base, [...wantedIds]);
  const mainUnresolved = unresolvedKey(base);

  const variants: RouteVariant[] = [];
  const seenCovered = new Set<string>();
  for (const giftId of candidates) {
    const wanted = input.wanted.filter((w) => w.giftId !== giftId);
    const plan = planRoute({ ...input, wanted, options }, data, indexes);
    const key = covered(
      plan,
      wanted.map((w) => w.giftId),
    );
    if (key === mainCovered && unresolvedKey(plan) === mainUnresolved) continue;
    if (seenCovered.has(key)) continue;
    seenCovered.add(key);
    variants.push({ dropped: [giftId], plan });
  }

  const sorted = variants
    .map((variant) => ({ variant, left: conflictsLeft(variant.plan) }))
    .sort(
      (a, b) =>
        a.left - b.left ||
        b.variant.plan.stats.coveredWanted - a.variant.plan.stats.coveredWanted ||
        a.variant.plan.stats.requiredPacks - b.variant.plan.stats.requiredPacks ||
        a.variant.dropped[0]! - b.variant.dropped[0]!,
    )
    .map((entry) => entry.variant)
    .slice(0, max);

  // No single drop clears it: offer the main plan's own losses together, if that really fits.
  if (conflictRoots.length >= 2 && !sorted.some((v) => conflictsLeft(v.plan) === 0)) {
    const dropped = new Set(conflictRoots);
    const wanted = input.wanted.filter((w) => !dropped.has(w.giftId));
    const plan = planRoute({ ...input, wanted, options }, data, indexes);
    if (conflictsLeft(plan) === 0) return [{ dropped: conflictRoots, plan }, ...sorted].slice(0, max);
  }
  return sorted;
}

/**
 * How many goals have to go for the rest to fit, as far as the alternatives know: the size of the
 * first variant when it clears every conflict, else `null` (none found within the run budget).
 */
export function minDrops(variants: readonly RouteVariant[]): number | null {
  const first = variants[0];
  if (!first || first.plan.unresolved.some((u) => u.reason === 'pack-conflict')) return null;
  return first.dropped.length;
}
