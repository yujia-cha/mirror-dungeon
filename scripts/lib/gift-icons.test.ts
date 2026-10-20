import { describe, expect, it } from 'vitest';
import { isWebp, planGiftIcons } from './gift-icons.ts';

describe('planGiftIcons', () => {
  it('names each file by the gift icon key, reading the upstream file from srcPath', () => {
    // Arrange: a numbered file, a named file, and a gift whose icon key is not its id.
    const gifts = [
      { id: 9207, icon: 9207 },
      { id: 9091, icon: 9091 },
      { id: 9403, icon: 1005 },
    ];
    const derived = {
      '9207': { srcPath: '9207' },
      '9091': { srcPath: 'Bell of Truth' },
      '9403': { srcPath: 'Ebony Brooch' },
    };
    // Act
    const plan = planGiftIcons(gifts, derived);
    // Assert: ascending by icon key.
    expect(plan).toEqual({
      downloads: [
        { icon: 1005, remote: 'assets/gifts/Ebony Brooch.webp' },
        { icon: 9091, remote: 'assets/gifts/Bell of Truth.webp' },
        { icon: 9207, remote: 'assets/gifts/9207.webp' },
      ],
      unmapped: [],
    });
  });

  it('downloads a shared icon once, from the first gift that knows its file', () => {
    // Arrange: two seasons list the same gift, and a second gift shares the key without a srcPath.
    const gifts = [
      { id: 9500, icon: 9100 },
      { id: 9100, icon: 9100 },
      { id: 9100, icon: 9100 },
    ];
    const derived = { '9100': {}, '9500': { srcPath: 'Shared' } };
    // Act
    const plan = planGiftIcons(gifts, derived);
    // Assert
    expect(plan.downloads).toEqual([{ icon: 9100, remote: 'assets/gifts/Shared.webp' }]);
  });

  it('reports keys the source cannot name instead of guessing', () => {
    const plan = planGiftIcons(
      [
        { id: 1, icon: 1 },
        { id: 2, icon: 2 },
      ],
      { '1': { srcPath: '' } },
    );
    expect(plan).toEqual({ downloads: [], unmapped: [1, 2] });
  });

  it('plans nothing for no gifts', () => {
    expect(planGiftIcons([], {})).toEqual({ downloads: [], unmapped: [] });
  });
});

describe('isWebp', () => {
  const header = (riff: string, kind: string) =>
    new Uint8Array([...riff, 0, 0, 0, 0, ...kind].map((c) => (typeof c === 'string' ? c.charCodeAt(0) : c)));

  it('accepts a RIFF WEBP header', () => {
    expect(isWebp(header('RIFF', 'WEBP'))).toBe(true);
  });

  it('rejects other containers, PNG and short input', () => {
    expect(isWebp(header('RIFF', 'WAVE'))).toBe(false);
    expect(isWebp(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0, 0, 0, 0]))).toBe(false);
    expect(isWebp(new Uint8Array(11))).toBe(false);
  });
});

describe('planGiftIcons and unsafe srcPath (M160, B3)', () => {
  it('routes a srcPath that would leave the folder to unmapped instead of a download', () => {
    // Arrange: one dot path, one absolute path, one honest name.
    const gifts = [
      { id: 1, icon: 1 },
      { id: 2, icon: 2 },
      { id: 3, icon: 3 },
    ];
    const derived = {
      '1': { srcPath: '../../../../other/branch/file' },
      '2': { srcPath: '/etc/passwd' },
      '3': { srcPath: 'Hellterfly’s Dream' },
    };
    // Act
    const plan = planGiftIcons(gifts, derived);
    // Assert
    expect(plan).toEqual({
      downloads: [{ icon: 3, remote: 'assets/gifts/Hellterfly’s Dream.webp' }],
      unmapped: [1, 2],
    });
  });
});
