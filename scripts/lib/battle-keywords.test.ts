import { describe, expect, it } from 'vitest';
import { localizeBuffTokens } from './battle-keywords.ts';

const names = new Map([
  ['Combustion', '화상'],
  ['AttackUp', '공격 레벨 증가'],
  ['Switch_Vibration', '진동 전환'],
]);

describe('localizeBuffTokens', () => {
  it('writes the game\'s own name over a bracketed buff id', () => {
    expect(localizeBuffTokens('[Combustion] 위력 +1', names)).toBe('[화상] 위력 +1');
    expect(localizeBuffTokens('[Switch_Vibration]과 [AttackUp]', names)).toBe('[진동 전환]과 [공격 레벨 증가]');
  });

  it('leaves an id the table does not name alone, and says which', () => {
    const unnamed = new Set<string>();
    expect(localizeBuffTokens('[BloodDinner] 20 소모, [Combustion] 5', names, unnamed)).toBe('[BloodDinner] 20 소모, [화상] 5');
    expect([...unnamed]).toEqual(['BloodDinner']);
  });

  it('touches nothing that is not an id in brackets', () => {
    // Korean text in brackets is the game's own wording, not a token; so is an empty pair.
    expect(localizeBuffTokens('[편성 1번 인격 전용 효과] []', names)).toBe('[편성 1번 인격 전용 효과] []');
    expect(localizeBuffTokens('피해량 +1 (최대 [3])', names)).toBe('피해량 +1 (최대 [3])');
  });
});
