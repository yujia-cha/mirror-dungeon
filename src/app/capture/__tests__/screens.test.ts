import { describe, expect, it } from 'vitest';
import { classifyScreen, isObservationTitle, parseFloor } from '../screens.ts';

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

describe('classifyScreen on the run screens', () => {
  it('reads the map header and the pack picker with their floor numbers', () => {
    expect(classifyScreen(['1층 탐사 중', '속하지 못하는'], 'ko')).toBe('exploring');
    expect(classifyScreen(['3층 테마팩 선택', 'HARD'], 'ko')).toBe('packSelect');
    // A real read: 테 came out as 데 and the floor line was split off.
    expect(classifyScreen(['1중 레마팩', '데마팩 선택'], 'ko')).toBe('packSelect');
  });

  it('knows the sell confirm by its sentence, whatever the name inside', () => {
    // Arrange: the confirm sits over the sell screen, whose title is still readable.
    const lines = ['E.G.O 기프트 판매', '[빛나는 잔영]을(를) 코스트 300에', '판매하시겠습니까?'];
    // Act + Assert: the confirm wins; its sentence wraps, so the second half is enough.
    expect(classifyScreen(lines, 'ko')).toBe('sellConfirm');
    expect(classifyScreen(['[빛나는 잔영]을(를) 코스트 300에 판매하시겠습니까?'], 'ko')).toBe('sellConfirm');
  });

  it('puts an acquired popup ahead of the map behind it', () => {
    expect(classifyScreen(['2층 탐사 중', 'E.G.O 기프트를 획득했습니다.'], 'ko')).toBe('acquired');
  });
});

describe('the run start pickers (M135)', () => {
  it('knows the observation title and the start panel heading as OCR reads them', () => {
    expect(classifyScreen(['6.6.0 기프트 관측'], 'ko')).toBe('observationSelect');
    expect(classifyScreen(['선택한6.0 기프트 ㅣ'], 'ko')).toBe('startGiftSelect');
  });

  it('still reads the fusion confirm line, which contains the start panel heading, as the confirm', () => {
    expect(classifyScreen(['선택한 E.G.O 기프트를 조합하시겠습니까?'], 'ko')).toBe('fusionConfirm');
  });
});

describe('isObservationTitle', () => {
  it('reads the dimmed title behind a popup, a syllable off', () => {
    expect(isObservationTitle(['6.6.0 기프트 관즉'], 'ko')).toBe(true);
  });

  it('is not fooled by 「테마팩 관측」 on the pack picker, or by noise', () => {
    expect(isObservationTitle(['900? 래마떡관측 |'], 'ko')).toBe(false);
    expect(isObservationTitle(['ㅣ] 711'], 'ko')).toBe(false);
    expect(isObservationTitle(['E.G.O Gift Observation'], 'en')).toBe(false);
  });
});

describe('parseFloor', () => {
  it('reads the number before 「층」', () => {
    expect(parseFloor(['1층 탐사 중'])).toBe(1);
    expect(parseFloor(['HARD', '11층 테마팩 선택'])).toBe(11);
  });

  it('takes 「증」 and 「중」 for 「층」, as OCR reads it', () => {
    // Real reads of the map header and the pack picker title.
    expect(parseFloor(['1증탐사 중'])).toBe(1);
    expect(parseFloor(['1중 레마팩'])).toBe(1);
  });

  it('puts back the lookalikes OCR reads for digits', () => {
    expect(parseFloor(['I층 탐사 중'])).toBe(1);
    expect(parseFloor(['II층 탐사 중'])).toBe(11);
    expect(parseFloor(['1O층'])).toBe(10);
  });

  it('returns null without a floor', () => {
    expect(parseFloor([])).toBeNull();
    expect(parseFloor(['탐사 중'])).toBeNull();
    expect(parseFloor(['0층'])).toBeNull();
  });
});
