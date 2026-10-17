/**
 * A gift's description drawn effect by effect (M129): which effects the deployed party sets off
 * now, and — on hover, focus or tap — which identity's which skill does it.
 *
 * The text is split with core's `splitEffectBlocks`, the same split the build reads requirements
 * from, so the n-th block is `gift.effects[n]`. When the counts differ (a text the build trimmed)
 * the caller keeps the plain paragraph instead.
 *
 * Active: a 2px solid bar. Not active: a 1px dashed bar and the subtle ink, with the word read out
 * — never colour alone. Notes carry no bar.
 */
import { useId } from 'react';
import type { GiftEffectsReport } from '../../core/effects.ts';
import type { Enums, Identity } from '../../core/schema.ts';
import { splitHighlight } from '../../core/text.ts';
import { t, type Lang } from '../i18n.ts';
import { effectBlocksFor, requirementText, whoText } from '../lib/effect-text.ts';

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
  const baseId = useId();
  const blocks = effectBlocksFor(text, report)!;
  const lines = text.split('\n');
  return (
    <div className="flex flex-col gap-1 text-caption" data-testid="gift-desc">
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
        const tipId = `${baseId}-${i}`;
        return (
          <div
            key={i}
            // Focusable so a keyboard and a tap reach the same note a mouse gets on hover.
            tabIndex={0}
            className={`group relative rounded-xs outline-offset-2 focus-visible:outline-2 focus-visible:outline-focus ${gap}`}
            data-effect={effect.kind}
            data-active={active}
            aria-describedby={tipId}
          >
            <p
              className={`whitespace-pre-line pl-3 ${
                active
                  ? 'border-l-2 border-success text-fg-muted'
                  : 'border-l border-dashed border-border-strong text-fg-subtle'
              }`}
            >
              <Highlighted text={body} />
              <span className="sr-only"> ({t(active ? 'effActive' : 'effInactive', lang)})</span>
            </p>
            <div
              id={tipId}
              role="tooltip"
              className="absolute left-3 top-full z-10 mt-1 hidden w-max max-w-full flex-col gap-0.5 rounded-md border border-border bg-surface px-2 py-1.5 text-caption text-fg shadow-md group-focus-within:flex group-hover:flex"
              data-testid="effect-who"
            >
              {effect.requirements.length === 0 ? (
                <span>{t('effNoCondition', lang)}</span>
              ) : (
                effect.requirements.map((r, j) => (
                  <span key={j} className={r.satisfied ? '' : 'text-fg-muted'}>
                    {t('effWho', lang, {
                      req: requirementText(r.requirement, enums, identityById, lang),
                      who: whoText(r, identityById, lang),
                    })}
                  </span>
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
