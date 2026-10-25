/**
 * Reading an owner's diagnostics bundle back (M113, `npm run capture:feedback`): what the screen
 * reader got wrong and missed, labels the spike can measure against, and how the route compared
 * with the run. Pure but for `unpackBundle` — the CLI does the other files, the OCR and the printing.
 *
 * Where truth comes from, strongest first:
 * - an answered question names the gift or pack the screen showed (certain);
 * - an event the player did not undo was probably right (unconfirmed — kept in a separate file);
 * - an undo says the read was wrong; a run change made by hand while reading says something was
 *   missed — both go to the report for a person to look at, with the frames kept around them.
 *
 * Filmstrips (M134) are the small previews of every tick around events and hand-made changes:
 * the report lists their files so a person can see what came and went between reads. They are
 * not full size, so they are never labels and never re-read (`isPreview`).
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, isAbsolute } from 'node:path';
import type { CaptureLayout, DiagnosticsBundle, DiagRecord } from '../../src/core/schema.ts';
import { DIAG_PART_FILE, diagnosticsBundleSchema, diagPartSchema } from '../../src/core/schema.ts';

type Read = Extract<DiagRecord, { kind: 'read' }>;
type Applied = Extract<DiagRecord, { kind: 'applied' }>;
type Manual = Extract<DiagRecord, { kind: 'manual' }>;
type Strip = Extract<DiagRecord, { kind: 'strip' }>;
type Env = Extract<DiagRecord, { kind: 'env' }>;
type ReadSummary = Extract<DiagRecord, { kind: 'readSummary' }>;

/** The ids of a bundle's filmstrip previews, which are not full-size frames. */
export function previewIds(bundle: DiagnosticsBundle): Set<string> {
  return new Set(bundle.frames.filter((f) => f.class === 'preview').map((f) => f.id));
}

export interface FilmStrip {
  /** When its first read or hand-made change happened. */
  at: number;
  reads: Read[];
  manual: Manual[];
  /** Its previews in the bundle, each with its time from `at`, ms. */
  frames: { file: string; dt: number }[];
}

/** Every filmstrip with the reads and changes it was kept around and its preview files. */
export function filmStrips(bundle: DiagnosticsBundle): FilmStrip[] {
  const readAt = new Map(
    bundle.records.flatMap((r): [number, Read][] => (r.kind === 'read' ? [[r.t, r]] : [])),
  );
  const manualAt = new Map(
    bundle.records.flatMap((r): [number, Manual][] => (r.kind === 'manual' ? [[r.t, r]] : [])),
  );
  const frameAt = new Map(bundle.frames.map((f) => [f.id, f.t]));
  return bundle.records
    .filter((r): r is Strip => r.kind === 'strip')
    .map((strip) => {
      const at = Math.min(...strip.reads, ...strip.manual);
      return {
        at,
        reads: strip.reads.flatMap((t) => readAt.get(t) ?? []),
        manual: strip.manual.flatMap((t) => manualAt.get(t) ?? []),
        frames: strip.frameIds.flatMap((id) => {
          const t = frameAt.get(id);
          return t === undefined ? [] : [{ file: `frames/${id}.jpg`, dt: t - at }];
        }),
      };
    });
}

/**
 * What a bundle id or a frame id may be: they become a folder and file names on the owner's disk
 * (`local-fixtures/sessions/<bundleId>/frames/<id>.jpg`), and the zip they come from is a file
 * someone handed over. The app makes both from wall-clock numbers (`String(startedAt)`,
 * `${t}-${seq}`, `p${t}-${seq}`).
 */
const SAFE_ID = /^[\w-]+$/;

/** `id` if it is a safe file name (`SAFE_ID`), else an error naming what it was. */
export function safeId(id: string, what: string): string {
  if (!SAFE_ID.test(id)) throw new Error(`${what} ${JSON.stringify(id)} is not a plain name — refusing it`);
  return id;
}

/** What a zip entry of a bundle is by its name: the JSON files, a frame, or nothing of ours. */
export function bundleEntryKind(name: string): 'json' | 'frame' | null {
  if (name === 'session.json' || name === DIAG_PART_FILE) return 'json';
  const frame = /^frames\/([^/]+)\.jpg$/.exec(name);
  return frame && SAFE_ID.test(frame[1]!) ? 'frame' : null;
}

/** A kept frame is a q0.7 JPEG of at most 1920×1080 — well under a megabyte; this is a ceiling. */
export const FRAME_MAX_BYTES = 15 * 1024 * 1024;
/** `session.json` of an hour's recording is ~50 MB; `part.json` is tiny. */
export const BUNDLE_JSON_MAX_BYTES = 200 * 1024 * 1024;

/**
 * The `filter` for `unzipSync` (M160, B4): decided *before* an entry is inflated, so a zip that
 * claims a name we would not write, or a size past what a bundle can hold, costs nothing — a zip
 * bomb is memory only if it is unpacked. `originalSize` is the entry's own claim; the bytes of an
 * admitted entry are checked again by what reads them.
 */
export function zipEntryFilter(file: { name: string; originalSize: number }): boolean {
  const kind = bundleEntryKind(file.name);
  if (kind === null) return false;
  return file.originalSize <= (kind === 'frame' ? FRAME_MAX_BYTES : BUNDLE_JSON_MAX_BYTES);
}

/**
 * The files of an unpacked bundle that may be written to its folder: `session.json`, `part.json`
 * and `frames/<id>.jpg` with a safe id — anything else in the zip (a `../` path, an absolute one,
 * a stray file) is dropped, never written. Pairs of a path relative to the folder and the bytes.
 */
export function unpackableFiles(files: Record<string, Uint8Array>): [string, Uint8Array][] {
  const keep: [string, Uint8Array][] = [];
  for (const [path, bytes] of Object.entries(files)) {
    if (bundleEntryKind(path) !== null) keep.push([path, bytes]);
  }
  return keep.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Write a merged bundle into `<root>/<bundleId>/` (a fresh `frames/`), only the files
 * `unpackableFiles` keeps, and every one checked to land inside that folder. Returns the folder
 * and how many files of the zip were skipped. Throws, writing nothing, on an unsafe bundle id.
 */
export function unpackBundle(
  root: string,
  files: Record<string, Uint8Array>,
): { dir: string; bundle: DiagnosticsBundle; skipped: number } {
  const { bundle } = parseBundle(files);
  const dir = resolve(root, bundle.bundleId);
  const inside = (path: string) => {
    const rel = relative(dir, path);
    return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
  };
  const keep = unpackableFiles(files).filter(([name]) => inside(resolve(dir, name)));
  // A fresh folder: frames left from another export of the same recording would not match.
  rmSync(join(dir, 'frames'), { recursive: true, force: true });
  mkdirSync(join(dir, 'frames'), { recursive: true });
  for (const [name, bytes] of keep) writeFileSync(join(dir, name), bytes);
  return { dir, bundle, skipped: Object.keys(files).length - keep.length };
}

/** A bundle as unzipped: `session.json` and `frames/{id}.jpg`. */
export function parseBundle(files: Record<string, Uint8Array>): {
  bundle: DiagnosticsBundle;
  frames: Map<string, Uint8Array>;
} {
  const json = files['session.json'];
  if (!json) throw new Error('no session.json in the bundle');
  const bundle = diagnosticsBundleSchema.parse(JSON.parse(new TextDecoder().decode(json)));
  safeId(bundle.bundleId, 'bundle id');
  const frames = new Map<string, Uint8Array>();
  for (const frame of bundle.frames) {
    const bytes = files[`frames/${frame.id}.jpg`];
    if (bytes) frames.set(frame.id, bytes);
  }
  return { bundle, frames };
}

/** Which parts of a split export (M146) were given, and which are missing. */
export interface PartsReport {
  bundleId: string;
  exportedAt: number;
  total: number;
  /** Part numbers given, from 1. */
  present: number[];
  missing: number[];
}

/**
 * Merge the zips of one export (M146) into the files of one bundle, as `parseBundle` reads them.
 * Each zip says which part it is in `part.json`; a zip without it is a whole export from before
 * M146 (part 1 of 1, its bundle from `session.json`). Zips of different exports — another bundle,
 * or the same recording exported again — are refused by name: their frames would not match.
 * A part given twice counts once. Missing parts are reported, not refused: what is there is read.
 */
export function mergeParts(zips: readonly { name: string; files: Record<string, Uint8Array> }[]): {
  files: Record<string, Uint8Array>;
  parts: PartsReport;
} {
  if (zips.length === 0) throw new Error('no zip given');
  const decode = (bytes: Uint8Array): unknown => JSON.parse(new TextDecoder().decode(bytes));
  const described = zips.map(({ name, files }) => {
    const part = files[DIAG_PART_FILE];
    if (part) return { name, files, ...diagPartSchema.parse(decode(part)) };
    const session = files['session.json'];
    if (!session)
      throw new Error(`${name}: neither ${DIAG_PART_FILE} nor session.json — not a diagnostics export`);
    const { bundleId, exportedAt } = diagnosticsBundleSchema
      .pick({ bundleId: true, exportedAt: true })
      .parse(decode(session));
    return { name, files, bundleId, exportedAt, part: 1, total: 1 };
  });
  for (const d of described) safeId(d.bundleId, `${d.name}: bundle id`);
  const exports = new Set(described.map((d) => `${d.bundleId}@${d.exportedAt}`));
  if (exports.size > 1)
    throw new Error(
      `the zips come from ${exports.size} different exports — give the parts of one: ${described
        .map((d) => `${d.name} (bundle ${d.bundleId}, exported ${d.exportedAt}, part ${d.part}/${d.total})`)
        .join(', ')}`,
    );
  const [first] = described;
  const total = Math.max(...described.map((d) => d.total));
  const files: Record<string, Uint8Array> = {};
  const present = new Set<number>();
  for (const d of [...described].sort((a, b) => a.part - b.part)) {
    if (present.has(d.part)) continue;
    present.add(d.part);
    for (const [path, bytes] of Object.entries(d.files)) if (path !== DIAG_PART_FILE) files[path] = bytes;
  }
  const all = Array.from({ length: total }, (_, i) => i + 1);
  return {
    files,
    parts: {
      bundleId: first!.bundleId,
      exportedAt: first!.exportedAt,
      total,
      present: all.filter((n) => present.has(n)),
      missing: all.filter((n) => !present.has(n)),
    },
  };
}

export interface Misread {
  logId: number;
  event: { kind: string; [key: string]: unknown };
  read: Read | null;
}

export interface Miss {
  manual: Manual;
  /** Gifts marked got by hand, and packs entered by hand. */
  gifts: number[];
  entries: { floor: number; packId: number }[];
}

export interface RecognitionReport {
  reads: number;
  readsByScreen: Record<string, number>;
  ocrCalls: number;
  meanReadMs: number;
  applied: number;
  appliedByKind: Record<string, number>;
  misreads: Misread[];
  questions: { answered: number; dismissed: number };
  misses: Miss[];
  framesKept: number;
  /** Full frames by why they were kept (bundles before M134: all `routine`). */
  framesByClass: Record<string, number>;
  previewsKept: number;
  strips: FilmStrip[];
  /**
   * Ticks that waited on a busy read, and those that saw the screen change meanwhile (M134;
   * null for a bundle that does not say), and the reads during which it did.
   */
  waiting: { busyTicks: number; busyChanges: number; readsChangedUnder: number } | null;
  /**
   * The popup burst's reads (M136): how many, their mean time, and how many found a popup. Null
   * for a bundle with none (before M136, or no popup read in it).
   */
  popupReads: { reads: number; meanMs: number; popups: number } | null;
  /**
   * The reads of popups queued under a busy read (M141): how many, how many found a popup, their
   * mean wait from snapshot to read, and how many were pushed out unread. Null for a bundle with
   * neither (before M141, or nothing queued).
   */
  queuedReads: { reads: number; popups: number; meanLagMs: number; dropped: number } | null;
  /**
   * The re-reads of a fusion confirm's slots while its icons slid in (M159): how many and their
   * mean time. Null for a bundle with none.
   */
  slotReads: { reads: number; meanMs: number } | null;
  /**
   * What the fusion screen's ring and the purchase dialog settled (M175): fusions whose ingredients
   * the ring made up, and popups whose blurred name the purchase before them named.
   */
  madeUp: { ring: number; purchase: number };
  /**
   * Reads the recorder summed instead of keeping one by one (M153, `readSummary`): popup reads
   * that found nothing, and reads of nothing past their cap. Counted into everything above; null
   * for a bundle without any (before M153).
   */
  summed: { scans: number; capped: number } | null;
}

const count = (into: Record<string, number>, key: string): void => {
  into[key] = (into[key] ?? 0) + 1;
};

export function recognitionReport(bundle: DiagnosticsBundle): RecognitionReport {
  const reads = bundle.records.filter((r): r is Read => r.kind === 'read');
  const applied = bundle.records.filter((r): r is Applied => r.kind === 'applied');
  const undone = new Set(bundle.records.flatMap((r) => (r.kind === 'undo' ? [r.logId] : [])));
  const readAt = new Map(reads.map((r) => [r.t, r]));
  const readsByScreen: Record<string, number> = {};
  for (const r of reads) count(readsByScreen, r.screen ?? '(none)');
  const appliedByKind: Record<string, number> = {};
  for (const a of applied) count(appliedByKind, a.event.kind);
  const flagged = (key: 'ring' | 'purchase') =>
    applied.filter((a) => (a.event as Record<string, unknown>)[key] === true).length;
  const answers = bundle.records.filter((r) => r.kind === 'answer');
  const misses: Miss[] = bundle.records
    .filter((r): r is Manual => r.kind === 'manual' && r.capturing)
    .map((manual) => ({
      manual,
      gifts: manual.status.filter((s) => s.to === 'got').map((s) => s.giftId),
      entries: manual.visits.flatMap((v) => (v.to !== null ? [{ floor: v.floor, packId: v.to }] : [])),
    }))
    .filter((m) => m.gifts.length > 0 || m.entries.length > 0);
  const previews = previewIds(bundle);
  const framesByClass: Record<string, number> = {};
  for (const f of bundle.frames) if (!previews.has(f.id)) count(framesByClass, f.class ?? 'routine');
  const timed = reads.filter((r) => r.busyTicks !== undefined);
  const burst = reads.filter((r) => r.mode === 'popup');
  const queued = reads.filter((r) => r.queued === true);
  const slotReads = reads.filter((r) => r.mode === 'slots');
  // Reads summed by the recorder (M153) count as the reads they were.
  const sums = bundle.records.filter((r): r is ReadSummary => r.kind === 'readSummary');
  const total = (pick: (s: ReadSummary) => number, of = sums) => of.reduce((sum, s) => sum + pick(s), 0);
  const popupSums = sums.filter((s) => s.mode === 'popup');
  for (const s of sums)
    for (const [screen, n] of Object.entries(s.screens))
      readsByScreen[screen] = (readsByScreen[screen] ?? 0) + n;
  const dropped = reads.reduce((sum, r) => sum + (r.queueDropped ?? 0), 0) + total((s) => s.queueDropped);
  const readCount = reads.length + total((s) => s.reads);
  const burstCount = burst.length + total((s) => s.reads, popupSums);
  const queuedCount = queued.length + total((s) => s.queued);
  const timedCount = timed.length + sums.length;
  return {
    reads: readCount,
    readsByScreen,
    ocrCalls: reads.reduce((sum, r) => sum + r.ocrCalls, 0) + total((s) => s.ocrCalls),
    meanReadMs: readCount
      ? Math.round((reads.reduce((sum, r) => sum + r.ms, 0) + total((s) => s.ms)) / readCount)
      : 0,
    applied: applied.length,
    appliedByKind,
    misreads: applied
      .filter((a) => undone.has(a.logId))
      .map((a) => ({
        logId: a.logId,
        event: a.event,
        read: a.readT === null ? null : (readAt.get(a.readT) ?? null),
      })),
    questions: {
      answered: answers.filter((a) => a.kind === 'answer' && a.picked.length > 0).length,
      dismissed: answers.filter((a) => a.kind === 'answer' && a.picked.length === 0).length,
    },
    misses,
    framesKept: bundle.frames.length - previews.size,
    framesByClass,
    previewsKept: previews.size,
    strips: filmStrips(bundle),
    waiting: timedCount
      ? {
          busyTicks: timed.reduce((sum, r) => sum + (r.busyTicks ?? 0), 0) + total((s) => s.busyTicks),
          busyChanges: timed.reduce((sum, r) => sum + (r.busyChanges ?? 0), 0) + total((s) => s.busyChanges),
          readsChangedUnder:
            timed.filter((r) => (r.busyChanges ?? 0) > 0).length + total((s) => s.changedUnder),
        }
      : null,
    popupReads: burstCount
      ? {
          reads: burstCount,
          meanMs: Math.round(
            (burst.reduce((sum, r) => sum + r.ms, 0) + total((s) => s.ms, popupSums)) / burstCount,
          ),
          popups: burst.filter((r) => r.screen === 'acquired').length + total((s) => s.popups, popupSums),
        }
      : null,
    queuedReads:
      queuedCount > 0 || dropped > 0
        ? {
            reads: queuedCount,
            popups: queued.filter((r) => r.screen === 'acquired').length + total((s) => s.queuedPopups),
            meanLagMs: queuedCount
              ? Math.round(
                  (queued.reduce((sum, r) => sum + (r.lagMs ?? 0), 0) + total((s) => s.lagMs)) / queuedCount,
                )
              : 0,
            dropped,
          }
        : null,
    madeUp: { ring: flagged('ring'), purchase: flagged('purchase') },
    slotReads: slotReads.length
      ? {
          reads: slotReads.length,
          meanMs: Math.round(slotReads.reduce((sum, r) => sum + r.ms, 0) / slotReads.length),
        }
      : null,
    summed: sums.length
      ? {
          scans: total(
            (s) => s.reads,
            sums.filter((s) => s.cause === 'scan'),
          ),
          capped: total(
            (s) => s.reads,
            sums.filter((s) => s.cause === 'capped'),
          ),
        }
      : null,
  };
}

/** The environment the reader ran in (M142): what the bundle's `env` records add up to. */
export interface EnvironmentReport {
  records: number;
  levelChanges: number;
  /** Frames per second asked (the distinct rates) and delivered (median and lowest of the records). */
  fps: {
    requested: number[];
    deliveredMedian: number | null;
    deliveredMin: number | null;
    setting: number | null;
  };
  /** Tick lateness: the median of the records' p50 and the highest p90, ms. */
  lateness: { p50: number; p90: number } | null;
  readFull: { p50: number; p90: number } | null;
  readPopup: { p50: number; p90: number } | null;
  queueDropped: number;
  ranges: string[];
  /** The tick interval seen: lowest and highest. */
  interval: { min: number; max: number };
  maxLevel: number;
  /** How long the reader spent at each load level, ms (from one record to the next). */
  levelMs: [number, number, number];
}

const median = (values: readonly number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)]!;
};

/** The `env` records summed up (M142); null for a bundle without any (before M142). */
export function environmentReport(bundle: DiagnosticsBundle): EnvironmentReport | null {
  const envs = bundle.records.filter((r): r is Env => r.kind === 'env').sort((a, b) => a.t - b.t);
  if (envs.length === 0) return null;
  const pair = (pick: (e: Env) => { p50: number; p90: number } | null) => {
    const all = envs.map(pick).filter((p): p is { p50: number; p90: number } => p !== null);
    return all.length
      ? { p50: median(all.map((p) => p.p50))!, p90: Math.max(...all.map((p) => p.p90)) }
      : null;
  };
  const delivered = envs.map((e) => e.fps.delivered).filter((v): v is number => v !== null);
  const settings = envs.map((e) => e.fps.setting).filter((v): v is number => v !== null);
  const levelMs: [number, number, number] = [0, 0, 0];
  envs.forEach((e, i) => {
    const next = envs[i + 1];
    const level = Math.min(2, Math.max(0, e.level)) as 0 | 1 | 2;
    if (next) levelMs[level] += next.t - e.t;
  });
  return {
    records: envs.length,
    levelChanges: envs.filter((e) => e.reason === 'level').length,
    fps: {
      requested: [...new Set(envs.map((e) => e.fps.requested))].sort((a, b) => a - b),
      deliveredMedian: median(delivered),
      deliveredMin: delivered.length ? Math.min(...delivered) : null,
      setting: median(settings),
    },
    lateness: pair((e) => e.lateness),
    readFull: pair((e) => e.readFull),
    readPopup: pair((e) => e.readPopup),
    queueDropped: envs.reduce((sum, e) => sum + e.queueDropped, 0),
    ranges: [...new Set(envs.map((e) => `${e.range.min}–${e.range.max}ms`))],
    interval: {
      min: Math.min(...envs.map((e) => e.interval)),
      max: Math.max(...envs.map((e) => e.interval)),
    },
    maxLevel: Math.max(...envs.map((e) => e.level)),
    levelMs,
  };
}

/** The 「환경」 section of the report (M142), or nothing for a bundle without `env` records. */
export function environmentLines(env: EnvironmentReport | null): string[] {
  if (!env) return [];
  const ms = (p: { p50: number; p90: number } | null) =>
    p ? `p50 ${p.p50}ms · p90 ${p.p90}ms` : '기록 없음';
  const total = env.levelMs[0] + env.levelMs[1] + env.levelMs[2];
  const share = (i: 0 | 1 | 2) => (total > 0 ? `${Math.round((100 * env.levelMs[i]) / total)}%` : '-');
  return [
    '## 환경',
    '',
    `- 환경 기록 ${env.records}건 · 부하 단계 변화 ${env.levelChanges}회`,
    `- 프레임률: 요청 ${env.fps.requested.join('/')} · 전달 중앙값 ${env.fps.deliveredMedian ?? '모름'} (최저 ${env.fps.deliveredMin ?? '모름'}) · 트랙 설정 ${env.fps.setting ?? '모름'}`,
    `- 틱 지연: ${ms(env.lateness)}`,
    `- 판독 시간: 전체 ${ms(env.readFull)} · 팝업 ${ms(env.readPopup)}`,
    `- 대기열 넘침 ${env.queueDropped}`,
    `- 간격 범위 ${env.ranges.join(', ')} · 틱 간격 ${env.interval.min}~${env.interval.max}ms`,
    `- 부하 단계: 최고 ${env.maxLevel} · 단계별 시간 0 ${share(0)} · 1 ${share(1)} · 2 ${share(2)}`,
    '',
  ];
}

/** The spike's label shape (`scripts/capture-spike.ts`). */
export interface Label {
  file: string;
  kind: 'pack' | 'gift' | 'screen' | 'floor';
  lang: 'ko' | 'en';
  expect: number | string;
  region?: [number, number, number, number];
}

/** Where a screen shows the name the tracker reads. */
function nameRegion(
  screen: string | null,
  layout: CaptureLayout,
): [number, number, number, number] | undefined {
  if (screen === 'acquired') return layout.names.popup;
  if (screen === 'sellConfirm') return layout.names.centerConfirm;
  if (screen === 'sell') return layout.names.selected;
  if (screen === 'exploring') return layout.names.mapHeader;
  return undefined;
}

/** Labels for one read's frame: its screen, and the gift / pack / floor its event named. */
function labelsForRead(
  read: Read,
  event: Record<string, unknown>,
  lang: Label['lang'],
  layout: CaptureLayout,
): Label[] {
  if (!read.frameId || !read.screen) return [];
  const file = `frames/${read.frameId}.jpg`;
  const out: Label[] = [{ file, kind: 'screen', lang, expect: read.screen }];
  const region = nameRegion(read.screen, layout);
  if (typeof event.giftId === 'number') out.push({ file, kind: 'gift', lang, expect: event.giftId, region });
  if (typeof event.packId === 'number') out.push({ file, kind: 'pack', lang, expect: event.packId, region });
  if (typeof event.floor === 'number') out.push({ file, kind: 'floor', lang, expect: event.floor });
  return out.map((l) =>
    l.region === undefined ? { file: l.file, kind: l.kind, lang: l.lang, expect: l.expect } : l,
  );
}

/**
 * Labels from the bundle. `certain`: frames whose content a question's answer settled.
 * `unconfirmed`: frames of events the player let stand.
 */
export function labelsFrom(
  bundle: DiagnosticsBundle,
  layout: CaptureLayout,
): { certain: Label[]; unconfirmed: Label[] } {
  const lang = bundle.records.findLast((r) => r.kind === 'session')?.lang ?? 'ko';
  // Labels are for full frames only: a read never names a preview, but a bundle is not trusted to.
  const previews = previewIds(bundle);
  const reads = bundle.records
    .filter((r): r is Read => r.kind === 'read')
    .map((r) => (r.frameId !== null && previews.has(r.frameId) ? { ...r, frameId: null } : r));
  const readAt = new Map(reads.map((r) => [r.t, r]));
  const undone = new Set(bundle.records.flatMap((r) => (r.kind === 'undo' ? [r.logId] : [])));
  const certain: Label[] = [];
  const unconfirmed: Label[] = [];
  for (const rec of bundle.records) {
    if (rec.kind === 'applied' && rec.readT !== null && !undone.has(rec.logId)) {
      const read = readAt.get(rec.readT);
      if (read) unconfirmed.push(...labelsForRead(read, rec.event, lang, layout));
    }
    if (rec.kind === 'answer' && rec.picked.length > 0) {
      // The read that asked: the latest one before the answer whose unsure event offered these ids.
      const ids = Array.isArray(rec.ask.ids) ? (rec.ask.ids as number[]) : [];
      const asked = reads
        .filter((r) => r.t <= rec.t)
        .findLast((r) =>
          r.events.some(
            (e) =>
              e.kind === 'unsure' &&
              Array.isArray(e.ids) &&
              (e.ids as number[]).some((id) => ids.includes(id)),
          ),
        );
      if (!asked) continue;
      const picked = rec.picked[0]!;
      const event = rec.ask.kind === 'pack' ? { packId: picked, floor: rec.ask.floor } : { giftId: picked };
      certain.push(...labelsForRead(asked, event, lang, layout));
    }
  }
  const dedupe = (labels: Label[]) => [...new Map(labels.map((l) => [`${l.file}|${l.kind}`, l])).values()];
  return { certain: dedupe(certain), unconfirmed: dedupe(unconfirmed) };
}

export interface RouteReport {
  floors: number;
  /** Floors the route named a pack for, and how many of those the player entered. */
  recommended: number;
  followed: number;
  /** Entered somewhere else than the route said. */
  offRoute: { floor: number; recommended: number; entered: number | null }[];
  expected: { got: number; failed: number; unmarked: number };
  /** Gifts the route expected from the pack the player did enter, and did not get. */
  missedOnRoute: { floor: number; packId: number; giftId: number; kind: string }[];
  runs: { ended: string; goals: number; got: number; failed: number; unresolved: Record<string, number> }[];
}

export function routeReport(bundle: DiagnosticsBundle, kindOf: (giftId: number) => string): RouteReport {
  const floors = bundle.records.filter((r) => r.kind === 'floor');
  const report: RouteReport = {
    floors: floors.length,
    recommended: 0,
    followed: 0,
    offRoute: [],
    expected: { got: 0, failed: 0, unmarked: 0 },
    missedOnRoute: [],
    runs: [],
  };
  for (const f of floors) {
    if (f.kind !== 'floor') continue;
    if (f.recommended !== null) {
      report.recommended += 1;
      if (f.entered === f.recommended) report.followed += 1;
      else report.offRoute.push({ floor: f.floor, recommended: f.recommended, entered: f.entered });
    }
    for (const g of f.expected) {
      if (g.status === 'got') report.expected.got += 1;
      else if (g.status === 'failed') report.expected.failed += 1;
      else report.expected.unmarked += 1;
      if (g.status !== 'got' && f.entered !== null && f.entered === f.recommended)
        report.missedOnRoute.push({
          floor: f.floor,
          packId: f.entered,
          giftId: g.giftId,
          kind: kindOf(g.giftId),
        });
    }
  }
  for (const r of bundle.records) {
    if (r.kind !== 'run') continue;
    const unresolved: Record<string, number> = {};
    for (const u of r.unresolved) count(unresolved, u.reason);
    report.runs.push({
      ended: r.ended,
      goals: r.goals.length,
      got: r.goals.filter((g) => g.status === 'got').length,
      failed: r.goals.filter((g) => g.status === 'failed').length,
      unresolved,
    });
  }
  return report;
}

/**
 * The picture sizes the session captured, in the order first seen, each with its window title bar
 * (M134): 「1928×1043 (제목 표시줄 30px)」. Older bundles never recorded a size and give none.
 */
export function captureGeometries(bundle: DiagnosticsBundle): string[] {
  const seen: string[] = [];
  for (const r of bundle.records) {
    if (r.kind !== 'session' || r.captureSize === null) continue;
    const top = r.inset?.top ?? 0;
    const text = `${r.captureSize.width}×${r.captureSize.height}${top > 0 ? ` (제목 표시줄 ${top}px)` : ''}`;
    if (!seen.includes(text)) seen.push(text);
  }
  return seen;
}

/** The report as Markdown, names resolved by the caller. */
export function formatReport(
  bundle: DiagnosticsBundle,
  rec: RecognitionReport,
  route: RouteReport,
  labels: { certain: number; unconfirmed: number },
  name: { gift: (id: number) => string; pack: (id: number) => string },
  /** A split export's parts (M146), and how many of the bundle's frames are not in the files. */
  parts: { report: PartsReport; framesMissing: number } | null = null,
): string {
  const lines: string[] = [];
  const when = (t: number) => new Date(t).toISOString().replace('T', ' ').slice(0, 19);
  const eventText = (e: Record<string, unknown>) =>
    [
      e.kind,
      typeof e.floor === 'number' ? `${e.floor}층` : null,
      typeof e.packId === 'number' ? name.pack(e.packId) : null,
      typeof e.giftId === 'number' ? name.gift(e.giftId) : null,
    ]
      .filter(Boolean)
      .join(' ');
  lines.push(`# 진단 기록 분석 — ${when(bundle.startedAt)} ~ ${when(bundle.exportedAt)} (UTC)`, '');
  lines.push(
    `데이터 ${bundle.dataVersion} · 시즌 ${bundle.season} · 기록 ${bundle.records.length}건 · 이미지 ${rec.framesKept}장 (${
      Object.entries(rec.framesByClass)
        .map(([k, v]) => `${k} ${v}`)
        .join(', ') || '없음'
    }) · 미리 보기 ${rec.previewsKept}장`,
    '',
  );
  if (parts && parts.report.total > 1)
    lines.push(
      `나눠 받은 파일 ${parts.report.present.length}/${parts.report.total}개${
        parts.report.missing.length > 0
          ? ` · ⚠ 빠진 파일: ${parts.report.missing.map((n) => `part${n}`).join(', ')} — 이미지 ${parts.framesMissing}장 없음`
          : ''
      }`,
      '',
    );
  lines.push('## 화면 인식', '');
  lines.push(`- 판독 ${rec.reads}회 · OCR ${rec.ocrCalls}회 · 평균 ${rec.meanReadMs}ms`);
  lines.push(`- 캡처 크기: ${captureGeometries(bundle).join(', ') || '기록 없음'}`);
  lines.push(
    `- 화면별 판독: ${
      Object.entries(rec.readsByScreen)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k} ${v}`)
        .join(', ') || '없음'
    }`,
  );
  lines.push(
    `- 자동 기록 ${rec.applied}건 (${
      Object.entries(rec.appliedByKind)
        .map(([k, v]) => `${k} ${v}`)
        .join(', ') || '없음'
    }) · 되돌림(오인식) ${rec.misreads.length}건`,
  );
  lines.push(`- 질문: 답함 ${rec.questions.answered} · 무시 ${rec.questions.dismissed}`);
  if (rec.popupReads)
    lines.push(
      `- 팝업 연속 판독 ${rec.popupReads.reads}회 · 평균 ${rec.popupReads.meanMs}ms · 그중 팝업 ${rec.popupReads.popups}회`,
    );
  if (rec.queuedReads)
    lines.push(
      `- 대기열 판독 ${rec.queuedReads.reads}회 · 그중 팝업 ${rec.queuedReads.popups}회 · 평균 지연 ${rec.queuedReads.meanLagMs}ms · 넘침 ${rec.queuedReads.dropped}`,
    );
  if (rec.slotReads) lines.push(`- 합성 칸 재판독 ${rec.slotReads.reads}회 · 평균 ${rec.slotReads.meanMs}ms`);
  if (rec.madeUp.ring + rec.madeUp.purchase > 0)
    lines.push(
      `- 합성 화면 원형 칸으로 정한 재료 ${rec.madeUp.ring}회 · 구매 창으로 정한 팝업 ${rec.madeUp.purchase}회`,
    );
  if (rec.summed)
    lines.push(
      `- 묶어 적은 판독: 팝업 없는 팝업 판독 ${rec.summed.scans}회${
        rec.summed.capped > 0
          ? ` · ⚠ 판독 기록 상한 뒤 아무것도 찾지 못한 판독 ${rec.summed.capped}회(개수만)`
          : ''
      }`,
    );
  if (rec.waiting)
    lines.push(
      `- 판독이 바빠 건너뛴 틱 ${rec.waiting.busyTicks}회 · 그중 화면이 바뀐 틱 ${rec.waiting.busyChanges}회 (판독 ${rec.waiting.readsChangedUnder}회 동안)`,
    );
  lines.push(`- 인식 중 손으로 고친 것(놓침 후보) ${rec.misses.length}건`, '');
  const stripOf = (pick: (s: FilmStrip) => boolean) => rec.strips.find(pick);
  const seconds = (ms: number) => `${ms < 0 ? '−' : '+'}${(Math.abs(ms) / 1000).toFixed(2)}s`;
  if (rec.misreads.length > 0) {
    lines.push('### 오인식', '');
    for (const m of rec.misreads) {
      const ocr =
        m.read?.trace
          .filter((s) => s.accepted)
          .map((s) => s.lines.join(' / '))
          .join(' ‖ ') ?? '—';
      lines.push(
        `- ${eventText(m.event)} — OCR: ${ocr}${m.read?.frameId ? ` — frames/${m.read.frameId}.jpg` : ''}`,
      );
    }
    lines.push('');
  }
  if (rec.misses.length > 0) {
    lines.push('### 놓침 후보', '');
    for (const m of rec.misses) {
      const what = [
        ...m.gifts.map((id) => `획득 ${name.gift(id)}`),
        ...m.entries.map((e) => `${e.floor}층 입장 ${name.pack(e.packId)}`),
      ].join(', ');
      const strip = stripOf((s) => s.manual.includes(m.manual));
      lines.push(
        `- ${when(m.manual.t)} ${what}${m.manual.frameIds.length ? ` — 직전 이미지 ${m.manual.frameIds.length}장` : ''}${
          strip?.frames.length ? ` — 필름 ${strip.frames.length}장(${when(strip.at)})` : ''
        }`,
      );
    }
    lines.push('');
  }
  if (rec.strips.length > 0) {
    lines.push('### 필름 (판독 사이의 미리 보기)', '');
    for (const strip of rec.strips) {
      const what = [
        ...strip.reads.flatMap((r) => r.events.map((e) => eventText(e))),
        ...strip.manual.map((m) =>
          [
            '손으로',
            ...m.status.filter((x) => x.to === 'got').map((x) => `획득 ${name.gift(x.giftId)}`),
            ...m.visits.flatMap((v) => (v.to !== null ? [`${v.floor}층 입장 ${name.pack(v.to)}`] : [])),
          ].join(' '),
        ),
      ].join(' · ');
      const first = strip.frames[0];
      const last = strip.frames.at(-1);
      lines.push(
        `- ${when(strip.at)} ${what || '—'} — 미리 보기 ${strip.frames.length}장${
          first && last ? ` (${seconds(first.dt)} ~ ${seconds(last.dt)})` : ''
        }`,
      );
      if (strip.frames.length > 0)
        lines.push(`  - ${strip.frames.map((f) => `${f.file} (${seconds(f.dt)})`).join(', ')}`);
    }
    lines.push('');
  }
  lines.push(
    `라벨: 확실 ${labels.certain}개(labels.json) · 확인 안 됨 ${labels.unconfirmed}개(labels-unconfirmed.json)`,
    '',
  );
  lines.push(...environmentLines(environmentReport(bundle)));
  lines.push('## 루트', '');
  const rate = route.recommended ? Math.round((100 * route.followed) / route.recommended) : 0;
  lines.push(
    `- 떠난 층 ${route.floors}개 · 추천 팩을 따른 층 ${route.followed}/${route.recommended} (${rate}%)`,
  );
  lines.push(
    `- 기대한 기프트: 획득 ${route.expected.got} · 미획득 ${route.expected.failed} · 표시 없음 ${route.expected.unmarked}`,
  );
  if (route.offRoute.length > 0) {
    lines.push('', '### 루트와 다르게 간 층', '');
    for (const o of route.offRoute)
      lines.push(
        `- ${o.floor}층: 추천 ${name.pack(o.recommended)} → ${o.entered === null ? '건너뜀' : name.pack(o.entered)}`,
      );
  }
  if (route.missedOnRoute.length > 0) {
    lines.push('', '### 루트대로 갔는데 못 얻은 기프트', '');
    for (const m of route.missedOnRoute)
      lines.push(`- ${m.floor}층 ${name.pack(m.packId)}: ${name.gift(m.giftId)} (${m.kind})`);
  }
  if (route.runs.length > 0) {
    lines.push('', '### 런', '');
    for (const r of route.runs)
      lines.push(
        `- ${r.ended === 'done' ? '끝까지' : '새 런으로 버림'}: 목표 ${r.goals} · 획득 ${r.got} · 미획득 ${r.failed}${
          Object.keys(r.unresolved).length
            ? ` · 미해결 ${Object.entries(r.unresolved)
                .map(([k, v]) => `${k} ${v}`)
                .join(', ')}`
            : ''
        }`,
      );
  }
  const marks = bundle.records.flatMap((r) => (r.kind === 'runMark' ? [r] : []));
  if (marks.length > 0) {
    lines.push('', '### 런 시작·되돌리기', '');
    const word = { new: '새 런으로 시작', continue: '이어서', rollback: '시작 전으로 되돌림' } as const;
    for (const m of marks)
      lines.push(
        `- ${when(m.t)} ${word[m.mark]}: ${m.hadProgress ? '진행 있던 런' : '빈 런'} (${m.run.currentFloor}층 · 입장 ${m.run.visits} · 획득 ${m.run.got} · 미획득 ${m.run.failed}${m.run.startDone ? ' · 시작 확정' : ''})`,
      );
  }
  return `${lines.join('\n')}\n`;
}
