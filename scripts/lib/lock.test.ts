import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  LOCK_PATH,
  lockFilePath,
  lockLanguages,
  lockSchema,
  parseLock,
  readLock,
  type Lock,
} from './lock.ts';

const sha = (c: string): string => c.repeat(40);

const minimal = (): Lock => ({
  mirrorDungeonSeason: 8,
  sources: {
    a: {
      repo: 'owner/name',
      ref: 'main',
      sha: sha('a'),
      fetchedAt: '2026-10-17',
      remotePrefix: 'src',
      localPrefix: 'data/raw/static',
      files: ['x.json', { path: 'y.json', languages: ['KR'] }],
    },
    b: {
      repo: 'owner/other',
      languages: { KR: { ref: 'Korean', sha: sha('b') }, EN: { ref: 'English', sha: sha('c') } },
      fetchedAt: '2026-10-17',
      remotePrefix: '',
      localPrefix: 'data/raw/localize',
      files: [],
    },
  },
});

describe('lockSchema (M160, D4)', () => {
  it('accepts the committed lock', () => {
    const lock = readLock();
    expect(Object.keys(lock.sources)).toEqual(['openLethe', 'localize', 'eldritchtools']);
    expect(lock.mirrorDungeonSeason).toBe(8);
  });

  it('hands back the very object it validated, keys and order untouched', () => {
    // Arrange: a key the schema does not know, placed before the known ones.
    const raw = { $comment: 'c', extra: { keep: true }, ...minimal() };
    // Act
    const lock = parseLock(raw);
    // Assert
    expect(lock).toBe(raw);
    expect(Object.keys(lock)).toEqual(['$comment', 'extra', 'mirrorDungeonSeason', 'sources']);
    expect(JSON.stringify(lock)).toBe(JSON.stringify(raw));
  });

  it.each([
    ['a repo that is not owner/name', (l: Lock) => (l.sources['a']!.repo = '../x/y')],
    ['a repo with a path above it', (l: Lock) => (l.sources['a']!.repo = 'owner/name/..')],
    ['a short sha', (l: Lock) => (l.sources['a']!.sha = 'abc')],
    [
      'a sha in a language pin',
      (l: Lock) => ((l.sources['b']!.languages as Record<string, { sha: string }>)['KR']!.sha = 'x'),
    ],
    ['no files', (l: Lock) => delete (l.sources['a'] as { files?: unknown }).files],
    ['no sources', (l: Lock) => delete (l as { sources?: unknown }).sources],
  ])('refuses %s with the path named', (_what, mutate) => {
    const lock = minimal();
    mutate(lock);
    expect(lockSchema.safeParse(lock).success).toBe(false);
    expect(() => parseLock(lock, 'test lock')).toThrow(/test lock does not match lockSchema:\n {2}\S/);
  });

  it('reads the path of either file form and the languages of either layout', () => {
    const lock = minimal();
    expect(lock.sources['a']!.files.map(lockFilePath)).toEqual(['x.json', 'y.json']);
    expect(lockLanguages(lock.sources['a']!)).toBeNull();
    expect(lockLanguages(lock.sources['b']!)).toEqual(['KR', 'EN']);
    expect(lockLanguages({ ...lock.sources['a']!, languages: ['KR', 'EN'] })).toEqual(['KR', 'EN']);
  });

  it('LOCK_PATH is the committed file', () => {
    expect(() => JSON.parse(readFileSync(LOCK_PATH, 'utf8'))).not.toThrow();
  });
});
