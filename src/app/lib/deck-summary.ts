import type { Enums } from '../../core/schema.ts';
import type { DeckStats } from '../../core/types.ts';
import { factionName, keywordName } from '../format.ts';
import type { Lang } from '../i18n.ts';

export interface SummaryChip {
  label: string;
  count: number;
  /** The same count over the whole formation — the twelve, reserves included. */
  formation: number;
}

/**
 * Keyword counts of the deployed party and of the whole formation, then factions two or more of
 * them share. A keyword only the reserves carry still shows, because swapping someone in is a
 * decision the player may want to make.
 */
export function deckSummaryChips(stats: DeckStats, enums: Enums, lang: Lang): SummaryChip[] {
  const chips: SummaryChip[] = [];
  const keywords = Object.entries(stats.keywordCounts.formation)
    .map(([keyword, total]) => ({
      keyword,
      total: total ?? 0,
      deployed: stats.keywordCounts.deployed[keyword as never] ?? 0,
    }))
    .filter(({ total }) => total > 0)
    .sort((a, b) => b.deployed - a.deployed || b.total - a.total || a.keyword.localeCompare(b.keyword));
  for (const { keyword, total, deployed } of keywords) {
    chips.push({ label: keywordName(keyword as never, enums, lang), count: deployed, formation: total });
  }
  const factions = Object.entries(stats.factionCounts.formation)
    .map(([faction, total]) => ({ faction, total, deployed: stats.factionCounts.deployed[faction] ?? 0 }))
    .filter(({ total }) => total >= 2)
    .sort((a, b) => b.deployed - a.deployed || b.total - a.total || a.faction.localeCompare(b.faction))
    .slice(0, 4);
  for (const { faction, total, deployed } of factions) {
    chips.push({ label: factionName(faction, enums, lang), count: deployed, formation: total });
  }
  return chips;
}
