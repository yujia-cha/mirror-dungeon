/**
 * Rows for `docs/research/changelog.md`.
 *
 * The runbook asks for one line per data refresh, and that is the step people skip. Both
 * `npm run data:changelog` and the monthly workflow generate it from the two things git already
 * has: the committed `meta.json` and the one that was just built.
 */
import type { Meta } from '../../src/core/schema.ts';

type CountKey = keyof Meta['counts'];

const COUNT_LABELS: [CountKey, string][] = [
  ['gifts', '기프트'],
  ['packs', '팩'],
  ['identities', '인격'],
  ['fusionRecipes', '조합 레시피'],
];

/** `기프트 446→448 (+2), 팩 116→117 (+1)`, or the plain totals when there is nothing to compare to. */
export function countsSummary(before: Meta | null, after: Meta): string {
  if (!before) return COUNT_LABELS.map(([key, label]) => `${label} ${after.counts[key]}`).join(', ');

  const moved = COUNT_LABELS.flatMap(([key, label]) => {
    const from = before.counts[key];
    const to = after.counts[key];
    if (from === to) return [];
    const delta = to - from;
    return [`${label} ${from}→${to} (${delta > 0 ? '+' : ''}${delta})`];
  });
  return moved.length > 0 ? moved.join(', ') : '수치 변동 없음 (내용만 변경)';
}

/**
 * The revision of one source, short. A source whose languages sit on their own branches has no
 * single sha, so its branches are joined: `KR ac56ea82+EN c0679827`.
 */
export function sourceRevision(source: Meta['sources'][string] | undefined): string | undefined {
  if (!source) return undefined;
  if (source.sha) return source.sha.slice(0, 8);
  if (!source.languages) return undefined;
  return Object.entries(source.languages)
    .map(([lang, sha]) => `${lang} ${sha.slice(0, 8)}`)
    .join('+');
}

/** `localize 231a8bcf / openLethe 823129ad→1a2b3c4d` — only sources that moved show an arrow. */
export function sourcesSummary(before: Meta | null, after: Meta): string {
  return Object.keys(after.sources)
    .sort()
    .map((name) => {
      const to = sourceRevision(after.sources[name]) ?? '(none)';
      const from = sourceRevision(before?.sources[name]);
      return from && from !== to ? `${name} ${from}→${to}` : `${name} ${to}`;
    })
    .join(' / ');
}

export function changelogRow(before: Meta | null, after: Meta, date: string): string {
  return `| ${date} | ${after.dataVersion} | ${sourcesSummary(before, after)} | ${countsSummary(before, after)} |`;
}

/** Everything after the date cell — two refreshes are "the same" when only the date differs. */
function rowBody(row: string): string {
  return row.split('|').slice(2).join('|').trimEnd();
}

/**
 * Append below the last table row, leaving everything else alone. Idempotent: a refresh whose
 * sources and counts are already recorded is not written twice, so re-running adds nothing.
 */
export function appendRow(markdown: string, row: string): string {
  const body = rowBody(row);
  const lines = markdown.split('\n');

  let lastTableLine = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line?.startsWith('|')) continue;
    if (rowBody(line) === body) return markdown;
    lastTableLine = i;
  }
  if (lastTableLine === -1) return `${markdown.trimEnd()}\n\n${row}\n`;

  lines.splice(lastTableLine + 1, 0, row);
  return lines.join('\n');
}
