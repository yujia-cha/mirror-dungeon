/**
 * The top of the 「전체 루트」 tab when the run has killed a fusion: an ingredient left 미획득 on a
 * floor already left means the result can no longer be fused, and the route below has been
 * re-planned without it.
 *
 * Each row is drawn as the recipe rather than told in a sentence: the missed ingredient (crossed
 * out) + the remaining ones → the result (crossed out), each icon with its name under it. The
 * result's name opens its gift sheet. The sentence is still there for a screen reader.
 *
 * The remaining ingredients are the one choice: on a fusion the player chose, the group is a single
 * toggle — pressed, the route keeps entering packs for them (`run.collectRest`); left alone, they
 * are given up with the fusion, which is the default once the run is under way. A bar under the
 * icons says which in words and a mark: 🚫「모으지 않기」 on a dashed box with dimmed icons, or a
 * filled ✓「모으기」 on a solid one.
 */
import type { ReactNode } from 'react';
import { ArrowRight, Ban, Check, Plus, TriangleAlert } from 'lucide-react';
import { withJosa } from '../format.ts';
import { t } from '../i18n.ts';
import type { LostFusion } from '../lib/fusion-lost.ts';
import { GiftIcon } from './GiftIcon.tsx';
import type { PackContext } from './PackSheet.tsx';
import { Card } from './ui.tsx';

export function FusionLostNotice({
  lost,
  ctx,
  onOpen,
  wanted,
  collectRest,
  onCollectRest,
}: {
  lost: LostFusion[];
  ctx: PackContext;
  onOpen: (giftId: number) => void;
  wanted: readonly number[];
  collectRest: readonly number[];
  onCollectRest: (giftId: number, on: boolean) => void;
}) {
  const { lang } = ctx;
  if (lost.length === 0) return null;
  /** An icon with its name under it; `onOpen` makes the name the gift sheet's button. */
  const icon = (id: number, props: { status?: 'failed'; dim?: boolean }, open?: () => void) => {
    const gift = ctx.indexes.giftById.get(id);
    if (!gift) return null;
    const name = ctx.giftName(id);
    const label = 'w-full break-keep text-center text-xs leading-tight text-fg';
    return (
      <span key={id} title={name} className="flex w-14 flex-col items-center gap-0.5" data-gift={id}>
        <GiftIcon gift={gift} size={32} lang={lang} {...props} />
        {open ? (
          <button
            type="button"
            onClick={open}
            className={`${label} font-medium underline-offset-2 hover:underline`}
          >
            {name}
          </button>
        ) : (
          <span className={label} data-testid="fusion-lost-name">
            {name}
          </span>
        )}
      </span>
    );
  };
  /** The + and → sit level with the icons, not with the names under them. */
  const sign = (glyph: ReactNode) => (
    <span className="flex h-8 items-center" aria-hidden>
      {glyph}
    </span>
  );
  return (
    <Card variant="strong" testId="fusion-lost">
      <div className="flex items-center gap-1.5 border-b border-line px-3 py-1.5 text-sm font-semibold">
        <TriangleAlert size={14} aria-hidden />
        {t('fusionLostTitle', lang)}
      </div>
      <ul>
        {lost.map((entry) => {
          const name = ctx.giftName(entry.result);
          const names = (ids: number[]) => ids.map(ctx.giftName).join(', ');
          const collecting = collectRest.includes(entry.result);
          const choosable = wanted.includes(entry.result) && entry.remaining.length > 0;
          const rest = entry.remaining.map((id) => icon(id, { dim: !collecting }));
          const sentence = [
            t('fusionLostText', lang, {
              missing: withJosa(names(entry.missing), '을/를', lang),
              result: withJosa(name, '을/를', lang),
            }),
            entry.dropped.length > 0
              ? t('unresolvedDropped', lang, { names: names(entry.dropped) })
              : collecting
                ? t('fusionLostKept', lang, { names: names(entry.remaining) })
                : '',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <li
              key={entry.result}
              className="flex flex-col gap-1.5 border-b border-line px-3 py-2.5 last:border-b-0"
              data-testid="fusion-lost-row"
              data-gift={entry.result}
            >
              <div className="flex flex-wrap items-start gap-1 text-fg-3" data-testid="fusion-lost-recipe">
                {entry.missing.map((id) => icon(id, { status: 'failed' }))}
                {rest.length > 0 ? sign(<Plus size={12} />) : null}
                {choosable ? (
                  <button
                    type="button"
                    onClick={() => onCollectRest(entry.result, !collecting)}
                    aria-pressed={collecting}
                    aria-label={t('fusionLostCollect', lang, { name })}
                    title={t('fusionLostCollect', lang, { name })}
                    data-testid="fusion-lost-collect"
                    className={`inline-flex flex-col items-stretch gap-1 rounded-md border p-1 ${
                      collecting
                        ? 'border-ink bg-surface-2'
                        : 'border-dashed border-line-control hover:bg-surface-2'
                    }`}
                  >
                    <span className="flex items-start gap-0.5">{rest}</span>
                    <span
                      className={`flex h-6 items-center justify-center gap-1 rounded-sm text-xs font-medium ${
                        collecting ? 'bg-ink text-ink-fg' : 'border border-line-control bg-surface text-fg-2'
                      }`}
                      data-testid="fusion-lost-collect-state"
                      aria-hidden
                    >
                      {collecting ? <Check size={13} /> : <Ban size={13} />}
                      {t(collecting ? 'fusionLostCollecting' : 'fusionLostNotCollecting', lang)}
                    </span>
                  </button>
                ) : (
                  rest
                )}
                {sign(<ArrowRight size={14} />)}
                {icon(entry.result, { status: 'failed' }, () => onOpen(entry.result))}
              </div>
              <span className="sr-only">{sentence}</span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
