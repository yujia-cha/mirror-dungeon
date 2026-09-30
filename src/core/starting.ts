import type { Gift, Keyword, Rules } from './schema.ts';
import type { DeckStats, GameIndexes, Requirement } from './types.ts';
import { dominantKeyword } from './deck.ts';
import { scarcity } from './requirements.ts';

export interface StartSelection {
  keyword: Keyword | null;
  startGift: number | null;
  /** What 'auto' resolves to for these goals, reported even when a keyword was requested. */
  auto: { keyword: Keyword | null; startGift: number | null };
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

/**
 * Decide what the run starts with: the starting keyword pool hands over one gift for free, chosen
 * from three per keyword. It goes to the hardest-to-route wanted gift in that pool, since
 * everything else can be picked up along the way. Observation is decided after the pack search.
 *
 * 'auto' follows the goals: among the keywords whose pool holds a wanted gift, it takes the one
 * whose best candidate is hardest to route (lowest `scarcity`), then the deck's dominant keyword,
 * then the keyword id. Only when no pool holds a goal does it fall back to the dominant keyword —
 * the choice then costs nothing, and the player may pick any keyword. What 'auto' would pick is
 * returned even for a requested keyword, so the UI can say what the request gives up.
 */
export function chooseStart(
  requirements: Requirement[],
  indexes: GameIndexes,
  rules: Rules,
  stats: DeckStats,
  requestedKeyword: Keyword | 'auto',
): StartSelection {
  const pools = rules.startGift.poolsByKeyword;
  // A keyword with no starting pool cannot start anything, so it is treated as no request at all.
  // The picker only offers keywords that have a pool, but a saved run or a share link made before
  // that filter existed can still name one (범용 / `None`), and honouring it would hand the player
  // no starting gift without saying why.
  const asked = requestedKeyword !== 'auto' && pools[requestedKeyword] ? requestedKeyword : null;

  const wantedIds = new Set(requirements.map((r) => r.giftId));

  // The free pick only works if one of this keyword's three candidates is actually wanted.
  const bestIn = (keyword: Keyword | null): number | null => {
    if (!keyword || rules.startGift.pickCount <= 0) return null;
    return (
      [...(pools[keyword] ?? [])]
        .filter((id) => wantedIds.has(id))
        .sort((a, b) => scarcity(a, indexes) - scarcity(b, indexes) || a - b)[0] ?? null
    );
  };

  const dominant = dominantKeyword(stats);
  const helpful = (Object.keys(pools) as Keyword[])
    .map((keyword) => ({ keyword, gift: bestIn(keyword) }))
    .filter((c): c is { keyword: Keyword; gift: number } => c.gift !== null)
    .sort(
      (a, b) =>
        scarcity(a.gift, indexes) - scarcity(b.gift, indexes) ||
        Number(b.keyword === dominant) - Number(a.keyword === dominant) ||
        (a.keyword < b.keyword ? -1 : a.keyword > b.keyword ? 1 : 0),
    );
  const autoKeyword: Keyword | null = helpful[0]?.keyword ?? dominant;
  const auto = { keyword: autoKeyword, startGift: bestIn(autoKeyword) };

  if (!asked) return { ...auto, auto };
  return { keyword: asked, startGift: bestIn(asked), auto };
}
