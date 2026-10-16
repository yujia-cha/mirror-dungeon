/**
 * Does the decision card name the goal that caused the conflict? (M115, docs/design/drop-suggestions.md)
 *
 * Boards: the seeded random boards M87 measured on (3~82 goals, pack-bound and fusion-only, the
 * fire deck on even boards and the 검계 deck on odd ones, floors 1~15 Hard, observation on). Each
 * board's goals are added one at a time, as a player picks them; the first prefix whose plan loses a
 * goal is a case, and the goal added last — the one the plan without it fits — is its cause X.
 *
 * For each case, before (M80/M81's candidates) and after (M115):
 * - (a) X is a candidate at all (no cap);
 * - (b) X has a bar within the worker's budget (`ANALYSIS_BUDGET_MS`, the real clock, ten candidates);
 * - (c) X is named in the card's header: before, only lost goals were (`pack-conflict`); after, also
 *   the causes and rivals in the trade-off lines.
 * And the time the first bar and the last bar (within the budget) arrive.
 *
 * Local only (`npx tsx scripts/measure-drop-causes.ts`), excluded from coverage like the capture CLIs.
 */
import { loadGameDataFromDisk } from '../src/core/data/node.ts';
import {
  buildIndexes,
  conflictRootsOf,
  createDropEffects,
  defaultOptions,
  planRoute,
  wantedRoots,
} from '../src/core/index.ts';
import type { PlanInput, RoutePlan } from '../src/core/types.ts';
import { ANALYSIS_BUDGET_MS } from '../src/app/lib/planner-protocol.ts';

const data = loadGameDataFromDisk();
const indexes = buildIndexes(data);
const FIRE_DECK = [10112, 10216, 10311, 10415, 10512, 10604, 10715, 10808, 10916, 11009, 11115, 11216];
const BLADE_LINEAGE_DECK = [10403, 10308, 10208, 10108, 11005, 10104];

const giftsOf = (kind: string): number[] =>
  data.gifts
    .filter((g) => g.obtainable && g.acquisition.kind === kind && !indexes.freelyAvailableGifts.has(g.id))
    .map((g) => g.id)
    .sort((a, b) => a - b);

function boards(): PlanInput[] {
  const pool = giftsOf('packLimited');
  const fusions = giftsOf('fusionOnly');
  let seed = 20261006;
  const next = (): number => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  return Array.from({ length: 120 }, (_, b) => {
    const size = 3 + Math.floor(next() * 80);
    const ids = new Set<number>();
    while (ids.size < size) {
      const source = next() < 0.3 ? fusions : pool;
      ids.add(source[Math.floor(next() * source.length)]!);
    }
    const fire = b % 2 === 0;
    return {
      deck: fire ? FIRE_DECK : BLADE_LINEAGE_DECK,
      wanted: [...ids].map((giftId) => ({ giftId, required: false })),
      options: {
        ...defaultOptions(),
        lastFloor: 15,
        hardFromFloor: 1,
        ...(fire ? { deployed: FIRE_DECK.slice(0, 7) } : {}),
      },
    };
  });
}

/** The first prefix that loses a goal, with the goal added last; null when the whole board fits. */
function firstConflict(board: PlanInput): { input: PlanInput; plan: RoutePlan; cause: number } | null {
  for (let n = 1; n <= board.wanted.length; n += 1) {
    const input = { ...board, wanted: board.wanted.slice(0, n) };
    const plan = planRoute(input, data, indexes);
    if (conflictRootsOf(plan, input, data, indexes).length > 0)
      return { input, plan, cause: input.wanted[n - 1]!.giftId };
  }
  return null;
}

/** M80/M81's candidate order: pack-conflict sides, contested-floor occupants, observed, routed. */
function beforeCandidates(input: PlanInput, plan: RoutePlan): number[] {
  const roots = wantedRoots(input, data, indexes);
  const lost = plan.unresolved.filter((u) => u.reason === 'pack-conflict').flatMap((u) => roots(u.giftId));
  const routed = plan.floors.flatMap((f) => f.pickups.flatMap((p) => roots(p.giftId)));
  const observed = plan.start.observed.flatMap((o) => roots(o.giftId));
  // Every floor is contested in a 15-floor run (see the proposal), so occupants ≈ routed.
  const tiers = [lost, routed, observed, routed];
  const wanted = new Set(input.wanted.map((w) => w.giftId));
  const out: number[] = [];
  for (const tier of tiers)
    for (const id of [...new Set(tier)].sort((a, b) => a - b))
      if (wanted.has(id) && !out.includes(id)) out.push(id);
  return out;
}

const ms = (start: number): number => performance.now() - start;

interface Row {
  goals: number;
  conflicts: number;
  before: { candidate: boolean; bar: boolean; header: boolean };
  after: {
    candidate: boolean;
    bar: boolean;
    header: boolean;
    firstBar: number;
    lastBar: number;
    bars: number;
    tradeoffs: number;
  };
}

const rows: Row[] = [];
for (const board of boards()) {
  const found = firstConflict(board);
  if (!found) continue;
  const { input, plan, cause } = found;

  // Before: the old candidates, measured in order until the budget runs out.
  const old = beforeCandidates(input, plan);
  const oldLost = plan.unresolved.filter((u) => u.reason === 'pack-conflict').map((u) => u.giftId);
  let start = performance.now();
  const oldBars: number[] = [];
  for (const id of old.slice(0, 10)) {
    planRoute({ ...input, wanted: input.wanted.filter((w) => w.giftId !== id) }, data, indexes);
    oldBars.push(id);
    if (ms(start) >= ANALYSIS_BUDGET_MS) break;
  }

  // After: the worker's steps against the same budget.
  start = performance.now();
  const steps = createDropEffects(input, data, indexes, plan);
  let firstBar = Number.NaN;
  do {
    steps.step();
    if (Number.isNaN(firstBar) && steps.snapshot().effects.length > 0) firstBar = ms(start);
  } while (!steps.done() && ms(start) < ANALYSIS_BUDGET_MS);
  const lastBar = ms(start);
  const shown = steps.finish();
  steps.extend();
  while (!steps.done()) steps.step();
  const all = steps.finish();
  const named = new Set([
    ...conflictRootsOf(plan, input, data, indexes),
    ...shown.tradeoffs.flatMap((t) => [...t.causes, ...t.rivals]),
  ]);

  rows.push({
    goals: input.wanted.length,
    conflicts: shown.conflicts,
    before: { candidate: old.includes(cause), bar: oldBars.includes(cause), header: oldLost.includes(cause) },
    after: {
      candidate: all.effects.some((e) => e.giftId === cause),
      bar: shown.effects.some((e) => e.giftId === cause),
      header: named.has(cause),
      firstBar,
      lastBar,
      bars: shown.effects.length,
      tradeoffs: shown.tradeoffs.length,
    },
  });
}

const pct = (n: number): string => `${n}/${rows.length} (${Math.round((n / rows.length) * 100)}%)`;
const count = (f: (r: Row) => boolean): number => rows.filter(f).length;
const quantile = (values: number[], q: number): number => {
  const sorted = values.filter((v) => !Number.isNaN(v)).sort((a, b) => a - b);
  return sorted.length === 0
    ? Number.NaN
    : sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
};
console.log(
  `cases: ${rows.length} of 120 boards (goals ${quantile(
    rows.map((r) => r.goals),
    0,
  )}~${quantile(
    rows.map((r) => r.goals),
    1,
  )})`,
);
console.log('| | before | after |');
console.log('|---|---|---|');
console.log(
  `| (a) cause is a candidate | ${pct(count((r) => r.before.candidate))} | ${pct(count((r) => r.after.candidate))} |`,
);
console.log(
  `| (b) cause has a bar in ${ANALYSIS_BUDGET_MS}ms | ${pct(count((r) => r.before.bar))} | ${pct(count((r) => r.after.bar))} |`,
);
console.log(
  `| (c) cause named in the header | ${pct(count((r) => r.before.header))} | ${pct(count((r) => r.after.header))} |`,
);
for (const r of rows.filter((row) => !row.after.header))
  console.log(
    `  not named: ${r.goals} goals, ${r.conflicts} conflicting, ${r.after.bars} bars, ${r.after.tradeoffs} trade-offs`,
  );
const first = rows.map((r) => r.after.firstBar);
const last = rows.map((r) => r.after.lastBar);
console.log(
  `first bar: median ${quantile(first, 0.5).toFixed(0)}ms · p90 ${quantile(first, 0.9).toFixed(0)}ms · max ${quantile(first, 1).toFixed(0)}ms`,
);
console.log(
  `last bar in budget: median ${quantile(last, 0.5).toFixed(0)}ms · p90 ${quantile(last, 0.9).toFixed(0)}ms; bars median ${quantile(
    rows.map((r) => r.after.bars),
    0.5,
  )}`,
);
