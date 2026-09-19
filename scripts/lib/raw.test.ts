// @vitest-environment node
// `raw.ts` resolves the repo root from `import.meta.url`, which is not a file URL under jsdom.
import { describe, expect, it } from 'vitest';
import { readBattleKeywordNames } from './raw.ts';

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
