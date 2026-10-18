/**
 * The planner's options as `planRoute` reads them, and the run state they imply. Everything that
 * re-derives what the plan routed for (`wantedRoots`, the conflict analysis) goes through here, so
 * it sees the same run the plan saw.
 */
import type { GameData } from './schema.ts';
import type { GameIndexes, PlanOptions, PlanWarning } from './types.ts';
import type { RunState } from './requirements.ts';
import { modeForFloor } from './search.ts';
import { observable } from './starting.ts';
import { msg } from './messages.ts';

/** The observation slots this plan may spend: the rules' count, less those the player turned off. */
export function observationBudget(options: Pick<PlanOptions, 'observationSlots'>, data: GameData): number {
  const max = data.rules.giftObservation.max;
  const slots = options.observationSlots;
  return typeof slots === 'number' && Number.isFinite(slots)
    ? Math.min(max, Math.max(0, Math.round(slots)))
    : max;
}

/**
 * Planning into 평행중첩 requires every floor before it cleared on Hard.
 * Rather than produce an impossible plan, the options are corrected and the change is reported.
 */
export function normaliseOptions(
  options: PlanOptions,
  data: GameData,
  indexes: GameIndexes,
  deck: number[],
): { options: PlanOptions; warnings: PlanWarning[]; droppedObservations: number[] } {
  const warnings: PlanWarning[] = [];
  let next = { ...options };

  // Pinned observations: known, observable, unique, and within the slot limit. The ones dropped
  // here join the pins the plan itself cannot use in a single warning (see planRoute).
  const observedGifts = [...new Set(next.observedGifts ?? [])].filter((id) => {
    const gift = indexes.giftById.get(id);
    return gift !== undefined && observable(gift, data.rules);
  });
  const kept = observedGifts.slice(0, observationBudget(next, data));
  const droppedObservations = (next.observedGifts ?? []).filter((id) => !kept.includes(id));
  next = { ...next, observedGifts: kept };

  const maxFloor = Math.max(
    ...data.rules.floors.normal,
    ...data.rules.floors.parallel,
    ...data.rules.floors.extreme,
  );
  const lastFloor = Math.min(maxFloor, Math.max(1, Math.round(next.lastFloor)));
  if (lastFloor !== next.lastFloor) next = { ...next, lastFloor };

  // 평행중첩 needs every floor before it cleared on Hard. Which floor opens that band is the
  // season's (`rules.floors.parallel`; a season without the band never forces Hard), and it has to
  // be settled before the pins are checked: a Hard-only pack pinned on floor 4 is legal on this
  // plan exactly because the plan is Hard from floor 1. Checking pins first dropped such a pin
  // with a warning and then placed the same pack on the same floor as a recommendation.
  const parallelFrom = Math.min(...data.rules.floors.parallel);
  if (
    lastFloor >= parallelFrom &&
    data.rules.difficulty.parallelRequiresAllHard &&
    next.hardFromFloor !== 1
  ) {
    next = { ...next, hardFromFloor: 1 };
    warnings.push({
      code: 'parallel-requires-hard',
      detail: msg('warn.parallelRequiresHard', { parallelFrom, lastHard: parallelFrom - 1 }),
    });
  }

  // Run progress: the floor about to be entered stays within the plan — or one past it, which is a
  // finished run (every floor played, nothing left to plan) — and a gift is either in hand or
  // missed, never both (in hand wins). Clamping a finished run to the last floor used to plan that
  // floor again: a pack recommended after the run was over, and its gifts counted as collected.
  const currentFloor = Number.isFinite(next.currentFloor)
    ? Math.min(lastFloor + 1, Math.max(1, Math.round(next.currentFloor as number)))
    : 1;
  const knownGift = (id: unknown): id is number => typeof id === 'number' && indexes.giftById.has(id);
  const ownedGifts = [...new Set((next.ownedGifts ?? []).filter(knownGift))];
  const unobtainableGifts = [...new Set((next.unobtainableGifts ?? []).filter(knownGift))].filter(
    (id) => !ownedGifts.includes(id),
  );
  next = { ...next, currentFloor, ownedGifts, unobtainableGifts };

  if (next.deployed) {
    const inDeck = new Set(deck);
    const deployed = [...new Set(next.deployed)]
      .filter((id) => inDeck.has(id))
      .slice(0, data.rules.deployment.max);
    next = { ...next, deployed };
  }

  // Pack choices: known packs only, no contradiction between a ban and a preference, and an entry
  // only on a played floor (M118: the route is the goals' to decide — a pack is never forced onto a
  // floor still ahead) that actually offers the pack in that floor's mode.
  const known = (id: unknown): id is number => typeof id === 'number' && indexes.packById.has(id);
  const bannedPacks = [...new Set((next.bannedPacks ?? []).filter(known))];
  const bannedSet = new Set(bannedPacks);
  const preferredPacks = [...new Set((next.preferredPacks ?? []).filter(known))].filter(
    (id) => !bannedSet.has(id),
  );
  const pinnedPacks: Record<number, number> = {};
  const dropped: number[] = [];
  for (const [floorText, packId] of Object.entries(next.pinnedPacks ?? {})) {
    const floor = Number(floorText);
    const offered =
      Number.isInteger(floor) && floor >= 1 && floor <= lastFloor && floor < currentFloor
        ? (indexes.packsByFloor[modeForFloor(floor, next, indexes)].get(floor) ?? [])
        : [];
    if (known(packId) && offered.includes(packId) && !bannedSet.has(packId)) pinnedPacks[floor] = packId;
    else if (typeof packId === 'number') dropped.push(packId);
  }
  const preferredDropped = (next.preferredPacks ?? []).filter((id) => !preferredPacks.includes(id));
  const bannedDropped = (next.bannedPacks ?? []).filter((id) => !bannedPacks.includes(id));
  const droppedAll = [...new Set([...dropped, ...preferredDropped, ...bannedDropped])];
  if (droppedAll.length > 0) {
    warnings.push({
      code: 'pack-option-dropped',
      packIds: droppedAll,
      detail: msg('warn.packOptionDropped'),
    });
  }
  next = { ...next, bannedPacks, preferredPacks, pinnedPacks };

  return { options: next, warnings, droppedObservations };
}

/**
 * What the run has settled, from normalised options: the gifts in hand, the ones missed (in hand
 * wins), and the packs taken on played floors — the only pack entries the options keep (M118).
 */
export function runStateOf(options: PlanOptions): RunState {
  return {
    owned: new Set(options.ownedGifts ?? []),
    failed: new Set(options.unobtainableGifts ?? []),
    visited: new Set(Object.values(options.pinnedPacks)),
  };
}
