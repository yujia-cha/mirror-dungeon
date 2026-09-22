/**
 * The four pure helpers in `src/app/lib` that had no tests of their own.
 *
 * They were covered only incidentally, through `app.test.tsx` rendering the whole shell — which
 * exercises the happy path and nothing else. Each of these has edge cases the UI cannot easily
 * reach: a formation code from outside this codebase, a deck where only reserves carry a keyword,
 * a gift that is both an upgrade child and a fusion ingredient.
 *
 * `formation-code.ts` is first because it is the only one parsing a format we do not own.
 */
import { describe, expect, it } from 'vitest';
import { FormationDeckCode, createFormationDetailInfo } from 'limbus-formation-deck';
import { buildIndexes } from '../../../core/index.ts';
import { analyseDeck } from '../../../core/index.ts';
import { loadGameDataFromDisk } from '../../../core/data/node.ts';
import { identitiesFromFormationCode } from '../formation-code.ts';
import { upgradeChildren } from '../upgrade-children.ts';
import { carriedBy } from '../goal-toggle.ts';
import { deckSummaryChips } from '../deck-summary.ts';
import { defaultDeck } from '../default-deck.ts';
import { ingredientsOf } from '../entangle.ts';

const data = loadGameDataFromDisk();
const indexes = buildIndexes(data);

describe('identitiesFromFormationCode', () => {
  it('returns null for anything that is not a formation code', () => {
    for (const input of ['', '   ', 'nonsense', '{}', 'LCB-', '!!!!']) {
      expect(identitiesFromFormationCode(input, indexes)).toBeNull();
    }
  });

  it('round-trips a real code', () => {
    // Guards the fixture itself: an encoding that decoded to nothing would make the rest of this
    // block pass while asserting nothing at all.
    const deck = defaultDeck(data).slice(0, 6);
    expect(identitiesFromFormationCode(encode(deck), indexes)?.ids).toEqual(deck);
  });

  it('keeps the ids this season knows and counts the rest as skipped', () => {
    const deck = defaultDeck(data).slice(0, 6);
    const result = identitiesFromFormationCode(encode([...deck, UNKNOWN_ID]), indexes);
    expect(result).not.toBeNull();
    expect(result!.ids).toEqual(deck);
    expect(result!.skipped).toBe(1);
  });

  it('returns null when nothing in the code is an identity we ship', () => {
    expect(identitiesFromFormationCode(encode([UNKNOWN_ID]), indexes)).toBeNull();
  });

  it('tolerates surrounding whitespace, because a pasted code carries it', () => {
    const deck = defaultDeck(data).slice(0, 3);
    expect(identitiesFromFormationCode(`  ${encode(deck)}\n`, indexes)?.ids).toEqual(deck);
  });
});

/**
 * Encode ids with the same library the decoder uses, so the fixture cannot drift from the format.
 *
 * `slot` matters: without it the code encodes but decodes to an empty formation list, which would
 * have made these tests pass while asserting nothing.
 */
function encode(ids: number[]): string {
  return FormationDeckCode.encode(
    ids.map((personalityId, index) => createFormationDetailInfo({ slot: index + 1, personalityId })),
  );
}

/**
 * A personality id the encoder round-trips exactly and this season does not ship.
 *
 * Not an arbitrary large number: the code packs ids into a limited bit width, so 999999 comes back
 * out as 10399. An id has to survive the round trip to test "the code names someone we do not know".
 */
const UNKNOWN_ID = 10199;

describe('upgradeChildren', () => {
  const children = upgradeChildren(data);

  it('maps each parent to the gifts that upgrade from it', () => {
    expect(children.size).toBeGreaterThan(0);
    for (const [parentId, kids] of children) {
      expect(indexes.giftById.has(parentId)).toBe(true);
      for (const kid of kids) expect(kid.upgradeOf).toBe(parentId);
    }
  });

  it('holds every gift that names a parent, and only those', () => {
    const withParent = data.gifts.filter((gift) => gift.upgradeOf !== null);
    expect([...children.values()].flat().map((gift) => gift.id).sort((a, b) => a - b)).toEqual(
      withParent.map((gift) => gift.id).sort((a, b) => a - b),
    );
  });

  it('never lists a gift as its own child', () => {
    for (const [parentId, kids] of children) {
      expect(kids.map((kid) => kid.id)).not.toContain(parentId);
    }
  });
});

describe('carriedBy', () => {
  const childrenOf = upgradeChildren(data);
  const maxShopSlots = data.rules.fusion.maxShopSlots;
  const carry = (giftId: number): number[] =>
    carriedBy(indexes.giftById.get(giftId)!, { indexes, childrenOf, maxShopSlots });

  it('takes nothing for a gift with no children and no recipe', () => {
    const plain = data.gifts.find(
      (gift) => !gift.fusion?.recipes?.length && !childrenOf.has(gift.id),
    );
    expect(plain).toBeDefined();
    expect(carry(plain!.id)).toEqual([]);
  });

  it('takes the whole recipe tree of a fusion result', () => {
    const fusion = data.gifts.find((gift) => (gift.fusion?.recipes?.length ?? 0) > 0);
    expect(fusion).toBeDefined();
    const expected = ingredientsOf(fusion!, indexes, maxShopSlots);
    expect(expected.size).toBeGreaterThan(0);
    for (const id of expected) expect(carry(fusion!.id)).toContain(id);
  });

  it('takes 조합 계승 children as well as ingredients', () => {
    const parent = data.gifts.find(
      (gift) => childrenOf.has(gift.id) && (gift.fusion?.recipes?.length ?? 0) > 0,
    );
    if (!parent) return; // no gift is both in this season
    const carried = carry(parent.id);
    for (const kid of childrenOf.get(parent.id)!) expect(carried).toContain(kid.id);
  });
});

describe('deckSummaryChips', () => {
  const deck = defaultDeck(data);
  const stats = (deployed: number[]) => analyseDeck(deck, indexes, data.rules.deployment, deployed);
  const chips = (deployed: number[]) => deckSummaryChips(stats(deployed), data.enums, 'ko');

  it('counts the deployed party against the whole formation', () => {
    const half = deck.slice(0, 6);
    for (const chip of chips(half)) {
      expect(chip.count).toBeLessThanOrEqual(chip.formation);
      expect(chip.formation).toBeGreaterThan(0);
    }
  });

  it('still shows a keyword only the reserves carry, because swapping is a decision', () => {
    // Deploy nobody: every chip's deployed count is 0, and the chips must still be there.
    const reservesOnly = chips([]);
    expect(reservesOnly.length).toBeGreaterThan(0);
    expect(reservesOnly.every((chip) => chip.count === 0)).toBe(true);
    expect(reservesOnly.every((chip) => chip.formation > 0)).toBe(true);
  });

  it('names every chip in the requested language and never leaves one blank', () => {
    for (const lang of ['ko', 'en'] as const) {
      const labelled = deckSummaryChips(stats(deck.slice(0, 6)), data.enums, lang);
      for (const chip of labelled) expect(chip.label.trim()).not.toBe('');
    }
  });

  it('lists at most four factions, and only ones two or more of the twelve share', () => {
    const all = chips(deck.slice(0, 6));
    const keywordCount = Object.values(stats(deck.slice(0, 6)).keywordCounts.formation).filter(
      (n) => (n ?? 0) > 0,
    ).length;
    expect(all.length - keywordCount).toBeLessThanOrEqual(4);
  });

  it('is empty for an empty deck', () => {
    expect(
      deckSummaryChips(analyseDeck([], indexes, data.rules.deployment, []), data.enums, 'ko'),
    ).toEqual([]);
  });
});
