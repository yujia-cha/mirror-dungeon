/**
 * The reminder raised when 달의 기억 is marked as got: its fusion consumed two shards and three
 * memories, so the ones still marked as held are listed to be unmarked in place. Shared by the
 * T4 tracker and the goals grid of the route panel.
 */
import { X } from 'lucide-react';
import type { Gift } from '../../core/schema.ts';
import type { GameIndexes } from '../../core/types.ts';
import { pick, t, type Lang } from '../i18n.ts';
import { fusionConsumption } from '../lib/tracker.ts';
import type { GiftStatus } from '../lib/plan-input.ts';
import { GiftIcon } from './GiftIcon.tsx';
import { Button, Notice } from './ui.tsx';

export function FusionNotice({
  gift,
  giftStatus,
  indexes,
  onUnmark,
  onClose,
  lang,
}: {
  gift: Gift;
  giftStatus: Record<number, GiftStatus>;
  indexes: GameIndexes;
  onUnmark: (giftId: number) => void;
  onClose: () => void;
  lang: Lang;
}) {
  const consumption = giftStatus[gift.id] === 'got' ? fusionConsumption(gift, giftStatus) : null;
  if (!consumption) return null;
  return (
    <Notice strong>
      <div className="flex flex-col gap-2" data-testid="fusion-notice">
        <div className="flex items-start gap-2">
          <span className="flex-1">
            {t('trackerFusionNotice', lang, { a: consumption.aCount, b: consumption.bCount })}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('routeClose', lang)}
            className="inline-flex h-6 w-6 flex-none items-center justify-center rounded-full hover:bg-surface-2"
          >
            <X size={13} aria-hidden />
          </button>
        </div>
        {consumption.aGot.length + consumption.bGot.length > 0 ? (
          <ul className="flex flex-col gap-1">
            <li className="text-xs text-fg-3">{t('trackerFusionHeld', lang)}</li>
            {[...consumption.aGot, ...consumption.bGot].map((id) => {
              const held = indexes.giftById.get(id);
              return held ? (
                <li key={id} className="flex items-center gap-2">
                  <GiftIcon gift={held} size={20} status="got" lang={lang} />
                  <span className="min-w-0 flex-1 truncate text-sm">{pick(held.name, lang)}</span>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => onUnmark(id)}
                    ariaLabel={`${pick(held.name, lang)} ${t('trackerUnmark', lang)}`}
                  >
                    {t('trackerUnmark', lang)}
                  </Button>
                </li>
              ) : null;
            })}
          </ul>
        ) : null}
      </div>
    </Notice>
  );
}
