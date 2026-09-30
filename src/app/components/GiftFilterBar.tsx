/**
 * The row of gift filter pills — keyword, condition, tier, sin — and the reset button that appears
 * once any of them (or the query) narrows the list. Only the 「모두 보기」 browser draws it; the items
 * tab has a search box and no filters. The search box is not here: the caller keeps its own.
 */
import { RefreshCw, Search } from 'lucide-react';
import type { Enums, Keyword, Sin } from '../../core/schema.ts';
import { t, pick, type Lang } from '../i18n.ts';
import { SIN_LABEL, tierLabel } from '../lib/labels.ts';
import type { ConditionFilter, TierFilter } from '../lib/gift-filters.ts';
import type { GiftFilterState } from '../lib/useGiftFilters.ts';
import { Button, Card, FilterSelect } from './ui.tsx';

export function GiftFilterBar({ state, enums, lang }: { state: GiftFilterState; enums: Enums; lang: Lang }) {
  const { filters, set, filtersOn, resetFilters } = state;
  const keywordOptions = enums.keywords.map((k) => ({
    value: k.id as Keyword,
    label: pick(k.name, lang),
  }));
  const conditionOptions: { value: ConditionFilter; label: string }[] = [
    { value: 'none', label: t('condNone', lang) },
    { value: 'gated', label: t('condGated', lang) },
  ];
  const tierOptions = (['1', '2', '3', '4', '5', 'EX'] as TierFilter[]).map((v) => ({
    value: v,
    label: tierLabel(v === 'EX' ? 'EX' : (Number(v) as 1 | 2 | 3 | 4 | 5)),
  }));
  const sinOptions = enums.sins.map((s) => ({ value: s as Sin, label: t(SIN_LABEL[s as Sin], lang) }));
  return (
    <div className="flex flex-wrap gap-1.5" data-testid="gift-filters">
      <FilterSelect
        label={t('filterKeyword', lang)}
        value={filters.keyword}
        options={keywordOptions}
        onChange={(value) => set('keyword', value)}
        allLabel={t('filterAll', lang)}
      />
      <FilterSelect
        label={t('filterCondition', lang)}
        value={filters.condition}
        options={conditionOptions}
        onChange={(value) => set('condition', value)}
        allLabel={t('filterAll', lang)}
      />
      <FilterSelect
        label={t('filterTier', lang)}
        value={filters.tier}
        options={tierOptions}
        onChange={(value) => set('tier', value)}
        allLabel={t('filterAll', lang)}
      />
      <FilterSelect
        label={t('filterSin', lang)}
        value={filters.sin}
        options={sinOptions}
        onChange={(value) => set('sin', value)}
        allLabel={t('filterAll', lang)}
      />
      {filtersOn ? (
        <Button size="sm" variant="ghost" onClick={resetFilters}>
          <RefreshCw size={12} aria-hidden />
          {t('filterReset', lang)}
        </Button>
      ) : null}
    </div>
  );
}

/** The card shown when the filters leave nothing: the query, if any, and a way back. */
export function GiftNoMatch({ state, lang }: { state: GiftFilterState; lang: Lang }) {
  const query = state.filters.query.trim();
  return (
    <Card className="flex flex-col items-center gap-2.5 px-4 py-8 text-center">
      <Search size={28} className="text-fg-3" aria-hidden />
      <div className="text-sm font-semibold">{t('giftsNoMatch', lang)}</div>
      {query ? <div className="text-xs text-fg-3">「{query}」</div> : null}
      <Button onClick={state.resetFilters}>
        <RefreshCw size={14} aria-hidden />
        {t('filterReset', lang)}
      </Button>
    </Card>
  );
}
