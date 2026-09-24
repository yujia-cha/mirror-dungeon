/**
 * Pick the gifts to chase, as a grid of tiles; the detail sheet behind each name carries the
 * wording the tiles leave out (effect text, every condition, how it is obtained, the recipe). The
 * sheet itself is hosted by `PlanProvider`, so it survives this panel closing. Between the filters
 * and the grid sit the observation slots and the selected-gift chips: a chip opens the sheet, and
 * can be dragged onto a slot to pin the gift for observation.
 *
 * Browsing splits the tiles into 활성 / 기타 by whether the current deck activates them. **A search
 * does not** — see `results` below — and 활성 steps aside once every gift in it is already a goal.
 */
import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronLeft, ChevronRight, Link2, RefreshCw, Search, User, X } from 'lucide-react';
import type { AcquisitionKind, GameData, Gift, Keyword, Sin } from '../../core/schema.ts';
import { evaluateConditions, observable } from '../../core/index.ts';
import type { ConditionReport, DeckStats, GameIndexes } from '../../core/types.ts';
import { pick, t, type Lang } from '../i18n.ts';
import { useApp } from '../store.ts';
import { matchesQuery } from '../lib/hangul.ts';
import { SIN_LABEL, badgeFor, tierLabel } from '../lib/labels.ts';
import { prioritiseGifts, type GiftEntry, type GiftGroup } from '../lib/gift-priority.ts';
import { judgementOf } from '../lib/judgement.ts';
import { useChipDrag } from '../lib/useChipDrag.ts';
import { Badge, Button, Card, FilterSelect } from '../components/ui.tsx';
import { GiftIcon } from '../components/GiftIcon.tsx';
import { GiftTileGrid } from '../components/GiftGrid.tsx';
import { isMarked, type GiftTileData } from '../lib/gift-tile.ts';
import { ObserveSlots } from '../components/ObserveSlots.tsx';
import { usePlan } from '../shell/plan-context.ts';

interface Props {
  data: GameData;
  indexes: GameIndexes;
  stats: DeckStats;
  lang: Lang;
  /** Where to send the player when the deck is empty (the deck tab). */
  onGoDeck?: () => void;
}

type TierFilter = '1' | '2' | '3' | '4' | '5' | 'EX';
type PriceFilter = 'p1' | 'p2' | 'p3' | 'p4';
const PRICE_BANDS: Record<PriceFilter, [number, number]> = { p1: [0, 150], p2: [151, 250], p3: [251, 400], p4: [401, Infinity] };

const GROUPS: { group: GiftGroup; title: 'giftsActive' | 'giftsOther' }[] = [
  { group: 'active', title: 'giftsActive' },
  { group: 'other', title: 'giftsOther' },
];

export function GiftsStep({ data, indexes, stats, lang, onGoDeck }: Props) {
  const deck = useApp((s) => s.deck);
  const wanted = useApp((s) => s.wanted);
  const removeWanted = useApp((s) => s.removeWanted);
  const clearWanted = useApp((s) => s.clearWanted);
  const observedGifts = useApp((s) => s.options.observedGifts);
  const toggleObserved = useApp((s) => s.toggleObserved);
  const setOptions = useApp((s) => s.setOptions);
  const observeMax = data.rules.giftObservation.max;
  // The selection rule and the derived views over `wanted` are the shell's (`PlanProvider`), so
  // they are computed once and every surface agrees.
  const { openGift, childrenOf, entangled, blocked, needed, toggleGoal: toggle } = usePlan();

  const [query, setQuery] = useState('');
  const [keyword, setKeyword] = useState<Keyword | 'all'>('all');
  const [tier, setTier] = useState<TierFilter | 'all'>('all');
  const [acquisition, setAcquisition] = useState<AcquisitionKind | 'all'>('all');
  const [sin, setSin] = useState<Sin | 'all'>('all');
  const [price, setPrice] = useState<PriceFilter | 'all'>('all');
  // The selection tray's own view: how the chips are ordered, and which of them are shown. It is
  // a view over `wanted`, never a reordering of it — the store keeps the order things were chosen
  // in, which is what 「선택 순서」 means and what the share link carries.
  const [chipSort, setChipSort] = useState<'keyword' | 'name' | 'all'>('all');
  const [chipKeyword, setChipKeyword] = useState<Keyword | 'all'>('all');
  const [chipPack, setChipPack] = useState<string>('all');
  // 「기타」 is the long tail, so it starts folded; 「활성」 opens with the panel.
  const [collapsed, setCollapsed] = useState<Record<GiftGroup, boolean>>({ active: false, other: true });
  const filtersOn = keyword !== 'all' || tier !== 'all' || acquisition !== 'all' || sin !== 'all' || price !== 'all' || query.trim() !== '';
  const resetFilters = (): void => {
    setQuery('');
    setKeyword('all');
    setTier('all');
    setAcquisition('all');
    setSin('all');
    setPrice('all');
  };

  const conditionByGift = useMemo(() => {
    const reports = evaluateConditions(
      data.gifts.filter((gift) => gift.conditions.length > 0).map((gift) => gift.id),
      stats,
      indexes,
    );
    const map = new Map<number, ConditionReport[]>();
    for (const report of reports) map.set(report.giftId, [...(map.get(report.giftId) ?? []), report]);
    return map;
  }, [data, stats, indexes]);

  // Two fusion goals can eat the same ingredient; a state that already holds both still says so.
  const entangledIds = useMemo(() => new Set(entangled.keys()), [entangled]);

  const matchesFilters = (gift: Gift): boolean => {
    const needle = query.trim().toLowerCase();
    if (!matchesQuery(`${gift.name.ko} ${gift.name.en}`.toLowerCase(), needle)) return false;
    if (keyword !== 'all' && gift.keyword !== keyword) return false;
    if (tier !== 'all' && String(gift.tier) !== tier) return false;
    if (acquisition !== 'all' && gift.acquisition.kind !== acquisition) return false;
    if (sin !== 'all' && gift.sin !== sin) return false;
    if (price !== 'all') {
      const [lo, hi] = PRICE_BANDS[price];
      if (gift.price === null || gift.price < lo || gift.price > hi) return false;
    }
    return true;
  };

  const groups = useMemo(() => {
    const candidates = data.gifts.filter((gift) => gift.obtainable || wanted.includes(gift.id));
    const parents = candidates.filter((gift) => {
      const isChild = gift.upgradeOf !== null && indexes.giftById.has(gift.upgradeOf);
      if (isChild) return false;
      const kids = childrenOf.get(gift.id) ?? [];
      return matchesFilters(gift) || kids.some(matchesFilters);
    });
    return prioritiseGifts(parents, conditionByGift);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, indexes, wanted, conditionByGift, childrenOf, query, keyword, tier, acquisition, sin, price]);

  const total = groups.active.length + groups.other.length;
  const giftName = (id: number): string => pick(indexes.giftById.get(id)?.name, lang);
  const judgementFor = (id: number) => judgementOf(conditionByGift.get(id));
  /** Packs a gift can only be had from: its 테마 팩 한정 packs and the boss that drops it on clear. */
  const boundPacks = (id: number): number[] => {
    const gift = indexes.giftById.get(id);
    if (!gift) return [];
    const reward = gift.acquisition.clearRewardOf;
    return [...gift.acquisition.exclusiveTo, ...(reward === null || reward === undefined ? [] : [reward])];
  };
  const keywordOrder = new Map(data.enums.keywords.map((k, i) => [k.id as Keyword, i]));
  const shownChips = useMemo(() => {
    const kept = wanted.filter((id) => {
      const gift = indexes.giftById.get(id);
      if (!gift) return false;
      if (chipKeyword !== 'all' && gift.keyword !== chipKeyword) return false;
      if (chipPack !== 'all' && !boundPacks(id).includes(Number(chipPack))) return false;
      return true;
    });
    if (chipSort === 'all') return kept;
    const name = (id: number): string => pick(indexes.giftById.get(id)?.name, lang);
    return [...kept].sort((a, b) =>
      chipSort === 'name'
        ? name(a).localeCompare(name(b), lang === 'ko' ? 'ko' : 'en')
        : (keywordOrder.get(indexes.giftById.get(a)!.keyword) ?? 99) - (keywordOrder.get(indexes.giftById.get(b)!.keyword) ?? 99) ||
          name(a).localeCompare(name(b), lang === 'ko' ? 'ko' : 'en'),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, indexes, lang, chipSort, chipKeyword, chipPack]);
  const canObserve = (id: number): boolean => {
    const gift = indexes.giftById.get(id);
    return gift ? observable(gift, data.rules) : false;
  };


  // Observation: the slots take a selected gift from the 「+」 list or from a dragged chip. A drop
  // on a filled slot replaces its gift; a drop elsewhere, or of a gift that cannot be observed,
  // does nothing.
  /*
   * `needed`, not `wanted`: a fusion goal is a promise about its ingredients too, and those are
   * often the pin that matters — the shop has to hand a piece over before the fusion can happen,
   * and observation is the one way to make that certain. They have no chip to drag (the selection
   * holds the result, not its pieces), so the 「+」 list is their way in.
   */
  const observeCandidates = [...needed].filter((id) => canObserve(id) && !observedGifts.includes(id));
  const pin = (id: number): void => toggleObserved(id, { max: observeMax, observable: canObserve });
  const unpin = (id: number): void => {
    if (observedGifts.includes(id)) toggleObserved(id, { max: observeMax, observable: canObserve });
  };
  const drag = useChipDrag((giftId, slot) => {
    if (slot === null || !canObserve(giftId)) return;
    // The slot order is what the run pays (`costTable`), so moving a pin between cells is a real
    // choice — dropping an already-pinned chip used to light the target up and then do nothing.
    if (observedGifts.includes(giftId)) {
      const rest = observedGifts.filter((id) => id !== giftId);
      const at = Math.min(slot, rest.length);
      setOptions({ observedGifts: [...rest.slice(0, at), giftId, ...rest.slice(at)] });
      return;
    }
    const occupant = observedGifts[slot];
    if (occupant !== undefined) setOptions({ observedGifts: observedGifts.map((id) => (id === occupant ? giftId : id)) });
    else pin(giftId);
  });
  const draggedGift = drag.state.dragging !== null ? indexes.giftById.get(drag.state.dragging) : undefined;

  const tilesFor = (entries: GiftEntry[]): GiftTileData[] =>
    entries.flatMap((entry) => {
      const kids = (childrenOf.get(entry.gift.id) ?? []).filter((g) => g.obtainable || wanted.includes(g.id));
      return [
        { entry },
        ...kids.map((g) => ({ entry: { ...entry, gift: g, reports: conditionByGift.get(g.id) ?? [] }, parent: entry.gift })),
      ];
    });

  const tiles: Record<GiftGroup, GiftTileData[]> = { active: tilesFor(groups.active), other: tilesFor(groups.other) };
  const grid = (list: GiftTileData[]) => (
    <GiftTileGrid
      tiles={list}
      wanted={wanted}
      entangled={entangledIds}
      blocked={blocked}
      giftName={giftName}
      enums={data.enums}
      lang={lang}
      onToggle={toggle}
      onOpen={openGift}
    />
  );

  const section = (group: GiftGroup, titleKey: 'giftsActive' | 'giftsOther') => {
    // 조합 계승 children come into the grid under their parent, so the parent count read low.
    const list = tiles[group];
    const chosen = list.filter((tile) => wanted.includes(tile.entry.gift.id)).length;
    const shut = collapsed[group];
    return (
      <Card className="overflow-hidden" key={group}>
        <button
          type="button"
          onClick={() => setCollapsed((state) => ({ ...state, [group]: !state[group] }))}
          aria-expanded={!shut}
          className="flex h-9 w-full items-center justify-between border-b border-line bg-surface-2 px-3 text-left"
        >
          <span className="flex items-center gap-2 text-sm font-semibold">
            {t(titleKey, lang)} <span className="font-num text-xs text-fg-3">{list.length}</span>
            {shut && chosen > 0 ? <Badge tone="neutral">{t('giftsSelected', lang, { n: chosen })}</Badge> : null}
          </span>
          <span className="text-fg-3">{shut ? <ChevronRight size={14} /> : <ChevronDown size={14} />}</span>
        </button>
        {shut ? null : (
          <div className={group === 'other' ? 'max-h-[60dvh] overflow-y-auto' : undefined} data-testid={group === 'other' ? 'gift-scroller' : undefined}>
            {grid(list)}
          </div>
        )}
      </Card>
    );
  };

  const searching = query.trim() !== '';
  /*
    A query is a narrowing already, so splitting its answer into 활성 / 기타 narrows it twice: what
    the reader typed for sat behind 「기타」, which opens shut. One list instead. 활성 still comes
    first — that is the order `prioritiseGifts` left them in — and the tile's own ring keeps saying
    whether the deck activates it, so the split carried nothing the tiles do not.
  */
  const results = [...tiles.active, ...tiles.other];
  /*
    「활성」 is a worklist: once nothing in it is left to decide there is no reason to keep reading it,
    so it steps aside and 「기타」 rises to the top. 「남은 일」 is the tile's own question (`isMarked`), not
    just membership in `wanted` — choosing 진혼 settles 요리 비법 전서 too, and the ✓ on that tile says
    so. Not when it is the only thing on screen, though — hiding it with nothing behind it would
    leave the tab blank.
  */
  const activeSettled = tiles.active.length > 0 && tiles.active.every((tile) => isMarked(tile, wanted, blocked));
  const shownGroups = GROUPS.filter(({ group }) => !(group === 'active' && activeSettled && tiles.other.length > 0));
  let body: React.ReactNode;
  if (deck.length === 0) {
    body = (
      <Card className="flex flex-col items-center gap-2.5 px-4 py-8 text-center">
        <User size={28} className="text-fg-3" aria-hidden />
        <div className="text-sm font-semibold">{t('giftsDeckEmpty', lang)}</div>
        <div className="text-xs text-fg-3">{t('giftsDeckEmptyHint', lang)}</div>
        {onGoDeck ? (
          <Button variant="primary" onClick={onGoDeck}>
            <ChevronLeft size={14} aria-hidden />
            {t('toDeck', lang)}
          </Button>
        ) : null}
      </Card>
    );
  } else if (total === 0) {
    body = (
      <Card className="flex flex-col items-center gap-2.5 px-4 py-8 text-center">
        <Search size={28} className="text-fg-3" aria-hidden />
        <div className="text-sm font-semibold">{t('giftsNoMatch', lang)}</div>
        {query.trim() ? <div className="text-xs text-fg-3">「{query.trim()}」</div> : null}
        <Button onClick={resetFilters}>
          <RefreshCw size={14} aria-hidden />
          {t('filterReset', lang)}
        </Button>
      </Card>
    );
  } else if (searching) {
    body = (
      <Card className="overflow-hidden">
        <div className="flex h-9 items-center gap-2 border-b border-line bg-surface-2 px-3 text-sm font-semibold">
          {t('giftsResults', lang)} <span className="font-num text-xs text-fg-3">{results.length}</span>
        </div>
        <div className="max-h-[60dvh] overflow-y-auto" data-testid="gift-scroller">
          {grid(results)}
        </div>
      </Card>
    );
  } else {
    body = <div className="flex flex-col gap-2.5">{shownGroups.map(({ group, title }) => section(group, title))}</div>;
  }

  const keywordOptions = data.enums.keywords.map((k) => ({ value: k.id as Keyword, label: pick(k.name, lang) }));
  // The tray's own filters only offer what the selection actually holds — a keyword or a pack with
  // no chip behind it would filter to nothing.
  const chipKeywordOptions = keywordOptions.filter((option) => wanted.some((id) => indexes.giftById.get(id)?.keyword === option.value));
  const chipPackOptions = [...new Set(wanted.flatMap(boundPacks))]
    .map((packId) => ({ value: String(packId), label: pick(indexes.packById.get(packId)?.name, lang) }))
    .filter((option) => option.label !== '')
    .sort((a, b) => a.label.localeCompare(b.label, lang === 'ko' ? 'ko' : 'en'));
  const sortOptions = [
    { value: 'keyword' as const, label: t('filterKeyword', lang) },
    { value: 'name' as const, label: t('giftsSortName', lang) },
  ];
  const sinOptions = data.enums.sins.map((s) => ({ value: s as Sin, label: t(SIN_LABEL[s as Sin], lang) }));
  const acqOptions = (['general', 'packLimited', 'fusionOnly', 'startOnly', 'clearReward', 'hiddenBattle', 'event'] as AcquisitionKind[]).map((k) => ({
    value: k,
    label: t(badgeFor(k).label, lang),
  }));
  // The bands do not overlap, so 「~250」 read as a promise the filter broke: a 100-cost gift is not
  // in `p2`. Each label now names the band it actually keeps.
  const priceOptions: { value: PriceFilter; label: string }[] = [
    { value: 'p1', label: t('priceUpTo', lang, { n: 150 }) },
    { value: 'p2', label: t('priceBand', lang, { from: 151, to: 250 }) },
    { value: 'p3', label: t('priceBand', lang, { from: 251, to: 400 }) },
    { value: 'p4', label: t('priceOver', lang, { n: 400 }) },
  ];

  return (
    <div className="flex flex-col gap-2.5">
      <label className="flex h-9 items-center gap-2 rounded-sm border border-line-strong bg-surface px-2.5 text-sm">
        <Search size={14} aria-hidden className="flex-none text-fg-3" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('giftsSearch', lang)}
          aria-label={t('giftsSearch', lang)}
          className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-fg-3"
        />
      </label>
      {/*
        While a query is being typed, its results belong under the box that asked for them — the
        filters, the observation slots and the selection tray would otherwise push them a screen
        down. With no query the grid goes back to the foot of the tab.
      */}
      {searching ? body : null}
      <div className="flex flex-wrap gap-1.5">
        <FilterSelect label={t('filterKeyword', lang)} value={keyword} options={keywordOptions} onChange={setKeyword} allLabel={t('filterAll', lang)} />
        <FilterSelect
          label={t('filterTier', lang)}
          value={tier}
          options={(['1', '2', '3', '4', '5', 'EX'] as TierFilter[]).map((v) => ({ value: v, label: tierLabel(v === 'EX' ? 'EX' : (Number(v) as 1 | 2 | 3 | 4 | 5)) }))}
          onChange={setTier}
          allLabel={t('filterAll', lang)}
        />
        <FilterSelect label={t('filterAcquisition', lang)} value={acquisition} options={acqOptions} onChange={setAcquisition} allLabel={t('filterAll', lang)} />
        <FilterSelect label={t('filterSin', lang)} value={sin} options={sinOptions} onChange={setSin} allLabel={t('filterAll', lang)} />
        <FilterSelect label={t('filterPrice', lang)} value={price} options={priceOptions} onChange={setPrice} allLabel={t('filterAll', lang)} />
        {filtersOn ? (
          <Button size="sm" variant="ghost" onClick={resetFilters}>
            <RefreshCw size={12} aria-hidden />
            {t('filterReset', lang)}
          </Button>
        ) : null}
      </div>

      <ObserveSlots
        slots={observedGifts}
        max={observeMax}
        candidates={observeCandidates}
        indexes={indexes}
        judgementOf={judgementFor}
        lang={lang}
        onPin={pin}
        onUnpin={unpin}
        dragging={drag.state.dragging !== null}
        over={drag.state.over}
        onHover={drag.setOver}
      />

      {wanted.length > 0 ? (
        <div className="flex flex-col gap-1.5 rounded-md border border-line bg-surface-2 px-2.5 py-2" aria-label={t('giftsSelected', lang, { n: wanted.length })}>
          {/*
            Sorting and filtering are a view over the tray, not over the store: 「선택 순서」 is the
            order things were chosen in, and a filter hides chips without unselecting anything.
          */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-0.5 text-xs font-medium text-fg-2">
              {t('giftsSelected', lang, { n: wanted.length })}
              {shownChips.length !== wanted.length ? <span className="ml-1 font-num text-fg-3">{`· ${shownChips.length}`}</span> : null}
            </span>
            <FilterSelect label={t('giftsSort', lang)} value={chipSort} options={sortOptions} onChange={setChipSort} allLabel={t('giftsSortPicked', lang)} />
            <FilterSelect label={t('filterKeyword', lang)} value={chipKeyword} options={chipKeywordOptions} onChange={setChipKeyword} allLabel={t('filterAll', lang)} />
            {chipPackOptions.length > 0 ? (
              <FilterSelect label={t('giftsPack', lang)} value={chipPack} options={chipPackOptions} onChange={setChipPack} allLabel={t('filterAll', lang)} />
            ) : null}
            <button type="button" onClick={clearWanted} className="ml-auto text-xs text-fg-3 underline">
              {t('giftsClear', lang)}
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-1.5" data-testid="gift-chips">
          {shownChips.map((id) => {
            const gift = indexes.giftById.get(id);
            const pinned = observedGifts.includes(id);
            return (
              <span
                key={id}
                data-testid="gift-chip"
                data-gift={id}
                data-pinned={pinned || undefined}
                data-entangled={entangledIds.has(id) || undefined}
                {...drag.handleFor(id)}
                // `none` made every chip a dead zone: with a dozen goals the panel could not be
                // scrolled by touching one. `pan-y` keeps scrolling; on touch the drag starts on a
                // long press instead (`useChipDrag`), so the callout that a long press would open
                // on iOS is turned off here.
                style={{ touchAction: 'pan-y', WebkitTouchCallout: 'none' }}
                onContextMenu={(event) => event.preventDefault()}
                className={`inline-flex h-7 select-none items-center gap-1 rounded-full border bg-surface pl-1 pr-1 text-xs text-fg ${pinned ? 'border-ink' : 'border-line-strong'} ${
                  drag.state.dragging === id ? 'opacity-40' : ''
                }`}
              >
                {gift ? <GiftIcon gift={gift} size={20} judgement={judgementFor(id)} lang={lang} /> : null}
                <button type="button" onClick={() => openGift(id)} aria-haspopup="dialog" aria-label={t('giftDetail', lang, { name: giftName(id) })} className="hover:underline">
                  {giftName(id)}
                </button>
                {entangledIds.has(id) ? <Link2 size={11} aria-hidden className="text-fg-2" /> : null}
                <button type="button" onClick={() => removeWanted(id)} aria-label={t('removeFromSelection', lang, { name: giftName(id) })} className="text-fg-3">
                  <X size={11} />
                </button>
              </span>
            );
          })}
          </div>
        </div>
      ) : null}

      {draggedGift
        ? createPortal(
            <div
              className="pointer-events-none fixed z-[70] -translate-x-1/2 -translate-y-1/2 rounded-md bg-surface p-1 shadow-pop"
              style={{ left: drag.state.x, top: drag.state.y }}
              data-testid="chip-ghost"
              aria-hidden
            >
              <GiftIcon gift={draggedGift} size={32} lang={lang} />
            </div>,
            document.body,
          )
        : null}

      {searching ? null : body}
    </div>
  );
}
