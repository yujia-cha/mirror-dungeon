/**
 * The whole route, as the right panel shows it: the counts, the alternative routes, the metro map
 * in its vertical form, and the unresolved card with its pack-level choices. Condition judgements
 * are not repeated here — the item grid's tiles and the gift sheet already carry them. Wide enough
 * for a phone page or a 336px desktop panel.
 */
import { useRef, useState } from 'react';
import { Copy, Star, X } from 'lucide-react';
import { conflictGroups } from '../../core/index.ts';
import { pick, t } from '../i18n.ts';
import { useApp } from '../store.ts';
import { planToText } from '../lib/plan-text.ts';
import { actionsFor, type UnresolvedAction } from '../lib/unresolved-actions.ts';
import { GiftIcon } from '../components/GiftIcon.tsx';
import { MetroMap } from '../components/MetroMap.tsx';
import { PackConflicts } from '../components/PackConflicts.tsx';
import { Badge, Button, Card, SectionTitle, Toast } from '../components/ui.tsx';
import { usePlan } from './plan-context.ts';
import { useRovingTabs } from '../lib/useRovingTabs.ts';

export function RoutePlanPanel({ onOpenGifts }: { onOpenGifts?: () => void }) {
  const { data, indexes, lang, input, plan, shown, planPending, variants, variantIndex, setVariantIndex, variant, giftName, packName, keywordLabel, ctx } = usePlan();
  const options = useApp((s) => s.options);
  const run = useApp((s) => s.run);
  const lastFloor = useApp((s) => s.lastFloor);
  const setOptions = useApp((s) => s.setOptions);
  const toggleObserved = useApp((s) => s.toggleObserved);
  const removeWanted = useApp((s) => s.removeWanted);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const tabsRef = useRef<HTMLDivElement | null>(null);
  // Declared before the early return below: hooks cannot live behind one.
  // One Tab stop for the strip, arrows to move between the routes; see `useRovingTabs`.
  const onVariantKey = useRovingTabs(tabsRef, variants.length + 1, variantIndex, setVariantIndex);

  if (!plan || !shown) {
    return (
      <Card className="flex flex-col items-center gap-2.5 px-4 py-8 text-center" testId="route-empty">
        <Star size={28} className="text-fg-3" aria-hidden />
        <div className="text-sm font-semibold">{t('routeEmpty', lang)}</div>
        {onOpenGifts ? (
          <Button variant="primary" onClick={onOpenGifts}>
            {t('tabGifts', lang)}
          </Button>
        ) : null}
      </Card>
    );
  }

  const capped = shown.stats.searchCapped;
  // A warning stays out of the 「참고」 list only when another surface already carries it: the app
  // always plans Hard so `parallel-requires-hard` can never apply, `condition-unmet` is what the
  // tiles' outer ring says, and `general-drop-not-guaranteed` is the general-drops card below,
  // which also names the gifts. `fusion-slots` and `search-capped` used to be in here with
  // nothing else saying them — the first was a silent failure, the second was the sentence that
  // explains what the 「근사 결과」 badge means.
  const SILENT_WARNINGS = new Set(['parallel-requires-hard', 'condition-unmet', 'general-drop-not-guaranteed']);
  const otherWarnings = shown.warnings.filter((w) => !SILENT_WARNINGS.has(w.code));
  const generalDrops = shown.generalDrops;
  // The planner reports every miss it had to work around, ingredients included.
  const failedCount = shown.unresolved.filter((u) => u.reason === 'failed').length;

  const copy = async (): Promise<void> => {
    const text = planToText(shown, giftName, packName, keywordLabel, lang, variant?.dropped ?? [], {
        bannedPacks: options.bannedPacks,
        ...(run.currentFloor > 1 || Object.keys(run.visits).length > 0 ? { run: { currentFloor: run.currentFloor, visits: run.visits } } : {}),
      },
    );
    // Plain http and an unfocused document leave `navigator.clipboard` unusable; say so instead of
    // rejecting into nowhere.
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      setCopyFailed(true);
      window.setTimeout(() => setCopyFailed(false), 3000);
      return;
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  const summary = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5" data-testid="route-summary">
      {(
        [
          ['routeRequiredPacks', String(shown.stats.requiredPacks)],
          ['routeCovered', `${shown.stats.coveredWanted}/${shown.stats.totalWanted}`],
        ] as const
      ).map(([key, value]) => (
        <span key={key} className="inline-flex items-baseline gap-1.5">
          <span className="text-xs text-fg-3">{t(key, lang)}</span>
          <span className="font-num text-lg font-bold text-fg">{value}</span>
        </span>
      ))}
      {/* How much of 「확보 M/T」 the route reaches by a general pool rather than a named pack. */}
      {generalDrops.length > 0 ? <Badge tone="neutral">{t('routeGeneralBadge', lang, { n: generalDrops.length })}</Badge> : null}
      {failedCount > 0 ? <Badge tone="alert">{t('runFailedCount', lang, { n: failedCount })}</Badge> : null}
      {shown.unresolved.length > 0 ? <Badge tone="neutral">{t('routeUnresolvedCount', lang, { n: shown.unresolved.length })}</Badge> : null}
      {capped ? (
        <Badge tone="approx" title={t('routeApproxHint', lang)}>
          {t('routeApprox', lang)}
        </Badge>
      ) : null}
      {/* The route below is one toggle behind while this is up; the worker is still answering. */}
      {planPending ? (
        <span data-testid="route-pending">
          <Badge tone="neutral">{t('routeRecomputing', lang)}</Badge>
        </span>
      ) : null}
      {/* Icon only: the toast after a press says what happened, so the label lives in the tooltip. */}
      <Button variant="ghost" size="sm" className="ml-auto" onClick={copy} title={t('routeCopy', lang)} ariaLabel={t('routeCopy', lang)}>
        <Copy size={13} aria-hidden />
      </Button>
    </div>
  );

  const variantTabs =
    variants.length > 0 ? (
      <div
        ref={tabsRef}
        className="flex flex-wrap items-center gap-1.5"
        role="tablist"
        aria-label={t('routeVariants', lang)}
        onKeyDown={onVariantKey}
        data-testid="variants"
      >
        <span className="mr-1 text-xs text-fg-3">{t('routeVariants', lang)}</span>
        {[{ dropped: [] as number[], plan }, ...variants].map((entry, i) => {
          const selected = i === variantIndex;
          const dropped = entry.dropped[0];
          const gift = dropped !== undefined ? indexes.giftById.get(dropped) : undefined;
          return (
            <button
              key={dropped ?? 'all'}
              type="button"
              role="tab"
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => setVariantIndex(i)}
              className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs ${
                selected ? 'border-ink bg-ink text-ink-fg' : 'border-line-strong bg-surface text-fg-2 hover:bg-surface-2'
              }`}
            >
              {gift ? <GiftIcon gift={gift} size={20} lang={lang} /> : null}
              <span>{gift ? t('routeVariantWithout', lang, { name: giftName(gift.id) }) : t('routeVariantAll', lang)}</span>
              <span className="font-num opacity-80">
                {entry.plan.stats.coveredWanted}/{entry.plan.stats.totalWanted}
              </span>
            </button>
          );
        })}
        {variant ? (
          <Button size="sm" variant="ghost" onClick={() => removeWanted(variant.dropped[0]!)}>
            <X size={12} aria-hidden />
            {t('routeVariantConfirm', lang)}
          </Button>
        ) : null}
      </div>
    ) : null;

  const actionLabel = (action: UnresolvedAction): string =>
    action.kind === 'observeGift'
      ? t('actionObserveGift', lang, { name: action.giftId !== undefined ? giftName(action.giftId) : '' })
      : t('actionReleaseObservations', lang);
  const unresolvedActions = shown.unresolved.map((entry) =>
    actionsFor(entry, indexes.giftById.get(entry.giftId), options, data.rules, ctx.needed).map((action) => ({ ...action, label: actionLabel(action) })),
  );
  const sharedLabels = new Set(
    unresolvedActions
      .flat()
      .map((a) => a.label)
      .filter((label, _, all) => all.filter((l) => l === label).length > 1),
  );
  // 「관측 지정 해제」 releases every pin at once, so it is the card's business however many rows
  // asked for it — with a single unresolved gift it used to belong to neither the header (not
  // shared) nor the row (not an `observeGift`) and was drawn nowhere.
  const headerActions = [
    ...new Map(unresolvedActions.flat().filter((a) => a.kind === 'releaseObservations' || sharedLabels.has(a.label)).map((a) => [a.label, a])).values(),
  ];
  const shownInput = variant ? { ...input, wanted: input.wanted.filter((w) => !variant.dropped.includes(w.giftId)) } : input;
  const groups = conflictGroups(shown, shownInput, data, indexes);
  const others = shown.unresolved.filter((u) => u.reason !== 'pack-conflict');
  const seeVariants = (): void => {
    tabsRef.current?.scrollIntoView?.({ block: 'center' });
    tabsRef.current?.querySelectorAll<HTMLButtonElement>('[role=tab]')[1]?.focus();
  };

  return (
    <div className="flex flex-col gap-3" data-testid="route-plan">
      {summary}
      {variantTabs}
      <MetroMap
        plan={shown}
        ctx={ctx}
        keywordLabel={keywordLabel}
        lastFloor={lastFloor}
        fixedModeByFloor={indexes.fixedModeByFloor}
        run={{ currentFloor: run.currentFloor }}
        slots={data.rules.giftObservation.max}
        startHeld={run.startGifts}
        variant="vertical"
        detailMode="sheet"
      />
      <PackConflicts
        groups={groups}
        others={others}
        ctx={ctx}
        removeWanted={removeWanted}
        observeAction={(entry) => {
          const i = shown.unresolved.indexOf(entry);
          return (unresolvedActions[i] ?? []).find((a) => a.kind === 'observeGift' && !sharedLabels.has(a.label));
        }}
        headerActions={headerActions}
        // A pin goes through the store's own guard, like the sheet's and the slots' pins do.
        onAction={(action) =>
          action.kind === 'observeGift' && action.giftId !== undefined
            ? toggleObserved(action.giftId, { max: data.rules.giftObservation.max, observable: ctx.observable })
            : setOptions(action.patch)
        }
        onSeeVariants={variants.length > 0 && !variant ? seeVariants : undefined}
        detailMode="sheet"
      />
      {/* The planner counts these as covered because no pack visit can improve them — the route has
          nothing left to do for them. The list is the useful part: which goals no pack is fetching. */}
      {generalDrops.length > 0 ? (
        <Card className="p-3.5" testId="route-general-drops">
          <SectionTitle>{t('routeGeneralTitle', lang)}</SectionTitle>
          <ul className="mt-2 flex flex-col gap-1.5">
            {generalDrops.map((giftId) => {
              const gift = indexes.giftById.get(giftId);
              return (
                <li key={giftId} className="flex items-center gap-1.5 text-xs text-fg-2">
                  {gift ? <GiftIcon gift={gift} size={20} lang={lang} /> : null}
                  <span>{giftName(giftId)}</span>
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}
      {otherWarnings.length > 0 ? (
        <Card className="p-3.5">
          <SectionTitle>{t('routeWarnings', lang)}</SectionTitle>
          <ul className="mt-2 flex flex-col gap-1 text-xs text-fg-2">
            {/* One code can come twice (`pack-option-dropped` for unknown pins and for unplaced preferences). */}
            {otherWarnings.map((w, i) => (
              <li key={`${w.code}:${i}`}>{pick(w.detail, lang)}</li>
            ))}
          </ul>
        </Card>
      ) : null}
      {copied ? <Toast>{t('routeCopied', lang)}</Toast> : null}
      {copyFailed ? <Toast tone="alert">{t('copyFailed', lang)}</Toast> : null}
    </div>
  );
}
