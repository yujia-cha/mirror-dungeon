import type { Keyword } from '../../core/schema.ts';
import type { RoutePlan } from '../../core/types.ts';
import { pick, t, type Lang } from '../i18n.ts';
import { segmentsFor } from './metro.ts';
import { unresolvedDetailText } from './unresolved-text.ts';

/**
 * A Discord-friendly plain-text rendering of the plan, one line per metro segment: packs that
 * share a window are listed together with the floors they may take. Ids are localized by the
 * callbacks. Only what the route decides is written.
 */
export function planToText(
  plan: RoutePlan,
  giftName: (id: number) => string,
  packName: (id: number) => string,
  keywordLabel: (id: Keyword) => string,
  lang: Lang,
  dropped: number[] = [],
  marks: { bannedPacks?: number[]; run?: { currentFloor: number; visits: Record<number, number> } } = {},
): string {
  const lines: string[] = [];
  // The app says 「4층」 everywhere else; the copied plan used to be the one place writing `4F` at a
  // Korean reader. `routeFreeRange` already held the range form and was going unused.
  const at = (floor: number): string => t('stageFloor', lang, { floor });
  const range = (from: number, to: number): string =>
    from === to ? at(from) : t('routeFloorRange', lang, { from, to });
  const name = giftName;
  if (dropped.length > 0)
    lines.push(t('routeVariantWithout', lang, { name: dropped.map(giftName).join(', ') }));
  if (marks.run) {
    const visits = Object.entries(marks.run.visits)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([floor, packId]) => `${at(Number(floor))} ${packName(packId)}`);
    lines.push(
      `${t('runActive', lang)} · ${t('runCurrentFloor', lang)} ${at(marks.run.currentFloor)}${visits.length > 0 ? ` · ${visits.join(', ')}` : ''}`,
    );
  }
  lines.push(`${t('routeStart', lang)}: ${plan.start.keyword ? keywordLabel(plan.start.keyword) : '—'}`);
  if (plan.start.startGift) lines.push(`  ${t('routeStartGift', lang)}: ${giftName(plan.start.startGift)}`);
  if (plan.start.observed.length > 0) {
    const observed = plan.start.observed.map(
      (o) =>
        `${name(o.giftId)} (${o.pinned ? t('routeObservedPinned', lang) : t('routeObservedRecommended', lang)})`,
    );
    lines.push(`  ${t('routeObserved', lang)}: ${observed.join(', ')}`);
  }
  lines.push('');
  const metro = segmentsFor(plan);
  const rows: { at: number; text: string[] }[] = [];
  for (const run of metro.freeRuns) {
    const word = run.passed ? t('runPassed', lang) : t('routeFree', lang);
    rows.push({ at: run.from, text: [`${range(run.from, run.to)}: ${word}`] });
  }
  for (const segment of metro.segments) {
    const head = segment.passed
      ? `${at(segment.from)} (${t('runVisited', lang, { floor: segment.from })})`
      : segment.fixed
        ? at(segment.from)
        : range(segment.from, segment.to);
    const text = [`${head}: ${segment.packs.map((p) => packName(p.packId)).join(' · ')}`];
    for (const pack of segment.packs) {
      for (const giftId of pack.gifts) {
        const pickup = plan.floors
          .find((f) => f.floor === pack.floor)
          ?.pickups.find((p) => p.giftId === giftId);
        const why = pickup?.neededFor ? ` -> ${giftName(pickup.neededFor)}` : '';
        text.push(
          `  - ${name(giftId)}${segment.packs.length > 1 ? ` (${packName(pack.packId)})` : ''}${why}`,
        );
      }
    }
    rows.push({ at: segment.from, text });
  }
  rows.sort((a, b) => a.at - b.at);
  for (const row of rows) lines.push(...row.text);
  if (plan.unresolved.length > 0) {
    lines.push('');
    lines.push(t('routeUnresolved', lang));
    for (const entry of plan.unresolved)
      lines.push(`  ${name(entry.giftId)}: ${unresolvedDetailText(entry, giftName, lang)}`);
  }
  // Which goals no pack is fetching — the copied plan carries the same list the panel shows.
  if (plan.generalDrops.length > 0) {
    lines.push('');
    lines.push(`${t('routeGeneralTitle', lang)}: ${plan.generalDrops.map(name).join(', ')}`);
  }
  if (marks.bannedPacks && marks.bannedPacks.length > 0) {
    lines.push('');
    lines.push(`${t('packBanned', lang)}: ${marks.bannedPacks.map(packName).join(', ')}`);
  }
  // Same rule as the panel: a warning another line already carries stays out. The general-drop
  // one is deliberately dropped everywhere — the 「범용 드랍」 list is what the route has to say.
  const CARRIED = new Set(['parallel-requires-hard', 'condition-unmet', 'general-drop-not-guaranteed']);
  const notes = plan.warnings.filter((w) => !CARRIED.has(w.code));
  if (notes.length > 0) {
    lines.push('');
    lines.push(t('routeWarnings', lang));
    for (const note of notes) lines.push(`  - ${pick(note.detail, lang)}`);
  }
  return lines.join('\n');
}
