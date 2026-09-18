import { describe, expect, it } from 'vitest';
import { loadGameDataFromDisk } from '../../core/data/node.ts';
import { analyseDeck, buildIndexes, evaluateConditions } from '../../core/index.ts';
import { conditionShort, decidingReport } from '../lib/gift-condition.ts';
import { blockedGifts, entanglements } from '../lib/entangle.ts';
import { classifyGift } from '../lib/gift-priority.ts';

const data = loadGameDataFromDisk();
const indexes = buildIndexes(data);
const SLOTS = data.rules.fusion.maxShopSlots;
const BURN_DECK = [10112, 10216, 10311, 10415, 10512, 10604, 10715, 10808, 10916, 11009, 11115, 11216];
const stats = analyseDeck(BURN_DECK, indexes, data.rules.deployment, BURN_DECK.slice(0, 7));
const reportsFor = (id: number) => evaluateConditions([id], stats, indexes);

describe('condition chip', () => {
  it('says the subject and the count the deck has, whatever the condition is about', () => {
    // 진혼 wants five 화상 identities; the burn deck has more.
    expect(conditionShort(reportsFor(9088)[0]!, data.enums, 'ko')).toBe('화상 7/5');
    expect(conditionShort(reportsFor(9088)[0]!, data.enums, 'en')).toBe('Burn 7/5');
    // 연성진동 wants five 진동 identities; this deck is short.
    expect(conditionShort(reportsFor(9092)[0]!, data.enums, 'ko')).toBe('진동 3/5');
    // 날개 모양 양초 counts a faction instead.
    expect(conditionShort(reportsFor(9282)[0]!, data.enums, 'ko')).toBe('새벽 사무소 3/3');
    expect(conditionShort(null, data.enums, 'ko')).toBeNull();
  });

  it('shows the condition still short, not just the first one', () => {
    const reports = reportsFor(9092);
    const entry = classifyGift(indexes.giftById.get(9092)!, reports);
    expect(decidingReport(reports, entry.lack)).toBe(entry.lack ?? reports[0]);
    expect(conditionShort(decidingReport(reports, entry.lack), data.enums, 'ko')).toBe('진동 3/5');
  });
});

describe('entangled goals', () => {
  it('pairs the fusions that eat the same ingredient and names what they share', () => {
    // 장관 = 녹슨 칼자루 + 조각난 칼날, 부동 = 녹슨 칼자루 + 부서진 칼날.
    const found = entanglements([9717, 9718], indexes, SLOTS);
    expect([...found.keys()].sort()).toEqual([9717, 9718]);
    expect(found.get(9717)).toEqual([{ other: 9718, shared: [9713] }]);
    expect(found.get(9718)).toEqual([{ other: 9717, shared: [9713] }]);
  });

  it('counts an ingredient buried one fusion deeper', () => {
    // 진혼's own recipe takes 요리 비법 전서, so the two are a containment, not an entanglement.
    expect(entanglements([9088, 9157], indexes, SLOTS).size).toBe(0);
  });

  it('leaves plain drops and lone fusions alone', () => {
    expect(entanglements([9267, 9105, 9142], indexes, SLOTS).size).toBe(0);
    expect(entanglements([9088], indexes, SLOTS).size).toBe(0);
  });
});

describe('blocked gifts', () => {
  it('blocks what a goal already carries, across keywords', () => {
    // 데스페라도(관통) = 가시 올가미 + 부서진 소총 + 노이즈 섞인 무전기(침잠). Different keywords, so
    // `upgradeOf` never links them and only the recipe says the second is already in.
    const blocked = blockedGifts([9235], indexes, SLOTS);
    expect(blocked.get(9233)).toEqual({ reason: 'included', by: 9235 });
    expect(blocked.get(9145)).toEqual({ reason: 'included', by: 9235 });
    // The goal itself stays pickable-off, and an unrelated gift is untouched.
    expect(blocked.has(9235)).toBe(false);
    expect(blocked.has(9088)).toBe(false);
  });

  it('does not block a fusion that shares an ingredient with a goal', () => {
    // 장관 = 녹슨 칼자루 + 조각난 칼날, 부동 = 녹슨 칼자루 + 부서진 칼날. Sharing 녹슨 칼자루 is 얽힘,
    // not a block: two packs (육참골단 and its 복각) can hand over a copy each, and 기프트 관측 a
    // third. Only what 장관's own recipe eats is 포함.
    const blocked = blockedGifts([9717], indexes, SLOTS);
    expect(blocked.has(9718)).toBe(false);
    expect(blocked.get(9713)).toEqual({ reason: 'included', by: 9717 });
  });

  it('leaves a gift already chosen alone, and reads a recipe as 포함', () => {
    const blocked = blockedGifts([9717, 9718], indexes, SLOTS);
    expect(blocked.has(9717)).toBe(false);
    expect(blocked.has(9718)).toBe(false);
    // 요리 비법 전서 is inside 진혼's recipe, so it reads as 포함, never as a clash.
    expect(blockedGifts([9088], indexes, SLOTS).get(9157)).toEqual({ reason: 'included', by: 9088 });
  });

  it('blocks nothing when no goal is a fusion', () => {
    expect(blockedGifts([], indexes, SLOTS).size).toBe(0);
    expect(blockedGifts([9267, 9105], indexes, SLOTS).size).toBe(0);
  });
});
