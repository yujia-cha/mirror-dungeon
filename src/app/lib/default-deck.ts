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

/**
 * How many of a deck the app deploys on its own: none. Who fights is the player's call, so a new
 * or reset deck, the 기본 덱 button, a formation code without a deploy order and an identity put in
 * an empty slot all start in reserve. `rules.deployment.default` stays for core and the CLI.
 */
export const DEPLOYED_AT_START = 0;
