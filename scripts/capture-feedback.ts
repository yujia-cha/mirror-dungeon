/**
 * Read back an owner's diagnostics export (M113).
 *
 *   npm run capture:feedback -- path/to/md-diagnostics-20261016-1430.zip
 *   npm run capture:feedback -- md-diagnostics-20261016-1430-part1of3.zip …-part2of3.zip …
 *   npm run capture:feedback -- path/to/folder-with-the-part-zips
 *   npm run capture:feedback -- local-fixtures/sessions/<id> --reread
 *
 * A zip — or the parts of a split export (M146), given as files or as a folder holding them — is
 * unpacked into `local-fixtures/sessions/<bundleId>/` (gitignored: the frames are game screens and
 * are never committed), the parts' frames merged into one `frames/`. `part.json` in each part says
 * which export and which part it is: zips of different exports are refused, and missing parts are
 * reported (and written to `parts.json` in the folder) while the rest is read — part 1 holds
 * `session.json` and cannot be missing. Then the folder gets:
 *
 * - `report.md`: what the reader read, what it got wrong (undone) and missed (changed by hand
 *   while reading), with the OCR lines and the frames for each; and how the route compared with
 *   the run — floors where the player went elsewhere, gifts the route expected and the pack did
 *   not give. Also the filmstrips (M134): for each burst of events and each hand-made change
 *   while reading, the small previews of every tick around it, by file and time — what came and
 *   went between reads.
 * - `labels.json` (certain — frames a question's answer settled) and `labels-unconfirmed.json`
 *   (events the player let stand), in the spike's format, so `npm run capture:spike -- --dir
 *   <folder>` measures the current reading against a real run. Full-size frames only.
 *
 * `--reread` reads every kept full-size frame (never a filmstrip preview) again with today's
 * `readFrame` and lists where it now reads
 * differently from what was recorded — the regression check after changing the reader. The
 * fusion confirm's slots are matched against the materials only (the run's holdings at the time
 * are not in the bundle).
 *
 * Local only.
 */
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { unzipSync } from 'fflate';
import { chipTiers } from '../src/app/capture/tier-chip.ts';
import { prepareSlot, type IconRef } from '../src/app/capture/match-icon.ts';
import type { NameCandidate } from '../src/app/capture/match-name.ts';
import { readFrame, type RegionReader } from '../src/app/capture/read-frame.ts';
import { loadGameDataFromDisk } from '../src/core/data/node.ts';
import { layoutInFrame } from '../src/app/capture/window-frame.ts';
import { captureLayoutSchema } from '../src/core/schema.ts';
import { decodeImage, loadIconRefs, LocalOcr, titleBarOf } from './lib/capture-local.ts';
import {
  formatReport,
  labelsFrom,
  mergeParts,
  parseBundle,
  previewIds,
  recognitionReport,
  routeReport,
  unpackBundle,
  type PartsReport,
} from './lib/capture-feedback.ts';
import { hasFlag } from './lib/io.ts';

function fail(message: string): never {
  console.error(`capture-feedback: ${message}`);
  process.exit(1);
}

/** Every file of an unpacked folder, keyed by its path inside it (the shape `unzipSync` gives). */
function readFolder(dir: string): Record<string, Uint8Array> {
  const files: Record<string, Uint8Array> = {};
  files['session.json'] = readFileSync(join(dir, 'session.json'));
  const frames = join(dir, 'frames');
  if (existsSync(frames))
    for (const name of readdirSync(frames)) files[`frames/${name}`] = readFileSync(join(frames, name));
  return files;
}

/** The zips the arguments name: zip files, and the zips directly inside a folder given. */
function zipsOf(paths: readonly string[]): string[] {
  return paths.flatMap((path) =>
    statSync(path).isDirectory()
      ? readdirSync(path)
          .filter((name) => name.toLowerCase().endsWith('.zip'))
          .sort()
          .map((name) => join(path, name))
      : [path],
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (args.length === 0)
    fail('give the exported zip (or all its parts, or their folder) or an unpacked folder');
  const paths = args.map((arg) => resolve(arg));
  for (const path of paths) if (!existsSync(path)) fail(`no such file or folder: ${path}`);

  let dir: string;
  let files: Record<string, Uint8Array>;
  let parts: PartsReport | null = null;
  const [only] = paths;
  if (paths.length === 1 && statSync(only!).isDirectory() && existsSync(join(only!, 'session.json'))) {
    // A folder unpacked before: the parts it was merged from, if it was, are in `parts.json`.
    dir = only!;
    files = readFolder(dir);
    const saved = join(dir, 'parts.json');
    if (existsSync(saved)) parts = JSON.parse(readFileSync(saved, 'utf8')) as PartsReport;
  } else {
    const zips = zipsOf(paths);
    if (zips.length === 0) fail(`no zip in ${paths.join(', ')}`);
    let merged: ReturnType<typeof mergeParts>;
    try {
      merged = mergeParts(
        zips.map((path) => ({ name: basename(path), files: unzipSync(readFileSync(path)) })),
      );
    } catch (error) {
      fail((error as Error).message);
    }
    parts = merged.parts;
    if (parts.missing.length > 0)
      console.warn(
        `capture-feedback: ⚠ missing ${parts.missing.map((n) => `part ${n}`).join(', ')} of ${parts.total} — reading what is there`,
      );
    if (!merged.files['session.json'])
      fail(
        `part 1 holds session.json and is missing; have ${parts.present.map((n) => `part ${n}`).join(', ')}`,
      );
    files = merged.files;
    let unpacked: ReturnType<typeof unpackBundle>;
    try {
      // Only session.json, part.json and frames/<plain id>.jpg, inside the bundle's folder: the
      // zip is someone else's file.
      unpacked = unpackBundle(resolve('local-fixtures/sessions'), files);
    } catch (error) {
      fail((error as Error).message);
    }
    dir = unpacked.dir;
    if (unpacked.skipped > 0)
      console.warn(`capture-feedback: ⚠ skipped ${unpacked.skipped} unexpected file(s) in the zip`);
    const savedParts = join(dir, 'parts.json');
    if (parts.total > 1) writeFileSync(savedParts, `${JSON.stringify(parts, null, 2)}\n`);
    else rmSync(savedParts, { force: true });
    console.log(`unpacked ${zips.map((z) => basename(z)).join(', ')} → ${dir}`);
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
    parts ? { report: parts, framesMissing: bundle.frames.length - frames.size } : null,
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
  // The fusion slots' tier numerals (M152), as the app reads them.
  const tiers = new Map(data.gifts.map((g) => [g.id, typeof g.tier === 'number' ? g.tier : null]));
  const ocr = new LocalOcr('best');
  let compared = 0;
  let barred = 0;
  const changed: string[] = [];
  // Filmstrip previews are 480 px wide: the layout's regions would read nothing on them.
  const previews = previewIds(bundle);
  // As the app looks for the start pickers only while the run start is open (M135): until a frame
  // shows a pack picker or a map.
  let startOpen = true;
  for (const read of bundle.records) {
    if (read.kind !== 'read' || !read.frameId || previews.has(read.frameId)) continue;
    const bytes = frames.get(read.frameId);
    if (!bytes) continue;
    const image = await decodeImage(Buffer.from(bytes));
    // The window's title bar, if the frame was shared with it (M134): the app reads below it.
    const top = titleBarOf(image);
    const inFrame = layoutInFrame(layout, top, image.height);
    if (top > 0) barred += 1;
    const reader: RegionReader = {
      ocr: async (region, light) => (await ocr.region(image, region, lang, !light)).lines,
      slot: async (region) => prepareSlot(image.data, image.width, image.height, region),
      tier: async (region) => chipTiers(image.data, image.width, image.height, region),
    };
    const { frame } = await readFrame(reader, inFrame, {
      lang,
      packs,
      gifts,
      held: [],
      materials,
      tiers,
      startOpen,
      iconRefs: async (ids) => refs.filter((ref) => ids.includes(ref.id)),
    });
    if (frame.screen === 'packSelect' || frame.screen === 'exploring') startOpen = false;
    compared += 1;
    const said = (m: typeof read.gift) => (m === null ? '—' : m.status === 'match' ? String(m.id) : m.status);
    const before = `${read.screen ?? '—'} ${read.floor ?? '—'} ${said(read.pack)} ${said(read.gift)}`;
    const after = `${frame.screen ?? '—'} ${frame.floor ?? '—'} ${said(frame.pack)} ${said(frame.gift)}`;
    const bar = top > 0 ? `  (title bar ${top}px)` : '';
    if (before !== after) changed.push(`frames/${read.frameId}.jpg  then [${before}]  now [${after}]${bar}`);
  }
  await ocr.terminate();
  console.log(
    `\nreread ${compared} frames (${barred} with a window title bar): ${changed.length} read differently now`,
  );
  for (const line of changed) console.log(`- ${line}`);
}

await main();
