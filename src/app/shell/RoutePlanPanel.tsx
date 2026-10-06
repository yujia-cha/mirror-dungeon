/**
 * The whole route, as the right panel shows it: a notice at the top when the run's 미획득 has
 * killed a fusion and the route was re-planned around it, the counts, the decision card when the
 * goals cannot all fit one run, and the metro map in its vertical form. Other unresolved gifts and
 * the general drops are not listed here — the gift grid's tiles and the gift sheet say what the
 * route cannot fetch, as they carry the condition judgements. Wide enough for a phone page or a
 * 336px desktop panel.
 *
 * A preview from the decision card scrolls the panel to the map, which is what the preview
 * changed and sits below the card. The scroll is the panel's own container's (`SidePanel`'s
 * `overflow-y-auto` body), not the window's — `scrollIntoView` would drag the document behind the
 * sticky aside along with it.
 */
import { useRef } from 'react';
import { Star } from 'lucide-react';
import { conflictGroups } from '../../core/index.ts';
import { t } from '../i18n.ts';
import { useApp } from '../store.ts';
import { lostFusions } from '../lib/fusion-lost.ts';
import { warningText } from '../lib/unresolved-text.ts';
import { FusionLostNotice } from '../components/FusionLostNotice.tsx';
import { MetroMap } from '../components/MetroMap.tsx';
import { RouteDecision } from '../components/RouteDecision.tsx';
import { Badge, Button, Card, SectionTitle } from '../components/ui.tsx';
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
    giftName,
    packName,
    keywordLabel,
    ctx,
    openGift,
  } = usePlan();
  const run = useApp((s) => s.run);
  const lastFloor = useApp((s) => s.lastFloor);
  const removeWanted = useApp((s) => s.removeWanted);
  const wanted = useApp((s) => s.wanted);
  const setCollectRest = useApp((s) => s.setCollectRest);
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
  // A warning stays out of the 「참고」 list only when another surface already carries it or no
  // surface does by design: the app always plans Hard so `parallel-requires-hard` can never apply,
  // `condition-unmet` is what the tiles' outer ring says, and `general-drop-not-guaranteed` belongs
  // to the gift tab's acquisition classes (the panel lists no general drops). `fusion-slots` is
  // listed like any other note (`warningText` names the fusion). `search-capped` used to be in here
  // with nothing else saying it — it is the sentence that explains what the 「근사 결과」 badge means.
  const SILENT_WARNINGS = new Set([
    'parallel-requires-hard',
    'condition-unmet',
    'general-drop-not-guaranteed',
  ]);
  const otherWarnings = shown.warnings.filter((w) => !SILENT_WARNINGS.has(w.code));
  const lost = lostFusions(shown, run.giftStatus);

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
    </div>
  );

  // The decision is the full plan's: it stays on screen while an alternative is previewed, so the
  // header chips and the 「전부 유지」 row read the plan itself, not the preview.
  const conflicted = plan.unresolved.some((u) => u.reason === 'pack-conflict');
  const groups = conflictGroups(plan, input, data, indexes);

  return (
    <div className="flex flex-col gap-3" data-testid="route-plan">
      <FusionLostNotice
        lost={lost}
        ctx={ctx}
        onOpen={openGift}
        wanted={wanted}
        collectRest={run.collectRest ?? []}
        onCollectRest={setCollectRest}
      />
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
    </div>
  );
}
