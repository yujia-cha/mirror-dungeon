/**
 * The gifts to pick from, as tiles rather than rows: portrait, name, and the one condition that
 * decides whether the deck activates it. Pressing the tile makes it a goal; pressing the name
 * opens its sheet.
 *
 * A tile locks when the goals already settle it: an upgrade child (조합 계승) whose parent is a
 * goal, a gift some goal's recipe already consumes (포함), or a fusion that would fight a goal
 * over an ingredient (얽힘). `title` says which goal did it.
 */
import { useEffect, useRef } from 'react';
import { CornerDownRight, Check, Link2 } from 'lucide-react';
import { LinkButton } from './ui.tsx';
import type { Enums, Gift } from '../../core/schema.ts';
import type { Block } from '../lib/entangle.ts';
import { isMarked, type GiftTileData } from '../lib/gift-tile.ts';
import { t, pick, type Lang } from '../i18n.ts';
import { conditionShort, decidingReport } from '../lib/gift-condition.ts';
import { tileColumns, useTileIconSize } from '../lib/icon-size.ts';
import { judgementOf } from '../lib/judgement.ts';
import { preloadGlyphs } from '../lib/fonts.ts';
import { GiftIcon } from './GiftIcon.tsx';

export function GiftTileGrid({
  tiles,
  wanted,
  entangled,
  blocked,
  giftName,
  enums,
  lang,
  onToggle,
  onOpen,
  reasons,
  scores,
}: {
  tiles: GiftTileData[];
  wanted: readonly number[];
  entangled: ReadonlySet<number>;
  /** Gifts the current goals rule out, and why. */
  blocked: ReadonlyMap<number, Block>;
  giftName: (id: number) => string;
  enums: Enums;
  lang: Lang;
  onToggle: (gift: Gift) => void;
  onOpen: (giftId: number) => void;
  /** 「추천 기프트」: why each tile is there (`relevanceReason`), as `data-recommend` — for debugging, never shown. */
  reasons?: ReadonlyMap<number, string>;
  /** 「추천 기프트」: each tile's rank score (`recommendationScore`), as `data-score` — for debugging, never shown. */
  scores?: ReadonlyMap<number, number>;
}) {
  const size = useTileIconSize(32);
  // Every tile is `content-visibility: auto` (below), so the browser would shape — and fetch the
  // Pretendard slice for — a name only as the scroll reaches it: a slice arriving every second or
  // so re-drew the text while scrolling (M133). The grid's whole text is in the DOM either way, so
  // its slices are asked for once, here, whenever the tiles change.
  const gridRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    preloadGlyphs(gridRef.current?.textContent ?? '');
  }, [tiles, blocked, lang]);
  return (
    <div
      ref={gridRef}
      className="grid gap-1.5 p-2"
      style={{ gridTemplateColumns: tileColumns(size) }}
      data-testid="gift-grid"
      data-uniform="width"
    >
      {tiles.map((tile) => {
        const { entry, parent } = tile;
        const gift = entry.gift;
        const name = pick(gift.name, lang);
        const selected = wanted.includes(gift.id);
        const block = selected ? undefined : blocked.get(gift.id);
        const held = (parent ? wanted.includes(parent.id) : false) || block !== undefined;
        const report = decidingReport(entry.reports, entry.lack);
        const condition = conditionShort(report, enums, lang);
        const marked = isMarked(tile, wanted, blocked);
        const lockedBy =
          parent && wanted.includes(parent.id)
            ? t('giftSubOf', lang, { parent: pick(parent.name, lang) })
            : undefined;
        const blockedBy = block ? t('giftBlockedIncluded', lang, { name: giftName(block.by) }) : undefined;
        return (
          <div
            key={gift.id}
            id={`gift-${gift.id}`}
            className={`relative flex flex-col items-center gap-1 rounded-md bg-surface px-1 pb-1.5 pt-2 ${marked ? 'border border-primary ring-1 ring-primary' : 'border border-border'}`}
            style={{ contentVisibility: 'auto', containIntrinsicSize: '84px' }}
            data-testid="gift-tile"
            data-gift={gift.id}
            data-selected={selected || undefined}
            data-locked={held || undefined}
            data-block={block?.reason}
            data-entangled={entangled.has(gift.id) || undefined}
            data-recommend={reasons?.get(gift.id)}
            data-score={scores?.get(gift.id)}
            title={blockedBy ?? lockedBy}
          >
            {marked ? (
              <span
                className="absolute right-0.5 top-0.5 z-10 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-primary text-primary-fg"
                aria-hidden
              >
                <Check size={9} strokeWidth={3} />
              </span>
            ) : null}
            {entangled.has(gift.id) ? (
              <span
                className="absolute left-0.5 top-0.5 z-10 text-fg-muted"
                aria-hidden
                title={blockedBy ?? t('giftEntangled', lang)}
              >
                <Link2 size={11} />
              </span>
            ) : null}
            {parent ? (
              <span className="absolute left-0.5 top-5 z-10 text-fg-subtle" aria-hidden>
                <CornerDownRight size={10} />
              </span>
            ) : null}
            {/*
              A `disabled` button takes no focus, so its `title` reached neither the keyboard nor a
              screen reader — and `title` is hover-only, so a touch reader got nothing at all. The
              lock reason goes into the accessible name, and into the line under the tile.
            */}
            <button
              type="button"
              onClick={() => onToggle(gift)}
              disabled={held}
              aria-pressed={marked}
              aria-label={[name, blockedBy ?? lockedBy].filter(Boolean).join(' · ')}
              title={blockedBy ?? lockedBy}
              className="inline-flex disabled:cursor-default"
            >
              {/* The dim lives inside the icon (`DIM`), so only the square goes grey — the name
                  button below keeps full contrast. */}
              <GiftIcon
                gift={gift}
                size={size}
                judgement={judgementOf(entry.reports)}
                dim={held}
                lang={lang}
              />
            </button>
            <LinkButton
              onClick={() => onOpen(gift.id)}
              ariaLabel={t('giftDetail', lang, { name })}
              className="line-clamp-2 h-[2.6em] w-full break-keep text-center text-caption-strong"
            >
              {name}
            </LinkButton>
            {/*
              For a locked tile this line says why rather than showing a condition the player
              cannot act on: it is the one explanation that reaches a touch user, who never sees a
              `title`. `text-fg-muted` and not a dimmed `text-fg-subtle`, because it is the tile's only text
              besides the name.
            */}
            {held ? (
              <span className="line-clamp-2 min-h-[13px] break-keep text-center text-micro text-fg-muted">
                {blockedBy ?? lockedBy}
              </span>
            ) : (
              <span
                className={`min-h-[13px] font-num text-micro ${report?.satisfied ? 'text-fg' : 'text-fg-subtle'}`}
              >
                {condition ?? ''}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
