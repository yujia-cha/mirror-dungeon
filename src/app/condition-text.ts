/**
 * Render a condition report in the reader's language.
 *
 * The planner reports raw game ids (`Combustion`, `THUMB_FINGER`) on purpose, so this is where
 * they become 화상 and 엄지.
 */
import type { Enums } from '../core/schema.ts';
import type { ConditionReport } from '../core/types.ts';
import type { Lang } from './i18n.ts';
import { factionName, keywordName } from './format.ts';
import { josa } from '../core/text.ts';

const SCOPE_TEXT: Record<'deployed' | 'formation' | 'reserve', { ko: string; en: string }> = {
  deployed: { ko: '출격 인원', en: 'deployed only' },
  formation: { ko: '편성 인원', en: 'whole formation' },
  reserve: { ko: '대기 인원', en: 'reserves only' },
};

export function conditionText(report: ConditionReport, enums: Enums, lang: Lang): string {
  const have = report.have ?? '?';
  const need = report.need ?? '?';
  const scope = report.subject.scope ? SCOPE_TEXT[report.subject.scope][lang] : null;
  const scopeSuffix = scope ? ` (${scope})` : '';

  switch (report.subject.kind) {
    case 'keyword': {
      const names = report.subject.ids.map((id) => keywordName(id as never, enums, lang));
      const list = names.join(' 또는 ');
      // 탄환·혈찬 are spent by a skill, not inflicted on anyone — 「소모하는」, not 「부여하는」.
      const consume = report.subject.verb === 'consume';
      const ko = consume ? `${josa(list, '을/를')} 소모하는` : `${josa(list, '을/를')} 부여하는 공격`;
      const en = consume ? 'consume' : 'inflict';
      // Without a threshold the sentence states the count and says what it is for: the gift is
      // always on and only grows with it, so there is nothing to meet.
      if (!report.gate) {
        return lang === 'ko'
          ? `${ko} 스킬 보유 인격 ${have}명${scopeSuffix} · 수에 따라 강화`
          : `${have} identities ${en} ${names.join(' or ')}${scopeSuffix} · scales with the count`;
      }
      return lang === 'ko'
        ? `${ko} 스킬 보유 인격 ${have}/${need}${scopeSuffix}`
        : `${have}/${need} identities ${en} ${names.join(' or ')}${scopeSuffix}`;
    }
    case 'faction': {
      const names = report.subject.ids.map((id) => factionName(id, enums, lang));
      return lang === 'ko'
        ? `${names.join(' 또는 ')} 소속 ${have}/${need}인${scopeSuffix}`
        : `${have}/${need} identities from ${names.join(' or ')}${scopeSuffix}`;
    }
    case 'resonance':
      return lang === 'ko'
        ? `완전 공명 ${need} 이상 필요 — 전투 중 판정이라 덱만으로는 알 수 없습니다`
        : `needs ${need}+ full resonance, which depends on in-battle play`;
    case 'text':
      return report.detail[lang] || report.detail.ko;
  }
}

/** Extra thresholds the deck also clears, e.g. "5인 이상 강화 조건도 충족". */
export function reachedTierText(report: ConditionReport, lang: Lang): string | null {
  if (report.reachedTiers.length === 0) return null;
  const list = report.reachedTiers.join(', ');
  return lang === 'ko' ? `강화 조건 ${list}인 이상도 충족` : `also clears the ${list}+ tier`;
}
