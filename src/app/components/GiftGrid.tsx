/**
 * The gifts to pick from, as tiles rather than rows: portrait, name, and the one condition that
 * decides whether the deck activates it. Pressing the tile makes it a goal; pressing the name
 * opens its sheet.
 *
 * A tile locks when the goals already settle it: an upgrade child (조합 계승) whose parent is a
 * goal, a gift some goal's recipe already consumes (포함), or a fusion that would fight a goal
 * over an ingredient (얽힘). `title` says which goal did it.
 */
import { CornerDownRight, Check, Link2 } from 'lucide-react';
import type { Enums, Gift } from '../../core/schema.ts';
import type { Block } from '../lib/entangle.ts';
import { t, pick, type Lang } from '../i18n.ts';
import type { GiftEntry } from '../lib/gift-priority.ts';
import { conditionShort, decidingReport } from '../lib/gift-condition.ts';
import { judgementOf } from '../lib/judgement.ts';
import { GiftIcon } from './GiftIcon.tsx';

export interface GiftTileData {
  entry: GiftEntry;
  /** The upgrade parent this tile hangs under, when it is a child. */
  parent?: Gift;
}

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
}) {
  return (
    <div className="grid gap-1.5 p-2 [grid-template-columns:repeat(auto-fill,minmax(64px,1fr))]" data-testid="gift-grid">
      {tiles.map(({ entry, parent }) => {
        const gift = entry.gift;
        const name = pick(gift.name, lang);
        const selected = wanted.includes(gift.id);
        const block = selected ? undefined : blocked.get(gift.id);
        const held = (parent ? wanted.includes(parent.id) : false) || block !== undefined;
        const report = decidingReport(entry.reports, entry.lack);
        const condition = conditionShort(report, enums, lang);
        const marked = selected || held;
        const lockedBy = parent && wanted.includes(parent.id) ? t('giftSubOf', lang, { parent: pick(parent.name, lang) }) : undefined;
        const blockedBy = block ? t('giftBlockedIncluded', lang, { name: giftName(block.by) }) : undefined;
        return (
          <div
            key={gift.id}
            id={`gift-${gift.id}`}
            className={`relative flex flex-col items-center gap-[3px] rounded-md bg-surface px-1 pb-1.5 pt-2 ${marked ? 'border border-ink ring-1 ring-ink' : 'border border-line'} ${held ? 'opacity-55' : ''}`}
            style={{ contentVisibility: 'auto', containIntrinsicSize: '84px' }}
            data-testid="gift-tile"
            data-gift={gift.id}
            data-selected={selected || undefined}
            data-locked={held || undefined}
            data-block={block?.reason}
            data-entangled={entangled.has(gift.id) || undefined}
            title={blockedBy ?? lockedBy}
          >
            {marked ? (
              <span className="absolute right-0.5 top-0.5 z-10 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-ink text-ink-fg" aria-hidden>
                <Check size={9} strokeWidth={3} />
              </span>
            ) : null}
            {entangled.has(gift.id) ? (
              <span className="absolute left-0.5 top-0.5 z-10 text-fg-2" aria-hidden title={blockedBy ?? t('giftEntangled', lang)}>
                <Link2 size={11} />
              </span>
            ) : null}
            {parent ? (
              <span className="absolute left-0.5 top-5 z-10 text-fg-3" aria-hidden>
                <CornerDownRight size={10} />
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => onToggle(gift)}
              disabled={held}
              aria-pressed={marked}
              aria-label={name}
              title={blockedBy ?? lockedBy}
              className="inline-flex disabled:cursor-default"
            >
              <GiftIcon gift={gift} size={32} judgement={judgementOf(entry.reports)} lang={lang} />
            </button>
            <button
              type="button"
              onClick={() => onOpen(gift.id)}
              aria-haspopup="dialog"
              aria-label={t('giftDetail', lang, { name })}
              className="line-clamp-2 h-[24px] w-full break-keep text-center text-[10px] font-medium leading-tight text-fg underline-offset-2 hover:underline"
            >
              {name}
            </button>
            <span className={`min-h-[13px] font-num text-[10px] leading-[13px] ${report?.satisfied ? 'text-fg' : 'text-fg-3'}`}>{condition ?? ''}</span>
          </div>
        );
      })}
    </div>
  );
}
