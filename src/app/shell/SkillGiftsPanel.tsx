/**
 * The 「스킬」 tab of the right panel: gifts whose effect keys off a SKILL's sin affinity or attack
 * type, and which of the deployed identities' skills set them off.
 *
 * One row per gift, two short lines: what sets the gift off, and whose skills do. 발동 (the skill
 * is what makes the effect happen) comes first and open; 강화 (it happens anyway, and such a skill
 * makes it stronger) sits folded underneath, because it is the weaker news. Inside each, the gifts
 * are sorted into 데미지 · 생존 · E.G.O 자원 — a gift that helps two ways appears under both, which
 * is why a reader looking for survivability does not miss 잿빛 코트 for dealing damage as well.
 *
 * A gift with an activation condition the deck cannot meet is left out entirely: 본국검보 grants its
 * 참격 buffs only with 검계 3인 이상, and listing it for a deck without them would be a false
 * promise. How many were dropped is said, so nothing vanishes silently. A condition the deck cannot
 * be judged against (완전 공명) is never grounds for hiding.
 *
 * Nothing here is a run record, so the gifts are `GiftIcon`s rather than the pressable `GiftTile`:
 * pressing a tile writes `run.giftStatus`, and 「내 덱이 이 기프트에 반응한다」 is not a thing that
 * gets collected. Pressing the name opens the detail sheet `PlanProvider` hosts.
 */
import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Users } from 'lucide-react';
import type { AttackType, EffectBucket, Gift, SkillTrigger } from '../../core/schema.ts';
import { ATTACK_TYPES, EFFECT_BUCKETS } from '../../core/schema.ts';
import type { SkillRef } from '../../core/index.ts';
import { evaluateConditions, matchSkillTriggers, skillsOf } from '../../core/index.ts';
import { pick, t } from '../i18n.ts';
import type { Lang, StringKey } from '../i18n.ts';
import { BUCKET_LABEL } from '../lib/labels.ts';
import { judgementsByGift } from '../lib/judgement.ts';
import { ownerText, triggerText } from '../lib/skill-lines.ts';
import { useEnums } from '../lib/useEnums.ts';
import { keywordName } from '../format.ts';
import { GiftIcon } from '../components/GiftIcon.tsx';
import { Button, Card, Notice } from '../components/ui.tsx';
import { usePlan } from './PlanContext.tsx';

/** 발동 before 강화: what a skill makes happen beats what it merely sharpens. */
const EFFECTS = ['gate', 'boost'] as const;
type Effect = (typeof EFFECTS)[number];

const EFFECT_LABEL: Record<Effect, StringKey> = { gate: 'skillsGate', boost: 'skillsBoost' };

interface Row {
  gift: Gift;
  /** The triggers some deployed skill satisfies, in the gift's own order. */
  triggers: SkillTrigger[];
  /** The skills that satisfied them. */
  skills: SkillRef[];
  effect: Effect;
}

export function SkillGiftsPanel({ onOpenDeck }: { onOpenDeck?: () => void }) {
  const { data, indexes, stats, lang, judgements, giftTitle, giftName, openGift } = usePlan();
  const enums = useEnums();
  const [folded, setFolded] = useState<Record<Effect, boolean>>({ gate: false, boost: true });

  const { skills, unknownSkillIdentities } = useMemo(
    () => skillsOf(stats.deployed, indexes),
    [stats.deployed, indexes],
  );
  const matches = useMemo(() => matchSkillTriggers(data.gifts, skills), [data.gifts, skills]);

  // `usePlan().judgements` only covers the gifts the route is chasing, so the tab judges its own.
  // At most a handful of gifts carry a condition, and all of them are countable thresholds.
  const unmet = useMemo(() => {
    const ids = matches
      .map((match) => match.giftId)
      .filter((id) => (indexes.giftById.get(id)?.conditions.length ?? 0) > 0);
    const byGift = judgementsByGift(evaluateConditions(ids, stats, indexes));
    return new Set([...byGift.entries()].filter(([, judgement]) => judgement === 'unmet').map(([id]) => id));
  }, [matches, stats, indexes]);

  const rows = useMemo(() => {
    const out: Row[] = [];
    for (const match of matches) {
      const gift = indexes.giftById.get(match.giftId);
      if (!gift || unmet.has(match.giftId)) continue;
      const effect: Effect = match.triggers.every((trigger) => trigger.effect === 'boost') ? 'boost' : 'gate';
      out.push({ gift, triggers: match.triggers, skills: match.skills, effect });
    }
    return out;
  }, [matches, indexes, unmet]);

  // The three attack-type names, resolved once: `useKeywordName` is a hook and cannot run per row.
  const attackNames = useMemo(() => {
    const out = {} as Record<AttackType, string>;
    for (const id of ATTACK_TYPES) out[id] = enums ? keywordName(id, enums, lang) : id;
    return out;
  }, [enums, lang]);

  if (stats.deployed.length === 0) {
    return (
      <div className="flex flex-col gap-3" data-testid="skills-panel">
        <Card className="flex flex-col items-center gap-2.5 px-4 py-8 text-center" testId="skills-empty">
          <Users size={28} className="text-fg-3" aria-hidden />
          <div className="text-sm font-semibold">{t('skillsDeployedEmpty', lang)}</div>
          <div className="text-xs text-fg-3">{t('skillsDeployedHint', lang)}</div>
          {onOpenDeck ? (
            <Button variant="primary" onClick={onOpenDeck}>
              {t('tabDeck', lang)}
            </Button>
          ) : null}
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-testid="skills-panel">
      <div className="px-0.5 text-xs text-fg-3" data-testid="skills-summary">
        {t('skillsSummary', lang, { n: rows.length, m: stats.deployed.length })}
      </div>
      {unknownSkillIdentities.length > 0 ? (
        <Notice>{t('skillsUnknown', lang, { n: unknownSkillIdentities.length })}</Notice>
      ) : null}
      {unmet.size > 0 ? (
        <div data-testid="skills-excluded" data-hidden={unmet.size}>
          <Notice>
            <span title={[...unmet].map((id) => giftName(id)).join(', ')}>
              {t('skillsExcluded', lang, { n: unmet.size })}
            </span>
          </Notice>
        </div>
      ) : null}
      {rows.length === 0 ? (
        <Card className="px-4 py-6 text-center text-sm text-fg-2" testId="skills-none">
          {t('skillsNone', lang)}
        </Card>
      ) : (
        EFFECTS.filter((effect) => rows.some((row) => row.effect === effect)).map((effect) => (
          <EffectSection
            key={effect}
            effect={effect}
            rows={rows.filter((row) => row.effect === effect)}
            folded={folded[effect]}
            onToggle={() => setFolded((state) => ({ ...state, [effect]: !state[effect] }))}
            lang={lang}
            attackNames={attackNames}
            judgements={judgements}
            giftTitle={giftTitle}
            openGift={openGift}
            identityName={(id) => identityNames(id, indexes, lang)}
          />
        ))
      )}
    </div>
  );
}

function OwnerLine({
  skills,
  lang,
  identityName,
}: {
  skills: readonly SkillRef[];
  lang: Lang;
  identityName: (identityId: number) => { short: string; full: string };
}) {
  const { text, title } = ownerText(skills, lang, identityName);
  return (
    <span
      className="text-[11px] text-fg-3"
      data-testid="skill-gift-owners"
      data-identities={[...new Set(skills.map((skill) => skill.identityId))].join(',')}
      title={title}
    >
      {text}
    </span>
  );
}

/** 「오티스」 for the line, the full 「거미집 중지 아비 오티스」 for the hover text. */
function identityNames(
  identityId: number,
  indexes: ReturnType<typeof usePlan>['indexes'],
  lang: Lang,
): { short: string; full: string } {
  const identity = indexes.identityById.get(identityId);
  if (!identity) return { short: String(identityId), full: String(identityId) };
  const sinner = pick(identity.sinner, lang);
  return { short: sinner, full: `${pick(identity.title, lang)} ${sinner}` };
}

function EffectSection({
  effect,
  rows,
  folded,
  onToggle,
  lang,
  attackNames,
  judgements,
  giftTitle,
  openGift,
  identityName,
}: {
  effect: Effect;
  rows: Row[];
  folded: boolean;
  onToggle: () => void;
  lang: Lang;
  attackNames: Record<AttackType, string>;
  judgements: ReturnType<typeof usePlan>['judgements'];
  giftTitle: ReturnType<typeof usePlan>['giftTitle'];
  openGift: (giftId: number) => void;
  identityName: (identityId: number) => { short: string; full: string };
}) {
  const gifts = new Set(rows.map((row) => row.gift.id));
  return (
    <Card className="overflow-hidden" testId="skills-section">
      <div data-effect={effect}>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!folded}
          className="flex h-9 w-full items-center justify-between border-b border-line bg-surface-2 px-3 text-left"
        >
          <span className="flex items-center gap-2 text-sm font-semibold">
            {t(EFFECT_LABEL[effect], lang)}
            <span className="font-num text-xs text-fg-3">{gifts.size}</span>
          </span>
          <span className="text-fg-3">{folded ? <ChevronRight size={14} /> : <ChevronDown size={14} />}</span>
        </button>
        {folded
          ? null
          : EFFECT_BUCKETS.filter((bucket) => rows.some((row) => row.gift.effectBuckets.includes(bucket))).map(
              (bucket) => (
                <BucketGroup
                  key={bucket}
                  bucket={bucket}
                  rows={rows.filter((row) => row.gift.effectBuckets.includes(bucket))}
                  effect={effect}
                  lang={lang}
                  attackNames={attackNames}
                  judgements={judgements}
                  giftTitle={giftTitle}
                  openGift={openGift}
                  identityName={identityName}
                />
              ),
            )}
      </div>
    </Card>
  );
}

function BucketGroup({
  bucket,
  rows,
  effect,
  lang,
  attackNames,
  judgements,
  giftTitle,
  openGift,
  identityName,
}: {
  bucket: EffectBucket;
  rows: Row[];
  effect: Effect;
  lang: Lang;
  attackNames: Record<AttackType, string>;
  judgements: ReturnType<typeof usePlan>['judgements'];
  giftTitle: ReturnType<typeof usePlan>['giftTitle'];
  openGift: (giftId: number) => void;
  identityName: (identityId: number) => { short: string; full: string };
}) {
  return (
    <div data-testid="skills-bucket" data-bucket={bucket} data-effect={effect}>
      <div className="flex items-center gap-2 border-b border-line px-3 py-1.5 text-xs font-medium text-fg-2">
        {t(BUCKET_LABEL[bucket], lang)}
        <span className="font-num text-fg-3">{rows.length}</span>
      </div>
      <ul className="flex flex-col divide-y divide-line">
        {[...rows]
          .sort((a, b) => a.gift.id - b.gift.id)
          .map((row) => (
            <li
              key={row.gift.id}
              data-testid="skill-gift"
              data-gift={row.gift.id}
              data-effect={effect}
              data-bucket={bucket}
              className="flex items-start gap-2 px-3 py-2"
            >
              <GiftIcon
                gift={row.gift}
                size={20}
                judgement={judgements.get(row.gift.id) ?? null}
                title={giftTitle(row.gift.id)}
                lang={lang}
              />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <button
                  type="button"
                  onClick={() => openGift(row.gift.id)}
                  aria-haspopup="dialog"
                  className="truncate text-left text-xs font-medium text-fg"
                >
                  {pick(row.gift.name, lang)}
                </button>
                <span className="text-[11px] text-fg-2" data-testid="skill-gift-trigger">
                  {triggerText(row.triggers, lang, attackNames)}
                </span>
                <OwnerLine skills={row.skills} lang={lang} identityName={identityName} />
                {row.gift.formationSlots.length > 0 ? (
                  <span
                    className="text-[11px] text-fg-3"
                    data-testid="skill-gift-formation"
                    data-formation={row.gift.formationSlots.join(',')}
                    title={t('skillsFormationHint', lang)}
                  >
                    {t('skillsFormationOnly', lang, { list: row.gift.formationSlots.join(', ') })}
                  </span>
                ) : null}
              </div>
            </li>
          ))}
      </ul>
    </div>
  );
}
