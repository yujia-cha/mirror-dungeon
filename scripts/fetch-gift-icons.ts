/**
 * Download the game's gift icons into public/icons/gifts/ from eldritchtools/limbus-assets.
 *
 *   npm run data:icons              download what is missing or changed, drop what no season uses
 *   npm run data:icons -- --check   report only; writes nothing
 *
 * The commit is the one `data/sources.lock.json` pins for `eldritchtools`, so the icons always match
 * the `srcPath` mapping in the vendored `data/raw/derived/eldritchtools/data/gifts.json`. Move the
 * pin with `npm run data:fetch -- --update`, rebuild, then run this.
 *
 * The keys are every gift of every season in `public/data/index.json`, so run it after
 * `data:build`. Output is deterministic: files named `{icon}.webp`, a manifest with sorted keys.
 * Why these images may ship at all is in NOTICE (the owner's decision, M92).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GiftIconManifest } from '../src/core/schema.ts';
import {
  GIFT_ICON_DIR,
  MAX_ICON_BYTES,
  giftsAcrossSeasons,
  isWebp,
  planGiftIcons,
  type DerivedGiftEntry,
} from './lib/gift-icons.ts';
import { hasFlag, readJson, repoPath, writeJsonStable } from './lib/io.ts';

const RAW = 'https://raw.githubusercontent.com';
/** Downloads in flight at once — enough to finish in seconds, few enough to be polite. */
const PARALLEL = 8;

interface Lock {
  sources: Record<string, { repo: string; sha?: string }>;
}

async function main(): Promise<void> {
  const check = hasFlag('--check');
  const pin = readJson<Lock>(repoPath('data/sources.lock.json')).sources.eldritchtools;
  if (!pin?.sha) throw new Error('data/sources.lock.json has no pinned sha for eldritchtools');
  const source = { repo: pin.repo, sha: pin.sha };

  const derived = readJson<Record<string, DerivedGiftEntry>>(
    repoPath('data/raw/derived/eldritchtools/data/gifts.json'),
  );
  const plan = planGiftIcons(giftsAcrossSeasons(repoPath('public/data')), derived);
  const dir = repoPath(GIFT_ICON_DIR);
  const manifestPath = join(dir, 'manifest.json');
  const previous = existsSync(manifestPath) ? readJson<GiftIconManifest>(manifestPath) : null;
  const sameCommit = previous?.source.sha === source.sha;

  const wanted = new Set(plan.downloads.map((d) => `${d.icon}.webp`));
  const onDisk = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.webp')) : [];
  const stale = onDisk.filter((f) => !wanted.has(f)).sort();
  // Same commit, file present: nothing upstream can have changed it.
  const todo = plan.downloads.filter((d) => !(sameCommit && onDisk.includes(`${d.icon}.webp`)));

  console.log(
    `gift icons @ ${source.repo}@${source.sha.slice(0, 8)}: ${plan.downloads.length} keys, ` +
      `${todo.length} to download, ${stale.length} to remove, ${plan.unmapped.length} unmapped`,
  );
  for (const icon of plan.unmapped)
    console.log(`  unmapped: icon ${icon} (no srcPath in the derived gifts.json)`);
  for (const file of stale) console.log(`  remove: ${file}`);
  if (check) {
    if (todo.length + stale.length + plan.unmapped.length > 0) process.exitCode = 1;
    return;
  }

  mkdirSync(dir, { recursive: true });
  const failed: string[] = [];
  const queue = [...todo];
  const worker = async (): Promise<void> => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      const path = next.remote.split('/').map(encodeURIComponent).join('/');
      const res = await fetch(`${RAW}/${source.repo}/${source.sha}/${path}`);
      const bytes = res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
      if (!bytes) failed.push(`${next.icon}: HTTP ${res.status} for ${next.remote}`);
      else if (!isWebp(bytes)) failed.push(`${next.icon}: ${next.remote} is not a WebP file`);
      else if (bytes.length > MAX_ICON_BYTES)
        failed.push(`${next.icon}: ${next.remote} is ${bytes.length} bytes`);
      else writeFileSync(join(dir, `${next.icon}.webp`), bytes);
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, worker));
  for (const file of stale) unlinkSync(join(dir, file));

  const present = readdirSync(dir)
    .filter((f) => f.endsWith('.webp'))
    .map((f) => Number(f.slice(0, -5)))
    .sort((a, b) => a - b);
  writeJsonStable(manifestPath, { source, icons: present } satisfies GiftIconManifest);
  const bytes = present.reduce((sum, icon) => sum + readFileSync(join(dir, `${icon}.webp`)).length, 0);
  console.log(`manifest.json: ${present.length} icons, ${(bytes / 1024 / 1024).toFixed(1)} MB`);

  for (const f of failed) console.log(`  failed: ${f}`);
  if (failed.length + plan.unmapped.length > 0) process.exitCode = 1;
}

await main();
