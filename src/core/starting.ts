import type { Gift, Keyword, Rules } from './schema.ts';
import type { DeckStats, GameIndexes, Requirement } from './types.ts';
import { dominantKeyword } from './deck.ts';
import { scarcity } from './requirements.ts';

export interface StartSelection {
  keyword: Keyword | null;
  startGift: number | null;
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
 */
export function chooseStart(
  requirements: Requirement[],
  indexes: GameIndexes,
  rules: Rules,
  stats: DeckStats,
  requestedKeyword: Keyword | 'auto',
): StartSelection {
  // A keyword with no starting pool cannot start anything, so it is treated as no request at all.
  // The picker only offers keywords that have a pool, but a saved run or a share link made before
  // that filter existed can still name one (범용 / `None`), and honouring it would hand the player
  // no starting gift without saying why.
  const asked = requestedKeyword !== 'auto' && rules.startGift.poolsByKeyword[requestedKeyword] ? requestedKeyword : null;
  const keyword: Keyword | null = asked ?? dominantKeyword(stats);

  const wantedIds = new Set(requirements.map((r) => r.giftId));

  // The free pick only works if one of this keyword's three candidates is actually wanted.
  const pool = keyword ? (rules.startGift.poolsByKeyword[keyword] ?? []) : [];
  const startGift =
    rules.startGift.pickCount > 0
      ? ([...pool]
          .filter((id) => wantedIds.has(id))
          .sort((a, b) => scarcity(a, indexes) - scarcity(b, indexes))[0] ?? null)
      : null;

  return { keyword, startGift };
}
