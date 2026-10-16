/**
 * How each read interval does on a real run of screens (M108).
 *
 *   npm run capture:bench
 *   npm run capture:bench -- --dir path/to/shots --dwell steam,300,600,1000,2000 --max-dwell 10000
 *
 * Local only: the shots are Project Moon's images in the gitignored `local-fixtures/capture/`, in
 * game order (Steam names them by time). Each shot stands for the screen from when it was taken
 * until the next one (`steam`, capped at --max-dwell — a battle between two shots is not one of
 * them), or for a fixed dwell in ms, to find how short a screen each interval still catches.
 *
 * 1. Every shot is read once, in order, with the real OCR: that is the reference run, and its OCR
 *    results and times are cached per shot and region (OCR on the same pixels is deterministic).
 * 2. For each timeline and preset, the loop runs on a simulated clock (`lib/capture-bench.ts`): a
 *    signature every tick, `decide`, a read that stays busy as long as its OCR took, events when
 *    it ends. The reads come from the cache, so this costs no OCR.
 * 3. Each run's events are compared with the reference: missed, extra, and the latency from the
 *    screen appearing to the record.
 *
 * The change detection is timed for real on the 480-px preview the browser takes the signature on
 * (the browser's draw onto that canvas is GPU work this cannot time). OCR time is Node's — the
 * browser runs the same WebAssembly in a worker, off the page's thread.
 *
 * Flags: --dir (default local-fixtures/capture), --dwell (default steam,300,600,1000,2000),
 *        --max-dwell (default 10000), --model best|fast (default best).
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { signatureOf, watchedRegions } from '../src/app/capture/change.ts';
import { READ_INTERVALS, type ReadIntervalPreset } from '../src/app/capture/loop.ts';
import type { IconRef } from '../src/app/capture/match-icon.ts';
import { prepareSlot } from '../src/app/capture/match-icon.ts';
import type { NameCandidate } from '../src/app/capture/match-name.ts';
import type { Region } from '../src/app/capture/preprocess.ts';
import { readFrame, type RegionReader } from '../src/app/capture/read-frame.ts';
import { classifyScreen } from '../src/app/capture/screens.ts';
import type { CaptureEvent } from '../src/app/capture/tracker.ts';
import { INITIAL_TRACKER, trackFrame } from '../src/app/capture/tracker.ts';
import { loadGameDataFromDisk } from '../src/core/data/node.ts';
import { captureLayoutSchema } from '../src/core/schema.ts';
import {
  compareEvents,
  downscale,
  foldHeld,
  latencies,
  simulate,
  steamShotTime,
  timelineOf,
  type ShotRead,
  type SimulateResult,
} from './lib/capture-bench.ts';
import { decodeImage, loadIconRefs, LocalOcr, type OcrModel, type Rgba } from './lib/capture-local.ts';
import { flagValue } from './lib/io.ts';

/** The preview width the browser session takes signatures on (`session.ts`). */
const PREVIEW_WIDTH = 480;
/** The time between Steam shots that have no time in their name. */
const UNKNOWN_GAP_MS = 2000;
/** Timer phases, as fractions of the interval, each run is averaged over. */
const PHASES = [0.1, 0.35, 0.6, 0.85];

function fail(message: string): never {
  console.error(`capture-bench: ${message}`);
  process.exit(1);
}

/** A signature that differs from the shot's own on every tick, by more than the change threshold. */
function animatedSignature(base: Uint8Array, t: number): Uint8Array {
  const out = new Uint8Array(base);
  out[0] = (base[0]! + 64 + (Math.floor(t) % 128)) % 256;
  out.fill(out[0]!, 0, 128);
  return out;
}

function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!;
}

async function main(): Promise<void> {
  const dir = resolve(flagValue('--dir') ?? 'local-fixtures/capture');
  const model: OcrModel = flagValue('--model') === 'fast' ? 'fast' : 'best';
  const maxDwellMs = Number(flagValue('--max-dwell') ?? 10_000);
  const dwells = (flagValue('--dwell') ?? 'steam,animated,300,600,1000,2000').split(',').map((d) => d.trim());
  if (!existsSync(dir)) fail(`no folder ${dir}`);
  const files = readdirSync(dir)
    .filter((f) => /\.(jpe?g|png)$/i.test(f))
    .sort();
  if (files.length === 0) fail(`no shots in ${dir}`);

  const layout = captureLayoutSchema.parse(
    JSON.parse(readFileSync(resolve('public/data/capture-layout.json'), 'utf8')),
  );
  const regions = watchedRegions(layout);
  const data = loadGameDataFromDisk();
  const packs: NameCandidate[] = data.packs.map((p) => ({ id: p.id, name: p.name.ko }));
  const gifts: NameCandidate[] = data.gifts.map((g) => ({ id: g.id, name: g.name.ko }));
  const refs = await loadIconRefs(data.gifts);
  const refById = new Map(refs.map((r) => [r.id, r]));
  const materials = data.gifts
    .filter((g) => g.acquisition.kind === 'material')
    .map((g) => refById.get(g.id))
    .filter((r): r is IconRef => r !== undefined);
  const ocr = new LocalOcr(model);

  // Pixels are decoded one shot at a time (94 full-size frames would not fit); what a read needs
  // later is cached by key instead.
  let decoded: { shot: number; image: Rgba } | null = null;
  const imageOf = (shot: number): Rgba => {
    if (decoded?.shot !== shot)
      decoded = { shot, image: decodeImage(readFileSync(resolve(dir, files[shot]!))) };
    return decoded.image;
  };
  const ocrCache = new Map<string, { lines: string[]; ms: number }>();
  const slotCache = new Map<string, Float32Array[]>();
  const readerFor = (shot: number, cost: { ms: number }): RegionReader => ({
    ocr: async (region: Region, light: boolean) => {
      const key = `${shot}|${region.join(',')}|${light}`;
      let hit = ocrCache.get(key);
      if (!hit) {
        hit = await ocr.region(imageOf(shot), region, 'ko', !light);
        ocrCache.set(key, hit);
      }
      cost.ms += hit.ms;
      return hit.lines;
    },
    slot: async (region: Region) => {
      const key = `${shot}|${region.join(',')}`;
      let hit = slotCache.get(key);
      if (!hit) {
        hit = prepareSlot(imageOf(shot).data, imageOf(shot).width, imageOf(shot).height, region);
        slotCache.set(key, hit);
      }
      return hit;
    },
  });
  const readShot = async (shot: number, held: ReadonlySet<number>): Promise<ShotRead> => {
    const cost = { ms: 0 };
    const { frame, ocrCalls } = await readFrame(readerFor(shot, cost), layout, {
      lang: 'ko',
      packs,
      gifts,
      held: [...held].map((id) => refById.get(id)).filter((r): r is IconRef => r !== undefined),
      materials,
    });
    return { frame, ms: cost.ms, ocrCalls };
  };

  // 1. Signatures (timed) and the reference run: every shot read once, in order.
  const signatures: Uint8Array[] = [];
  const signatureMs: number[] = [];
  const reference: CaptureEvent[] = [];
  const readMs: number[] = [];
  /** What screen each shot is, as the reference read it. */
  const screens: (string | null)[] = [];
  let tracker = INITIAL_TRACKER;
  const held = new Set<number>();
  for (let shot = 0; shot < files.length; shot++) {
    const image = imageOf(shot);
    const preview = downscale(image.data, image.width, image.height, PREVIEW_WIDTH);
    const started = performance.now();
    const ROUNDS = 20;
    let sig = signatureOf(preview.data, preview.width, preview.height, regions);
    for (let i = 1; i < ROUNDS; i++) sig = signatureOf(preview.data, preview.width, preview.height, regions);
    signatureMs.push((performance.now() - started) / ROUNDS);
    signatures.push(sig);
    const read = await readShot(shot, held);
    readMs.push(read.ms);
    screens.push(read.frame.screen);
    const folded = trackFrame(tracker, read.frame);
    tracker = folded.state;
    for (const event of folded.events) {
      foldHeld(held, event);
      reference.push(event);
    }
    process.stderr.write(`\rreference ${shot + 1}/${files.length}`);
  }
  process.stderr.write('\n');
  await ocr.terminate();

  // Which title regions ever needed the raw pass: the light pass found no screen there and the raw
  // one did. A region that never does could skip its raw read on frames that show nothing.
  const rawNeeded = new Map<number, string[]>();
  layout.titles.forEach((title, index) => {
    for (let shot = 0; shot < files.length; shot++) {
      const light = ocrCache.get(`${shot}|${title.region.join(',')}|true`);
      const raw = ocrCache.get(`${shot}|${title.region.join(',')}|false`);
      if (!light || !raw) continue;
      const found = (lines: string[]) => {
        const s = classifyScreen(lines, 'ko');
        return s !== null && title.screens.includes(s) ? s : null;
      };
      const viaRaw = found(light.lines) === null ? found(raw.lines) : null;
      if (viaRaw) rawNeeded.set(index, [...(rawNeeded.get(index) ?? []), `${files[shot]} ${viaRaw}`]);
    }
  });

  const times = files.map((f, i) => steamShotTime(f) ?? i * UNKNOWN_GAP_MS);
  const presets = Object.keys(READ_INTERVALS) as ReadIntervalPreset[];
  const meanSig = signatureMs.reduce((a, b) => a + b, 0) / signatureMs.length;

  console.log(`# capture:bench — ${files.length} shots, model ${model}`);
  console.log('');
  console.log(
    `- change detection (signature on the ${PREVIEW_WIDTH}px preview): ${meanSig.toFixed(3)} ms per tick`,
  );
  console.log(
    `- one read (OCR, cached from the reference run): median ${Math.round(percentile(readMs, 50))} ms, p95 ${Math.round(percentile(readMs, 95))} ms, max ${Math.round(Math.max(...readMs))} ms`,
  );
  console.log(`- reference events: ${reference.length}`);
  layout.titles.forEach((title, index) => {
    const hits = rawNeeded.get(index) ?? [];
    console.log(
      `- title region ${index} (${title.screens.join('/')}): found only by the raw pass on ${hits.length} shot(s)${hits.length ? ` — ${hits.join(', ')}` : ''}`,
    );
  });
  console.log('');
  console.log(
    `Each row is the mean of ${PHASES.length} timer phases; missed and extra are events against the reference.`,
  );
  console.log('');
  console.log(
    '| dwell | preset | interval | ticks | reads | OCR calls | OCR busy | missed | extra | latency median / p95 |',
  );
  console.log('|---|---|---|---|---|---|---|---|---|---|');
  const missedBy = new Map<string, string[]>();
  for (const dwell of dwells) {
    const timeline =
      dwell === 'steam' || dwell === 'animated'
        ? timelineOf(times, { maxDwellMs })
        : timelineOf(times, { dwellMs: Number(dwell), maxDwellMs });
    // `animated`: the steam timeline, but every screen the tracker does not act on (battle, events,
    // the reward pickers) moves on every tick — the worst case for a loop that reads on change.
    const signatureAt =
      dwell === 'animated'
        ? (shot: number, t: number) =>
            screens[shot] === null ? animatedSignature(signatures[shot]!, t) : signatures[shot]!
        : (shot: number) => signatures[shot]!;
    for (const preset of presets) {
      const intervalMs = READ_INTERVALS[preset];
      // Shots are timed to the second, so a tick at a whole multiple of the interval would land
      // on every screen's first moment. The timer's phase is arbitrary: average a few.
      const runs: { run: SimulateResult; missed: string[]; extra: string[]; lat: number[] }[] = [];
      for (const phase of PHASES) {
        const run = await simulate({
          intervalMs,
          firstTickMs: phase * intervalMs,
          timeline,
          signature: signatureAt,
          read: readShot,
        });
        const { missed, extra } = compareEvents(
          reference,
          run.events.map((e) => e.event),
        );
        runs.push({ run, missed, extra, lat: latencies(run.events, timeline) });
      }
      const mean = (f: (r: (typeof runs)[number]) => number): number =>
        runs.reduce((a, r) => a + f(r), 0) / runs.length;
      const missed = runs.flatMap((r) => r.missed);
      if (missed.length > 0) missedBy.set(`${dwell} ${preset}`, [...new Set(missed)].sort());
      const lat = runs.flatMap((r) => r.lat);
      const busy = mean((r) => (r.run.durationMs > 0 ? (100 * r.run.ocrMs) / r.run.durationMs : 0));
      console.log(
        `| ${dwell === 'steam' || dwell === 'animated' ? `${dwell} (≤${maxDwellMs / 1000}s)` : `${dwell}ms`} | ${preset} | ${intervalMs}ms | ${Math.round(mean((r) => r.run.ticks))} | ${Math.round(mean((r) => r.run.reads))} | ${Math.round(mean((r) => r.run.ocrCalls))} | ${busy.toFixed(1)}% | ${mean((r) => r.missed.length).toFixed(1)} | ${mean((r) => r.extra.length).toFixed(1)} | ${Math.round(percentile(lat, 50))} / ${Math.round(percentile(lat, 95))} ms |`,
      );
    }
  }
  if (missedBy.size > 0) {
    console.log('');
    console.log('Missed (in any phase):');
    for (const [run, keys] of missedBy) console.log(`- ${run}: ${keys.join(', ')}`);
  }
}

await main();
