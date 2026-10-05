/**
 * The whole route, as the right panel shows it: the counts, the decision card when the goals
 * cannot all fit one run, the metro map in its vertical form, and the unresolved card with what
 * fails for other reasons. Condition judgements are not repeated here — the gift grid's tiles and
 * the gift sheet already carry them. Wide enough for a phone page or a 336px desktop panel.
 *
 * A preview from the decision card scrolls the panel to the map, which is what the preview
 * changed and sits below the card. The scroll is the panel's own container's (`SidePanel`'s
 * `overflow-y-auto` body), not the window's — `scrollIntoView` would drag the document behind the
 * sticky aside along with it.
 */
import { useRef, useState } from 'react';
import { Copy, Star } from 'lucide-react';
import { conflictGroups } from '../../core/index.ts';
import { t } from '../i18n.ts';
import { useApp } from '../store.ts';
import { observationClosed } from '../lib/plan-input.ts';
import { planToText } from '../lib/plan-text.ts';
import { actionsFor, type UnresolvedAction } from '../lib/unresolved-actions.ts';
import { warningText } from '../lib/unresolved-text.ts';
import { GiftIcon } from '../components/GiftIcon.tsx';
import { MetroMap } from '../components/MetroMap.tsx';
import { PackConflicts } from '../components/PackConflicts.tsx';
import { RouteDecision } from '../components/RouteDecision.tsx';
import { Badge, Button, Card, SectionTitle, Toast } from '../components/ui.tsx';
import { usePlan } from './plan-context.ts';

export function RoutePlanPanel({ onOpenGifts }: { onOpenGifts?: () => void }) {
  const {
    data,
    indexes,
    lang,
    input,
    plan,
    shown,
    planPending,
    analysis,
    analysisPending,
    drops,
    variant,
    giftName,
    packName,
    keywordLabel,
    ctx,
  } = usePlan();
  const options = useApp((s) => s.options);
  const run = useApp((s) => s.run);
  const lastFloor = useApp((s) => s.lastFloor);
  const setOptions = useApp((s) => s.setOptions);
  const toggleObserved = useApp((s) => s.toggleObserved);
  const removeWanted = useApp((s) => s.removeWanted);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const mapRef = useRef<HTMLDivElement>(null);

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
  // which also names the gifts. `fusion-slots` is listed like any other note (`warningText` names
  // the fusion) — the fusion card that used to carry it as a badge is gone. `search-capped` used
  // to be in here with nothing else saying it — it is the sentence that explains what the
  // 「근사 결과」 badge means.
  const SILENT_WARNINGS = new Set([
    'parallel-requires-hard',
    'condition-unmet',
    'general-drop-not-guaranteed',
  ]);
  const otherWarnings = shown.warnings.filter((w) => !SILENT_WARNINGS.has(w.code));
  const generalDrops = shown.generalDrops;
  // The planner reports every miss it had to work around, ingredients included.
  const failedCount = shown.unresolved.filter((u) => u.reason === 'failed').length;

  const copy = async (): Promise<void> => {
    const dropped = variant?.dropped ?? [];
    const text = planToText(shown, giftName, packName, keywordLabel, lang, dropped, {
      // Every goal, so a result-only fusion goal is in the text even though no floor names it.
      goals: input.wanted.map((w) => w.giftId).filter((id) => !dropped.includes(id)),
      // The bars belong to the full plan; a previewed set has already picked its goals.
      ...(variant || !analysis
        ? {}
        : {
            drops: {
              effects: analysis.effects.map((e) => ({ name: giftName(e.giftId), reduces: e.reduces })),
              ...(analysis.resolving
                ? { resolving: analysis.resolving.dropped.map(giftName).join(' + ') }
                : {}),
            },
          }),
      ...(run.currentFloor > 1 || Object.keys(run.visits).length > 0
        ? { run: { currentFloor: run.currentFloor, visits: run.visits } }
        : {}),
    });
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

  const scrollToMap = (): void => {
    const mapEl = mapRef.current;
    if (!mapEl) return;
    const container = mapEl.closest<HTMLElement>('.overflow-y-auto');
    if (container && typeof container.scrollTo === 'function') {
      container.scrollTo({ top: mapEl.offsetTop - container.offsetTop, behavior: 'smooth' });
    } else if (typeof mapEl.scrollIntoView === 'function') {
      mapEl.scrollIntoView({ block: 'start' });
    }
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
      {generalDrops.length > 0 ? (
        <Badge tone="neutral">{t('routeGeneralBadge', lang, { n: generalDrops.length })}</Badge>
      ) : null}
      {failedCount > 0 ? <Badge tone="alert">{t('runFailedCount', lang, { n: failedCount })}</Badge> : null}
      {shown.unresolved.length > 0 ? (
        <Badge tone="neutral">{t('routeUnresolvedCount', lang, { n: shown.unresolved.length })}</Badge>
      ) : null}
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
      <Button
        variant="ghost"
        size="sm"
        className="ml-auto"
        onClick={copy}
        title={t('routeCopy', lang)}
        ariaLabel={t('routeCopy', lang)}
      >
        <Copy size={13} aria-hidden />
      </Button>
    </div>
  );

  const actionLabel = (action: UnresolvedAction): string =>
    action.kind === 'observeGift'
      ? t('actionObserveGift', lang, { name: action.giftId !== undefined ? giftName(action.giftId) : '' })
      : t('actionReleaseObservations', lang);
  const observeClosed = observationClosed(run);
  const unresolvedActions = shown.unresolved.map((entry) =>
    actionsFor(
      entry,
      indexes.giftById.get(entry.giftId),
      options,
      data.rules,
      ctx.needed,
      observeClosed,
      (id) => indexes.giftById.get(id),
    ).map((action) => ({ ...action, label: actionLabel(action) })),
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
    ...new Map(
      unresolvedActions
        .flat()
        .filter((a) => a.kind === 'releaseObservations' || sharedLabels.has(a.label))
        .map((a) => [a.label, a]),
    ).values(),
  ];
  const others = shown.unresolved.filter((u) => u.reason !== 'pack-conflict');
  // The decision is the full plan's: it stays on screen while an alternative is previewed, so the
  // header chips and the 「전부 유지」 row read the plan itself, not the preview.
  const conflicted = plan.unresolved.some((u) => u.reason === 'pack-conflict');
  const groups = conflictGroups(plan, input, data, indexes);

  return (
    <div className="flex flex-col gap-3" data-testid="route-plan">
      {summary}
      {conflicted || analysis !== null || analysisPending ? (
        <RouteDecision
          plan={plan}
          analysis={analysis}
          analysisPending={analysisPending}
          drops={drops}
          groups={groups}
          ctx={ctx}
          removeWanted={removeWanted}
          onPreview={scrollToMap}
        />
      ) : null}
      <div ref={mapRef} className="scroll-mt-3">
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
      </div>
      <PackConflicts
        others={others}
        ctx={ctx}
        removeWanted={removeWanted}
        observeAction={(entry) => {
          const i = shown.unresolved.indexOf(entry);
          return (unresolvedActions[i] ?? []).find(
            (a) => a.kind === 'observeGift' && !sharedLabels.has(a.label),
          );
        }}
        headerActions={headerActions}
        // A pin goes through the store's own guard, like the sheet's and the slots' pins do.
        onAction={(action) =>
          action.kind === 'observeGift' && action.giftId !== undefined
            ? toggleObserved(action.giftId, {
                max: data.rules.giftObservation.max,
                observable: ctx.observable,
              })
            : setOptions(action.patch)
        }
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
              <li key={`${w.code}:${i}`}>{warningText(w, giftName, packName, lang)}</li>
            ))}
          </ul>
        </Card>
      ) : null}
      {copied ? <Toast>{t('routeCopied', lang)}</Toast> : null}
      {copyFailed ? <Toast tone="alert">{t('copyFailed', lang)}</Toast> : null}
    </div>
  );
}
