import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, Plus, Search, Users, X } from 'lucide-react';
import type { GameData, Identity } from '../../core/schema.ts';
import type { DeckStats, GameIndexes } from '../../core/types.ts';
import { pick, t, type Lang } from '../i18n.ts';
import { matchesQuery } from '../lib/hangul.ts';
import { sinnerOf, useApp } from '../store.ts';
import { factionName, identityKeywordLabel } from '../format.ts';
import { identitiesFromFormationCode } from '../lib/formation-code.ts';
import { DEPLOYED_AT_START, defaultDeck } from '../lib/default-deck.ts';
import { deckSummaryChips } from '../lib/deck-summary.ts';
import { fitShift } from '../lib/fit-inside.ts';
import { useCursor } from '../lib/use-cursor.ts';
import { stepIndex, useDismiss } from '../lib/useDismiss.ts';
import { Button, Chip } from '../components/ui.tsx';

interface Props {
  data: GameData;
  indexes: GameIndexes;
  stats: DeckStats;
  lang: Lang;
}

/**
 * Several words search as OR: 「화상 침잠」 finds every identity carrying either keyword, so a
 * party can be assembled from one query. A single word behaves as it always did.
 */
function matches(identity: Identity, needles: string[], data: GameData): boolean {
  if (needles.length === 0) return true;
  const haystack = [
    identity.title.ko,
    identity.title.en,
    identity.sinner.ko,
    identity.sinner.en,
    ...identity.factions.flatMap((f) => [factionName(f, data.enums, 'ko'), factionName(f, data.enums, 'en')]),
    ...Object.entries(identity.keywords).flatMap(([k, info]) => [
      identityKeywordLabel(k as never, info, data.enums, 'ko').label,
      identityKeywordLabel(k as never, info, data.enums, 'en').label,
    ]),
  ]
    .join(' ')
    .toLowerCase();
  return needles.some((needle) => matchesQuery(haystack, needle));
}

function KeywordChips({ identity, data, lang }: { identity: Identity; data: GameData; lang: Lang }) {
  const entries = Object.entries(identity.keywords);
  // Nothing at all when an identity carries no keyword. The five that derive none genuinely inflict
  // none — their skills only apply 마비·속박·방어 레벨 류 buffs, and the derived mirror agrees — so a
  // 「?」 and a 「판정이 낮게 나올 수 있습니다」 said something untrue. Whether the derivation itself
  // ever goes wrong is a build-time question, and `data:validate` asks it against the mirror.
  if (entries.length === 0) return null;
  // Name only — 「침잠」, not 「침잠 5」. Whether a keyword is the 특수 variant is part of the name.
  return (
    <>
      {entries.map(([keyword, info]) => {
        const { label, title } = identityKeywordLabel(keyword as never, info, data.enums, lang);
        return (
          <Chip key={keyword} title={title}>
            {label}
          </Chip>
        );
      })}
    </>
  );
}

export function DeckStep({ data, indexes, stats, lang }: Props) {
  const deck = useApp((s) => s.deck);
  const deployed = useApp((s) => s.deployed);
  const setDeckSlot = useApp((s) => s.setDeckSlot);
  const setDeck = useApp((s) => s.setDeck);
  const toggleDeployed = useApp((s) => s.toggleDeployed);
  const max = data.rules.deployment.max;
  const full = deployed.length >= max;

  const [query, setQuery] = useState('');
  const [openSinner, setOpenSinner] = useState<number | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [code, setCode] = useState('');
  const [importMessage, setImportMessage] = useState<string | null>(null);

  const searchRef = useRef<HTMLDivElement | null>(null);

  const bySinner = useMemo(() => new Map(deck.map((id) => [sinnerOf(id), id])), [deck]);
  const needle = query.trim().toLowerCase();
  // The highlight resets itself when the query changes; see `useCursor`.
  const [activeIndex, setActiveIndex] = useCursor(needle);
  const needles = useMemo(() => needle.split(/\s+/).filter(Boolean), [needle]);
  const globalResults = useMemo(() => {
    if (needles.length === 0) return [];
    return data.identities
      .filter((identity) => matches(identity, needles, data))
      .sort((a, b) => a.sinnerId - b.sinnerId || b.rank - a.rank || a.id - b.id)
      .slice(0, 40);
  }, [data, needles]);
  // The list stays up while picking, so several identities can be taken from one search; Escape and
  // an outside press close it without wiping the query, and the ✕ inside the field clears the text.
  const [listOpen, setListOpen] = useState(false);
  const open = listOpen && needle.length > 0;
  const closeSearch = useCallback(() => setListOpen(false), []);
  useDismiss(searchRef, closeSearch, open);
  const onSearchKey = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    const next = stepIndex(event.key, activeIndex, globalResults.length);
    if (next !== null) {
      event.preventDefault();
      setActiveIndex(next);
    } else if (event.key === 'Enter' && open && globalResults[activeIndex]) {
      event.preventDefault();
      pickIdentity(globalResults[activeIndex]);
    } else if (event.key === 'Escape' && open) {
      // `useDismiss` already closes only the topmost layer, so this just keeps the caret in the
      // field rather than letting the key travel on.
      event.preventDefault();
      setListOpen(false);
    }
  };

  /** Take an identity into its sinner's slot, or out of it when that slot already holds it. */
  const pickIdentity = (identity: Identity): void => {
    const held = bySinner.get(identity.sinnerId) === identity.id;
    setDeckSlot(identity.sinnerId, held ? null : identity.id, DEPLOYED_AT_START);
    setOpenSinner(null);
  };

  const applyImport = (): void => {
    const result = identitiesFromFormationCode(code, indexes);
    if (!result) {
      setImportMessage(t('deckImportFailed', lang));
      return;
    }
    setDeck(result.ids, DEPLOYED_AT_START, result.deployed.slice(0, max));
    setImportMessage(result.skipped > 0 ? t('deckImportPartial', lang) : null);
    if (result.skipped === 0) setImportOpen(false);
  };

  const chips = deckSummaryChips(stats, data.enums, lang);

  return (
    <div className="flex flex-col gap-3">
      <div className="relative flex flex-wrap items-center gap-2" ref={searchRef}>
        <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-sm border border-line-strong bg-surface px-2.5 text-sm">
          <Search size={14} aria-hidden className="flex-none text-fg-3" />
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setListOpen(true);
            }}
            onFocus={() => setListOpen(true)}
            onKeyDown={onSearchKey}
            placeholder={t('deckSearchAll', lang)}
            aria-label={t('deckSearchAll', lang)}
            role="combobox"
            aria-expanded={open}
            aria-controls="deck-search-listbox"
            aria-autocomplete="list"
            aria-activedescendant={
              open && globalResults[activeIndex] ? `deck-option-${globalResults[activeIndex].id}` : undefined
            }
            className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-fg-3"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label={t('deckClose', lang)}
              className="text-fg-3"
            >
              <X size={14} />
            </button>
          ) : null}
        </label>
        <span
          className="inline-flex h-9 items-center gap-1.5 rounded-sm border border-line bg-surface-2 px-3 text-sm font-medium"
          title={full ? t('deckDeployedFull', lang, { max }) : undefined}
        >
          {t('deckDeployed', lang)}{' '}
          <span className="font-num">
            {deployed.length}/{max}
          </span>
        </span>
        <Button
          onClick={() => setDeck(defaultDeck(data), DEPLOYED_AT_START)}
          ariaLabel={t('deckDefault', lang)}
          className="h-9"
        >
          <Users size={14} aria-hidden />
          <span className="hidden @sm:inline">{t('deckDefault', lang)}</span>
        </Button>
        <Button onClick={() => setImportOpen((v) => !v)} ariaLabel={t('deckImport', lang)} className="h-9">
          <Copy size={14} aria-hidden />
          <span className="hidden @sm:inline">{t('deckImport', lang)}</span>
        </Button>
        {open ? (
          <div
            id="deck-search-listbox"
            role="listbox"
            aria-label={t('deckSearchAll', lang)}
            className="absolute left-0 top-10 z-20 flex max-h-[420px] w-full max-w-[560px] flex-col overflow-y-auto rounded-md border border-line-strong bg-surface shadow-pop"
          >
            <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2 text-xs text-fg-3">
              <span>
                {globalResults.length > 0
                  ? t('deckSearchHint', lang, { n: globalResults.length })
                  : t('deckSearchNone', lang)}
              </span>
              {globalResults.length > 0 ? (
                <span>
                  {t('deckSearchPicked', lang, {
                    n: globalResults.filter((identity) => bySinner.get(identity.sinnerId) === identity.id)
                      .length,
                  })}
                </span>
              ) : null}
            </div>
            {globalResults.map((identity, i) => {
              const held = bySinner.get(identity.sinnerId) === identity.id;
              return (
                <button
                  key={identity.id}
                  id={`deck-option-${identity.id}`}
                  type="button"
                  role="option"
                  aria-selected={i === activeIndex}
                  aria-pressed={held}
                  data-picked={held || undefined}
                  onClick={() => pickIdentity(identity)}
                  onPointerMove={() => setActiveIndex(i)}
                  className={`flex h-11 items-center gap-3 border-b border-line px-3 text-left hover:bg-surface-2 ${i === activeIndex ? 'bg-surface-2' : ''}`}
                >
                  <span
                    className={`inline-flex h-4 w-4 flex-none items-center justify-center rounded-[4px] border ${held ? 'border-ink bg-ink text-ink-fg' : 'border-line-strong'}`}
                    aria-hidden
                  >
                    {held ? <Check size={11} strokeWidth={3} /> : null}
                  </span>
                  <span className="w-16 flex-none text-xs font-medium text-fg-2">
                    {pick(identity.sinner, lang)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-fg">
                    {pick(identity.title, lang)}
                    <span className="text-xs text-fg-3"> · {t('deckRank', lang, { n: identity.rank })}</span>
                  </span>
                  <span className="hidden gap-1 @sm:flex">
                    <KeywordChips identity={identity} data={data} lang={lang} />
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
      {importOpen ? (
        <form
          className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-surface p-2"
          onSubmit={(event) => {
            event.preventDefault();
            applyImport();
          }}
        >
          <input
            value={code}
            onChange={(event) => setCode(event.target.value)}
            aria-label={t('deckImportPlaceholder', lang)}
            placeholder={t('deckImportPlaceholder', lang)}
            className="h-8 min-w-0 flex-1 rounded-sm border border-line-strong bg-surface px-2 font-num text-xs outline-none"
          />
          <Button type="submit" variant="primary">
            {t('deckImportApply', lang)}
          </Button>
          {importMessage ? <span className="w-full text-xs text-fg-2">{importMessage}</span> : null}
        </form>
      ) : null}

      <ul
        className="grid grid-cols-1 gap-2 @min-[300px]:grid-cols-2 @min-[640px]:grid-cols-4"
        aria-label={t('tabDeck', lang)}
      >
        {data.enums.sinners.map((sinner) => {
          const id = bySinner.get(sinner.id) ?? null;
          const identity = id !== null ? indexes.identityById.get(id) : undefined;
          const isDeployed = id !== null && deployed.includes(id);
          const open = openSinner === sinner.id;
          return (
            <li
              key={sinner.id}
              className={`relative flex flex-col gap-1.5 rounded-md p-3 ${
                identity
                  ? isDeployed
                    ? 'border border-line-strong bg-surface shadow-card'
                    : 'border border-line bg-surface-2'
                  : 'border border-dashed border-line-strong'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-fg-2">{pick(sinner.name, lang)}</span>
                {identity ? (
                  <label
                    className={`inline-flex items-center gap-1.5 text-xs font-medium ${isDeployed ? 'text-fg' : 'text-fg-3'}`}
                    title={!isDeployed && full ? t('deckDeployedFull', lang, { max }) : undefined}
                  >
                    <input
                      type="checkbox"
                      checked={isDeployed}
                      disabled={!isDeployed && full}
                      onChange={() => toggleDeployed(identity.id, max)}
                      aria-label={`${pick(sinner.name, lang)} ${t('deckDeployed', lang)}`}
                      className="h-4 w-4 accent-[var(--color-ink)]"
                    />
                    {isDeployed ? t('deckDeployed', lang) : t('deckReserve', lang)}
                  </label>
                ) : (
                  <span className="text-xs text-fg-3">{t('deckReserve', lang)}</span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setOpenSinner(open ? null : sinner.id)}
                aria-expanded={open}
                className="flex min-w-0 flex-col items-start gap-1 rounded-sm text-left hover:underline"
              >
                {identity ? (
                  <>
                    <span className="flex min-w-0 max-w-full items-baseline gap-1.5">
                      <span className="truncate text-sm font-medium text-fg">
                        {pick(identity.title, lang)}
                      </span>
                      <span className="flex-none text-xs text-fg-3">
                        {t('deckRank', lang, { n: identity.rank })}
                      </span>
                    </span>
                    <span className="flex flex-wrap gap-1">
                      <KeywordChips identity={identity} data={data} lang={lang} />
                    </span>
                  </>
                ) : (
                  <span className="flex items-center gap-1.5 text-sm text-fg-3">
                    <Plus size={13} aria-hidden />
                    {t('deckEmptySlot', lang)}
                  </span>
                )}
              </button>
              {open ? (
                <SinnerPicker
                  sinner={sinner.id}
                  sinnerName={pick(sinner.name, lang)}
                  data={data}
                  lang={lang}
                  selected={id}
                  onPick={(picked) => {
                    setDeckSlot(sinner.id, picked, DEPLOYED_AT_START);
                    setOpenSinner(null);
                  }}
                  onClose={() => setOpenSinner(null)}
                />
              ) : null}
            </li>
          );
        })}
      </ul>

      {deck.length === 0 ? null : (
        <div className="flex flex-wrap items-center gap-1.5">
          {chips.map((chip) => (
            <Chip key={chip.label} title={t('deckChipBasis', lang, { n: chip.count, total: chip.formation })}>
              {chip.label} <b className="font-semibold text-fg">{chip.count}</b>
              <span className="text-fg-3">/{chip.formation}</span>
            </Chip>
          ))}
        </div>
      )}
    </div>
  );
}

/** The panel body's own horizontal padding (`px-3`), kept clear on both sides. */
const PICKER_PAD = 12;

function SinnerPicker({
  sinner,
  sinnerName,
  data,
  lang,
  selected,
  onPick,
  onClose,
}: {
  sinner: number;
  sinnerName: string;
  data: GameData;
  lang: Lang;
  selected: number | null;
  onPick: (identityId: number | null) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const needle = query.trim().toLowerCase();
  const [activeIndex, setActiveIndex] = useCursor(needle);
  const all = data.identities.filter((identity) => identity.sinnerId === sinner);
  const identities = all
    .filter((identity) => matches(identity, needle.split(/\s+/).filter(Boolean), data))
    .sort((a, b) => b.rank - a.rank || a.id - b.id);
  useDismiss(ref, onClose, true);
  // From `@sm` up the picker floats under its slot, and a slot in the right column has less room to
  // the panel's edge than the picker is wide: the panel body clipped it. Measure and slide it left.
  const [shift, setShift] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = (): void => {
      const bounds = el.parentElement?.closest('.\\@container');
      if (!bounds || getComputedStyle(el).position !== 'absolute') return setShift(0);
      const box = el.getBoundingClientRect();
      const base = box.left - (Number.parseFloat(el.style.left) || 0);
      setShift(fitShift({ left: base, right: base + box.width }, bounds.getBoundingClientRect(), PICKER_PAD));
    };
    fit();
    // Not `autoFocus`: that scrolls the panel body sideways to the field before the shift lands,
    // and the panel stays scrolled after the picker closes.
    inputRef.current?.focus({ preventScroll: true });
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);
  const onKey = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    const next = stepIndex(event.key, activeIndex, identities.length);
    if (next !== null) {
      event.preventDefault();
      setActiveIndex(next);
    } else if (event.key === 'Enter' && identities[activeIndex]) {
      event.preventDefault();
      onPick(identities[activeIndex].id);
    }
  };
  return (
    <div
      ref={ref}
      className="mt-1 flex flex-col overflow-hidden rounded-md border border-line-strong bg-surface shadow-pop @sm:absolute @sm:left-0 @sm:top-full @sm:z-20 @sm:mt-0 @sm:w-[min(340px,calc(100cqw-1.5rem))]"
      style={shift ? { left: shift } : undefined}
      data-testid="sinner-picker"
    >
      <div className="flex items-center gap-2 border-b border-line px-2.5 py-2">
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKey}
          role="combobox"
          aria-expanded="true"
          aria-controls={`sinner-listbox-${sinner}`}
          aria-autocomplete="list"
          aria-activedescendant={
            identities[activeIndex] ? `sinner-option-${identities[activeIndex].id}` : undefined
          }
          placeholder={t('deckSinnerSearch', lang, { sinner: sinnerName })}
          aria-label={t('deckSinnerSearch', lang, { sinner: sinnerName })}
          className="h-8 min-w-0 flex-1 rounded-sm border border-line-strong bg-surface px-2 text-xs outline-none"
        />
        <button type="button" onClick={onClose} aria-label={t('deckClose', lang)} className="text-fg-3">
          <X size={14} />
        </button>
      </div>
      <ul className="max-h-64 overflow-y-auto" role="listbox" id={`sinner-listbox-${sinner}`}>
        {selected !== null ? (
          <li>
            <button
              type="button"
              onClick={() => onPick(null)}
              className="flex h-9 w-full items-center px-3 text-left text-xs text-fg-2 hover:bg-surface-2"
            >
              {t('deckClearSlot', lang)}
            </button>
          </li>
        ) : null}
        {identities.map((identity, i) => (
          <li
            key={identity.id}
            role="option"
            id={`sinner-option-${identity.id}`}
            aria-selected={i === activeIndex}
          >
            <button
              type="button"
              onClick={() => onPick(identity.id)}
              onPointerMove={() => setActiveIndex(i)}
              aria-pressed={identity.id === selected}
              className={`flex min-h-11 w-full flex-wrap items-center gap-1.5 px-3 py-1.5 text-left text-sm hover:bg-surface-2 ${
                identity.id === selected || i === activeIndex ? 'bg-surface-2' : ''
              }`}
            >
              <span className="font-medium text-fg">{pick(identity.title, lang)}</span>
              <span className="text-xs text-fg-3">{t('deckRank', lang, { n: identity.rank })}</span>
              <KeywordChips identity={identity} data={data} lang={lang} />
            </button>
          </li>
        ))}
      </ul>
      <div className="border-t border-line px-3 py-1.5 text-xs text-fg-3">
        {t('deckShowing', lang, { total: all.length, n: identities.length })}
      </div>
    </div>
  );
}
