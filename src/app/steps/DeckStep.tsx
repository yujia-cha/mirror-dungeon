import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ClipboardPaste, Eraser, Plus, RotateCcw, Search, Swords } from 'lucide-react';
import type { GameData, Identity } from '../../core/schema.ts';
import type { DeckStats, GameIndexes } from '../../core/types.ts';
import { pick, t, type Lang } from '../i18n.ts';
import { sinnerOf, useApp } from '../store.ts';
import { identityKeywordLabel } from '../format.ts';
import { identitiesFromFormationCode } from '../lib/formation-code.ts';
import { DEPLOYED_AT_START, defaultDeck } from '../lib/default-deck.ts';
import { deckSummaryChips } from '../lib/deck-summary.ts';
import { useCursor } from '../lib/use-cursor.ts';
import { stepIndex, useDismiss } from '../lib/useDismiss.ts';
import { useDesktop } from '../lib/useMediaQuery.ts';
import { usePageHistory } from '../lib/usePageHistory.ts';
import { ConfirmDialog } from '../components/ConfirmDialog.tsx';
import { attackTypeLabels, searchIdentities, sinLabels, type SearchMode } from '../lib/identity-search.ts';
import { DetailSurface } from '../components/BlockDetail.tsx';
import { Badge, Button, Checkbox, Chip, TextField } from '../components/ui.tsx';

interface Props {
  data: GameData;
  indexes: GameIndexes;
  stats: DeckStats;
  lang: Lang;
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

/**
 * What else a search row says about an identity, after its keywords: its attack types on one chip
 * (a ⚔ tells it from the keyword chips without a colour) and its sins as plain text. Both are
 * searchable, so a row never matches on something it does not show.
 */
function IdentityMeta({ identity, data, lang }: { identity: Identity; data: GameData; lang: Lang }) {
  const attacks = attackTypeLabels(identity, data.enums, lang);
  const sins = sinLabels(identity, lang);
  return (
    <span className="flex flex-wrap items-center gap-1" data-testid="identity-meta">
      <KeywordChips identity={identity} data={data} lang={lang} />
      {attacks.length > 0 ? (
        <Chip title={t('deckAttackTypes', lang)}>
          <Swords size={10} aria-hidden />
          <span className="sr-only">{t('deckAttackTypes', lang)} </span>
          {attacks.join(' · ')}
        </Chip>
      ) : null}
      {sins.length > 0 ? (
        <span className="text-caption text-fg-subtle" title={t('deckSins', lang)}>
          <span className="sr-only">{t('deckSins', lang)} </span>
          {sins.join(' · ')}
        </span>
      ) : null}
    </span>
  );
}

/**
 * OR / AND for a query of several words, shared by the global search and the sinner picker. Two
 * toggle buttons rather than a select: the choice is binary and both options stay in view.
 */
function ModeToggle({
  mode,
  onChange,
  lang,
}: {
  mode: SearchMode;
  onChange: (mode: SearchMode) => void;
  lang: Lang;
}) {
  return (
    <div
      role="group"
      aria-label={t('deckSearchMode', lang)}
      className="flex flex-none gap-1"
      data-testid="search-mode"
    >
      <Button
        variant={mode === 'or' ? 'primary' : 'secondary'}
        pressed={mode === 'or'}
        onClick={() => onChange('or')}
        title={t('deckSearchModeOrHint', lang)}
      >
        {t('deckSearchModeOr', lang)}
      </Button>
      <Button
        variant={mode === 'and' ? 'primary' : 'secondary'}
        pressed={mode === 'and'}
        onClick={() => onChange('and')}
        title={t('deckSearchModeAndHint', lang)}
      >
        {t('deckSearchModeAnd', lang)}
      </Button>
    </div>
  );
}

/** The leading box of a search row: filled with a check while the identity is in the deck. */
function HeldMark({ held }: { held: boolean }) {
  return (
    <span
      className={`mt-0.5 inline-flex h-4 w-4 flex-none items-center justify-center rounded-xs border ${held ? 'border-primary bg-primary text-primary-fg' : 'border-border-strong'}`}
      aria-hidden
    >
      {held ? <Check size={11} strokeWidth={3} /> : null}
    </span>
  );
}

/**
 * One search result, the same in both searches: name and 성 on the first line (the sinner leads in
 * the global list), 「편성 중」 when it is the one in the deck, then keywords · attack types · sins,
 * and — when the sinner's slot holds some other identity that is not the LCB base — which one a
 * pick would replace. The badge and that line are words, not a tint.
 */
function IdentityRowBody({
  identity,
  data,
  lang,
  held,
  sinnerLabel,
  replaces,
}: {
  identity: Identity;
  data: GameData;
  lang: Lang;
  held: boolean;
  sinnerLabel?: string;
  replaces?: Identity;
}) {
  return (
    <span className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
        {sinnerLabel ? (
          <span className="flex-none text-caption-strong text-fg-muted">{sinnerLabel}</span>
        ) : null}
        <span className="min-w-0 text-body text-fg">{pick(identity.title, lang)}</span>
        <span className="flex-none text-caption text-fg-subtle">
          {t('deckRank', lang, { n: identity.rank })}
        </span>
        {held ? (
          <span className="self-center" data-testid="deck-in-deck">
            <Badge tone="neutral">{t('deckInDeck', lang)}</Badge>
          </span>
        ) : null}
      </span>
      <IdentityMeta identity={identity} data={data} lang={lang} />
      {replaces ? (
        <span className="text-caption text-fg-muted" data-testid="deck-current">
          {t('deckCurrent', lang, { identity: pick(replaces.title, lang) })}
        </span>
      ) : null}
    </span>
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
  // 「기본 덱」 replaces twelve slots and the deployment at once, so it asks first (as 「목표 비우기」 does).
  const [confirmDefault, setConfirmDefault] = useState(false);
  const [code, setCode] = useState('');
  const [importMessage, setImportMessage] = useState<string | null>(null);

  // OR keeps what several words always did (any of them); AND narrows — 「화상 파우스트」. One choice
  // for both searches, held for the visit only.
  const [mode, setMode] = useState<SearchMode>('or');

  const searchRef = useRef<HTMLDivElement | null>(null);

  const bySinner = useMemo(() => new Map(deck.map((id) => [sinnerOf(id), id])), [deck]);
  // The LCB base identities: a slot holding one of these is the default, not a choice worth naming.
  const defaults = useMemo(() => new Set(defaultDeck(data)), [data]);
  /** The identity a pick of `identity` would replace, when that one is a deliberate (non-LCB) choice. */
  const replacedBy = (identity: Identity): Identity | undefined => {
    const current = bySinner.get(identity.sinnerId);
    if (current === undefined || current === identity.id || defaults.has(current)) return undefined;
    return indexes.identityById.get(current);
  };
  const needle = query.trim().toLowerCase();
  // The highlight resets itself when the query or the mode changes; see `useCursor`.
  const [activeIndex, setActiveIndex] = useCursor(`${mode}:${needle}`);
  const globalResults = useMemo(() => {
    if (needle === '') return [];
    return searchIdentities(data.identities, { query: needle, mode, enums: data.enums })
      .sort((a, b) => a.sinnerId - b.sinnerId || b.rank - a.rank || a.id - b.id)
      .slice(0, 40);
  }, [data, needle, mode]);
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
      {confirmDefault ? (
        <ConfirmDialog
          title={t('deckDefaultConfirm', lang)}
          message={t('deckDefaultConfirmBody', lang)}
          confirmLabel={t('deckDefault', lang)}
          onConfirm={() => {
            setConfirmDefault(false);
            setDeck(defaultDeck(data), DEPLOYED_AT_START);
          }}
          onCancel={() => setConfirmDefault(false)}
          lang={lang}
        />
      ) : null}
      <div className="relative flex items-center gap-2" ref={searchRef}>
        <TextField
          value={query}
          onChange={(value) => {
            setQuery(value);
            setListOpen(true);
          }}
          label={t('deckSearchAll', lang)}
          placeholder={t('deckSearchAll', lang)}
          icon={<Search size={14} aria-hidden />}
          onClear={() => setQuery('')}
          clearLabel={t('searchClear', lang)}
          className="flex-1"
          inputProps={{
            onFocus: () => setListOpen(true),
            onKeyDown: onSearchKey,
            role: 'combobox',
            'aria-expanded': open,
            'aria-controls': 'deck-search-listbox',
            'aria-autocomplete': 'list',
            'aria-activedescendant':
              open && globalResults[activeIndex] ? `deck-option-${globalResults[activeIndex].id}` : undefined,
          }}
        />
        <ModeToggle mode={mode} onChange={setMode} lang={lang} />
        {open ? (
          <div
            id="deck-search-listbox"
            role="listbox"
            aria-label={t('deckSearchAll', lang)}
            className="absolute left-0 top-full z-20 mt-1 flex max-h-[420px] w-full max-w-[560px] flex-col overflow-y-auto rounded-md border border-border-strong bg-surface shadow-md"
          >
            <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2 text-caption text-fg-subtle">
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
                  className={`flex min-h-11 flex-none items-start gap-3 border-b border-border px-3 py-2 text-left hover:bg-surface-muted ${i === activeIndex ? 'bg-surface-muted' : ''}`}
                >
                  <HeldMark held={held} />
                  <IdentityRowBody
                    identity={identity}
                    data={data}
                    lang={lang}
                    held={held}
                    sinnerLabel={pick(identity.sinner, lang)}
                    replaces={replacedBy(identity)}
                  />
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="inline-flex h-9 items-center gap-1.5 rounded-sm border border-border bg-surface-muted px-3 text-label "
          title={full ? t('deckDeployedFull', lang, { max }) : undefined}
        >
          {t('deckDeployed', lang)}{' '}
          <span className="font-num">
            {deployed.length}/{max}
          </span>
        </span>
        <Button onClick={() => setConfirmDefault(true)} ariaLabel={t('deckDefault', lang)}>
          <RotateCcw size={14} aria-hidden />
          <span className="hidden @sm:inline">{t('deckDefault', lang)}</span>
        </Button>
        <Button onClick={() => setImportOpen((v) => !v)} ariaLabel={t('deckImport', lang)}>
          <ClipboardPaste size={14} aria-hidden />
          <span className="hidden @sm:inline">{t('deckImport', lang)}</span>
        </Button>
      </div>
      {/* Why the reserve boxes are greyed out, said where a touch reader can see it (not a title). */}
      {full ? (
        <p className="text-caption text-fg-muted" data-testid="deck-deployed-full">
          {t('deckDeployedFull', lang, { max })}
        </p>
      ) : null}
      {importOpen ? (
        <form
          className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface p-2"
          onSubmit={(event) => {
            event.preventDefault();
            applyImport();
          }}
        >
          <TextField
            value={code}
            onChange={setCode}
            label={t('deckImportPlaceholder', lang)}
            placeholder={t('deckImportPlaceholder', lang)}
            numeric
            className="flex-1"
          />
          <Button type="submit" variant="primary">
            {t('deckImportApply', lang)}
          </Button>
          {importMessage ? <span className="w-full text-caption text-fg-muted">{importMessage}</span> : null}
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
                    ? 'border border-border-strong bg-surface shadow-sm'
                    : 'border border-border bg-surface-muted'
                  : 'border border-dashed border-border-strong'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-caption-strong text-fg-muted">{pick(sinner.name, lang)}</span>
                {identity ? (
                  <Checkbox
                    checked={isDeployed}
                    disabled={!isDeployed && full}
                    onChange={() => toggleDeployed(identity.id, max)}
                    ariaLabel={`${pick(sinner.name, lang)} ${t('deckDeployed', lang)}`}
                    title={!isDeployed && full ? t('deckDeployedFull', lang, { max }) : undefined}
                    className={`gap-1.5 text-caption-strong ${isDeployed ? 'text-fg' : 'text-fg-subtle'}`}
                  >
                    {isDeployed ? t('deckDeployed', lang) : t('deckReserve', lang)}
                  </Checkbox>
                ) : (
                  <span className="text-caption text-fg-subtle">{t('deckReserve', lang)}</span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setOpenSinner(open ? null : sinner.id)}
                aria-expanded={open}
                aria-haspopup="dialog"
                className="flex min-h-6 min-w-0 flex-col items-start justify-center gap-1 rounded-sm text-left hover:underline touch:min-h-11"
              >
                {identity ? (
                  <>
                    <span className="flex min-w-0 max-w-full items-baseline gap-1.5">
                      <span className="truncate text-label text-fg">{pick(identity.title, lang)}</span>
                      <span className="flex-none text-caption text-fg-subtle">
                        {t('deckRank', lang, { n: identity.rank })}
                      </span>
                    </span>
                    <span className="flex flex-wrap gap-1">
                      <KeywordChips identity={identity} data={data} lang={lang} />
                    </span>
                  </>
                ) : (
                  <span className="flex items-center gap-1.5 text-body text-fg-subtle">
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
                  selected={identity ?? null}
                  mode={mode}
                  onMode={setMode}
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
              {chip.label} <b className="text-fg">{chip.count}</b>
              <span className="text-fg-subtle">/{chip.formation}</span>
            </Chip>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * One sinner's identities, searched the way the global search is (`searchIdentities` fixed to the
 * sinner, the same OR / AND, the same rows) — M126.
 *
 * It used to float under its slot at 340px: inside a two-column panel the field truncated
 * 「파우스트 인…」, keyword chips wrapped under names, and a right-column slot had to be measured and
 * slid back inside the panel. Now it is a sheet: portaled to the body so no panel clips it, a bottom
 * sheet on a phone and a 520px dialog on a desktop, with the background held still, Tab kept inside,
 * Escape, the backdrop and (on a phone) the device's back closing it, and focus going back to the
 * slot that opened it (`DetailSurface` + `useOverlayChrome` + `usePageHistory`).
 */
function SinnerPicker({
  sinner,
  sinnerName,
  data,
  lang,
  selected,
  mode,
  onMode,
  onPick,
  onClose,
}: {
  sinner: number;
  sinnerName: string;
  data: GameData;
  lang: Lang;
  selected: Identity | null;
  mode: SearchMode;
  onMode: (mode: SearchMode) => void;
  onPick: (identityId: number | null) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const needle = query.trim().toLowerCase();
  const [activeIndex, setActiveIndex] = useCursor(`${mode}:${needle}`);
  const all = useMemo(
    () => data.identities.filter((identity) => identity.sinnerId === sinner),
    [data, sinner],
  );
  const identities = useMemo(
    () =>
      searchIdentities(all, { query: needle, mode, enums: data.enums, sinnerId: sinner }).sort(
        (a, b) => b.rank - a.rank || a.id - b.id,
      ),
    [all, needle, mode, data.enums, sinner],
  );
  // The field, not the sheet's ✕, takes focus. This runs after `DetailSurface`'s own effect (a
  // parent's effects follow its children's), so that one has already noted the slot as the place
  // to hand focus back to.
  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, []);
  // On a phone the deck is a page of its own, and the device's back closes this sheet first.
  const desktop = useDesktop();
  usePageHistory(true, onClose, !desktop);
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
  const title = t('deckPickerTitle', lang, { sinner: sinnerName });
  return (
    <DetailSurface mode="sheet" label={title} closeLabel={t('deckClose', lang)} onClose={onClose}>
      <div className="flex flex-col gap-3" data-testid="sinner-picker">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-subheading text-fg">{title}</h2>
          <span className="flex-none text-caption text-fg-subtle" data-testid="sinner-picker-count">
            {t('deckShowing', lang, { total: all.length, n: identities.length })}
          </span>
        </div>
        {selected ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="min-w-0 text-caption text-fg-muted">
              {t('deckCurrent', lang, { identity: pick(selected.title, lang) })}
            </span>
            <Button size="sm" onClick={() => onPick(null)}>
              <Eraser size={12} aria-hidden />
              {t('deckClearSlot', lang)}
            </Button>
          </div>
        ) : null}
        <div className="flex items-center gap-2">
          <TextField
            inputRef={inputRef}
            value={query}
            onChange={setQuery}
            label={t('deckSinnerSearch', lang, { sinner: sinnerName })}
            placeholder={t('deckSinnerSearch', lang, { sinner: sinnerName })}
            icon={<Search size={14} aria-hidden />}
            onClear={() => setQuery('')}
            clearLabel={t('searchClear', lang)}
            className="flex-1"
            inputProps={{
              onKeyDown: onKey,
              role: 'combobox',
              'aria-expanded': true,
              'aria-controls': `sinner-listbox-${sinner}`,
              'aria-autocomplete': 'list',
              'aria-activedescendant': identities[activeIndex]
                ? `sinner-option-${identities[activeIndex].id}`
                : undefined,
            }}
          />
          <ModeToggle mode={mode} onChange={onMode} lang={lang} />
        </div>
        <ul
          className="-mx-4 max-h-[min(420px,50dvh)] overflow-y-auto border-y border-border"
          role="listbox"
          id={`sinner-listbox-${sinner}`}
          aria-label={title}
        >
          {identities.length === 0 ? (
            <li className="px-4 py-3 text-caption text-fg-subtle">{t('deckSearchNone', lang)}</li>
          ) : null}
          {identities.map((identity, i) => {
            const held = identity.id === selected?.id;
            return (
              <li
                key={identity.id}
                role="option"
                id={`sinner-option-${identity.id}`}
                aria-selected={i === activeIndex}
                className="border-b border-border last:border-b-0"
              >
                <button
                  type="button"
                  onClick={() => onPick(identity.id)}
                  onPointerMove={() => setActiveIndex(i)}
                  aria-pressed={held}
                  data-picked={held || undefined}
                  className={`flex min-h-11 w-full items-start gap-3 px-4 py-2 text-left hover:bg-surface-muted ${
                    i === activeIndex ? 'bg-surface-muted' : ''
                  }`}
                >
                  <HeldMark held={held} />
                  <IdentityRowBody identity={identity} data={data} lang={lang} held={held} />
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </DetailSurface>
  );
}
