/**
 * The 「스킬」 tab of the right panel: gifts whose effect keys off a SKILL's sin affinity or attack
 * type, and which of the deployed identities' skills set them off.
 *
 * Grouped by subject rather than by gift, because the subject is what the two halves of the answer
 * have in common. The identities that own 「분노 속성 스킬」 are the same for every gift that names
 * 분노, so naming them once in the group header and listing the gifts beneath says exactly as much
 * as repeating the list under all 88 gifts would — in a tenth of the space. A gift limited to one
 * slot (「참격 유형인 스킬 1」) is the exception and carries its own narrower chips.
 *
 * Nothing here is a run record, so the gifts are `GiftIcon`s rather than the pressable `GiftTile`:
 * pressing a tile writes `run.giftStatus`, and 「내 덱이 이 기프트에 반응한다」 is not a thing that
 * gets collected. Pressing the name opens the detail sheet `PlanProvider` hosts.
 */
import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Users } from 'lucide-react';
import type { AttackType, Gift, Sin, SkillTrigger } from '../../core/schema.ts';
import { ATTACK_TYPES, SINS } from '../../core/schema.ts';
import type { GiftSkillMatch, SkillRef } from '../../core/index.ts';
import { matchSkillTriggers, skillsOf } from '../../core/index.ts';
import { t } from '../i18n.ts';
import { pick } from '../i18n.ts';
import { SIN_LABEL } from '../lib/labels.ts';
import { useKeywordName } from '../lib/useEnums.ts';
import { GiftIcon } from '../components/GiftIcon.tsx';
import { Badge, Button, Card, Chip, Notice, SectionTitle } from '../components/ui.tsx';
import { usePlan } from './PlanContext.tsx';

/** A group is one sin or one attack type — the subject a gift's clause names. */
type Subject = { kind: 'sin'; id: Sin } | { kind: 'attackType'; id: AttackType };

const SUBJECTS: Subject[] = [
  ...SINS.map((id): Subject => ({ kind: 'sin', id })),
  ...ATTACK_TYPES.map((id): Subject => ({ kind: 'attackType', id })),
];

function subjectOf(trigger: SkillTrigger): Subject | null {
  // A trigger naming both (「오만 관통 스킬」) files under its sin; the attack type narrows it, and
  // the row's own chips still show only the skills that satisfy both.
  if (trigger.sin) return { kind: 'sin', id: trigger.sin };
  if (trigger.attackType) return { kind: 'attackType', id: trigger.attackType };
  return null;
}

function skillHas(skill: SkillRef, subject: Subject): boolean {
  return subject.kind === 'sin' ? skill.sin === subject.id : skill.attackType === subject.id;
}

interface Row {
  gift: Gift;
  triggers: SkillTrigger[];
  /** The skills of this group that this gift's triggers actually accept. */
  skills: SkillRef[];
  /** True when every trigger in this group is only a strengthening. */
  boostOnly: boolean;
  /** Slots this group's triggers are limited to, if any. */
  slots: number[];
}

interface Group {
  subject: Subject;
  owners: SkillRef[];
  rows: Row[];
}

export function SkillGiftsPanel({ onOpenDeck }: { onOpenDeck?: () => void }) {
  const { data, indexes, stats, lang, judgements, giftTitle, ctx, openGift } = usePlan();
  const [open, setOpen] = useState(false);

  const { skills, unknownSkillIdentities } = useMemo(
    () => skillsOf(stats.deployed, indexes),
    [stats.deployed, indexes],
  );
  const matches = useMemo(() => matchSkillTriggers(data.gifts, skills), [data.gifts, skills]);
  const groups = useMemo(() => buildGroups(matches, skills, indexes), [matches, skills, indexes]);

  const giftCount = new Set(groups.flatMap((g) => g.rows.map((r) => r.gift.id))).size;

  return (
    <div className="flex flex-col gap-3" data-testid="skills-panel">
      <Card className="overflow-hidden" testId="skills-about">
        <button
          type="button"
          onClick={() => setOpen((shown) => !shown)}
          aria-expanded={open}
          className="flex h-9 w-full items-center justify-between px-3 text-left"
        >
          <span className="text-sm font-semibold">{t('skillsAbout', lang)}</span>
          <span className="text-fg-3">{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
        </button>
        {open ? (
          <div className="flex flex-col gap-1.5 border-t border-line px-3 py-2.5 text-xs leading-relaxed text-fg-2">
            <p>{t('skillsAboutRead', lang)}</p>
            <p>{t('skillsAboutEffect', lang)}</p>
            <p>{t('skillsAboutLimits', lang)}</p>
            <p>{t('skillsAboutScope', lang)}</p>
          </div>
        ) : null}
      </Card>

      {stats.deployed.length === 0 ? (
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
      ) : (
        <>
          <div className="px-0.5 text-xs text-fg-3" data-testid="skills-summary">
            {t('skillsSummary', lang, { n: giftCount, m: stats.deployed.length })}
          </div>
          {unknownSkillIdentities.length > 0 ? (
            <Notice>{t('skillsUnknown', lang, { n: unknownSkillIdentities.length })}</Notice>
          ) : null}
          {groups.length === 0 ? (
            <Card className="px-4 py-6 text-center text-sm text-fg-2" testId="skills-none">
              {t('skillsNone', lang)}
            </Card>
          ) : (
            groups.map((group) => (
              <SubjectGroup
                key={`${group.subject.kind}:${group.subject.id}`}
                group={group}
                lang={lang}
                judgements={judgements}
                giftTitle={giftTitle}
                needed={ctx.needed}
                openGift={openGift}
                identityLabel={(id) => identityLabel(id, indexes, lang)}
              />
            ))
          )}
        </>
      )}
    </div>
  );
}

/** 「오티스」 — the sinner's name, which is unique inside a deck and fits a narrow panel. */
function identityLabel(
  identityId: number,
  indexes: ReturnType<typeof usePlan>['indexes'],
  lang: ReturnType<typeof usePlan>['lang'],
): { short: string; full: string } {
  const identity = indexes.identityById.get(identityId);
  if (!identity) return { short: String(identityId), full: String(identityId) };
  const sinner = pick(identity.sinner, lang);
  return { short: sinner, full: `${pick(identity.title, lang)} ${sinner}` };
}

function buildGroups(
  matches: GiftSkillMatch[],
  skills: SkillRef[],
  indexes: ReturnType<typeof usePlan>['indexes'],
): Group[] {
  const rowsBySubject = new Map<string, Row[]>();
  for (const match of matches) {
    const gift = indexes.giftById.get(match.giftId);
    if (!gift) continue;
    const bySubject = new Map<string, SkillTrigger[]>();
    for (const trigger of match.triggers) {
      const subject = subjectOf(trigger);
      if (!subject) continue;
      const key = `${subject.kind}:${subject.id}`;
      bySubject.set(key, [...(bySubject.get(key) ?? []), trigger]);
    }
    for (const [key, triggers] of bySubject) {
      const accepted = match.skills.filter((skill) =>
        triggers.some(
          (trigger) =>
            (trigger.sin === null || trigger.sin === skill.sin) &&
            (trigger.attackType === null || trigger.attackType === skill.attackType) &&
            (trigger.slots.length === 0 || trigger.slots.includes(skill.slot)),
        ),
      );
      if (accepted.length === 0) continue;
      rowsBySubject.set(key, [
        ...(rowsBySubject.get(key) ?? []),
        {
          gift,
          triggers,
          skills: accepted,
          boostOnly: triggers.every((trigger) => trigger.effect === 'boost'),
          slots: [...new Set(triggers.flatMap((trigger) => trigger.slots))].sort((a, b) => a - b),
        },
      ]);
    }
  }

  const groups: Group[] = [];
  for (const subject of SUBJECTS) {
    const rows = rowsBySubject.get(`${subject.kind}:${subject.id}`);
    if (!rows || rows.length === 0) continue;
    groups.push({
      subject,
      owners: skills.filter((skill) => skillHas(skill, subject)),
      // 발동 before 강화, then by id — a fixed order, so the panel never shuffles under the reader.
      rows: rows.sort(
        (a, b) => Number(a.boostOnly) - Number(b.boostOnly) || a.gift.id - b.gift.id,
      ),
    });
  }
  return groups;
}

function SubjectGroup({
  group,
  lang,
  judgements,
  giftTitle,
  needed,
  openGift,
  identityLabel: labelOf,
}: {
  group: Group;
  lang: ReturnType<typeof usePlan>['lang'];
  judgements: ReturnType<typeof usePlan>['judgements'];
  giftTitle: ReturnType<typeof usePlan>['giftTitle'];
  needed: ReadonlySet<number>;
  openGift: (giftId: number) => void;
  identityLabel: (identityId: number) => { short: string; full: string };
}) {
  const { subject } = group;
  const attackName = useKeywordName(subject.kind === 'attackType' ? subject.id : 'None', lang);
  const name = subject.kind === 'sin' ? t(SIN_LABEL[subject.id], lang) : attackName;
  const [shut, setShut] = useState(false);

  return (
    <Card className="overflow-hidden" testId="skill-group">
      <div data-subject={subject.id} data-testid="skill-group-body">
        <button
          type="button"
          onClick={() => setShut((closed) => !closed)}
          aria-expanded={!shut}
          className="flex w-full items-center justify-between gap-2 border-b border-line bg-surface-2 px-3 py-2 text-left"
        >
          <SectionTitle right={t('skillsGiftCount', lang, { n: group.rows.length })}>{name}</SectionTitle>
          <span className="text-fg-3">{shut ? <ChevronRight size={14} /> : <ChevronDown size={14} />}</span>
        </button>
        {shut ? null : (
          <>
            <div className="flex flex-wrap gap-1 px-3 py-2">
              {group.owners.map((skill) => (
                <SkillChip
                  key={`${skill.identityId}:${skill.slot}`}
                  skill={skill}
                  lang={lang}
                  label={labelOf(skill.identityId)}
                />
              ))}
            </div>
            <ul className="flex flex-col divide-y divide-line border-t border-line">
              {group.rows.map((row) => (
                <li
                  key={row.gift.id}
                  data-testid="skill-gift"
                  data-gift={row.gift.id}
                  data-effect={row.boostOnly ? 'boost' : 'gate'}
                  className="flex items-start gap-2 px-3 py-2"
                >
                  <GiftIcon
                    gift={row.gift}
                    size={20}
                    judgement={judgements.get(row.gift.id) ?? null}
                    title={giftTitle(row.gift.id)}
                    lang={lang}
                  />
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => openGift(row.gift.id)}
                        aria-haspopup="dialog"
                        className={`truncate text-left text-xs ${needed.has(row.gift.id) ? 'font-semibold text-fg' : 'text-fg-2'}`}
                      >
                        {pick(row.gift.name, lang)}
                      </button>
                      {/* Both quiet: the word carries the distinction. A `sure` badge would put a
                          check mark here, and a check mark means 「획득」 everywhere else. */}
                      <Badge tone="neutral">{t(row.boostOnly ? 'skillsBoost' : 'skillsGate', lang)}</Badge>
                    </div>
                    {row.slots.length > 0 ? (
                      <span
                        className="text-[11px] text-fg-3"
                        data-testid="skill-gift-slots"
                        data-slots={row.slots.join(',')}
                      >
                        {t('skillsSlotOnly', lang, {
                          list: row.slots.map((slot) => t('skillsSlot', lang, { n: slot })).join(', '),
                        })}
                      </span>
                    ) : null}
                    {/* Just the restriction. Why it is not judged is in the 「이 탭은 무엇인가요」
                        card, where it is said once and in reachable text, rather than on each of
                        the twenty rows that carry one. */}
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
          </>
        )}
      </div>
    </Card>
  );
}

function SkillChip({
  skill,
  lang,
  label,
}: {
  skill: SkillRef;
  lang: ReturnType<typeof usePlan>['lang'];
  label: { short: string; full: string };
}) {
  const slot = t('skillsSlot', lang, { n: skill.slot });
  const alt = skill.copies === 0 ? ` · ${t('skillsAlt', lang)}` : '';
  return (
    <span data-testid="skill-owner" data-identity={skill.identityId} data-slot={skill.slot}>
      <Chip
        title={`${label.full} · ${slot}${alt}`}
        className={skill.copies === 0 ? 'border-dashed' : ''}
      >
        <span aria-label={`${label.full} ${slot}`}>{`${label.short} ${slot}`}</span>
      </Chip>
    </span>
  );
}
