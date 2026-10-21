/**
 * M129: the app reads who meets what from the built index (`skill-gifts.json`); the CLI computes it.
 * Both must judge every gift the same way — who meets a requirement, and whom the data cannot
 * judge (`unknown`, carried as the `"?"` slot since M166). The index here is built the way
 * `data:build` builds it.
 */
import { describe, expect, it } from 'vitest';
import { loadGameDataFromDisk } from '../data/node.ts';
import { analyseDeck, buildIndexes } from '../index.ts';
import {
  giftEffectsReport,
  identityMeets,
  skillGiftLookup,
  slotsMeeting,
  type GiftEffectsReport,
  type SkillGiftIndexFile,
} from '../effects.ts';
import type { GameData, Identity } from '../schema.ts';

const data = loadGameDataFromDisk();
const indexes = buildIndexes(data);

function buildIndex(season: Pick<GameData, 'identities' | 'gifts'>): SkillGiftIndexFile {
  const out: SkillGiftIndexFile = {};
  for (const identity of season.identities) {
    const bySlot: Record<string, Array<[number, number, number]>> = {};
    for (const gift of season.gifts)
      (gift.effects ?? []).forEach((effect, e) =>
        effect.requires.forEach((req, r) => {
          if (req.type === 'egoSkill') return;
          const verdict = identityMeets(identity, req);
          if (verdict === false) return;
          const slots = verdict === null ? ['?'] : slotsMeeting(identity, req);
          for (const slot of slots.length > 0 ? slots : [0]) (bySlot[slot] ??= []).push([gift.id, e, r]);
        }),
      );
    out[identity.id] = bySlot;
  }
  return out;
}

/** Everything the two paths must agree on, per gift. */
const shape = (r: GiftEffectsReport): string =>
  JSON.stringify([
    r.relevance,
    r.effects.map((e) => [e.usable, e.requirements.map((q) => [q.satisfied, q.unknown, q.matches])]),
  ]);

// The shipped file when there is one (the app reads it); otherwise one built the same way.
const lookup = skillGiftLookup(data.skillGifts ?? buildIndex(data));
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
      return shape(computed) !== shape(read);
    });
    // Assert
    expect(differences.map((g) => g.id)).toEqual([]);
  });

  it('counts the identities the data cannot judge on both paths (M166)', () => {
    // Arrange: 10112 with no per-skill facts, buffs or defense kinds — the shape an identity has
    // when no static source carries it (11016 before M134). Coin shapes, own-keyword and
    // mechanic requirements are then 「모름」, never met.
    const bare: Identity = {
      ...indexes.identityById.get(10112)!,
      skills: undefined,
      buffs: undefined,
      defenseTypes: undefined,
    };
    const season = { ...data, identities: data.identities.map((i) => (i.id === 10112 ? bare : i)) };
    const identityById = new Map(season.identities.map((i) => [i.id, i]));
    const bareLookup = skillGiftLookup(buildIndex(season));
    const deployed = [10112, 10216, 10311];
    const stats = analyseDeck(deployed, indexes, data.rules.deployment, deployed);
    // Act
    const reports = data.gifts.map((gift) => ({
      computed: giftEffectsReport(gift, stats, identityById),
      read: giftEffectsReport(gift, stats, identityById, bareLookup),
    }));
    const unknownOn = (report: GiftEffectsReport): number =>
      report.effects.reduce((sum, e) => sum + e.requirements.reduce((s, q) => s + q.unknown, 0), 0);
    // Assert: the computed path finds something it cannot judge, and the index path counts the same.
    expect(reports.some(({ computed }) => unknownOn(computed) > 0)).toBe(true);
    expect(reports.filter(({ computed, read }) => shape(computed) !== shape(read))).toEqual([]);
    // Without the "?" slot the index path reported every one of them as 0.
    const blind = skillGiftLookup(
      Object.fromEntries(
        Object.entries(buildIndex(season)).map(([id, slots]) => [
          id,
          Object.fromEntries(Object.entries(slots).filter(([slot]) => slot !== '?')),
        ]),
      ),
    );
    const blindReports = data.gifts.map((gift) => giftEffectsReport(gift, stats, identityById, blind));
    expect(blindReports.every((report) => unknownOn(report) === 0)).toBe(true);
  });
});
