/**
 * The committed gift icons (M92) against the published data: every gift of every season has its
 * icon, nothing else is there, and the set came from the commit sources.lock.json pins. The keyword
 * icons (M99) are the ten badge keywords, the pack images (M100) every pack sprite, from the same commit.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  giftIconManifestSchema,
  keywordIconManifestSchema,
  packImageManifestSchema,
} from '../src/core/schema.ts';
import { giftsAcrossSeasons, packsAcrossSeasons } from '../scripts/lib/across-seasons.ts';
import { GIFT_ICON_DIR, isWebp } from '../scripts/lib/gift-icons.ts';
import { KEYWORD_ICON_DIR, UPSTREAM_KEYWORD_FILES } from '../scripts/lib/keyword-icons.ts';
import {
  MAX_PACK_IMAGE_BYTES,
  PACK_IMAGE_DIR,
  PACK_IMAGE_QUALITY,
  PACK_IMAGE_WIDTH,
} from '../scripts/lib/pack-images.ts';

const dir = resolve(process.cwd(), GIFT_ICON_DIR);
const manifest = giftIconManifestSchema.parse(
  JSON.parse(readFileSync(resolve(dir, 'manifest.json'), 'utf8')),
);
const files = readdirSync(dir).filter((f) => f.endsWith('.webp'));
const keys = new Set(giftsAcrossSeasons(resolve(process.cwd(), 'public/data')).map((g) => g.icon));

describe('gift icons', () => {
  it('cover every gift icon key of every season, and nothing else', () => {
    expect([...manifest.icons].sort((a, b) => a - b)).toEqual([...keys].sort((a, b) => a - b));
    expect(files.map((f) => Number(f.slice(0, -5))).sort((a, b) => a - b)).toEqual(manifest.icons);
  });

  it('are WebP files', () => {
    const notWebp = files.filter((f) => !isWebp(readFileSync(resolve(dir, f))));
    expect(notWebp).toEqual([]);
  });

  it('come from the eldritchtools commit the lock file pins', () => {
    const lock = JSON.parse(readFileSync(resolve(process.cwd(), 'data/sources.lock.json'), 'utf8')) as {
      sources: { eldritchtools: { repo: string; sha: string } };
    };
    expect(manifest.source).toEqual({
      repo: lock.sources.eldritchtools.repo,
      sha: lock.sources.eldritchtools.sha,
    });
  });
});

describe('keyword icons', () => {
  const keywordDir = resolve(process.cwd(), KEYWORD_ICON_DIR);
  const keywordManifest = keywordIconManifestSchema.parse(
    JSON.parse(readFileSync(resolve(keywordDir, 'manifest.json'), 'utf8')),
  );

  it('cover every badge keyword, and nothing else', () => {
    const expected = Object.keys(UPSTREAM_KEYWORD_FILES).sort();
    expect(keywordManifest.keywords).toEqual(expected);
    const onDisk = readdirSync(keywordDir)
      .filter((f) => f.endsWith('.webp'))
      .map((f) => f.slice(0, -5))
      .sort();
    expect(onDisk).toEqual(expected);
  });

  it('are WebP files from the same pinned commit as the gift icons', () => {
    const notWebp = keywordManifest.keywords.filter(
      (k) => !isWebp(readFileSync(resolve(keywordDir, `${k}.webp`))),
    );
    expect(notWebp).toEqual([]);
    expect(keywordManifest.source).toEqual(manifest.source);
  });
});

describe('pack images (M100)', () => {
  const packDir = resolve(process.cwd(), PACK_IMAGE_DIR);
  const packManifest = packImageManifestSchema.parse(
    JSON.parse(readFileSync(resolve(packDir, 'manifest.json'), 'utf8')),
  );
  const sprites = new Set(packsAcrossSeasons(resolve(process.cwd(), 'public/data')).map((p) => p.sprite));

  it('cover every pack sprite of every season, and nothing else', () => {
    expect(packManifest.packs).toEqual([...sprites].sort());
    const onDisk = readdirSync(packDir)
      .filter((f) => f.endsWith('.webp'))
      .map((f) => f.slice(0, -5))
      .sort();
    expect(onDisk).toEqual(packManifest.packs);
  });

  it('are small WebP files, shrunk as the manifest says, from the pinned commit', () => {
    const bad = packManifest.packs.filter((sprite) => {
      const bytes = readFileSync(resolve(packDir, `${sprite}.webp`));
      return !isWebp(bytes) || bytes.length > MAX_PACK_IMAGE_BYTES;
    });
    expect(bad).toEqual([]);
    expect(packManifest.encode).toEqual({ width: PACK_IMAGE_WIDTH, quality: PACK_IMAGE_QUALITY });
    expect(packManifest.source).toEqual(manifest.source);
  });
});
