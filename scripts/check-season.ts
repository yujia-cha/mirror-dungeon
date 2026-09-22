/**
 * Ask whether Mirror Dungeon has moved on without us.
 *
 *   npm run data:season-check
 *   npm run data:season-check -- --offline   skip the network, compare the vendored mirror only
 *   npm run data:season-check -- --from 6    pretend we are on 6 and look for 7 (proves the probe
 *                                            can still find something, since 7 does exist)
 *
 * This is the outward-looking canary, and the only one that can answer the question that matters:
 * **a new season is live and the app is still planning the old one.** Nothing in our own files can
 * say that. `data:validate` checks the snapshot against itself, and the rehearsal checks that the
 * turnover works — neither notices that the turnover is overdue.
 *
 * It is deliberately not part of `npm run check`: it needs the network, so it cannot be
 * deterministic. The weekly routine and the monthly workflow run it, where a person reads the
 * answer.
 *
 * **Do not wait for `data:fetch` to 404.** The three upstreams do not rename a season's files when
 * a new one lands — `EGOgift_MirrorDungeon.json`, `_2`, `_6` and `_7` all sit side by side, and
 * OpenLethe's Mirror Dungeon capture has been frozen at md7 since 2026-07-25 — so every file the
 * lock names keeps returning 200 forever. A season turnover produces no missing file at all.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { flagValue, hasFlag, readJson, repoPath } from './lib/io.ts';
import { familyOf, renameToSeason, seasonOf } from './lib/season-files.ts';
import { DERIVED_ONLY_GIFTS, DERIVED_ONLY_PACKS, derivedMdPresent, readDerivedGifts, readDerivedPacks } from './lib/derived-md.ts';
import { OUT, outPath } from './lib/out.ts';

const RAW = 'https://raw.githubusercontent.com';

interface LockSource {
  repo: string;
  ref?: string;
  sha?: string;
  languages?: Record<string, { ref: string; sha: string }>;
  remotePrefix: string;
  localPrefix: string;
  files: (string | { path: string; languages?: string[] })[];
}

interface Lock {
  mirrorDungeonSeason?: number;
  sources: Record<string, LockSource>;
}

/**
 * Which families to probe upstream.
 *
 * The localization mirror is the one that keeps up, so those four are the real signal. OpenLethe's
 * common-data is probed too and is expected to miss: its absence is what makes `data:import`
 * necessary, and seeing it confirmed beats assuming it.
 */
const PROBE_FAMILIES = new Set([
  'localize-ui',
  'localize-gift-text',
  'localize-start-buffs',
  'localize-battle-keywords',
  'common-data',
]);

interface Probe {
  label: string;
  url: string;
}

/** Where a file of the next season would live upstream, if it existed. */
function probesForNextSeason(lock: Lock, from: number, to: number): Probe[] {
  const probes: Probe[] = [];
  for (const source of Object.values(lock.sources)) {
    const perLanguage = source.languages ?? null;
    for (const entry of source.files) {
      const path = typeof entry === 'string' ? entry : entry.path;
      if (seasonOf(path) !== from) continue;
      const family = familyOf(path);
      if (!family || !PROBE_FAMILIES.has(family)) continue;
      const next = renameToSeason(path, to);
      if (!next) continue;
      if (perLanguage) {
        // Each language is its own branch, holding that language at the repo root.
        for (const [language, pin] of Object.entries(perLanguage)) {
          probes.push({
            label: `${language}/${next}`,
            url: `${RAW}/${source.repo}/${pin.ref}/${[source.remotePrefix, next].filter(Boolean).join('/')}`,
          });
        }
      } else {
        probes.push({
          label: next,
          url: `${RAW}/${source.repo}/${source.ref ?? 'main'}/${[source.remotePrefix, next].filter(Boolean).join('/')}`,
        });
      }
    }
  }
  // One probe per URL, in a stable order.
  const seen = new Set<string>();
  return probes.filter((probe) => (seen.has(probe.url) ? false : (seen.add(probe.url), true)));
}

async function exists(url: string): Promise<boolean> {
  try {
    const head = await fetch(url, { method: 'HEAD' });
    if (head.status === 200) return true;
    if (head.status === 404) return false;
    // Some proxies refuse HEAD; fall through to a GET.
  } catch {
    // Network error — treat as "cannot tell", handled by the caller through the thrown flag.
  }
  const res = await fetch(url);
  return res.status === 200;
}

/** Packs and gifts the mirror knows and the built season does not ship. */
function unshippedFromMirror(season: number): { packs: number[]; gifts: number[] } {
  if (!derivedMdPresent() || !existsSync(join(OUT, `md${season}`))) return { packs: [], gifts: [] };
  const ourPacks = new Set(
    readJson<{ id: number }[]>(outPath('packs', season)).map((pack) => pack.id),
  );
  const ourGifts = new Set(readJson<{ id: number }[]>(outPath('gifts', season)).map((gift) => gift.id));
  const allowedPacks = new Set<number>(DERIVED_ONLY_PACKS);
  const allowedGifts = new Set<number>(DERIVED_ONLY_GIFTS);
  return {
    packs: [...readDerivedPacks().keys()].filter((id) => !ourPacks.has(id) && !allowedPacks.has(id)).sort((a, b) => a - b),
    gifts: [...readDerivedGifts().keys()].filter((id) => !ourGifts.has(id) && !allowedGifts.has(id)).sort((a, b) => a - b),
  };
}

async function main(): Promise<void> {
  const offline = hasFlag('--offline');
  const lock = readJson<Lock>(repoPath('data/sources.lock.json'));
  // `--from` exists so the probe itself can be tested: pointed at a season that already shipped,
  // it must come back with hits. A canary nobody has seen sing is not a canary.
  const override = flagValue('--from');
  const from = override !== undefined ? Number(override) : lock.mirrorDungeonSeason;
  if (from === undefined || !Number.isInteger(from)) {
    console.error('data/sources.lock.json has no `mirrorDungeonSeason`; cannot tell which season we are on.');
    process.exit(1);
  }
  const to = from + 1;
  console.log(`Mirror Dungeon ${from} is what this checkout holds. Looking for ${to}.`);

  const hits: string[] = [];

  if (!offline) {
    const probes = probesForNextSeason(lock, from, to);
    console.log(`\n  upstream (${probes.length} probe(s)):`);
    for (const probe of probes) {
      let found: boolean;
      try {
        found = await exists(probe.url);
      } catch (error) {
        console.log(`    ?   ${probe.label} — ${(error as Error).message}`);
        continue;
      }
      console.log(`    ${found ? 'HIT ' : '–   '}${probe.label}`);
      if (found) hits.push(`upstream has ${probe.label}`);
    }
  } else {
    console.log('\n  upstream: skipped (--offline)');
  }

  const mirror = unshippedFromMirror(from);
  console.log('\n  derived mirror:');
  if (mirror.packs.length === 0 && mirror.gifts.length === 0) {
    console.log('    –   nothing it knows that we do not ship');
  } else {
    if (mirror.packs.length > 0) {
      console.log(`    HIT ${mirror.packs.length} pack(s) we do not ship: ${mirror.packs.join(', ')}`);
      hits.push(`the derived mirror lists ${mirror.packs.length} unshipped pack(s)`);
    }
    if (mirror.gifts.length > 0) {
      console.log(`    HIT ${mirror.gifts.length} gift(s) we do not ship: ${mirror.gifts.slice(0, 12).join(', ')}`);
      hits.push(`the derived mirror lists ${mirror.gifts.length} unshipped gift(s)`);
    }
  }

  if (hits.length === 0) {
    console.log(`\nNo sign of Mirror Dungeon ${to}. Season: MD${from} (declared ${from} / snapshot ${from} / upstream ${to} not detected).`);
    return;
  }
  console.log(`\n⚠️  Mirror Dungeon ${to} may have started:`);
  for (const hit of hits) console.log(`  - ${hit}`);
  console.log(
    '\nNext: `.claude/skills/update-game-data/SKILL.md` §3.\n' +
      `  npm run data:lock-next-season -- ${to}     name the new season's files\n` +
      '  npm run data:fetch                        bring down what the mirrors have\n' +
      '  npm run data:rehearse                     the path has been walked before; walk it again\n' +
      'The general gift pool needs an extraction from the game client — no source provides it.',
  );
  process.exitCode = 1;
}

await main();
