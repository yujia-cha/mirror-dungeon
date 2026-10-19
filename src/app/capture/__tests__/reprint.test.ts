import { describe, expect, it } from 'vitest';
import { matchPack, reprintMark, reprintsOf } from '../reprint.ts';

// The owner's 2026-10-19 run: the map headers of its two reprint floors and of an original.
const PACKS = [
  { id: 1103, name: '20번구의 기적' },
  { id: 1113, name: '20번구의 기적 BokGak' },
  { id: 1105, name: '시간살인시간' },
  { id: 1120, name: '시간살인시간 BokGak' },
  { id: 1114, name: '탄환이 찍은 마침표' },
];

describe('reprintMark', () => {
  it('finds the logo the OCR reads as digits behind the name', () => {
    expect(reprintMark('시간살인시간 80<68<')).toBe(7);
    expect(reprintMark('20번구의 기적 808')).toBe(9);
    expect(reprintMark('20번구의 기적80<69<')).toBe(8);
    expect(reprintMark('8068')).toBe(0);
  });

  it('finds the word itself, as a Latin model may read it', () => {
    expect(reprintMark('Timekilling Time BokGak')).toBe(17);
  });

  it('is not fooled by digits in the name or the floor line', () => {
    expect(reprintMark('20번구의 기적')).toBe(-1);
    expect(reprintMark('5증탐사 중')).toBe(-1);
    expect(reprintMark('30022220008')).toBe(-1);
    expect(reprintMark('탄환이찍은마침표 로')).toBe(-1);
  });
});

describe('reprintsOf', () => {
  it('pairs each reprint with its original by name', () => {
    expect([...reprintsOf(PACKS)]).toEqual([
      [1113, 1103],
      [1120, 1105],
    ]);
  });

  it('leaves out a reprint whose original is not in the list', () => {
    expect(reprintsOf([{ id: 1127, name: '심야청소 BokGak' }]).size).toBe(0);
  });
});

describe('matchPack', () => {
  it('names the reprint when its logo stands behind the name', () => {
    // Arrange: the header the run asked about (its answer: the reprint).
    const lines = ['7증탐사 중"', '시간살인시간 80<68 ，'];
    // Act
    const read = matchPack(lines, PACKS);
    // Assert
    expect(read).toMatchObject({ status: 'match', id: 1120 });
  });

  it('names the reprint when the logo came on a line of its own', () => {
    expect(matchPack(['5증탐사 중', '20번구의 기적', '808'], PACKS)).toMatchObject({
      status: 'match',
      id: 1113,
    });
  });

  it('reads a header without the logo as before', () => {
    expect(matchPack(['4증탐사중', '탄환이찍은 마침표 로'], PACKS)).toMatchObject({
      status: 'match',
      id: 1114,
    });
    expect(matchPack(['7증탐사 중', '시간살인시간'], PACKS)).toMatchObject({ status: 'match', id: 1105 });
  });

  it('falls back to every pack when the name before the logo matches no reprint', () => {
    expect(matchPack(['탄환이찍은 마침표 808'], PACKS)).toMatchObject({ status: 'match', id: 1114 });
  });
});
