/**
 * The committed gift icons (M92) against the published data: every gift of every season has its
 * icon, nothing else is there, and the set came from the commit sources.lock.json pins.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { giftIconManifestSchema } from '../src/core/schema.ts';
import { GIFT_ICON_DIR, giftsAcrossSeasons, isWebp } from '../scripts/lib/gift-icons.ts';

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
