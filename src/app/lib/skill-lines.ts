/**
 * The two lines the 「스킬」 탭 writes under a gift's name: what sets it off, and whose skills do.
 *
 * Pure so they can be read at a glance and tested without a DOM. Game display names never come from
 * here — the caller resolves sins through `SIN_LABEL` and attack types through the enums, and hands
 * the results in.
 */
import type { AttackType, IdentityKeywordId, SkillTrigger } from '../../core/schema.ts';
import type { SkillRef } from '../../core/index.ts';
import { t } from '../i18n.ts';
import type { Lang } from '../i18n.ts';
import { SIN_LABEL } from './labels.ts';
import type { StringKey } from '../i18n.ts';

/**
 * How the sentence reads, never which skills match — the static data names the buff and not the
 * direction, so `verb` is wording only, exactly as `keywordSkillCount` treats it.
 */
const VERB_LABEL: Record<SkillTrigger['verb'], StringKey> = {
  inflict: 'skillsVerbInflict',
  consume: 'skillsVerbConsume',
  any: 'skillsVerbAny',
};

/**
 * 「참격 스킬」 · 「질투 속성 스킬」 · 「1스킬이 참격」 · 「3스킬이 화상 부여」 · 「화상 인격의 3스킬」,
 * joined by ` · `.
 *
 * A keyword trigger reads differently depending on whose keyword it is, and the difference is the
 * whole point: 「3스킬이 화상 부여」 wants that skill to burn, 「화상 인격의 3스킬」 only wants the
 * identity to burn somewhere. Saying both the same way would make 9215 and 9728 look identical
 * when they ask different things of the deck.
 */
export function triggerText(
  triggers: readonly SkillTrigger[],
  lang: Lang,
  attackNames: Record<AttackType, string>,
  keywordNames?: (keyword: IdentityKeywordId) => string,
): string {
  const parts: string[] = [];
  const push = (text: string): void => {
    if (text && !parts.includes(text)) parts.push(text);
  };
  for (const trigger of triggers) {
    if (trigger.keywords.length > 0 && keywordNames) {
      // 「또는 특수 충전」 is written 「충전(특수)」, the same shorthand the identity chips use.
      const names = trigger.keywords.map((keyword) =>
        trigger.includesSpecial
          ? t('skillsKeywordSpecial', lang, { keyword: keywordNames(keyword) })
          : keywordNames(keyword),
      );
      const keyword = names.join(t('skillsKeywordOr', lang));
      const verb = t(VERB_LABEL[trigger.verb], lang);
      const slots = trigger.slots.join(',');
      push(
        trigger.subject === 'identity'
          ? t('skillsTriggerKeywordIdentity', lang, { keyword, verb, slots })
          : t('skillsTriggerKeywordSkill', lang, { keyword, verb, slots }),
      );
      continue;
    }
    // The game says 「색욕 속성 스킬」 for a sin but 「참격 스킬」 for a type, and 「오만 관통 스킬」
    // when it narrows one by the other — so 속성 belongs only to a sin standing alone.
    const sin = trigger.sin
      ? trigger.attackType
        ? t(SIN_LABEL[trigger.sin], lang)
        : t('skillsSinSubject', lang, { sin: t(SIN_LABEL[trigger.sin], lang) })
      : null;
    const subject = [sin, trigger.attackType ? attackNames[trigger.attackType] : null].filter(Boolean).join(' ');
    if (!subject) continue;
    push(
      trigger.slots.length > 0
        ? t('skillsTriggerSlot', lang, { slots: trigger.slots.join(','), subject })
        : t('skillsTriggerAny', lang, { subject }),
    );
  }
  return parts.join(' · ');
}

/**
 * 「돈키호테 1스킬 / 히스클리프 1,2,3스킬」 — one entry per identity with its slots merged, because
 * repeating a name once per skill turns a three-skill identity into three chips saying the same.
 */
export function ownerText(
  skills: readonly SkillRef[],
  lang: Lang,
  identityName: (identityId: number) => { short: string; full: string },
): { text: string; title: string } {
  const slotsBy = new Map<number, number[]>();
  let alternate = false;
  for (const skill of skills) {
    if (skill.copies === 0) alternate = true;
    const seen = slotsBy.get(skill.identityId) ?? [];
    if (!seen.includes(skill.slot)) seen.push(skill.slot);
    slotsBy.set(skill.identityId, seen);
  }
  const entries = [...slotsBy.entries()].map(([identityId, slots]) => {
    const sorted = slots.sort((a, b) => a - b).join(',');
    const name = identityName(identityId);
    const suffix = t('skillsSlot', lang, { n: sorted });
    return { short: `${name.short} ${suffix}`, full: `${name.full} ${suffix}` };
  });
  // The line stays short; the hover text spells the identities out and warns when one of the
  // matching skills is an awakened or transformed form rather than the one always in the deck.
  const title = entries.map((entry) => entry.full).join(' / ') + (alternate ? ` · ${t('skillsAlt', lang)}` : '');
  return { text: entries.map((entry) => entry.short).join(' / '), title };
}
