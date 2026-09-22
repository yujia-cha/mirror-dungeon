/**
 * The 「목표」 tab of the right panel: every goal the player set, as the same pressable tiles
 * the stage's entered pack and the T4 tracker use — one record (`run.giftStatus`) behind all
 * three, so a mark made anywhere shows everywhere and re-plans the route. Only the chosen gifts
 * appear; what a fusion needs is the route's business, not this list's.
 */
import { useState } from 'react';
import { Star } from 'lucide-react';
import { t } from '../i18n.ts';
import { useApp } from '../store.ts';
import { FusionNotice } from '../components/FusionNotice.tsx';
import { GiftTile } from '../components/GiftTile.tsx';
import { Button, Card, SectionTitle } from '../components/ui.tsx';
import { usePlan } from './plan-context.ts';

export function GoalsPanel({ onOpenGifts }: { onOpenGifts?: () => void }) {
  const { indexes, lang, judgements, giftTitle, openGift } = usePlan();
  const wanted = useApp((s) => s.wanted);
  const giftStatus = useApp((s) => s.run.giftStatus);
  const setGiftStatus = useApp((s) => s.setGiftStatus);
  const [notice, setNotice] = useState<number | null>(null);

  if (wanted.length === 0) {
    return (
      <Card className="flex flex-col items-center gap-2.5 px-4 py-8 text-center" testId="goals-empty">
        <Star size={28} className="text-fg-3" aria-hidden />
        <div className="text-sm font-semibold">{t('routeEmpty', lang)}</div>
        {onOpenGifts ? (
          <Button variant="primary" onClick={onOpenGifts}>
            {t('tabGifts', lang)}
          </Button>
        ) : null}
      </Card>
    );
  }

  const gotCount = wanted.filter((id) => giftStatus[id] === 'got').length;
  const noticeGift = notice !== null ? indexes.giftById.get(notice) : undefined;

  return (
    <div className="flex flex-col gap-3" data-testid="goals-panel">
      <Card className="px-3 py-2.5" testId="route-goals">
        <SectionTitle right={<span className="font-num text-xs text-fg-3">{`${gotCount}/${wanted.length}`}</span>}>{t('routeGoals', lang)}</SectionTitle>
        {noticeGift ? (
          <div className="mt-2">
            <FusionNotice gift={noticeGift} giftStatus={giftStatus} indexes={indexes} onUnmark={(id) => setGiftStatus(id, null)} onClose={() => setNotice(null)} lang={lang} />
          </div>
        ) : null}
        <div className="mt-2 flex flex-wrap gap-1.5">
          {wanted.map((id) => {
            const gift = indexes.giftById.get(id);
            if (!gift) return null;
            return (
              <div key={id} data-testid="route-goal" data-gift={id}>
                <GiftTile
                  gift={gift}
                  size={32}
                  status={giftStatus[id] ?? null}
                  wanted
                  judgement={judgements.get(id) ?? null}
                  title={giftTitle(id)}
                  onToggle={(next) => {
                    setGiftStatus(id, next);
                    // Only marking the mixed-fusion result raises the reminder; unmarking closes it.
                    if (gift.fusion?.mixed) setNotice(next === 'got' ? id : null);
                  }}
                  onOpen={() => openGift(id)}
                  lang={lang}
                />
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
