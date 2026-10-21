/**
 * The route as a metro line. Floors are stations on one line; a pack pinned to a floor is a solid
 * block over that station, packs that may sit on any floor of a window ride one dashed segment
 * together (any order), and windows that only partly overlap get their own lane with the
 * planner's suggested stops marked. Each segment carries a label card with its packs (card and
 * name) and their pickups; a pack card opens the pack's gift list. The map explains nothing in
 * words: fill, dash and weight are the whole vocabulary.
 */
import { useRef, useState, type ReactNode } from 'react';
import { Eye } from 'lucide-react';
import type { ObservedGift, RoutePlan } from '../../core/types.ts';
import { pick, t } from '../i18n.ts';
import { bandsOf, segmentsFor, stackBlocks, type Segment } from '../lib/metro.ts';
import { useElementWidth, useMeasuredHeights } from '../lib/useElementWidth.ts';
import { DetailSurface, ObservedDetailBody, type DetailMode } from './BlockDetail.tsx';
import { BandLayer, ObservedTile, Station } from './MetroParts.tsx';
import { PackCard } from './PackCard.tsx';
import { PackSheetBody, type PackContext } from './PackSheet.tsx';

/** The run in progress as the map draws it: played stations filled, the frontier ringed. */
export interface MetroRun {
  currentFloor: number;
  /** The start stage is over while floor 1 is still ahead (`run.startDone`, M134). */
  startDone?: boolean;
}

export interface MetroMapProps {
  plan: RoutePlan;
  ctx: PackContext;
  /** The season's last floor (`store.lastFloor`, which reads `rules.floors`) — never 15 in code. */
  lastFloor: number;
  /** `indexes.fixedModeByFloor`: which floors the season fixes to 평행중첩 or EXTREME. */
  fixedModeByFloor: Map<number, 'parallel' | 'extreme'>;
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

/** A one-row label card, until it has been measured. */
const EST_CARD_H = 121;

export function MetroMap({
  plan,
  ctx,
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
  /**
   * A segment's floors in words: 「4층」 for a fixed one, 「4~10층」 for a window.
   *
   * A window really is a range of floors the pack may be taken on, not an uncertainty about one
   * floor, so it reads as a range rather than a guess.
   */
  const floorLabel = (segment: Segment): string =>
    segment.from === segment.to
      ? t('packFloorRange', lang, { floors: String(segment.from) })
      : t('routeFloorRange', lang, { from: String(segment.from), to: String(segment.to) });
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
        {/*
          Which floor this pack sits on, for a reader who cannot see the map.
          The lines, stations and bands are all inside an `aria-hidden` SVG — correctly, since they
          are shape rather than content — but that left the pack names arriving with no floor
          attached at all, which is the one thing the map exists to say. Visually unchanged.
        */}
        <span className="sr-only" data-testid="segment-floors">
          {floorLabel(segment)}
        </span>
        {compact && ctx.onOpenPack ? (
          // A one-floor pack (compact row): the portrait and the name are one button, so a press
          // on either opens the pack (M122 — the portrait alone did nothing) and a reader hears
          // the name once.
          <button
            type="button"
            onClick={() => ctx.onOpenPack?.(pack.packId)}
            aria-haspopup="dialog"
            aria-label={pick(theme.name, lang)}
            className="flex min-w-0 items-center gap-1.5 rounded-sm text-left hover:bg-surface-muted"
            data-testid="segment-pack-open"
          >
            <PackCard pack={theme} size={20} lang={lang} />
            <span className="truncate text-caption-strong text-fg underline decoration-border-strong underline-offset-2">
              {pick(theme.name, lang)}
            </span>
          </button>
        ) : (
          <>
            <PackCard
              pack={theme}
              size={compact ? 20 : 28}
              caption={!compact}
              // The shell's one detail sheet when there is one (M120); a local surface otherwise.
              onOpen={() =>
                ctx.onOpenPack
                  ? ctx.onOpenPack(pack.packId)
                  : setOpen({ kind: 'pack', packId: pack.packId, key, mode })
              }
              lang={lang}
            />
            {compact ? <span className="truncate text-caption-strong ">{pick(theme.name, lang)}</span> : null}
          </>
        )}
        {detailFor(key, mode)}
      </div>
    );
  };

  // ---- start row: observations ----
  // The app plans no starting gift (M145, `APP_START`), so the row holds the observations only —
  // the start keyword and starting-gift line it used to draw above them is gone.
  //
  // Past floor 1 the second line switches from recommendation to record: core stops proposing
  // observations there (the starlight is long spent), so the plan's list is empty and only
  // `run.startGifts` still knows what the run began with. Past the observation screen on floor 1
  // (`startDone`) the decision is just as made, but nothing is recorded yet: the row shows the
  // observations already in hand (core lists them) and no empty slots.
  const history = (run?.currentFloor ?? 1) > 1;
  const closed = history || run?.startDone === true;
  const observedEntries: ObservedGift[] = history
    ? startHeld.flatMap((giftId) =>
        ctx.indexes.giftById.has(giftId) ? [{ giftId, pinned: false, freedPack: null }] : [],
      )
    : plan.start.observed.slice(0, slots);
  const startRow = (mode: DetailMode): ReactNode =>
    slots > 0 ? (
      <div className="flex flex-col gap-1 px-3 py-2 text-caption text-fg-muted" data-testid="start-cell">
        {/*
         * Two different jobs, told apart by whether the run has left floor 1.
         *
         * Before: a decision still open. Every slot the season funds is drawn, filled or not —
         * how many are unspent is part of the plan. The empty ones are not pressable (pinning
         * belongs to the item tab's slots), and if none is filled the row says why rather than
         * showing three unexplained dashed eyes.
         *
         * After: the decision is past, so core clears `start.observed` and empty slots would be
         * meaningless. The row becomes the record of what the run started with. `run.startGifts`
         * holds the observations and the free starting gift together, so a tile's title says
         * 「시작 시 획득」 rather than claiming they were all observed.
         *
         * The row has no label of its own: it is the start cell's one line, and each tile's
         * `title` and the observed sheet say what it is.
         */}
        <div
          className="flex flex-wrap items-center gap-x-3 gap-y-1.5"
          data-testid="observed-line"
          data-history={closed || undefined}
        >
          {observedEntries.map((entry) => (
            <span key={entry.giftId} className="relative inline-flex">
              <ObservedTile
                entry={entry}
                ctx={ctx}
                history={closed}
                onPress={
                  mode === 'sheet'
                    ? () => setOpen({ kind: 'observed', giftId: entry.giftId, mode })
                    : ctx.onToggleObserved && !closed
                      ? () => ctx.onToggleObserved?.(entry.giftId)
                      : undefined
                }
              />
              {detailFor(`observed-${entry.giftId}`, mode)}
            </span>
          ))}
          {closed
            ? null
            : Array.from({ length: Math.max(0, slots - observedEntries.length) }, (_, i) => (
                <span
                  key={`empty-${i}`}
                  role="img"
                  className="inline-flex size-8 items-center justify-center rounded-sm border border-dashed border-border-control text-fg-subtle"
                  title={t('routeObservedEmpty', lang)}
                  aria-label={t('routeObservedEmpty', lang)}
                  data-testid="observed-empty"
                >
                  <Eye size={12} aria-hidden />
                </span>
              ))}
          {observedEntries.length === 0 ? (
            <span className="text-fg-subtle" data-testid="observed-none">
              {t(closed ? 'routeStartHeldNone' : 'routeObservedNone', lang)}
            </span>
          ) : null}
        </div>
      </div>
    ) : null;

  // ---- desktop: horizontal line ----
  const deskRef = useRef<HTMLDivElement>(null);
  const W = useElementWidth(deskRef, 1160);
  const cardRefs = useRef(new Map<string, HTMLDivElement>());
  // A card's height is only knowable after layout, so this is a measurement rather than derived
  // state; `useMeasuredHeights` is where every such read lives.
  const cardHeights = useMeasuredHeights(cardRefs, [plan, W]);
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
          <BandLayer hatchId="metro-hatch" bands={bands} along="x" at={x} step={st} extent={H} />
          <line
            x1={LEFT}
            y1={LINE_Y}
            x2={W - 20}
            y2={LINE_Y}
            stroke="var(--color-border-strong)"
            strokeWidth={4}
          />
          <circle cx={LEFT - 24} cy={LINE_Y} r={9} fill="var(--color-primary)" />
          <text
            x={LEFT - 24}
            y={LINE_Y + 24}
            textAnchor="middle"
            className="text-caption"
            fill="var(--color-fg-muted)"
          >
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
                // Type by role, as CSS: SVG text takes `font-size`/`font-weight` from a class too.
                className={run && f === run.currentFloor ? 'text-caption-strong' : 'text-caption'}
                fontFamily="var(--font-num)"
                fill="var(--color-fg)"
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
                    fill="var(--color-primary)"
                  />
                ) : (
                  <>
                    <line
                      x1={x1}
                      y1={y}
                      x2={x2}
                      y2={y}
                      stroke="var(--color-fg-muted)"
                      strokeWidth={3}
                      strokeDasharray="6 5"
                      strokeLinecap="round"
                    />
                    <circle
                      cx={x1}
                      cy={y}
                      r={4}
                      fill="var(--color-surface)"
                      stroke="var(--color-fg-muted)"
                      strokeWidth={2}
                    />
                    <circle
                      cx={x2}
                      cy={y}
                      r={4}
                      fill="var(--color-surface)"
                      stroke="var(--color-fg-muted)"
                      strokeWidth={2}
                    />
                    {segment.partial
                      ? segment.packs.map((p) => (
                          <circle
                            key={p.packId}
                            cx={x(p.floor)}
                            cy={y}
                            r={7}
                            fill="var(--color-primary)"
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
                      stroke="var(--color-border-strong)"
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
              className={`absolute flex flex-col gap-1.5 rounded-md px-2 py-1.5 shadow-sm ${segment.passed ? 'border border-primary bg-surface-muted' : segment.fixed ? 'border border-primary bg-surface' : 'border-2 border-dashed border-fg-muted bg-surface'}`}
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
          <BandLayer hatchId="metro-hatch-m" bands={bands} along="y" at={y} step={SP} extent={PW} />
          <line
            x1={LX}
            y1={y(1) - 20}
            x2={LX}
            y2={y(lastFloor) + 20}
            stroke="var(--color-border-strong)"
            strokeWidth={4}
          />
          {Array.from({ length: lastFloor }, (_, i) => i + 1).map((f) => (
            <g key={f}>
              <Station cx={LX} cy={y(f)} r={7} half={metro.overlap.has(f)} floor={f} {...stationProps(f)} />
              <text
                x={LX - 16}
                y={y(f) + 4}
                textAnchor="end"
                // Type by role, as CSS: SVG text takes `font-size`/`font-weight` from a class too.
                className={run && f === run.currentFloor ? 'text-caption-strong' : 'text-caption'}
                fontFamily="var(--font-num)"
                fill="var(--color-fg)"
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
                    fill="var(--color-primary)"
                  />
                ) : (
                  <>
                    <line
                      x1={xx}
                      y1={y(segment.from)}
                      x2={xx}
                      y2={y(segment.to)}
                      stroke="var(--color-fg-muted)"
                      strokeWidth={3}
                      strokeDasharray="6 5"
                      strokeLinecap="round"
                    />
                    <circle
                      cx={xx}
                      cy={y(segment.from)}
                      r={4}
                      fill="var(--color-surface)"
                      stroke="var(--color-fg-muted)"
                      strokeWidth={2}
                    />
                    <circle
                      cx={xx}
                      cy={y(segment.to)}
                      r={4}
                      fill="var(--color-surface)"
                      stroke="var(--color-fg-muted)"
                      strokeWidth={2}
                    />
                    {segment.partial
                      ? segment.packs.map((p) => (
                          <circle
                            key={p.packId}
                            cx={xx}
                            cy={y(p.floor)}
                            r={7}
                            fill="var(--color-primary)"
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
              className={`absolute flex ${compact ? 'flex-row items-center gap-2' : 'flex-col gap-1'} overflow-hidden rounded-md px-1.5 py-1 shadow-sm ${segment.passed ? 'border border-primary bg-surface-muted' : segment.fixed ? 'border border-primary bg-surface' : 'border-2 border-dashed border-fg-muted bg-surface'}`}
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
    <div className="rounded-md border border-border bg-surface shadow-sm">
      {desktop}
      {phone}
    </div>
  );
}
