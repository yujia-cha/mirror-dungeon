import { describe, expect, it } from 'vitest';
import { localizeBuffTokens } from './battle-keywords.ts';
import { stripRichText } from '../../src/core/text.ts';

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

describe('stripRichText', () => {
  it('removes the Unity tags and keeps every other angle-bracketed word', () => {
    expect(stripRichText('특수 <noparse>침잠</noparse> 포함')).toBe('특수 침잠 포함');
    expect(stripRichText('<color=#fff>붉은</color><b>글</b>')).toBe('붉은글');
    // The game writes creature names this way; a blanket strip left 「아군에 가 있다면」.
    expect(stripRichText('아군에 <혈귀>가 있다면')).toBe('아군에 <혈귀>가 있다면');
    expect(stripRichText('<Mechanical Amalgam>인 적에게')).toBe('<Mechanical Amalgam>인 적에게');
  });
});
