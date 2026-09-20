/**
 * The 「스킬」 tab of the right panel: gifts whose effect keys off a SKILL's sin affinity or attack
 * type, and which of the deployed identities' skills set them off.
 *
 * Each gift carries tags on two axes — **발동/강화** (does the skill make the effect happen, or
 * only sharpen it) and **계열** (데미지 · 생존 · E.G.O 자원 · 버프 · 디버프) — and the reader picks
 * tags rather than walking a fixed tree. Within a row the tags are ORed, across the two rows ANDed,
 * and an empty row means that axis is unconstrained, so turning everything off shows every gift.
 * The panel opens on **발동 + 데미지**, which is the question most decks start with.
 *
 * A gift that helps two ways appears under each of its 계열, so a reader looking for survivability
 * does not miss 잿빛 코트 for dealing damage as well; its own tag row then says where else it sits.
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
import type { IdentityKeywordId } from '../../core/schema.ts';
import { ATTACK_TYPES, EFFECT_BUCKETS, IDENTITY_KEYWORDS } from '../../core/schema.ts';
import type { SkillRef } from '../../core/index.ts';
import { evaluateConditions, matchSkillTriggers, skillsOf, triggerMatches } from '../../core/index.ts';
import { pick, t } from '../i18n.ts';
import type { Lang } from '../i18n.ts';
import { BUCKET_LABEL } from '../lib/labels.ts';
import { judgementsByGift } from '../lib/judgement.ts';
import { ownerText, triggerText } from '../lib/skill-lines.ts';
import { useEnums } from '../lib/useEnums.ts';
import { keywordName } from '../format.ts';
import { GiftIcon } from '../components/GiftIcon.tsx';
import { Badge, Button, Card, Notice, TagToggles } from '../components/ui.tsx';
import { usePlan } from './PlanContext.tsx';

interface Row {
  gift: Gift;
  /** The triggers some deployed skill satisfies, in the gift's own order. */
  triggers: SkillTrigger[];
  /** The skills that satisfied them. */
  skills: SkillRef[];
  buckets: EffectBucket[];
}

/** An empty tag row means "no constraint", which is how turning every tag off shows everything. */
function passes<T>(selected: ReadonlySet<T>, has: (value: T) => boolean): boolean {
  if (selected.size === 0) return true;
  for (const value of selected) if (has(value)) return true;
  return false;
}

export function SkillGiftsPanel({ onOpenDeck }: { onOpenDeck?: () => void }) {
  const { data, indexes, stats, lang, judgements, giftTitle, giftName, openGift } = usePlan();
  const enums = useEnums();
  const [buckets, setBuckets] = useState<ReadonlySet<EffectBucket>>(new Set<EffectBucket>(['damage']));
  const [folded, setFolded] = useState<Partial<Record<EffectBucket, boolean>>>({});

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
      // Only what a skill makes HAPPEN. A gift whose every trigger merely sharpens an effect the
      // deck would get anyway (「효과가 강화되어」) answers a different question from 「무엇이 내
      // 스킬 때문에 켜지나」, and mixing the two buried the answer among 28 near-misses.
      const triggers = match.triggers.filter((trigger) => trigger.effect === 'gate');
      if (triggers.length === 0) continue;
      // And the two lines must describe those triggers alone. `match.skills` is flat across every
      // trigger the gift has, so on 9098 복주머니 — 「우울 속성 스킬」 (강화) beside 「[호흡]…인격이
      // 사용하는 스킬 3」 (발동) — it would name 우울 identities under a 호흡 heading.
      const skills = match.skills.filter((skill) =>
        triggers.some((trigger) => triggerMatches(trigger, skill)),
      );
      out.push({ gift, triggers, skills, buckets: gift.effectBuckets });
    }
    return out;
  }, [matches, indexes, unmet]);

  // A tag's count is what picking it would actually give you — with one axis left, that is simply
  // how many gifts carry it.
  const bucketOptions = EFFECT_BUCKETS.map((bucket) => ({
    value: bucket,
    label: t(BUCKET_LABEL[bucket], lang),
    count: rows.filter((row) => row.buckets.includes(bucket)).length,
  }));

  const shown = rows.filter((row) => passes(buckets, (b) => row.buckets.includes(b)));
  // Only the 계열 the reader asked for get a section; with the row empty, every one that has gifts.
  const sections = EFFECT_BUCKETS.filter(
    (bucket) => (buckets.size === 0 || buckets.has(bucket)) && shown.some((row) => row.buckets.includes(bucket)),
  );

  const toggle = <T,>(set: ReadonlySet<T>, value: T): ReadonlySet<T> => {
    const next = new Set(set);
    if (!next.delete(value)) next.add(value);
    return next;
  };

  // The three attack-type names, resolved once: `useKeywordName` is a hook and cannot run per row.
  const attackNames = useMemo(() => {
    const out = {} as Record<AttackType, string>;
    for (const id of ATTACK_TYPES) out[id] = enums ? keywordName(id, enums, lang) : id;
    return out;
  }, [enums, lang]);

  // Keyword display names come from the enums like the attack types do, never from i18n: they are
  // game names, and the season file is what knows them.
  const keywordNames = useMemo(() => {
    const out = {} as Record<IdentityKeywordId, string>;
    for (const id of IDENTITY_KEYWORDS) out[id] = enums ? keywordName(id as never, enums, lang) : id;
    return (keyword: IdentityKeywordId): string => out[keyword] ?? keyword;
  }, [enums, lang]);

  // Faction display names come from the enums too — a 소속 is a game name, never an i18n string.
  const factionNames = useMemo(() => {
    const out = new Map<string, string>(
      (enums?.factions ?? []).map((faction) => [faction.id, pick(faction.name, lang)]),
    );
    return (faction: string): string => out.get(faction) ?? faction;
  }, [enums, lang]);

  const identityName = (identityId: number): { short: string; full: string } => {
    const identity = indexes.identityById.get(identityId);
    if (!identity) return { short: String(identityId), full: String(identityId) };
    const sinner = pick(identity.sinner, lang);
    return { short: sinner, full: `${pick(identity.title, lang)} ${sinner}` };
  };

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
      <div data-axis="bucket">
        <TagToggles
          label={t('skillsTagsBucket', lang)}
          options={bucketOptions}
          selected={buckets}
          onToggle={(value) => setBuckets((set) => toggle(set, value))}
          testId="skills-tags"
        />
      </div>
      <div className="px-0.5 text-xs text-fg-3" data-testid="skills-summary">
        {t('skillsSummary', lang, { n: shown.length, m: stats.deployed.length })}
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
      ) : shown.length === 0 ? (
        <Card className="flex flex-col items-center gap-2.5 px-4 py-6 text-center" testId="skills-none-tagged">
          <div className="text-sm text-fg-2">{t('skillsNoneTagged', lang)}</div>
          <Button
            variant="secondary"
            onClick={() => setBuckets(new Set())}
          >
            {t('skillsClearTags', lang)}
          </Button>
        </Card>
      ) : (
        sections.map((bucket) => (
          <BucketSection
            key={bucket}
            bucket={bucket}
            rows={shown.filter((row) => row.buckets.includes(bucket))}
            folded={folded[bucket] ?? false}
            onToggle={() => setFolded((state) => ({ ...state, [bucket]: !(state[bucket] ?? false) }))}
            lang={lang}
            attackNames={attackNames}
            keywordNames={keywordNames}
            factionNames={factionNames}
            judgements={judgements}
            giftTitle={giftTitle}
            openGift={openGift}
            identityName={identityName}
          />
        ))
      )}
    </div>
  );
}

function BucketSection({
  bucket,
  rows,
  folded,
  onToggle,
  lang,
  attackNames,
  keywordNames,
  factionNames,
  judgements,
  giftTitle,
  openGift,
  identityName,
}: {
  bucket: EffectBucket;
  rows: Row[];
  folded: boolean;
  onToggle: () => void;
  lang: Lang;
  attackNames: Record<AttackType, string>;
  keywordNames: (keyword: IdentityKeywordId) => string;
  factionNames: (faction: string) => string;
  judgements: ReturnType<typeof usePlan>['judgements'];
  giftTitle: ReturnType<typeof usePlan>['giftTitle'];
  openGift: (giftId: number) => void;
  identityName: (identityId: number) => { short: string; full: string };
}) {
  return (
    <Card className="overflow-hidden" testId="skills-bucket">
      <div data-bucket={bucket}>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!folded}
          className="flex h-9 w-full items-center justify-between border-b border-line bg-surface-2 px-3 text-left"
        >
          <span className="flex items-center gap-2 text-sm font-semibold">
            {t(BUCKET_LABEL[bucket], lang)}
            <span className="font-num text-xs text-fg-3">{rows.length}</span>
          </span>
          <span className="text-fg-3">{folded ? <ChevronRight size={14} /> : <ChevronDown size={14} />}</span>
        </button>
        {folded ? null : (
          <ul className="flex flex-col divide-y divide-line">
            {[...rows]
              .sort((a, b) => a.gift.id - b.gift.id)
              .map((row) => (
                <GiftRow
                  key={row.gift.id}
                  row={row}
                  bucket={bucket}
                  lang={lang}
                  attackNames={attackNames}
                  keywordNames={keywordNames}
                  factionNames={factionNames}
                  judgement={judgements.get(row.gift.id) ?? null}
                  title={giftTitle(row.gift.id)}
                  openGift={openGift}
                  identityName={identityName}
                />
              ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

function GiftRow({
  row,
  bucket,
  lang,
  attackNames,
  keywordNames,
  factionNames,
  judgement,
  title,
  openGift,
  identityName,
}: {
  row: Row;
  bucket: EffectBucket;
  lang: Lang;
  attackNames: Record<AttackType, string>;
  keywordNames: (keyword: IdentityKeywordId) => string;
  factionNames: (faction: string) => string;
  judgement: ReturnType<typeof usePlan>['judgements'] extends Map<number, infer V> ? V : never;
  title: string | undefined;
  openGift: (giftId: number) => void;
  identityName: (identityId: number) => { short: string; full: string };
}) {
  const owners = ownerText(row.skills, lang, identityName);
  return (
    <li
      data-testid="skill-gift"
      data-gift={row.gift.id}
      data-bucket={bucket}
      data-buckets={row.buckets.join(',')}
      className="flex items-start gap-2 px-3 py-2"
    >
      <GiftIcon gift={row.gift} size={20} judgement={judgement} title={title} lang={lang} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => openGift(row.gift.id)}
            aria-haspopup="dialog"
            className="truncate text-left text-xs font-medium text-fg"
          >
            {pick(row.gift.name, lang)}
          </button>
          {/* Its own tags, so a gift listed under two 계열 says where else it sits. */}
          <span className="flex flex-wrap gap-1" data-testid="skill-gift-tags">
            {row.buckets.map((other) => (
              <Badge key={other} tone="neutral">
                {t(BUCKET_LABEL[other], lang)}
              </Badge>
            ))}
          </span>
        </div>
        <span className="text-[11px] text-fg-2" data-testid="skill-gift-trigger">
          {triggerText(row.triggers, lang, attackNames, keywordNames, factionNames)}
        </span>
        <span
          className="text-[11px] text-fg-3"
          data-testid="skill-gift-owners"
          data-identities={[...new Set(row.skills.map((skill) => skill.identityId))].join(',')}
          title={owners.title}
        >
          {owners.text}
        </span>
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
  );
}
