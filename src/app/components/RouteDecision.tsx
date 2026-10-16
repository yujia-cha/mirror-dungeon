/**
 * The decision card: the one place for the choice the planner cannot make for the user — which
 * goals to take out when they cannot all fit one run (`pack-conflict`).
 *
 * It sits under the summary and above the metro map, because that is the decision the rest of
 * the panel waits on. Since M80 it is a list of **drop effects** (`planDropEffects`, core): one bar
 * per candidate goal, as long as the number of conflicting goals that leaving it out alone clears.
 * A bar of 0 is information too — two goals sharing a pack free nothing one at a time.
 *
 * Bars do not add up, so the card never sums them into a verdict. Checking goals asks the planner
 * for the route without all of them (`drops.plan`) and the line under the bars sets the two side by
 * side: 「막대 합 −2 · 함께 뺀 실제 −1」. The footer says what that route gets, previews it on the map
 * (the stage follows `shown`), and removes the checked goals with 「목표에서 빼기」 — the app's one
 * word for deselecting, as everywhere else.
 *
 * The header names the conflicting goals and how many have to go (`resolving`, the best single drop
 * or the main plan's losses together); 「…빼면 해결」 checks that set in one press. The floor chips
 * name the contested floors (`conflictGroups`, core) — information only; the app makes no
 * pack-level choice.
 */
import { useState } from 'react';
import { Route, TriangleAlert } from 'lucide-react';
import type { ConflictGroup } from '../../core/conflicts.ts';
import type { DropAnalysis } from '../../core/index.ts';
import type { RoutePlan } from '../../core/types.ts';
import { t } from '../i18n.ts';
import type { DropSelection } from '../shell/plan-context.ts';
import { ConfirmDialog } from './ConfirmDialog.tsx';
import { GiftIcon } from './GiftIcon.tsx';
import type { PackContext } from './PackSheet.tsx';
import { Button, Card, Chip, Skeleton } from './ui.tsx';

export interface RouteDecisionProps {
  /** The plan for the full goal list — what the bars are measured against. */
  plan: RoutePlan;
  analysis: DropAnalysis | null;
  analysisPending: boolean;
  drops: DropSelection;
  /** Contested floors of `plan`, for the header chips. */
  groups: ConflictGroup[];
  ctx: PackContext;
  removeWanted: (giftId: number) => void;
  /** After a preview starts (not when it ends): the panel scrolls to the map that just changed. */
  onPreview?: () => void;
}

export function RouteDecision({
  plan,
  analysis,
  analysisPending,
  drops,
  groups,
  ctx,
  removeWanted,
  onPreview,
}: RouteDecisionProps) {
  const { lang, giftName, indexes } = ctx;
  const [confirmDrop, setConfirmDrop] = useState(false);
  const conflicting = [
    ...new Set(plan.unresolved.filter((u) => u.reason === 'pack-conflict').map((u) => u.giftId)),
  ];
  const names = conflicting.map(giftName).join(' · ');
  const need = analysis?.resolving?.dropped.length ?? null;
  const total = analysis?.conflicts ?? conflicting.length;
  const effects = analysis?.effects ?? [];
  const { selection } = drops;
  const covered = (p: RoutePlan): string => `${p.stats.coveredWanted}/${p.stats.totalWanted}`;

  const barSum = selection.reduce((sum, id) => sum + (effects.find((e) => e.giftId === id)?.reduces ?? 0), 0);
  const real = drops.conflicts === null ? null : total - drops.conflicts;

  const status = ((): { text: string; tone: 'ok' | 'left' | 'plain' } => {
    if (selection.length === 0)
      return { text: t('routeDecisionNow', lang, { n: total, covered: covered(plan) }), tone: 'plain' };
    if (drops.pending || !drops.plan || drops.conflicts === null)
      return { text: t('routeDecisionComputing', lang), tone: 'plain' };
    if (drops.conflicts === 0)
      return { text: t('routeDecisionFits', lang, { covered: covered(drops.plan) }), tone: 'ok' };
    return {
      text: t('routeDecisionLeft', lang, { n: drops.conflicts, covered: covered(drops.plan) }),
      tone: 'left',
    };
  })();

  return (
    <Card variant="strong" className="overflow-visible" testId="route-decision">
      <div className="flex flex-col gap-1.5 border-b border-border px-3 py-2">
        <div className="flex items-start gap-1.5">
          <TriangleAlert size={14} className="mt-0.5 flex-none" aria-hidden />
          <h2 className="text-subheading ">
            {need !== null && need > 1
              ? t('routeDecisionTitleMany', lang, { names, n: need })
              : t('routeDecisionTitle', lang, { names })}
          </h2>
        </div>
        {groups.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {groups.map((group) => {
              const from = group.floors[0]!;
              const to = group.floors[group.floors.length - 1]!;
              return (
                <Chip key={from} on>
                  {from === to
                    ? t('stageFloor', lang, { floor: from })
                    : t('routeFloorRange', lang, { from, to })}
                </Chip>
              );
            })}
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-1 px-3 py-2">
        <div className="text-caption text-fg-subtle">{t('routeDecisionEffects', lang)}</div>
        <ul className="flex flex-col gap-0.5" data-testid="drop-effects">
          {effects.map((effect) => {
            const gift = indexes.giftById.get(effect.giftId);
            const name = giftName(effect.giftId);
            const checked = selection.includes(effect.giftId);
            const width = total > 0 ? Math.round((effect.reduces / total) * 100) : 0;
            return (
              <li key={effect.giftId}>
                <label
                  className="grid grid-cols-[auto_auto_minmax(0,1fr)_minmax(2.5rem,28%)_2rem] items-center gap-2 rounded-sm px-1 py-0.5 hover:bg-surface-muted touch:min-h-11"
                  data-testid="drop-effect"
                  data-gift={effect.giftId}
                  data-reduces={effect.reduces}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => drops.toggle(effect.giftId)}
                    aria-label={`${name} ${t('routeDecisionCheck', lang)}`}
                    className="size-4 accent-primary"
                  />
                  <span className="inline-flex flex-none">
                    {gift ? (
                      <GiftIcon
                        gift={gift}
                        size={20}
                        judgement={ctx.judgements.get(effect.giftId) ?? null}
                        lang={lang}
                      />
                    ) : null}
                  </span>
                  <span className="min-w-0 truncate text-body" title={name}>
                    {name}
                  </span>
                  <span className="h-2.5 overflow-hidden rounded-sm bg-surface-muted" aria-hidden>
                    <span className="block h-full bg-primary" style={{ width: `${width}%` }} />
                  </span>
                  <span
                    className="text-right font-num text-caption text-fg-muted"
                    aria-label={t('routeDecisionReducesLabel', lang, { n: effect.reduces })}
                  >
                    −{effect.reduces}
                  </span>
                </label>
              </li>
            );
          })}
          {analysisPending ? (
            <li
              className="flex items-center gap-2 px-1 py-1 text-caption text-fg-subtle"
              data-testid="route-decision-pending"
              role="status"
            >
              <Skeleton className="h-5 w-5 flex-none rounded-sm" />
              <span>{t('routeDecisionPending', lang)}</span>
              <Skeleton className="h-2.5 flex-1" />
            </li>
          ) : null}
        </ul>
        {selection.length > 0 ? (
          <div
            className="mt-1 rounded-sm bg-surface-muted px-2 py-1 text-caption text-fg-muted"
            data-testid="drop-sum"
            aria-live="polite"
          >
            {t('routeDecisionBarSum', lang, { sum: barSum })}
            {' · '}
            {real === null ? t('routeDecisionComputing', lang) : t('routeDecisionReal', lang, { real })}
            {real !== null && real !== barSum ? (
              <>
                {' '}
                <strong className="text-fg">{t('routeDecisionNotAdditive', lang)}</strong>
              </>
            ) : null}
          </div>
        ) : null}
        {analysis?.resolving ? (
          <div className="mt-1 flex flex-wrap items-center gap-2 text-caption" data-testid="drop-resolving">
            <span className="min-w-0 text-fg-muted">
              {t('routeDecisionResolves', lang, {
                names: analysis.resolving.dropped.map(giftName).join(' + '),
              })}
            </span>
            <Button size="sm" variant="ghost" onClick={() => drops.set([...analysis.resolving!.dropped])}>
              {t('routeDecisionPick', lang)}
            </Button>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-1.5 border-t border-border px-3 py-2">
        <span
          // Success is said by the ✓ in the words, in ink: green text was 3.5–4.0:1 and put hue
          // where the system allows only the judgement ring.
          className={`min-w-0 flex-[1_1_10rem] ${status.tone === 'plain' ? 'text-caption text-fg-muted' : 'text-caption-strong text-fg'}`}
          data-testid="drop-status"
          data-tone={status.tone}
          aria-live="polite"
        >
          {selection.length > 0
            ? `${t('routeDecisionSelected', lang, { n: selection.length })} · ${status.text}`
            : status.text}
        </span>
        <Button size="sm" variant="ghost" disabled={selection.length === 0} onClick={drops.clear}>
          {t('routeDecisionClear', lang)}
        </Button>
        <Button
          size="sm"
          variant={drops.previewing ? 'primary' : 'secondary'}
          disabled={selection.length === 0}
          pressed={drops.previewing}
          title={t('routeDecisionPreview', lang)}
          onClick={() => {
            if (drops.previewing) {
              drops.setPreviewing(false);
              return;
            }
            drops.setPreviewing(true);
            onPreview?.();
          }}
        >
          <Route size={14} aria-hidden />
          {t('routeDecisionPreview', lang)}
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={selection.length === 0}
          onClick={() => setConfirmDrop(true)}
        >
          {t('routeDecisionDropSelected', lang, { n: selection.length })}
        </Button>
        {confirmDrop ? (
          <ConfirmDialog
            title={t('routeDecisionDropConfirm', lang, { n: selection.length })}
            message={selection.map(giftName).join(' · ')}
            confirmLabel={t('routeDecisionDropSelected', lang, { n: selection.length })}
            onConfirm={() => {
              const ids = [...selection];
              setConfirmDrop(false);
              drops.clear();
              for (const id of ids) removeWanted(id);
            }}
            onCancel={() => setConfirmDrop(false)}
            lang={lang}
          />
        ) : null}
      </div>
    </Card>
  );
}
