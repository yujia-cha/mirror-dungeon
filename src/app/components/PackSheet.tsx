/**
 * Everything about one theme pack, opened from any pack card: the card and name, the floors it
 * can sit on, its place in the current plan, every exclusive gift it drops (plus wanted pool
 * gifts), and the pack-level choices — include it somewhere, or give it up.
 */
import { useState } from 'react';
import { Ban, Check, Eye, LogIn, Plus, RotateCcw, X } from 'lucide-react';
import type { ThemePack } from '../../core/schema.ts';
import type { GameIndexes } from '../../core/types.ts';
import { pick, t, type Lang } from '../i18n.ts';
import type { Judgement } from '../lib/judgement.ts';
import type { GiftStatus } from '../lib/plan-input.ts';
import { bandMode } from '../lib/stage.ts';
import { ConfirmDialog } from './ConfirmDialog.tsx';
import { GiftIcon } from './GiftIcon.tsx';
import { GiftTile } from './GiftTile.tsx';
import { withJosa } from '../format.ts';
import { PackCard } from './PackCard.tsx';
import { Badge, Button } from './ui.tsx';

/** The run in progress, as the pack surfaces see it. */
export interface RunContext {
  /** The frontier: first floor still to decide. */
  currentFloor: number;
  /** The floor on stage; a pack offered there can be entered from its sheet. */
  stageFloor: number;
  /** The pack already recorded on the stage floor, if any: that floor takes no second entry. */
  enteredHere: number | null;
  /** The floor the pack was entered on, or null. */
  visitedAt: (packId: number) => number | null;
  giftStatus: (giftId: number) => GiftStatus | null;
  /** Enter the pack on the stage floor, when it is offered there. */
  onEnter?: (packId: number) => void;
  onUnvisit: (packId: number) => void;
  onGiftStatus: (giftId: number, status: GiftStatus | null) => void;
}

/** What every pack surface needs to know; built once by the route step. */
export interface PackContext {
  indexes: GameIndexes;
  judgements: Map<number, Judgement | null>;
  giftTitle: (id: number) => string | undefined;
  giftName: (id: number) => string;
  packName: (id: number) => string;
  observable: (id: number) => boolean;
  observed: ReadonlySet<number>;
  wanted: ReadonlySet<number>;
  /** The goals plus what a fusion goal consumes: what wears the goal ring on a pack's drops. */
  needed: ReadonlySet<number>;
  preferred: ReadonlySet<number>;
  banned: ReadonlySet<number>;
  /** The floor the shown plan gives the pack, or null. */
  assignedAt: (packId: number) => number | null;
  onPrefer?: (packId: number) => void;
  onBan?: (packId: number) => void;
  onRestore?: (packId: number) => void;
  onToggleObserved?: (giftId: number) => void;
  /** Add or remove a gift as a goal (from a pack's gift list). Carries the fusion tree with it. */
  onToggleWanted?: (giftId: number) => void;
  /** Drop one gift from the selection and nothing else — what 「포기」 means for a single gift. */
  onGiveUpGift?: (giftId: number) => void;
  /** Present while a run is being tracked. */
  run?: RunContext;
  lang: Lang;
}

function ranges(floors: number[]): string {
  const sorted = [...floors].sort((a, b) => a - b);
  const out: string[] = [];
  for (const f of sorted) {
    const last = out[out.length - 1];
    if (last && Number(last.split('~').pop()) === f - 1) out[out.length - 1] = `${last.split('~')[0]}~${f}`;
    else out.push(String(f));
  }
  return out.join(', ');
}

/** "4~5층 · 6~10층": where the pack can be picked. The app always plays Hard, so Normal-only floors are not listed. */
function packFloorsText(pack: ThemePack, lang: Lang): string {
  return [pack.availability.hard, pack.availability.parallel, pack.availability.extreme]
    .filter((floors) => floors.length > 0)
    .map((floors) => t('packFloorRange', lang, { floors: ranges(floors) }))
    .join(' · ');
}

export function PackStateBadge({ packId, ctx }: { packId: number; ctx: PackContext }) {
  const at = ctx.assignedAt(packId);
  const visited = ctx.run?.visitedAt(packId) ?? null;
  if (visited !== null) return <Badge tone="sure">{t('runVisitedShort', ctx.lang, { floor: visited })}</Badge>;
  if (ctx.banned.has(packId)) return <Badge tone="neutral">{t('packBanned', ctx.lang)}</Badge>;
  if (at !== null)
    return (
      <Badge tone="sure" title={ctx.preferred.has(packId) ? t('packPreferred', ctx.lang) : undefined}>
        {t('packIncluded', ctx.lang, { floor: at })}
      </Badge>
    );
  if (ctx.preferred.has(packId)) return <Badge tone="alert">{t('packPreferred', ctx.lang)}</Badge>;
  return <Badge tone="neutral">{t('packNotInRoute', ctx.lang)}</Badge>;
}

/** Include / give up / restore for one pack. */
export function PackActions({ packId, ctx, size = 'sm' }: { packId: number; ctx: PackContext; size?: 'sm' | 'md' }) {
  const [confirming, setConfirming] = useState(false);
  const name = ctx.packName(packId);
  if (ctx.banned.has(packId)) {
    return ctx.onRestore ? (
      <Button size={size} variant="ghost" onClick={() => ctx.onRestore?.(packId)} ariaLabel={`${name} ${t('packRestore', ctx.lang)}`}>
        <RotateCcw size={12} aria-hidden />
        {t('packRestore', ctx.lang)}
      </Button>
    ) : null;
  }
  const preferred = ctx.preferred.has(packId);
  /*
   * The wanted gifts this pack is the LAST source of — those are what giving it up really costs.
   * `exclusiveGifts` alone was too loud: 9267 달궈진 놋쇠 is 테마 팩 한정 of both 1302 and 1402, so
   * banning one of them still leaves the gift reachable, and the dialog said 「이 팩에서만 나옵니다」
   * anyway. `acquisition.exclusiveTo` names every pack that can hand it over; a source already
   * given up is no source, so the banned ones are discounted too.
   */
  const exclusiveWanted =
    ctx.indexes.packById
      .get(packId)
      ?.exclusiveGifts.filter(
        (id) =>
          ctx.wanted.has(id) &&
          (ctx.indexes.giftById.get(id)?.acquisition.exclusiveTo ?? []).every(
            (source) => source === packId || ctx.banned.has(source),
          ),
      ) ?? [];
  const ban = (): void => {
    if (exclusiveWanted.length > 0) {
      setConfirming(true);
      return;
    }
    ctx.onBan?.(packId);
  };
  return (
    <span className="flex flex-wrap gap-1.5">
      {ctx.onPrefer ? (
        <Button
          size={size}
          variant={preferred ? 'primary' : 'secondary'}
          onClick={() => (preferred ? ctx.onRestore?.(packId) : ctx.onPrefer?.(packId))}
          ariaLabel={`${name} ${t('packInclude', ctx.lang)}`}
          title={preferred ? t('packPreferred', ctx.lang) : undefined}
        >
          <Check size={12} aria-hidden />
          {t('packInclude', ctx.lang)}
        </Button>
      ) : null}
      {ctx.onBan ? (
        <Button size={size} variant="danger" onClick={ban} ariaLabel={`${name} ${t('packBan', ctx.lang)}`}>
          <Ban size={12} aria-hidden />
          {t('packBan', ctx.lang)}
        </Button>
      ) : null}
      {confirming ? (
        <ConfirmDialog
          title={t('packBan', ctx.lang)}
          message={t('packBanConfirm', ctx.lang, { gift: withJosa(exclusiveWanted.map(ctx.giftName).join(', '), '은/는', ctx.lang) })}
          confirmLabel={t('packBan', ctx.lang)}
          onConfirm={() => {
            setConfirming(false);
            // Giving up the pack gives up what only it could bring. The dialog already names those
            // gifts and asks about them, so leaving them selected made the same decision twice:
            // the pack went to the give-up list and every gift came back as a `pack-banned` row to
            // dismiss by hand. This deselects exactly the named gifts — `onToggleWanted` would
            // carry their fusion parents out with them, which is a bigger decision than was asked.
            for (const giftId of exclusiveWanted) ctx.onGiveUpGift?.(giftId);
            ctx.onBan?.(packId);
          }}
          onCancel={() => setConfirming(false)}
          lang={ctx.lang}
        />
      ) : null}
    </span>
  );
}

function GiftRow({ giftId, exclusive, ctx }: { giftId: number; exclusive: boolean; ctx: PackContext }) {
  const gift = ctx.indexes.giftById.get(giftId);
  if (!gift) return null;
  const name = pick(gift.name, ctx.lang);
  const wanted = ctx.wanted.has(giftId);
  const pinned = ctx.observed.has(giftId);
  // Observation happens at the start of a run, so the toggle only makes sense before floor 1 is left.
  const canObserve = wanted && ctx.onToggleObserved !== undefined && ctx.observable(giftId) && (ctx.run?.currentFloor ?? 1) === 1;
  const condition = ctx.giftTitle(giftId);
  const status = ctx.run?.giftStatus(giftId) ?? null;
  return (
    <li className="flex flex-col gap-1.5 py-1.5" data-testid="pack-gift" data-gift={giftId} data-wanted={wanted || undefined} data-status={status ?? undefined}>
      <div className="flex items-start gap-2.5">
        {ctx.run ? (
          <GiftTile gift={gift} size={44} status={status} wanted={wanted} judgement={ctx.judgements.get(giftId) ?? null} onToggle={(next) => ctx.run?.onGiftStatus(giftId, next)} lang={ctx.lang} />
        ) : (
          <GiftIcon gift={gift} size={44} judgement={ctx.judgements.get(giftId) ?? null} status={status} lang={ctx.lang} />
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`text-sm ${wanted ? 'font-semibold' : 'font-medium text-fg-2'}`}>{name}</span>
            {exclusive ? <Badge tone="sure">{t('giftExclusive', ctx.lang)}</Badge> : null}
            {wanted ? <Badge tone="start">{t('giftWanted', ctx.lang)}</Badge> : null}
          </div>
          {condition ? <span className="text-xs text-fg-2">{condition}</span> : null}
        </div>
        {canObserve ? (
          <Button size="sm" variant={pinned ? 'primary' : 'ghost'} onClick={() => ctx.onToggleObserved?.(giftId)} ariaLabel={t('routeObservedToggle', ctx.lang, { name })}>
            <Eye size={12} aria-hidden />
            {pinned ? t('routeObservedPinned', ctx.lang) : t('routeObserved', ctx.lang)}
          </Button>
        ) : null}
        {ctx.onToggleWanted ? (
          <Button size="sm" variant={wanted ? 'ghost' : 'secondary'} onClick={() => ctx.onToggleWanted?.(giftId)} ariaLabel={`${name} ${wanted ? t('giftRemoveGoal', ctx.lang) : t('giftAddGoal', ctx.lang)}`}>
            {wanted ? <X size={12} aria-hidden /> : <Plus size={12} aria-hidden />}
            {wanted ? t('giftRemoveGoal', ctx.lang) : t('giftAddGoal', ctx.lang)}
          </Button>
        ) : null}
      </div>
    </li>
  );
}

/** Run progress for a pack: enter it on the stage floor, or undo a recorded entry. */
function EnterActions({ packId, ctx }: { packId: number; ctx: PackContext }) {
  if (!ctx.run) return null;
  const visited = ctx.run.visitedAt(packId);
  const name = ctx.packName(packId);
  // A floor holds one pack. The stage hides every way in once a floor is entered; the sheet used
  // to keep offering one, and taking it silently replaced the record already there.
  const offeredHere =
    ctx.run.enteredHere === null && (ctx.indexes.packsByFloor[bandMode(ctx.indexes, ctx.run.stageFloor)].get(ctx.run.stageFloor) ?? []).includes(packId);
  return (
    <span className="flex flex-wrap items-center gap-1.5" data-testid="enter-actions">
      {visited !== null ? (
        <>
          <Badge tone="sure">{t('stageEntered', ctx.lang, { floor: visited })}</Badge>
          <Button size="sm" variant="ghost" onClick={() => ctx.run?.onUnvisit(packId)} ariaLabel={`${name} ${t('stageUnenter', ctx.lang)}`}>
            <RotateCcw size={12} aria-hidden />
            {t('stageUnenter', ctx.lang)}
          </Button>
        </>
      ) : ctx.run.onEnter && offeredHere ? (
        <Button size="sm" variant="primary" onClick={() => ctx.run?.onEnter?.(packId)} ariaLabel={t('stageEnterPack', ctx.lang, { name })}>
          <LogIn size={12} aria-hidden />
          {t('stageEnter', ctx.lang)} · {t('stageFloor', ctx.lang, { floor: ctx.run.stageFloor })}
        </Button>
      ) : null}
    </span>
  );
}

/** The sheet / popover body for a pack. */
export function PackSheetBody({ packId, ctx }: { packId: number; ctx: PackContext }) {
  const pack = ctx.indexes.packById.get(packId);
  if (!pack) return null;
  const exclusives = new Set(pack.exclusiveGifts);
  const gifts = [...new Set([...pack.exclusiveGifts, ...pack.giftPool.filter((id) => ctx.wanted.has(id))])].sort(
    (a, b) => Number(ctx.wanted.has(b)) - Number(ctx.wanted.has(a)) || a - b,
  );
  return (
    <div className="flex flex-col gap-2.5" data-testid="pack-sheet-body">
      <div className="flex items-start gap-3">
        <PackCard pack={pack} size={96} lang={ctx.lang} />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="text-base font-semibold">{pick(pack.name, ctx.lang)}</span>
          <span className="text-xs text-fg-2">{packFloorsText(pack, ctx.lang)}</span>
          <PackStateBadge packId={packId} ctx={ctx} />
          <PackActions packId={packId} ctx={ctx} />
          <EnterActions packId={packId} ctx={ctx} />
        </div>
      </div>
      <div className="text-xs font-medium text-fg-2">
        {t('packGifts', ctx.lang)} <span className="font-num text-fg-3">{gifts.length}</span>
      </div>
      <ul className="divide-y divide-line border-t border-line">
        {gifts.map((id) => (
          <GiftRow key={id} giftId={id} exclusive={exclusives.has(id)} ctx={ctx} />
        ))}
      </ul>
    </div>
  );
}
