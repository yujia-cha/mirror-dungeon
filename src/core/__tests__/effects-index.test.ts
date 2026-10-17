/**
 * M129: the app reads who meets what from the built index (`skill-gifts.json`); the CLI computes it.
 * Both must judge every gift the same way. The index here is built the way `data:build` builds it.
 */
import { describe, expect, it } from 'vitest';
import { loadGameDataFromDisk } from '../data/node.ts';
import { analyseDeck, buildIndexes } from '../index.ts';
import {
  giftEffectsReport,
  identityMeets,
  skillGiftLookup,
  slotsMeeting,
  type SkillGiftIndexFile,
} from '../effects.ts';

const data = loadGameDataFromDisk();
const indexes = buildIndexes(data);

function buildIndex(): SkillGiftIndexFile {
  const out: SkillGiftIndexFile = {};
  for (const identity of data.identities) {
    const bySlot: Record<string, Array<[number, number, number]>> = {};
    for (const gift of data.gifts)
      (gift.effects ?? []).forEach((effect, e) =>
        effect.requires.forEach((req, r) => {
          if (req.type === 'egoSkill' || identityMeets(identity, req) !== true) return;
          const slots = slotsMeeting(identity, req);
          for (const slot of slots.length > 0 ? slots : [0]) (bySlot[slot] ??= []).push([gift.id, e, r]);
        }),
      );
    out[identity.id] = bySlot;
  }
  return out;
}

// The shipped file when there is one (the app reads it); otherwise one built the same way.
const lookup = skillGiftLookup(data.skillGifts ?? buildIndex());
const DECKS: Array<[string, number[]]> = [
  ['burn', [10112, 10216, 10311, 10415, 10512, 10604, 10715]],
  ['rupture', [10102, 10203, 10302, 10106, 10111]],
  ['mixed', [10212, 10104, 10813, 10108, 11105, 10916]],
  ['nobody', []],
];

describe('index lookup = computation', () => {
  it.each(DECKS)('judges every gift the same for the %s deck', (_name, deployed) => {
    // Arrange
    const deck = deployed.length > 0 ? deployed : [10112, 10216];
    const stats = analyseDeck(deck, indexes, data.rules.deployment, deployed);
    // Act
    const differences = data.gifts.filter((gift) => {
      const computed = giftEffectsReport(gift, stats, indexes.identityById);
      const read = giftEffectsReport(gift, stats, indexes.identityById, lookup);
      const shape = (r: typeof computed) =>
        JSON.stringify([
          r.relevance,
          r.effects.map((e) => [e.usable, e.requirements.map((q) => [q.satisfied, q.matches])]),
        ]);
      return shape(computed) !== shape(read);
    });
    // Assert
    expect(differences.map((g) => g.id)).toEqual([]);
  });
});
