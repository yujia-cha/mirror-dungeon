/**
 * The decision card: the one place for the choice the planner cannot make for the user — which
 * gift to take out of the goals when they cannot all fit one run (`pack-conflict`).
 *
 * It sits under the summary and above the metro map, because that is the decision the rest of
 * the panel waits on. One row per option: 「전부 유지」 (the plan as it is, with what stays
 * unresolved), then each alternative the planner tried with what changes — which packs come in,
 * and whether a conflict remains. Rows that clear every conflict with one drop come first
 * (`planAlternatives` sorts by the conflicts left); when no single drop does, the first row is a
 * bundle — the gifts the main plan itself lost, removed together — and the header says how many
 * have to go (`minDrops`). The row's two buttons are symbols at the end of the gift's own
 * line (the name truncates before they move) — ✕ 「목표에서 빼기」 is a
 * deselection (`removeWanted`), as everywhere else in the app; the route icon 「루트 미리 보기」 only
 * switches the map and the stage to that route and keeps the decision open, which the header says
 * while it lasts. The badge 「그래도 n개 미해결」 shows the number alone; the sentence is its
 * tooltip and accessible name. It leaves out what the base plan lost for other reasons — no drop
 * changes those, and the 미해결 card already lists them.
 *
 * The header chips name the contested floors (`conflictGroups`, core) — information only; the app
 * makes no pack-level choice, the decision is always which gift to give up.
 */
import { Route, TriangleAlert, X } from 'lucide-react';
import type { ConflictGroup } from '../../core/conflicts.ts';
import { minDrops, type RouteVariant } from '../../core/index.ts';
import type { RoutePlan } from '../../core/types.ts';
import { withJosa } from '../format.ts';
import { t } from '../i18n.ts';
import { variantDiff } from '../lib/variants.ts';
import { GiftIcon } from './GiftIcon.tsx';
import type { PackContext } from './PackSheet.tsx';
import { Badge, Button, Card, Chip, Skeleton } from './ui.tsx';

/** The row's two icon buttons: 28px square, the label in `aria-label` and `title`. */
const ICON_BUTTON =
  'inline-flex h-7 w-7 flex-none items-center justify-center rounded-sm border transition-colors';

export interface RouteDecisionProps {
  /** The plan for the full goal list — the 「전부 유지」 option and the base every variant is diffed against. */
  plan: RoutePlan;
  variants: RouteVariant[];
  /** 0 for `plan`, `i + 1` for `variants[i]`. */
  variantIndex: number;
  setVariantIndex: (index: number) => void;
  variantsPending: boolean;
  /** Contested floors of `plan`, for the header chips. */
  groups: ConflictGroup[];
  ctx: PackContext;
  removeWanted: (giftId: number) => void;
  /** After a preview starts (not when it ends): the panel scrolls to the map that just changed. */
  onPreview?: () => void;
}

export function RouteDecision({
  plan,
  variants,
  variantIndex,
  setVariantIndex,
  variantsPending,
  groups,
  ctx,
  removeWanted,
  onPreview,
}: RouteDecisionProps) {
  const { lang, giftName, packName, indexes } = ctx;
  const conflicting = [
    ...new Set(plan.unresolved.filter((u) => u.reason === 'pack-conflict').map((u) => u.giftId)),
  ];
  const unresolved = [...new Set(plan.unresolved.map((u) => u.giftId))];
  const previewed = variantIndex > 0 ? variants[variantIndex - 1] : undefined;
  const previewedName = previewed ? previewed.dropped.map(giftName).join(', ') : '';
  const drops = minDrops(variants);
  const names = conflicting.map(giftName).join(' · ');
  const covered = (p: RoutePlan): string => `${p.stats.coveredWanted}/${p.stats.totalWanted}`;

  return (
    <Card variant="strong" className="overflow-visible" testId="route-decision">
      <div className="flex flex-col gap-1.5 border-b border-line px-3 py-2">
        <div className="flex items-start gap-1.5">
          <TriangleAlert size={14} className="mt-0.5 flex-none" aria-hidden />
          <h2 className="text-sm font-semibold">
            {drops !== null && drops > 1
              ? t('routeDecisionTitleMany', lang, { names, n: drops })
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
        {/* Always in the tree so the announcement lands when a preview starts or ends. */}
        <div
          aria-live="polite"
          className={previewed ? 'flex flex-wrap items-center gap-1.5 pt-1' : undefined}
          data-testid="route-decision-preview"
          data-dropped={previewed?.dropped.join(',')}
        >
          {previewed ? (
            <>
              <span className="text-xs font-medium">
                {t('routeDecisionPreviewing', lang, { name: previewedName })}
              </span>
              <span className="ml-auto flex gap-1.5">
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => previewed.dropped.forEach((id) => removeWanted(id))}
                >
                  {t('routeDecisionConfirm', lang)}
                </Button>
                <Button size="sm" onClick={() => setVariantIndex(0)}>
                  {t('routeDecisionBack', lang)}
                </Button>
              </span>
            </>
          ) : null}
        </div>
      </div>

      <ul className="flex flex-col" data-testid={variants.length > 0 ? 'variants' : undefined}>
        <li
          className="flex flex-col gap-1 border-b border-line px-3 py-2"
          data-testid="route-option"
          data-option="all"
          aria-current={variantIndex === 0 ? 'true' : undefined}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{t('routeDecisionKeep', lang)}</span>
            <span className="text-xs text-fg-3">
              {t('routeCovered', lang)} <span className="font-num text-fg">{covered(plan)}</span>
            </span>
          </div>
          {unresolved.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {unresolved.map((giftId) => (
                <Chip key={giftId}>{giftName(giftId)}</Chip>
              ))}
            </div>
          ) : null}
        </li>
        {variants.map((entry, i) => {
          const key = entry.dropped.join(',');
          const name = entry.dropped.map(giftName).join(' · ');
          const diff = variantDiff(plan, entry.plan);
          const shownHere = variantIndex === i + 1;
          return (
            <li
              key={key}
              className="flex flex-col gap-1.5 border-b border-line px-3 py-2 last:border-b-0"
              data-testid="route-option"
              data-option={key}
              aria-current={shownHere ? 'true' : undefined}
            >
              {/* One line: the gift, what the route keeps, and the two actions at its end. The
                  name gives way (truncates) before the buttons do. */}
              <div className="flex items-center gap-2" data-testid="route-option-head">
                <span className="inline-flex flex-none gap-0.5">
                  {entry.dropped.map((giftId) => {
                    const gift = indexes.giftById.get(giftId);
                    return gift ? (
                      <GiftIcon
                        key={giftId}
                        gift={gift}
                        size={20}
                        judgement={ctx.judgements.get(giftId) ?? null}
                        lang={lang}
                      />
                    ) : null;
                  })}
                </span>
                <span className="min-w-0 truncate text-sm font-medium" title={name}>
                  {name}
                </span>
                <span className="flex-none whitespace-nowrap text-xs text-fg-3">
                  {t('routeCovered', lang)} <span className="font-num text-fg">{covered(entry.plan)}</span>
                </span>
                {diff.stillUnresolved.length > 0 ? (
                  <span className="inline-flex flex-none">
                    <Badge
                      tone="alert"
                      title={t('routeDecisionStillUnresolved', lang, { n: diff.stillUnresolved.length })}
                      ariaLabel={t('routeDecisionStillUnresolved', lang, { n: diff.stillUnresolved.length })}
                    >
                      <span className="font-num">{diff.stillUnresolved.length}</span>
                    </Badge>
                  </span>
                ) : null}
                <span className="ml-auto flex flex-none gap-1.5">
                  <button
                    type="button"
                    onClick={() => entry.dropped.forEach((id) => removeWanted(id))}
                    aria-label={`${name} ${t('routeDecisionDrop', lang)}`}
                    title={t('routeDecisionDrop', lang)}
                    className={`${ICON_BUTTON} border-ink bg-ink text-ink-fg hover:opacity-90`}
                  >
                    <X size={14} aria-hidden />
                  </button>
                  <button
                    type="button"
                    aria-pressed={shownHere}
                    aria-label={`${name} ${t('routeDecisionPreview', lang)}`}
                    title={t('routeDecisionPreview', lang)}
                    onClick={() => {
                      if (shownHere) {
                        setVariantIndex(0);
                        return;
                      }
                      setVariantIndex(i + 1);
                      onPreview?.();
                    }}
                    className={`${ICON_BUTTON} ${
                      shownHere
                        ? 'border-ink bg-ink text-ink-fg'
                        : 'border-line-strong bg-surface text-fg hover:bg-surface-2'
                    }`}
                  >
                    <Route size={14} aria-hidden />
                  </button>
                </span>
              </div>
              {diff.added.length > 0 ? (
                <div className="text-xs text-fg-2">
                  {t('routeDecisionPacksChange', lang, {
                    packs: withJosa(diff.added.map((a) => packName(a.packId)).join(', '), '이/가', lang),
                  })}
                </div>
              ) : null}
            </li>
          );
        })}
        {variantsPending ? (
          <li
            className="flex items-center gap-2 px-3 py-2 text-xs text-fg-3"
            data-testid="route-decision-pending"
            role="status"
          >
            <Skeleton className="h-5 w-5 flex-none rounded-sm" />
            <span>{t('routeDecisionPending', lang)}</span>
            <Skeleton className="h-2.5 flex-1" />
          </li>
        ) : null}
      </ul>
    </Card>
  );
}
