/**
 * What a saved blob or a share link hands the store, made sound (M160 — moved out of `store.ts`
 * with the link codec, so the two can be read and tested without the store).
 *
 * Nothing here reads the store: `store.ts` imports this file, and a runtime cycle the other way
 * would hand a rehydrate half-initialised bindings.
 */
import type { PlanOptions } from '../../core/types.ts';
import type { UpgradeLevel } from '../../core/schema.ts';
import { defaultOptions } from '../../core/index.ts';
import { APP_START, type FusionGoalMap } from './plan-input.ts';

/**
 * The enhancement step chosen per gift (M130): `+` = 1, `++` = 2, absent = not enhanced. It is a
 * preference about the gift, not about the goal, so taking the gift out of the goals keeps it.
 */
export type GiftUpgradeMap = Record<number, UpgradeLevel>;

export const SINNER_COUNT = 12;
/** v1 links carried no deployed list: the first six fought. */
export const LEGACY_DEPLOYED = 6;

/** Identity ids are 1SSNN, so the sinner a slot belongs to is derivable from the id. */
export function sinnerOf(identityId: number): number {
  return Math.floor(identityId / 100) % 100;
}

/**
 * The most floors any Mirror Dungeon has opened.
 *
 * This is a bound for saved and shared state, not a season's floor count: how far *this* season
 * goes comes from `rules.floors` and reaches the store as `lastFloor` when the data loads. A season
 * that opens only 1~5 is shorter; none has ever been longer.
 */
export const MAX_FLOOR_EVER = 15;

/** The planner's defaults with the app's fixed floor range and start applied. */
export function appDefaultOptions(): PlanOptions {
  return { ...defaultOptions(), lastFloor: MAX_FLOOR_EVER, hardFromFloor: 1, ...APP_START };
}

/** How many ids one list of a link may carry: there are 12 identities and some 450 gifts. */
export const MAX_LINK_IDS = 512;

/**
 * An id list as a link or a saved blob may hand it over: positive integers, each once, at most
 * `max` of them, and nothing at all when it is no array.
 */
export function idList(raw: unknown, max = MAX_LINK_IDS): number[] {
  if (!Array.isArray(raw)) return [];
  const out = new Set<number>();
  for (const n of raw) {
    if (out.size >= max) break;
    if (typeof n === 'number' && Number.isInteger(n) && n > 0) out.add(n);
  }
  return [...out];
}

/**
 * Keep only the option keys the planner knows, so a link or a saved state from an older version
 * (which carried `giftObservationMax`, or a shorter floor range) cannot smuggle stale keys or a
 * partial run into the plan.
 */
export function sanitizeOptions(raw: unknown): PlanOptions {
  const defaults = appDefaultOptions();
  // Anything but an object has no options in it: a string or a number used to throw on `in` and
  // take the whole rehydrate (and, in the next `set`, the saved deck, goals and run) with it.
  const source = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<
    string,
    unknown
  >;
  const out = { ...defaults } as Record<string, unknown>;
  for (const key of Object.keys(defaults)) if (key in source) out[key] = source[key];
  out.observedGifts = idList(out.observedGifts);
  if (typeof out.assumeUnvisitedPacks !== 'boolean') out.assumeUnvisitedPacks = defaults.assumeUnvisitedPacks;
  // Slots turned off with 「관측하지 않기」 (M120). Core clamps the top to the rules' count.
  const slots = source.observationSlots;
  if (typeof slots === 'number' && Number.isInteger(slots) && slots >= 0) out.observationSlots = slots;
  else delete out.observationSlots;
  // No start keyword and no starting gift (M145): a saved state or a link from M134~M144 that
  // still carries a count or a keyword is planned the app's way, without a word.
  Object.assign(out, APP_START);
  // Whether the start is over is the run's (`run.startDone`), never a saved or shared option.
  delete out.startDecided;
  // Pack-level choices are the CLI's (`--ban`, `--prefer`); the app has no control for them, so a
  // saved state or an old link that still carries some would steer the route with nothing on
  // screen to say so or to undo it. They are dropped without a word.
  out.bannedPacks = [];
  out.preferredPacks = [];
  // No pinning a pack either (M118): the goals decide the route. The packs entered so far live in
  // the run (`run.visits`), never in saved or shared options; an old link's pins go quietly.
  out.pinnedPacks = {};
  out.lastFloor = MAX_FLOOR_EVER;
  out.hardFromFloor = 1;
  // Run progress lives in the `run` slice, never in shared or saved options — and who fights is the
  // store's `deployed` (`planInputFor` sets it), so a stored or linked copy is not carried along.
  out.currentFloor = 1;
  out.ownedGifts = [];
  out.unobtainableGifts = [];
  return out as unknown as PlanOptions;
}

/** Fusion goals only for wanted gifts, with the one non-default value. */
export function sanitizeFusionGoal(raw: unknown, wanted: readonly number[]): FusionGoalMap {
  const out: FusionGoalMap = {};
  if (!raw || typeof raw !== 'object') return out;
  const goals = new Set(wanted);
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const id = Number(key);
    if (goals.has(id) && value === 'resultOnly') out[id] = value;
  }
  return out;
}

/**
 * Enhancement choices with a sound shape: a finite integer gift id and step 1 or 2. Which steps a
 * gift really has is a fact of the season's data, judged by `adoptSeason`. With `only`, the
 * choices for those gifts alone (what a share link carries).
 */
export function sanitizeUpgrades(raw: unknown, only?: readonly number[]): GiftUpgradeMap {
  const out: GiftUpgradeMap = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const allowed = only ? new Set(only) : null;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const id = Number(key);
    if (!Number.isInteger(id) || (allowed && !allowed.has(id))) continue;
    if (value === 1 || value === 2) out[id] = value;
  }
  return out;
}

/**
 * One identity per sinner, at most twelve, in the order given. An id that cannot be an identity at
 * all — not a positive integer, or one whose sinner digits are not 1..12 — is dropped here, on every
 * way in; an id shaped right that the data does not know goes in `adoptSeason`, which has the data.
 */
export function uniqueDeck(ids: number[]): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const id of ids) {
    if (!Number.isInteger(id) || id <= 0) continue;
    const sinner = sinnerOf(id);
    if (sinner < 1 || sinner > SINNER_COUNT || seen.has(sinner)) continue;
    seen.add(sinner);
    out.push(id);
  }
  return out.slice(0, SINNER_COUNT);
}
