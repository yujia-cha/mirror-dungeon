/**
 * Everything about one gift, opened from its tile: what it does, the conditions it needs, how it
 * is obtained, and — folded away until asked for — the recipe the planner would actually use.
 * An ingredient in the recipe opens its own details in the same sheet; 「← 이전 기프트」 at the top
 * walks back (the host keeps the trail). Since M120 every gift and pack name here is a link to its
 * own details, and observation is pinned only from the item tab's slots — the sheet has no button.
 */
import { useEffect, useMemo, useRef } from 'react';
import { ArrowLeft, Check, Link2, X } from 'lucide-react';
import type { GameData, Gift } from '../../core/schema.ts';
import { chooseRecipe } from '../../core/index.ts';
import type { ConditionReport, GameIndexes, RoutePlan } from '../../core/types.ts';
import { conditionText, reachedTierText } from '../condition-text.ts';
import { renderEffect, withJosa } from '../format.ts';
import { pick, t, type Lang } from '../i18n.ts';
import { conditionShort } from '../lib/gift-condition.ts';
import type { Block, Entanglement } from '../lib/entangle.ts';
import { judgementOf } from '../lib/judgement.ts';
import { badgeFor } from '../lib/labels.ts';
import { routeSourceOf, routeSourceText } from '../lib/route-source.ts';
import { useApp } from '../store.ts';
import { DetailSurface } from './BlockDetail.tsx';
import { LinkedText, type NameLink } from './LinkedText.tsx';
import { GiftIcon } from './GiftIcon.tsx';
import { Button, Checkbox } from './ui.tsx';

/**
 * 「조합으로만 · 화왕지절 전용」 — the badges of the old list row, said as a sentence. A gift with
 * several exclusive packs (53 of them; 인연 얽힘 has seven) names two and counts the rest: the
 * first pack alone used to read as the only source.
 */
function acquisitionLine(gift: Gift, indexes: GameIndexes, lang: Lang): { text: string; packs: number[] } {
  const parts = [t(badgeFor(gift.acquisition.kind).label, lang)];
  const packName = (id: number): string => pick(indexes.packById.get(id)?.name, lang);
  const exclusive = gift.acquisition.exclusiveTo;
  let packs: number[] = [];
  if (exclusive.length >= 3) {
    packs = [exclusive[0]!];
    parts.push(t('giftPackOnlyMany', lang, { name: packName(exclusive[0]!), n: exclusive.length - 1 }));
  } else if (exclusive.length > 0) {
    packs = [...exclusive];
    parts.push(t('giftPackOnly', lang, { name: exclusive.map(packName).join(' · ') }));
  } else if (gift.acquisition.clearRewardOf !== null && gift.acquisition.clearRewardOf !== undefined) {
    packs = [gift.acquisition.clearRewardOf];
    parts.push(t('giftPackOnly', lang, { name: packName(gift.acquisition.clearRewardOf) }));
  }
  return { text: parts.join(' · '), packs };
}

const PILL =
  'inline-flex items-center gap-1.5 rounded-full border border-border bg-surface py-0.5 pl-1 pr-2 text-caption';

/** One ingredient. With `onOpen` it is a button that moves the sheet to that gift. */
function Pill({
  id,
  indexes,
  lang,
  onOpen,
}: {
  id: number;
  indexes: GameIndexes;
  lang: Lang;
  onOpen?: (id: number) => void;
}) {
  const gift = indexes.giftById.get(id);
  if (!gift) return null;
  const name = pick(gift.name, lang);
  if (!onOpen) {
    return (
      <span className={PILL} data-testid="recipe-item" data-gift={id}>
        <GiftIcon gift={gift} size={20} lang={lang} />
        {name}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onOpen(id)}
      aria-label={t('giftDetail', lang, { name })}
      className={`${PILL} hover:bg-surface-muted`}
      data-testid="recipe-item"
      data-gift={id}
    >
      <GiftIcon gift={gift} size={20} lang={lang} />
      {name}
    </button>
  );
}

function Recipe({
  gift,
  data,
  indexes,
  lang,
  goals,
  onOpen,
}: {
  gift: Gift;
  data: GameData;
  indexes: GameIndexes;
  lang: Lang;
  /** The goals, so the recipe shown is the one the route uses (`chooseRecipe`). */
  goals: ReadonlySet<number>;
  onOpen?: (id: number) => void;
}) {
  const slots = data.rules.fusion.maxShopSlots;
  const ingredients = chooseRecipe(gift, indexes, slots, goals);
  const mixed = gift.fusion?.mixed ?? null;
  if (!ingredients && !mixed) return null;
  return (
    <div className="flex flex-col gap-2 px-3 pb-3 pt-2">
      {mixed && !ingredients ? (
        <p className="text-caption text-fg-muted">
          {t('giftMixedRecipe', lang, {
            a: mixed.aCount,
            aOf: mixed.aPool.length,
            b: mixed.bCount,
            bOf: mixed.bPool.length,
          })}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-1.5">
        {(ingredients ?? []).map((id, i) => (
          <Pill key={`${id}-${i}`} id={id} indexes={indexes} lang={lang} onOpen={onOpen} />
        ))}
      </div>
      {(ingredients ?? []).map((id) => {
        const child = indexes.giftById.get(id);
        const sub = child ? chooseRecipe(child, indexes, slots, goals) : null;
        if (!child || !sub) return null;
        return (
          <div key={`sub-${id}`} className="ml-3 flex flex-col gap-1 border-l border-border pl-3">
            <span className="text-caption text-fg-subtle">
              <LinkedText
                text={t('giftSubRecipe', lang, { name: pick(child.name, lang) })}
                links={onOpen ? [{ name: pick(child.name, lang), onOpen: () => onOpen(id) }] : []}
              />
            </span>
            <div className="flex flex-wrap gap-1.5">
              {sub.map((subId, i) => (
                <Pill key={`${subId}-${i}`} id={subId} indexes={indexes} lang={lang} onOpen={onOpen} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function GiftDetailSheet({
  gift,
  reports,
  entangled,
  data,
  indexes,
  lang,
  onToggleWanted,
  blocked,
  plan = null,
  onOpenGift,
  onOpenPack,
  back,
  onClose,
}: {
  gift: Gift;
  reports: ConditionReport[];
  entangled: Entanglement[];
  data: GameData;
  indexes: GameIndexes;
  lang: Lang;
  /** Selecting from here follows the same rule as the grid: what the goal carries comes along. */
  onToggleWanted: (gift: Gift) => void;
  /** Why this gift cannot be made a goal right now, if the current goals already carry it. */
  blocked?: Block;
  /**
   * The route on show, for the 「이 루트에서는 …」 line: where this plan gets the gift. The host
   * (`PlanProvider`) passes its `shown` plan; without one the line is simply absent.
   */
  plan?: RoutePlan | null;
  /** Follow a recipe ingredient: the sheet moves to that gift. Without it the ingredients are plain. */
  onOpenGift?: (giftId: number) => void;
  /** Follow a pack name (where the gift drops, where this route takes it): the sheet moves there. */
  onOpenPack?: (packId: number) => void;
  /** Set when this gift was reached from another's recipe: the way back to it. */
  back?: { name: string; onBack: () => void };
  onClose: () => void;
}) {
  const wanted = useApp((s) => s.wanted);
  const fusionGoal = useApp((s) => s.fusionGoal);
  const setFusionGoal = useApp((s) => s.setFusionGoal);

  // Moving to another gift keeps the sheet mounted, so it has to start over by hand: back to the
  // top, and focus on something that still exists — the pill that was pressed is gone, and a modal
  // must not drop focus to <body>.
  const contentRef = useRef<HTMLDivElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const shownGift = useRef(gift.id);
  useEffect(() => {
    if (shownGift.current === gift.id) return;
    shownGift.current = gift.id;
    const dialog = contentRef.current?.closest('[role="dialog"]');
    if (dialog) dialog.scrollTop = 0;
    (backRef.current ?? titleRef.current)?.focus();
  }, [gift.id]);

  const name = pick(gift.name, lang);
  const selected = wanted.includes(gift.id);
  const goalSet = useMemo(() => new Set(wanted), [wanted]);
  const hasRecipe = Boolean(gift.fusion && (gift.fusion.recipes.length > 0 || gift.fusion.mixed));
  const routeSource = routeSourceOf(plan, gift.id);
  const blockedBy =
    blocked && !selected
      ? t('giftBlockedIncluded', lang, { name: pick(indexes.giftById.get(blocked.by)?.name, lang) })
      : undefined;
  const giftLink = (id: number): NameLink[] =>
    onOpenGift ? [{ name: pick(indexes.giftById.get(id)?.name, lang), onOpen: () => onOpenGift(id) }] : [];
  const packLink = (id: number): NameLink[] =>
    onOpenPack ? [{ name: pick(indexes.packById.get(id)?.name, lang), onOpen: () => onOpenPack(id) }] : [];
  const acquisition = acquisitionLine(gift, indexes, lang);

  return (
    <DetailSurface mode="sheet" label={name} closeLabel={t('routeClose', lang)} onClose={onClose}>
      {/* Keyed by the gift, so a gift reached from a recipe opens with its own recipe folded. */}
      <div key={gift.id} ref={contentRef} className="flex flex-col gap-3" data-testid="gift-detail">
        {back ? (
          <button
            ref={backRef}
            type="button"
            onClick={back.onBack}
            aria-label={t('giftDetailBack', lang, { name: back.name })}
            className="inline-flex max-w-full items-center gap-1 self-start rounded-sm px-1 py-0.5 text-caption text-fg-muted hover:bg-surface-muted hover:text-fg"
            data-testid="gift-detail-back"
          >
            <ArrowLeft size={13} aria-hidden className="flex-none" />
            <span className="truncate">{back.name}</span>
          </button>
        ) : null}
        <div className="flex items-start gap-3">
          <GiftIcon gift={gift} size={44} judgement={judgementOf(reports)} lang={lang} />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <h2 ref={titleRef} tabIndex={-1} className="text-heading outline-none">
              {name}
            </h2>
            <span className="text-caption text-fg-subtle" data-testid="gift-acquisition">
              <LinkedText text={acquisition.text} links={acquisition.packs.flatMap(packLink)} />
            </span>
            {/* Where this route gets the gift — the plan's own answer, not the acquisition class.
                Absent for a gift the route says nothing about (not needed, in hand, unresolved). */}
            {routeSource ? (
              <span className="text-caption text-fg-muted" data-testid="gift-route-source">
                <LinkedText
                  text={t('giftRouteSource', lang, {
                    source: routeSourceText(routeSource, {
                      packName: (id) => pick(indexes.packById.get(id)?.name, lang),
                      lang,
                    }),
                  })}
                  links={
                    'packId' in routeSource && typeof routeSource.packId === 'number'
                      ? packLink(routeSource.packId)
                      : []
                  }
                />
              </span>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {/* The grid disables a blocked tile; the name beside it was never disabled, so the sheet
              behind it used to be a way around the lock. */}
          <Button
            variant={selected ? 'secondary' : 'primary'}
            onClick={() => onToggleWanted(gift)}
            disabled={blockedBy !== undefined}
            title={blockedBy}
          >
            {selected ? <Check size={13} aria-hidden /> : null}
            {t(selected ? 'giftRemoveGoal' : 'giftAddGoal', lang)}
          </Button>
          {blockedBy && blocked ? (
            <span className="text-caption text-fg-muted">
              <LinkedText text={blockedBy} links={giftLink(blocked.by)} />
            </span>
          ) : null}
        </div>

        {reports.length > 0 ? (
          <div
            className="flex flex-col gap-1 rounded-sm bg-surface-muted px-3 py-2"
            data-testid="gift-conditions"
          >
            {reports.map((report, i) => {
              const met = report.satisfied;
              const extra = reachedTierText(report, lang);
              return (
                <div key={i} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-caption">
                  {/* Met / not met is a mark and ink, like the tile's ring is a ring: no coloured text. */}
                  <span
                    className={`inline-flex items-center gap-0.5 font-num text-caption-strong ${report.gate ? 'text-fg' : 'text-fg-muted'}`}
                    data-met={report.gate ? met : undefined}
                  >
                    {report.gate ? (
                      met ? (
                        <Check size={11} strokeWidth={3} aria-hidden />
                      ) : (
                        <X size={11} strokeWidth={3} aria-hidden />
                      )
                    ) : null}
                    {conditionShort(report, data.enums, lang)}
                  </span>
                  <span className="text-fg-subtle">{conditionText(report, data.enums, lang)}</span>
                  {extra ? <span className="text-fg-subtle">{extra}</span> : null}
                </div>
              );
            })}
          </div>
        ) : null}

        {/* `whitespace-pre-line`: the game writes a gift as several clauses separated by blank lines,
            with 「- 」 sub-lines under some of them. Without it CSS folds all of that into one run-on
            paragraph. */}
        <p className="whitespace-pre-line text-caption text-fg-muted">
          {renderEffect(gift.desc, data.enums, lang)}
        </p>

        {entangled.length > 0 ? (
          <div
            className="flex items-start gap-2 rounded-sm border border-border-strong px-3 py-2 text-caption text-fg-muted"
            data-testid="gift-entangled"
          >
            <Link2 size={13} aria-hidden className="mt-0.5 flex-none" />
            <span>
              <b className="text-fg">{t('giftEntangled', lang)}</b>{' '}
              {entangled.map((e, i) => (
                <span key={e.other}>
                  {i > 0 ? ' · ' : null}
                  <LinkedText
                    text={t('giftEntangledWith', lang, {
                      name: withJosa(pick(indexes.giftById.get(e.other)?.name, lang), '과/와', lang),
                      list: e.shared.map((id) => pick(indexes.giftById.get(id)?.name, lang)).join(', '),
                    })}
                    links={[e.other, ...e.shared].flatMap(giftLink)}
                  />
                </span>
              ))}
            </span>
          </div>
        ) : null}

        {hasRecipe ? (
          <details className="overflow-hidden rounded-sm border border-border" data-testid="gift-recipe">
            <summary className="cursor-pointer bg-surface-muted px-3 py-1.5 text-caption-strong text-fg-muted">
              {t('giftMaterials', lang)}
              {gift.fusion?.recipes[0] ? (
                <span className="ml-1.5 font-num text-micro text-fg-subtle">
                  {gift.fusion.recipes[0].ingredients.length}
                </span>
              ) : null}
            </summary>
            <Recipe
              gift={gift}
              data={data}
              indexes={indexes}
              lang={lang}
              goals={goalSet}
              onOpen={onOpenGift}
            />
            {selected ? (
              <Checkbox
                checked={fusionGoal[gift.id] !== 'resultOnly'}
                onChange={(checked) => setFusionGoal(gift.id, checked ? 'withIngredients' : 'resultOnly')}
                ariaLabel={`${name} ${t('fusionGoalIngredients', lang)}`}
                title={t('fusionGoalHint', lang)}
                className="flex gap-1.5 border-t border-border px-3 py-2 text-caption"
              >
                {t('fusionGoalIngredients', lang)}
              </Checkbox>
            ) : null}
          </details>
        ) : null}
      </div>
    </DetailSurface>
  );
}
