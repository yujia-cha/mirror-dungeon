import { describe, expect, it } from 'vitest';
import { classifyScreen } from '../screens.ts';

describe('classifyScreen', () => {
  it('reads a banner whose 「E.G.O」 came out as digits', () => {
    // Arrange: real OCR output from a purchase dialog, junk to the right included.
    const lines = ['6.ㅇ.0 기프트 구매            ㅣ', '후조 지지                   개 67'];
    // Act
    const screen = classifyScreen(lines, 'ko');
    // Assert
    expect(screen).toBe('purchase');
  });

  it('tells titles a syllable apart by voting for the closest only', () => {
    expect(classifyScreen(['6.6.0 기프트 판매'], 'ko')).toBe('sell');
    expect(classifyScreen(['6. 기프트 강와'], 'ko')).toBe('enhance');
    expect(classifyScreen(['6.6.0 기프트 공봐'], 'ko')).toBe('enhance');
    expect(classifyScreen(['E.G.O 기프트 합성'], 'ko')).toBe('fusion');
  });

  it('prefers the popup over the dimmed title of the screen behind it', () => {
    // Arrange: the acquired popup over the fusion screen.
    const lines = ['E.G.O 기프트 합성', 'E.G.O 기프트를 획득했습니다.'];
    // Act + Assert
    expect(classifyScreen(lines, 'ko')).toBe('acquired');
  });

  it('knows the fusion confirm line and the keyword picker', () => {
    expect(classifyScreen(['선택한 E.G.O 기프트를 조합하시겠습니까?'], 'ko')).toBe('fusionConfirm');
    expect(classifyScreen(['합성 - 키워드 선택'], 'ko')).toBe('fusionKeyword');
  });

  it('returns null when nothing reads like a title', () => {
    expect(classifyScreen([], 'ko')).toBeNull();
    expect(classifyScreen(['', '200', '~ 에'], 'ko')).toBeNull();
    expect(classifyScreen(['다음 층에서 특별한 상점 등장 확률'], 'ko')).toBeNull();
  });

  it('matches nothing in a language whose titles are not known yet', () => {
    expect(classifyScreen(['E.G.O Gift Acquired'], 'en')).toBeNull();
  });
});
