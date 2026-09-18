/**
 * Pack conflicts, grouped the way the player decides them: a run of contested floors and the
 * packs that compete for them, each with the wanted gifts it would bring. The UI lets the player
 * keep or give up a whole pack from this; `planAlternatives` derives its candidate drops from the
 * same roots.
 */
import type { GameData } from './schema.ts';
import type { GameIndexes, PlanInput, RoutePlan } from './types.ts';
import { analyseDeck } from './deck.ts';
import { expandRequirements } from './requirements.ts';
import { modeForFloor } from './search.ts';

export interface ConflictCandidate {
  packId: number;
  /** Contested floors on which the pack is offered. */
  floors: number[];
  /** Wanted gifts (fusion results included, by way of their ingredients) this pack supplies. */
  gifts: number[];
  /** The floor the current plan gives the pack, or null when it was left out. */
  assignedAt: number | null;
  preferred: boolean;
}

export interface ConflictGroup {
  /** Contiguous contested floors. */
  floors: number[];
  candidates: ConflictCandidate[];
}

/**
 * Map a requirement back to the wanted gift(s) it serves: a wanted gift is its own root, a fusion
 * ingredient's root is the wanted result it feeds.
 */
export function wantedRoots(input: PlanInput, data: GameData, indexes: GameIndexes): (giftId: number) => number[] {
  const wantedIds = new Set(input.wanted.map((w) => w.giftId));
  const stats = analyseDeck(input.deck, indexes, data.rules.deployment, input.options.deployed);
  const requirements = expandRequirements(input.wanted, indexes, stats, data.rules.fusion.maxShopSlots).requirements;
  const roots = (giftId: number, seen = new Set<number>()): number[] => {
    if (wantedIds.has(giftId)) return [giftId];
    if (seen.has(giftId)) return [];
    seen.add(giftId);
    return requirements.filter((r) => r.giftId === giftId && r.neededFor !== null).flatMap((r) => roots(r.neededFor!, seen));
  };
  return roots;
}

export function conflictGroups(plan: RoutePlan, input: PlanInput, data: GameData, indexes: GameIndexes): ConflictGroup[] {
  const conflicts = plan.unresolved.filter((u) => u.reason === 'pack-conflict').map((u) => u.giftId);
  if (conflicts.length === 0) return [];
  const options = input.options;
  const banned = new Set(options.bannedPacks);
  const preferred = new Set(options.preferredPacks);
  const roots = wantedRoots(input, data, indexes);
  const offeredOn = (floor: number): number[] => indexes.packsByFloor[modeForFloor(floor, options, indexes)].get(floor) ?? [];
  const wantedIds = new Set(input.wanted.map((w) => w.giftId));

  // Requirements the wanted set actually routes for, so a pack's gift list stays to the point.
  const stats = analyseDeck(input.deck, indexes, data.rules.deployment, options.deployed);
  const routed = expandRequirements(input.wanted, indexes, stats, data.rules.fusion.maxShopSlots).requirements.map((r) => r.giftId);
  const giftsOf = (packId: number): number[] => {
    const out = new Set<number>();
    for (const giftId of routed) {
      if (indexes.freelyAvailableGifts.has(giftId)) continue;
      if (!(indexes.packsByGift.get(giftId) ?? []).includes(packId)) continue;
      for (const root of roots(giftId)) if (wantedIds.has(root)) out.add(root);
    }
    return [...out].sort((a, b) => a - b);
  };

  // Floors a conflicting gift's pack could have taken, honouring pins and bans.
  const contested = new Set<number>();
  for (const giftId of conflicts) {
    const packs = (indexes.packsByGift.get(giftId) ?? []).filter((id) => !banned.has(id));
    for (const floor of plan.floors) {
      const pinned = options.pinnedPacks[floor.floor];
      if (packs.some((id) => offeredOn(floor.floor).includes(id) && (pinned === undefined || pinned === id))) contested.add(floor.floor);
    }
  }

  // Group contiguous contested floors.
  const sorted = [...contested].sort((a, b) => a - b);
  const groups: number[][] = [];
  for (const floor of sorted) {
    const last = groups[groups.length - 1];
    if (last && last[last.length - 1] === floor - 1) last.push(floor);
    else groups.push([floor]);
  }

  return groups.map((floors) => {
    const candidateIds = new Set<number>();
    for (const giftId of conflicts) {
      for (const packId of indexes.packsByGift.get(giftId) ?? []) {
        if (!banned.has(packId) && floors.some((f) => offeredOn(f).includes(packId))) candidateIds.add(packId);
      }
    }
    for (const floor of plan.floors) {
      if (floors.includes(floor.floor) && floor.packId !== null && floor.reason !== 'free') candidateIds.add(floor.packId);
    }
    const candidates: ConflictCandidate[] = [...candidateIds]
      .map((packId) => {
        const assigned = plan.floors.find((f) => f.packId === packId && f.reason !== 'free');
        return {
          packId,
          floors: floors.filter((f) => offeredOn(f).includes(packId)),
          gifts: giftsOf(packId),
          assignedAt: assigned ? assigned.floor : null,
          preferred: preferred.has(packId),
        };
      })
      .sort((a, b) => (a.assignedAt ?? 99) - (b.assignedAt ?? 99) || a.packId - b.packId);
    return { floors, candidates };
  });
}
