/**
 * How a tile decides where its picture comes from. The three stages matter because getting them
 * wrong fails quietly: a bare `/art/...` 404s only on the deployed sub-path, and an optimistic
 * request for art that is not there means hundreds of 404s while the 558 slots are still filling.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  giftIconUrl,
  keywordIconUrl,
  packImage,
  setArtManifest,
  setGiftIconManifest,
  setKeywordIconManifest,
  setPackImageManifest,
} from '../assets.ts';

afterEach(() => {
  setArtManifest(null);
  setGiftIconManifest(null);
  setKeywordIconManifest(null);
  setPackImageManifest(null);
});

describe('with no art and no asset host', () => {
  it('returns nothing, so the tile is drawn without a picture', () => {
    setArtManifest(null);
    expect(giftIconUrl(9088)).toBeNull();
    expect(packImage('Canto_I')).toBeNull();
  });
});

describe('with local art', () => {
  it('serves only what the manifest lists, so a missing drawing is never requested', () => {
    setArtManifest({ gifts: [9088], packs: ['Canto_I'] });
    expect(giftIconUrl(9088)).toEqual({ url: '/art/gifts/9088.png', pixelArt: true });
    expect(packImage('Canto_I')).toEqual({ url: '/art/packs/Canto_I.png', pixelArt: true });
    // Not listed: no request at all rather than a 404 per tile.
    expect(giftIconUrl(9089)).toBeNull();
    expect(packImage('Canto_II')).toBeNull();
  });

  it('carries BASE_URL, because GitHub Pages serves the site from a sub-path', () => {
    // `import.meta.env.BASE_URL` is '/' under vitest; the assertion that matters is that the URL
    // is relative to it rather than an absolute '/art/...' baked at build time.
    setArtManifest({ gifts: [9088], packs: [] });
    expect(giftIconUrl(9088)?.url).toBe(`${import.meta.env.BASE_URL}art/gifts/9088.png`);
  });

  it('keys gifts on `icon`, which differs from `id` for 31 of the 446', () => {
    // 흑단 브로치 is id 9403 / icon 1005 — keying on the id would look for the wrong file.
    setArtManifest({ gifts: [1005], packs: [] });
    expect(giftIconUrl(1005)?.url).toContain('art/gifts/1005.png');
    expect(giftIconUrl(9403)).toBeNull();
  });

  it('escapes a pack sprite so an odd character cannot break the path', () => {
    setArtManifest({ gifts: [], packs: ['A B/C'] });
    expect(packImage('A B/C')?.url).toContain('art/packs/A%20B%2FC.png');
  });
});

describe('with the game gift icons (M94)', () => {
  const icons = (list: number[]) => ({
    source: { repo: 'eldritchtools/limbus-assets', sha: 'abc' },
    icons: list,
  });

  it('serves a listed icon as WebP under BASE_URL, scaled smoothly', () => {
    // Arrange
    setGiftIconManifest(icons([9088]));
    // Act
    const picture = giftIconUrl(9088);
    // Assert
    expect(picture).toEqual({ url: `${import.meta.env.BASE_URL}icons/gifts/9088.webp`, pixelArt: false });
  });

  it('requests nothing for an icon the manifest does not list', () => {
    setGiftIconManifest(icons([9088]));
    expect(giftIconUrl(9089)).toBeNull();
  });

  it("lets the owner's drawing win over the game icon", () => {
    setGiftIconManifest(icons([9088]));
    setArtManifest({ gifts: [9088], packs: [] });
    expect(giftIconUrl(9088)).toEqual({ url: '/art/gifts/9088.png', pixelArt: true });
  });

  it('does not make the gift icon set a source of pack art', () => {
    setGiftIconManifest(icons([9088]));
    expect(packImage('Canto_I')).toBeNull();
  });
});

describe('with the game pack art (M100)', () => {
  const packs = (keys: string[]) => ({
    source: { repo: 'r', sha: 's' },
    encode: { width: 256, quality: 75 },
    packs: keys,
  });

  it('serves a listed sprite from public/icons/packs, painted (not pixelated)', () => {
    // Arrange
    setPackImageManifest(packs(['Canto_I']));
    // Act
    const picture = packImage('Canto_I');
    // Assert
    expect(picture).toEqual({ url: `${import.meta.env.BASE_URL}icons/packs/Canto_I.webp`, pixelArt: false });
    expect(packImage('Canto_II')).toBeNull();
  });

  it("lets the owner's drawing win over the game art", () => {
    setPackImageManifest(packs(['Canto_I']));
    setArtManifest({ gifts: [], packs: ['Canto_I'] });
    expect(packImage('Canto_I')).toEqual({ url: '/art/packs/Canto_I.png', pixelArt: true });
  });
});

describe('keyword icons (M99)', () => {
  it('serves a listed keyword from public/icons/keywords under the base path', () => {
    // Arrange
    setKeywordIconManifest({ source: { repo: 'r', sha: 's' }, keywords: ['Combustion', 'Slash'] });
    // Act + Assert
    expect(keywordIconUrl('Slash')).toBe(`${import.meta.env.BASE_URL}icons/keywords/Slash.webp`);
  });

  it('requests nothing for a keyword the manifest does not list, or with no manifest', () => {
    setKeywordIconManifest({ source: { repo: 'r', sha: 's' }, keywords: ['Combustion'] });
    expect(keywordIconUrl('Sinking')).toBeNull();
    expect(keywordIconUrl('None')).toBeNull();
    setKeywordIconManifest(null);
    expect(keywordIconUrl('Combustion')).toBeNull();
  });
});
