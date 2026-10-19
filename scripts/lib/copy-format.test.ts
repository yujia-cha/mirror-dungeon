import { describe, expect, it } from 'vitest';
import {
  checkMedia,
  findUsages,
  parseCopy,
  renderCardSection,
  renderReadme,
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
    '# 안내',
    parts.guide ?? '## 런 | Run\n\n- ko: 「입장」을 누릅니다.\n- en: Press 「Enter」.\n- notice: true',
    '',
    '# README',
    parts.readme ?? '````markdown\n# 제목\n\n<!-- 카드: 런 -->\n\n```bash\nnpm ci\n```\n````',
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
        items: [
          { kind: 'shared', ko: '「입장」을 누릅니다.', en: 'Press 「Enter」.', line: expect.any(Number) },
        ],
        notice: true,
        line: expect.any(Number),
      },
    ]);
    // The README keeps its own (shorter) fences, which is why the outer one is four backticks.
    expect(doc.readme).toBe('# 제목\n\n<!-- 카드: 런 -->\n\n```bash\nnpm ci\n```\n');
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
    expect(issues.map((i) => i.message)).toEqual(['「- ko:」 다음에 「- en:」이 와야 합니다']);
    expect(doc.guide[0]!.items).toMatchObject([{ kind: 'shared', ko: '둘', en: 'Two' }]);
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
        guide: '## 루트 | Route\n- 설명서: 「획득 3/5」과 「없는 버튼」\n- en: x\n- readme: 「옛 버튼」',
        readme: '````markdown\n「획득 1/2」\n<!-- 카드: 루트 -->\n````',
      }),
    );

    // Act
    const quotes = unmatchedQuotes(doc);

    // Assert
    expect(quotes).toEqual([
      { where: '설명서 「루트」', quote: '없는 버튼' },
      { where: 'README', quote: '옛 버튼' },
    ]);
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

describe('안내 cards', () => {
  const card = [
    '## 덱 | Deck',
    '- readme: 코드에 출격 순서가 있으면 **그대로** 따릅니다.',
    '- ko: 수감자 칸을 누릅니다.',
    '- en: Press a slot.',
    '- 그림: guide/deck.webp | 덱 탭 화면 | The deck tab',
    '- 설명서: 앱에만 나오는 줄',
    '- en: App only',
    '- readme: 끝 줄',
  ].join('\n');

  it('reads the four line kinds in document order', () => {
    // Arrange
    const source = copy({ guide: card, readme: '````markdown\n<!-- 카드: 덱 -->\n````' });

    // Act
    const { doc, issues } = parseCopy(source);

    // Assert
    expect(issues).toEqual([]);
    expect(doc.guide[0]!.items.map((item) => item.kind)).toEqual([
      'readme',
      'shared',
      'media',
      'app',
      'readme',
    ]);
    expect(doc.guide[0]!.items[2]).toMatchObject({
      src: 'guide/deck.webp',
      alt: { ko: '덱 탭 화면', en: 'The deck tab' },
    });
  });

  it('writes a card as a README section: ko and readme lines as a list, pictures as paragraphs', () => {
    // Arrange
    const { doc } = parseCopy(copy({ guide: card, readme: '````markdown\n<!-- 카드: 덱 -->\n````' }));

    // Act
    const section = renderCardSection(doc.guide[0]!);

    // Assert
    expect(section).toBe(
      [
        '## 덱',
        '- 코드에 출격 순서가 있으면 **그대로** 따릅니다.\n- 수감자 칸을 누릅니다.',
        '![덱 탭 화면](public/guide/deck.webp)',
        '- 끝 줄',
      ].join('\n\n'),
    );
  });

  describe('line shapes (M157)', () => {
    const shaped = [
      '## 시작 | Start',
      '- ko: ¶ 첫 문단입니다.',
      '- en: A first paragraph.',
      '- 그림: guide/a.webp | 가 | A',
      '- 그림: guide/b.webp | 나 | B',
      '- ko: 1. **덱** : 고릅니다.',
      '- en: 1. **Deck**: pick.',
      '- ko: 2. 다음 단계',
      '- en: Next step',
      '- ko: 보통 항목',
      '- en: A plain item',
      '- ko: ### 소제목',
      '- en: Sub-heading',
    ].join('\n');
    const parsed = (): ReturnType<typeof parseCopy> =>
      parseCopy(copy({ guide: shaped, readme: '````markdown\n<!-- 카드: 시작 -->\n````' }));

    it('reads a numbered step, a sub-heading and a paragraph from how the text opens', () => {
      // Arrange
      const { doc, issues } = parsed();

      // Act
      const section = renderCardSection(doc.guide[0]!);

      // Assert: pictures in a row share a paragraph; a numbered list and a bullet list are apart.
      expect(issues).toEqual([]);
      expect(section).toBe(
        [
          '## 시작',
          '첫 문단입니다.',
          '![가](public/guide/a.webp)\n![나](public/guide/b.webp)',
          '1. **덱** : 고릅니다.\n2. 다음 단계',
          '- 보통 항목',
          '### 소제목',
        ].join('\n\n'),
      );
    });

    it('hands the guide the shape without its marker, in both languages', () => {
      // Arrange
      const { doc } = parsed();

      // Act
      const module = renderStringsModule(doc, new Map());

      // Assert: the English marker is optional and dropped when it is written.
      expect(module).toContain('{ ko: "첫 문단입니다.", en: "A first paragraph.", form: "paragraph" }');
      expect(module).toContain('{ ko: "**덱** : 고릅니다.", en: "**Deck**: pick.", form: "numbered", n: 1 }');
      expect(module).toContain('{ ko: "다음 단계", en: "Next step", form: "numbered", n: 2 }');
      expect(module).toContain('{ ko: "보통 항목", en: "A plain item" }');
      expect(module).toContain('{ ko: "소제목", en: "Sub-heading", form: "heading" }');
    });
  });

  it('writes a video with a link inside, so a renderer that drops the tag still leaves a link', () => {
    // Arrange
    const { doc } = parseCopy(
      copy({
        guide: '## 런 | Run\n- ko: 가\n- en: A\n- 그림: guide/run.mp4 | 런 화면 | The run',
        readme: '````markdown\n<!-- 카드: 런 -->\n````',
      }),
    );

    // Act
    const section = renderCardSection(doc.guide[0]!);

    // Assert
    expect(section).toContain('<video src="public/guide/run.mp4" controls muted loop playsinline');
    expect(section).toContain('[런 화면](public/guide/run.mp4)</video>');
  });

  it('puts each card where its marker is and keeps the rest of the README as written', () => {
    // Arrange
    const { doc } = parseCopy(copy());

    // Act
    const readme = renderReadme(doc);

    // Assert
    expect(readme).toContain('# 제목\n\n## 런\n\n- 「입장」을 누릅니다.\n\n```bash\nnpm ci\n```\n');
    expect(readme).not.toContain('<!-- 카드:');
  });

  it('leaves the guide-only line out of the README and the readme line out of the guide', () => {
    // Arrange
    const { doc } = parseCopy(copy({ guide: card, readme: '````markdown\n<!-- 카드: 덱 -->\n````' }));

    // Act
    const readme = renderReadme(doc);
    const strings = renderStringsModule(
      doc,
      new Map([['guide/deck.webp', { bytes: 1, width: 800, height: 500 }]]),
    );

    // Assert
    expect(readme).not.toContain('앱에만');
    expect(strings).not.toContain('끝 줄');
    expect(strings).toContain(
      '{ src: "guide/deck.webp", kind: "image", alt: { ko: "덱 탭 화면", en: "The deck tab" }, width: 800, height: 500 }',
    );
    expect(strings).toContain('{ ko: "앱에만 나오는 줄", en: "App only" }');
  });

  it.each([
    ['a missing marker', '````markdown\n# 제목\n````', 'README에 「<!-- 카드: 런 -->」 표식이 없습니다'],
    [
      'a marker for no card',
      '````markdown\n<!-- 카드: 런 -->\n<!-- 카드: 없음 -->\n````',
      '그런 안내 카드가 없습니다',
    ],
    ['a marker twice', '````markdown\n<!-- 카드: 런 -->\n<!-- 카드: 런 -->\n````', '표식이 두 번 있습니다'],
  ])('reports %s', (_, readme, message) => {
    // Arrange
    const source = copy({ readme });

    // Act
    const { issues } = parseCopy(source);

    // Assert
    expect(issues.map((i) => i.message).join('\n')).toContain(message);
  });

  it('reports markers out of card order with the README line number', () => {
    // Arrange
    const guide = '## 가 | A\n- ko: 가\n- en: A\n\n## 나 | B\n- ko: 나\n- en: B';
    const source = copy({ guide, readme: '````markdown\n<!-- 카드: 나 -->\n<!-- 카드: 가 -->\n````' });

    // Act
    const { issues } = parseCopy(source);
    const lines = source.split('\n');

    // Assert
    const order = issues.find((i) => i.message.includes('순서'))!;
    expect(order.message).toContain('「가」가 와야 합니다');
    expect(lines[order.line - 1]).toBe('<!-- 카드: 나 -->');
  });

  it.each([
    ['an empty alt text', '- 그림: guide/a.webp | 그림 |', '대체 텍스트를 한국어와 영어 둘 다'],
    ['a malformed picture line', '- 그림: guide/a.webp', '대체 텍스트를 한국어와 영어 둘 다'],
    ['an empty readme line', '- readme:', '「- readme:」가 비어 있습니다'],
    ['a card with nothing for the guide', null, '설명서에 나올 줄'],
  ])('reports %s', (_, extra, message) => {
    // Arrange
    const guide =
      extra === null ? '## 런 | Run\n- readme: README에만' : `## 런 | Run\n- ko: 가\n- en: A\n${extra}`;

    // Act
    const { issues } = parseCopy(copy({ guide }));

    // Assert
    expect(issues.map((i) => i.message).join('\n')).toContain(message);
  });
});

describe('checkMedia', () => {
  const guideWith = (line: string) =>
    parseCopy(copy({ guide: `## 런 | Run\n- ko: 가\n- en: A\n${line}` })).doc;

  it('accepts a file that exists under the limit', () => {
    // Arrange
    const doc = guideWith('- 그림: guide/a.webp | 가 | A');

    // Act
    const result = checkMedia(doc, () => ({ bytes: 300 * 1024 }));

    // Assert
    expect(result).toEqual({ issues: [], warnings: [] });
  });

  it.each([
    ['a missing file', 'guide/a.webp', null, 'public/guide/a.webp 파일이 없습니다'],
    ['an image one byte over 300KB', 'guide/a.webp', 300 * 1024 + 1, '이미지 한도 300KB를 넘습니다'],
    ['a video over 2MB', 'guide/a.mp4', 2 * 1024 * 1024 + 1, '동영상 한도 2048KB를 넘습니다'],
    ['a path outside public/guide', 'icons/a.webp', 10, 'public/guide/ 아래 경로여야 합니다'],
    ['a parent path', 'guide/../a.webp', 10, 'public/guide/ 아래 경로여야 합니다'],
    ['an unknown extension', 'guide/a.svg', 10, '만 쓸 수 있습니다'],
  ])('rejects %s', (_, src, bytes, message) => {
    // Arrange
    const doc = guideWith(`- 그림: ${src} | 가 | A`);

    // Act
    const { issues } = checkMedia(doc, () => (bytes === null ? null : { bytes }));

    // Assert
    expect(issues.map((i) => i.message).join('\n')).toContain(message);
  });

  it('warns about a GIF instead of failing', () => {
    // Arrange
    const doc = guideWith('- 그림: guide/a.gif | 가 | A');

    // Act
    const { issues, warnings } = checkMedia(doc, () => ({ bytes: 10 }));

    // Assert
    expect(issues).toEqual([]);
    expect(warnings[0]!.message).toContain('mp4나 webm');
  });
});
