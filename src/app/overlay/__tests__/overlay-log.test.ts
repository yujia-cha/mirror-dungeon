import { describe, expect, it } from 'vitest';
import { emptyRun } from '../../store.ts';
import type { RunState } from '../../lib/plan-input.ts';
import { FactLog, factKeys, installOverlayLog, runFacts, type FactState } from '../overlay-log.ts';
import { captureKeys, captureSentence, factSentence, quoted, type NameOf } from '../overlay-text.ts';

const state = (run: Partial<RunState> = {}, over: Partial<FactState> = {}): FactState => ({
  deck: [1],
  wanted: [],
  run: { ...emptyRun(), ...run },
  runSnapshot: null,
  ...over,
});

describe('runFacts (M151)', () => {
  it('tells an entry, the floors skipped on the way and the gift marks it settled, one fact per kind of mark', () => {
    // Arrange: from floor 1 to 4, entering only floor 3; two misses settled, one gift got.
    const prev = state({ currentFloor: 1 });
    const next = state({
      currentFloor: 4,
      visits: { 3: 1012 },
      giftStatus: { 9001: 'failed', 9002: 'failed', 9003: 'got' },
    });
    // Act
    const facts = runFacts(prev, next);
    // Assert
    expect(facts).toEqual([
      { kind: 'enter', floor: 3, packId: 1012 },
      { kind: 'skip', floor: 1 },
      { kind: 'skip', floor: 2 },
      { kind: 'status', from: null, to: 'failed', ids: [9001, 9002] },
      { kind: 'status', from: null, to: 'got', ids: [9003] },
    ]);
  });

  it('tells goals added and removed, a pack taken back and the run start', () => {
    const prev = state({ visits: { 2: 1005 }, currentFloor: 3 }, { wanted: [1, 2] });
    const next = state({ visits: {}, currentFloor: 3, startDone: true }, { wanted: [2, 3] });
    expect(runFacts(prev, next)).toEqual([
      { kind: 'goal', added: [3], removed: [1] },
      { kind: 'leave', floor: 2, packId: 1005 },
      { kind: 'start', done: true },
    ]);
  });

  it('says a new run, a rollback and a cleared run alone, not the marks they wiped', () => {
    // Arrange
    const played = { currentFloor: 3, visits: { 1: 1001 }, giftStatus: { 9001: 'got' as const } };
    const snapshot = { run: { ...emptyRun(), ...played } };
    // Act
    const begun = runFacts(state(played), state({}, { runSnapshot: snapshot }));
    const back = runFacts(state({ currentFloor: 5 }, { runSnapshot: snapshot }), state(played));
    const cleared = runFacts(state(played), state());
    // Assert
    expect(begun).toEqual([{ kind: 'runNew' }]);
    expect(back).toEqual([{ kind: 'rollback' }]);
    expect(cleared).toEqual([{ kind: 'runCleared' }]);
  });

  it('says nothing about what the run does not care about', () => {
    const prev = state();
    expect(runFacts(prev, { ...prev })).toEqual([]);
    expect(runFacts(prev, state({ stageFloor: 1 }))).toEqual([]);
  });

  it('keys a fact by the gifts and packs it is about', () => {
    expect(factKeys({ kind: 'status', from: null, to: 'got', ids: [1, 2] })).toEqual(['g1', 'g2']);
    expect(factKeys({ kind: 'enter', floor: 1, packId: 7 })).toEqual(['p7']);
    expect(factKeys({ kind: 'deck' })).toEqual([]);
  });
});

describe('installOverlayLog (M151)', () => {
  it('records each store change’s facts with its time, and nothing for a change that tells nothing', () => {
    // Arrange: a store stub that calls back like zustand's subscribe.
    let listener: (s: FactState, p: FactState) => void = () => {};
    const store = { subscribe: (fn: typeof listener) => ((listener = fn), () => {}) };
    const log = new FactLog(() => 42);
    installOverlayLog(store, log);
    // Act
    listener(state({ giftStatus: { 9001: 'got' } }), state());
    listener(state(), state());
    // Assert
    expect(log.entries()).toEqual([{ t: 42, fact: { kind: 'status', from: null, to: 'got', ids: [9001] } }]);
    expect(log.revision).toBe(1);
  });
});

describe('overlay sentences (M151)', () => {
  const names: NameOf = { lang: 'ko', gift: (id) => `기프트${id}`, pack: (id) => `팩${id}` };

  it('quotes names, so the particle sits on the word after them', () => {
    expect(quoted(['커피와 종이학', '장미'], 'ko')).toBe('「커피와 종이학」, 「장미」');
    expect(quoted(['Rose'], 'en')).toBe('"Rose"');
    expect(quoted(['가', '나', '다', '라', '마'], 'ko')).toBe('「가」, 「나」, 「다」 외 2개');
  });

  it('says each run fact in a sentence', () => {
    expect(factSentence({ kind: 'enter', floor: 3, packId: 1 }, names)).toBe('3층 「팩1」에 입장했습니다');
    expect(factSentence({ kind: 'status', from: null, to: 'got', ids: [1, 2] }, names)).toBe(
      '「기프트1」, 「기프트2」 기프트를 획득했습니다',
    );
    expect(factSentence({ kind: 'status', from: null, to: 'failed', ids: [1] }, names)).toBe(
      '「기프트1」 기프트를 얻지 못했습니다',
    );
    expect(factSentence({ kind: 'status', from: 'got', to: null, ids: [1] }, names)).toBe(
      '「기프트1」 기프트의 획득 표시를 지웠습니다',
    );
    expect(factSentence({ kind: 'skip', floor: 2 }, names)).toBe('2층을 건너뛰었습니다');
    expect(factSentence({ kind: 'goal', added: [1], removed: [] }, names)).toBe(
      '「기프트1」 기프트를 목표에 추가했습니다',
    );
  });

  it('says what the screen reader saw, a fusion with what it ate', () => {
    const fused = { event: { kind: 'fused' as const, resultId: 9, consumed: [1, 2], unsure: [] } };
    expect(captureSentence(fused, names)).toBe(
      '「기프트1」, 「기프트2」 기프트로 「기프트9」 기프트를 합성했습니다',
    );
    expect(captureSentence({ event: { kind: 'sold', giftId: 1 } }, names)).toBe(
      '「기프트1」 기프트를 판매했습니다',
    );
    expect(captureSentence({ event: { kind: 'got', giftId: 1, source: 'observation' } }, names)).toBe(
      '「기프트1」 기프트를 관측으로 획득했습니다',
    );
    expect(captureKeys(fused)).toEqual(['g9', 'g1', 'g2']);
  });
});
