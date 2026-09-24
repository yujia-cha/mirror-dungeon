/**
 * Put hand-drawn artwork into `public/art/` and record what exists.
 *
 *   npm run art                            현황: 있는 것 / 없는 것 / 잘못된 것
 *   npm run art -- <폴더>                   미리보기 (아무것도 쓰지 않는다)
 *   npm run art -- <폴더> --write           넣고 매니페스트를 갱신한다
 *   npm run art -- <파일> --as 9088         한 장을 기프트 9088 자리에
 *   npm run art -- <파일> --as Canto_I      한 장을 팩 스프라이트 자리에
 *   npm run art -- --season 8               다른 시즌의 기프트·팩을 기준으로
 *
 * **Game artwork must never come through here.** `public/art/` is for original drawings by this
 * repository's owner — that is the only reason images can be committed at all (see NOTICE).
 *
 * Two rules borrowed from `import-static.ts`, for the same reasons:
 * - Nothing is written without `--write`; a run without it is a report.
 * - Every candidate is checked *before* a byte is written, so pointing this at the wrong folder
 *   changes nothing.
 *
 * `public/art/` is one pool for every season: a key is accepted when any season in `index.json` has
 * it (`lib/art-keys.ts`), because a frozen season stays selectable and still draws its gifts. The
 * counts below are about the season named by `--season` (default: the one the app opens).
 *
 * Filenames are keyed on `Gift.icon` and `ThemePack.sprite`, never on `Gift.id`: they differ for
 * 31 of the 446 gifts, and keying on the wrong one would silently mis-file those.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, extname, join, resolve } from 'node:path';
import type { ArtManifest, Gift, ThemePack } from '../src/core/schema.ts';
import { flagValue, hasFlag, readJson, repoPath, writeJsonStable } from './lib/io.ts';
import { matchesRatio, readPng, type PngInfo } from './lib/png.ts';
import { artKeysAcrossSeasons, type ArtKeys } from './lib/art-keys.ts';

/** Gift icons are square; pack portraits match the card (`PackCard` draws `height = size*15/8`). */
const KINDS = {
  gifts: { ratio: 1, advise: '64×64 또는 128×128', dir: 'gifts' },
  packs: { ratio: 8 / 15, advise: '256×480', dir: 'packs' },
} as const;
type Kind = keyof typeof KINDS;

/** Sizes that draw cleanly at the icon sizes the app uses. Anything else is a warning, not a refusal. */
const ADVISED: Record<Kind, readonly string[]> = {
  gifts: ['64x64', '128x128'],
  packs: ['256x480', '128x240'],
};

/** A drawing is small; anything much bigger is a mistake worth catching before it is committed. */
const MAX_BYTES = 256 * 1024;

const ART_ROOT = repoPath('public/art');

function usage(message: string): never {
  console.error(`npm run art: ${message}\n`);
  console.error('  npm run art                       현황을 본다');
  console.error('  npm run art -- <폴더> [--write]    폴더의 PNG를 이름대로 넣는다');
  console.error('  npm run art -- <파일> --as <키> [--write]   한 장을 그 키 자리에 넣는다');
  process.exit(1);
}

/**
 * The keys the chosen season has, plus every published season's (`any`), so a typo cannot create a
 * file nothing will read and a gift only a frozen season has is still accepted.
 */
function loadKeys(season: number): { gifts: Set<number>; packs: Set<string>; name: Map<string, string>; any: ArtKeys } {
  const gifts = readJson<Gift[]>(repoPath(`public/data/md${season}/gifts.json`));
  const packs = readJson<ThemePack[]>(repoPath(`public/data/md${season}/packs.json`));
  const name = new Map<string, string>();
  for (const gift of gifts) name.set(`gifts/${gift.icon}`, gift.name.ko);
  for (const pack of packs) name.set(`packs/${pack.sprite}`, pack.name.ko);
  return {
    gifts: new Set(gifts.map((g) => g.icon)),
    packs: new Set(packs.map((p) => p.sprite)),
    name,
    any: artKeysAcrossSeasons(repoPath('public/data')),
  };
}

function currentSeason(): number {
  const index = readJson<{ default: number }>(repoPath('public/data/index.json'));
  return index.default;
}

function existing(kind: Kind): string[] {
  const dir = join(ART_ROOT, KINDS[kind].dir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => extname(f).toLowerCase() === '.png')
    .map((f) => basename(f, extname(f)))
    .sort();
}

/** What a candidate file is, and whether it may be written. */
type Verdict =
  | { ok: true; kind: Kind; key: string; info: PngInfo; note?: string }
  | { ok: false; reason: string };

/** The published seasons that have this key; empty when none does. */
function seasonsOf(kind: Kind, key: string, keys: ReturnType<typeof loadKeys>): number[] {
  return (kind === 'gifts' ? keys.any.gifts.get(Number(key)) : keys.any.packs.get(key)) ?? [];
}

function judge(path: string, key: string, kind: Kind, keys: ReturnType<typeof loadKeys>): Verdict {
  const inSeason = kind === 'gifts' ? keys.gifts.has(Number(key)) : keys.packs.has(key);
  const elsewhere = seasonsOf(kind, key, keys);
  if (!inSeason && elsewhere.length === 0) {
    return { ok: false, reason: `${kind === 'gifts' ? 'icon' : 'sprite'} 「${key}」은 어느 시즌에도 없다` };
  }
  // Legal, but not what the chosen season shows — worth one word so it is not a surprise.
  const seasonNote = inSeason ? undefined : `${elsewhere.map((n) => `md${n}`).join('·')} 전용`;
  const bytes = readFileSync(path);
  if (bytes.length > MAX_BYTES) return { ok: false, reason: `${Math.round(bytes.length / 1024)}KB — ${MAX_BYTES / 1024}KB를 넘는다` };
  const png = readPng(bytes);
  if (!png.ok) return { ok: false, reason: png.reason };
  const { ratio, advise } = KINDS[kind];
  if (!matchesRatio(png.info, ratio)) {
    const shape = kind === 'gifts' ? '정사각' : '8:15 세로';
    return { ok: false, reason: `${png.info.width}×${png.info.height} — ${shape}이 아니다 (권장 ${advise})` };
  }
  const size = `${png.info.width}x${png.info.height}`;
  // Advised sizes are a nudge, not a gate: 64 and 128 are both being tried out, and the choice
  // between them should not be made by this script refusing files.
  const sizeNote = ADVISED[kind].includes(size) ? undefined : `크기 ${size} (권장 ${advise})`;
  const note = [seasonNote, sizeNote].filter(Boolean).join(', ') || undefined;
  return { ok: true, kind, key, info: png.info, ...(note ? { note } : {}) };
}

function main(): void {
  const write = hasFlag('--write');
  const as = flagValue('--as');
  const season = Number(flagValue('--season') ?? currentSeason());
  if (!Number.isInteger(season)) usage('--season은 숫자여야 한다.');
  const positional = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  // `--as 9088` and `--season 8` consume the value after them, so drop those from the positionals.
  const consumed = new Set([as, flagValue('--season')].filter((v): v is string => v !== undefined));
  const args = positional.filter((a) => !consumed.has(a));
  const source = args[0];
  const keys = loadKeys(season);

  // ---- no source: just report where we stand ------------------------------
  if (!source) {
    if (as) usage('--as는 넣을 파일과 함께 쓴다.');
    let strays = 0;
    const report = (kind: Kind, total: number, isKnown: (key: string) => boolean): string[] => {
      const have = existing(kind);
      const other = have.filter((k) => !isKnown(k));
      const unknown = other.filter((k) => seasonsOf(kind, k, keys).length === 0);
      strays += unknown.length;
      console.log(`${kind}: ${have.length - other.length}/${total}장${other.length > unknown.length ? ` (+ 다른 시즌 전용 ${other.length - unknown.length}장)` : ''}`);
      for (const k of unknown) console.log(`  ! ${k}.png — 어느 시즌의 ${kind === 'gifts' ? 'icon' : 'sprite'}에도 없다`);
      return have;
    };
    const haveGifts = report('gifts', keys.gifts.size, (k) => keys.gifts.has(Number(k)));
    report('packs', keys.packs.size, (k) => keys.packs.has(k));

    const missing = [...keys.gifts].filter((i) => !haveGifts.includes(String(i))).sort((a, b) => a - b);
    if (missing.length > 0) {
      const sample = missing.slice(0, 10);
      console.log(`\n아직 없는 기프트 ${missing.length}장 (앞 ${sample.length}개): ${sample.join(', ')}`);
    }
    console.log('\n없는 자리는 그림 없이 그려진다 — 0장이어도 사이트는 동작한다.');
    // `--write` with no source resyncs the manifest to what is on disk. That is the one remedy for
    // a drawing removed by hand, and it is the command `data:validate` points at when it finds the
    // manifest and the directory disagreeing.
    if (write) writeManifest();
    if (strays > 0) process.exitCode = 1;
    return;
  }

  // ---- gather candidates --------------------------------------------------
  const from = resolve(source);
  if (!existsSync(from)) usage(`${source}을 찾을 수 없다.`);
  const candidates: { path: string; key: string; kind: Kind }[] = [];
  const rejected: string[] = [];

  const kindOfKey = (key: string): Kind | null => {
    if (keys.gifts.has(Number(key))) return 'gifts';
    if (keys.packs.has(key)) return 'packs';
    return null;
  };

  if (as) {
    const kind = kindOfKey(as);
    if (!kind) usage(`「${as}」는 이 시즌의 기프트 icon도 팩 sprite도 아니다.`);
    candidates.push({ path: from, key: as, kind });
  } else {
    // A folder: each file is filed by its own name. `gifts/`+`packs/` subfolders are honoured, and
    // a flat folder works too because the key itself says which kind it is.
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(join(dir, e.name)) : extname(e.name).toLowerCase() === '.png' ? [join(dir, e.name)] : [],
      );
    const files = readdirSync(from, { withFileTypes: true }).length > 0 ? walk(from) : [];
    if (files.length === 0) usage(`${source}에 .png가 없다.`);
    for (const path of files) {
      const key = basename(path, extname(path));
      const kind = kindOfKey(key);
      if (!kind) {
        rejected.push(`${basename(path)} — icon도 sprite도 아닌 이름`);
        continue;
      }
      candidates.push({ path, key, kind });
    }
  }

  // ---- judge everything before writing anything ---------------------------
  const ready: { path: string; kind: Kind; key: string; note?: string }[] = [];
  const unchanged: string[] = [];
  const seen = new Map<string, string>();
  for (const c of candidates) {
    const verdict = judge(c.path, c.key, c.kind, keys);
    if (!verdict.ok) {
      rejected.push(`${c.kind}/${c.key} — ${verdict.reason}`);
      continue;
    }
    const hash = createHash('sha256').update(readFileSync(c.path)).digest('hex');
    const twin = seen.get(hash);
    if (twin) rejected.push(`${c.kind}/${c.key} — ${twin}과 같은 그림이다`);
    else seen.set(hash, `${c.kind}/${c.key}`);
    if (twin) continue;
    const dest = join(ART_ROOT, KINDS[c.kind].dir, `${c.key}.png`);
    if (existsSync(dest) && readFileSync(dest).equals(readFileSync(c.path))) {
      unchanged.push(`${c.kind}/${c.key}`);
      continue;
    }
    ready.push({ path: c.path, kind: c.kind, key: c.key, ...(verdict.note ? { note: verdict.note } : {}) });
  }

  // ---- report, and write only when asked ----------------------------------
  console.log(`${write ? '넣었다' : '넣을 것'} (${source}):`);
  for (const r of ready) {
    if (write) {
      mkdirSync(join(ART_ROOT, KINDS[r.kind].dir), { recursive: true });
      copyFileSync(r.path, join(ART_ROOT, KINDS[r.kind].dir, `${r.key}.png`));
    }
    const label = keys.name.get(`${r.kind}/${r.key}`) ?? '';
    console.log(`  ${write ? '+' : '·'} ${r.kind}/${r.key}.png ${label}${r.note ? `  (${r.note})` : ''}`);
  }
  for (const u of unchanged) console.log(`  = ${u}.png 그대로`);
  for (const r of rejected) console.log(`  ! ${r}`);

  if (write && ready.length > 0) writeManifest();
  if (!write && ready.length > 0) console.log('\n아무것도 쓰지 않았다. --write로 다시 실행하면 적용된다.');
  if (rejected.length > 0) process.exitCode = 1;
}

/** Record what exists so the app requests only files that are there — no 404 per missing drawing. */
export function writeManifest(): void {
  const manifest: ArtManifest = {
    gifts: existing('gifts')
      .map(Number)
      .filter((n) => Number.isInteger(n))
      .sort((a, b) => a - b),
    packs: existing('packs').sort(),
  };
  writeJsonStable(join(ART_ROOT, 'manifest.json'), manifest);
  console.log(`\nmanifest.json: 기프트 ${manifest.gifts.length}장 · 팩 ${manifest.packs.length}장`);
}

main();
