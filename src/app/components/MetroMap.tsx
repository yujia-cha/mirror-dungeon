/**
 * The route as a metro line. Floors are stations on one line; a pack pinned to a floor is a solid
 * block over that station, packs that may sit on any floor of a window ride one dashed segment
 * together (any order), and windows that only partly overlap get their own lane with the
 * planner's suggested stops marked. Each segment carries a label card with its packs (card and
 * name) and their pickups; a pack card opens the pack's gift list. The map explains nothing in
 * words: fill, dash and weight are the whole vocabulary.
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Eye, Star } from 'lucide-react';
import type { ObservedGift, RoutePlan } from '../../core/types.ts';
import { pick, t } from '../i18n.ts';
import { segmentsFor, stackBlocks, type Segment } from '../lib/metro.ts';
import { useElementWidth } from '../lib/useElementWidth.ts';
import { DetailSurface, ObservedDetailBody, type DetailMode } from './BlockDetail.tsx';
import { GiftIcon } from './GiftIcon.tsx';
import { PackCard } from './PackCard.tsx';
import { PackSheetBody, type PackContext } from './PackSheet.tsx';

/** The run in progress as the map draws it: played stations filled, the frontier ringed. */
export interface MetroRun {
  currentFloor: number;
}

export interface MetroMapProps {
  plan: RoutePlan;
  ctx: PackContext;
  /** The season's last floor (`store.lastFloor`, which reads `rules.floors`) — never 15 in code. */
  lastFloor: number;
  /** `indexes.fixedModeByFloor`: which floors the season fixes to 평행중첩 or EXTREME. */
  fixedModeByFloor: Map<number, 'parallel' | 'extreme'>;
  keywordLabel: (id: NonNullable<RoutePlan['start']['keyword']>) => string;
  run?: MetroRun;
  /** `auto` switches horizontal/vertical on the viewport; `vertical` always draws the narrow form (side panels). */
  variant?: 'auto' | 'vertical';
  /** How a pack opens from a label card; the vertical form defaults to a sheet. */
  detailMode?: DetailMode;
  /** How many observation slots the season funds; before the run the row shows them all. */
  slots?: number;
  /**
   * What the run actually started with (`run.startGifts`). Only used once the run is past floor 1,
   * where core clears `start.observed` because the decision is long made — without this the row
   * went blank even for a player who did spend their slots.
   */
  startHeld?: number[];
}

type Open =
  | { kind: 'pack'; packId: number; key: string; mode: DetailMode }
  | { kind: 'observed'; giftId: number; mode: DetailMode };

/**
 * The bands are the season's fixed-mode runs, not the numbers 1-5 / 6-10 / 11-15: the floor range
 * comes from `rules.floors` in one place, and a season with five floors and no parallel block has
 * to draw five stations rather than fifteen. `kind` is what the band means, so the fill no longer
 * depends on a band's position in the list.
 */
type Band = { from: number; to: number; kind: 'normal' | 'parallel' | 'extreme' };

function bandsOf(lastFloor: number, fixedModeByFloor: Map<number, 'parallel' | 'extreme'>): Band[] {
  const bands: Band[] = [];
  for (let floor = 1; floor <= lastFloor; floor += 1) {
    const kind = fixedModeByFloor.get(floor) ?? 'normal';
    const last = bands[bands.length - 1];
    if (last && last.kind === kind) last.to = floor;
    else bands.push({ from: floor, to: floor, kind });
  }
  return bands;
}
/** A one-row label card, until it has been measured. */
const EST_CARD_H = 121;

/** EXTREME is hatched (observation is impossible there), 평행중첩 tinted, the rest bare. */
function bandFill(kind: Band['kind'], hatchId: string): string {
  return kind === 'extreme'
    ? `url(#${hatchId})`
    : kind === 'parallel'
      ? 'var(--color-surface-2)'
      : 'transparent';
}

function Station({
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
function ObservedTile({
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
      <span className="relative">
        <GiftIcon
          gift={gift}
          size={32}
          judgement={ctx.judgements.get(entry.giftId) ?? null}
          lang={ctx.lang}
        />
        <span
          className={`absolute -right-1 -top-1 rounded-full border border-line p-0.5 ${entry.pinned ? 'bg-ink text-ink-fg' : 'bg-surface text-fg-2'}`}
          aria-hidden
        >
          <Eye size={9} />
        </span>
      </span>
      <span className="text-xs text-fg">{name}</span>
    </>
  );
  const title = history ? `${name} · ${why}` : `${name} · ${t('routeObserved', ctx.lang)} · ${why}`;
  return onPress ? (
    <button
      type="button"
      onClick={onPress}
      aria-pressed={entry.pinned}
      aria-label={t('routeObservedToggle', ctx.lang, { name })}
      title={title}
      data-testid="observed-tile"
      data-pinned={entry.pinned || undefined}
      className="inline-flex items-center gap-1.5 rounded-sm px-1 hover:bg-surface-2"
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

export function MetroMap({
  plan,
  ctx,
  keywordLabel,
  lastFloor,
  fixedModeByFloor,
  run,
  variant = 'auto',
  detailMode,
  slots = 0,
  startHeld = [],
}: MetroMapProps) {
  const { lang } = ctx;
  const bands = bandsOf(lastFloor, fixedModeByFloor);
  const metro = segmentsFor(plan);
  const [open, setOpen] = useState<Open | null>(null);
  const close = (): void => setOpen(null);
  const vertical = variant === 'vertical';
  const phoneMode: DetailMode = detailMode ?? 'sheet';
  const deskMode: DetailMode = detailMode ?? 'popover';

  const detailFor = (key: string, mode: DetailMode): ReactNode => {
    if (!open || open.mode !== mode) return null;
    if (open.kind === 'pack' && open.key === key) {
      return (
        <DetailSurface
          mode={mode}
          label={ctx.packName(open.packId)}
          closeLabel={t('routeClose', lang)}
          onClose={close}
        >
          <PackSheetBody packId={open.packId} ctx={ctx} />
        </DetailSurface>
      );
    }
    if (open.kind === 'observed' && key === `observed-${open.giftId}`) {
      const entry = plan.start.observed.find((o) => o.giftId === open.giftId);
      return entry ? (
        <DetailSurface
          mode={mode}
          label={pick(ctx.indexes.giftById.get(entry.giftId)?.name, lang)}
          closeLabel={t('routeClose', lang)}
          onClose={close}
        >
          <ObservedDetailBody entry={entry} ctx={ctx} />
        </DetailSurface>
      ) : null;
    }
    return null;
  };

  const stationProps = (floor: number) => ({
    passed: run !== undefined && floor < run.currentFloor,
    current: run !== undefined && floor === run.currentFloor,
  });
  const packEntry = (
    segment: Segment,
    pack: Segment['packs'][number],
    mode: DetailMode,
    compact: boolean,
  ): ReactNode => {
    const theme = ctx.indexes.packById.get(pack.packId);
    if (!theme) return null;
    const key = `${segment.key}:${pack.packId}`;
    // The map answers 「어느 팩을 어느 층에서」 and nothing else. What a pack drops is the pack
    // sheet's business (a press on the portrait), so no gift icons ride the blocks.
    return (
      <div
        key={key}
        className={`relative flex min-w-0 ${compact ? 'flex-row items-center gap-1.5' : 'flex-col items-center gap-1'}`}
        data-testid="segment-pack"
        data-pack={pack.packId}
      >
        <PackCard
          pack={theme}
          size={compact ? 20 : 28}
          caption={!compact}
          selected={ctx.preferred.has(pack.packId)}
          onOpen={() => setOpen({ kind: 'pack', packId: pack.packId, key, mode })}
          lang={lang}
        />
        {compact ? <span className="truncate text-xs font-medium">{pick(theme.name, lang)}</span> : null}
        {detailFor(key, mode)}
      </div>
    );
  };

  // ---- start row: keyword and observations ----
  const startGift = plan.start.startGift ? ctx.indexes.giftById.get(plan.start.startGift) : undefined;
  const startKeyword = plan.start.keyword ? keywordLabel(plan.start.keyword) : null;
  // The start and the observations are two different decisions — what the run is handed, and what
  // the player spent starlight to pin — so they get a line each instead of sharing one row.
  //
  // Past floor 1 the second line switches from recommendation to record: core stops proposing
  // observations there (the starlight is long spent), so the plan's list is empty and only
  // `run.startGifts` still knows what the run began with.
  const history = (run?.currentFloor ?? 1) > 1;
  const observedEntries: ObservedGift[] = history
    ? startHeld.flatMap((giftId) =>
        ctx.indexes.giftById.has(giftId) ? [{ giftId, pinned: false, freedPack: null }] : [],
      )
    : plan.start.observed.slice(0, slots);
  const startRow = (mode: DetailMode): ReactNode =>
    startGift || startKeyword || slots > 0 ? (
      <div className="flex flex-col gap-1 px-3 py-2 text-xs text-fg-2" data-testid="start-cell">
        {startGift ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5" data-testid="start-line">
            <span className="inline-flex items-center gap-1.5" title={t('routeStartGift', lang)}>
              <GiftIcon
                gift={startGift}
                size={20}
                judgement={ctx.judgements.get(startGift.id) ?? null}
                lang={lang}
              />
              {pick(startGift.name, lang)}
            </span>
          </div>
        ) : startKeyword ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5" data-testid="start-line">
            <span className="inline-flex items-center gap-1" title={t('optionStartKeyword', lang)}>
              <Star size={11} aria-hidden className="text-fg-3" />
              {t('routeStart', lang)} {startKeyword}
            </span>
          </div>
        ) : null}
        {slots > 0 ? (
          /*
           * Two different jobs, told apart by whether the run has left floor 1.
           *
           * Before: a decision still open. Every slot the season funds is drawn, filled or not —
           * how many are unspent is part of the plan. The empty ones are not pressable (pinning
           * belongs to the item tab's slots), and if none is filled the row says why rather than
           * showing three unexplained dashed eyes.
           *
           * After: the decision is past, so core clears `start.observed` and empty slots would be
           * meaningless. The row becomes the record of what the run started with. `run.startGifts`
           * holds the observations and the free starting gift together, which is why the label
           * changes to 「시작 시 보유」 instead of claiming they were all observed.
           *
           * Either way the row carries a visible label: it used to live in `aria-label` only, and
           * a `title` reaches neither touch nor keyboard.
           */
          <div
            className="flex flex-wrap items-center gap-x-3 gap-y-1.5"
            data-testid="observed-line"
            data-history={history || undefined}
          >
            <span className="inline-flex items-center gap-1 text-fg-3">
              <Eye size={11} aria-hidden />
              {t(history ? 'routeStartHeld' : 'routeObserved', lang)}
            </span>
            {observedEntries.map((entry) => (
              <span key={entry.giftId} className="relative inline-flex">
                <ObservedTile
                  entry={entry}
                  ctx={ctx}
                  history={history}
                  onPress={
                    mode === 'sheet'
                      ? () => setOpen({ kind: 'observed', giftId: entry.giftId, mode })
                      : ctx.onToggleObserved && !history
                        ? () => ctx.onToggleObserved?.(entry.giftId)
                        : undefined
                  }
                />
                {detailFor(`observed-${entry.giftId}`, mode)}
              </span>
            ))}
            {history
              ? null
              : Array.from({ length: Math.max(0, slots - observedEntries.length) }, (_, i) => (
                  <span
                    key={`empty-${i}`}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-sm border border-dashed border-line-strong text-fg-3"
                    title={t('routeObservedEmpty', lang)}
                    aria-label={t('routeObservedEmpty', lang)}
                    data-testid="observed-empty"
                  >
                    <Eye size={12} aria-hidden />
                  </span>
                ))}
            {observedEntries.length === 0 ? (
              <span className="text-fg-3" data-testid="observed-none">
                {t(history ? 'routeStartHeldNone' : 'routeObservedNone', lang)}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    ) : null;

  // ---- desktop: horizontal line ----
  const deskRef = useRef<HTMLDivElement>(null);
  const W = useElementWidth(deskRef, 1160);
  const cardRefs = useRef(new Map<string, HTMLDivElement>());
  const [cardHeights, setCardHeights] = useState<Record<string, number>>({});
  useLayoutEffect(() => {
    const next: Record<string, number> = {};
    for (const [key, el] of cardRefs.current) {
      const h = Math.round(el.getBoundingClientRect().height);
      if (h > 0) next[key] = h;
    }
    setCardHeights((prev) => {
      const keys = Object.keys(next);
      return keys.length === Object.keys(prev).length && keys.every((k) => prev[k] === next[k]) ? prev : next;
    });
  }, [plan, W]);
  const LEFT = 60;
  const st = (W - LEFT - 20) / lastFloor;
  const x = (f: number): number => LEFT + (f - 1) * st + st / 2;
  const cards = metro.segments.map((segment) => {
    const span = segment.to - segment.from + 1;
    let cw = st * span - 10;
    if (segment.fixed) cw = Math.max(cw, 110);
    else if (span === 2 && segment.packs.length > 1) cw = Math.max(cw, 170);
    let cl = x(segment.from) - st / 2 + 5;
    if (cl + cw > W - 8) cl = W - 8 - cw;
    return { segment, cl, cw };
  });
  // Label cards stack like a skyline: a card only climbs over the cards it overlaps horizontally,
  // by their measured height, so a two-row card in one place does not lift the whole map.
  const heightOf = (key: string): number => cardHeights[key] ?? EST_CARD_H;
  // Wide cards take the baseline first so a one-floor card climbs over them, not the reverse.
  const order = cards
    .map((_, i) => i)
    .sort((a, b) => cards[b]!.cw - cards[a]!.cw || cards[a]!.segment.from - cards[b]!.segment.from);
  const stacked = stackBlocks(
    order.map((i) => cards[i]!),
    (c) => [c.cl, c.cl + c.cw],
    (c) => heightOf(c.segment.key),
    8,
  );
  const offsets = cards.map(() => 0);
  order.forEach((cardIndex, k) => {
    offsets[cardIndex] = stacked[k]!;
  });
  const ranks = [...new Set(offsets)].sort((a, b) => a - b);
  const deskLanes = offsets.map((o) => ranks.indexOf(o));
  const skyline = Math.max(EST_CARD_H, ...cards.map((c, i) => offsets[i]! + heightOf(c.segment.key)));
  const LINE_Y = 16 + skyline + 42;
  const H = LINE_Y + 46;
  const desktop = vertical ? null : (
    <div className="hidden lg:block" data-testid="metro-columns">
      <div ref={deskRef} className="relative w-full" style={{ height: H }}>
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="absolute left-0 top-0" aria-hidden>
          <defs>
            <pattern
              id="metro-hatch"
              width="7"
              height="7"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(135)"
            >
              <rect width="7" height="7" fill="var(--color-surface)" />
              <rect width="1" height="7" x="6" fill="var(--color-line)" />
            </pattern>
          </defs>
          {bands.map((band) => (
            <rect
              key={band.from}
              x={x(band.from) - st / 2}
              y={0}
              width={st * (band.to - band.from + 1)}
              height={H}
              fill={bandFill(band.kind, 'metro-hatch')}
            />
          ))}
          <line
            x1={LEFT}
            y1={LINE_Y}
            x2={W - 20}
            y2={LINE_Y}
            stroke="var(--color-line-strong)"
            strokeWidth={4}
          />
          <circle cx={LEFT - 24} cy={LINE_Y} r={9} fill="var(--color-ink)" />
          <text x={LEFT - 24} y={LINE_Y + 24} textAnchor="middle" fontSize={11} fill="var(--color-fg-2)">
            {t('routeStart', lang)}
          </text>
          {Array.from({ length: lastFloor }, (_, i) => i + 1).map((f) => (
            <g key={f}>
              <Station
                cx={x(f)}
                cy={LINE_Y}
                r={7}
                half={metro.overlap.has(f)}
                floor={f}
                {...stationProps(f)}
              />
              <text
                x={x(f)}
                y={LINE_Y + 24}
                textAnchor="middle"
                fontSize={12}
                fontFamily="var(--font-num)"
                fill="var(--color-fg)"
                fontWeight={run && f === run.currentFloor ? 700 : undefined}
              >
                {f}
              </text>
            </g>
          ))}
          {cards.map(({ segment }, i) => {
            const y = LINE_Y - 28 - offsets[i]!;
            const x1 = x(segment.from);
            const x2 = x(segment.to);
            return (
              <g
                key={segment.key}
                data-testid="segment-line"
                data-from={segment.from}
                data-to={segment.to}
                data-lane={deskLanes[i]}
              >
                {segment.fixed ? (
                  <rect
                    x={x1 - st / 2 + 6}
                    y={y - 9}
                    width={st - 12}
                    height={18}
                    rx={4}
                    fill="var(--color-ink)"
                  />
                ) : (
                  <>
                    <line
                      x1={x1}
                      y1={y}
                      x2={x2}
                      y2={y}
                      stroke="var(--color-fg-2)"
                      strokeWidth={3}
                      strokeDasharray="6 5"
                      strokeLinecap="round"
                    />
                    <circle
                      cx={x1}
                      cy={y}
                      r={4}
                      fill="var(--color-surface)"
                      stroke="var(--color-fg-2)"
                      strokeWidth={2}
                    />
                    <circle
                      cx={x2}
                      cy={y}
                      r={4}
                      fill="var(--color-surface)"
                      stroke="var(--color-fg-2)"
                      strokeWidth={2}
                    />
                    {segment.partial
                      ? segment.packs.map((p) => (
                          <circle
                            key={p.packId}
                            cx={x(p.floor)}
                            cy={y}
                            r={7}
                            fill="var(--color-ink)"
                            data-testid="suggested"
                            data-floor={p.floor}
                          />
                        ))
                      : null}
                  </>
                )}
                {Array.from({ length: segment.to - segment.from + 1 }, (_, k) => segment.from + k).map(
                  (f) => (
                    <line
                      key={f}
                      x1={x(f)}
                      y1={y + 8}
                      x2={x(f)}
                      y2={LINE_Y - 8}
                      stroke="var(--color-line-strong)"
                      strokeWidth={1}
                      strokeDasharray="2 3"
                    />
                  ),
                )}
              </g>
            );
          })}
        </svg>
        {cards.map(({ segment, cl, cw }, i) => {
          const y = LINE_Y - 28 - offsets[i]!;
          return (
            <div
              key={segment.key}
              ref={(el) => {
                if (el) cardRefs.current.set(segment.key, el);
                else cardRefs.current.delete(segment.key);
              }}
              className={`absolute flex flex-col gap-1.5 rounded-md px-2 py-1.5 shadow-card ${segment.passed ? 'border border-ink bg-surface-2' : segment.fixed ? 'border border-ink bg-surface' : 'border-[1.5px] border-dashed border-fg-2 bg-surface'}`}
              style={{ left: cl, width: cw, bottom: H - y + 14 }}
              data-testid="segment"
              data-from={segment.from}
              data-to={segment.to}
              data-partial={segment.partial || undefined}
              data-passed={segment.passed || undefined}
              data-lane={deskLanes[i]}
            >
              <div className="flex flex-wrap items-start gap-x-3 gap-y-1.5">
                {segment.packs.map((p) => packEntry(segment, p, deskMode, false))}
              </div>
            </div>
          );
        })}
      </div>
      {startRow(deskMode)}
    </div>
  );

  // ---- phone: vertical line ----
  const phoneRef = useRef<HTMLDivElement>(null);
  const PW = useElementWidth(phoneRef, 342);
  const TOP = 30;
  const SP = 64;
  const LX = 36;
  const y = (f: number): number => TOP + (f - 1) * SP + SP / 2;
  const PH = TOP + lastFloor * SP + 10;
  const LANE_W = 18;
  const X0 = LX + 26;
  const base = X0 + metro.lanes * LANE_W + 6;
  const avail = PW - base - 4;
  const phone = (
    <div className={vertical ? undefined : 'lg:hidden'} data-testid="metro-rows">
      {startRow(phoneMode)}
      <div ref={phoneRef} className="relative w-full" style={{ height: PH }}>
        <svg width={PW} height={PH} viewBox={`0 0 ${PW} ${PH}`} className="absolute left-0 top-0" aria-hidden>
          <defs>
            <pattern
              id="metro-hatch-m"
              width="7"
              height="7"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(135)"
            >
              <rect width="7" height="7" fill="var(--color-surface)" />
              <rect width="1" height="7" x="6" fill="var(--color-line)" />
            </pattern>
          </defs>
          {bands.map((band) => (
            <rect
              key={band.from}
              x={0}
              y={y(band.from) - SP / 2}
              width={PW}
              height={SP * (band.to - band.from + 1)}
              fill={bandFill(band.kind, 'metro-hatch-m')}
            />
          ))}
          <line
            x1={LX}
            y1={y(1) - 20}
            x2={LX}
            y2={y(lastFloor) + 20}
            stroke="var(--color-line-strong)"
            strokeWidth={4}
          />
          {Array.from({ length: lastFloor }, (_, i) => i + 1).map((f) => (
            <g key={f}>
              <Station cx={LX} cy={y(f)} r={7} half={metro.overlap.has(f)} floor={f} {...stationProps(f)} />
              <text
                x={LX - 16}
                y={y(f) + 4}
                textAnchor="end"
                fontSize={12}
                fontFamily="var(--font-num)"
                fill="var(--color-fg)"
                fontWeight={run && f === run.currentFloor ? 700 : undefined}
              >
                {f}
              </text>
            </g>
          ))}
          {metro.segments.map((segment) => {
            const xx = X0 + segment.lane * LANE_W;
            return (
              <g
                key={segment.key}
                data-testid="segment-line"
                data-from={segment.from}
                data-to={segment.to}
                data-lane={segment.lane}
              >
                {segment.fixed ? (
                  <rect
                    x={xx - 8}
                    y={y(segment.from) - SP / 2 + 6}
                    width={16}
                    height={SP - 12}
                    rx={4}
                    fill="var(--color-ink)"
                  />
                ) : (
                  <>
                    <line
                      x1={xx}
                      y1={y(segment.from)}
                      x2={xx}
                      y2={y(segment.to)}
                      stroke="var(--color-fg-2)"
                      strokeWidth={3}
                      strokeDasharray="6 5"
                      strokeLinecap="round"
                    />
                    <circle
                      cx={xx}
                      cy={y(segment.from)}
                      r={4}
                      fill="var(--color-surface)"
                      stroke="var(--color-fg-2)"
                      strokeWidth={2}
                    />
                    <circle
                      cx={xx}
                      cy={y(segment.to)}
                      r={4}
                      fill="var(--color-surface)"
                      stroke="var(--color-fg-2)"
                      strokeWidth={2}
                    />
                    {segment.partial
                      ? segment.packs.map((p) => (
                          <circle
                            key={p.packId}
                            cx={xx}
                            cy={y(p.floor)}
                            r={7}
                            fill="var(--color-ink)"
                            data-testid="suggested"
                            data-floor={p.floor}
                          />
                        ))
                      : null}
                  </>
                )}
              </g>
            );
          })}
        </svg>
        {metro.segments.map((segment) => {
          const span = segment.to - segment.from + 1;
          const others = segment.partial
            ? metro.segments
                .filter((o) => o !== segment && !o.fixed && !(o.to < segment.from || o.from > segment.to))
                .map((o) => o.lane)
            : [];
          const cols = segment.partial ? 1 + Math.max(segment.lane, ...others) : 1;
          const cw = avail / cols - 4;
          const cl = base + (segment.lane % cols) * (avail / cols);
          const compact = span === 1;
          return (
            <div
              key={segment.key}
              className={`absolute flex ${compact ? 'flex-row items-center gap-2' : 'flex-col gap-1'} overflow-hidden rounded-md px-1.5 py-1 shadow-card ${segment.passed ? 'border border-ink bg-surface-2' : segment.fixed ? 'border border-ink bg-surface' : 'border-[1.5px] border-dashed border-fg-2 bg-surface'}`}
              style={{ left: cl, top: y(segment.from) - SP / 2 + 4, width: cw, height: SP * span - 8 }}
              data-testid="segment"
              data-from={segment.from}
              data-to={segment.to}
              data-partial={segment.partial || undefined}
              data-passed={segment.passed || undefined}
              data-lane={segment.lane}
            >
              {/* One floor is 56px tall: packs sit in a row there, in a column otherwise. */}
              <div
                className={`flex min-w-0 ${compact ? 'flex-wrap items-center gap-x-2 gap-y-1' : 'flex-wrap items-start gap-x-2 gap-y-1'}`}
              >
                {segment.packs.map((p) => packEntry(segment, p, phoneMode, compact))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="rounded-md border border-line bg-surface shadow-card">
      {desktop}
      {phone}
    </div>
  );
}
