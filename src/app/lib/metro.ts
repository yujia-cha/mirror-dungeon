/**
 * The route as a metro line: floors are stations, required packs are segments. Packs that share
 * exactly the same floor window ride one segment together, in any order; windows that only partly
 * overlap (2-3 and 3-4) stay apart and keep the planner's suggested floors, because each such
 * window assumes the other pack moves out of the way.
 */
import type { RoutePlan } from '../../core/types.ts';

export interface SegmentPack {
  packId: number;
  /** The floor the planner assigned; only meaningful when the segment is partial or fixed. */
  floor: number;
  /** Exclusive pickups on that floor. */
  gifts: number[];
}

export interface Segment {
  key: string;
  from: number;
  to: number;
  fixed: boolean;
  packs: SegmentPack[];
  /** Overlaps another window without being equal to it: suggested floors matter here. */
  partial: boolean;
  /** Row on which the segment is drawn so overlapping ones do not collide (floor-based). */
  lane: number;
  /** A pack already entered on a played floor (run in progress). */
  passed: boolean;
}

export interface Metro {
  segments: Segment[];
  /** Stations inside two or more partially overlapping windows: only one of those packs fits. */
  overlap: Set<number>;
  lanes: number;
  /** Floors nothing is planned on, as contiguous runs; played ones are marked. */
  freeRuns: { from: number; to: number; passed: boolean }[];
}

const floorsOf = (s: { from: number; to: number }): number[] => Array.from({ length: s.to - s.from + 1 }, (_, i) => s.from + i);

/** First-fit lanes over arbitrary extents; used for floors (phone) and for card pixels (desktop). */
export function assignLanes<T>(items: T[], extent: (item: T) => [number, number], gap = 0): number[] {
  const laneEnd: number[] = [];
  return items.map((item) => {
    const [start, end] = extent(item);
    let lane = laneEnd.findIndex((e) => e + gap < start);
    if (lane === -1) {
      lane = laneEnd.length;
      laneEnd.push(end);
    } else laneEnd[lane] = end;
    return lane;
  });
}

/**
 * Skyline packing for blocks that hang above one baseline: each block goes as low as it can
 * without touching a block already placed that it overlaps horizontally (with `gap` around it).
 * Returns the distance from the baseline to each block's bottom edge.
 */
export function stackBlocks<T>(items: T[], extent: (item: T) => [number, number], height: (item: T) => number, gap = 0): number[] {
  const placed: { start: number; end: number; top: number }[] = [];
  return items.map((item) => {
    const [start, end] = extent(item);
    let offset = 0;
    for (const p of placed) if (start <= p.end + gap && p.start <= end + gap) offset = Math.max(offset, p.top + gap);
    placed.push({ start, end, top: offset + height(item) });
    return offset;
  });
}

export function segmentsFor(plan: RoutePlan): Metro {
  const groups = new Map<string, Segment>();
  for (const floor of plan.floors) {
    if (floor.packId === null) continue;
    const from = floor.window?.from ?? floor.floor;
    const to = floor.window?.to ?? floor.floor;
    const key = `${from}-${to}`;
    const segment = groups.get(key) ?? { key, from, to, fixed: from === to, packs: [], partial: false, lane: 0, passed: floor.passed };
    segment.packs.push({
      packId: floor.packId,
      floor: floor.floor,
      gifts: floor.pickups.filter((p) => p.kind === 'exclusive').map((p) => p.giftId),
    });
    groups.set(key, segment);
  }
  const segments = [...groups.values()].sort((a, b) => a.from - b.from || a.to - b.to);
  for (const segment of segments) {
    if (segment.fixed) continue;
    const mine = new Set(floorsOf(segment));
    segment.partial = segments.some(
      (other) => other !== segment && !other.fixed && other.key !== segment.key && floorsOf(other).some((f) => mine.has(f)),
    );
  }
  const lanes = assignLanes(segments, (s) => [s.from, s.to]);
  segments.forEach((s, i) => {
    s.lane = lanes[i]!;
  });
  const counts = new Map<number, number>();
  for (const segment of segments) {
    if (!segment.partial) continue;
    for (const f of floorsOf(segment)) counts.set(f, (counts.get(f) ?? 0) + 1);
  }
  const overlap = new Set([...counts].filter(([, n]) => n >= 2).map(([f]) => f));

  const covered = new Set(segments.flatMap(floorsOf));
  const freeRuns: { from: number; to: number; passed: boolean }[] = [];
  for (const floor of plan.floors) {
    if (covered.has(floor.floor)) continue;
    const last = freeRuns[freeRuns.length - 1];
    if (last && last.to === floor.floor - 1 && last.passed === floor.passed) last.to = floor.floor;
    else freeRuns.push({ from: floor.floor, to: floor.floor, passed: floor.passed });
  }
  return { segments, overlap, lanes: Math.max(1, ...lanes.map((l) => l + 1)), freeRuns };
}
