/**
 * Read back an owner's diagnostics export (M113).
 *
 *   npm run capture:feedback -- path/to/md-diagnostics-20261016-1430.zip
 *   npm run capture:feedback -- local-fixtures/sessions/<id> --reread
 *
 * A zip is unpacked into `local-fixtures/sessions/<bundleId>/` (gitignored: the frames are game
 * screens and are never committed), then the folder gets:
 *
 * - `report.md`: what the reader read, what it got wrong (undone) and missed (changed by hand
 *   while reading), with the OCR lines and the frames for each; and how the route compared with
 *   the run — floors where the player went elsewhere, gifts the route expected and the pack did
 *   not give.
 * - `labels.json` (certain — frames a question's answer settled) and `labels-unconfirmed.json`
 *   (events the player let stand), in the spike's format, so `npm run capture:spike -- --dir
 *   <folder>` measures the current reading against a real run.
 *
 * `--reread` reads every kept frame again with today's `readFrame` and lists where it now reads
 * differently from what was recorded — the regression check after changing the reader. The
 * fusion confirm's slots are matched against the materials only (the run's holdings at the time
 * are not in the bundle).
 *
 * Local only.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { unzipSync } from 'fflate';
import { prepareSlot, type IconRef } from '../src/app/capture/match-icon.ts';
import type { NameCandidate } from '../src/app/capture/match-name.ts';
import { readFrame, type RegionReader } from '../src/app/capture/read-frame.ts';
import { loadGameDataFromDisk } from '../src/core/data/node.ts';
import { captureLayoutSchema } from '../src/core/schema.ts';
import { decodeImage, loadIconRefs, LocalOcr } from './lib/capture-local.ts';
import {
  formatReport,
  labelsFrom,
  parseBundle,
  recognitionReport,
  routeReport,
} from './lib/capture-feedback.ts';
import { hasFlag } from './lib/io.ts';

function fail(message: string): never {
  console.error(`capture-feedback: ${message}`);
  process.exit(1);
}

/** Every file of a folder, keyed by its path inside it (the shape `unzipSync` gives). */
function readFolder(dir: string): Record<string, Uint8Array> {
  const files: Record<string, Uint8Array> = {};
  const session = join(dir, 'session.json');
  if (!existsSync(session)) fail(`no session.json in ${dir}`);
  files['session.json'] = readFileSync(session);
  const frames = join(dir, 'frames');
  if (existsSync(frames))
    for (const name of readdirSync(frames)) files[`frames/${name}`] = readFileSync(join(frames, name));
  return files;
}

async function main(): Promise<void> {
  const arg = process.argv.slice(2).find((a) => !a.startsWith('--'));
  if (!arg) fail('give the exported zip or an unpacked folder');
  const path = resolve(arg);
  if (!existsSync(path)) fail(`no such file or folder: ${path}`);

  let dir: string;
  let files: Record<string, Uint8Array>;
  if (statSync(path).isDirectory()) {
    dir = path;
    files = readFolder(dir);
  } else {
    files = unzipSync(new Uint8Array(readFileSync(path)));
    const { bundle } = parseBundle(files);
    dir = resolve('local-fixtures/sessions', bundle.bundleId);
    mkdirSync(join(dir, 'frames'), { recursive: true });
    for (const [name, bytes] of Object.entries(files)) writeFileSync(join(dir, name), bytes);
    console.log(`unpacked ${basename(path)} → ${dir}`);
  }
  const { bundle, frames } = parseBundle(files);

  const data = loadGameDataFromDisk();
  const layout = captureLayoutSchema.parse(
    JSON.parse(readFileSync(resolve('public/data/capture-layout.json'), 'utf8')),
  );
  const giftById = new Map(data.gifts.map((g) => [g.id, g]));
  const packById = new Map(data.packs.map((p) => [p.id, p]));
  const name = {
    gift: (id: number) => giftById.get(id)?.name.ko ?? String(id),
    pack: (id: number) => packById.get(id)?.name.ko ?? String(id),
  };

  const rec = recognitionReport(bundle);
  const route = routeReport(bundle, (id) => giftById.get(id)?.acquisition.kind ?? 'unknown');
  const labels = labelsFrom(bundle, layout);
  writeFileSync(join(dir, 'labels.json'), `${JSON.stringify({ items: labels.certain }, null, 2)}\n`);
  writeFileSync(
    join(dir, 'labels-unconfirmed.json'),
    `${JSON.stringify({ items: labels.unconfirmed }, null, 2)}\n`,
  );
  const report = formatReport(
    bundle,
    rec,
    route,
    { certain: labels.certain.length, unconfirmed: labels.unconfirmed.length },
    name,
  );
  writeFileSync(join(dir, 'report.md'), report);
  console.log(report);
  console.log(`wrote ${join(dir, 'report.md')}, labels.json, labels-unconfirmed.json`);

  if (!hasFlag('--reread')) return;
  const lang = bundle.records.findLast((r) => r.kind === 'session')?.lang ?? 'ko';
  const packs: NameCandidate[] = data.packs.map((p) => ({ id: p.id, name: p.name[lang] }));
  const gifts: NameCandidate[] = data.gifts.map((g) => ({ id: g.id, name: g.name[lang] }));
  const refs = await loadIconRefs(data.gifts);
  const materialIds = new Set(data.gifts.filter((g) => g.acquisition.kind === 'material').map((g) => g.id));
  const materials: IconRef[] = refs.filter((r) => materialIds.has(r.id));
  const ocr = new LocalOcr('best');
  let compared = 0;
  const changed: string[] = [];
  for (const read of bundle.records) {
    if (read.kind !== 'read' || !read.frameId) continue;
    const bytes = frames.get(read.frameId);
    if (!bytes) continue;
    const image = decodeImage(Buffer.from(bytes));
    const reader: RegionReader = {
      ocr: async (region, light) => (await ocr.region(image, region, lang, !light)).lines,
      slot: async (region) => prepareSlot(image.data, image.width, image.height, region),
    };
    const { frame } = await readFrame(reader, layout, { lang, packs, gifts, held: [], materials });
    compared += 1;
    const said = (m: typeof read.gift) => (m === null ? '—' : m.status === 'match' ? String(m.id) : m.status);
    const before = `${read.screen ?? '—'} ${read.floor ?? '—'} ${said(read.pack)} ${said(read.gift)}`;
    const after = `${frame.screen ?? '—'} ${frame.floor ?? '—'} ${said(frame.pack)} ${said(frame.gift)}`;
    if (before !== after) changed.push(`frames/${read.frameId}.jpg  then [${before}]  now [${after}]`);
  }
  await ocr.terminate();
  console.log(`\nreread ${compared} frames: ${changed.length} read differently now`);
  for (const line of changed) console.log(`- ${line}`);
}

await main();
