import { FormationDeckCode } from 'limbus-formation-deck';
import type { GameIndexes } from '../../core/types.ts';

/** Decode a game formation code into known identity ids, in the game's formation order. */
export function identitiesFromFormationCode(
  code: string,
  indexes: GameIndexes,
): { ids: number[]; skipped: number } | null {
  try {
    const result = FormationDeckCode.decode(code.trim());
    const all = result.formations
      .filter((formation) => formation.personalityId > 0)
      .map((formation) => formation.personalityId);
    const ids = all.filter((id) => indexes.identityById.has(id));
    if (ids.length === 0) return null;
    return { ids, skipped: all.length - ids.length };
  } catch {
    return null;
  }
}
