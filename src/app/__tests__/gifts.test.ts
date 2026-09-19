import { describe, expect, it } from 'vitest';
import type { Unresolved } from '../../core/types.ts';
import { PADDED_BRACKET, RICH_TEXT_TAG, RUNTIME_PLACEHOLDER } from '../../core/text.ts';
import { loadGameDataFromDisk } from '../../core/data/node.ts';
import { analyseDeck, buildIndexes, defaultOptions, evaluateConditions, planRoute } from '../../core/index.ts';
import { planToText } from '../lib/plan-text.ts';
import { unresolvedDetailText } from '../lib/unresolved-text.ts';
import { conditionShort, decidingReport } from '../lib/gift-condition.ts';
import { blockedGifts, entanglements } from '../lib/entangle.ts';
import { classifyGift } from '../lib/gift-priority.ts';
import { identityKeywordLabel, renderEffect, withJosa } from '../format.ts';

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

describe('effect text', () => {
  const desc = (id: number) => renderEffect(indexes.giftById.get(id)!.desc, data.enums, 'ko');

  it('keeps the words the game wrote in angle brackets', () => {
    // 「아군에 <혈귀>가 있다면」. A blanket `<[^>]*>` strip used to leave 「아군에 가 있다면」 —
    // Unity's tag names are an allowlist, not "anything in angle brackets".
    expect(desc(9213)).toContain('<혈귀>');
    expect(desc(9440)).toContain('아군에 <혈귀>가 있다면');
    expect(renderEffect(indexes.giftById.get(9416)!.desc, data.enums, 'en')).toContain('<Mechanical Amalgam>');
  });

  it('strips the rich-text tags and the runtime counter the game leaves behind', () => {
    for (const gift of data.gifts) {
      for (const lang of ['ko', 'en'] as const) {
        const text = renderEffect(gift.desc, data.enums, lang);
        expect(text, `${gift.id} ${gift.name.ko}`).not.toMatch(new RegExp(RICH_TEXT_TAG.source));
        expect(text, `${gift.id} ${gift.name.ko}`).not.toMatch(RUNTIME_PLACEHOLDER);
      }
    }
  });

  it('names the buff ids it knows in Korean, with no padding inside the brackets', () => {
    expect(desc(9024)).toContain('[공격 레벨 감소] 5와 [방어 레벨 감소] 5');
    expect(desc(9022)).toContain('[공격 레벨 증가] 2');
    expect(desc(9026)).toContain('[방어 레벨 증가]');
    // The game ships `AttackDown` as 「공격 레벨 감소 」; the trailing space used to reach the screen.
    for (const gift of data.gifts) {
      for (const lang of ['ko', 'en'] as const) {
        expect(renderEffect(gift.desc, data.enums, lang), `${gift.id} ${gift.name.ko}`).not.toMatch(PADDED_BRACKET);
      }
    }
  });

});

describe('identity keyword chips', () => {
  const label = (id: number, keyword: 'Bullet' | 'Charge' | 'Laceration') =>
    identityKeywordLabel(keyword, indexes.identityById.get(id)!.keywords[keyword], data.enums, 'ko');

  it('writes 탄환 plainly whether or not the skills use a 특수 variant', () => {
    // 10611 plain ammo, 10414 only 탄환 - 고독, 10711 both. 탄환 is spent, and no gift condition
    // ever asks for 「또는 특수 탄환」, so the 특수 split said nothing a player could act on.
    for (const id of [10611, 10414, 10711]) {
      expect(label(id, 'Bullet'), String(id)).toEqual({ label: '탄환', title: '탄환 소모 공격 스킬 보유' });
    }
  });

  it('still marks the 특수 variants of the status keywords, which conditions do count', () => {
    expect(label(10614, 'Charge').label).toBe('충전(특수)');
    expect(label(10504, 'Laceration').label).toBe('특수 출혈');
  });
});

describe('unresolved detail text', () => {
  const giftName = (id: number) => indexes.giftById.get(id)?.name.ko ?? String(id);

  it('names the ingredients a fusion is missing instead of listing their ids', () => {
    // Core can only write the ids — the planner never carries display names — so the reason is
    // rebuilt here. The panel always did this; the copied plan text printed the raw numbers.
    const entry: Unresolved = {
      giftId: 9410,
      reason: 'fusion-ingredient-unresolved',
      detail: { ko: '재료 9408, 9409을(를) 구할 수 없어 조합할 수 없습니다.', en: 'x' },
      missing: [9408, 9409],
    };
    const text = unresolvedDetailText(entry, giftName, 'ko');
    expect(text).toContain(giftName(9408));
    expect(text).toContain(giftName(9409));
    expect(text).not.toMatch(/9408|9409/);
  });

  it('reaches the copied plan text, not just the route panel', () => {
    const deck = [10101, 10201, 10301, 10401, 10501, 10601, 10701, 10801, 10901, 11001, 11101, 11201];
    const plan = planRoute(
      {
        deck,
        wanted: [9191, 9410, 9419, 9423].map((giftId) => ({ giftId, required: true })),
        options: { ...defaultOptions(), lastFloor: 15, hardFromFloor: 1, currentFloor: 3 },
      },
      data,
      indexes,
    );
    expect(plan.unresolved.some((u) => u.reason === 'fusion-ingredient-unresolved')).toBe(true);
    const text = planToText(plan, giftName, (id) => indexes.packById.get(id)?.name.ko ?? '', () => '', 'ko');
    expect(text).toContain('재료 ' + giftName(9408));
    expect(text).not.toMatch(/재료 \d+/);
  });
});

describe('korean particles', () => {
  it('follows the name\'s final consonant, and leaves English alone', () => {
    expect(withJosa('진혼', '을/를', 'ko')).toBe('진혼을');
    expect(withJosa('미니어처 대관람차', '을/를', 'ko')).toBe('미니어처 대관람차를');
    expect(withJosa('부동', '과/와', 'ko')).toBe('부동과');
    expect(withJosa('깨진 안경', '과/와', 'ko')).toBe('깨진 안경과');
    expect(withJosa('진혼', '은/는', 'ko')).toBe('진혼은');
    // A word that does not end in Hangul gets the bracketed form a Korean writer would use.
    expect(withJosa('Soothe the Dead', '을/를', 'ko')).toBe('Soothe the Dead을(를)');
    // English sentences carry no particle at all.
    expect(withJosa('Soothe the Dead', '을/를', 'en')).toBe('Soothe the Dead');
  });
});
