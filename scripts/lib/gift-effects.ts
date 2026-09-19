/**
 * What kind of help a gift's effect is: 데미지 · 생존 · E.G.O 자원 · 버프 · 디버프.
 *
 * **Nothing in the game's own data answers this.** `ego-gift-mirrordungeon/*.json` carries the sin
 * colour, the keyword, the tier and the price, and its `tag` vocabulary is tier bookkeeping. So the
 * classification is derived, in two stages, from two different sources — and a hand-written
 * correction file sits above both.
 *
 * **The line that decides a bucket is who the effect lands on.** A stat or status the ally gains is
 * 버프; one inflicted on the enemy is 디버프; 데미지 is damage actually dealt. 「[공격 레벨 증가] 2
 * 얻음」 and 「적에게 [화상] 위력 3 부여」 both end in more damage, but a player picking gifts is
 * choosing between exactly those two things, so collapsing them into one bucket said nothing.
 *
 * **Stage 1, the labels, owns the answer.** The community mirror ships a curated, closed-vocabulary
 * `effects` list per gift (「Deal More Damage」, 「Heal HP」, 「Gain Buff」 …). `BUCKETS_BY_LABEL`
 * below maps each label to the buckets it means, and the table must be TOTAL: a label the mirror
 * ships and this table does not name is a build-time error, because the silent failure — a gift
 * quietly dropping out of every bucket and off the screen — is exactly what would otherwise happen.
 *
 * **Stage 2, the Korean text, is now only a safety net.** It runs solely for a gift stage 1 leaves
 * with no bucket at all, and reads the **bracketed buff names** the game writes, never prose: 89% of
 * the gifts with a skill trigger say 위력 or 피해량 somewhere in their prose, so a prose reading
 * would sort nearly all of them into one bucket and mean nothing. `[피해량 증가]` is a token, not a
 * turn of phrase. Since `Gain Buff` and `Inflict Debuff` now name real buckets, stage 2 fires on
 * **none** of the current season's 92 skill-trigger gifts; it is kept for the season that changes
 * that.
 *
 * Three calls worth stating out loud, each checked against the Korean text:
 *
 * - **`Gain Tremor Count` is 버프, not 디버프.** The name reads like the enemy status, but the text
 *   says 「**자신의** [진동] 횟수 증가」 (9164 흔들리는 술통) — the ally stacks it to spend. The
 *   enemy-facing one is `Inflict Tremor Count`.
 * - **`Gain Shield` is 생존, while `Gain Defense Level Up` is 버프.** 보호막 stops damage outright;
 *   a defence level is a stat the ally carries.
 * - **`Increase Enemy Resist` is no bucket at all.** It is a price the gift charges — 9280 본국검보
 *   hands the enemy 「참격 내성 +0.3」 — not a debuff it lands.
 */
import type { EffectBucket, Localized } from '../../src/core/schema.ts';
import { EFFECT_BUCKETS } from '../../src/core/schema.ts';
import { stripRichText } from '../../src/core/text.ts';

const DAMAGE: EffectBucket[] = ['damage'];
const SURVIVAL: EffectBucket[] = ['survival'];
const RESOURCE: EffectBucket[] = ['egoResource'];
const BUFF: EffectBucket[] = ['buff'];
const DEBUFF: EffectBucket[] = ['debuff'];
/** Named by the mirror but saying nothing about the kind of help, or a price the gift charges. */
const NONE: EffectBucket[] = [];

export const BUCKETS_BY_LABEL: Record<string, readonly EffectBucket[]> = {
  // 데미지 — damage actually dealt, however it is dealt.
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
  'Trigger Additional Burn': DAMAGE,
  'Trigger Additional Bleed': DAMAGE,
  'Trigger Tremor Burst': DAMAGE,
  'Trigger Amplitude Conversion/Entanglement': DAMAGE,
  // 생존 — the ally lives through what it could not otherwise.
  'Heal HP': SURVIVAL,
  'Heal SP': SURVIVAL,
  'Gain Shield': SURVIVAL,
  'Take Less Damage': SURVIVAL,
  // E.G.O 자원 — strictly the resource an E.G.O skill spends. 「Gain Cost」 is shop money.
  'Gain E.G.O Resource': RESOURCE,
  // 버프 — a stat or stack the ALLY gains.
  'Gain Skill Power': BUFF,
  'Gain Coin Power': BUFF,
  'Gain Offense Level Up': BUFF,
  'Gain Defense Level Up': BUFF,
  'Gain Speed / Haste': BUFF,
  'Gain Poise Potency': BUFF,
  'Gain Poise Count': BUFF,
  'Gain Charge Count': BUFF,
  'Gain Charge Potency': BUFF,
  'Gain Tremor Count': BUFF,
  'Gain Buff': BUFF,
  'Generate Bloodfeast': BUFF,
  // 디버프 — a status or penalty landed on the ENEMY.
  'Inflict Debuff': DEBUFF,
  'Inflict Offense Level Down': DEBUFF,
  'Inflict Defense Level Down': DEBUFF,
  'Inflict Burn Potency': DEBUFF,
  'Inflict Burn Count': DEBUFF,
  'Inflict Bleed Potency': DEBUFF,
  'Inflict Bleed Count': DEBUFF,
  'Inflict Rupture Potency': DEBUFF,
  'Inflict Rupture Count': DEBUFF,
  'Inflict Tremor Potency': DEBUFF,
  'Inflict Tremor Count': DEBUFF,
  'Inflict Sinking Potency': DEBUFF,
  'Inflict Sinking Count': DEBUFF,
  'Inflict Poise Potency': DEBUFF,
  'Reduce Speed / Bind': DEBUFF,
  'Reduce Skill Power': DEBUFF,
  // No bucket: says nothing about the kind of help, or is a cost rather than a gain.
  'Other Uncommon Effects': NONE,
  'Increase Enemy Resist': NONE,
  'Consume Charge': NONE,
  'Consume Bloodfeast': NONE,
  'Gain Cost': NONE,
  'Shop Discount': NONE,
  'Chance for Refund': NONE,
};

export const KNOWN_LABELS: ReadonlySet<string> = new Set(Object.keys(BUCKETS_BY_LABEL));

/**
 * Bracketed buff names, for a gift the labels leave undecided. Order matters only in that every
 * rule that matches contributes its bucket.
 */
const TEXT_RULES: { bucket: EffectBucket; pattern: RegExp }[] = [
  { bucket: 'damage', pattern: /피해를\s*(?:추가로\s*)?(?:입힘|입힌다)|고정\s*피해/ },
  {
    bucket: 'buff',
    pattern: /\[(?:[^\]]*\s)?(?:피해량|위력|공격 레벨|방어 레벨)[^\]]*증가\]|\[신속\]|\[충전\]|\[호흡\]/,
  },
  {
    bucket: 'survival',
    pattern: /\[체력[^\]]*회복\]|체력을\s*회복|\[보호\]|보호막|정신력[^.\n]{0,8}회복/,
  },
  { bucket: 'debuff', pattern: /적[^.\n]{0,20}\[[^\]]+\][^.\n]{0,12}부여|\[[^\]]*감소\][^.\n]{0,8}부여/ },
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
