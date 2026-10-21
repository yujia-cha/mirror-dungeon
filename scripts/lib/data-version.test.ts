import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DATA_VERSION_HEX, contentFingerprint, dataVersionOf, jsonPartsUnder } from './data-version.ts';

const part = (path: string, text: string) => ({ path, text });

describe('contentFingerprint', () => {
  it('is deterministic and ignores the order the parts arrive in', () => {
    const a = [part('x', '1'), part('y', '2')];
    const b = [part('y', '2'), part('x', '1')];
    expect(contentFingerprint(a)).toBe(contentFingerprint(b));
    expect(contentFingerprint(a)).toMatch(new RegExp(`^[0-9a-f]{${DATA_VERSION_HEX}}$`));
  });

  it('separates the path from the text and one part from the next', () => {
    // Without a separator `a`+`bc` and `ab`+`c` would hash the same bytes.
    expect(contentFingerprint([part('a', 'bc')])).not.toBe(contentFingerprint([part('ab', 'c')]));
    expect(contentFingerprint([part('a', 'b'), part('c', 'd')])).not.toBe(
      contentFingerprint([part('a', 'bc'), part('', 'd')]),
    );
  });

  it('moves when a file moves between directories', () => {
    expect(contentFingerprint([part('data/raw/a.json', '{}')])).not.toBe(
      contentFingerprint([part('data/curated/a.json', '{}')]),
    );
  });
});

describe('dataVersionOf', () => {
  const inputs = [part('data/raw/static/x.json', '{"a":1}')];
  const outputs = [part('public/data/md8/gifts.json', '[]\n')];

  it('is the dungeon id, a dot and the hash', () => {
    expect(dataVersionOf(8, inputs, outputs)).toMatch(new RegExp(`^8\\.[0-9a-f]{${DATA_VERSION_HEX}}$`));
  });

  it('changes when only an output changes — a parser change with the same inputs is a new version', () => {
    const before = dataVersionOf(8, inputs, outputs);
    const after = dataVersionOf(8, inputs, [part('public/data/md8/gifts.json', '[{"id":1}]\n')]);
    expect(after).not.toBe(before);
  });

  it('changes when only an input changes — a refresh that moved raw files is a new version too', () => {
    const before = dataVersionOf(8, inputs, outputs);
    const after = dataVersionOf(8, [part('data/raw/static/x.json', '{"a":2}')], outputs);
    expect(after).not.toBe(before);
  });

  it('keeps the version when nothing changed', () => {
    expect(dataVersionOf(8, inputs, outputs)).toBe(dataVersionOf(8, [...inputs], [...outputs]));
  });
});

describe('jsonPartsUnder', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  function touch(path: string, body: string): void {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, body);
  }

  it('walks the roots in order, keys each file by its base-relative path and skips what is excluded', () => {
    dir = mkdtempSync(join(tmpdir(), 'data-version-'));
    touch(join(dir, 'raw/b.json'), '{ "k": 1 }');
    touch(join(dir, 'raw/sub/a.json'), '[1,\n 2]');
    touch(join(dir, 'raw/notes.md'), 'not json');
    touch(join(dir, 'curated/layout.json'), '{}');
    touch(join(dir, 'curated/rules.json'), '{"x":true}');

    const parts = jsonPartsUnder([join(dir, 'raw'), join(dir, 'curated'), join(dir, 'missing')], {
      base: dir,
      exclude: [join(dir, 'curated/layout.json')],
    });

    expect(parts).toEqual([
      { path: 'raw/b.json', text: '{"k":1}' },
      { path: 'raw/sub/a.json', text: '[1,2]' },
      { path: 'curated/rules.json', text: '{"x":true}' },
    ]);
  });

  it('reads reformatted JSON as the same text', () => {
    dir = mkdtempSync(join(tmpdir(), 'data-version-'));
    touch(join(dir, 'one/a.json'), '{"k": [1, 2]}');
    touch(join(dir, 'two/a.json'), '{\n  "k": [\n    1,\n    2\n  ]\n}\n');
    const [one] = jsonPartsUnder([join(dir, 'one')], { base: join(dir, 'one') });
    const [two] = jsonPartsUnder([join(dir, 'two')], { base: join(dir, 'two') });
    expect(one).toEqual(two);
  });
});
