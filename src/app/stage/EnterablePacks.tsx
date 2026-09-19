/**
 * The packs the player can enter on the stage floor. A card shows the pack's portrait, its name
 * and the gifts only it drops; pulling the card down (or pressing 「입장」 at its foot) enters it.
 * The dashed card at the end stands for a pack off the route: pulling it moves on without a
 * record. A search over every pack the game can offer on this floor sits below, each row with the
 * pack's exclusive gifts beside its name.
 *
 * Every card is the same. The route's own order already puts the planned pack first, so the cards
 * carry no 「추천」 badge and no pack-state badge — the stage says which packs are here, and the
 * pack sheet behind a name says everything else about one.
 *
 * One exception, and it single out no card: 「외 N」 counts the OTHER packs on this floor that carry
 * the same gifts. It is not a fact about this pack's standing but about the player's freedom — take
 * any of them and the route still works — and a card that has equals says so, whichever card it is.
 * It is a plain badge, not a control, because the whole card is a pull target.
 */
import { useMemo, useState } from 'react';
import { ChevronsDown, DoorOpen, LogIn, Search } from 'lucide-react';
import type { ThemePack } from '../../core/schema.ts';
import { pick, t, type Lang } from '../i18n.ts';
import { matchesQuery } from '../lib/hangul.ts';
import type { EnterablePack } from '../lib/stage.ts';
import { pullStyle, usePullGesture } from '../lib/usePullGesture.ts';
import { DetailSurface } from '../components/BlockDetail.tsx';
import { GiftIcon } from '../components/GiftIcon.tsx';
import { PackCard } from '../components/PackCard.tsx';
import { PackSheetBody, type PackContext } from '../components/PackSheet.tsx';
import { Badge, Button } from '../components/ui.tsx';

const CARD_CLASS = 'relative flex w-[128px] flex-none flex-col items-center gap-2 rounded-md border bg-surface px-2.5 pt-2.5 select-none';
const FOOT_CLASS = '-mx-2.5 mt-0.5 flex h-[34px] w-[calc(100%+20px)] items-center justify-center gap-1 rounded-b-md border-t text-sm font-medium transition-colors';
const MAX_ICONS = 5;

/** The pack's exclusive gifts as small icons, the wanted ones ringed; at most `MAX_ICONS`, then 「+n」. */
function ExclusiveIcons({ packId, ctx, exclusivesOf, justify, testId }: { packId: number; ctx: PackContext; exclusivesOf: (packId: number) => number[]; justify: 'center' | 'start'; testId: string }) {
  const exclusives = exclusivesOf(packId);
  const shown = exclusives.slice(0, MAX_ICONS);
  const more = exclusives.length - shown.length;
  return (
    <div className={`flex min-h-5 flex-wrap gap-[3px] ${justify === 'center' ? 'justify-center' : ''}`} data-testid={testId}>
      {shown.map((id) => {
        const gift = ctx.indexes.giftById.get(id);
        if (!gift) return null;
        // The ring follows what the route collects, so a fusion goal's ingredients wear it too.
        const wanted = ctx.needed.has(id);
        return (
          <span key={id} className={`inline-flex rounded-sm ${wanted ? 'ring-1 ring-ink' : ''}`} data-wanted={wanted || undefined}>
            <GiftIcon gift={gift} size={20} must={ctx.isMust(id)} status={ctx.run?.giftStatus(id) ?? null} lang={ctx.lang} />
          </span>
        );
      })}
      {more > 0 ? <span className="inline-flex h-5 items-center px-1 font-num text-[10px] text-fg-3">{t('stageExclusiveMore', ctx.lang, { n: more })}</span> : null}
    </div>
  );
}

/** The dashed card for a pack off the route: pulling it down passes the floor without a record. */
export function OtherEntryCard({ onSkip, lang }: { onSkip: () => void; lang: Lang }) {
  const pull = usePullGesture({ directions: ['down'], onCommit: onSkip });
  return (
    <div
      {...pull.handlers}
      className={`${CARD_CLASS} border-dashed border-line-strong ${pull.pulling ? 'z-10 shadow-pop' : ''} motion-reduce:transition-none`}
      style={pullStyle(pull)}
      data-testid="other-entry-card"
      data-pulling={pull.pulling || undefined}
      data-past={pull.past ?? undefined}
    >
      <span className="inline-flex h-[180px] w-24 flex-none items-center justify-center rounded-sm border border-dashed border-line-strong bg-surface-3 text-fg-3" aria-hidden>
        {/* Not a missing-artwork placeholder — this card has no pack. `opacity-40` put it at
            1.65:1, so it is only the contrast that was wrong. */}
        <DoorOpen size={40} strokeWidth={1.5} className="text-fg-2" />
      </span>
      <span className="text-center text-xs font-medium leading-tight text-fg">{t('stageOtherEntry', lang)}</span>
      <div className="min-h-5" />
      <button type="button" onClick={onSkip} aria-label={t('stageOtherEntry', lang)} className={`${FOOT_CLASS} border-dashed ${pull.past ? 'border-ink bg-ink text-ink-fg' : 'border-line-strong text-fg-2 hover:bg-surface-2'}`}>
        {pull.past ? t('stageReleaseNext', lang) : t('stageNext', lang)}
        <ChevronsDown size={14} aria-hidden />
      </button>
    </div>
  );
}

export function StagePackCard({
  pack,
  ctx,
  exclusivesOf,
  onEnter,
  onOpen,
  alternatives = [],
}: {
  pack: ThemePack;
  ctx: PackContext;
  exclusivesOf: (packId: number) => number[];
  onEnter: (packId: number) => void;
  /** Open the pack's sheet; it is rendered by the caller, outside the card the pull transforms. */
  onOpen: (packId: number) => void;
  /** Packs on this floor carrying the same gifts. Said, not offered: the card is a pull target. */
  alternatives?: number[];
}) {
  const { lang } = ctx;
  const pull = usePullGesture({ directions: ['down'], onCommit: () => onEnter(pack.id) });
  const name = pick(pack.name, lang);
  return (
    <div
      {...pull.handlers}
      className={`${CARD_CLASS} border-line ${pull.pulling ? 'z-10 shadow-pop' : 'shadow-card'} motion-reduce:transition-none`}
      style={pullStyle(pull)}
      data-testid="stage-pack"
      data-pack={pack.id}
      data-pulling={pull.pulling || undefined}
      data-past={pull.past ?? undefined}
    >
      <PackCard pack={pack} size={96} lang={lang} />
      <button type="button" onClick={() => onOpen(pack.id)} aria-haspopup="dialog" aria-label={t('stagePackDetail', lang, { name })} className="line-clamp-2 w-full break-keep text-center text-xs font-medium leading-tight text-fg underline-offset-2 hover:underline">
        {name}
      </button>
      {alternatives.length > 0 ? (
        <span data-testid="pack-alternatives" data-alternatives={alternatives.join(',')}>
          <Badge tone="neutral" title={alternatives.map((id) => ctx.packName(id)).join(', ')}>
            {t('stagePackAlternatives', lang, { n: alternatives.length })}
          </Badge>
        </span>
      ) : null}
      <ExclusiveIcons packId={pack.id} ctx={ctx} exclusivesOf={exclusivesOf} justify="center" testId="stage-pack-gifts" />
      <button
        type="button"
        onClick={() => onEnter(pack.id)}
        aria-label={t('stageEnterPack', lang, { name })}
        className={`${FOOT_CLASS} ${pull.past ? 'border-ink bg-ink text-ink-fg' : 'border-line text-fg-2 hover:bg-surface-2'}`}
      >
        {pull.past ? t('stageReleaseEnter', lang) : t('stageEnter', lang)}
        <ChevronsDown size={14} aria-hidden />
      </button>
    </div>
  );
}

/** Every pack the game can offer on this floor, searchable by pack or exclusive gift name. */
export function OtherPacks({
  offered,
  exclude,
  sameGifts,
  ctx,
  exclusivesOf,
  onEnter,
}: {
  offered: number[];
  exclude: ReadonlySet<number>;
  /** Packs that would hand over the same gifts as a route pack on this floor. */
  sameGifts?: ReadonlySet<number>;
  ctx: PackContext;
  exclusivesOf: (packId: number) => number[];
  onEnter: (packId: number) => void;
}) {
  const { lang } = ctx;
  const visitedAt = (packId: number): number | null => ctx.run?.visitedAt(packId) ?? null;
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const packs = useMemo(() => {
    const q = query.trim().toLowerCase();
    return offered
      .filter((id) => !exclude.has(id))
      .map((id) => ctx.indexes.packById.get(id))
      .filter((pack): pack is ThemePack => pack !== undefined)
      .filter((pack) => matchesQuery(pick(pack.name, lang).toLowerCase(), q) || exclusivesOf(pack.id).some((id) => matchesQuery(ctx.giftName(id).toLowerCase(), q)))
      // A pack that would do the route's job stands at the front, where it is worth finding.
      .sort((a, b) => Number(sameGifts?.has(b.id) ?? false) - Number(sameGifts?.has(a.id) ?? false) || a.id - b.id);
  }, [offered, exclude, sameGifts, ctx, query, lang, exclusivesOf]);
  return (
    <details className="rounded-md border border-line bg-surface" data-testid="other-packs">
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-fg-2">
        {t('stageOtherPacks', lang)} <span className="font-num text-xs text-fg-3">{packs.length}</span>
      </summary>
      <div className="flex flex-col gap-2 border-t border-line px-3 py-2">
        <label className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line bg-surface-2 px-2.5 text-xs text-fg-2">
          <Search size={12} aria-hidden />
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} aria-label={t('stageOtherSearch', lang)} placeholder={t('stageOtherSearch', lang)} className="min-w-0 flex-1 bg-transparent text-xs text-fg outline-none placeholder:text-fg-3" />
        </label>
        {packs.length === 0 ? (
          <p className="text-xs text-fg-3">{t('stageOtherNone', lang)}</p>
        ) : (
          <ul className="grid gap-1.5 [grid-template-columns:repeat(auto-fill,minmax(240px,1fr))]">
            {packs.map((pack) => {
              const name = pick(pack.name, lang);
              return (
                <li key={pack.id} className="relative flex items-center gap-2 rounded-sm border border-line px-2 py-1.5" data-testid="other-pack" data-pack={pack.id}>
                  <PackCard pack={pack} size={28} onOpen={setOpen} lang={lang} />
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-sm">{name}</span>
                      {sameGifts?.has(pack.id) ? (
                        <span data-testid="other-pack-same">
                          <Badge tone="neutral">{t('stageSameGifts', lang)}</Badge>
                        </span>
                      ) : null}
                    </span>
                    <ExclusiveIcons packId={pack.id} ctx={ctx} exclusivesOf={exclusivesOf} justify="start" testId="other-pack-gifts" />
                  </div>
                  {/* A pack is entered once a run. One already recorded says where, instead of
                      offering a second entry that would quietly move it to this floor. */}
                  {visitedAt(pack.id) !== null ? (
                    <Badge tone="sure">{t('runVisitedShort', lang, { floor: visitedAt(pack.id)! })}</Badge>
                  ) : (
                    <Button size="sm" variant="secondary" onClick={() => onEnter(pack.id)} ariaLabel={t('stageEnterPack', lang, { name })}>
                      <LogIn size={12} aria-hidden />
                      {t('stageEnter', lang)}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {/* The sheet lives outside the list: adding a goal from it can move the pack to the route row. */}
      {open !== null ? (
        <DetailSurface mode="sheet" label={pick(ctx.indexes.packById.get(open)?.name, lang)} closeLabel={t('routeClose', lang)} onClose={() => setOpen(null)}>
          <PackSheetBody packId={open} ctx={ctx} />
        </DetailSurface>
      ) : null}
    </details>
  );
}

export type { EnterablePack };
