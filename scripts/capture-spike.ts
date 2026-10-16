/**
 * Screen-capture spike: how well does OCR read gift and pack names off real game screenshots?
 *
 *   npm run capture:spike                                  (reads local-fixtures/capture/labels.json)
 *   npm run capture:spike -- --dir path/to/shots --model fast --raw
 *
 * Local only. Game screenshots are Project Moon's images and are never committed — the folder is
 * gitignored. `labels.json` lists what each shot should read as:
 *
 *   { "items": [
 *       { "file": "pack-01.png", "kind": "pack", "lang": "ko", "expect": "4호선 - 제 3 구간",
 *         "region": [0.30, 0.62, 0.40, 0.08] },
 *       { "file": "gift-01.jpg", "kind": "gift", "lang": "en", "expect": 9088 },
 *       { "file": "gift-01.jpg", "kind": "screen", "lang": "ko", "expect": "acquired" } ] }
 *
 * `expect` is the name as the game shows it, or the id. `region` (optional) is the crop as
 * fractions of the image — x, y, width, height — so one set of numbers serves every resolution.
 * Candidates are the whole season's gifts or packs: the worst case, before the app narrows them by
 * floor and entered pack.
 *
 * A `"kind": "screen"` item checks which screen the shot is: `expect` is a key of SCREEN_TITLES,
 * and the banner regions in TITLE_REGIONS are read unless the item gives its own.
 *
 * A `"kind": "icon"` item asks which gift an icon slot shows (`region` = the slot, frame
 * included), against the shipped icons in public/icons/gifts. It prints the rank of the expected
 * gift among all gifts and among gifts of its tier; `"expect": null` only prints the top three,
 * for labelling by eye.
 *
 * Every crop goes through `isolateLightText` first (the app will do the same). A name that does not
 * match is read once more from the untouched crop: a few button colours tint the text below the
 * threshold. `--raw` reads only the untouched crop, to compare.
 * Shots may be PNG or JPEG (Steam saves JPEG).
 *
 * Flags: --dir (default local-fixtures/capture), --model best|fast (default best = best_int),
 *        --raw. (Enlarging crops 2× was tried and read worse.)
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import decodeWebp, { init as initWebp } from '@jsquash/webp/decode.js';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import { createWorker, type Worker } from 'tesseract.js';
import { z } from 'zod';
import { loadGameDataFromDisk } from '../src/core/data/node.ts';
import { matchName, type MatchResult, type NameCandidate } from '../src/app/capture/match-name.ts';
import {
  matchIcon,
  prepareReference,
  prepareSlot,
  rankIcons,
  type IconRef,
} from '../src/app/capture/match-icon.ts';
import { cropRgba, isolateLightText, type Region } from '../src/app/capture/preprocess.ts';
import { classifyScreen, SCREEN_TITLES } from '../src/app/capture/screens.ts';
import { flagValue, hasFlag } from './lib/io.ts';

const regionSchema = z.tuple([z.number(), z.number(), z.number(), z.number()]);
const labelsSchema = z.object({
  items: z.array(
    z.object({
      file: z.string(),
      kind: z.enum(['pack', 'gift', 'screen', 'icon']),
      lang: z.enum(['ko', 'en']),
      expect: z.union([z.number().int(), z.string(), z.null()]),
      region: regionSchema.optional(),
    }),
  ),
});
type Label = z.infer<typeof labelsSchema>['items'][number];

/**
 * Where the banners sit, measured on 1920×1009 captures: the popup title (획득), the purchase
 * dialog title, the full-screen title (판매·강화·합성·키워드 선택) and the fusion confirm line.
 */
const TITLE_REGIONS: Region[] = [
  [0.333, 0.205, 0.34, 0.07],
  [0.29, 0.19, 0.29, 0.06],
  [0.33, 0.075, 0.34, 0.09],
  [0.31, 0.69, 0.385, 0.055],
];

/** Decoded RGBA pixels of a PNG or JPEG file. */
function decode(bytes: Buffer): { data: Uint8Array; width: number; height: number } {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return jpeg.decode(bytes, { useTArray: true });
  return PNG.sync.read(bytes);
}

/** Tesseract's own 3-letter codes for the two client languages we read. */
const TESS_LANG = { ko: 'kor', en: 'eng' } as const;

const require = createRequire(import.meta.url);

/** The vendored traineddata folder for a language, from the @tesseract.js-data packages. */
function langPath(lang: Label['lang'], model: 'best' | 'fast'): string {
  const pkg = dirname(require.resolve(`@tesseract.js-data/${TESS_LANG[lang]}/package.json`));
  return resolve(pkg, model === 'best' ? '4.0.0_best_int' : '4.0.0');
}

function fail(message: string): never {
  console.error(`capture-spike: ${message}`);
  process.exit(1);
}

type Outcome = 'correct' | 'ambiguous' | 'wrong' | 'none';

function outcomeOf(result: MatchResult, expected: number): Outcome {
  if (result.status === 'none') return 'none';
  if (result.status === 'ambiguous') return result.ids.includes(expected) ? 'ambiguous' : 'wrong';
  return result.id === expected ? 'correct' : 'wrong';
}

async function main(): Promise<void> {
  const dir = resolve(flagValue('--dir') ?? 'local-fixtures/capture');
  const model = flagValue('--model') === 'fast' ? 'fast' : 'best';
  const rawOnly = hasFlag('--raw');
  const labelsFile = resolve(dir, 'labels.json');
  if (!existsSync(labelsFile)) fail(`no labels.json in ${dir} (see the header of this script)`);
  const parsed = labelsSchema.safeParse(JSON.parse(readFileSync(labelsFile, 'utf8')));
  if (!parsed.success) fail(`labels.json: ${parsed.error.message}`);

  const data = loadGameDataFromDisk();
  const candidatesFor = (kind: 'pack' | 'gift', lang: Label['lang']): NameCandidate[] =>
    (kind === 'pack' ? data.packs : data.gifts).map((x) => ({ id: x.id, name: x.name[lang] }));

  const workers = new Map<Label['lang'], Worker>();
  const workerFor = async (lang: Label['lang']): Promise<Worker> => {
    const existing = workers.get(lang);
    if (existing) return existing;
    const worker = await createWorker(TESS_LANG[lang], 1, {
      langPath: langPath(lang, model),
      gzip: true,
      // The models are already on disk; the default cache writes a copy into the working directory.
      cacheMethod: 'none',
    });
    workers.set(lang, worker);
    return worker;
  };

  const images = new Map<string, ReturnType<typeof decode>>();
  /** OCR the given regions of one shot (the whole shot when there are none), lines in order. */
  const read = async (
    label: Label,
    regions: readonly Region[],
    raw: boolean,
  ): Promise<{ lines: string[]; ms: number }> => {
    let image = images.get(label.file);
    if (!image) {
      image = decode(readFileSync(resolve(dir, label.file)));
      images.set(label.file, image);
    }
    const worker = await workerFor(label.lang);
    const lines: string[] = [];
    let ms = 0;
    for (const region of regions.length > 0 ? regions : [[0, 0, 1, 1] as const]) {
      const crop = cropRgba(image.data, image.width, image.height, region);
      const png = new PNG({ width: crop.width, height: crop.height });
      png.data = Buffer.from(raw ? crop.data : isolateLightText(crop.data));
      const started = performance.now();
      const { data: ocr } = await worker.recognize(PNG.sync.write(png));
      ms += performance.now() - started;
      lines.push(...ocr.text.split('\n').filter((line) => line.trim() !== ''));
    }
    return { lines, ms };
  };

  /** Every gift's shipped icon, reduced for matching — decoded once, on the first icon item. */
  let refs: IconRef[] | null = null;
  const iconRefs = async (): Promise<IconRef[]> => {
    if (refs) return refs;
    await initWebp(
      await WebAssembly.compile(readFileSync(require.resolve('@jsquash/webp/codec/dec/webp_dec.wasm'))),
    );
    refs = [];
    for (const gift of data.gifts) {
      const path = resolve('public/icons/gifts', `${gift.icon}.webp`);
      if (!existsSync(path)) continue;
      const bytes = readFileSync(path);
      const image = await decodeWebp(
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
      );
      refs.push(prepareReference(gift.id, image.data, image.width, image.height));
    }
    return refs;
  };

  const tally: Record<Outcome, number> = { correct: 0, ambiguous: 0, wrong: 0, none: 0 };
  let totalMs = 0;
  for (const label of parsed.data.items) {
    if (label.kind === 'screen') {
      if (!(typeof label.expect === 'string' && label.expect in SCREEN_TITLES)) {
        fail(`${label.file}: screen must be one of ${Object.keys(SCREEN_TITLES).join(', ')}`);
      }
      const { lines, ms } = await read(label, label.region ? [label.region] : TITLE_REGIONS, rawOnly);
      totalMs += ms;
      const screen = classifyScreen(lines, label.lang);
      const outcome: Outcome = screen === null ? 'none' : screen === label.expect ? 'correct' : 'wrong';
      tally[outcome] += 1;
      console.log(
        `${outcome.padEnd(9)} ${label.file}  screen ${screen ?? '—'} (want ${label.expect})  read ${JSON.stringify(lines)}  [${Math.round(ms)}ms]`,
      );
      continue;
    }

    if (label.kind === 'icon') {
      if (!label.region) fail(`${label.file}: an icon item needs its slot region`);
      const all = await iconRefs();
      let image = images.get(label.file);
      if (!image) {
        image = decode(readFileSync(resolve(dir, label.file)));
        images.set(label.file, image);
      }
      const started = performance.now();
      const views = prepareSlot(image.data, image.width, image.height, label.region);
      const ranked = rankIcons(views, all);
      const ms = performance.now() - started;
      totalMs += ms;
      const giftName = (id: number) => data.gifts.find((g) => g.id === id)?.name.ko ?? String(id);
      const top = ranked
        .slice(0, 3)
        .map(([id, s]) => `${giftName(id)} ${s.toFixed(2)}`)
        .join(' / ');
      if (label.expect === null) {
        console.log(`?         ${label.file}  top ${top}  [${Math.round(ms)}ms]`);
        continue;
      }
      const want = data.gifts.find((g) => g.id === label.expect || g.name.ko === label.expect);
      if (!want) fail(`${label.file}: no gift named or numbered ${JSON.stringify(label.expect)}`);
      const sameTier = all.filter((r) => data.gifts.find((g) => g.id === r.id)?.tier === want.tier);
      const outcome = outcomeOf(matchIcon(views, all), want.id);
      const tierOutcome = outcomeOf(matchIcon(views, sameTier), want.id);
      tally[outcome] += 1;
      const rank = ranked.findIndex(([id]) => id === want.id) + 1;
      const tierRank = rankIcons(views, sameTier).findIndex(([id]) => id === want.id) + 1;
      console.log(
        `${outcome.padEnd(9)} ${label.file}  ${want.name.ko}: rank ${rank}/${all.length}, in tier ${tierRank}/${sameTier.length} (${tierOutcome})  top ${top}  [${Math.round(ms)}ms]`,
      );
      continue;
    }
    if (label.expect === null) fail(`${label.file}: only icon items may leave expect null`);
    const candidates = candidatesFor(label.kind, label.lang);
    const expected =
      typeof label.expect === 'number' ? label.expect : candidates.find((c) => c.name === label.expect)?.id;
    if (expected === undefined || !candidates.some((c) => c.id === expected)) {
      fail(`${label.file}: no ${label.kind} named or numbered ${JSON.stringify(label.expect)}`);
    }

    const regions = label.region ? [label.region] : [];
    const first = await read(label, regions, rawOnly);
    let lines = first.lines;
    let result = matchName(lines, candidates);
    totalMs += first.ms;
    let ms = first.ms;
    if (result.status === 'none' && !rawOnly) {
      const again = await read(label, regions, true);
      lines = [...lines, '‖', ...again.lines];
      result = matchName(again.lines, candidates);
      totalMs += again.ms;
      ms += again.ms;
    }
    const outcome = outcomeOf(result, expected);
    tally[outcome] += 1;
    const name = (id: number) => candidates.find((c) => c.id === id)?.name ?? String(id);
    const answer =
      result.status === 'match'
        ? `${name(result.id)} (${result.score.toFixed(2)}, margin ${result.margin.toFixed(2)})`
        : result.status === 'ambiguous'
          ? `one of ${result.ids.map(name).join(' / ')} (${result.score.toFixed(2)})`
          : '—';
    console.log(
      `${outcome.padEnd(9)} ${label.file}  read ${JSON.stringify(lines)} → ${answer}  [${Math.round(ms)}ms]`,
    );
  }
  for (const worker of workers.values()) await worker.terminate();

  const n = parsed.data.items.length;
  const pct = (k: number) => (n === 0 ? '—' : `${((100 * k) / n).toFixed(1)}%`);
  console.log('');
  console.log(
    `model ${model}${rawOnly ? ' (raw)' : ''}, ${n} items, mean ${n === 0 ? 0 : Math.round(totalMs / n)}ms per item`,
  );
  console.log(
    `correct ${tally.correct} (${pct(tally.correct)}) · ambiguous ${tally.ambiguous} (${pct(tally.ambiguous)})`,
  );
  console.log(`wrong ${tally.wrong} (${pct(tally.wrong)}) · none ${tally.none} (${pct(tally.none)})`);
}

await main();
