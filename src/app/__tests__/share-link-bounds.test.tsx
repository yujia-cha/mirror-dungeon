/**
 * M160: what a share link and a saved blob may hand the store — bounded, integer ids, options
 * that are an object — and a link that cannot be read is dropped from the address.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import lzString from 'lz-string';
import { App } from '../App.tsx';
import {
  MAX_LINK_IDS,
  MAX_SHARE_HASH,
  PERSIST_VERSION,
  appDefaultOptions,
  decodeShared,
  defaultUi,
  emptyRun,
  encodeShared,
  forgetRecipes,
  sanitizeOptions,
  sanitizePersisted,
  useApp,
} from '../store.ts';
// Namespace import so the mock factory can spread the real module.
import type * as LoadModule from '../../core/data/load.ts';

vi.mock('../../core/data/load.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof LoadModule>();
  const { loadGameDataFromDisk, readSeasonIndex } = await import('../../core/data/node.ts');
  return {
    ...actual,
    loadGameData: async (_base?: string, options?: { season?: number }) =>
      loadGameDataFromDisk(undefined, options?.season),
    loadSeasonIndex: async () => readSeasonIndex(),
    loadArtManifest: async () => null,
  };
});

const link = (payload: object): string =>
  `#s=${lzString.compressToEncodedURIComponent(JSON.stringify(payload))}`;
const plain = {
  v: 5,
  deck: [10101],
  deployed: [10101],
  wanted: [9088],
  fusionGoal: {},
  options: appDefaultOptions(),
};

beforeEach(() => {
  useApp.setState({
    deck: [],
    deployed: [],
    wanted: [],
    fusionGoal: {},
    upgrades: {},
    run: emptyRun(),
    runSnapshot: null,
    ui: defaultUi(),
    options: appDefaultOptions(),
    lang: 'ko',
    dark: true,
  });
  forgetRecipes();
  window.location.hash = '';
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('decodeShared bounds (M160)', () => {
  it('reads a hash of MAX_SHARE_HASH characters and refuses one character more', () => {
    // Arrange: a real link, padded to the bound. lz-string stops at its end-of-stream mark, so what
    // follows it is never read — which is exactly why the length has to be bounded up front.
    const real = encodeShared({
      deck: [10101],
      deployed: [10101],
      wanted: [9088],
      options: appDefaultOptions(),
    });
    const exact = real + 'A'.repeat(MAX_SHARE_HASH - real.length);
    expect(exact).toHaveLength(MAX_SHARE_HASH);
    // Act + Assert
    expect(decodeShared(exact)?.wanted).toEqual([9088]);
    expect(decodeShared(`${exact}A`)).toBeNull();
    expect(decodeShared(`#s=${'A'.repeat(MAX_SHARE_HASH - 2)}`)).toBeNull();
  });

  it('keeps positive integer ids only, each once, and at most MAX_LINK_IDS of a list', () => {
    // Arrange
    const many = Array.from({ length: MAX_LINK_IDS + 40 }, (_, i) => 9000 + i);
    const hash = link({
      ...plain,
      deck: [10101.5, -10101, 0, 'x', 10101, 10101, 10203],
      deployed: [10203, 10203, 'y'],
      wanted: [9088, 9088, 1.5, -1, 0, ...many],
    });
    // Act
    const decoded = decodeShared(hash)!;
    // Assert
    expect(decoded.deck).toEqual([10101, 10203]);
    expect(decoded.deployed).toEqual([10203]);
    expect(decoded.wanted).toHaveLength(MAX_LINK_IDS);
    expect(decoded.wanted.slice(0, 2)).toEqual([9088, 9000]);
    expect(decoded.wanted.every((id) => Number.isInteger(id) && id > 0)).toBe(true);
  });

  it('plans a link whose options are no object with the defaults, quietly', () => {
    for (const options of ['abc', 42, ['x'], null, true]) {
      const decoded = decodeShared(link({ ...plain, options }));
      expect(decoded?.wanted).toEqual([9088]);
      expect(decoded?.options).toEqual(appDefaultOptions());
    }
  });
});

describe('sanitizeOptions (M160)', () => {
  it('falls back to the defaults for anything that is not an object, without throwing', () => {
    for (const raw of ['abc', 42, ['x'], true]) expect(sanitizeOptions(raw)).toEqual(appDefaultOptions());
  });

  it('keeps assumeUnvisitedPacks only as a boolean and observedGifts as positive integers, once each', () => {
    expect(sanitizeOptions({ assumeUnvisitedPacks: 'yes' }).assumeUnvisitedPacks).toBe(false);
    expect(sanitizeOptions({ assumeUnvisitedPacks: true }).assumeUnvisitedPacks).toBe(true);
    expect(sanitizeOptions({ observedGifts: [9088, 9088, 1.5, -3, 0, 'a', 9230] }).observedGifts).toEqual([
      9088, 9230,
    ]);
    expect(sanitizeOptions({ observedGifts: 'nope' }).observedGifts).toEqual([]);
  });

  it('keeps the rest of a saved blob whose options are a string', () => {
    const saved = sanitizePersisted({ deck: [10101], wanted: [9088], options: 'abc' }, PERSIST_VERSION);
    expect(saved.deck).toEqual([10101]);
    expect(saved.wanted).toEqual([9088]);
    expect(saved.options).toEqual(appDefaultOptions());
  });
});

describe('a share link that cannot be read (M160)', () => {
  it('is dropped from the address on the first render, so a reload does not try it again', async () => {
    window.location.hash = '#s=zzzznotalink';
    render(<App />);
    expect(await screen.findByText('공유 링크를 읽지 못했습니다')).toBeInTheDocument();
    expect(window.location.hash).toBe('');
  });

  it('is dropped when it arrives as a hash change, while a hash that is no link stays', async () => {
    render(<App />);
    window.location.hash = '#s=zzzznotalink';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await waitFor(() => expect(screen.getByText('공유 링크를 읽지 못했습니다')).toBeInTheDocument());
    expect(window.location.hash).toBe('');
    window.location.hash = '#other';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(window.location.hash).toBe('#other');
  });

  it('still applies a link it can read, and drops that one too', async () => {
    window.location.hash = encodeShared({
      deck: [10101],
      deployed: [10101],
      wanted: [9283],
      options: appDefaultOptions(),
    });
    render(<App />);
    await waitFor(() => expect(useApp.getState().wanted).toEqual([9283]));
    expect(window.location.hash).toBe('');
  });
});
