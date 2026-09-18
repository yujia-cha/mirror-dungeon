/**
 * How a tile decides where its picture comes from. The three stages matter because getting them
 * wrong fails quietly: a bare `/art/...` 404s only on the deployed sub-path, and an optimistic
 * request for art that is not there means hundreds of 404s while the 558 slots are still filling.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { giftIconUrl, packImageUrl, setArtManifest } from '../assets.ts';

afterEach(() => setArtManifest(null));

describe('with no art and no asset host', () => {
  it('returns nothing, so the tile is drawn without a picture', () => {
    setArtManifest(null);
    expect(giftIconUrl(9088)).toBeNull();
    expect(packImageUrl('Canto_I')).toBeNull();
  });
});

describe('with local art', () => {
  it('serves only what the manifest lists, so a missing drawing is never requested', () => {
    setArtManifest({ gifts: [9088], packs: ['Canto_I'] });
    expect(giftIconUrl(9088)).toBe('/art/gifts/9088.png');
    expect(packImageUrl('Canto_I')).toBe('/art/packs/Canto_I.png');
    // Not listed: no request at all rather than a 404 per tile.
    expect(giftIconUrl(9089)).toBeNull();
    expect(packImageUrl('Canto_II')).toBeNull();
  });

  it('carries BASE_URL, because GitHub Pages serves the site from a sub-path', () => {
    // `import.meta.env.BASE_URL` is '/' under vitest; the assertion that matters is that the URL
    // is relative to it rather than an absolute '/art/...' baked at build time.
    setArtManifest({ gifts: [9088], packs: [] });
    expect(giftIconUrl(9088)).toBe(`${import.meta.env.BASE_URL}art/gifts/9088.png`);
  });

  it('keys gifts on `icon`, which differs from `id` for 31 of the 446', () => {
    // 흑단 브로치 is id 9403 / icon 1005 — keying on the id would look for the wrong file.
    setArtManifest({ gifts: [1005], packs: [] });
    expect(giftIconUrl(1005)).toContain('art/gifts/1005.png');
    expect(giftIconUrl(9403)).toBeNull();
  });

  it('escapes a pack sprite so an odd character cannot break the path', () => {
    setArtManifest({ gifts: [], packs: ['A B/C'] });
    expect(packImageUrl('A B/C')).toContain('art/packs/A%20B%2FC.png');
  });
});
