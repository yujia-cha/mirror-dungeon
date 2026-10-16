/**
 * The owner's diagnostics wired into the app (M112): the recorder, fed by the screen reader's
 * hooks and by the run itself, and the export that zips it.
 *
 * Shown only to the owner — `#diag` in the address turns `ui.diagEnabled` on (and is dropped from
 * the address at once); nothing is recorded until they tick 「진단 기록」. Route feedback (floors
 * left, runs ended) and hand-made run changes come from a store subscription, so they are recorded
 * whether or not the reader runs. A change made while the reader is applying one of its own is
 * not the player's and is not recorded as one (`applying`).
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from 'react';
import { captureLayoutSchema, type DiagRecord } from '../../../core/schema.ts';
import type { RunState } from '../../lib/plan-input.ts';
import { downloadBlob } from '../../lib/download.ts';
import { usePlan } from '../../shell/plan-context.ts';
import { runDoneFloor, runInProgress, useApp } from '../../store.ts';
import type { CaptureHooks } from '../useCapture.ts';
import { DiagRecorder, type DiagStats } from './recorder.ts';
import { openDiagStore } from './store.ts';

const EMPTY: DiagStats = {
  records: 0,
  frames: 0,
  bytes: 0,
  exportedRecords: 0,
  lastExportAt: null,
  trimmedFrames: 0,
  full: false,
};

/** `#diag` in the address opens the owner's section; the hash is consumed so a reload is clean. */
export function consumeDiagHash(): boolean {
  if (typeof window === 'undefined' || window.location.hash !== '#diag') return false;
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
  return true;
}

type ManualInput = Omit<Extract<DiagRecord, { kind: 'manual' }>, 't' | 'kind' | 'frameIds'>;

/** What changed in the run, as the manual record says it; null when nothing did. */
export function runDiff(prev: RunState, next: RunState): Omit<ManualInput, 'capturing'> | null {
  const visits: ManualInput['visits'] = [];
  const floors = new Set([...Object.keys(prev.visits), ...Object.keys(next.visits)].map(Number));
  for (const floor of [...floors].sort((a, b) => a - b)) {
    const from = prev.visits[floor] ?? null;
    const to = next.visits[floor] ?? null;
    if (from !== to) visits.push({ floor, from, to });
  }
  const status: ManualInput['status'] = [];
  const gifts = new Set([...Object.keys(prev.giftStatus), ...Object.keys(next.giftStatus)].map(Number));
  for (const giftId of [...gifts].sort((a, b) => a - b)) {
    const from = prev.giftStatus[giftId] ?? null;
    const to = next.giftStatus[giftId] ?? null;
    if (from !== to) status.push({ giftId, from, to });
  }
  const currentFloor =
    prev.currentFloor !== next.currentFloor ? { from: prev.currentFloor, to: next.currentFloor } : null;
  return visits.length || status.length || currentFloor ? { visits, status, currentFloor } : null;
}

export function useDiagnostics(capture: { status: () => string; applying: () => RefObject<boolean> | null }) {
  const { data, plan, shown, expectedIn } = usePlan();
  const enabled = useApp((s) => s.ui.diagEnabled);
  const recordOn = useApp((s) => s.ui.diagRecord);
  const imagesOn = useApp((s) => s.ui.diagImages);
  const setUi = useApp((s) => s.setUi);
  const [recorder, setRecorder] = useState<DiagRecorder | null>(null);

  // `#diag` on load, and pasted into an open tab later.
  useEffect(() => {
    const check = (): void => {
      if (consumeDiagHash()) setUi({ diagEnabled: true });
    };
    check();
    window.addEventListener('hashchange', check);
    return () => window.removeEventListener('hashchange', check);
  }, [setUi]);

  // The store opens once the owner has the section; nobody else pays for it.
  useEffect(() => {
    if (!enabled || recorder) return undefined;
    let live = true;
    void openDiagStore()
      .then((store) => DiagRecorder.open(store))
      .then((r) => {
        if (live) setRecorder(r);
      });
    return () => {
      live = false;
    };
  }, [enabled, recorder]);

  useEffect(() => {
    recorder?.setFlags(enabled && recordOn, enabled && recordOn && imagesOn);
  }, [recorder, enabled, recordOn, imagesOn]);

  const subscribe = useCallback((fn: () => void) => recorder?.subscribe(fn) ?? (() => undefined), [recorder]);
  const stats = useSyncExternalStore(
    subscribe,
    () => recorder?.stats() ?? EMPTY,
    () => EMPTY,
  );

  // The plan as it was when the run changed: the listener runs before the next render.
  const latest = useRef({ data, plan, shown, expectedIn, capture });
  useEffect(() => {
    latest.current = { data, plan, shown, expectedIn, capture };
  });

  useEffect(() => {
    if (!recorder) return undefined;
    return useApp.subscribe((state, prev) => {
      if (state.run === prev.run || !recorder.recording) return;
      const { plan: p, shown: s, expectedIn: expected, capture: c } = latest.current;
      const before = prev.run;
      const after = state.run;
      // Hand-made changes. The reader's own go through `applying`.
      if (!c.applying()?.current) {
        const diff = runDiff(before, after);
        if (diff) recorder.onManual({ ...diff, capturing: c.status() === 'running' });
      }
      // Floors left behind, with what the route on show offered for them.
      for (let floor = before.currentFloor; floor < after.currentFloor; floor += 1) {
        const fp = s?.floors.find((f) => f.floor === floor);
        const entered = after.visits[floor] ?? null;
        recorder.onFloor({
          floor,
          recommended: fp?.packId ?? null,
          window: fp?.window ?? null,
          alternatives: fp?.alternatives ?? [],
          entered,
          expected:
            entered === null
              ? []
              : expected(floor, entered).map((giftId) => ({
                  giftId,
                  status: after.giftStatus[giftId] ?? null,
                })),
          startGifts: floor === 1 ? after.startGifts : [],
        });
      }
      // A run over (the last floor left) or thrown away for a new one.
      const done =
        after.currentFloor >= runDoneFloor(state.lastFloor) && before.currentFloor < after.currentFloor;
      const reset = runInProgress(before) && !runInProgress(after);
      if (done || reset) {
        const run = done ? after : before;
        recorder.onRun({
          ended: done ? 'done' : 'reset',
          goals: state.wanted.map((giftId) => ({ giftId, status: run.giftStatus[giftId] ?? null })),
          fusionGoal: Object.fromEntries(Object.entries(state.fusionGoal).map(([k, v]) => [k, String(v)])),
          deck: state.deck,
          unresolved: (p?.unresolved ?? []).map((u) => ({ giftId: u.giftId, reason: u.reason })),
          warnings: (p?.warnings ?? []).map((w) => w.code),
        });
      }
    });
  }, [recorder]);

  /** The hooks the screen reader calls. Stable: they read the recorder through a ref. */
  const recorderRef = useRef(recorder);
  useEffect(() => {
    recorderRef.current = recorder;
  }, [recorder]);
  const hooks = useMemo<CaptureHooks>(
    () => ({
      onRead: (report, image) => recorderRef.current?.onRead(report, image),
      wantImage: () => recorderRef.current?.images ?? false,
      onApplied: (logId, event, actions, fromRead) =>
        recorderRef.current?.onApplied(logId, event, actions, fromRead),
      onUndo: (logId) => recorderRef.current?.onUndo(logId),
      onAnswer: (ask, picked) => recorderRef.current?.onAnswer(ask, picked),
      onSession: (status, error) => {
        const ui = useApp.getState().ui;
        recorderRef.current?.onSession({
          status,
          error,
          interval: ui.captureInterval,
          lang: ui.captureLang,
          captureSize: null,
        });
      },
    }),
    [],
  );

  /** Zip everything stored and hand it to the browser as a download. */
  const exportZip = useCallback(async (): Promise<string | null> => {
    if (!recorder) return null;
    const layoutReference = await fetch(`${import.meta.env.BASE_URL}data/capture-layout.json`)
      .then(async (r) => captureLayoutSchema.parse(await r.json()).reference)
      .catch(() => null);
    const { bundle, frames, name } = await recorder.exportBundle({
      dataVersion: latest.current.data.meta.dataVersion,
      season: latest.current.data.meta.dungeon.id,
      layoutReference,
    });
    const { zipSync, strToU8 } = await import('fflate');
    const files: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {
      'session.json': strToU8(JSON.stringify(bundle, null, 1)),
    };
    for (const frame of frames)
      // JPEGs are compressed already; storing them saves the time a second pass would waste.
      files[`frames/${frame.id}.jpg`] = [new Uint8Array(await frame.blob.arrayBuffer()), { level: 0 }];
    downloadBlob(new Blob([zipSync(files) as Uint8Array<ArrayBuffer>], { type: 'application/zip' }), name);
    return name;
  }, [recorder]);

  return {
    enabled,
    ready: recorder !== null,
    stats,
    hooks,
    exportZip,
    clearExported: useCallback(
      async () => (recorder ? recorder.clearExported() : { records: 0, frames: 0 }),
      [recorder],
    ),
    clearAll: useCallback(async () => recorder?.clearAll(), [recorder]),
  };
}

export type DiagnosticsApi = ReturnType<typeof useDiagnostics>;
