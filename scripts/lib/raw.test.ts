// @vitest-environment node
// `raw.ts` resolves the repo root from `import.meta.url`, which is not a file URL under jsdom.
import { describe, expect, it } from 'vitest';
import { readBattleKeywordNames, readSpecialVariants, SPECIAL_VARIANT_LINE } from './raw.ts';

describe('readBattleKeywordNames', () => {
  it('trims the names the game ships padded', () => {
    // `AttackDown` arrives as 「공격 레벨 감소 」 / 「Offense Level Down 」, which used to reach the
    // screen as 「[공격 레벨 감소 ] 5」 with the bracket adrift.
    expect(readBattleKeywordNames('KR').get('AttackDown')).toBe('공격 레벨 감소');
    expect(readBattleKeywordNames('EN').get('AttackDown')).toBe('Offense Level Down');
    for (const lang of ['KR', 'EN'] as const) {
      for (const [id, name] of readBattleKeywordNames(lang)) expect(name, `${lang} ${id}`).toBe(name.trim());
    }
  });
});

describe('readSpecialVariants', () => {
  it('accepts a 특수 line with a parenthetical, and only a line that stands alone', () => {
    expect(SPECIAL_VARIANT_LINE.exec('- 특수 충전')?.[1]).toBe('충전');
    expect(SPECIAL_VARIANT_LINE.exec('특수 출혈\n턴 시작 시 …')?.[1]).toBe('출혈');
    // 적안·참회 and 검은 눈물 write it this way; the bare-only pattern dropped their 충전 (M60).
    expect(SPECIAL_VARIANT_LINE.exec('- 최댓값 : 20\n- 특수 충전 (위력 고정)')?.[1]).toBe('충전');
    expect(SPECIAL_VARIANT_LINE.exec('- 이 버프의 효과는 특수 충전에도 적용됨')).toBeNull();
    expect(SPECIAL_VARIANT_LINE.exec('- 포자탄(특수 탄환)에 적용되는 효과')).toBeNull();
  });

  it('finds the variants the game declares with a parenthetical', () => {
    const variants = readSpecialVariants();
    for (const id of ['RedEyeFirst', 'PenanceFirst', 'BlackTearsAlly', 'ChargeBodyArt'])
      expect(variants.get(id), id).toBe('Charge');
    for (const id of ['ChoSuperCharge', 'ChargedSting', 'PersonalityCharge'])
      expect(variants.has(id), id).toBe(false);
  });
});
