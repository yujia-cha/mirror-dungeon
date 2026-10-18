/**
 * A gift the player marks as got or not, laid out like the items grid: the icon is the toggle and
 * the name opens the gift's details. The picture always keeps its colour — the player is looking
 * for this icon in the game — and the frame carries the state (M99): not got is a dashed frame, got
 * is the ink frame with a check on a filled tile, missed (decided by the run) fades the picture
 * with a cross and a press turns it into got. A goal gift wears a ring so it stands out among the
 * rest of a pack's drops. Without `onOpen` the name is plain text.
 */
import type { Gift } from '../../core/schema.ts';
import { pick, t, type Lang } from '../i18n.ts';
import type { Judgement } from '../lib/judgement.ts';
import { tierLabel } from '../lib/labels.ts';
import { giftDone, type GiftStatus } from '../lib/plan-input.ts';
import { useKeywordName } from '../lib/useEnums.ts';
import { GiftIcon, type GiftIconSize } from './GiftIcon.tsx';
import { LinkButton } from './ui.tsx';

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
  // Used up in a fusion the route wanted is as pressed as in hand (M149); pressing it unmarks.
  const got = giftDone(status);
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
        wanted ? 'border-primary ring-1 ring-primary' : 'border-border'
      } ${got ? 'bg-surface-muted' : ''}`}
      style={{ width }}
      data-testid="gift-tile"
      data-gift={gift.id}
      data-status={status ?? 'pending'}
      data-wanted={wanted || undefined}
    >
      {/*
        「아직 안 얻음」 is the icon's dashed frame (`pending`), not a fade: the toggle can be pressed,
        and a faded control reads as one that cannot. `GiftIcon` owns every state look, so the name
        beside it keeps full contrast.
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
          pending={status === null}
          lang={lang}
        />
      </button>
      {onOpen ? (
        <LinkButton
          onClick={onOpen}
          ariaLabel={t('giftDetail', lang, { name })}
          className="line-clamp-2 w-full break-keep text-caption"
        >
          {name}
        </LinkButton>
      ) : (
        // The toggle's label already says the name.
        <span className="line-clamp-2 w-full break-keep text-caption text-fg" aria-hidden>
          {name}
        </span>
      )}
    </div>
  );
}
