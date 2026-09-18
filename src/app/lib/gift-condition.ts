/**
 * A gift's activation condition as a chip: 「진동 3/5」. The full sentence still exists in
 * `conditionText()` and rides along as hover text; a tile only has room for the subject and the
 * count that decides it.
 */
import type { Enums } from '../../core/schema.ts';
import type { ConditionReport } from '../../core/types.ts';
import { factionName, keywordName } from '../format.ts';
import { t, type Lang } from '../i18n.ts';

/** The subject of a condition in one or two words; null when there is nothing short to say. */
function subjectShort(report: ConditionReport, enums: Enums, lang: Lang): string | null {
  switch (report.subject.kind) {
    case 'keyword':
      return keywordName(report.subject.ids[0] as never, enums, lang);
    case 'faction':
      return report.subject.ids.map((id) => factionName(id, enums, lang)).join('/');
    case 'resonance':
      return t('condResonance', lang);
    default:
      return null;
  }
}

/** 「진동 3/5」, or 「?」 when the deck cannot decide it. Null when the gift has no condition. */
export function conditionShort(report: ConditionReport | null | undefined, enums: Enums, lang: Lang): string | null {
  if (!report) return null;
  const subject = subjectShort(report, enums, lang);
  if (report.have === null || report.need === null) return subject ? `${subject} ?` : '?';
  const count = `${report.have}/${report.need}`;
  return subject ? `${subject} ${count}` : count;
}

/** The one report a tile shows: the condition still short, else the first. */
export function decidingReport(reports: ConditionReport[], lack: ConditionReport | null): ConditionReport | null {
  return lack ?? reports[0] ?? null;
}
