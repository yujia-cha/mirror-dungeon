/**
 * The share link (M160 — moved out of `store.ts`): what a link carries (`SharedState`), how it is
 * written (`encodeShared`) and read back (`decodeShared`), and the address it opens on this page.
 *
 * A link is untrusted input: every list goes through the sanitizers in `sanitize.ts`, and the
 * hash is bounded before lz-string sees it.
 */
import lzString from 'lz-string';
import type { PlanOptions } from '../../core/types.ts';
import type { FusionGoalMap } from './plan-input.ts';
import {
  LEGACY_DEPLOYED,
  idList,
  sanitizeFusionGoal,
  sanitizeOptions,
  sanitizeUpgrades,
  uniqueDeck,
  type GiftUpgradeMap,
} from './sanitize.ts';

export interface SharedState {
  /**
   * The Mirror Dungeon the goals were picked in, written into a link as `s`. The app always opens
   * the default season (M145) and adopts whatever a link carries into it, so nothing reads this
   * back; it is still written so a link says which season it was made in, should a later app
   * offer a choice again.
   */
  season?: number;
  /** Identity ids in formation order: at most 12, one per sinner (enforced by `uniqueDeck` on every way in). */
  deck: number[];
  /** Who fights, as a subset of `deck`; the order comes from the deck. */
  deployed: number[];
  wanted: number[];
  options: PlanOptions;
  /** Fusion results whose ingredients are not goals of their own. Absent = ingredients count too. */
  fusionGoal?: FusionGoalMap;
  /**
   * The enhancement step chosen for a goal (M130). A link carries the goals' choices only; absent
   * (every link before M130) means none.
   */
  upgrades?: GiftUpgradeMap;
}

/**
 * The longest hash `decodeShared` reads (M160). lz-string's output can grow far past its input, so
 * a link is bounded before it is decompressed; a real link is well under 2 000 characters (a full
 * deck, forty goals and every option).
 */
export const MAX_SHARE_HASH = 16_384;

const HASH_PREFIX = '#s=';

/** A link's `up` key: the goals' enhancement steps, left out when no goal has one. */
function upgradesForLink(
  upgrades: GiftUpgradeMap | undefined,
  wanted: readonly number[],
): { up?: GiftUpgradeMap } {
  const up = sanitizeUpgrades(upgrades ?? {}, wanted);
  return Object.keys(up).length > 0 ? { up } : {};
}

export function encodeShared(state: SharedState): string {
  const payload = JSON.stringify({
    v: 5,
    ...(state.season === undefined ? {} : { s: state.season }),
    deck: state.deck,
    deployed: state.deployed,
    wanted: state.wanted,
    fusionGoal: state.fusionGoal ?? {},
    // The goals' steps only, and only when there are any — older readers ignore the key.
    ...upgradesForLink(state.upgrades, state.wanted),
    options: state.options,
  });
  return HASH_PREFIX + lzString.compressToEncodedURIComponent(payload);
}

/**
 * The plan a link carries, read off the store's state: the same keys whichever surface builds the
 * link (the header's 「공유」, the feedback report), so the two can never disagree about it.
 */
export function sharedStateOf(state: SharedState): SharedState {
  return {
    ...(state.season === undefined ? {} : { season: state.season }),
    deck: state.deck,
    deployed: state.deployed,
    wanted: state.wanted,
    fusionGoal: state.fusionGoal,
    upgrades: state.upgrades,
    options: state.options,
  };
}

/** The address that opens `shared` on this page: its origin and path (Pages' base), then the hash. */
export function shareUrlOf(shared: SharedState): string {
  return `${window.location.origin}${window.location.pathname}${encodeShared(shared)}`;
}

export function decodeShared(hash: string): SharedState | null {
  if (!hash.startsWith(HASH_PREFIX) || hash.length > MAX_SHARE_HASH) return null;
  try {
    // lz-string does not merely return nothing for a payload it cannot read — on some strings it
    // throws, which used to escape this function, blow up the effect that consumes the hash and
    // leave the reader with a blank page instead of a mangled link.
    const json = lzString.decompressFromEncodedURIComponent(hash.slice(HASH_PREFIX.length));
    if (!json) return null;
    // `s` (the season, v5) is not read: the app plans every link in the season it loaded (M145).
    const parsed = JSON.parse(json) as Partial<SharedState> & { up?: unknown };
    if (!Array.isArray(parsed.deck) || !Array.isArray(parsed.wanted)) return null;
    const deck = uniqueDeck(idList(parsed.deck));
    // v1 links carried no deployed list: the first six fought.
    const deployed = Array.isArray(parsed.deployed)
      ? idList(parsed.deployed).filter((n) => deck.includes(n))
      : deck.slice(0, LEGACY_DEPLOYED);
    const wanted = idList(parsed.wanted);
    return {
      deck,
      deployed,
      wanted,
      fusionGoal: sanitizeFusionGoal(parsed.fusionGoal, wanted),
      upgrades: sanitizeUpgrades(parsed.up, wanted),
      options: sanitizeOptions(parsed.options),
    };
  } catch {
    return null;
  }
}
