/**
 * The owner's diagnostics export in parts (M146): a Claude Code session takes attachments of at
 * most 30 MB, and an hour's export (300 frames up to 150 MB, previews up to 20 MB) is far more.
 * So the export is split into standalone zips of at most `PART_MAX_BYTES` each.
 *
 * - Part 1 carries `session.json`; every part carries `part.json` (`diagPartSchema`: the bundle,
 *   its index and the total, and the frame files in it), so `npm run capture:feedback` can merge
 *   them and say which are missing.
 * - Frames go out by what matters most (`exportOrder`): evidence → unknown → sample → routine →
 *   preview, then by time. Parts are filled in that order, one after another — never back-filled —
 *   so the first parts hold the most important frames if only some reach the session.
 * - A frame bigger than a part on its own goes alone into a part; `session.json` over the limit
 *   still goes into part 1 (and the export says so). Nothing is ever dropped to fit.
 * - When it all fits in one part, the file keeps its old name and layout — only `part.json` is
 *   added.
 *
 * Sizes are planned from upper bounds (zip headers, `session.json` deflated once to measure it, the
 * room each frame takes in `part.json`), so a planned part never comes out over the limit.
 */
import { DIAG_PART_FILE, type DiagFrameClass, type DiagPart } from '../../../core/schema.ts';

export const PART_MAX_BYTES = 25 * 1024 * 1024;
/** Between two downloads, so the browser does not drop one of a quick run of them. */
export const PART_GAP_MS = 800;

/** Which frames go first: the lower, the earlier part. */
const EXPORT_RANK: Record<DiagFrameClass, number> = {
  evidence: 0,
  unknown: 1,
  sample: 2,
  routine: 3,
  preview: 4,
};

export interface PartFrame {
  id: string;
  t: number;
  bytes: number;
  /** Frames stored before M134 say nothing: `routine`. */
  class?: DiagFrameClass;
}

export const frameFile = (id: string): string => `frames/${id}.jpg`;

/** The frames in the order they go into parts. A new array; the input is left alone. */
export function exportOrder<T extends PartFrame>(frames: readonly T[]): T[] {
  return [...frames].sort(
    (a, b) =>
      EXPORT_RANK[a.class ?? 'routine'] - EXPORT_RANK[b.class ?? 'routine'] ||
      a.t - b.t ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

const utf8 = (text: string): number => new TextEncoder().encode(text).length;

/**
 * Text as bytes in this page's own `Uint8Array`: fflate tells a file from a folder by
 * `instanceof Uint8Array`, and where `TextEncoder` answers from another realm (jsdom) its bytes
 * would be taken for a folder of one entry per byte.
 */
const encode = (text: string): Uint8Array => new Uint8Array(new TextEncoder().encode(text));

/** A zip's end record, with room to spare. */
const ZIP_END_BYTES = 22 + 64;
/** One entry's local header (30) and central directory entry (46) besides its name, with room. */
const ENTRY_BYTES = 30 + 46 + 32;
/** `part.json` without its frame list: the bundle id, the export time, the index and the total. */
const PART_JSON_BASE = 256;

/** What one stored entry adds to a zip, at most. */
function entrySize(name: string, bytes: number): number {
  return bytes + 2 * utf8(name) + ENTRY_BYTES;
}

/** Deflate never grows data past its stored blocks: 5 bytes a block of 16 KB, and a little. */
function deflateBound(bytes: number): number {
  return bytes + 5 * Math.ceil(bytes / 16_383) + 16;
}

/** What one frame takes in its part: its entry and its line in `part.json`. */
function frameCost(frame: PartFrame): number {
  return entrySize(frameFile(frame.id), frame.bytes) + utf8(frameFile(frame.id)) + 8;
}

/** Room beside `session.json`'s measured compressed size. */
const SESSION_SLACK = 64;

/** A part's fixed cost: the end record and `part.json` with an empty list. */
const PART_BASE = ZIP_END_BYTES + entrySize(DIAG_PART_FILE, deflateBound(PART_JSON_BASE));

export interface PartPlan<T extends PartFrame> {
  /** Frames per part, in `exportOrder`; part 1 (index 0) also holds `session.json`. */
  parts: T[][];
  /** `session.json` alone is over the limit: part 1 holds it anyway, with no frames. */
  sessionOver: boolean;
}

/**
 * Split the export into parts of at most `limit` bytes each: `session.json` first — `sessionBytes`
 * is its size compressed, as the zip will hold it — then the frames in `exportOrder`, a new part
 * whenever the next frame does not fit.
 * Deterministic: the same frames and sizes always split the same way.
 */
export function planParts<T extends PartFrame>(
  sessionBytes: number,
  frames: readonly T[],
  limit = PART_MAX_BYTES,
): PartPlan<T> {
  const sessionCost = entrySize('session.json', sessionBytes + SESSION_SLACK);
  const sessionOver = PART_BASE + sessionCost > limit;
  const parts: T[][] = [[]];
  let used = PART_BASE + sessionCost;
  // Part 1 is never empty: it has the session.
  let empty = false;
  for (const frame of exportOrder(frames)) {
    const cost = frameCost(frame);
    if (!empty && used + cost > limit) {
      parts.push([]);
      used = PART_BASE;
      empty = true;
    }
    parts[parts.length - 1]!.push(frame);
    used += cost;
    empty = false;
  }
  return { parts, sessionOver };
}

/** `md-diagnostics-<stamp>.zip` as part `index` (from 1) of `total`; one part keeps the name. */
export function partName(name: string, index: number, total: number): string {
  return total === 1 ? name : name.replace(/\.zip$/, `-part${index}of${total}.zip`);
}

export interface ExportFrame extends PartFrame {
  blob: Blob;
}

export interface ExportPlan {
  names: string[];
  sessionOver: boolean;
  /** Build part `index` (from 0): its frames are read only now, so one part is in memory at once. */
  zip(index: number): Promise<Uint8Array>;
}

/**
 * Plan the parts of an export and how to build each. `session` is the bundle as written; it is
 * deflated once here to know its size in part 1 (the zip deflates it again the same way — records
 * shrink to a tenth or so, so planning by their raw size would leave most of part 1 empty).
 */
export async function planExport(
  input: {
    bundleId: string;
    exportedAt: number;
    session: string;
    frames: readonly ExportFrame[];
    name: string;
  },
  limit = PART_MAX_BYTES,
): Promise<ExportPlan> {
  const { deflateSync } = await import('fflate');
  const sessionBytes = deflateSync(encode(input.session)).length;
  const { parts, sessionOver } = planParts(sessionBytes, input.frames, limit);
  const total = parts.length;
  return {
    names: parts.map((_, i) => partName(input.name, i + 1, total)),
    sessionOver,
    async zip(index) {
      const frames = parts[index];
      if (!frames) throw new Error(`no part ${index + 1} of ${total}`);
      const { zipSync } = await import('fflate');
      const part: DiagPart = {
        bundleId: input.bundleId,
        exportedAt: input.exportedAt,
        part: index + 1,
        total,
        frames: frames.map((f) => frameFile(f.id)),
      };
      const files: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {};
      if (index === 0) files['session.json'] = encode(input.session);
      files[DIAG_PART_FILE] = encode(JSON.stringify(part, null, 1));
      for (const frame of frames)
        // JPEGs are compressed already; storing them saves the time a second pass would waste.
        files[frameFile(frame.id)] = [new Uint8Array(await frame.blob.arrayBuffer()), { level: 0 }];
      return zipSync(files);
    },
  };
}

/**
 * Hand every part to the browser in turn, `gap` ms apart. Resolves once the last one is handed
 * over; any failure rejects, and the caller marks nothing as exported.
 */
export async function downloadParts(
  plan: ExportPlan,
  download: (data: Uint8Array, name: string) => void,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms)),
  gap = PART_GAP_MS,
): Promise<void> {
  for (const [index, name] of plan.names.entries()) {
    if (index > 0) await wait(gap);
    download(await plan.zip(index), name);
  }
}
