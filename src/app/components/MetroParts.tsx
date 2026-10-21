/**
 * The metro map's parts (M167, split out of `MetroMap.tsx`): the mode bands behind the line and
 * the hatch they use (`bandsOf` in `lib/metro.ts` says where they are), a station, and an observed
 * gift's tile on the start row. Both of the map's
 * forms — the desktop's horizontal line and the phone's vertical one — draw these; the map itself
 * keeps the geometry and the label cards.
 */
import type { ObservedGift } from '../../core/types.ts';
import { pick, t } from '../i18n.ts';
import type { Band } from '../lib/metro.ts';
import { GiftIcon } from './GiftIcon.tsx';
import type { PackContext } from './PackSheet.tsx';

/** EXTREME is hatched (observation is impossible there), 평행중첩 tinted, the rest bare. */
function bandFill(kind: Band['kind'], hatchId: string): string {
  return kind === 'extreme'
    ? `url(#${hatchId})`
    : kind === 'parallel'
      ? 'var(--color-surface-muted)'
      : 'transparent';
}

/**
 * The hatch pattern and the bands behind one line, drawn first so everything else sits on them.
 * `along` is the axis the floors run on: the desktop lays them out left to right, the phone top to
 * bottom; a band then spans the SVG across the other axis (`extent`).
 */
export function BandLayer({
  hatchId,
  bands,
  along,
  at,
  step,
  extent,
}: {
  /** The pattern's id — unique per SVG, since both forms may be in the document at once. */
  hatchId: string;
  bands: Band[];
  along: 'x' | 'y';
  /** Where a floor's station sits on that axis. */
  at: (floor: number) => number;
  /** One floor's length on that axis. */
  step: number;
  /** The SVG's size across the axis. */
  extent: number;
}) {
  return (
    <>
      <defs>
        <pattern
          id={hatchId}
          width="7"
          height="7"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(135)"
        >
          <rect width="7" height="7" fill="var(--color-surface)" />
          <rect width="1" height="7" x="6" fill="var(--color-border)" />
        </pattern>
      </defs>
      {bands.map((band) => {
        const start = at(band.from) - step / 2;
        const length = step * (band.to - band.from + 1);
        const fill = bandFill(band.kind, hatchId);
        return along === 'x' ? (
          <rect key={band.from} x={start} y={0} width={length} height={extent} fill={fill} />
        ) : (
          <rect key={band.from} x={0} y={start} width={extent} height={length} fill={fill} />
        );
      })}
    </>
  );
}

export function Station({
  cx,
  cy,
  r,
  half,
  floor,
  passed = false,
  current = false,
}: {
  cx: number;
  cy: number;
  r: number;
  half: boolean;
  floor: number;
  /** Run progress: already played, or the floor about to be decided. */
  passed?: boolean;
  current?: boolean;
}) {
  return (
    <g
      data-testid="station"
      data-floor={floor}
      data-overlap={half || undefined}
      data-passed={passed || undefined}
      data-current={current || undefined}
    >
      {current ? (
        <circle cx={cx} cy={cy} r={r + 4} fill="none" stroke="var(--color-fg)" strokeWidth={1.5} />
      ) : null}
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill={passed ? 'var(--color-fg)' : 'var(--color-surface)'}
        stroke="var(--color-fg)"
        strokeWidth={2}
      />
      {half && !passed ? (
        <path d={`M${cx} ${cy - r} A${r} ${r} 0 0 0 ${cx} ${cy + r} Z`} fill="var(--color-fg)" />
      ) : null}
      {passed ? (
        <path
          d={`M${cx - 3.5} ${cy} l2.5 2.5 l4.5 -5`}
          fill="none"
          stroke="var(--color-surface)"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
    </g>
  );
}

/**
 * An observed gift on the start row: the eye badge is filled when the player pinned it, hollow when
 * the planner recommends it. With `history` the tile is the record of a run already under way —
 * there is no pin to reason about and nothing left to toggle.
 */
export function ObservedTile({
  entry,
  ctx,
  onPress,
  history = false,
}: {
  entry: ObservedGift;
  ctx: PackContext;
  onPress?: () => void;
  history?: boolean;
}) {
  const gift = ctx.indexes.giftById.get(entry.giftId);
  if (!gift) return null;
  const name = pick(gift.name, ctx.lang);
  const why = history
    ? t('routeStartHeld', ctx.lang)
    : entry.pinned
      ? t('routeObservedPinned', ctx.lang)
      : entry.freedPack !== null
        ? t('routeObservedFrees', ctx.lang, { pack: ctx.packName(entry.freedPack) })
        : t('routeObservedRescue', ctx.lang);
  const body = (
    <>
      <GiftIcon gift={gift} size={32} judgement={ctx.judgements.get(entry.giftId) ?? null} lang={ctx.lang} />
      <span className="text-caption text-fg">{name}</span>
    </>
  );
  const title = history ? `${name} · ${why}` : `${name} · ${t('routeObserved', ctx.lang)} · ${why}`;
  return onPress ? (
    <button
      type="button"
      onClick={onPress}
      aria-pressed={entry.pinned}
      aria-label={t('giftsObserve', ctx.lang, { name })}
      title={title}
      data-testid="observed-tile"
      data-pinned={entry.pinned || undefined}
      className="inline-flex items-center gap-1.5 rounded-sm px-1 hover:bg-surface-muted"
    >
      {body}
    </button>
  ) : (
    <span
      className="inline-flex items-center gap-1.5"
      title={title}
      data-testid="observed-tile"
      data-pinned={entry.pinned || undefined}
    >
      {body}
    </span>
  );
}
