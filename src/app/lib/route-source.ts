/**
 * Where the route gets one gift from — the one sentence the gift sheet and the fusion card say
 * about a gift the plan is out to collect. Pure: reads the plan, never recomputes it.
 *
 * The order of the checks is the order the planner decides in: an observation is the user's own
 * decision and beats the starting gift, both beat a pack visit, a fusion is the last step, and a
 * general drop is what remains when no pack fetches the gift. A gift the plan says nothing about
 * (not needed, owned, or unresolved) has no source.
 */
import type { RoutePlan } from '../../core/types.ts';
import { t, type Lang } from '../i18n.ts';

export type RouteSource =
  | { kind: 'pack'; floor: number; packId: number }
  | { kind: 'observed' }
  | { kind: 'start' }
  | { kind: 'general' }
  | { kind: 'fusion'; floor: number; unreachable: boolean };

export function routeSourceOf(plan: RoutePlan | null, giftId: number): RouteSource | null {
  if (!plan) return null;
  if (plan.start.observed.some((o) => o.giftId === giftId)) return { kind: 'observed' };
  if (plan.start.startGift === giftId) return { kind: 'start' };
  // The first floor that lists the gift: the floors come sorted, and a pickup on a floor with no
  // pack would be nothing the reader could act on.
  for (const floor of plan.floors) {
    if (floor.packId === null) continue;
    if (floor.pickups.some((p) => p.giftId === giftId))
      return { kind: 'pack', floor: floor.floor, packId: floor.packId };
  }
  const fusion = plan.fusions.find((f) => f.result === giftId);
  if (fusion) return { kind: 'fusion', floor: fusion.earliestFloor, unreachable: fusion.unreachable };
  if (plan.generalDrops.includes(giftId)) return { kind: 'general' };
  return null;
}

/** 「5층 경험기억」 · 「관측」 · 「시작 기프트」 · 「범용 (팩 없음)」 · 「2층 이후 조합」 · 「조합 불가」. */
export function routeSourceText(
  source: RouteSource,
  { packName, lang }: { packName: (id: number) => string; lang: Lang },
): string {
  switch (source.kind) {
    case 'pack':
      return t('routeSourcePack', lang, { floor: source.floor, name: packName(source.packId) });
    case 'observed':
      return t('routeSourceObserved', lang);
    case 'start':
      return t('routeSourceStart', lang);
    case 'general':
      return t('routeSourceGeneral', lang);
    case 'fusion':
      return source.unreachable
        ? t('routeSourceFusionUnreachable', lang)
        : t('routeSourceFusion', lang, { floor: source.floor });
  }
}
