/**
 * The 「추천 기프트」 tab of the 「모두 보기」 browser (M121): its filter row and its two sections —
 * 「덱 조건 충족」 and 「조건 없이 발동 · 팩 전용」. Which gift goes where is `lib/recommend.ts`; the
 * browser holds the filter state and hands in how a list of entries becomes tiles (`grid`), so the
 * tiles here are the very tiles of the 「모든 기프트」 grid (icon toggles the goal, name opens the sheet).
 */
import type { ReactNode } from 'react';
import { Info, RefreshCw } from 'lucide-react';
import type { Enums, Keyword } from '../../core/schema.ts';
import { pick, t, type Lang } from '../i18n.ts';
import type { GiftEntry } from '../lib/gift-priority.ts';
import {
  groupByKeyword,
  recommendFiltersActive,
  type RecommendAcquisition,
  type RecommendFilters,
  type RecommendSort,
} from '../lib/recommend.ts';
import { Button, Card, Checkbox, FilterSelect, Notice } from './ui.tsx';

export function RecommendFilterBar({
  filters,
  onChange,
  onReset,
  enums,
  lang,
}: {
  filters: RecommendFilters;
  onChange: (next: RecommendFilters) => void;
  /** Shown once a filter narrows the list (the sort is not a filter). */
  onReset: () => void;
  enums: Enums;
  lang: Lang;
}) {
  const acquisitionOptions: { value: RecommendAcquisition; label: string }[] = [
    { value: 'pack', label: t('recAcqPack', lang) },
    { value: 'general', label: t('recAcqGeneral', lang) },
  ];
  const keywordOptions = enums.keywords.map((k) => ({ value: k.id as Keyword, label: pick(k.name, lang) }));
  // 「키워드별」 is the default, so it is the chip's resting value; the other order lights it up.
  const sortOptions: { value: Exclude<RecommendSort, 'keyword'>; label: string }[] = [
    { value: 'pack', label: t('recSortPack', lang) },
  ];
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid="recommend-filters">
      <FilterSelect
        label={t('recAcquisition', lang)}
        value={filters.acquisition}
        options={acquisitionOptions}
        onChange={(acquisition) => onChange({ ...filters, acquisition })}
        allLabel={t('filterAll', lang)}
      />
      <FilterSelect
        label={t('filterKeyword', lang)}
        value={filters.keyword}
        options={keywordOptions}
        onChange={(keyword) => onChange({ ...filters, keyword })}
        allLabel={t('filterAll', lang)}
      />
      <FilterSelect
        label={t('giftsSort', lang)}
        value={filters.sort === 'keyword' ? 'all' : filters.sort}
        options={sortOptions}
        onChange={(sort) => onChange({ ...filters, sort: sort === 'all' ? 'keyword' : sort })}
        allLabel={t('recSortKeyword', lang)}
      />
      <Checkbox
        checked={filters.fusion}
        onChange={(fusion) => onChange({ ...filters, fusion })}
        className="px-1 text-caption-strong text-fg-muted"
        testId="recommend-fusion"
      >
        {t('recFusion', lang)}
      </Checkbox>
      {recommendFiltersActive(filters) ? (
        <Button size="sm" variant="ghost" onClick={onReset}>
          <RefreshCw size={12} aria-hidden />
          {t('filterReset', lang)}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * One section: a header with its count, then the tiles in the order given (`lib/recommend-rank.ts`) —
 * grouped under keyword heads when sorted so, each group keeping that order, unless it is `flat`.
 */
function Section({
  title,
  entries,
  sort,
  empty,
  grid,
  enums,
  lang,
  testId,
  flat = false,
}: {
  title: string;
  entries: readonly GiftEntry[];
  sort: RecommendSort;
  /** The line shown when the section has nothing. */
  empty: string;
  grid: (entries: readonly GiftEntry[]) => ReactNode;
  enums: Enums;
  lang: Lang;
  testId: string;
  /** Never split into keyword groups, whatever the sort (the E.G.O section — owner's call). */
  flat?: boolean;
}) {
  const keywordName = (keyword: Keyword): string =>
    pick(enums.keywords.find((k) => k.id === keyword)?.name, lang) || keyword;
  let content: ReactNode;
  if (entries.length === 0) {
    content = (
      <div className="px-3 py-3 text-body text-fg-subtle" data-testid="recommend-empty">
        {empty}
      </div>
    );
  } else if (sort === 'keyword' && !flat) {
    content = groupByKeyword(
      entries,
      enums.keywords.map((k) => k.id as Keyword),
    ).map((group) => (
      <div key={group.keyword} data-testid="recommend-keyword" data-keyword={group.keyword}>
        <h4 className="flex items-center gap-1.5 px-3 pt-2 text-caption-strong text-fg-muted">
          {keywordName(group.keyword)}
          <span className="font-num text-micro text-fg-subtle">{group.entries.length}</span>
        </h4>
        {grid(group.entries)}
      </div>
    ));
  } else {
    content = grid(entries);
  }
  return (
    <Card className="overflow-hidden" testId={testId}>
      <h3 className="flex h-9 items-center gap-2 border-b border-border bg-surface-muted px-3 text-subheading">
        <span className="truncate">{title}</span>
        <span className="font-num text-caption text-fg-subtle">{entries.length}</span>
      </h3>
      {content}
    </Card>
  );
}

export function RecommendedSections({
  deck,
  free,
  ego,
  sort,
  deckEmpty,
  notice,
  grid,
  enums,
  lang,
}: {
  deck: readonly GiftEntry[];
  free: readonly GiftEntry[];
  /** 「E.G.O 스킬 조건」 — last, drawn only when it has something, and in one grid (never by keyword). */
  ego: readonly GiftEntry[];
  sort: RecommendSort;
  /** Why 「덱 조건 충족」 is empty: no deck, nothing met, or the filters. */
  deckEmpty: string;
  /** A line above the sections — nobody deployed, so most conditions count nobody. */
  notice?: string;
  grid: (entries: readonly GiftEntry[]) => ReactNode;
  enums: Enums;
  lang: Lang;
}) {
  return (
    <div className="flex flex-col gap-3 p-2">
      {notice ? (
        <div data-testid="recommend-notice">
          <Notice icon={<Info size={14} aria-hidden className="flex-none" />}>{notice}</Notice>
        </div>
      ) : null}
      <Section
        title={t('recDeckTitle', lang)}
        entries={deck}
        sort={sort}
        empty={deckEmpty}
        grid={grid}
        enums={enums}
        lang={lang}
        testId="recommend-deck"
      />
      {/* Deck-independent, so it is drawn only when it has something: an empty one says nothing. */}
      {free.length > 0 ? (
        <Section
          title={t('recFreeTitle', lang)}
          entries={free}
          sort={sort}
          empty=""
          grid={grid}
          enums={enums}
          lang={lang}
          testId="recommend-free"
        />
      ) : null}
      {ego.length > 0 ? (
        <Section
          title={t('recEgoTitle', lang)}
          entries={ego}
          sort={sort}
          empty=""
          grid={grid}
          enums={enums}
          lang={lang}
          testId="recommend-ego"
          flat
        />
      ) : null}
    </div>
  );
}
