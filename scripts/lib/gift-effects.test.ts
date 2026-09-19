import { describe, expect, it } from 'vitest';
import { BUCKETS_BY_LABEL, classifyGiftEffects, unknownLabels } from './gift-effects.ts';

/** Korean strings are verbatim from the game's own gift text, after the build localizes buff ids. */
const desc = (ko: string) => ({ ko, en: '' });

describe('classifyGiftEffects — the labels decide first', () => {
  it('reads a single label', () => {
    expect(classifyGiftEffects({ labels: ['Deal More Damage'], desc: desc('') })).toEqual({
      buckets: ['damage'],
      stage: 'label',
    });
  });

  it('keeps both buckets when a gift helps two ways (9025 잿빛 코트)', () => {
    expect(
      classifyGiftEffects({ labels: ['Deal More Damage', 'Heal HP'], desc: desc('') }).buckets,
    ).toEqual(['damage', 'survival']);
  });

  it('orders the buckets the same way however the labels arrive', () => {
    const a = classifyGiftEffects({ labels: ['Heal HP', 'Gain E.G.O Resource', 'Deal More Damage'], desc: desc('') });
    const b = classifyGiftEffects({ labels: ['Deal More Damage', 'Heal HP', 'Gain E.G.O Resource'], desc: desc('') });
    expect(a.buckets).toEqual(['damage', 'survival', 'egoResource']);
    expect(b.buckets).toEqual(a.buckets);
  });

  it('counts 호흡, 신속 and 충전 as damage, and E.G.O 자원 strictly on its own', () => {
    expect(classifyGiftEffects({ labels: ['Gain Poise Potency'], desc: desc('') }).buckets).toEqual(['damage']);
    expect(classifyGiftEffects({ labels: ['Gain Speed / Haste'], desc: desc('') }).buckets).toEqual(['damage']);
    expect(classifyGiftEffects({ labels: ['Gain Charge Count'], desc: desc('') }).buckets).toEqual(['damage']);
    expect(classifyGiftEffects({ labels: ['Gain E.G.O Resource'], desc: desc('') }).buckets).toEqual(['egoResource']);
  });

  it('treats an enemy-resistance gain as the drawback it is, not as survival', () => {
    expect(classifyGiftEffects({ labels: ['Increase Enemy Resist'], desc: desc('') }).buckets).toEqual([]);
  });
});

describe('classifyGiftEffects — the text decides the residue', () => {
  it('reads the buff name when the label says only 「Gain Buff」 (9010 블러디 가젯)', () => {
    expect(
      classifyGiftEffects({
        labels: ['Gain Buff'],
        desc: desc('턴 시작 시, 무작위 아군 하나가 [피해량 증가] 2 얻음.'),
      }),
    ).toEqual({ buckets: ['damage'], stage: 'text' });
  });

  it('reads a typed damage buff too (9143 목공용 대못)', () => {
    expect(
      classifyGiftEffects({
        labels: ['Gain Buff'],
        desc: desc('관통 공격 스킬을 2개 이상 보유한 경우, 턴 시작 시 [관통 피해량 증가] 1 얻음.'),
      }).buckets,
    ).toEqual(['damage']);
  });

  it('reads a defensive buff name as survival', () => {
    expect(
      classifyGiftEffects({ labels: ['Gain Buff'], desc: desc('턴 시작 시 [보호] 2 얻음.') }).buckets,
    ).toEqual(['survival']);
  });

  it('never reads prose — only the names the game brackets', () => {
    // 89% of the skill-trigger gifts say 위력 or 피해량 somewhere in prose; if that counted, every
    // one of them would be damage and the classification would mean nothing.
    expect(
      classifyGiftEffects({ labels: ['Gain Buff'], desc: desc('참격 스킬의 피해량 +10%') }).buckets,
    ).toEqual([]);
  });

  it('gives up rather than guessing', () => {
    expect(classifyGiftEffects({ labels: ['Other Uncommon Effects'], desc: desc('상점 가격 인하') })).toEqual({
      buckets: [],
      stage: 'none',
    });
  });
});

describe('classifyGiftEffects — corrections', () => {
  it('lets a curated entry win outright, including an emptying one', () => {
    expect(
      classifyGiftEffects({ labels: ['Deal More Damage'], desc: desc(''), override: ['survival'] }),
    ).toEqual({ buckets: ['survival'], stage: 'curated' });
    expect(
      classifyGiftEffects({ labels: ['Deal More Damage'], desc: desc(''), override: [] }),
    ).toEqual({ buckets: [], stage: 'curated' });
  });
});

describe('unknownLabels', () => {
  it('names a label the table does not, and nothing else', () => {
    expect(unknownLabels(['Deal More Damage', 'Brand New Label', 'Heal HP', 'Brand New Label'])).toEqual([
      'Brand New Label',
    ]);
    expect(unknownLabels(Object.keys(BUCKETS_BY_LABEL))).toEqual([]);
  });
});
