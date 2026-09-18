/**
 * The deck a first-time visitor starts with: each sinner's LCB 수감자, the base identity everyone
 * owns. They are the twelve identities carrying the LCB faction, so the game data decides the list
 * rather than a hard-coded table.
 */
import type { GameData } from '../../core/schema.ts';

const LCB_FACTION = 'LIMBUS_COMPANY_LCB';

export function defaultDeck(data: GameData): number[] {
  return data.identities
    .filter((identity) => identity.factions.includes(LCB_FACTION))
    .sort((a, b) => a.sinnerId - b.sinnerId || a.id - b.id)
    .filter((identity, i, all) => i === 0 || all[i - 1]!.sinnerId !== identity.sinnerId)
    .map((identity) => identity.id);
}
