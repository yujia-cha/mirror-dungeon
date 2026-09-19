/**
 * The two lines the 「스킬」 탭 writes under a gift's name: what sets it off, and whose skills do.
 *
 * Pure so they can be read at a glance and tested without a DOM. Game display names never come from
 * here — the caller resolves sins through `SIN_LABEL` and attack types through the enums, and hands
 * the results in.
 */
import type { AttackType, SkillTrigger } from '../../core/schema.ts';
import type { SkillRef } from '../../core/index.ts';
import { t } from '../i18n.ts';
import type { Lang } from '../i18n.ts';
import { SIN_LABEL } from './labels.ts';

/** 「참격 스킬」 · 「질투 속성 스킬」 · 「1스킬이 참격」 · 「오만 관통 스킬」, joined by ` · `. */
export function triggerText(
  triggers: readonly SkillTrigger[],
  lang: Lang,
  attackNames: Record<AttackType, string>,
): string {
  const parts: string[] = [];
  for (const trigger of triggers) {
    // The game says 「색욕 속성 스킬」 for a sin but 「참격 스킬」 for a type, and 「오만 관통 스킬」
    // when it narrows one by the other — so 속성 belongs only to a sin standing alone.
    const sin = trigger.sin
      ? trigger.attackType
        ? t(SIN_LABEL[trigger.sin], lang)
        : t('skillsSinSubject', lang, { sin: t(SIN_LABEL[trigger.sin], lang) })
      : null;
    const subject = [sin, trigger.attackType ? attackNames[trigger.attackType] : null].filter(Boolean).join(' ');
    if (!subject) continue;
    const text =
      trigger.slots.length > 0
        ? t('skillsTriggerSlot', lang, { slots: trigger.slots.join(','), subject })
        : t('skillsTriggerAny', lang, { subject });
    if (!parts.includes(text)) parts.push(text);
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
