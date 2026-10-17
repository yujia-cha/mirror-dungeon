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
 * The header names the conflicting goals and how many have to go (since M144 the fewest removals
 * the ways found, said only when no pin release does with fewer; before them `resolving`). The
 * old 「빼면 해결 · 이 조합 고르기」 row gave way to the ways list below. The floor chips
 * name the contested floors (`conflictGroups`, core) — information only; the app makes no
 * pack-level choice.
 *
 * Since M115 the card names both sides. Under the header, one line per lost goal names the goals it
 * fights (`tradeoffs`): the measured bars whose drop alone keeps it, or before they are in, what the
 * route that must keep it leaves out.
 * Each bar says why it is a candidate (원인 · 놓친 목표 · 시작 기프트) and marks the goal added
 * last; a bar of 0 says which goals share its pack; and when the cap or the budget left
 * candidates out, the card says how many and measures the rest on request (「더 계산」).
 *
 * Since M144 the card leads with the **ways to fit** (`resolutions`, core `createResolutions`): the
 * fewest goals to remove, and the player's own observation pins whose release does it with fewer
 * or none, ranked. Each row names what it releases and removes; a free choice is one row (「이 중
 * 아무거나 n개」, its pool checkable), a goal every way removes says so (「꼭 빼야 함」), and a
 * same-pack group that removes more than it has to is under 「다른 방법」. 「이 방법 고르기」 checks
 * the removals and releases the pins in the preview (`drops.pick`); confirming removes the goals and
 * takes the pins off. The bars moved under 「자세히」.
 */
import { useState, type ReactNode } from 'react';
import { Route, TriangleAlert } from 'lucide-react';
import type { ConflictGroup } from '../../core/conflicts.ts';
import type {
  DropAnalysis,
  DropRole,
  Resolution,
  ResolutionAnalysis,
  ResolutionChoice,
  Tradeoff,
} from '../../core/index.ts';
import { wayRows, type WayRow } from '../lib/resolution-rows.ts';
import type { RoutePlan } from '../../core/types.ts';
import { t } from '../i18n.ts';
import type { DropSelection } from '../shell/plan-context.ts';
import { ConfirmDialog } from './ConfirmDialog.tsx';
import { GiftIcon } from './GiftIcon.tsx';
import { LinkedText } from './LinkedText.tsx';
import type { PackContext } from './PackSheet.tsx';
import { Badge, Button, Card, Checkbox, Chip, LinkButton, Skeleton } from './ui.tsx';

export interface RouteDecisionProps {
  /** The plan for the full goal list — what the bars are measured against. */
  plan: RoutePlan;
  analysis: DropAnalysis | null;
  /** The ways to fit (M144); null until the analysis brings them. */
  resolutions?: ResolutionAnalysis | null;
  analysisPending: boolean;
  drops: DropSelection;
  /** Contested floors of `plan`, for the header chips. */
  groups: ConflictGroup[];
  /** Goals `plan` loses to the conflict (`conflictRootsOf`), for the header. */
  conflicting: number[];
  /** The goal picked last (`wanted` keeps the picking order): most often the one that caused it. */
  lastAdded: number | null;
  /** Measure the candidates the analysis left out. */
  onMore: () => void;
  ctx: PackContext;
  removeWanted: (giftId: number) => void;
  /** Take one of the player's observation pins off (a way's release, on confirming). */
  releasePin?: (giftId: number) => void;
  /** After a preview starts (not when it ends): the panel scrolls to the map that just changed. */
  onPreview?: () => void;
}

/** The marked roles; a goal that is merely routed or on a contested floor carries none. */
const ROLE_LABEL: Partial<
  Record<DropRole, 'routeDecisionRoleCause' | 'routeDecisionRoleLost' | 'routeDecisionRoleStart'>
> = {
  cause: 'routeDecisionRoleCause',
  lost: 'routeDecisionRoleLost',
  start: 'routeDecisionRoleStart',
};

const sameIds = (a: readonly number[], b: readonly number[]): boolean =>
  a.length === b.length && a.every((id) => b.includes(id));

/** Minimal rows shown before 「방법 n개 더 보기」. */
const VISIBLE_WAYS = 4;

export function RouteDecision({
  plan,
  analysis,
  resolutions = null,
  analysisPending,
  drops,
  groups,
  conflicting,
  lastAdded,
  onMore,
  ctx,
  removeWanted,
  releasePin,
  onPreview,
}: RouteDecisionProps) {
  const { lang, giftName, indexes } = ctx;
  const [confirmDrop, setConfirmDrop] = useState(false);
  const [allWays, setAllWays] = useState(false);
  const names = conflicting.map(giftName).join(' · ');
  const tradeoffs = analysis?.tradeoffs ?? [];
  // The rivals the bars measured say it surely (each alone keeps the goal); until they are in, the
  // forced plan's pick says what one route gives up.
  const tradeoffLine = ({ lost, causes, rivals }: Tradeoff): string =>
    rivals.length > 1
      ? t('routeDecisionTradeoffAny', lang, { lost: giftName(lost), names: rivals.map(giftName).join(' · ') })
      : rivals.length === 1
        ? t('routeDecisionTradeoffOne', lang, { lost: giftName(lost), name: giftName(rivals[0]!) })
        : t('routeDecisionTradeoff', lang, {
            lost: giftName(lost),
            causes: causes.map(giftName).join(' · '),
          });
  const skipped = analysis?.skipped ?? 0;
  const ways = resolutions?.methods ?? [];
  // How many have to go — said only when no release does it with fewer (then the list says it).
  const need =
    ways.length > 0
      ? ways.some((way) => way.releases.length > 0)
        ? null
        : ways[0]!.removals.length
      : (analysis?.resolving?.dropped.length ?? null);
  const total = analysis?.conflicts ?? conflicting.length;
  const effects = analysis?.effects ?? [];
  const { selection, released } = drops;
  const chosen = selection.length > 0 || released.length > 0;
  const covered = (p: RoutePlan): string => `${p.stats.coveredWanted}/${p.stats.totalWanted}`;

  const barSum = selection.reduce((sum, id) => sum + (effects.find((e) => e.giftId === id)?.reduces ?? 0), 0);
  const real = drops.conflicts === null ? null : total - drops.conflicts;

  const status = ((): { text: string; tone: 'ok' | 'left' | 'plain' } => {
    if (!chosen)
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

  /** A sentence whose gift names open their sheets. */
  const linked = (text: string, ids: readonly number[]): ReactNode =>
    ctx.onOpenGift ? (
      <LinkedText
        text={text}
        links={ids.map((id) => ({ name: giftName(id), onOpen: () => ctx.onOpenGift?.(id) }))}
      />
    ) : (
      text
    );
  const isPicked = (removals: readonly number[], releases: readonly number[]): boolean =>
    chosen && sameIds(selection, removals) && sameIds(released, releases);
  const rows = resolutions ? wayRows(resolutions) : { minimal: [], others: [] };
  const shownRows = allWays ? rows.minimal : rows.minimal.slice(0, VISIBLE_WAYS);
  const hiddenRows = rows.minimal.length - shownRows.length;
  const waysApprox = resolutions !== null && (resolutions.approx || ways.some((way) => way.approx));

  const releaseLine = (releases: readonly number[]): ReactNode =>
    releases.length > 0 ? (
      <p className="text-body" data-testid="resolution-release">
        {linked(t('routeMethodRelease', lang, { names: releases.map(giftName).join(' · ') }), releases)}
      </p>
    ) : null;
  const pickButton = (removals: number[], releases: number[]): ReactNode => {
    const on = isPicked(removals, releases);
    return (
      <Button
        size="sm"
        variant={on ? 'primary' : 'secondary'}
        pressed={on}
        onClick={() => drops.pick(removals, releases)}
      >
        {t('routeMethodPick', lang)}
      </Button>
    );
  };
  const wayBody = (way: Resolution, sharedPack = false): ReactNode => (
    <>
      {releaseLine(way.releases)}
      {way.removals.length === 0 ? (
        <p className="text-body text-fg-muted">{t('routeMethodKeep', lang)}</p>
      ) : (
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-body">
          <span className="min-w-0">
            {linked(
              t('routeMethodRemove', lang, { names: way.removals.map(giftName).join(' + ') }),
              way.removals,
            )}
          </span>
          {sharedPack ? <Chip>{t('routeMethodSamePack', lang)}</Chip> : null}
        </p>
      )}
      {way.essential.length > 0 ? (
        <p className="text-body text-fg-muted" data-testid="resolution-must">
          {linked(
            t('routeMethodMust', lang, { names: way.essential.map(giftName).join(' · ') }),
            way.essential,
          )}
        </p>
      ) : null}
    </>
  );
  /** A free choice: the essential goals, and any `pick` of the pool — checkable one by one. */
  const anyBody = (choice: ResolutionChoice): ReactNode => {
    const active =
      chosen && sameIds(released, choice.releases) && choice.essential.every((id) => selection.includes(id));
    const togglePool = (giftId: number, on: boolean): void => {
      const current = active ? selection : choice.essential;
      const next = on
        ? choice.pick === 1
          ? [...choice.essential, giftId]
          : [...current, giftId]
        : current.filter((id) => id !== giftId);
      drops.pick([...new Set(next)], choice.releases);
    };
    return (
      <>
        {releaseLine(choice.releases)}
        {choice.essential.length > 0 ? (
          <p className="text-body" data-testid="resolution-must">
            {linked(
              t('routeMethodMust', lang, { names: choice.essential.map(giftName).join(' · ') }),
              choice.essential,
            )}
          </p>
        ) : null}
        <p className="text-body">
          {t('routeMethodRemove', lang, { names: t('routeMethodAny', lang, { n: choice.pick }) })}
        </p>
        <ul className="flex flex-wrap gap-x-3 gap-y-0.5" data-testid="resolution-pool">
          {choice.pool.map((giftId) => {
            const gift = indexes.giftById.get(giftId);
            return (
              <li key={giftId}>
                <Checkbox
                  checked={active && selection.includes(giftId)}
                  onChange={(on) => togglePool(giftId, on)}
                  ariaLabel={`${giftName(giftId)} ${t('routeMethodPick', lang)}`}
                  testId="resolution-option"
                >
                  {gift ? (
                    <GiftIcon
                      gift={gift}
                      size={20}
                      judgement={ctx.judgements.get(giftId) ?? null}
                      lang={lang}
                    />
                  ) : null}
                  {ctx.onOpenGift ? (
                    <LinkButton onClick={() => ctx.onOpenGift?.(giftId)} className="text-left text-body">
                      {giftName(giftId)}
                    </LinkButton>
                  ) : (
                    <span className="text-body">{giftName(giftId)}</span>
                  )}
                </Checkbox>
              </li>
            );
          })}
        </ul>
      </>
    );
  };
  const rowFrame = (
    key: string,
    removals: number[],
    releases: number[],
    kind: WayRow['kind'] | 'other',
    content: ReactNode,
  ): ReactNode => {
    const on = isPicked(removals, releases);
    return (
      <li
        key={key}
        className={`flex flex-col items-start gap-2 rounded-sm border px-2 py-1.5 ${on ? 'border-primary bg-surface-muted' : 'border-border'}`}
        data-testid="resolution"
        data-kind={kind}
        data-removals={removals.join(',')}
        data-releases={releases.join(',')}
      >
        {/* The button goes under the way, never beside it: beside it, a phone's narrow card squeezed the list of names. */}
        <div className="flex min-w-0 flex-col gap-0.5 self-stretch">{content}</div>
        {pickButton(removals, releases)}
      </li>
    );
  };

  const applyLabel =
    released.length === 0
      ? t('routeDecisionDropSelected', lang, { n: selection.length })
      : selection.length === 0
        ? t('routeDecisionReleaseOnly', lang, { n: released.length })
        : t('routeDecisionApplyBoth', lang, { n: selection.length, m: released.length });
  const confirmTitle =
    released.length === 0
      ? t('routeDecisionDropConfirm', lang, { n: selection.length })
      : selection.length === 0
        ? t('routeDecisionReleaseConfirm', lang, { n: released.length })
        : t('routeDecisionApplyConfirm', lang, { n: selection.length, m: released.length });
  const confirmMessage = [
    selection.map(giftName).join(' · '),
    released.length > 0 ? t('routeMethodRelease', lang, { names: released.map(giftName).join(' · ') }) : '',
  ]
    .filter((line) => line !== '')
    .join(' / ');
  const statusParts = [
    selection.length > 0 ? t('routeDecisionSelected', lang, { n: selection.length }) : null,
    released.length > 0 ? t('routeDecisionReleased', lang, { n: released.length }) : null,
  ].filter((part): part is string => part !== null);

  return (
    <Card variant="strong" className="overflow-visible" testId="route-decision">
      <div className="flex flex-col gap-1.5 border-b border-border px-3 py-2">
        <div className="flex items-start gap-1.5">
          <TriangleAlert size={14} className="mt-0.5 flex-none" aria-hidden />
          <h2 className="text-subheading ">
            {tradeoffs.length > 0 || ways.length > 0
              ? need !== null && need > 1
                ? t('routeDecisionTitleShortMany', lang, { n: need })
                : t('routeDecisionTitleShort', lang)
              : need !== null && need > 1
                ? t('routeDecisionTitleMany', lang, { names, n: need })
                : t('routeDecisionTitle', lang, { names })}
          </h2>
        </div>
        {tradeoffs.length > 0 ? (
          <ul className="flex flex-col gap-0.5 pl-6 text-body" data-testid="drop-tradeoffs">
            {tradeoffs.map((tradeoff) => (
              <li key={tradeoff.lost} data-testid="drop-tradeoff" data-lost={tradeoff.lost}>
                {tradeoffLine(tradeoff)}
              </li>
            ))}
          </ul>
        ) : null}
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

      <div className="flex flex-col gap-1.5 px-3 py-2" data-testid="resolutions">
        <div className="flex flex-wrap items-center gap-1.5">
          <h3 className="text-caption-strong text-fg">{t('routeMethods', lang)}</h3>
          {waysApprox ? (
            <Badge tone="approx" title={t('routeApproxHint', lang)}>
              {t('routeApprox', lang)}
            </Badge>
          ) : null}
        </div>
        {shownRows.length > 0 ? (
          <ol className="flex flex-col gap-1.5" data-testid="resolution-list">
            {shownRows.map((row) =>
              row.kind === 'any'
                ? rowFrame(
                    `any:${row.choice.releases.join(',')}`,
                    row.first.removals,
                    row.first.releases,
                    'any',
                    anyBody(row.choice),
                  )
                : rowFrame(
                    `way:${row.way.releases.join(',')}:${row.way.removals.join(',')}`,
                    row.way.removals,
                    row.way.releases,
                    'way',
                    wayBody(row.way),
                  ),
            )}
          </ol>
        ) : null}
        {hiddenRows > 0 ? (
          <div>
            <Button size="sm" variant="ghost" onClick={() => setAllWays(true)}>
              {t('routeMethodShowAll', lang, { n: hiddenRows })}
            </Button>
          </div>
        ) : null}
        {rows.others.length > 0 ? (
          <>
            <div className="text-caption text-fg-subtle">{t('routeMethodOther', lang)}</div>
            <ol className="flex flex-col gap-1.5" data-testid="resolution-others">
              {rows.others.map((way) =>
                rowFrame(
                  `other:${way.removals.join(',')}`,
                  way.removals,
                  way.releases,
                  'other',
                  wayBody(way, true),
                ),
              )}
            </ol>
          </>
        ) : null}
        {analysisPending ? (
          <div
            className="flex items-center gap-2 px-1 py-1 text-caption text-fg-subtle"
            data-testid="route-decision-pending"
            role="status"
          >
            <Skeleton className="h-5 w-5 flex-none rounded-sm" />
            <span>{t('routeDecisionPending', lang)}</span>
            <Skeleton className="h-2.5 flex-1" />
          </div>
        ) : resolutions && !resolutions.complete ? (
          <div className="flex flex-wrap items-center gap-2 text-caption" data-testid="resolution-more">
            <span className="text-fg-muted">{t('routeMethodMore', lang)}</span>
            <Button size="sm" variant="ghost" onClick={onMore}>
              {t('routeDecisionMore', lang)}
            </Button>
          </div>
        ) : null}
      </div>

      <details className="border-t border-border" data-testid="drop-details">
        <summary className="cursor-pointer px-3 py-1.5 text-caption-strong text-fg-muted touch:min-h-11 touch:py-3">
          {t('routeDecisionDetails', lang)}
          <span className="ml-1.5 font-num text-micro text-fg-subtle">{effects.length}</span>
        </summary>
        <div className="flex flex-col gap-1 px-3 pb-2">
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
                    {/* The role chips wrap under the name rather than run over the bar (M123: a
                          larger 「글자 크기」 made two chips wider than the column). */}
                    <span className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5">
                      {ctx.onOpenGift ? (
                        // A button inside the label: pressing the name opens the gift, not the box.
                        <LinkButton
                          onClick={() => ctx.onOpenGift?.(effect.giftId)}
                          className="min-w-0 max-w-full truncate text-left text-body"
                        >
                          {name}
                        </LinkButton>
                      ) : (
                        <span className="min-w-0 max-w-full truncate text-body" title={name}>
                          {name}
                        </span>
                      )}
                      {ROLE_LABEL[effect.role] ? (
                        <span className="flex-none" data-testid="drop-role" data-role={effect.role}>
                          <Chip>{t(ROLE_LABEL[effect.role]!, lang)}</Chip>
                        </span>
                      ) : null}
                      {effect.giftId === lastAdded ? (
                        <span className="flex-none" data-testid="drop-last-added">
                          <Chip>{t('routeDecisionLastAdded', lang)}</Chip>
                        </span>
                      ) : null}
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
                  {effect.sharesPackWith ? (
                    <p className="pl-6 text-body text-fg-muted" data-testid="drop-shares-pack">
                      {t('routeDecisionSharesPack', lang, {
                        names: effect.sharesPackWith.map(giftName).join(' · '),
                      })}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {skipped > 0 && !analysisPending ? (
            <div className="flex flex-wrap items-center gap-2 text-caption" data-testid="drop-more">
              <span className="text-fg-muted">
                {t('routeDecisionMeasured', lang, { done: effects.length, total: effects.length + skipped })}
              </span>
              <Button size="sm" variant="ghost" onClick={onMore}>
                {t('routeDecisionMore', lang)}
              </Button>
            </div>
          ) : null}
          {/* Bars measure removals alone; a way that releases a pin is not theirs to sum. */}
          {selection.length > 0 && released.length === 0 ? (
            <div
              className="mt-1 rounded-sm bg-surface-muted px-2 py-1 text-body text-fg-muted"
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
        </div>
      </details>

      <div className="flex flex-wrap items-center gap-1.5 border-t border-border px-3 py-2">
        <span
          // Success is said by the ✓ in the words, in ink: green text was 3.5–4.0:1 and put hue
          // where the system allows only the judgement ring.
          className={`min-w-0 flex-[1_1_10rem] ${status.tone === 'plain' ? 'text-caption text-fg-muted' : 'text-caption-strong text-fg'}`}
          data-testid="drop-status"
          data-tone={status.tone}
          aria-live="polite"
        >
          {chosen ? [...statusParts, status.text].join(' · ') : status.text}
        </span>
        <Button size="sm" variant="ghost" disabled={!chosen} onClick={drops.clear}>
          {t('routeDecisionClear', lang)}
        </Button>
        <Button
          size="sm"
          variant={drops.previewing ? 'primary' : 'secondary'}
          disabled={!chosen}
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
        <Button size="sm" variant="primary" disabled={!chosen} onClick={() => setConfirmDrop(true)}>
          {applyLabel}
        </Button>
        {confirmDrop ? (
          <ConfirmDialog
            title={confirmTitle}
            message={confirmMessage}
            confirmLabel={applyLabel}
            onConfirm={() => {
              const ids = [...selection];
              const pins = [...released];
              setConfirmDrop(false);
              drops.clear();
              // The pins first: a removed goal's pin would be pruned with it anyway.
              for (const id of pins) releasePin?.(id);
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
