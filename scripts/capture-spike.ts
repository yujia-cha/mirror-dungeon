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
 * fractions of the game's client area — x, y, width, height — so one set of numbers serves every
 * resolution. That is the whole image, unless the shot carries the window's title bar: then the
 * bar is found as the app finds it (M134) and every region sits below it.
 * Candidates are the whole season's gifts or packs: the worst case, before the app narrows them by
 * floor and entered pack.
 *
 * A `"kind": "screen"` item checks which screen the shot is: `expect` is a key of SCREEN_TITLES,
 * and the banner regions in TITLE_REGIONS are read unless the item gives its own. `"expect":
 * "none"` says the shot shows no screen the tracker acts on (an event, a reward picker), which is
 * as much worth checking: such a shot must not pass for an acquired popup.
 *
 * A `"kind": "floor"` item reads the floor number (`expect` a number) from the map header, where
 * 「N층 탐사 중」 sits above the entered pack's name.
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
 * `--replay` reads every shot in the folder in file-name order (Steam names them by time) as if it
 * were the live capture, folds each frame into the tracker (`trackFrame`) and prints the events —
 * labels are not needed for it.
 *
 * Flags: --dir (default local-fixtures/capture), --model best|fast (default best = best_int),
 *        --raw. (Enlarging crops 2× was tried and read worse.)
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { loadGameDataFromDisk } from '../src/core/data/node.ts';
import { matchName, type MatchResult, type NameCandidate } from '../src/app/capture/match-name.ts';
import { matchIcon, prepareSlot, rankIcons, type IconRef } from '../src/app/capture/match-icon.ts';
import type { Region } from '../src/app/capture/preprocess.ts';
import { classifyScreen, parseFloor, SCREEN_TITLES } from '../src/app/capture/screens.ts';
import { readFrame, type RegionReader } from '../src/app/capture/read-frame.ts';
import { INITIAL_TRACKER, trackFrame } from '../src/app/capture/tracker.ts';
import { captureLayoutSchema } from '../src/core/schema.ts';
import {
  clientRegion,
  decodeImage,
  loadIconRefs,
  LocalOcr,
  titleBarOf,
  type Rgba,
} from './lib/capture-local.ts';
import { flagValue, hasFlag } from './lib/io.ts';

const regionSchema = z.tuple([z.number(), z.number(), z.number(), z.number()]);
const labelsSchema = z.object({
  items: z.array(
    z.object({
      file: z.string(),
      kind: z.enum(['pack', 'gift', 'screen', 'icon', 'floor']),
      lang: z.enum(['ko', 'en']),
      expect: z.union([z.number().int(), z.string(), z.null()]),
      region: regionSchema.optional(),
    }),
  ),
});
type Label = z.infer<typeof labelsSchema>['items'][number];

/**
 * Where the game draws what is read — the same layout the app loads (`data/curated/capture-layout.json`,
 * built into public/data by `npm run data:build`).
 */
const layout = captureLayoutSchema.parse(
  JSON.parse(readFileSync(resolve('public/data/capture-layout.json'), 'utf8')),
);
const MAP_HEADER: Region = layout.names.mapHeader;
/** Every banner region, for labelled screen items that give no region of their own. */
const TITLE_REGIONS: Region[] = layout.titles.map((t) => t.region);

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

  const ocr = new LocalOcr(model);

  const images = new Map<string, { image: Rgba; top: number }>();
  /** A shot's pixels and its title bar (0 for a client-only shot), decoded once. */
  const shotOf = async (file: string): Promise<{ image: Rgba; top: number }> => {
    let shot = images.get(file);
    if (!shot) {
      const image = await decodeImage(readFileSync(resolve(dir, file)));
      shot = { image, top: titleBarOf(image) };
      images.set(file, shot);
    }
    return shot;
  };
  /** OCR the given client regions of one shot (the whole client when there are none), lines in order. */
  const read = async (
    label: Label,
    regions: readonly Region[],
    raw: boolean,
  ): Promise<{ lines: string[]; ms: number }> => {
    const { image, top } = await shotOf(label.file);
    const lines: string[] = [];
    let ms = 0;
    for (const region of regions.length > 0 ? regions : [[0, 0, 1, 1] as const]) {
      const r = await ocr.region(image, clientRegion(image, top, region), label.lang, raw);
      ms += r.ms;
      lines.push(...r.lines);
    }
    return { lines, ms };
  };

  /** Every gift's shipped icon, reduced for matching — decoded once, on the first icon item. */
  let refs: IconRef[] | null = null;
  const iconRefs = async (): Promise<IconRef[]> => {
    refs ??= await loadIconRefs(data.gifts);
    return refs;
  };

  if (hasFlag('--replay')) {
    const shots = readdirSync(dir)
      .filter((f) => /\.(jpe?g|png)$/i.test(f))
      .sort();
    const packs = candidatesFor('pack', 'ko');
    const gifts = candidatesFor('gift', 'ko');
    const giftName = (id: number) => data.gifts.find((g) => g.id === id)?.name.ko ?? String(id);
    const packName = (id: number) => data.packs.find((p) => p.id === id)?.name.ko ?? String(id);
    let state = INITIAL_TRACKER;
    let ms = 0;
    let calls = 0;
    // What the run holds so far, for the fusion confirm's slots: the gifts the replay has seen got.
    const held = new Set<number>();
    const allRefs = await iconRefs();
    const MATERIALS = new Set(data.gifts.filter((g) => g.acquisition.kind === 'material').map((g) => g.id));
    // The app looks for the run start's pickers until the start closes (M135).
    let startOpen = true;
    for (const file of shots) {
      const label: Label = { file, kind: 'screen', lang: 'ko', expect: null };
      const reader: RegionReader = {
        ocr: async (region, light) => {
          const r = await read(label, [region], rawOnly || !light);
          ms += r.ms;
          return r.lines;
        },
        slot: async (region) => {
          const { image, top } = await shotOf(file);
          return prepareSlot(image.data, image.width, image.height, clientRegion(image, top, region));
        },
      };
      const { frame, ocrCalls } = await readFrame(reader, layout, {
        lang: 'ko',
        packs,
        gifts,
        held: allRefs.filter((ref) => held.has(ref.id)),
        materials: allRefs.filter((ref) => MATERIALS.has(ref.id)),
        startOpen,
        iconRefs: async (ids) => allRefs.filter((ref) => ids.includes(ref.id)),
      });
      calls += ocrCalls;
      const out = trackFrame(state, frame);
      state = out.state;
      for (const e of out.events) {
        if (e.kind === 'got') held.add(e.giftId);
        if (e.kind === 'sold') held.delete(e.giftId);
        if (e.kind === 'fused') for (const id of e.consumed) held.delete(id);
        if (e.kind === 'startDone') startOpen = false;
      }
      const said = out.events.map((e) => {
        switch (e.kind) {
          case 'enter':
            return `ENTER ${e.floor}층 ${packName(e.packId)}`;
          case 'got':
            return `GOT ${giftName(e.giftId)}${e.source ? ` (${e.source})` : ''}`;
          case 'sold':
            return `SOLD ${giftName(e.giftId)}`;
          case 'fused':
            return `FUSED ${giftName(e.resultId)} ← ${e.consumed.map(giftName).join(', ') || '—'}${e.unsure.length ? ` (? ${e.unsure.map(giftName).join(' / ')})` : ''}`;
          case 'startDone':
            return 'START DONE';
          case 'unsure':
            return `UNSURE ${e.about} ${e.ids.map(e.about === 'enter' ? packName : giftName).join(' / ')}`;
        }
      });
      const behind = frame.overObservation ? ' [over observation]' : '';
      console.log(`${file}  ${(frame.screen ?? '—').padEnd(17)}${behind} ${said.join(' · ')}`);
    }
    await ocr.terminate();
    console.log(
      `\n${shots.length} frames, ${(calls / shots.length).toFixed(1)} OCR calls and ${Math.round(ms / shots.length)}ms OCR per frame`,
    );
    return;
  }

  const tally: Record<Outcome, number> = { correct: 0, ambiguous: 0, wrong: 0, none: 0 };
  let totalMs = 0;
  for (const label of parsed.data.items) {
    if (label.kind === 'screen') {
      if (!(typeof label.expect === 'string' && (label.expect in SCREEN_TITLES || label.expect === 'none'))) {
        fail(`${label.file}: screen must be "none" or one of ${Object.keys(SCREEN_TITLES).join(', ')}`);
      }
      const want = label.expect === 'none' ? null : label.expect;
      const regions = label.region ? [label.region] : TITLE_REGIONS;
      let { lines, ms } = await read(label, regions, rawOnly);
      let screen = classifyScreen(lines, label.lang);
      // Some titles are darker than the threshold (the map header is brown on red): read raw too.
      if (screen === null && !rawOnly) {
        const again = await read(label, regions, true);
        lines = [...lines, '‖', ...again.lines];
        ms += again.ms;
        screen = classifyScreen(again.lines, label.lang);
      }
      totalMs += ms;
      const outcome: Outcome = screen === want ? 'correct' : screen === null ? 'none' : 'wrong';
      tally[outcome] += 1;
      console.log(
        `${outcome.padEnd(9)} ${label.file}  screen ${screen ?? '—'} (want ${label.expect})  read ${JSON.stringify(lines)}  [${Math.round(ms)}ms]`,
      );
      continue;
    }

    if (label.kind === 'floor') {
      if (typeof label.expect !== 'number') fail(`${label.file}: a floor item expects a number`);
      const region = label.region ?? MAP_HEADER;
      let { lines, ms } = await read(label, [region], rawOnly);
      let floor = parseFloor(lines);
      if (floor === null && !rawOnly) {
        const again = await read(label, [region], true);
        lines = [...lines, '‖', ...again.lines];
        ms += again.ms;
        floor = parseFloor(again.lines);
      }
      totalMs += ms;
      const outcome: Outcome = floor === label.expect ? 'correct' : floor === null ? 'none' : 'wrong';
      tally[outcome] += 1;
      console.log(
        `${outcome.padEnd(9)} ${label.file}  floor ${floor ?? '—'} (want ${label.expect})  read ${JSON.stringify(lines)}  [${Math.round(ms)}ms]`,
      );
      continue;
    }

    if (label.kind === 'icon') {
      if (!label.region) fail(`${label.file}: an icon item needs its slot region`);
      const all = await iconRefs();
      const { image, top: bar } = await shotOf(label.file);
      const started = performance.now();
      const views = prepareSlot(
        image.data,
        image.width,
        image.height,
        clientRegion(image, bar, label.region),
      );
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
  await ocr.terminate();

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
