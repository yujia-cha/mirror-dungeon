/**
 * The gift grids ask for their Pretendard slices up front (M133). The browser test
 * (`e2e/font-slices.spec.ts`) proves the scroll then fetches nothing; these pin the parts that
 * would fail quietly — the family name drifting from the stylesheet, or a re-render asking again.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { newGlyphs, preloadGlyphs, TEXT_FONT_FAMILY } from '../fonts.ts';

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('preloadGlyphs', () => {
  it('asks the text family for the distinct characters, without whitespace', () => {
    const load = vi.fn(() => Promise.resolve([]));
    preloadGlyphs('잿빛 뼛가루\n잿빛', { load }, new Set());
    expect(load).toHaveBeenCalledWith(`1em "${TEXT_FONT_FAMILY}"`, '잿빛뼛가루');
  });

  it('asks only for characters it has not asked for before, and not at all when there are none', () => {
    const load = vi.fn(() => Promise.resolve([]));
    const seen = new Set<string>();
    preloadGlyphs('닳은 옷', { load }, seen);
    preloadGlyphs('닳은 옷', { load }, seen);
    preloadGlyphs('닳은 넝마', { load }, seen);
    expect(load.mock.calls.map((call) => (call as unknown[])[1])).toEqual(['닳은옷', '넝마']);
  });

  it('does nothing where the font loading API is missing (jsdom, old browsers)', () => {
    expect(() => preloadGlyphs('튿', undefined, new Set())).not.toThrow();
  });

  it('swallows a slice that fails to load: the fallback face stays, as without the call', async () => {
    const load = vi.fn(() => Promise.reject(new Error('offline')));
    preloadGlyphs('뷸', { load }, new Set());
    await Promise.resolve();
    expect(load).toHaveBeenCalledOnce();
  });

  it('newGlyphs skips what was already asked', () => {
    expect(newGlyphs('옭매듭 옭', new Set(['매']))).toBe('옭듭');
  });
});

describe('the family it names', () => {
  it('is the family pretendard.css declares, and the first one --font-sans asks for', () => {
    const faces = read('../../../assets/fonts/pretendard.css');
    const families = new Set([...faces.matchAll(/font-family:\s*'([^']+)'/g)].map((m) => m[1]));
    expect([...families]).toEqual([TEXT_FONT_FAMILY]);
    const sans = /--font-sans:\s*'([^']+)'/.exec(read('../../../index.css'));
    expect(sans?.[1]).toBe(TEXT_FONT_FAMILY);
  });

  it('is what the gift grid preloads, because its tiles are content-visibility: auto', () => {
    const grid = read('../../components/GiftGrid.tsx');
    expect(grid).toMatch(/contentVisibility: 'auto'/);
    expect(grid).toMatch(/preloadGlyphs\(/);
  });
});
