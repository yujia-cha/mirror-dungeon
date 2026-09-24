/** Build a share link the way the app does (`encodeShared` in `src/app/store.ts`), from disk data. */
import { readFileSync } from 'node:fs';
import lzString from 'lz-string';
import { defaultOptions } from '../src/core/index.ts';
import { defaultDeck } from '../src/app/lib/default-deck.ts';
import type { GameData } from '../src/core/schema.ts';

const identities = JSON.parse(readFileSync('public/data/identities.json', 'utf8')) as GameData['identities'];
const deck = defaultDeck({ identities } as GameData);

export function shareHash(wanted: number[], season = 7): string {
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
