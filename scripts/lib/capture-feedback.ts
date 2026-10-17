/**
 * Reading an owner's diagnostics bundle back (M113, `npm run capture:feedback`): what the screen
 * reader got wrong and missed, labels the spike can measure against, and how the route compared
 * with the run. Pure — the CLI does the files, the OCR and the printing.
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
import type { CaptureLayout, DiagnosticsBundle, DiagRecord } from '../../src/core/schema.ts';
import { diagnosticsBundleSchema } from '../../src/core/schema.ts';

type Read = Extract<DiagRecord, { kind: 'read' }>;
type Applied = Extract<DiagRecord, { kind: 'applied' }>;
type Manual = Extract<DiagRecord, { kind: 'manual' }>;
type Strip = Extract<DiagRecord, { kind: 'strip' }>;

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

/** A bundle as unzipped: `session.json` and `frames/{id}.jpg`. */
export function parseBundle(files: Record<string, Uint8Array>): {
  bundle: DiagnosticsBundle;
  frames: Map<string, Uint8Array>;
} {
  const json = files['session.json'];
  if (!json) throw new Error('no session.json in the bundle');
  const bundle = diagnosticsBundleSchema.parse(JSON.parse(new TextDecoder().decode(json)));
  const frames = new Map<string, Uint8Array>();
  for (const frame of bundle.frames) {
    const bytes = files[`frames/${frame.id}.jpg`];
    if (bytes) frames.set(frame.id, bytes);
  }
  return { bundle, frames };
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
  return {
    reads: reads.length,
    readsByScreen,
    ocrCalls: reads.reduce((sum, r) => sum + r.ocrCalls, 0),
    meanReadMs: reads.length ? Math.round(reads.reduce((sum, r) => sum + r.ms, 0) / reads.length) : 0,
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
    waiting: timed.length
      ? {
          busyTicks: timed.reduce((sum, r) => sum + (r.busyTicks ?? 0), 0),
          busyChanges: timed.reduce((sum, r) => sum + (r.busyChanges ?? 0), 0),
          readsChangedUnder: timed.filter((r) => (r.busyChanges ?? 0) > 0).length,
        }
      : null,
    popupReads: burst.length
      ? {
          reads: burst.length,
          meanMs: Math.round(burst.reduce((sum, r) => sum + r.ms, 0) / burst.length),
          popups: burst.filter((r) => r.screen === 'acquired').length,
        }
      : null,
  };
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
  return `${lines.join('\n')}\n`;
}
