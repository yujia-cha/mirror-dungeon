import { describe, expect, it } from 'vitest';
import {
  findUsages,
  parseCopy,
  renderMessagesModule,
  renderStringsModule,
  unmatchedQuotes,
  withUsageLines,
} from './copy-format.ts';
import { fillTemplate } from '../../src/core/text.ts';

/** A minimal well-formed copy.md; each test swaps in the part it is about. */
function copy(parts: { strings?: string; messages?: string; guide?: string; readme?: string } = {}): string {
  return [
    '# 설명문 모음',
    '아무 설명이나 써도 된다.',
    '',
    '# 화면 문구',
    parts.strings ?? '## 무대\n\n### stageEnter\n메모: 입장 버튼\n- ko: 입장\n- en: Enter',
    '',
    '# 루트 경고·미해결 사유',
    parts.messages ??
      '## 경고\n\n### warn.fusionSlots\n- ko: 재료가 {max}개를 넘습니다\n- en: Needs more than {max}',
    '',
    '# 설명서 카드',
    parts.guide ?? '## 런 | Run\n\n- ko: 「입장」을 누릅니다.\n- en: Press 「Enter」.\n- notice: true',
    '',
    '# README',
    parts.readme ?? '````markdown\n# 제목\n\n```bash\nnpm ci\n```\n````',
    '',
  ].join('\n');
}

describe('parseCopy', () => {
  it('reads every part of a well-formed file', () => {
    // Arrange
    const source = copy();

    // Act
    const { doc, issues } = parseCopy(source);

    // Assert
    expect(issues).toEqual([]);
    expect(doc.strings).toMatchObject([
      { key: 'stageEnter', ko: '입장', en: 'Enter', section: '무대', notes: ['입장 버튼'], usageLine: null },
    ]);
    expect(doc.messages).toMatchObject([{ key: 'warn.fusionSlots', ko: '재료가 {max}개를 넘습니다' }]);
    expect(doc.guide).toEqual([
      {
        title: { ko: '런', en: 'Run' },
        lines: [{ ko: '「입장」을 누릅니다.', en: 'Press 「Enter」.' }],
        notice: true,
        line: expect.any(Number),
      },
    ]);
    // The README keeps its own (shorter) fences, which is why the outer one is four backticks.
    expect(doc.readme).toBe('# 제목\n\n```bash\nnpm ci\n```\n');
  });

  it('reads CRLF line endings the same as LF', () => {
    // Arrange
    const source = copy().replace(/\n/g, '\r\n');

    // Act
    const { doc, issues } = parseCopy(source);

    // Assert
    expect(issues).toEqual([]);
    expect(doc.strings[0]).toMatchObject({ ko: '입장', en: 'Enter' });
  });

  it('trims the value but keeps inner spacing and punctuation', () => {
    // Arrange
    const source = copy({ strings: '## 무대\n### stageOf\n- ko:   / {last}  \n- en: / {last}' });

    // Act
    const { doc } = parseCopy(source);

    // Assert
    expect(doc.strings[0]!.ko).toBe('/ {last}');
  });

  it.each([
    ['a missing en', '## s\n### stageEnter\n- ko: 입장', '「- en:」이 없거나 비어 있습니다'],
    ['an empty ko', '## s\n### stageEnter\n- ko:\n- en: Enter', '「- ko:」가 없거나 비어 있습니다'],
    [
      'a duplicate key',
      '## s\n### a\n- ko: 가\n- en: A\n### a\n- ko: 나\n- en: B',
      '같은 키가 이미 있습니다',
    ],
    ['an unknown line inside an entry', '## s\n### a\n- k0: 가\n- en: A', '읽을 수 없는 줄'],
    ['an en-only placeholder', '## s\n### a\n- ko: 가\n- en: A {n}', 'en에만 있는 자리표시 {n}'],
    [
      'a ko-only placeholder in a screen text',
      '## s\n### a\n- ko: 가 {n}\n- en: A',
      'ko에만 있는 자리표시 {n}',
    ],
    ['a particle in a screen text', '## s\n### a\n- ko: {n|을/를}\n- en: {n}', '조사 자리표시'],
    ['a stray brace', '## s\n### a\n- ko: { n}\n- en: A', '중괄호'],
    ['a malformed key', '## s\n### 입장\n- ko: 가\n- en: A', '꼴이 맞지 않습니다'],
  ])('reports %s with its line number', (_, strings, message) => {
    // Arrange
    const source = copy({ strings });

    // Act
    const { issues } = parseCopy(source);

    // Assert
    expect(issues.map((i) => i.message).join('\n')).toContain(message);
    expect(issues.every((i) => i.line >= 5)).toBe(true);
  });

  it('lets a route message leave a name out of the English, but not invent one', () => {
    // Arrange
    const ok = copy({
      messages: '## m\n### unresolved.x\n- ko: {gift|을/를} 주는 팩이 없습니다\n- en: No pack.',
    });
    const bad = copy({ messages: '## m\n### unresolved.x\n- ko: 없습니다\n- en: No {gift}.' });

    // Act
    const okIssues = parseCopy(ok).issues;
    const badIssues = parseCopy(bad).issues;

    // Assert
    expect(okIssues).toEqual([]);
    expect(badIssues.map((i) => i.message)).toEqual(['unresolved.x: en에만 있는 자리표시 {gift}']);
  });

  it('rejects an unknown part heading and a guide card without an English title', () => {
    // Arrange
    const source = copy({ guide: '## 런\n- ko: 가\n- en: A' }) + '\n# 화면문구\n';

    // Act
    const messages = parseCopy(source).issues.map((i) => i.message);

    // Assert
    expect(messages.some((m) => m.includes('「## 한국어 | English」'))).toBe(true);
    expect(messages.some((m) => m.includes('모르는 큰 제목 「화면문구」'))).toBe(true);
  });

  it('pairs each guide ko line with the en line after it', () => {
    // Arrange
    const source = copy({ guide: '## 런 | Run\n- ko: 하나\n- ko: 둘\n- en: Two' });

    // Act
    const { doc, issues } = parseCopy(source);

    // Assert
    expect(issues.map((i) => i.message)).toEqual(['설명서 줄의 「- ko:」 다음에 「- en:」이 와야 합니다']);
    expect(doc.guide[0]!.lines).toEqual([{ ko: '둘', en: 'Two' }]);
  });

  it('requires the README fence and reports one left open', () => {
    // Arrange
    const missing = copy({ readme: '그냥 글' });
    const open = copy({ readme: '````markdown\n# 제목' });

    // Act
    const missingIssues = parseCopy(missing).issues.map((i) => i.message);
    const openIssues = parseCopy(open).issues.map((i) => i.message);

    // Assert
    expect(missingIssues.some((m) => m.includes('울타리 블록이 없습니다'))).toBe(true);
    expect(openIssues.some((m) => m.includes('닫히지 않았습니다'))).toBe(true);
  });
});

describe('rendering', () => {
  it('writes the strings table with notes as comments and the guide with its notice flag', () => {
    // Arrange
    const { doc } = parseCopy(copy());

    // Act
    const out = renderStringsModule(doc);

    // Assert
    expect(out).toContain('// 입장 버튼\n  stageEnter: { ko: "입장", en: "Enter" },');
    expect(out).toContain('as const satisfies Record<string, Localized>;');
    expect(out).toContain('notice: true,');
  });

  it('types each message by the placeholders its Korean uses, once each', () => {
    // Arrange
    const { doc } = parseCopy(
      copy({
        messages:
          '## m\n### warn.a\n- ko: 고정\n- en: Fixed\n### warn.b\n- ko: {gift|을/를} {n}개, {gift}\n- en: {n}',
      }),
    );

    // Act
    const out = renderMessagesModule(doc);

    // Assert
    expect(out).toContain('"warn.a": Record<never, never>;');
    expect(out).toContain('"warn.b": { gift: MessageParam; n: MessageParam };');
  });
});

describe('usages', () => {
  const files = [
    { path: 'src/app/A.tsx', text: "t('stageEnter', lang)\nt(\n  'stageOf',\n  lang)" },
    { path: 'src/app/B.ts', text: "const KEY = { http: 'loadFailedHttp' };\nt(`captureErr_${code}`, lang)" },
  ];

  it('finds calls, keys handed over as literals, and template prefixes, in that order of trust', () => {
    // Arrange
    const keys = ['stageEnter', 'stageOf', 'loadFailedHttp', 'captureErr_denied', 'routeFree'];

    // Act
    const found = findUsages(keys, files, 't');

    // Assert
    expect(found.get('stageEnter')).toEqual(['src/app/A.tsx']);
    expect(found.get('stageOf')).toEqual(['src/app/A.tsx']);
    expect(found.get('loadFailedHttp')).toEqual(['src/app/B.ts']);
    expect(found.get('captureErr_denied')).toEqual(['src/app/B.ts (동적)']);
    expect(found.has('routeFree')).toBe(false);
  });

  it('rewrites an existing 쓰는 곳 line and inserts a missing one after the entry body', () => {
    // Arrange
    const source = copy({
      strings:
        '## s\n### stageEnter\n- ko: 입장\n- en: Enter\n- 쓰는 곳: 옛 경로\n\n### routeFree\n- ko: 자유\n- en: Free',
    });
    const { doc } = parseCopy(source);

    // Act
    const out = withUsageLines(source, doc, new Map([['stageEnter', ['src/app/A.tsx']]]));

    // Assert
    expect(out).toContain('- en: Enter\n- 쓰는 곳: src/app/A.tsx\n');
    expect(out).toContain('- en: Free\n- 쓰는 곳: 참조 없음\n');
    expect(parseCopy(out).issues).toEqual([]);
    // Idempotent: a second pass over its own output changes nothing.
    expect(withUsageLines(out, parseCopy(out).doc, new Map([['stageEnter', ['src/app/A.tsx']]]))).toBe(out);
  });
});

describe('unmatchedQuotes', () => {
  it('matches a quote against screen texts with placeholders as wildcards', () => {
    // Arrange
    const { doc } = parseCopy(
      copy({
        strings: '## s\n### routeCovered\n- ko: 획득 {n}/{total}\n- en: Got {n}/{total}',
        guide: '## 루트 | Route\n- ko: 「획득 3/5」과 「없는 버튼」\n- en: x',
        readme: '````markdown\n「획득 1/2」\n````',
      }),
    );

    // Act
    const quotes = unmatchedQuotes(doc);

    // Assert
    expect(quotes).toEqual([{ where: '설명서 「루트」', quote: '없는 버튼' }]);
  });
});

describe('fillTemplate', () => {
  it.each([
    ['a final consonant', '화상', '{g|을/를} 줍니다', '화상을 줍니다'],
    ['no final consonant', '연기', '{g|을/를} 줍니다', '연기를 줍니다'],
    ['a number (reading unknown)', '9088', '{g|은/는} 없습니다', '9088은(는) 없습니다'],
    ['an English fallback name', 'Bell', '{g|이/가} 있습니다', 'Bell이(가) 있습니다'],
  ])('attaches the Korean particle after %s', (_, value, template, expected) => {
    // Arrange / Act
    const out = fillTemplate(template, 'ko', { g: value });

    // Assert
    expect(out).toBe(expected);
  });

  it('picks the per-language value and drops the particle in English', () => {
    // Arrange
    const params = { g: { ko: '화상', en: 'Burn' }, n: 3 };

    // Act
    const ko = fillTemplate('{g|을/를} {n}번', 'ko', params);
    const en = fillTemplate('{g|을/를} x{n}', 'en', params);

    // Assert
    expect(ko).toBe('화상을 3번');
    expect(en).toBe('Burn x3');
  });

  it('throws on a placeholder with no value instead of printing it', () => {
    // Arrange / Act / Assert
    expect(() => fillTemplate('{missing}개', 'ko', {})).toThrow('{missing}');
  });
});
