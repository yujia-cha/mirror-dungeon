/**
 * The read loop in a bad environment (M142).
 *
 *   npm run capture:stress
 *   npm run capture:stress -- --phases 6 --seeds 3
 *
 * No game images: the timelines are synthetic (`lib/capture-stress.ts` — click-throughs of popups
 * at the owner's pace, a popup under a confirm dialog's read, a battle, the pack picker, maps) and
 * the loop runs on the bench's simulated clock (`lib/capture-bench.ts`) with the stress knobs:
 * frames that arrive late, irregularly or not at all, reads up to ten times slower, late timers and
 * 500 ms stalls of the page's thread. For each preset × condition it prints the popups missed
 * (of those the page could have seen — on a frame that arrived, outside a stall), all events
 * missed, the mean latency, the OCR occupancy, the backlog's overflow and the highest load level.
 * `fixed 250 (M141)` is the loop before M142: one interval, no load ladder.
 *
 * Then the quiet screens — a map held still for two minutes, a minute of battle — where the
 * controller's savings show: ticks, and under load, OCR.
 *
 * Each row is the mean over timer phases × seeds. Flags: --phases (default 4), --seeds (default 2).
 */
import { READ_INTERVALS, type ReadIntervalPreset } from '../src/app/capture/loop.ts';
import type { IntervalRange } from '../src/app/capture/pace.ts';
import {
  conditions,
  quietSteps,
  sessionSteps,
  stressRun,
  timelineOfSteps,
  type Step,
  type StressRun,
} from './lib/capture-stress.ts';
import type { StressKnobs } from './lib/capture-bench.ts';
import { flagValue } from './lib/io.ts';

const PHASES = Number(flagValue('--phases') ?? 4);
const SEEDS = Number(flagValue('--seeds') ?? 2);

interface Preset {
  name: string;
  range: IntervalRange;
  adaptive: boolean;
}

const PRESETS: Preset[] = [
  ...(Object.keys(READ_INTERVALS) as ReadIntervalPreset[]).map((name) => ({
    name,
    range: READ_INTERVALS[name],
    adaptive: true,
  })),
  { name: 'fixed 250 (M141)', range: { min: 250, max: 250 }, adaptive: false },
];

async function averaged(steps: readonly Step[], preset: Preset, stress: StressKnobs) {
  const runs: StressRun[] = [];
  for (let seed = 1; seed <= SEEDS; seed++)
    for (let p = 0; p < PHASES; p++)
      runs.push(
        await stressRun(steps, {
          range: preset.range,
          adaptive: preset.adaptive,
          firstTickMs: Math.round(((p + 0.5) / PHASES) * preset.range.min),
          stress: { ...stress, seed: seed * 7919 + p },
        }),
      );
  const mean = (f: (r: StressRun) => number) => runs.reduce((a, r) => a + f(r), 0) / runs.length;
  return {
    missedPopups: mean((r) => r.missedPopups.length),
    missed: mean((r) => r.missed.length),
    latency: mean((r) => r.meanLatencyMs),
    ocr: mean((r) => r.ocrPercent),
    ticks: mean((r) => r.result.ticks),
    dropped: mean((r) => r.result.queueDropped),
    maxLevel: Math.max(...runs.map((r) => r.result.maxLevel)),
    popups: mean((r) => r.result.events.filter((e) => e.event.kind === 'got').length),
  };
}

async function main(): Promise<void> {
  const session = sessionSteps();
  const { spans } = timelineOfSteps(session);
  const duration = spans.at(-1)!.end;
  const popups = session.filter(([s]) => s.kind === 'popup').length;
  console.log(`# capture:stress — ${(duration / 1000).toFixed(1)} s of screens, ${popups} popups`);
  console.log('');
  console.log(
    `Each row is the mean of ${PHASES} timer phases × ${SEEDS} seeds. Missed popups count only those on a frame that arrived outside a stall.`,
  );
  console.log('');
  console.log(
    '| condition | preset | range | missed popups | missed events | mean latency | OCR busy | ticks | queue overflow | max level |',
  );
  console.log('|---|---|---|---|---|---|---|---|---|---|');
  for (const condition of conditions(duration)) {
    for (const preset of PRESETS) {
      const m = await averaged(session, preset, condition.stress);
      console.log(
        `| ${condition.name} | ${preset.name} | ${preset.range.min}–${preset.range.max} ms | ${m.missedPopups.toFixed(2)} | ${m.missed.toFixed(2)} | ${Math.round(m.latency)} ms | ${m.ocr.toFixed(1)}% | ${Math.round(m.ticks)} | ${m.dropped.toFixed(1)} | ${m.maxLevel} |`,
      );
    }
  }

  console.log('');
  console.log('## Quiet screens');
  console.log('');
  console.log('| screen | condition | preset | ticks | reads OCR busy | max level |');
  console.log('|---|---|---|---|---|---|');
  const quiet: { name: string; steps: Step[] }[] = [
    { name: 'map held still 120 s', steps: quietSteps(120_000) },
    { name: 'battle 60 s', steps: [[{ kind: 'nothing', animated: true }, 60_000]] },
  ];
  for (const screen of quiet)
    for (const [name, stress] of [
      ['ideal', {}],
      ['reads ×4', { frames: {}, readCost: 4 }],
      ['reads ×10', { frames: {}, readCost: 10 }],
    ] as [string, StressKnobs][])
      for (const preset of [PRESETS[2]!, PRESETS[4]!]) {
        const m = await averaged(screen.steps, preset, stress);
        console.log(
          `| ${screen.name} | ${name} | ${preset.name} | ${Math.round(m.ticks)} | ${m.ocr.toFixed(1)}% | ${m.maxLevel} |`,
        );
      }
}

await main();
