/**
 * The words for one effect's requirements in the gift sheet (M129): what it asks of the deck, and
 * which deployed identities — which of their skills — meet it. Pure; the sheet draws the lines.
 */
import { splitEffectBlocks } from '../../core/effect-blocks.ts';
import type { GiftEffectsReport, RequirementReport } from '../../core/effects.ts';
import type { EffectRequirement, Enums, Identity } from '../../core/schema.ts';
import { factionName, keywordName } from '../format.ts';
import { pick, t, type Lang, type StringKey } from '../i18n.ts';

const SHAPE_KEY: Record<string, StringKey> = {
  singleCoin: 'effReqSingleCoin',
  coinsAtMost: 'effReqCoinsAtMost',
  coinsAtLeast: 'effReqCoinsAtLeast',
  plusCoin: 'effReqPlusCoin',
  minusCoin: 'effReqMinusCoin',
  unbreakableCoin: 'effReqUnbreakable',
  weightAtLeast: 'effReqWeightAtLeast',
  weightExactly: 'effReqWeightExactly',
};

const DEFENSE_KEY: Record<string, StringKey> = {
  guard: 'effDefGuard',
  evade: 'effDefEvade',
  counter: 'effDefCounter',
};

function identityLabel(identity: Identity | undefined, id: number, lang: Lang): string {
  return identity ? `${pick(identity.title, lang)} ${pick(identity.sinner, lang)}` : String(id);
}

/** 「파열 스킬」, 「화상 스킬 3」, 「흑수 - 묘 소속」, 「오만 관통 스킬」 … */
export function requirementText(
  requirement: EffectRequirement,
  enums: Enums,
  identityById: ReadonlyMap<number, Identity>,
  lang: Lang,
): string {
  const list = (items: readonly string[]): string => items.join('·');
  switch (requirement.type) {
    case 'skillKeyword': {
      const keywords = list(requirement.keywords.map((k) => keywordName(k, enums, lang)));
      return requirement.slot
        ? t('effReqKeywordSlot', lang, { keywords, slot: requirement.slot })
        : t('effReqKeyword', lang, { keywords });
    }
    case 'selfKeyword': {
      const keywords = list(requirement.keywords.map((k) => keywordName(k, enums, lang)));
      return t(requirement.verb === 'gain' ? 'effReqSelfGain' : 'effReqSelfConsume', lang, { keywords });
    }
    case 'identityBuff':
      return t('effReqIdentityBuff', lang);
    case 'faction':
      return t('effReqFaction', lang, {
        factions: list(requirement.factions.map((f) => factionName(f, enums, lang))),
      });
    case 'identity':
      return t('effReqIdentity', lang, {
        names: list(requirement.ids.map((id) => identityLabel(identityById.get(id), id, lang))),
      });
    case 'skill':
      return t('effReqSkill', lang, {
        what: [
          list((requirement.sins ?? []).map((sin) => t(`sin${sin}` as StringKey, lang))),
          list((requirement.attackTypes ?? []).map((type) => keywordName(type, enums, lang))),
        ]
          .filter(Boolean)
          .join(' '),
      });
    case 'resonance':
      return t('effReqResonance', lang, {
        sins: list(requirement.sins.map((sin) => t(`sin${sin}` as StringKey, lang))),
      });
    case 'shape':
      return t(SHAPE_KEY[requirement.kind]!, lang, { n: requirement.n ?? '' });
    case 'defense':
      return t('effReqDefense', lang, {
        kinds: list(requirement.kinds.map((kind) => t(DEFENSE_KEY[kind]!, lang))),
      });
    case 'egoSkill':
      return t('effReqEgo', lang);
    case 'anyOf':
      return requirement.options
        .map((option) => requirementText(option, enums, identityById, lang))
        .join(lang === 'ko' ? ' 또는 ' : ' or ');
  }
}

/** 「LCB 수감자 이상 S1·S3, 홍루 S2」 — or 「없음」; with a count when a threshold above one is asked. */
export function whoText(
  report: RequirementReport,
  identityById: ReadonlyMap<number, Identity>,
  lang: Lang,
): string {
  if (report.requirement.type === 'egoSkill') return t('effNoCondition', lang);
  const who =
    report.matches.length === 0
      ? t('effNone', lang)
      : report.matches
          .map(({ id, slots }) => {
            const name = identityLabel(identityById.get(id), id, lang);
            return slots.length > 0 ? `${name} ${t('effSlot', lang, { slots: slots.join('·S') })}` : name;
          })
          .join(', ');
  return report.need > 1 ? `${who} (${t('effCount', lang, { have: report.have, need: report.need })})` : who;
}

/** The blocks of `text` if they line up with the report's effects, else null (draw it plain). */
export function effectBlocksFor(text: string, report: GiftEffectsReport | undefined) {
  if (!report || report.effects.length === 0) return null;
  const blocks = splitEffectBlocks(text);
  return blocks.length === report.effects.length ? blocks : null;
}
