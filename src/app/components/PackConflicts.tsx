/**
 * The pack side of the route's unresolved business.
 *
 * `PackConflictGroups` is the pack-level decision, made the way the game is played: a run of
 * contested floors and the packs competing for them, each with the gifts it would bring, to keep
 * or give up as a whole. It lives inside the 「포기 결정」 card (`RouteDecision`), folded under
 * 「팩으로 고르기」, because the gift-level rows there are the same decision from the other side.
 *
 * `PackConflicts` is what is left of the unresolved card below the map: gifts that fail for other
 * reasons, with their per-gift controls (giving one up simply removes it from the selection), and
 * the list of packs given up so they can be restored.
 */
import { useState, type ReactNode } from 'react';
import { ChevronRight, Eye, TriangleAlert, X } from 'lucide-react';
import type { ConflictGroup } from '../../core/conflicts.ts';
import type { Unresolved } from '../../core/types.ts';
import { t } from '../i18n.ts';
import { UNRESOLVED_LABEL } from '../lib/labels.ts';
import type { UnresolvedAction } from '../lib/unresolved-actions.ts';
import { unresolvedDetailText } from '../lib/unresolved-text.ts';
import { DetailSurface, type DetailMode } from './BlockDetail.tsx';
import { GiftIcon } from './GiftIcon.tsx';
import { PackCard } from './PackCard.tsx';
import { PackActions, PackSheetBody, PackStateBadge, type PackContext } from './PackSheet.tsx';
import { Button, Card, Chip } from './ui.tsx';

export function PackConflictGroups({
  groups,
  ctx,
  detailMode = 'sheet',
}: {
  groups: ConflictGroup[];
  ctx: PackContext;
  /** How a pack opens from a card; a sheet fits inside a narrow panel. */
  detailMode?: DetailMode;
}) {
  const { lang } = ctx;
  const [openPack, setOpenPack] = useState<number | null>(null);

  const packSheet = (packId: number): ReactNode =>
    openPack === packId ? (
      <DetailSurface
        mode={detailMode}
        label={ctx.packName(packId)}
        closeLabel={t('routeClose', lang)}
        onClose={() => setOpenPack(null)}
      >
        <PackSheetBody packId={packId} ctx={ctx} />
      </DetailSurface>
    ) : null;

  return (
    <>
      {groups.map((group) => {
        const from = group.floors[0]!;
        const to = group.floors[group.floors.length - 1]!;
        return (
          <div
            key={from}
            className="flex flex-col gap-2 border-b border-line px-3 py-2.5 last:border-b-0"
            data-testid="conflict-group"
            data-from={from}
            data-to={to}
          >
            <div className="flex flex-wrap items-center gap-2">
              <Chip on>{`${from}~${to}`}</Chip>
              <span className="text-sm font-semibold">
                {t('conflictHeader', lang, {
                  from,
                  to,
                  slots: group.floors.length,
                  packs: group.candidates.length,
                })}
              </span>
            </div>
            <ul className="grid grid-cols-1 gap-2">
              {group.candidates.map((candidate) => {
                const pack = ctx.indexes.packById.get(candidate.packId);
                if (!pack) return null;
                const included = candidate.assignedAt !== null;
                return (
                  <li
                    key={candidate.packId}
                    className={`relative flex gap-2.5 rounded-md bg-surface p-2.5 ${included ? 'border border-ink' : 'border-[1.5px] border-dashed border-fg-2'}`}
                    data-testid="pack-conflict-card"
                    data-pack={candidate.packId}
                    data-included={included || undefined}
                  >
                    <PackCard
                      pack={pack}
                      size={64}
                      caption
                      onOpen={setOpenPack}
                      lang={lang}
                      selected={ctx.preferred.has(candidate.packId)}
                    />
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                      <PackStateBadge packId={candidate.packId} ctx={ctx} />
                      <ul className="flex flex-col gap-1">
                        {candidate.gifts.map((giftId) => {
                          const gift = ctx.indexes.giftById.get(giftId);
                          return gift ? (
                            <li key={giftId} className="flex items-center gap-1.5 text-xs">
                              <GiftIcon
                                gift={gift}
                                size={20}
                                judgement={ctx.judgements.get(giftId) ?? null}
                                lang={lang}
                              />
                              <span className="truncate">{ctx.giftName(giftId)}</span>
                            </li>
                          ) : null;
                        })}
                      </ul>
                      <div className="mt-auto flex justify-end">
                        <PackActions packId={candidate.packId} ctx={ctx} />
                      </div>
                    </div>
                    {packSheet(candidate.packId)}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </>
  );
}

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
  const banned = [...ctx.banned].sort((a, b) => a - b);
  if (others.length === 0 && banned.length === 0) return null;

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
        <ul className="border-b border-line">
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

      {banned.length > 0 ? (
        <details className="px-3 py-2" data-testid="banned" open={others.length === 0}>
          <summary className="cursor-pointer text-xs font-medium text-fg-2">
            {t('routeBannedList', lang, { n: banned.length })}
          </summary>
          <ul className="mt-1.5 flex flex-col gap-1.5">
            {banned.map((packId) => {
              const pack = ctx.indexes.packById.get(packId);
              return (
                <li
                  key={`pack-${packId}`}
                  className="flex items-center gap-2 text-xs text-fg-2"
                  data-testid="banned-pack"
                  data-pack={packId}
                >
                  {pack ? <PackCard pack={pack} size={20} lang={lang} /> : null}
                  <span className="line-through">{ctx.packName(packId)}</span>
                  <span className="ml-auto">
                    <PackActions packId={packId} ctx={ctx} />
                  </span>
                </li>
              );
            })}
          </ul>
        </details>
      ) : null}
    </Card>
  );
}
