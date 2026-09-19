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

  it('sorts what the ALLY gains into 버프 and what the ENEMY is handed into 디버프', () => {
    for (const label of ['Gain Poise Potency', 'Gain Speed / Haste', 'Gain Charge Count', 'Gain Skill Power', 'Gain Offense Level Up', 'Gain Defense Level Up']) {
      expect(classifyGiftEffects({ labels: [label], desc: desc('') }).buckets).toEqual(['buff']);
    }
    for (const label of ['Inflict Burn Potency', 'Inflict Tremor Count', 'Inflict Debuff', 'Reduce Speed / Bind']) {
      expect(classifyGiftEffects({ labels: [label], desc: desc('') }).buckets).toEqual(['debuff']);
    }
  });

  it('keeps 데미지 for damage actually dealt, not for what leads to it', () => {
    expect(classifyGiftEffects({ labels: ['Deal More Damage'], desc: desc('') }).buckets).toEqual(['damage']);
    expect(classifyGiftEffects({ labels: ['Trigger Tremor Burst'], desc: desc('') }).buckets).toEqual(['damage']);
    // 공격 레벨 증가 raises damage in the end, but the player is choosing a buff, not damage.
    expect(classifyGiftEffects({ labels: ['Gain Offense Level Up'], desc: desc('') }).buckets).not.toContain('damage');
  });

  it('tells the two 진동 labels apart: the ally stacks it, the enemy is handed it', () => {
    // 9164 흔들리는 술통 says 「자신의 [진동] 횟수 증가」; 9166 진원점 hands it to the enemy too.
    expect(classifyGiftEffects({ labels: ['Gain Tremor Count'], desc: desc('') }).buckets).toEqual(['buff']);
    expect(classifyGiftEffects({ labels: ['Inflict Tremor Count'], desc: desc('') }).buckets).toEqual(['debuff']);
  });

  it('separates 보호막 from 방어 레벨: one stops damage, the other is a stat', () => {
    expect(classifyGiftEffects({ labels: ['Gain Shield'], desc: desc('') }).buckets).toEqual(['survival']);
    expect(classifyGiftEffects({ labels: ['Gain Defense Level Up'], desc: desc('') }).buckets).toEqual(['buff']);
  });

  it('keeps E.G.O 자원 strictly, and shop money out of it', () => {
    expect(classifyGiftEffects({ labels: ['Gain E.G.O Resource'], desc: desc('') }).buckets).toEqual(['egoResource']);
    expect(classifyGiftEffects({ labels: ['Gain Cost'], desc: desc('') }).buckets).toEqual([]);
  });

  it('treats an enemy-resistance gain as the price it is, not as a debuff', () => {
    // 9280 본국검보 hands the enemy 「참격 내성 +0.3」 — the gift pays that, it does not land it.
    expect(classifyGiftEffects({ labels: ['Increase Enemy Resist'], desc: desc('') }).buckets).toEqual([]);
  });

  it('orders a multi-bucket gift the way EFFECT_BUCKETS does', () => {
    expect(
      classifyGiftEffects({ labels: ['Inflict Debuff', 'Gain Buff', 'Heal HP', 'Deal More Damage'], desc: desc('') }).buckets,
    ).toEqual(['damage', 'survival', 'buff', 'debuff']);
  });
});

describe('classifyGiftEffects — the text is only the safety net', () => {
  it('does not run at all once a label has decided', () => {
    // 「Gain Buff」 names a bucket now, so the text is never consulted — which is why no current
    // gift reaches stage 2. The buff name in the text would have said the same thing anyway.
    expect(
      classifyGiftEffects({
        labels: ['Gain Buff'],
        desc: desc('턴 시작 시, 무작위 아군 하나가 [피해량 증가] 2 얻음.'),
      }),
    ).toEqual({ buckets: ['buff'], stage: 'label' });
  });

  it('reads a bracketed ally buff when no label decided', () => {
    expect(
      classifyGiftEffects({
        labels: ['Other Uncommon Effects'],
        desc: desc('관통 공격 스킬을 2개 이상 보유한 경우, 턴 시작 시 [관통 피해량 증가] 1 얻음.'),
      }),
    ).toEqual({ buckets: ['buff'], stage: 'text' });
  });

  it('reads 보호막 and 회복 as survival', () => {
    expect(
      classifyGiftEffects({ labels: [], desc: desc('턴 시작 시 최대 체력의 10%만큼 보호막 부여.') }).buckets,
    ).toEqual(['survival']);
  });

  it('never reads prose — only the names the game brackets', () => {
    // 89% of the skill-trigger gifts say 위력 or 피해량 somewhere in prose; if that counted, every
    // one of them would land in one bucket and the classification would mean nothing.
    expect(
      classifyGiftEffects({ labels: ['Other Uncommon Effects'], desc: desc('참격 스킬의 피해량 +10%') }).buckets,
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
