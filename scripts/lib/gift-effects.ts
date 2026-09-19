/**
 * What kind of help a gift's effect is: 데미지 · 생존 · E.G.O 자원.
 *
 * **Nothing in the game's own data answers this.** `ego-gift-mirrordungeon/*.json` carries the sin
 * colour, the keyword, the tier and the price, and its `tag` vocabulary is tier bookkeeping. So the
 * classification is derived, in two stages, from two different sources — and a hand-written
 * correction file sits above both.
 *
 * **Stage 1, the labels, owns the answer.** The community mirror ships a curated, closed-vocabulary
 * `effects` list per gift (「Deal More Damage」, 「Heal HP」, 「Gain E.G.O Resource」 …). It is a human
 * reading of what each gift does, it covers every gift the season ships, and `BUCKETS_BY_LABEL`
 * below maps each label to the buckets it belongs to. The table must be TOTAL: a label the mirror
 * ships and this table does not name is a build-time error, because the silent failure — a gift
 * quietly dropping out of every bucket and off the screen — is exactly what would otherwise happen.
 *
 * **Stage 2, the Korean text, owns only the residue.** A few labels are too coarse to decide
 * (`Gain Buff` covers 「[피해량 증가]」 and 「[보호]」 alike), so a gift that stage 1 leaves with no
 * bucket at all is read again — not as prose, but for the **bracketed buff names** the game writes.
 * That distinction is what makes it safe: 89% of the gifts with a skill trigger say 위력 or 피해량
 * somewhere in their prose, so a prose reading would put nearly all of them in 데미지 and mean
 * nothing. `[피해량 증가]` is a token, not a turn of phrase.
 *
 * Measured on the current season, stage 2 fires on three gifts — 9010 블러디 가젯, 9069 손목 보호대,
 * 9143 목공용 대못, all `Gain Buff`-only, all resolving to 데미지 off 「[피해량 증가]」.
 *
 * **What is deliberately not a bucket.** `Gain Buff`, `Inflict Debuff` and `Other Uncommon Effects`
 * name no kind of help; they hand the gift to stage 2. `Increase Enemy Resist` is a DRAWBACK a gift
 * pays, not survival it grants.
 */
import type { EffectBucket, Localized } from '../../src/core/schema.ts';
import { EFFECT_BUCKETS } from '../../src/core/schema.ts';
import { stripRichText } from '../../src/core/text.ts';

const DAMAGE: EffectBucket[] = ['damage'];
const SURVIVAL: EffectBucket[] = ['survival'];
const RESOURCE: EffectBucket[] = ['egoResource'];
/** Named by the mirror but saying nothing about the kind of help; stage 2 decides these. */
const UNDECIDED: EffectBucket[] = [];

/**
 * Every label the mirror ships, and the buckets it means. Two calls worth stating out loud:
 *
 * - **호흡 (Poise) is 데미지.** It is an offensive stack — it raises 공격 레벨 and 위력 — even
 *   though the English name reads defensive.
 * - **신속 and 충전 are 데미지.** Both are resources in the loose sense, but 자원 here means E.G.O
 *   자원 strictly; acting sooner and charging up are things a deck does to hit harder.
 */
export const BUCKETS_BY_LABEL: Record<string, readonly EffectBucket[]> = {
  // 데미지 — dealing it, or making a skill hit harder.
  'Deal More Damage': DAMAGE,
  'Deal Fixed Damage': DAMAGE,
  'Deal SP Damage': DAMAGE,
  'Deal Wrath Damage': DAMAGE,
  'Deal Lust Damage': DAMAGE,
  'Deal Sloth Damage': DAMAGE,
  'Deal Gluttony Damage': DAMAGE,
  'Deal Gloom Damage': DAMAGE,
  'Deal Pride Damage': DAMAGE,
  'Deal Envy Damage': DAMAGE,
  'Deal Blunt Damage': DAMAGE,
  'Deal Pierce Damage': DAMAGE,
  'Deal Slash Damage': DAMAGE,
  'Gain Skill Power': DAMAGE,
  'Gain Coin Power': DAMAGE,
  'Gain Offense Level Up': DAMAGE,
  'Gain Poise Potency': DAMAGE,
  'Gain Poise Count': DAMAGE,
  'Gain Speed / Haste': DAMAGE,
  'Gain Charge Count': DAMAGE,
  'Gain Charge Potency': DAMAGE,
  'Inflict Defense Level Down': DAMAGE,
  'Inflict Burn Potency': DAMAGE,
  'Inflict Burn Count': DAMAGE,
  'Inflict Bleed Potency': DAMAGE,
  'Inflict Bleed Count': DAMAGE,
  'Inflict Rupture Potency': DAMAGE,
  'Inflict Rupture Count': DAMAGE,
  'Inflict Tremor Potency': DAMAGE,
  'Inflict Tremor Count': DAMAGE,
  'Inflict Sinking Potency': DAMAGE,
  'Inflict Sinking Count': DAMAGE,
  'Inflict Poise Potency': DAMAGE,
  // 진동 횟수 is gained by the ally and spent to detonate, so it feeds 진동 폭발 damage.
  'Gain Tremor Count': DAMAGE,
  'Trigger Amplitude Conversion/Entanglement': DAMAGE,
  'Trigger Additional Burn': DAMAGE,
  'Trigger Additional Bleed': DAMAGE,
  'Trigger Tremor Burst': DAMAGE,
  'Reduce Skill Power': DAMAGE,
  'Generate Bloodfeast': DAMAGE,
  'Consume Bloodfeast': DAMAGE,
  // 생존 — staying alive, or making the enemy hit softer.
  'Heal HP': SURVIVAL,
  'Heal SP': SURVIVAL,
  'Gain Shield': SURVIVAL,
  'Take Less Damage': SURVIVAL,
  'Gain Defense Level Up': SURVIVAL,
  'Inflict Offense Level Down': SURVIVAL,
  'Reduce Speed / Bind': SURVIVAL,
  // E.G.O 자원 — strictly the resource an E.G.O skill spends.
  'Gain E.G.O Resource': RESOURCE,
  'Gain Cost': RESOURCE,
  // Says nothing about the kind of help, or is a price the gift charges.
  'Gain Buff': UNDECIDED,
  'Inflict Debuff': UNDECIDED,
  'Other Uncommon Effects': UNDECIDED,
  'Increase Enemy Resist': UNDECIDED,
  'Consume Charge': UNDECIDED,
  'Shop Discount': UNDECIDED,
  'Chance for Refund': UNDECIDED,
};

export const KNOWN_LABELS: ReadonlySet<string> = new Set(Object.keys(BUCKETS_BY_LABEL));

/** Bracketed buff names the game writes, for the gifts the labels leave undecided. */
const TEXT_RULES: { bucket: EffectBucket; pattern: RegExp }[] = [
  {
    bucket: 'damage',
    pattern: /\[(?:[^\]]*\s)?(?:피해량|위력|공격 레벨)[^\]]*증가\]|\[신속\]|\[충전\]|\[호흡\]/,
  },
  {
    bucket: 'survival',
    pattern: /\[체력[^\]]*회복\]|\[보호\]|\[방어 레벨[^\]]*증가\]|\[수비 위력[^\]]*증가\]|정신력[^.\n]{0,8}회복/,
  },
  { bucket: 'egoResource', pattern: /E\.G\.O 자원/ },
];

function sortBuckets(buckets: Iterable<EffectBucket>): EffectBucket[] {
  return [...new Set(buckets)].sort((a, b) => EFFECT_BUCKETS.indexOf(a) - EFFECT_BUCKETS.indexOf(b));
}

export interface GiftEffectResult {
  buckets: EffectBucket[];
  /** Which stage decided, for the build's summary and for the validator's rot checks. */
  stage: 'curated' | 'label' | 'text' | 'none';
}

export function classifyGiftEffects(input: {
  labels: readonly string[];
  desc: Localized;
  override?: readonly EffectBucket[];
}): GiftEffectResult {
  if (input.override) return { buckets: sortBuckets(input.override), stage: 'curated' };

  const fromLabels = sortBuckets(input.labels.flatMap((label) => BUCKETS_BY_LABEL[label] ?? []));
  if (fromLabels.length > 0) return { buckets: fromLabels, stage: 'label' };

  const ko = stripRichText(input.desc.ko ?? '');
  const fromText = sortBuckets(TEXT_RULES.filter((rule) => rule.pattern.test(ko)).map((rule) => rule.bucket));
  if (fromText.length > 0) return { buckets: fromText, stage: 'text' };

  return { buckets: [], stage: 'none' };
}

/** Labels the mirror ships that `BUCKETS_BY_LABEL` does not name — the rot check's input. */
export function unknownLabels(labels: Iterable<string>): string[] {
  return [...new Set([...labels].filter((label) => !KNOWN_LABELS.has(label)))].sort();
}
