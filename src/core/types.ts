import type { Difficulty, Gift, Identity, IdentityKeywordId, Keyword, ThemePack } from './schema.ts';

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export interface WantedGift {
  giftId: number;
  /** Optional gifts are planned for only when they cost nothing extra. */
  required: boolean;
  /**
   * For a fusion result: whether its ingredients stay goals of their own once the fusion can no
   * longer happen (an ingredient failed or its floor has passed). Default true. When false, floors
   * that would be visited for the remaining ingredients alone are given back to the planner.
   */
  ingredientsAsGoals?: boolean;
}

export interface PlanOptions {
  /** Last floor planned for (1-15): 1-5 = one clear, 6-10 = 평행중첩, 11-15 = EXTREME. */
  lastFloor: number;
  /**
   * Floor from which packs are entered on Hard. 1 = the whole run is Hard, `null` = all Normal.
   * Hard is sticky in game, so this is a single switch point rather than a per-floor flag.
   * Planning past floor 5 forces 1, because 평행중첩 needs floors 1-5 cleared on Hard.
   */
  hardFromFloor: number | null;
  /**
   * Identity ids that fight, in deck order, at most `rules.deployment.max`. Omitted = the first
   * `rules.deployment.default` of the deck. Ids not in the deck are ignored.
   */
  deployed?: number[];
  /** Keyword whose starting-gift pool is used. 'auto' picks the deck's dominant keyword. */
  startKeyword: Keyword | 'auto';
  /**
   * Gifts the user pinned for the starlight-funded 기프트 관측 (at most `rules.giftObservation.max`).
   * A pin applies to any planned gift not yet in hand — a general drop included, which the
   * observation turns into a certainty — and goes before the free starting gift. The planner
   * fills the remaining slots itself: first to rescue gifts the route cannot reach, then to free
   * a forced pack so the route has more room.
   */
  observedGifts: number[];
  /** Assume every forced pack needs an observation on a pack never visited before (×1.5 cost). */
  assumeUnvisitedPacks: boolean;
  /** Floors the user pins to a pack by hand. */
  pinnedPacks: Record<number, number>;
  /** Packs to keep out of the plan. */
  bannedPacks: number[];
  /**
   * Packs the plan must include somewhere the pack is offered; the floor is left to the planner
   * so the pack keeps its window. A pack that is also banned is dropped with a warning.
   */
  preferredPacks: number[];
  /**
   * Run progress. `currentFloor` is the floor the player is about to enter (1 = a fresh run):
   * floors below it are played and only their `pinnedPacks` entry says which pack was taken there.
   * `ownedGifts` are already in hand and need no routing; `unobtainableGifts` were missed and are
   * reported as failed rather than planned for again.
   */
  currentFloor?: number;
  ownedGifts?: number[];
  unobtainableGifts?: number[];
}

export interface PlanInput {
  /** Identity ids, at most 12. Order is the formation order. */
  deck: number[];
  wanted: WantedGift[];
  options: PlanOptions;
}

// ---------------------------------------------------------------------------
// Deck analysis
// ---------------------------------------------------------------------------

export interface DeckStats {
  /**
   * Identities whose attack skills use each keyword — base or 특수 variant — by counting scope.
   * This is what a condition written 「[Charge] 횟수 또는 특수 충전을 …」 counts. 탄환 is in here too,
   * for the deck summary; no gift condition asks for it.
   */
  keywordCounts: Record<'deployed' | 'formation' | 'reserve', Partial<Record<IdentityKeywordId, number>>>;
  /** The same, counting only the base keyword: what 「[Laceration]을 부여하는 …」 counts. */
  baseKeywordCounts: Record<'deployed' | 'formation' | 'reserve', Partial<Record<IdentityKeywordId, number>>>;
  factionCounts: Record<'deployed' | 'formation' | 'reserve', Record<string, number>>;
  /**
   * The identities behind each count. A condition naming several keywords or factions counts
   * DISTINCT identities — one who inflicts both 파열 and 충전 is one identity, not two — so the
   * union has to be taken over ids and never by adding the counts above, which are these lengths.
   */
  keywordMembers: Record<'deployed' | 'formation' | 'reserve', Partial<Record<IdentityKeywordId, number[]>>>;
  baseKeywordMembers: Record<
    'deployed' | 'formation' | 'reserve',
    Partial<Record<IdentityKeywordId, number[]>>
  >;
  factionMembers: Record<'deployed' | 'formation' | 'reserve', Record<string, number[]>>;
  deployed: number[];
  reserve: number[];
  unknownIdentities: number[];
}

export interface ConditionReport {
  giftId: number;
  satisfied: boolean;
  /** Tier thresholds beyond the base `min` that the deck also reaches. */
  reachedTiers: number[];
  have: number | null;
  need: number | null;
  /**
   * What is being counted, as raw game ids. The planner never carries display names, so the UI
   * localizes these through `enums.json` and builds its own sentence.
   */
  subject: {
    kind: 'keyword' | 'faction' | 'resonance' | 'text';
    ids: string[];
    scope: 'deployed' | 'formation' | 'reserve' | null;
    /** How the skills use the keyword: 부여·획득 or 소모 (탄환·혈찬). Null off the keyword path. */
    verb?: 'inflict' | 'consume';
  };
  /**
   * False when the sentence names no threshold — 「…인격이 편성된 수에 따라 기프트 효과 강화」.
   * Such a condition states a number, not a bar: it is shown and never judged, and draws no ring.
   */
  gate: boolean;
  /** A plain fallback sentence for the CLI and for copy-as-text. */
  detail: { ko: string; en: string };
}

// ---------------------------------------------------------------------------
// Requirements
// ---------------------------------------------------------------------------

export type RequirementRoute =
  | 'route'
  | 'startGift'
  | 'observation'
  | 'generalDrop'
  /** Already in hand (run progress). */
  | 'owned'
  /** An ingredient the plan stopped routing for because its fusion can no longer happen. */
  | 'dropped'
  | 'unresolved';

export interface Requirement {
  giftId: number;
  required: boolean;
  /** The fusion result this exists to feed, if any. */
  neededFor: number | null;
  /** How the plan expects to obtain it. Filled in as planning proceeds. */
  via: RequirementRoute;
}

export interface FusionStep {
  result: number;
  ingredients: number[];
  /** Earliest floor at which every ingredient is in hand. */
  earliestFloor: number;
  /** Fusion needs a shop or rest node; true when no floor in range can host it. */
  unreachable: boolean;
  /** More than the shop's fusion slots would be needed in one step. */
  exceedsShopSlots: boolean;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export interface FloorPlan {
  floor: number;
  mode: Difficulty;
  /** Null means no pack is required here; take whatever the game offers. */
  packId: number | null;
  reason: 'required' | 'pinned' | 'free';
  /** Already played (below `currentFloor`): nothing left to decide here. */
  passed: boolean;
  /** Gifts to pick up on this floor, with why this floor supplies them. */
  pickups: {
    giftId: number;
    kind: 'exclusive' | 'pool';
    /** The fusion this pickup feeds, if it is an ingredient. */
    neededFor: number | null;
  }[];
  /** Observation is the only way to force a specific pack, and EXTREME floors forbid it. */
  observation: { needed: boolean; possible: boolean; starlight: number };
  /** Other packs that could have supplied the same pickups on this floor. */
  alternatives: number[];
  /**
   * The contiguous floors this same pack could sit on with every other assignment held fixed.
   * `from === to` means the pack is pinned to this floor; null when no pack is required here.
   */
  window: { from: number; to: number } | null;
}

export type UnresolvedReason =
  | 'no-pack-in-range'
  | 'pack-conflict'
  | 'fusion-ingredient-unresolved'
  | 'not-obtainable'
  | 'hard-only'
  /** Only a random hidden-battle reward; no route can guarantee it. */
  | 'chance-only'
  /** Every pack that supplies it is one the user gave up. */
  | 'pack-banned'
  /** Two fusions eat the same ingredient and no second pack can hand over a second copy. */
  | 'ingredient-shared'
  /** Marked as missed during the run. */
  | 'failed';

export interface Unresolved {
  giftId: number;
  reason: UnresolvedReason;
  detail: { ko: string; en: string };
  /** For `fusion-ingredient-unresolved`: the ingredient ids the plan could not obtain. */
  missing?: number[];
  /**
   * For `fusion-ingredient-unresolved` on a result whose ingredients are not goals of their own:
   * the remaining ingredients the plan stopped routing for.
   */
  droppedIngredients?: number[];
}

export type WarningCode =
  | 'condition-unmet'
  | 'hard-required'
  | 'parallel-requires-hard'
  | 'general-drop-not-guaranteed'
  | 'fusion-slots'
  | 'search-capped'
  | 'gift-observation-unverified'
  /** Pinned observations that were dropped: unknown, not observable, or over the limit. */
  | 'observation-trimmed'
  /** A pinned, banned or preferred pack that could not be honoured: unknown, not offered there, contradictory, or no floor left. */
  | 'pack-option-dropped'
  /** Two fusions eat the same ingredient, so the first has to be fused before the second copy drops. */
  | 'shared-ingredient';

export interface PlanWarning {
  code: WarningCode;
  detail: { ko: string; en: string };
  giftIds?: number[];
  packIds?: number[];
}

export interface ObservedGift {
  giftId: number;
  /** True when the user asked for it; false when the planner recommends it. */
  pinned: boolean;
  /** The pack the route no longer has to visit because of this observation, if that is why. */
  freedPack: number | null;
}

export interface RoutePlan {
  start: {
    keyword: Keyword | null;
    /** The one gift taken from the starting keyword pool. */
    startGift: number | null;
    /** Gifts taken through the starlight-funded 기프트 관측, pinned ones first. */
    observed: ObservedGift[];
    starlight: number;
    /** The cost table behind `starlight` is unverified for this season. */
    starlightVerified: boolean;
  };
  floors: FloorPlan[];
  fusions: FusionStep[];
  /** Gifts the plan expects to appear as ordinary drops, which is never guaranteed. */
  generalDrops: number[];
  conditions: ConditionReport[];
  unresolved: Unresolved[];
  warnings: PlanWarning[];
  stats: {
    requiredPacks: number;
    starlight: number;
    coveredWanted: number;
    totalWanted: number;
    searchNodes: number;
    searchCapped: boolean;
    elapsedMs: number;
  };
}

// ---------------------------------------------------------------------------
// Indexes
// ---------------------------------------------------------------------------

export interface GameIndexes {
  giftById: Map<number, Gift>;
  packById: Map<number, ThemePack>;
  identityById: Map<number, Identity>;
  /** Selectable packs only — unselectable ones can never appear in a run. */
  packs: ThemePack[];
  /** packId list per (mode, floor). */
  packsByFloor: Record<Difficulty, Map<number, number[]>>;
  /**
   * Floors a season fixes to one run mode, from `rules.floors`. The Normal/Hard band is not here:
   * which of the two a floor is played on depends on the run's Hard switch, not on the floor.
   */
  fixedModeByFloor: Map<number, 'parallel' | 'extreme'>;
  /** Packs whose pool contains the gift. */
  packsByGift: Map<number, number[]>;
  /** Gifts present in at least `rules.generalGiftPackShare` of packs: not worth routing for. */
  freelyAvailableGifts: Set<number>;
}
