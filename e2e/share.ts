/**
 * Build a share link the way the app does (`encodeShared` in `src/app/store.ts`), from disk data.
 * The app always opens the default season (M145), so `season` only says what the link claims: 8 is
 * what the app writes today, 7 an old link that is adopted into the current season.
 */
import { readFileSync } from 'node:fs';
import lzString from 'lz-string';
import { defaultOptions } from '../src/core/index.ts';
import { defaultDeck } from '../src/app/lib/default-deck.ts';
import type { GameData } from '../src/core/schema.ts';

const identities = JSON.parse(readFileSync('public/data/identities.json', 'utf8')) as GameData['identities'];
const deck = defaultDeck({ identities } as GameData);

export function shareHash(wanted: number[], season = 8): string {
  const payload = JSON.stringify({
    v: 5,
    s: season,
    deck,
    deployed: deck.slice(0, 7),
    wanted,
    fusionGoal: {},
    options: { ...defaultOptions(), lastFloor: 15 },
  });
  return `#s=${lzString.compressToEncodedURIComponent(payload)}`;
}
