/**
 * The area a pulled pack opens: the pack on the left, every gift only it drops on the right
 * (goals first, each a tile pressed when in hand), a handle above to go back and one below to
 * move on. Pulling the whole area down moves on; pushing it up goes back — the entry and every
 * status marked for this pack's drops are cleared and the area folds away. Holding a tile (or its
 * ⓘ) opens the gift's details.
 */
import { useEffect, useState } from 'react';
import { ChevronsDown, ChevronsUp } from 'lucide-react';
import { pick, t } from '../i18n.ts';
import { useApp } from '../store.ts';
import { pullStyle, usePullGesture } from '../lib/usePullGesture.ts';
import { GiftTile } from '../components/GiftTile.tsx';
import { PackCard } from '../components/PackCard.tsx';
import { usePlan } from '../shell/plan-context.ts';

const HANDLE_CLASS =
  'flex h-9 w-full items-center justify-center gap-1 text-sm font-medium transition-colors';

/** Opens from zero height on mount (`grid-template-rows` 0fr → 1fr) and folds the same way when `closing`. */
export function PackArea({ packId, closing = false }: { packId: number; closing?: boolean }) {
  const { indexes, lang, ctx, exclusivesOf, needed, next, leave, openGift } = usePlan();
  const giftStatus = useApp((s) => s.run.giftStatus);
  const setGiftStatus = useApp((s) => s.setGiftStatus);
  /**
   * The open state is one-way: a frame after mount it turns on, and `closing` folds it from the
   * outside. Keeping those separate is what lets the effect run once — it used to re-run on
   * `closing` and write `false` synchronously, which is a state write from an effect.
   */
  const [entered, setEntered] = useState(false);
  const open = entered && !closing;
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setEntered(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);
  const pull = usePullGesture({
    directions: ['down', 'up'],
    onCommit: (direction) => (direction === 'down' ? next() : leave(packId)),
  });
  const pack = indexes.packById.get(packId);
  if (!pack) return null;
  const name = pick(pack.name, lang);
  const exclusives = [...exclusivesOf(packId)].sort(
    (a, b) => Number(needed.has(b)) - Number(needed.has(a)) || a - b,
  );
  const goalCount = exclusives.filter((id) => needed.has(id)).length;
  const pastUp = pull.past === 'up';
  const pastDown = pull.past === 'down';

  return (
    <div
      className="grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none"
      style={{ gridTemplateRows: open ? '1fr' : '0fr' }}
      data-testid={closing ? 'pack-area-closing' : 'pack-area'}
      data-open={open || undefined}
    >
      <div className="min-h-0 overflow-hidden">
        <div
          {...(closing ? {} : pull.handlers)}
          className={`flex flex-col overflow-hidden rounded-md border border-ink bg-surface select-none ${pull.pulling ? 'shadow-pop' : 'shadow-card'} motion-reduce:transition-none`}
          style={pullStyle(pull)}
          data-testid={closing ? undefined : 'entered-pack'}
          data-pack={packId}
          data-pulling={pull.pulling || undefined}
          data-past={pull.past ?? undefined}
        >
          <button
            type="button"
            onClick={() => leave(packId)}
            aria-label={t('stageBackPack', lang, { name })}
            className={`${HANDLE_CLASS} border-b ${pastUp ? 'border-ink bg-ink text-ink-fg' : 'border-line text-fg-2 hover:bg-surface-2'}`}
            data-testid="area-back"
          >
            <ChevronsUp size={14} aria-hidden />
            {pastUp ? t('stageReleaseBack', lang) : t('stageBack', lang)}
          </button>

          <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-4 px-3 py-3.5">
            <div className="flex w-[112px] flex-col items-center gap-2 md:w-[150px]">
              <PackCard pack={pack} size={96} lang={lang} />
              <span className="text-center text-sm font-semibold">{name}</span>
            </div>
            <div className="flex min-w-0 flex-col gap-2">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-sm font-semibold">{t('stageExclusives', lang)}</span>
                <span className="font-num text-xs text-fg-3">{exclusives.length}</span>
                {goalCount > 0 ? (
                  <span className="text-xs text-fg-2">{`${t('stageGoalsFirst', lang)} ${goalCount}`}</span>
                ) : null}
              </div>
              {exclusives.length === 0 ? (
                <p className="text-xs text-fg-3">{t('stageExclusivesNone', lang)}</p>
              ) : (
                <div className="flex flex-wrap gap-2" data-testid="exclusive-gifts">
                  {exclusives.map((id) => {
                    const gift = indexes.giftById.get(id);
                    return gift ? (
                      <GiftTile
                        key={id}
                        gift={gift}
                        size={44}
                        status={giftStatus[id] ?? null}
                        wanted={needed.has(id)}
                        judgement={ctx.judgements.get(id) ?? null}
                        title={ctx.giftTitle(id)}
                        onToggle={(nextStatus) => setGiftStatus(id, nextStatus)}
                        onOpen={() => openGift(id)}
                        lang={lang}
                      />
                    ) : null;
                  })}
                </div>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={next}
            aria-label={t('stageNext', lang)}
            className={`${HANDLE_CLASS} border-t ${pastDown ? 'border-ink bg-ink text-ink-fg' : 'border-line text-fg-2 hover:bg-surface-2'}`}
            data-testid="area-next"
          >
            <ChevronsDown size={14} aria-hidden />
            {pastDown ? t('stageReleaseNext', lang) : t('stageNext', lang)}
          </button>
        </div>
      </div>
    </div>
  );
}
