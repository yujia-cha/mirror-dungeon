/**
 * The unresolved card below the map: gifts that fail for reasons other than a pack conflict
 * (those are the decision card's), with their per-gift controls — 「목표에서 빼기」 simply
 * removes it from the goals. The app makes no pack-level choice, so there is no list of packs here.
 */
import type { ReactNode } from 'react';
import { ChevronRight, Eye, TriangleAlert, X } from 'lucide-react';
import type { Unresolved } from '../../core/types.ts';
import { t } from '../i18n.ts';
import { UNRESOLVED_LABEL } from '../lib/labels.ts';
import type { UnresolvedAction } from '../lib/unresolved-actions.ts';
import { unresolvedDetailText } from '../lib/unresolved-text.ts';
import { GiftIcon } from './GiftIcon.tsx';
import type { PackContext } from './PackSheet.tsx';
import { Button, Card, Chip } from './ui.tsx';

export interface PackConflictsProps {
  /** Unresolved entries that are not pack conflicts — those are the decision card's. */
  others: Unresolved[];
  ctx: PackContext;
  /** Giving a gift up removes it from the selection. */
  removeWanted: (giftId: number) => void;
  /** Observation action for an entry, if one applies. */
  observeAction: (entry: Unresolved) => (UnresolvedAction & { label: string }) | undefined;
  headerActions: (UnresolvedAction & { label: string })[];
  onAction: (action: UnresolvedAction) => void;
}

export function PackConflicts({
  others,
  ctx,
  removeWanted,
  observeAction,
  headerActions,
  onAction,
}: PackConflictsProps) {
  const { lang } = ctx;
  if (others.length === 0) return null;

  const iconButton = (label: string, onClick: () => void, icon: ReactNode, pressed?: boolean) => (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      className={`inline-flex h-7 w-7 items-center justify-center rounded-full border ${pressed ? 'border-ink bg-ink text-ink-fg' : 'border-line bg-surface text-fg-2 hover:bg-surface-2'}`}
    >
      {icon}
    </button>
  );
  const detailText = (entry: Unresolved): string => unresolvedDetailText(entry, ctx.giftName, lang);

  return (
    <Card variant="strong" className="overflow-visible" testId="unresolved">
      <div className="flex min-h-9 flex-wrap items-center gap-1.5 border-b border-line px-3 py-1.5">
        <TriangleAlert size={14} aria-hidden />
        <span className="text-sm font-semibold">
          {t('routeUnresolved', lang)} <span className="font-num text-xs text-fg-3">{others.length}</span>
        </span>
        <span className="ml-auto flex flex-wrap gap-1.5">
          {headerActions.map((action) => (
            <Button key={action.label} size="sm" onClick={() => onAction(action)}>
              {action.label}
              <ChevronRight size={12} aria-hidden />
            </Button>
          ))}
        </span>
      </div>

      {others.length > 0 ? (
        <ul>
          {others.map((entry) => {
            const gift = ctx.indexes.giftById.get(entry.giftId);
            const observe = observeAction(entry);
            const name = ctx.giftName(entry.giftId);
            return (
              <li
                key={`${entry.giftId}-${entry.reason}`}
                className="flex items-start gap-2.5 border-b border-line px-3 py-2 last:border-b-0"
                data-testid="unresolved-row"
              >
                {gift ? (
                  <GiftIcon
                    gift={gift}
                    size={32}
                    judgement={ctx.judgements.get(entry.giftId) ?? null}
                    lang={lang}
                  />
                ) : null}
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{name}</span>
                    <Chip>{t(UNRESOLVED_LABEL[entry.reason], lang)}</Chip>
                  </div>
                  <span className="text-xs text-fg-2">{detailText(entry)}</span>
                </div>
                <span className="flex flex-none gap-1">
                  {observe ? iconButton(observe.label, () => onAction(observe), <Eye size={13} />) : null}
                  {iconButton(
                    t('removeFromSelection', lang, { name }),
                    () => removeWanted(entry.giftId),
                    <X size={13} />,
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </Card>
  );
}
