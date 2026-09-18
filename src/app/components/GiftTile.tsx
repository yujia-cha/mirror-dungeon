/**
 * A gift the player marks as got or not: a pressable tile whose look carries the state — not got
 * is greyscale and dimmed, got is full colour with a check, missed (decided by the run) is dimmed
 * with a cross and a press turns it into got. A goal gift wears a ring so it stands out among
 * the rest of a pack's drops. With `onOpen`, the tile also opens the gift's details: hold it for a
 * second, right-click it, or press the small ⓘ in its corner.
 */
import { Info } from 'lucide-react';
import type { Gift } from '../../core/schema.ts';
import { pick, t, type Lang } from '../i18n.ts';
import type { Judgement } from '../lib/judgement.ts';
import type { GiftStatus } from '../lib/plan-input.ts';
import { useLongPress } from '../lib/useLongPress.ts';
import { GiftIcon, type GiftIconSize } from './GiftIcon.tsx';

export const GIFT_TILE_HOLD_MS = 1000;

export function GiftTile({
  gift,
  status,
  wanted = false,
  must = false,
  judgement = null,
  size = 44,
  title,
  onToggle,
  onOpen,
  lang,
}: {
  gift: Gift;
  status: GiftStatus | null;
  wanted?: boolean;
  must?: boolean;
  judgement?: Judgement | null;
  size?: GiftIconSize;
  title?: string;
  onToggle: (next: GiftStatus | null) => void;
  /** Show the gift's details (a hold, a right-click, or the corner button). */
  onOpen?: () => void;
  lang: Lang;
}) {
  const name = pick(gift.name, lang);
  const got = status === 'got';
  const width = Math.max(size + 16, 64);
  const hold = useLongPress(onOpen, GIFT_TILE_HOLD_MS);
  const tooltip = [name, title, onOpen ? t('giftTileHold', lang) : undefined].filter(Boolean).join(' · ');
  return (
    <span className="relative inline-flex" style={{ width }}>
      <button
        type="button"
        onClick={() => {
          if (hold.consume()) return;
          onToggle(got ? null : 'got');
        }}
        onContextMenu={
          onOpen
            ? (event) => {
                event.preventDefault();
                onOpen();
              }
            : undefined
        }
        {...hold.handlers}
        aria-pressed={got}
        aria-label={t('giftTileToggle', lang, { name })}
        title={tooltip}
        data-testid="gift-tile"
        data-gift={gift.id}
        data-status={status ?? 'pending'}
        data-wanted={wanted || undefined}
        className={`flex w-full select-none flex-col items-center gap-1 rounded-md border p-1.5 text-center transition-[filter,opacity] ${
          wanted ? 'border-ink ring-1 ring-ink' : 'border-line'
        } ${status === null ? 'grayscale opacity-55 hover:opacity-80' : status === 'failed' ? 'opacity-45' : 'bg-surface'}`}
      >
        <GiftIcon gift={gift} size={size} judgement={judgement} must={must} status={status} lang={lang} />
        <span className="line-clamp-2 w-full break-keep text-[10px] leading-tight text-fg" aria-hidden>
          {name}
        </span>
      </button>
      {onOpen ? (
        <button
          type="button"
          onClick={onOpen}
          aria-haspopup="dialog"
          aria-label={t('giftDetail', lang, { name })}
          title={t('giftDetail', lang, { name })}
          data-testid="gift-tile-info"
          className="absolute -right-1 -top-1 inline-flex h-4 w-4 items-center justify-center rounded-full border border-line bg-surface text-fg-3 hover:bg-surface-2 hover:text-fg"
        >
          <Info size={10} aria-hidden />
        </button>
      ) : null}
    </span>
  );
}
