/**
 * M127: the feedback issue — readable body, compressed payload, and the URL budget.
 */
import { describe, expect, it } from 'vitest';
import { appDefaultOptions, emptyRun } from '../../store.ts';
import type { FeedbackLogEntry } from '../../lib/feedback-log.ts';
import {
  buildFeedback,
  FEEDBACK_REPO,
  MAX_ISSUE_BODY,
  MAX_ISSUE_URL,
  trimLog,
  type FeedbackInput,
} from '../body.ts';
import { shortUserAgent } from '../env.ts';
import { decodePayload, extractPayloadText } from '../payload.ts';
import type { VisitorRecord } from '../visitor-diagnostics.ts';

const input = (over: Partial<FeedbackInput> = {}): FeedbackInput => ({
  t: Date.UTC(2026, 9, 16, 3, 0, 0),
  kind: 'bug',
  title: '',
  message: '6층에서 루트가 비어 보입니다.\n다시 계산해도 같습니다.',
  env: {
    dataVersion: 'abc123',
    season: 7,
    seasonName: '이름과 거미의 거울',
    lang: 'ko',
    theme: 'dark',
    viewport: '390x844@3',
    browser: 'Chrome 141 · Android',
    touch: true,
    page: 'https://yujia-cha.github.io/mirror-dungeon/',
  },
  include: { state: true, log: true, diagnostics: false, screenshot: false },
  state: {
    shareUrl: 'https://yujia-cha.github.io/mirror-dungeon/#s=N4Ig',
    shared: {
      season: 7,
      deck: [10101],
      deployed: [],
      wanted: [9088],
      options: appDefaultOptions(),
      fusionGoal: {},
    },
    run: {
      ...emptyRun(),
      currentFloor: 3,
      stageFloor: 3,
      visits: { 1: 1012, 2: 1020 },
      giftStatus: { 9088: 'got' },
    },
    route: {
      covered: 3,
      total: 4,
      unresolved: [{ giftId: 9001, reason: 'no-pack-path' }],
      warnings: ['fusion-slots'],
      capped: false,
    },
  },
  log: [
    { t: 1, kind: 'action', text: 'goal +9088' },
    {
      t: 2,
      kind: 'error',
      source: 'render',
      message: 'TypeError: x is undefined',
      stack: 'at RunStage\nat AppShell',
    },
  ],
  diagnostics: [],
  ...over,
});

/** Log entries that do not compress away: each says something different. */
function noisyLog(n: number): FeedbackLogEntry[] {
  return Array.from({ length: n }, (_, i) => ({
    t: i * 997,
    kind: 'action' as const,
    text: `gift ${9000 + ((i * 7919) % 997)} - → ${i % 3 ? 'got' : 'failed'} 기록 ${Math.sin(i).toFixed(6)}`,
  }));
}

function noisyDiag(n: number): VisitorRecord[] {
  return Array.from({ length: n }, (_, i) => ({
    t: i * 1009,
    kind: 'read' as const,
    screen: i % 2 ? 'map' : 'giftPopup',
    floor: (i % 15) + 1,
    pack: 1000 + ((i * 131) % 116),
    gift: 9000 + ((i * 7919) % 446),
    events: [`got ${9000 + ((i * 104729) % 446)}`],
  }));
}

describe('buildFeedback', () => {
  it('writes the readable sections and a payload that decodes to the full report, for the public repo', () => {
    // Act
    const issue = buildFeedback(input(), 'ko');
    // Assert
    expect(issue.fits).toBe(true);
    expect(issue.trimmed).toBe(false);
    expect(issue.title).toBe('[버그] 6층에서 루트가 비어 보입니다.');
    expect(
      issue.url.startsWith(`https://github.com/${FEEDBACK_REPO}/issues/new?labels=feedback&title=`),
    ).toBe(true);
    expect(issue.url.length).toBeLessThanOrEqual(MAX_ISSUE_URL);
    const body = new URL(issue.url).searchParams.get('body');
    expect(body).toBe(issue.body);
    for (const heading of ['## 내용', '## 환경', '## 상태', '<summary>기록</summary>'])
      expect(issue.body).toContain(heading);
    expect(issue.body).toContain('6층에서 루트가 비어 보입니다.');
    expect(issue.body).toContain('[이 계획 열기](https://yujia-cha.github.io/mirror-dungeon/#s=N4Ig)');
    expect(issue.body).toContain('런: 진행 3층 · 보는 층 3층 · 입장 2 · 획득 1 · 미획득 0');
    expect(issue.body).toContain('루트: 획득 3/4 · 미해결 no-pack-path · 참고 fusion-slots');
    expect(issue.body).toContain('Chrome 141 · Android · 화면 390x844@3 · 터치');
    expect(issue.body).toContain('[render] TypeError: x is undefined');
    expect(issue.body).not.toContain('기록 일부 생략');
    const decoded = decodePayload(issue.body);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.payload).toMatchObject({
      kind: 'bug',
      message: '6층에서 루트가 비어 보입니다.\n다시 계산해도 같습니다.',
      state: { route: { covered: 3 }, run: { visits: { 1: 1012, 2: 1020 } } },
      log: { omitted: 0 },
      screenshot: false,
    });
    expect(decoded.payload.log?.entries).toHaveLength(2);
    expect(decoded.payload.diagnostics).toBeUndefined();
    expect(issue.fullBody).toBe(issue.body);
  });

  it('leaves out what the visitor unticked, and says where a picture goes when one was copied', () => {
    const issue = buildFeedback(
      input({ include: { state: false, log: false, diagnostics: false, screenshot: true } }),
      'ko',
    );
    expect(issue.body).not.toContain('이 계획 열기');
    expect(issue.body).toContain('첨부하지 않음');
    expect(issue.body).not.toContain('TypeError');
    expect(issue.body).toContain('## 화면');
    expect(issue.body).toContain('Ctrl+V');
    const decoded = decodePayload(issue.body);
    expect(decoded.ok && decoded.payload.state).toBeUndefined();
    expect(decoded.ok && decoded.payload.log).toBeUndefined();
    expect(decoded.ok && decoded.payload.screenshot).toBe(true);
  });

  it('trims long logs and diagnostics to fit the URL and says so, keeping errors first', () => {
    // Arrange: far more than a URL can carry.
    const log = [...noisyLog(50)];
    log.splice(3, 0, { t: 5, kind: 'error', source: 'promise', message: 'early failure' });
    const big = input({
      log,
      diagnostics: noisyDiag(400),
      include: { state: true, log: true, diagnostics: true, screenshot: false },
    });
    // Act
    const issue = buildFeedback(big, 'ko');
    // Assert
    expect(issue.fits).toBe(true);
    expect(issue.trimmed).toBe(true);
    expect(issue.url.length).toBeLessThanOrEqual(MAX_ISSUE_URL);
    expect(issue.body).toContain('기록 일부 생략');
    const decoded = decodePayload(issue.body);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    const entries = decoded.payload.log!.entries;
    expect(entries.length).toBeLessThan(51);
    expect(decoded.payload.log!.omitted).toBe(51 - entries.length);
    // The one error survives the cut, however old.
    expect(entries.some((e) => e.kind === 'error' && e.message === 'early failure')).toBe(true);
    // The copy keeps everything.
    expect(issue.fullBody.length).toBeGreaterThan(issue.body.length);
    const full = decodePayload(issue.fullBody);
    expect(full.ok && full.payload.log!.entries).toHaveLength(51);
    expect(full.ok && full.payload.diagnostics!.records).toHaveLength(400);
  });

  it('asks for a paste when the message alone is past the URL, and keeps the copy under GitHub’s body limit', () => {
    // Arrange: 6000 Hangul syllables are 54 000 characters once percent-encoded.
    const huge = input({ message: '가'.repeat(6000) });
    // Act
    const issue = buildFeedback(huge, 'ko');
    // Assert
    expect(issue.fits).toBe(false);
    expect(issue.url.length).toBeLessThanOrEqual(MAX_ISSUE_URL);
    expect(issue.body).toContain('붙여 넣어 주세요');
    expect(issue.body).not.toContain('가가가');
    expect(issue.fullBody).toContain('가'.repeat(6000));
    expect(issue.fullBody.length).toBeLessThanOrEqual(MAX_ISSUE_BODY);
  });

  it('writes the body in English for an English reader', () => {
    const issue = buildFeedback(
      input({ env: { ...input().env, lang: 'en' }, kind: 'idea', title: 'Sort option' }),
      'en',
    );
    expect(issue.title).toBe('[Suggestion] Sort option');
    expect(issue.body).toContain('## Message');
    expect(issue.body).toContain('[Open this plan]');
  });
});

describe('trimLog', () => {
  it('keeps the newest n with errors first, in time order', () => {
    const log: FeedbackLogEntry[] = [
      { t: 1, kind: 'error', source: 'load', message: 'e1' },
      { t: 2, kind: 'action', text: 'a2' },
      { t: 3, kind: 'action', text: 'a3' },
      { t: 4, kind: 'action', text: 'a4' },
    ];
    expect(trimLog(log, 2).map((e) => e.t)).toEqual([1, 4]);
    expect(trimLog(log, 0)).toEqual([]);
    expect(trimLog(log, 10)).toEqual(log);
  });
});

describe('payload extraction', () => {
  it('ignores whitespace a reader’s editor added and reports a missing or damaged block', () => {
    const body = buildFeedback(input(), 'ko').body;
    const text = extractPayloadText(body)!;
    const wrapped = body.replace(text, text.replace(/(.{60})/g, '$1\n'));
    expect(decodePayload(wrapped).ok).toBe(true);
    expect(decodePayload('no block here!')).toEqual({ ok: false, error: 'no ```md-feedback block found' });
    expect(decodePayload('```md-feedback\nAAAA\n```').ok).toBe(false);
  });
});

describe('shortUserAgent', () => {
  it('names the browser, its major version and the system', () => {
    expect(
      shortUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
      ),
    ).toBe('Chrome 141 · Windows');
    expect(
      shortUserAgent(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      ),
    ).toBe('Safari 18 · iOS');
    expect(
      shortUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
      ),
    ).toBe('Edge 141 · Windows');
    expect(shortUserAgent('Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0')).toBe(
      'Firefox 140 · Linux',
    );
    expect(shortUserAgent('curl/8')).toBe('unknown browser · unknown OS');
  });
});
