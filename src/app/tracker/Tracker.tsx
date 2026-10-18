/**
 * The T4 tracker: the pack-independent tier-4+ gifts, grouped by series, each a tile pressed when
 * it is in hand. Marking 달의 기억 reminds the player that its fusion consumed two shards and three
 * memories, listing the ones still marked as held so they can be unmarked in place.
 */
import { useMemo, useState } from 'react';
import { t } from '../i18n.ts';
import { collectedGifts, useApp } from '../store.ts';
import { consumedStatus, giftDone } from '../lib/plan-input.ts';
import { trackerGifts, type TrackerGroupId } from '../lib/tracker.ts';
import { FusionNotice } from '../components/FusionNotice.tsx';
import { GiftTile } from '../components/GiftTile.tsx';
import { Card, SectionTitle } from '../components/ui.tsx';
import { useTileIconSize } from '../lib/icon-size.ts';
import { usePlan } from '../shell/plan-context.ts';

const GROUP_KEY: Record<
  TrackerGroupId,
  | 'trackerGroupKeyword'
  | 'trackerGroupShard'
  | 'trackerGroupMemory'
  | 'trackerGroupAttack'
  | 'trackerGroupPlain'
> = {
  keyword: 'trackerGroupKeyword',
  shard: 'trackerGroupShard',
  memory: 'trackerGroupMemory',
  attack: 'trackerGroupAttack',
  plain: 'trackerGroupPlain',
};

export function Tracker() {
  const { data, indexes, lang, goals, openGift } = usePlan();
  const giftStatus = useApp((s) => s.run.giftStatus);
  const setGiftStatus = useApp((s) => s.setGiftStatus);
  const wanted = useApp((s) => s.wanted);
  const fusionGoal = useApp((s) => s.fusionGoal);
  const tileSize = useTileIconSize(32);
  const groups = useMemo(() => trackerGifts(data, indexes), [data, indexes]);
  const [notice, setNotice] = useState<number | null>(null);
  const noticeGift = notice !== null ? indexes.giftById.get(notice) : undefined;

  return (
    <div className="flex flex-col gap-3" data-testid="tracker">
      <h2 className="text-subheading">{t('trackerTitle', lang)}</h2>
      {noticeGift ? (
        <FusionNotice
          gift={noticeGift}
          giftStatus={giftStatus}
          indexes={indexes}
          // Eaten by the fusion: used up when the route wanted 달의 기억, gone otherwise (M149).
          onUnmark={(id) =>
            setGiftStatus(id, consumedStatus(noticeGift.id, collectedGifts(wanted, fusionGoal)))
          }
          onClose={() => setNotice(null)}
          lang={lang}
        />
      ) : null}
      {groups.map((group) => (
        <Card key={group.id} className="px-3 py-3" testId={`tracker-${group.id}`}>
          <SectionTitle
            right={
              <span className="font-num text-caption text-fg-subtle">{`${group.gifts.filter((g) => giftDone(giftStatus[g.id])).length}/${group.gifts.length}`}</span>
            }
          >
            {t(GROUP_KEY[group.id], lang)}
          </SectionTitle>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {group.gifts.map((gift) => (
              <GiftTile
                key={gift.id}
                gift={gift}
                size={tileSize}
                status={giftStatus[gift.id] ?? null}
                wanted={goals.has(gift.id)}
                onToggle={(next) => {
                  setGiftStatus(gift.id, next);
                  // Only marking the mixed-fusion result raises the reminder; unmarking closes it.
                  if (gift.fusion?.mixed) setNotice(next === 'got' ? gift.id : null);
                }}
                onOpen={() => openGift(gift.id)}
                lang={lang}
              />
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}
