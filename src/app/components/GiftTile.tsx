/**
 * A gift the player marks as got or not, laid out like the items grid: the icon is the toggle and
 * the name opens the gift's details. The look carries the state — not got is greyscale and dimmed,
 * got is full colour with a check, missed (decided by the run) is dimmed harder with a cross and a
 * press turns it into got. A goal gift wears a ring so it stands out among the rest of a pack's
 * drops. Without `onOpen` the name is plain text.
 */
import type { Gift } from '../../core/schema.ts';
import { pick, t, type Lang } from '../i18n.ts';
import type { Judgement } from '../lib/judgement.ts';
import { tierLabel } from '../lib/labels.ts';
import type { GiftStatus } from '../lib/plan-input.ts';
import { useKeywordName } from '../lib/useEnums.ts';
import { GiftIcon, type GiftIconSize } from './GiftIcon.tsx';

export function GiftTile({
  gift,
  status,
  wanted = false,
  judgement = null,
  size = 44,
  title,
  onToggle,
  onOpen,
  lang,
}: {
  gift: Gift;
  status: GiftStatus | null;
  wanted?: boolean;
  judgement?: Judgement | null;
  size?: GiftIconSize;
  title?: string;
  onToggle: (next: GiftStatus | null) => void;
  /** Show the gift's details; the name becomes the button that does it. */
  onOpen?: () => void;
  lang: Lang;
}) {
  const name = pick(gift.name, lang);
  const got = status === 'got';
  const width = Math.max(size + 16, 64);
  const keyword = useKeywordName(gift.keyword, lang);
  // The button's own label replaces the icon's `role="img"` name rather than adding to it, so
  // everything the icon says — keyword, tier, condition judgement — has to be part of this label.
  const judged = judgement
    ? t(judgement === 'met' ? 'condMet' : judgement === 'unmet' ? 'condUnmet' : 'giftUnjudgeable', lang)
    : null;
  const aria = [
    t('giftTileToggle', lang, { name }),
    keyword,
    gift.tier === null ? null : tierLabel(gift.tier),
    judged,
    title,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <div
      className={`relative flex select-none flex-col items-center gap-1 rounded-md border p-1.5 text-center ${
        wanted ? 'border-ink ring-1 ring-ink' : 'border-line'
      } ${status === null || status === 'failed' ? '' : 'bg-surface'}`}
      style={{ width }}
      data-testid="gift-tile"
      data-gift={gift.id}
      data-status={status ?? 'pending'}
      data-wanted={wanted || undefined}
    >
      {/*
        「아직 안 얻음」 is a dim, and `GiftIcon` owns it — setting it on a wrapper would take the
        icon's keyword badge into the same `grayscale`, and that badge is the only thing still saying
        which keyword an uncollected gift has. The name stays outside it: at 10px a dimmed name
        would sit under the 4.5:1 the floor strip is careful about.
      */}
      <button
        type="button"
        onClick={() => onToggle(got ? null : 'got')}
        aria-pressed={got}
        aria-label={aria}
        title={[name, title].filter(Boolean).join(' · ')}
        data-testid="gift-tile-toggle"
        className="inline-flex rounded-sm"
      >
        <GiftIcon
          gift={gift}
          size={size}
          judgement={judgement}
          status={status}
          dim={status === null}
          lang={lang}
        />
      </button>
      {onOpen ? (
        <button
          type="button"
          onClick={onOpen}
          aria-haspopup="dialog"
          aria-label={t('giftDetail', lang, { name })}
          className="line-clamp-2 w-full break-keep text-xs leading-tight text-fg underline-offset-2 hover:underline"
        >
          {name}
        </button>
      ) : (
        // The toggle's label already says the name.
        <span className="line-clamp-2 w-full break-keep text-xs leading-tight text-fg" aria-hidden>
          {name}
        </span>
      )}
    </div>
  );
}
