import type { Gift, Keyword, Rules } from './schema.ts';
import type { DeckStats, GameIndexes, PlanOptions, Requirement } from './types.ts';
import { dominantKeyword } from './deck.ts';
import { scarcity } from './requirements.ts';

export interface StartSelection {
  keyword: Keyword | null;
  /** The goals taken from the keyword's starting pool, scarcest first. */
  startGifts: number[];
  /** What 'auto' resolves to for these goals, reported even when a keyword was requested. */
  auto: { keyword: Keyword | null; startGifts: number[] };
}

/**
 * Whether the starlight-funded 기프트 관측 can offer this gift. The season data lists the eligible
 * gifts explicitly; fusion results are additionally gated by the rules.
 */
export function observable(gift: Gift, rules: Rules): boolean {
  if (!gift.observable) return false;
  if (!rules.giftObservation.fusionResultsAllowed && gift.acquisition.kind === 'fusionOnly') return false;
  return true;
}

/** The largest starting pool: the most starting gifts a run can take, one whole pool. */
export function largestStartPool(rules: Rules): number {
  return Math.max(0, ...Object.values(rules.startGift.poolsByKeyword).map((pool) => pool?.length ?? 0));
}

/**
 * How many starting gifts this run takes (M134): 1, plus one per boon 「쏟아지는 유성우」 and
 * 「완전한 가능성」, or 0 when the player takes none (「선택하지 않음」). Omitted = the rules' count.
 * Clamped into 0..the largest pool — every pick comes from one keyword's pool.
 */
export function startGiftBudget(options: Pick<PlanOptions, 'startGiftCount'>, rules: Rules): number {
  const count = options.startGiftCount;
  const max = largestStartPool(rules);
  const value =
    typeof count === 'number' && Number.isFinite(count) ? Math.round(count) : rules.startGift.pickCount;
  return Math.min(max, Math.max(0, value));
}

/**
 * Decide what the run starts with: the starting keyword pool hands over `count` gifts for free,
 * all from one keyword's pool (three per keyword). They go to the hardest-to-route wanted gifts in
 * that pool, since everything else can be picked up along the way — a general drop in the pool
 * too, which the pick turns from likely into certain. Observation is decided after the pack search.
 *
 * 'auto' follows the goals: among the keywords whose pool holds a wanted gift, it takes the one
 * whose picks save the most routed gifts (not general drops), then the one whose picks are hardest
 * to route (the scarcest pick first, then the next), then more picks, then the deck's dominant
 * keyword, then the keyword id. With one pick this is the old rule: the scarcest candidate wins.
 * Only when no pool holds a goal does it fall back to the dominant keyword — the choice then costs
 * nothing, and the player may pick any keyword. What 'auto' would pick is returned even for a
 * requested keyword, so the UI can say what the request gives up. With no pick at all there is no
 * keyword either.
 */
export function chooseStart(
  requirements: Requirement[],
  indexes: GameIndexes,
  rules: Rules,
  stats: DeckStats,
  requestedKeyword: Keyword | 'auto',
  count: number = rules.startGift.pickCount,
): StartSelection {
  const pools = rules.startGift.poolsByKeyword;
  // A keyword with no starting pool cannot start anything, so it is treated as no request at all.
  // The picker only offers keywords that have a pool, but a saved run or a share link made before
  // that filter existed can still name one (범용 / `None`), and honouring it would hand the player
  // no starting gift without saying why.
  const asked = requestedKeyword !== 'auto' && pools[requestedKeyword] ? requestedKeyword : null;

  const wantedIds = new Set(requirements.map((r) => r.giftId));
  const picks = Math.max(0, Math.floor(count));
  // Taking no starting gift (「선택하지 않음」) makes the keyword moot: nothing is chosen from it.
  if (picks === 0) return { keyword: null, startGifts: [], auto: { keyword: null, startGifts: [] } };

  // A pick only works for a goal: one of this keyword's candidates that is actually wanted. One
  // pick hands a gift over once, so each pick is a different gift.
  const picksIn = (keyword: Keyword | null): number[] => {
    if (!keyword || picks === 0) return [];
    return [...(pools[keyword] ?? [])]
      .filter((id) => wantedIds.has(id))
      .sort((a, b) => scarcity(a, indexes) - scarcity(b, indexes) || a - b)
      .slice(0, picks);
  };
  const routed = (gifts: number[]): number =>
    gifts.filter((id) => !indexes.freelyAvailableGifts.has(id)).length;
  /** Scarcest first, a missing pick worse than any gift. */
  const byScarcity = (a: number[], b: number[]): number => {
    for (let i = 0; i < picks; i += 1) {
      const sa = a[i] === undefined ? Infinity : scarcity(a[i]!, indexes);
      const sb = b[i] === undefined ? Infinity : scarcity(b[i]!, indexes);
      if (sa !== sb) return sa - sb;
    }
    return 0;
  };

  const dominant = dominantKeyword(stats);
  const helpful = (Object.keys(pools) as Keyword[])
    .map((keyword) => ({ keyword, gifts: picksIn(keyword) }))
    .filter((c) => c.gifts.length > 0)
    .sort(
      (a, b) =>
        routed(b.gifts) - routed(a.gifts) ||
        byScarcity(a.gifts, b.gifts) ||
        b.gifts.length - a.gifts.length ||
        Number(b.keyword === dominant) - Number(a.keyword === dominant) ||
        (a.keyword < b.keyword ? -1 : a.keyword > b.keyword ? 1 : 0),
    );
  const autoKeyword: Keyword | null = helpful[0]?.keyword ?? dominant;
  const auto = { keyword: autoKeyword, startGifts: picksIn(autoKeyword) };

  if (!asked) return { ...auto, auto };
  return { keyword: asked, startGifts: picksIn(asked), auto };
}
