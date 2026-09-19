/**
 * Everything about one gift, opened from its tile: what it does, the conditions it needs, how it
 * is obtained, and — folded away until asked for — the recipe the planner would actually use.
 */
import { Check, Eye, Link2, Star } from 'lucide-react';
import type { GameData, Gift } from '../../core/schema.ts';
import { chooseRecipe, observable } from '../../core/index.ts';
import type { ConditionReport, GameIndexes } from '../../core/types.ts';
import { conditionText, reachedTierText } from '../condition-text.ts';
import { renderEffect, withJosa } from '../format.ts';
import { pick, t, type Lang } from '../i18n.ts';
import { conditionShort } from '../lib/gift-condition.ts';
import type { Block, Entanglement } from '../lib/entangle.ts';
import { judgementOf } from '../lib/judgement.ts';
import { badgeFor } from '../lib/labels.ts';
import { priorityOf, type Priority } from '../lib/plan-input.ts';
import { useApp } from '../store.ts';
import { DetailSurface } from './BlockDetail.tsx';
import { GiftIcon } from './GiftIcon.tsx';
import { Button } from './ui.tsx';

/** 「조합으로만 · 화왕지절 전용」 — the badges of the old list row, said as a sentence. */
function acquisitionLine(gift: Gift, indexes: GameIndexes, lang: Lang): string {
  const parts = [t(badgeFor(gift.acquisition.kind).label, lang)];
  const packId = gift.acquisition.exclusiveTo[0] ?? gift.acquisition.clearRewardOf ?? null;
  if (packId !== null && packId !== undefined) parts.push(t('giftPackOnly', lang, { name: pick(indexes.packById.get(packId)?.name, lang) }));
  return parts.join(' · ');
}

function Pill({ id, indexes, lang }: { id: number; indexes: GameIndexes; lang: Lang }) {
  const gift = indexes.giftById.get(id);
  if (!gift) return null;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface py-0.5 pl-1 pr-2 text-xs" data-testid="recipe-item" data-gift={id}>
      <GiftIcon gift={gift} size={20} lang={lang} />
      {pick(gift.name, lang)}
    </span>
  );
}

function Recipe({ gift, data, indexes, lang }: { gift: Gift; data: GameData; indexes: GameIndexes; lang: Lang }) {
  const slots = data.rules.fusion.maxShopSlots;
  const ingredients = chooseRecipe(gift, indexes, slots);
  const mixed = gift.fusion?.mixed ?? null;
  if (!ingredients && !mixed) return null;
  return (
    <div className="flex flex-col gap-2 px-2.5 pb-2.5 pt-2">
      {mixed && !ingredients ? (
        <p className="text-xs text-fg-2">{t('giftMixedRecipe', lang, { a: mixed.aCount, aOf: mixed.aPool.length, b: mixed.bCount, bOf: mixed.bPool.length })}</p>
      ) : null}
      <div className="flex flex-wrap gap-1.5">{(ingredients ?? []).map((id, i) => <Pill key={`${id}-${i}`} id={id} indexes={indexes} lang={lang} />)}</div>
      {(ingredients ?? []).map((id) => {
        const child = indexes.giftById.get(id);
        const sub = child ? chooseRecipe(child, indexes, slots) : null;
        if (!child || !sub) return null;
        return (
          <div key={`sub-${id}`} className="ml-3 flex flex-col gap-1 border-l border-line pl-2.5">
            <span className="text-[11px] text-fg-3">{t('giftSubRecipe', lang, { name: pick(child.name, lang) })}</span>
            <div className="flex flex-wrap gap-1.5">{sub.map((subId, i) => <Pill key={`${subId}-${i}`} id={subId} indexes={indexes} lang={lang} />)}</div>
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
  onClose: () => void;
}) {
  const wanted = useApp((s) => s.wanted);
  const priority = useApp((s) => s.priority);
  const setPriority = useApp((s) => s.setPriority);
  const observedGifts = useApp((s) => s.options.observedGifts);
  const toggleObserved = useApp((s) => s.toggleObserved);
  const fusionGoal = useApp((s) => s.fusionGoal);
  const setFusionGoal = useApp((s) => s.setFusionGoal);
  const observeMax = data.rules.giftObservation.max;

  const name = pick(gift.name, lang);
  const selected = wanted.includes(gift.id);
  const level = priorityOf(priority, gift.id);
  const nextLevel: Priority = level === 'must' ? 'normal' : 'must';
  const pinned = observedGifts.includes(gift.id);
  const canObserve = observable(gift, data.rules);
  const observeFull = !pinned && observedGifts.length >= observeMax;
  const hasRecipe = Boolean(gift.fusion && (gift.fusion.recipes.length > 0 || gift.fusion.mixed));
  const blockedBy = blocked && !selected ? t('giftBlockedIncluded', lang, { name: pick(indexes.giftById.get(blocked.by)?.name, lang) }) : undefined;

  return (
    <DetailSurface mode="sheet" label={name} closeLabel={t('routeClose', lang)} onClose={onClose}>
      <div className="flex flex-col gap-3" data-testid="gift-detail">
        <div className="flex items-start gap-2.5">
          <GiftIcon gift={gift} size={44} judgement={judgementOf(reports)} must={level === 'must'} lang={lang} />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-base font-bold">{name}</span>
            <span className="text-xs text-fg-3">{acquisitionLine(gift, indexes, lang)}</span>
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
            {t(selected ? 'giftUnselect' : 'giftSelect', lang)}
          </Button>
          {blockedBy ? <span className="text-xs text-fg-2">{blockedBy}</span> : null}
          {selected ? (
            <>
              <Button
                variant={level === 'must' ? 'primary' : 'secondary'}
                onClick={() => setPriority(gift.id, nextLevel)}
                ariaLabel={t('priorityOf', lang, { name, value: t(level === 'must' ? 'priorityMust' : 'priorityNormal', lang) })}
              >
                <Star size={13} aria-hidden fill={level === 'must' ? 'currentColor' : 'none'} />
                {t(level === 'must' ? 'priorityMust' : 'priorityNormal', lang)}
              </Button>
              <Button
                variant={pinned ? 'primary' : 'secondary'}
                onClick={() => toggleObserved(gift.id, { max: observeMax, observable: () => canObserve })}
                disabled={!canObserve || observeFull}
                ariaLabel={t('giftsObserve', lang, { name })}
                title={!canObserve ? t('giftsObserveNotAllowed', lang) : observeFull ? t('giftsObserveFull', lang, { max: observeMax }) : undefined}
              >
                <Eye size={13} aria-hidden />
                {t('settingsObserved', lang)}
              </Button>
            </>
          ) : null}
        </div>

        {reports.length > 0 ? (
          <div className="flex flex-col gap-1 rounded-sm bg-surface-2 px-2.5 py-2" data-testid="gift-conditions">
            {reports.map((report, i) => {
              const met = report.satisfied;
              const extra = reachedTierText(report, lang);
              return (
                <div key={i} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
                  <span className={`font-num font-semibold ${met ? 'text-ok' : 'text-bad'}`}>{conditionShort(report, data.enums, lang)}</span>
                  <span className="text-fg-3">{conditionText(report, data.enums, lang)}</span>
                  {extra ? <span className="text-fg-3">{extra}</span> : null}
                </div>
              );
            })}
          </div>
        ) : null}

        {/* `whitespace-pre-line`: the game writes a gift as several clauses separated by blank lines,
            with 「- 」 sub-lines under some of them. Without it CSS folds all of that into one run-on
            paragraph. */}
        <p className="whitespace-pre-line text-xs leading-relaxed text-fg-2">{renderEffect(gift.desc, data.enums, lang)}</p>

        {entangled.length > 0 ? (
          <div className="flex items-start gap-2 rounded-sm border border-line-strong px-2.5 py-2 text-xs text-fg-2" data-testid="gift-entangled">
            <Link2 size={13} aria-hidden className="mt-0.5 flex-none" />
            <span>
              <b className="text-fg">{t('giftEntangled', lang)}</b>{' '}
              {entangled
                .map((e) =>
                  t('giftEntangledWith', lang, {
                    name: withJosa(pick(indexes.giftById.get(e.other)?.name, lang), '과/와', lang),
                    list: e.shared.map((id) => pick(indexes.giftById.get(id)?.name, lang)).join(', '),
                  }),
                )
                .join(' · ')}
            </span>
          </div>
        ) : null}

        {hasRecipe ? (
          <details className="overflow-hidden rounded-sm border border-line" data-testid="gift-recipe">
            <summary className="cursor-pointer bg-surface-2 px-2.5 py-1.5 text-xs font-semibold text-fg-2">
              {t('giftMaterials', lang)}
              {gift.fusion?.recipes[0] ? <span className="ml-1.5 font-num text-[10px] font-normal text-fg-3">{gift.fusion.recipes[0].ingredients.length}</span> : null}
            </summary>
            <Recipe gift={gift} data={data} indexes={indexes} lang={lang} />
            {selected ? (
              <label className="flex items-center gap-1.5 border-t border-line px-2.5 py-2 text-xs" title={t('fusionGoalHint', lang)}>
                <input
                  type="checkbox"
                  checked={fusionGoal[gift.id] !== 'resultOnly'}
                  onChange={(event) => setFusionGoal(gift.id, event.target.checked ? 'withIngredients' : 'resultOnly')}
                  aria-label={`${name} ${t('fusionGoalIngredients', lang)}`}
                  className="h-[14px] w-[14px] accent-[var(--color-ink)]"
                />
                {t('fusionGoalIngredients', lang)}
              </label>
            ) : null}
          </details>
        ) : null}
      </div>
    </DetailSurface>
  );
}
