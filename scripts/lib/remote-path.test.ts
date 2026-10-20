import { describe, expect, it } from 'vitest';
import { isSafeRemotePath, SAFE_SEGMENT } from './remote-path.ts';

describe('isSafeRemotePath (M160, B3)', () => {
  it.each([
    '9207',
    'Bell of Truth',
    'Hellterfly’s Dream',
    'Hot ‘n Juicy Drumstick',
    'Virtue - Zhi (智)',
    'Late-bloomer’s Tattoo',
    'Canto_X',
    'Mr. Smiley & Co.',
    'a+b',
    'assets/gifts/9207',
  ])('accepts the names the source uses: %j', (name) => {
    expect(isSafeRemotePath(name)).toBe(true);
  });

  it.each([
    '..',
    '.',
    '...',
    '../../other/file',
    'assets/../../other',
    'a/./b',
    'a//b',
    '',
    '/abs',
    'trailing/',
    'back\\slash',
    'query?x=1',
    'frag#1',
    'percent%2e%2e',
    'colon:',
    'semi;',
    'tab\t',
    'newline\n',
  ])('refuses a name that is not a plain file name: %j', (name) => {
    expect(isSafeRemotePath(name)).toBe(false);
  });

  it('refuses a segment of dots alone even though every character is allowed', () => {
    expect(SAFE_SEGMENT.test('.')).toBe(false);
    expect(SAFE_SEGMENT.test('..')).toBe(false);
    expect(SAFE_SEGMENT.test('.hidden')).toBe(true);
    expect(SAFE_SEGMENT.test('a.b')).toBe(true);
  });
});
