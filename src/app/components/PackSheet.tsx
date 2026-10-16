/**
 * Everything about one theme pack, opened from any pack card or name: the card and name, the floors
 * it can sit on, entering it on the stage floor (or undoing that), and the gifts only it gives. The
 * app makes no pack-level choice — which pack goes where is the planner's, and giving something up
 * is deselecting a gift.
 */
import { ArrowLeft, LogIn, RotateCcw } from 'lucide-react';
import type { ThemePack } from '../../core/schema.ts';
import type { GameIndexes } from '../../core/types.ts';
import { pick, t, type Lang } from '../i18n.ts';
import type { Judgement } from '../lib/judgement.ts';
import type { GiftStatus } from '../lib/plan-input.ts';
import { bandMode } from '../lib/stage.ts';
import { GiftIcon } from './GiftIcon.tsx';
import { DetailSurface } from './BlockDetail.tsx';
import { PackCard } from './PackCard.tsx';
import { Badge, Button, LinkButton } from './ui.tsx';

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
  /** Gifts only this pack gives: its pack-limited pool plus its boss's clear reward (`exclusivesIndex`). */
  exclusivesOf: (packId: number) => number[];
  onToggleObserved?: (giftId: number) => void;
  /** Add or remove a gift as a goal (from a pack's gift list). Carries the fusion tree with it. */
  onToggleWanted?: (giftId: number) => void;
  /** Open a gift's / a pack's details — from a name or a tile inside a sheet, the sheet moves (M120). */
  onOpenGift?: (giftId: number) => void;
  onOpenPack?: (packId: number) => void;
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

/**
 * One gift the pack alone gives (M120): the icon and the name both open the gift's details — never
 * a got/missed toggle, that is the entered pack's tiles' job — and a goal (or an ingredient the
 * route collects) is told by the frame around the icon, not by a badge or a button.
 */
function GiftRow({ giftId, ctx }: { giftId: number; ctx: PackContext }) {
  const gift = ctx.indexes.giftById.get(giftId);
  if (!gift) return null;
  const name = pick(gift.name, ctx.lang);
  const needed = ctx.needed.has(giftId);
  const condition = ctx.giftTitle(giftId);
  const status = ctx.run?.giftStatus(giftId) ?? null;
  const open = ctx.onOpenGift;
  const icon = (
    <GiftIcon
      gift={gift}
      size={44}
      judgement={ctx.judgements.get(giftId) ?? null}
      status={status}
      lang={ctx.lang}
    />
  );
  const frame = `inline-flex flex-none rounded-md border-2 p-1 ${needed ? 'border-primary' : 'border-transparent'}`;
  return (
    <li
      className="flex items-start gap-3 py-1.5"
      data-testid="pack-gift"
      data-gift={giftId}
      data-wanted={needed || undefined}
      data-status={status ?? undefined}
    >
      {open ? (
        <button
          type="button"
          onClick={() => open(giftId)}
          aria-label={t('giftDetail', ctx.lang, { name })}
          className={`${frame} hover:bg-surface-muted`}
          data-testid="pack-gift-open"
        >
          {icon}
        </button>
      ) : (
        <span className={frame}>{icon}</span>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 pt-1">
        {open ? (
          <LinkButton onClick={() => open(giftId)} className="self-start text-left text-label">
            {name}
          </LinkButton>
        ) : (
          <span className="text-label">{name}</span>
        )}
        {condition ? <span className="text-caption text-fg-muted">{condition}</span> : null}
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
    ctx.run.enteredHere === null &&
    (
      ctx.indexes.packsByFloor[bandMode(ctx.indexes, ctx.run.stageFloor)].get(ctx.run.stageFloor) ?? []
    ).includes(packId);
  return (
    <span className="flex flex-wrap items-center gap-1.5" data-testid="enter-actions">
      {visited !== null ? (
        <>
          <Badge tone="sure">{t('stageEntered', ctx.lang, { floor: visited })}</Badge>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => ctx.run?.onUnvisit(packId)}
            ariaLabel={`${name} ${t('stageUnenter', ctx.lang)}`}
          >
            <RotateCcw size={12} aria-hidden />
            {t('stageUnenter', ctx.lang)}
          </Button>
        </>
      ) : ctx.run.onEnter && offeredHere ? (
        <Button
          size="sm"
          variant="primary"
          onClick={() => ctx.run?.onEnter?.(packId)}
          ariaLabel={t('stageEnterPack', ctx.lang, { name })}
        >
          <LogIn size={12} aria-hidden />
          {t('stageEnter', ctx.lang)} · {t('stageFloor', ctx.lang, { floor: ctx.run.stageFloor })}
        </Button>
      ) : null}
    </span>
  );
}

/**
 * The sheet / popover body for a pack. Only what this pack alone gives is listed — its pack-limited
 * gifts and clear reward (M110 on the route panel, M120 everywhere): a general drop or an
 * ingredient any pack may hand out is no reason to take this one.
 */
export function PackSheetBody({ packId, ctx }: { packId: number; ctx: PackContext }) {
  const pack = ctx.indexes.packById.get(packId);
  if (!pack) return null;
  const gifts = [...new Set(ctx.exclusivesOf(packId))].sort(
    (a, b) => Number(ctx.needed.has(b)) - Number(ctx.needed.has(a)) || a - b,
  );
  return (
    <div className="flex flex-col gap-3" data-testid="pack-sheet-body">
      <div className="flex items-start gap-3">
        <PackCard pack={pack} size={96} lang={ctx.lang} />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="text-heading ">{pick(pack.name, ctx.lang)}</span>
          <span className="text-caption text-fg-muted">{packFloorsText(pack, ctx.lang)}</span>
          <EnterActions packId={packId} ctx={ctx} />
        </div>
      </div>
      <div className="text-caption-strong text-fg-muted">
        {t('packGifts', ctx.lang)} <span className="font-num text-fg-subtle">{gifts.length}</span>
      </div>
      <ul className="divide-y divide-border border-t border-border">
        {gifts.map((id) => (
          <GiftRow key={id} giftId={id} ctx={ctx} />
        ))}
      </ul>
    </div>
  );
}

/**
 * A pack's details in the shell's one detail sheet (`PlanProvider`, M120): opened from a card, a
 * portrait or a pack name anywhere, and walked back from with 「←」 when a name led here.
 */
export function PackDetailSheet({
  pack,
  ctx,
  back,
  onClose,
}: {
  pack: ThemePack;
  ctx: PackContext;
  back?: { name: string; onBack: () => void };
  onClose: () => void;
}) {
  const name = pick(pack.name, ctx.lang);
  return (
    <DetailSurface mode="sheet" label={name} closeLabel={t('routeClose', ctx.lang)} onClose={onClose}>
      <div key={pack.id} className="flex flex-col gap-3" data-testid="pack-detail">
        {back ? (
          <button
            type="button"
            onClick={back.onBack}
            aria-label={t('giftDetailBack', ctx.lang, { name: back.name })}
            className="inline-flex max-w-full items-center gap-1 self-start rounded-sm px-1 py-0.5 text-caption text-fg-muted hover:bg-surface-muted hover:text-fg"
            data-testid="detail-back"
          >
            <ArrowLeft size={13} aria-hidden className="flex-none" />
            <span className="truncate">{back.name}</span>
          </button>
        ) : null}
        <PackSheetBody packId={pack.id} ctx={ctx} />
      </div>
    </DetailSurface>
  );
}
