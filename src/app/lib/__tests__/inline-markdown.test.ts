import { describe, expect, it } from 'vitest';
import { linkTarget, parseInline, REPO_FILE_BASE } from '../inline-markdown.ts';

describe('parseInline', () => {
  it('keeps plain text as one token', () => {
    // Arrange / Act
    const tokens = parseInline('「입장」을 누릅니다 >> (모두 보기)');

    // Assert
    expect(tokens).toEqual([{ kind: 'text', text: '「입장」을 누릅니다 >> (모두 보기)' }]);
  });

  it('reads bold, code and links in order', () => {
    // Arrange / Act
    const tokens = parseInline('**덱 탭**에서 `>>`를 눌러 [사이트](https://example.com)로');

    // Assert
    expect(tokens).toEqual([
      { kind: 'strong', text: '덱 탭' },
      { kind: 'text', text: '에서 ' },
      { kind: 'code', text: '>>' },
      { kind: 'text', text: '를 눌러 ' },
      { kind: 'link', text: '사이트', href: 'https://example.com' },
      { kind: 'text', text: '로' },
    ]);
  });

  it('turns a repository path into a link to the public repository', () => {
    // Arrange / Act
    const tokens = parseInline('[계산 방식](docs/route-algorithm.md)');

    // Assert
    expect(tokens).toEqual([
      { kind: 'link', text: '계산 방식', href: `${REPO_FILE_BASE}docs/route-algorithm.md` },
    ]);
  });

  it.each(['javascript:alert', 'data:text/html,x', '/etc/passwd', '../secret.md', '//evil.example'])(
    'shows the text of a link to %s without the address',
    (href) => {
      // Arrange / Act
      const tokens = parseInline(`앞 [여기](${href}) 뒤`);

      // Assert
      expect(tokens).toEqual([{ kind: 'text', text: '앞 여기 뒤' }]);
    },
  );

  it('leaves unmatched marks as literal text', () => {
    // Arrange / Act
    const tokens = parseInline('**닫히지 않음 `하나 [없는](');

    // Assert
    expect(tokens).toEqual([{ kind: 'text', text: '**닫히지 않음 `하나 [없는](' }]);
  });
});

describe('linkTarget', () => {
  it('keeps an https address and an anchor on a repository path', () => {
    // Arrange / Act / Assert
    expect(linkTarget('https://yujia-cha.github.io/mirror-dungeon/')).toBe(
      'https://yujia-cha.github.io/mirror-dungeon/',
    );
    expect(linkTarget('NOTICE#삭제')).toBeNull();
    expect(linkTarget('README.md#data')).toBe(`${REPO_FILE_BASE}README.md#data`);
  });
});
