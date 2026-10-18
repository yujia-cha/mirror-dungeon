/**
 * M127: the owner's side of a feedback issue — the payload block back to JSON and a report.
 */
import { describe, expect, it } from 'vitest';
import { buildFeedback, type FeedbackInput } from '../../src/app/feedback/body.ts';
import { encodePayload } from '../../src/app/feedback/payload.ts';
import { decodePayload, feedbackReport, publicShareLink, stampOf } from './feedback-decode.ts';

const input: FeedbackInput = {
  t: Date.UTC(2026, 9, 16, 5, 30, 5),
  kind: 'data',
  title: '팩 이름 오타',
  message: '1012 팩 이름이 다릅니다.',
  env: {
    dataVersion: 'v1',
    season: 7,
    seasonName: 'MD7',
    lang: 'ko',
    theme: 'light',
    viewport: '1440x900@1',
    browser: 'Firefox 140 · Linux',
    touch: false,
    page: 'http://localhost:5173/',
  },
  include: { state: true, log: true, diagnostics: true, screenshot: true },
  state: {
    shareUrl: 'http://localhost:5173/#s=N4IgDg',
    shared: { season: 7, deck: [10101, 10201], deployed: [10101], wanted: [9088], options: {} as never },
    run: {
      currentFloor: 2,
      stageFloor: 2,
      visits: { 1: 1012 },
      giftStatus: { 9088: 'failed' },
      startGifts: [],
    },
    route: {
      covered: 0,
      total: 1,
      unresolved: [{ giftId: 9088, reason: 'unobtainable' }],
      warnings: [],
      capped: true,
    },
  },
  log: [
    { t: 1000, kind: 'action', text: 'enter F1 pack 1012' },
    {
      t: 2000,
      kind: 'error',
      source: 'load',
      message: 'DataLoadError http gifts.json 404',
      stack: 'at load',
    },
  ],
  diagnostics: [
    {
      t: 3000,
      kind: 'floor',
      floor: 1,
      recommended: 1012,
      alternatives: [1013],
      entered: 1012,
      expected: [[9088, null]],
    },
    { t: 4000, kind: 'read', screen: 'map', floor: 2, pack: null, gift: null, events: [] },
    { t: 5000, kind: 'applied', event: 'got 9088', actions: 1, fromRead: true },
    { t: 6000, kind: 'undo', logId: 1 },
    { t: 7000, kind: 'answer', ask: 'gift', picked: [] },
    { t: 8000, kind: 'session', status: 'error', error: 'ended' },
    { t: 9000, kind: 'error', source: 'window', message: 'oops' },
    { t: 9500, kind: 'action', text: 'goal +9001' },
  ],
};

describe('feedback decode', () => {
  it('reads the payload back from the issue body exactly as the app built it', () => {
    // Arrange
    const issue = buildFeedback(input, 'ko');
    // Act
    const result = decodePayload(
      `Some text the visitor added above.\r\n\r\n${issue.body.replace(/\n/g, '\r\n')}`,
    );
    // Assert
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.message).toBe(input.message);
    expect(result.payload.state?.run).toEqual(input.state.run);
    expect(result.payload.log?.entries).toEqual(input.log);
    expect(result.payload.diagnostics?.records).toEqual(input.diagnostics);
    expect(stampOf(result.payload.t)).toBe('20261016-053005');
    // The plan reopens on the public site, not the visitor's dev server.
    expect(publicShareLink(result.payload)).toBe('https://yujia-cha.github.io/mirror-dungeon/#s=N4IgDg');
  });

  it('writes a report that names ids when it can', () => {
    const issue = buildFeedback(input, 'ko');
    const result = decodePayload(issue.body);
    if (!result.ok) throw new Error(result.error);
    const report = feedbackReport(result.payload, {
      gift: (id) => (id === 9088 ? '진혼' : undefined),
      pack: (id) => (id === 1012 ? '1호선' : undefined),
    });
    for (const line of [
      '# 피드백 20261016-053005 — data',
      '**팩 이름 오타**',
      '- 공유 링크: https://yujia-cha.github.io/mirror-dungeon/#s=N4IgDg',
      '  - 1층 입장 1012 1호선',
      '  - 기프트: 9088 진혼=failed',
      '- 루트: 획득 0/1 (근사 결과)',
      '  - 미해결 9088 진혼: unobtainable',
      '**오류** [load] DataLoadError http gifts.json 404',
      '**1층을 떠남** 추천 1012 1호선 · 입장 1012 1호선 · 대안 1013 · 기대 9088 진혼=표시 없음',
      '판독 map 2층',
      '적용 got 9088 (행동 1)',
      '되돌리기 #1',
      '질문 답 gift: 없음',
      '화면 인식 error (ended)',
      '앱 화면 캡처: 복사함',
    ])
      expect(report).toContain(line);
  });

  it('says what is missing when nothing was attached', () => {
    const issue = buildFeedback(
      { ...input, include: { state: false, log: false, diagnostics: false, screenshot: false } },
      'en',
    );
    const result = decodePayload(issue.body);
    if (!result.ok) throw new Error(result.error);
    expect(publicShareLink(result.payload)).toBeNull();
    expect(feedbackReport(result.payload).match(/첨부하지 않음/g)).toHaveLength(3);
  });

  it('refuses a body without the block, or with a damaged one', () => {
    expect(decodePayload('just words').ok).toBe(false);
    const issue = buildFeedback(input, 'ko');
    const damaged = issue.body.replace(/(```md-feedback\n)(.{40})/, '$1');
    expect(decodePayload(damaged).ok).toBe(false);
  });

  describe('a block anyone could have written (M154: the issue is public)', () => {
    const block = (payload: unknown) =>
      encodePayload(payload as Parameters<typeof encodePayload>[0]).replace(/^.*\n|\n.*$/g, '');
    const valid = () => {
      const result = decodePayload(buildFeedback(input, 'ko').body);
      if (!result.ok) throw new Error(result.error);
      return result.payload;
    };

    it('keeps a valid payload as it was sent, unknown keys too', () => {
      // Arrange
      const payload = { ...valid(), extra: 'kept' };
      // Act
      const result = decodePayload(encodePayload(payload));
      // Assert
      expect(result).toEqual({ ok: true, payload });
    });

    type Payload = ReturnType<typeof valid>;
    const withState = (p: Payload, shared: object, run: object) => ({
      ...p,
      state: { ...p.state!, shared: { ...p.state!.shared, ...shared }, run: { ...p.state!.run, ...run } },
    });
    it.each<[string, (p: Payload) => unknown, RegExp]>([
      ['the version alone', () => ({ v: 1 }), /malformed at (t|kind|title|message|env|screenshot)\b/],
      ['a message that is a number', (p) => ({ ...p, message: 5 }), /malformed at message\b/],
      [
        'a deck of strings',
        (p) => withState(p, { deck: ['x'] }, {}),
        /malformed at state\.shared\.deck\.0\b/,
      ],
      [
        'an unknown log kind',
        (p) => ({ ...p, log: { entries: [{ t: 1, kind: 'boom' }], omitted: 0 } }),
        /malformed at log\.entries\.0\b/,
      ],
      [
        'a gift status a run cannot have',
        (p) => withState(p, {}, { giftStatus: { 9088: 'lost' } }),
        /malformed at state\.run\.giftStatus\.9088\b/,
      ],
    ])('refuses %s, naming where', (_, craft, error) => {
      // Arrange
      const text = block(craft(valid()));
      // Act
      const result = decodePayload(text);
      // Assert
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(error);
    });

    it('still names an unknown version as such', () => {
      expect(decodePayload(block({ ...valid(), v: 2 }))).toEqual({
        ok: false,
        error: 'unknown payload version 2',
      });
    });
  });
});
