/**
 * Everything about one theme pack, opened from any pack card: the card and name, the floors it
 * can sit on, entering it on the stage floor (or undoing that), and every exclusive gift it drops
 * (plus the pool gifts the route collects). The app makes no pack-level choice — which pack goes
 * where is the planner's, and giving something up is deselecting a gift.
 */
import { Eye, LogIn, Plus, RotateCcw, X } from 'lucide-react';
import type { ThemePack } from '../../core/schema.ts';
import type { GameIndexes } from '../../core/types.ts';
import { pick, t, type Lang } from '../i18n.ts';
import type { Judgement } from '../lib/judgement.ts';
import { observationClosed, type GiftStatus } from '../lib/plan-input.ts';
import { bandMode } from '../lib/stage.ts';
import { GiftIcon } from './GiftIcon.tsx';
import { GiftTile } from './GiftTile.tsx';
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
  onToggleObserved?: (giftId: number) => void;
  /** Add or remove a gift as a goal (from a pack's gift list). Carries the fusion tree with it. */
  onToggleWanted?: (giftId: number) => void;
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

function GiftRow({ giftId, exclusive, ctx }: { giftId: number; exclusive: boolean; ctx: PackContext }) {
  const gift = ctx.indexes.giftById.get(giftId);
  if (!gift) return null;
  const name = pick(gift.name, ctx.lang);
  const wanted = ctx.wanted.has(giftId);
  const pinned = ctx.observed.has(giftId);
  // Observation happens at the start of a run, so the toggle only makes sense before floor 1 is left.
  const canObserve =
    wanted &&
    ctx.onToggleObserved !== undefined &&
    ctx.observable(giftId) &&
    !observationClosed(ctx.run ?? { currentFloor: 1 });
  const condition = ctx.giftTitle(giftId);
  const status = ctx.run?.giftStatus(giftId) ?? null;
  return (
    <li
      className="flex flex-col gap-1.5 py-1.5"
      data-testid="pack-gift"
      data-gift={giftId}
      data-wanted={wanted || undefined}
      data-status={status ?? undefined}
    >
      <div className="flex items-start gap-2.5">
        {ctx.run ? (
          <GiftTile
            gift={gift}
            size={44}
            status={status}
            wanted={wanted}
            judgement={ctx.judgements.get(giftId) ?? null}
            onToggle={(next) => ctx.run?.onGiftStatus(giftId, next)}
            lang={ctx.lang}
          />
        ) : (
          <GiftIcon
            gift={gift}
            size={44}
            judgement={ctx.judgements.get(giftId) ?? null}
            status={status}
            lang={ctx.lang}
          />
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
          <Button
            size="sm"
            variant={pinned ? 'primary' : 'ghost'}
            onClick={() => ctx.onToggleObserved?.(giftId)}
            ariaLabel={t(pinned ? 'observeSlotClear' : 'giftsObserve', ctx.lang, { name })}
          >
            <Eye size={12} aria-hidden />
            {t(pinned ? 'observePinned' : 'settingsObserved', ctx.lang)}
          </Button>
        ) : null}
        {ctx.onToggleWanted ? (
          <Button
            size="sm"
            variant={wanted ? 'ghost' : 'secondary'}
            onClick={() => ctx.onToggleWanted?.(giftId)}
            ariaLabel={`${name} ${wanted ? t('giftRemoveGoal', ctx.lang) : t('giftAddGoal', ctx.lang)}`}
          >
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

/** The sheet / popover body for a pack. */
export function PackSheetBody({ packId, ctx }: { packId: number; ctx: PackContext }) {
  const pack = ctx.indexes.packById.get(packId);
  if (!pack) return null;
  const exclusives = new Set(pack.exclusiveGifts);
  // Pool gifts are listed when the route collects them — a fusion goal's ingredients included, so
  // the pack that drops one says so here as it does on the stage. The rows' toggles and badges
  // still speak of the chosen goals only.
  const gifts = [
    ...new Set([...pack.exclusiveGifts, ...pack.giftPool.filter((id) => ctx.needed.has(id))]),
  ].sort((a, b) => Number(ctx.needed.has(b)) - Number(ctx.needed.has(a)) || a - b);
  return (
    <div className="flex flex-col gap-2.5" data-testid="pack-sheet-body">
      <div className="flex items-start gap-3">
        <PackCard pack={pack} size={96} lang={ctx.lang} />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="text-base font-semibold">{pick(pack.name, ctx.lang)}</span>
          <span className="text-xs text-fg-2">{packFloorsText(pack, ctx.lang)}</span>
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
