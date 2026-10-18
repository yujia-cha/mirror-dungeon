/**
 * A gift's description drawn effect by effect (M129): which effects the deployed party sets off
 * now, and — on a line of chips under each effect, always shown (M131) — which identity's which
 * skill does it.
 *
 * The text is split with core's `splitEffectBlocks`, the same split the build reads requirements
 * from, so the n-th block is `gift.effects[n]`. When the counts differ (a text the build trimmed)
 * the caller keeps the plain paragraph instead.
 *
 * Active: a 2px solid bar. Not active: a 1px dashed bar and the subtle ink, with the word read out
 * — never colour alone. Notes carry no bar and no chip line. Under the body, inside the bar, each
 * requirement is named and followed by one chip per identity that meets it (「이상 1.3」), a
 * dashed 「없음」 when nobody does, and 「n/m명」 when it asks for more than one; an effect that asks
 * nothing reads 「조건 없음」. A hint (M150) follows as 「참고: …」 with its chips, only when a deployed
 * identity has the skill — it is never why an effect is off.
 */
import type { EffectReport, GiftEffectsReport, RequirementReport } from '../../core/effects.ts';
import type { Enums, Identity } from '../../core/schema.ts';
import { splitHighlight } from '../../core/text.ts';
import { t, type Lang } from '../i18n.ts';
import { effectBlocksFor, requirementText, whoChips } from '../lib/effect-text.ts';
import { Chip } from './ui.tsx';

function Highlighted({ text }: { text: string }) {
  return (
    <>
      {splitHighlight(text).map((part, i) =>
        part.strong ? (
          <strong key={i} className="text-fg">
            {part.text}
          </strong>
        ) : (
          part.text
        ),
      )}
    </>
  );
}

/** One requirement: its name, then who meets it. An unmet name keeps the stronger ink — it is why. */
function RequirementWho({
  report,
  enums,
  identityById,
  lang,
}: {
  report: RequirementReport;
  enums: Enums;
  identityById: ReadonlyMap<number, Identity>;
  lang: Lang;
}) {
  const name = requirementText(report.requirement, enums, identityById, lang);
  const ego = report.requirement.type === 'egoSkill';
  const chips = whoChips(report, identityById, lang);
  return (
    <span className="inline-flex flex-wrap items-center gap-1" data-satisfied={report.satisfied}>
      <span className={`text-caption ${report.satisfied ? 'text-fg-subtle' : 'text-fg-muted'}`}>{name}</span>
      {ego ? (
        <span className="text-caption text-fg-subtle">{t('effNoCondition', lang)}</span>
      ) : chips.length === 0 ? (
        <Chip dashed>{t('effNone', lang)}</Chip>
      ) : (
        chips.map((chip) => (
          <Chip key={chip.id} title={chip.full} ariaLabel={chip.full}>
            {chip.label}
          </Chip>
        ))
      )}
      {!ego && report.need > 1 && (
        <span className="font-num text-caption text-fg-muted">
          {t('effCount', lang, { have: report.have, need: report.need })}
        </span>
      )}
    </span>
  );
}

/** A hint (M150): skills that help an effect without being asked for — drawn only when someone has one. */
function HintWho({
  report,
  enums,
  identityById,
  lang,
}: {
  report: RequirementReport;
  enums: Enums;
  identityById: ReadonlyMap<number, Identity>;
  lang: Lang;
}) {
  const name = requirementText(report.requirement, enums, identityById, lang);
  return (
    <span className="inline-flex flex-wrap items-center gap-1" data-testid="effect-hint">
      <span className="text-caption text-fg-subtle">{t('effReqHint', lang, { name })}</span>
      {whoChips(report, identityById, lang).map((chip) => (
        <Chip key={chip.id} title={chip.full} ariaLabel={chip.full}>
          {chip.label}
        </Chip>
      ))}
    </span>
  );
}

function WhoLine({
  effect,
  enums,
  identityById,
  lang,
}: {
  effect: EffectReport;
  enums: Enums;
  identityById: ReadonlyMap<number, Identity>;
  lang: Lang;
}) {
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1" data-testid="effect-who">
      {effect.requirements.length === 0 ? (
        <span className="text-caption text-fg-subtle">{t('effNoCondition', lang)}</span>
      ) : (
        effect.requirements.map((r, j) => (
          <RequirementWho key={j} report={r} enums={enums} identityById={identityById} lang={lang} />
        ))
      )}
      {effect.hints
        .filter((h) => h.have > 0)
        .map((h, j) => (
          <HintWho key={`h${j}`} report={h} enums={enums} identityById={identityById} lang={lang} />
        ))}
    </div>
  );
}

export function EffectLines({
  text,
  report,
  enums,
  identityById,
  lang,
}: {
  /** The description as shown — base or the chosen enhancement step, in the current language. */
  text: string;
  report: GiftEffectsReport;
  enums: Enums;
  identityById: ReadonlyMap<number, Identity>;
  lang: Lang;
}) {
  const blocks = effectBlocksFor(text, report)!;
  const lines = text.split('\n');
  return (
    <div className="flex flex-col gap-1 text-body" data-testid="gift-desc">
      {blocks.map((block, i) => {
        const effect = report.effects[i]!;
        const body = block.lines.map((n) => lines[n]).join('\n');
        const gap = i > 0 && block.paragraph !== blocks[i - 1]!.paragraph ? 'mt-2' : '';
        if (effect.kind === 'note')
          return (
            <p key={i} className={`whitespace-pre-line pl-3 text-fg-subtle ${gap}`} data-effect="note">
              <Highlighted text={body} />
            </p>
          );
        // A gate is drawn like an effect: it is open when every requirement it names is met.
        const active = effect.kind === 'gate' ? effect.requirements.every((r) => r.satisfied) : effect.usable;
        return (
          <div
            key={i}
            className={`pl-3 ${
              active
                ? 'border-l-2 border-success text-fg-muted'
                : 'border-l border-dashed border-border-strong text-fg-subtle'
            } ${gap}`}
            data-effect={effect.kind}
            data-active={active}
          >
            <p className="whitespace-pre-line">
              <Highlighted text={body} />
              <span className="sr-only"> ({t(active ? 'effActive' : 'effInactive', lang)})</span>
            </p>
            <WhoLine effect={effect} enums={enums} identityById={identityById} lang={lang} />
          </div>
        );
      })}
    </div>
  );
}
