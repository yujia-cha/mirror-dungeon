/**
 * The decision card's ways list (M144), as rows: a free choice (`ResolutionChoice.any` — every
 * `pick` of the pool fits, 「이 중 아무거나 n개」) is one row standing where its best way would, and
 * any other minimal way is a row of its own. Ways that remove more than they have to (same-pack
 * groups) are kept apart for 「다른 방법」. The order is core's ranking (`compareResolutions`).
 */
import type { Resolution, ResolutionAnalysis, ResolutionChoice } from '../../core/index.ts';

export type WayRow =
  | { kind: 'any'; choice: ResolutionChoice; first: Resolution }
  | { kind: 'way'; way: Resolution; choice: ResolutionChoice | undefined };

const sameIds = (a: readonly number[], b: readonly number[]): boolean =>
  a.length === b.length && a.every((id) => b.includes(id));

export function wayRows(resolutions: ResolutionAnalysis): { minimal: WayRow[]; others: Resolution[] } {
  const minimal: WayRow[] = [];
  const placed = new Set<ResolutionChoice>();
  for (const way of resolutions.methods) {
    if (!way.minimal) continue;
    const choice = resolutions.choices.find((c) => sameIds(c.releases, way.releases));
    if (choice?.any) {
      if (placed.has(choice)) continue;
      placed.add(choice);
      minimal.push({ kind: 'any', choice, first: way });
    } else minimal.push({ kind: 'way', way, choice });
  }
  return { minimal, others: resolutions.methods.filter((way) => !way.minimal) };
}
