/**
 * Download the game images the site ships from eldritchtools/limbus-assets:
 *
 * - gift icons → public/icons/gifts/{icon}.webp (M92; the screen tracker matches fusion
 *   ingredients by them, and the gift tiles draw them since M94)
 * - keyword icons → public/icons/keywords/{Keyword}.webp (M99; the gift tile's keyword badge, and
 *   since M131 the deck's identity keywords — 탄환·혈찬 come from the upstream status icons)
 * - theme pack art → public/icons/packs/{sprite}.webp (M100; the pack cards), shrunk to 256px
 *   wide and re-encoded here, since the upstream files are three times the widest card
 *
 *   npm run data:icons              download what is missing or changed, drop what nothing uses
 *   npm run data:icons -- --check   report only; writes nothing
 *
 * The commit is the one `data/sources.lock.json` pins for `eldritchtools`, so the gift icons always
 * match the `srcPath` mapping in the vendored `data/raw/derived/eldritchtools/data/gifts.json`. Move
 * the pin with `npm run data:fetch -- --update`, rebuild, then run this.
 *
 * The gift keys are every gift of every season in `public/data/index.json`, so run it after
 * `data:build`. Output is deterministic: fixed file names, manifests with sorted keys. Each set has a
 * manifest of its own, so a takedown of one set stops one feature. Why these images may ship at all
 * is in NOTICE (the owner's decisions, M92, M99 and M100).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import decodeWebp, { init as initDecoder } from '@jsquash/webp/decode.js';
import encodeWebp, { init as initEncoder } from '@jsquash/webp/encode.js';
import type {
  GiftIconManifest,
  IconKeyword,
  KeywordIconManifest,
  PackImageManifest,
} from '../src/core/schema.ts';
import {
  GIFT_ICON_DIR,
  MAX_ICON_BYTES,
  giftsAcrossSeasons,
  isWebp,
  planGiftIcons,
  type DerivedGiftEntry,
} from './lib/gift-icons.ts';
import { KEYWORD_ICON_DIR, MAX_KEYWORD_ICON_BYTES, planKeywordIcons } from './lib/keyword-icons.ts';
import {
  MAX_PACK_IMAGE_BYTES,
  MAX_UPSTREAM_PACK_BYTES,
  PACK_IMAGE_DIR,
  PACK_IMAGE_QUALITY,
  PACK_IMAGE_WIDTH,
  downscaleRgba,
  packsAcrossSeasons,
  planPackImages,
  type DerivedPackEntry,
} from './lib/pack-images.ts';
import { hasFlag, readJson, repoPath, sortKeysDeep, writeJsonStable } from './lib/io.ts';

const RAW = 'https://raw.githubusercontent.com';
/** Downloads in flight at once — enough to finish in seconds, few enough to be polite. */
const PARALLEL = 8;

interface Lock {
  sources: Record<string, { repo: string; sha?: string }>;
}

type Source = { repo: string; sha: string };

interface IconSet {
  /** For the log. */
  label: string;
  dir: string;
  /** One file per key: saved as `{key}.webp`. */
  downloads: { key: string; remote: string }[];
  maxBytes: number;
  /** Keys that should have a file but have no upstream file to take. */
  unmapped?: string[];
  /** The manifest to write for the keys present after the sync (already sorted). */
  manifest: (present: string[]) => unknown;
  /** What to do to a downloaded file before saving it; its output is checked against `savedMaxBytes`. */
  transform?: (bytes: Uint8Array) => Promise<Uint8Array>;
  savedMaxBytes?: number;
  /**
   * How the files were made, stored in the manifest: when it changes, every file is made again
   * even if the pinned commit did not move.
   */
  encode?: unknown;
}

let codecs: Promise<void> | null = null;

/**
 * The WebP codecs, compiled once. The encoder is the SIMD build because that is the one
 * `@jsquash/webp` loads its glue for whenever the runtime supports SIMD (every Node this repository
 * runs on); passing the plain build to that glue fails.
 */
function loadCodecs(): Promise<void> {
  codecs ??= (async () => {
    const wasm = (path: string) =>
      WebAssembly.compile(readFileSync(repoPath(`node_modules/@jsquash/webp/codec/${path}`)));
    await initDecoder(await wasm('dec/webp_dec.wasm'));
    await initEncoder(await wasm('enc/webp_enc_simd.wasm'));
  })();
  return codecs;
}

/** Shrink one upstream pack image to `PACK_IMAGE_WIDTH` and re-encode it. Deterministic. */
async function shrinkPackImage(bytes: Uint8Array): Promise<Uint8Array> {
  await loadCodecs();
  const image = await decodeWebp(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  );
  const small = downscaleRgba(image, PACK_IMAGE_WIDTH);
  const data = new Uint8ClampedArray(small.data);
  const out = await encodeWebp(
    { data, width: small.width, height: small.height, colorSpace: 'srgb' } as ImageData,
    {
      quality: PACK_IMAGE_QUALITY,
    },
  );
  return new Uint8Array(out);
}

/**
 * Bring one folder in line with its plan: download what is missing (or everything when the pinned
 * commit moved), delete files no key wants, and rewrite the manifest. Returns false on any failure.
 */
async function syncSet(set: IconSet, source: Source, check: boolean): Promise<boolean> {
  const dir = repoPath(set.dir);
  const manifestPath = join(dir, 'manifest.json');
  const previous = existsSync(manifestPath)
    ? readJson<{ source?: Source; encode?: unknown }>(manifestPath)
    : null;
  const sameCommit =
    previous?.source?.sha === source.sha &&
    // The manifest is written with sorted keys, so compare it that way.
    JSON.stringify(sortKeysDeep(previous?.encode)) === JSON.stringify(sortKeysDeep(set.encode));

  const wanted = new Set(set.downloads.map((d) => `${d.key}.webp`));
  const onDisk = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.webp')) : [];
  const stale = onDisk.filter((f) => !wanted.has(f)).sort();
  // Same commit, file present: nothing upstream can have changed it.
  const todo = set.downloads.filter((d) => !(sameCommit && onDisk.includes(`${d.key}.webp`)));
  const unmapped = set.unmapped ?? [];

  console.log(
    `${set.label} @ ${source.repo}@${source.sha.slice(0, 8)}: ${set.downloads.length} keys, ` +
      `${todo.length} to download, ${stale.length} to remove, ${unmapped.length} unmapped`,
  );
  for (const key of unmapped) console.log(`  unmapped: ${key}`);
  for (const file of stale) console.log(`  remove: ${file}`);
  if (check) return todo.length + stale.length + unmapped.length === 0;

  mkdirSync(dir, { recursive: true });
  const failed: string[] = [];
  const queue = [...todo];
  const worker = async (): Promise<void> => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      const path = next.remote.split('/').map(encodeURIComponent).join('/');
      const res = await fetch(`${RAW}/${source.repo}/${source.sha}/${path}`);
      const bytes = res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
      if (!bytes) failed.push(`${next.key}: HTTP ${res.status} for ${next.remote}`);
      else if (!isWebp(bytes)) failed.push(`${next.key}: ${next.remote} is not a WebP file`);
      else if (bytes.length > set.maxBytes)
        failed.push(`${next.key}: ${next.remote} is ${bytes.length} bytes`);
      else {
        const saved = set.transform ? await set.transform(bytes) : bytes;
        if (set.savedMaxBytes && saved.length > set.savedMaxBytes)
          failed.push(`${next.key}: ${next.remote} is still ${saved.length} bytes after shrinking`);
        else writeFileSync(join(dir, `${next.key}.webp`), saved);
      }
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, worker));
  for (const file of stale) unlinkSync(join(dir, file));

  const present = readdirSync(dir)
    .filter((f) => f.endsWith('.webp'))
    .map((f) => f.slice(0, -5))
    .sort();
  writeJsonStable(manifestPath, set.manifest(present));
  const bytes = present.reduce((sum, key) => sum + readFileSync(join(dir, `${key}.webp`)).length, 0);
  console.log(`  manifest.json: ${present.length} files, ${(bytes / 1024 / 1024).toFixed(2)} MB`);

  for (const f of failed) console.log(`  failed: ${f}`);
  return failed.length + unmapped.length === 0;
}

async function main(): Promise<void> {
  const check = hasFlag('--check');
  const pin = readJson<Lock>(repoPath('data/sources.lock.json')).sources.eldritchtools;
  if (!pin?.sha) throw new Error('data/sources.lock.json has no pinned sha for eldritchtools');
  const source: Source = { repo: pin.repo, sha: pin.sha };

  const derived = readJson<Record<string, DerivedGiftEntry>>(
    repoPath('data/raw/derived/eldritchtools/data/gifts.json'),
  );
  const gifts = planGiftIcons(giftsAcrossSeasons(repoPath('public/data')), derived);

  const sets: IconSet[] = [
    {
      label: 'gift icons',
      dir: GIFT_ICON_DIR,
      downloads: gifts.downloads.map((d) => ({ key: String(d.icon), remote: d.remote })),
      maxBytes: MAX_ICON_BYTES,
      unmapped: gifts.unmapped.map((icon) => `icon ${icon} (no srcPath in the derived gifts.json)`),
      manifest: (present) =>
        ({
          source,
          icons: present.map(Number).sort((a, b) => a - b),
        }) satisfies GiftIconManifest,
    },
    {
      label: 'keyword icons',
      dir: KEYWORD_ICON_DIR,
      downloads: planKeywordIcons(),
      maxBytes: MAX_KEYWORD_ICON_BYTES,
      manifest: (present) => ({ source, keywords: present as IconKeyword[] }) satisfies KeywordIconManifest,
    },
  ];
  const derivedPacks = readJson<Record<string, DerivedPackEntry>>(
    repoPath('data/raw/derived/eldritchtools/data/md_theme_packs.json'),
  );
  const packs = planPackImages(packsAcrossSeasons(repoPath('public/data')), derivedPacks);
  const encode = { width: PACK_IMAGE_WIDTH, quality: PACK_IMAGE_QUALITY };
  sets.push({
    label: 'pack images',
    dir: PACK_IMAGE_DIR,
    downloads: packs.downloads,
    maxBytes: MAX_UPSTREAM_PACK_BYTES,
    unmapped: packs.unmapped.map(
      (sprite) => `sprite ${sprite} (no image in the derived md_theme_packs.json)`,
    ),
    transform: shrinkPackImage,
    savedMaxBytes: MAX_PACK_IMAGE_BYTES,
    encode,
    manifest: (present) => ({ source, encode, packs: present }) satisfies PackImageManifest,
  });
  let ok = true;
  for (const set of sets) ok = (await syncSet(set, source, check)) && ok;
  if (!ok) process.exitCode = 1;
}

await main();
