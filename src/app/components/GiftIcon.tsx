/**
 * An E.G.O gift as a square tile. The picture comes from the asset host, the owner's art or the
 * game's own icon (`lib/assets.ts`). Under it lies a wash of the gift's keyword colour: it shows
 * through the game icon's transparent background, and with no picture at all it is the whole tile —
 * nothing is drawn in place of a missing picture.
 *
 * Three corners each say one thing: the tier top-left, the run status top-right, and the keyword
 * bottom-right (bottom-left is free since 「반드시」 left). The keyword badge is the game's own keyword
 * icon on a small round chip (M99); without the icon set it falls back to a coloured mark — the
 * seven status keywords each have a hue, the three attack types share one neutral ink and are told
 * apart by shape (slash a diamond, pierce a circle, blunt a square). 범용 gets no badge at all. The
 * condition judgement sits outside the tile as a ring (green = met, red = not met, grey = cannot
 * judge). These are the only places the palette uses hue.
 *
 * The picture always keeps its colour (M99 — the player looks for this very icon in the game, and a
 * grey one is hard to find). State is told by the frame and the corners instead: a dashed frame for
 * a toggle not pressed yet (`pending`), the ink frame and ✓ for collected, a faded picture with ✕
 * for missed, and a faded picture for a tile that cannot be pressed at all (`dim`).
 */
import { useState } from 'react';
import { Check, X } from 'lucide-react';
import type { Gift, Keyword } from '../../core/schema.ts';
import { pick, t, type Lang } from '../i18n.ts';
import { giftIconUrl, keywordIconUrl } from '../lib/assets.ts';
import { tierLabel } from '../lib/labels.ts';
import { useKeywordName } from '../lib/useEnums.ts';
import type { Judgement } from '../lib/judgement.ts';

/** In px: 20 inline, 32 in lists, 44 on the stage — tiles scale by the size setting (`lib/icon-size.ts`). */
export type GiftIconSize = number;

/**
 * The fallback keyword mark, drawn when the game's keyword icons are not shipped: a hue for each
 * status keyword, and one ink with a shape for the attack types. Its `fill` is also the tile's
 * keyword wash. `null` is 범용 — over a hundred gifts carry it, so a badge there would be noise.
 */
const KEYWORD_BADGE: Record<Keyword, { fill: string; shape: string } | null> = {
  Combustion: { fill: 'bg-kw-combustion', shape: 'rounded-xs' },
  Laceration: { fill: 'bg-kw-laceration', shape: 'rounded-xs' },
  Vibration: { fill: 'bg-kw-vibration', shape: 'rounded-xs' },
  Burst: { fill: 'bg-kw-burst', shape: 'rounded-xs' },
  Sinking: { fill: 'bg-kw-sinking', shape: 'rounded-xs' },
  Breath: { fill: 'bg-kw-breath', shape: 'rounded-xs' },
  Charge: { fill: 'bg-kw-charge', shape: 'rounded-xs' },
  Slash: { fill: 'bg-kw-attack', shape: 'rotate-45 rounded-xs' },
  Penetrate: { fill: 'bg-kw-attack', shape: 'rounded-full' },
  Hit: { fill: 'bg-kw-attack', shape: 'rounded-none' },
  None: null,
};

/** The smallest tile that draws the game keyword icon as its badge; smaller ones draw the mark. */
const BADGE_ICON_MIN_TILE = 28;

const RING: Record<Judgement, string> = {
  met: 'ring-2 ring-success ring-offset-1 ring-offset-surface',
  unmet: 'ring-2 ring-danger ring-offset-1 ring-offset-surface',
  // `border-control`, not `border-strong`: at 1.84:1 the grey ring read as no ring at all.
  unknown: 'ring-2 ring-border-control ring-offset-1 ring-offset-surface',
};

const JUDGEMENT_KEY = { met: 'condMet', unmet: 'condUnmet', unknown: 'giftUnjudgeable' } as const;

/**
 * How a faded picture reads — opacity only, never `grayscale` (M99). A tile that cannot be pressed
 * (`dim`) sits in the 0.38–0.5 band a disabled control uses; a missed gift is a result rather than
 * a lock and can still be pressed, so it stays a shade clearer, with its ✕ saying the rest.
 *
 * The icon applies this itself rather than letting a caller fade it from outside: the name beside
 * a tile keeps full contrast (small text taken down by `opacity` falls under 4.5:1), and the keyword
 * badge stays outside the faded layer.
 */
const DIM = 'opacity-45';
const DIM_FAILED = 'opacity-50';

/** The frame: dashed while a toggle is not pressed, ink once collected, the plain line otherwise. */
function frameClass(status: 'got' | 'failed' | null, pending: boolean): string {
  if (status === 'got') return 'border-primary';
  if (pending) return 'border-dashed border-border-control';
  return 'border-border';
}

export function GiftIcon({
  gift,
  size,
  judgement = null,
  name = false,
  status = null,
  pending = false,
  dim = false,
  title,
  lang,
}: {
  gift: Gift;
  size: GiftIconSize;
  judgement?: Judgement | null;
  /** Show the gift name under the tile. */
  name?: boolean;
  /** Extra hover text after the name (a condition sentence, a reason). */
  title?: string;
  /** Run progress: collected (check badge) or missed (dimmed, cross badge). */
  status?: 'got' | 'failed' | null;
  /** A run toggle not pressed yet: a dashed frame, the picture at full colour. */
  pending?: boolean;
  /**
   * This tile cannot be pressed — locked by another goal, or only a suggestion. The icon owns the
   * fade (see `DIM`) so that only the picture fades; the name beside it and the keyword badge
   * inside it stay at full contrast.
   */
  dim?: boolean;
  lang: Lang;
}) {
  const picture = giftIconUrl(gift.icon);
  const url = picture?.url ?? null;
  // Keyed by the url: a 404 must not follow the component to the next gift it is asked to draw.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const failed = failedUrl !== null && failedUrl === url;
  const hasArt = url !== null && !failed;
  const label = pick(gift.name, lang);
  const judged = judgement ? t(JUDGEMENT_KEY[judgement], lang) : null;
  const statusText =
    status === 'got' ? t('giftStatusGot', lang) : status === 'failed' ? t('giftStatusFailed', lang) : null;
  const keywordText = useKeywordName(gift.keyword, lang);
  // The badge and the tier chip are `aria-hidden`, and the badge is the only thing that carries a
  // gift's keyword — seven of them differ by hue alone, and 범용 is told by the badge being absent.
  // So a screen reader could not learn the keyword or the tier, two of the axes the app sorts and
  // filters on. They go in the name instead (WCAG 1.4.1, 1.1.1).
  // `None` is a keyword in the data with a name of its own (「키워드 없음」 / 「Keywordless」), so even the
  // badge-less case reads from the enums rather than from a string written here.
  const tierAria = gift.tier === null ? null : tierLabel(gift.tier);
  const aria = [statusText, judged, label, keywordText, tierAria].filter(Boolean).join(' · ');
  const badge = KEYWORD_BADGE[gift.keyword] ?? null;
  // The game icon needs room to be read: about a third of the tile. On an inline icon (under 28px)
  // its chip would cover half the picture, so there the small coloured mark stays. The mark keeps
  // its old sizes, and a rotated square needs room for its diagonal, so the diamond is drawn a
  // shade smaller.
  const badgeIcon = badge && size >= BADGE_ICON_MIN_TILE ? keywordIconUrl(gift.keyword) : null;
  const iconBadgeSize = Math.round(size * 0.32);
  const markSize = (size >= 32 ? 9 : 6) - (gift.keyword === 'Slash' ? 2 : 0);
  const ring = judgement ? RING[judgement] : '';
  const dimClass = status === 'failed' ? DIM_FAILED : dim ? DIM : '';
  const tile = (
    <span
      role="img"
      aria-label={aria}
      title={title ? `${label} · ${title}` : label}
      data-testid="gift-icon"
      data-keyword={gift.keyword}
      data-judgement={judgement ?? 'none'}
      data-status={status ?? undefined}
      data-pending={pending || undefined}
      className={`relative inline-flex flex-none items-center justify-center overflow-hidden rounded-sm border bg-surface-sunken text-fg-subtle ${frameClass(status, pending)} ${ring}`}
      style={{ width: size, height: size }}
    >
      {/* Everything the fade may touch. The keyword badge is deliberately not in here. */}
      <span className={`absolute inset-0 ${dimClass}`} data-testid="gift-dim" aria-hidden>
        {badge && !(hasArt && picture?.pixelArt) ? (
          /*
           * The ground: a wash of the gift's keyword colour — the keyword badge's own `bg-kw-*` at
           * 25%, so it adds no new palette entry; a 범용 gift gets no wash, the same way it gets no
           * badge. It sits under a game icon (transparent) and alone when there is no picture; the
           * owner's pixel art covers the square, so there it is left out. Which gift this is comes
           * from the name beside the tile and from `aria-label`, never from inside the square.
           */
          <span className={`absolute inset-0 ${badge.fill} opacity-25`} />
        ) : null}
        {hasArt && picture ? (
          // Pixel art scales `pixelated` (none of 20/32/44px divides the source, so smooth scaling
          // would blur it); the game's icons are painted and scale smoothly, inset a little so the
          // tier chip and keyword badge do not sit on the drawing's edge.
          <img
            src={picture.url}
            alt=""
            loading="lazy"
            draggable={false}
            onError={() => setFailedUrl(picture.url)}
            className={
              picture.pixelArt
                ? 'relative h-full w-full object-cover'
                : 'relative h-full w-full object-contain p-[6%]'
            }
            style={picture.pixelArt ? { imageRendering: 'pixelated' } : undefined}
          />
        ) : null}
        {status ? (
          <span
            className={`absolute right-0 top-0 rounded-bl-sm p-px ${status === 'got' ? 'bg-primary text-primary-fg' : 'bg-surface text-fg'}`}
          >
            {status === 'got' ? (
              <Check size={size >= 32 ? 10 : 8} strokeWidth={3} />
            ) : (
              <X size={size >= 32 ? 10 : 8} strokeWidth={3} />
            )}
          </span>
        ) : null}
        {size >= 32 && gift.tier !== null ? (
          // 'EX' is a tier of its own; 'TEX' was a number template applied to a word.
          <span className="absolute left-0 top-0 rounded-br-sm bg-surface px-0.5 font-num text-micro text-fg-muted">
            {tierLabel(gift.tier)}
          </span>
        ) : null}
      </span>
      {badge && badgeIcon ? (
        // On a round chip of the surface colour: the game icons are transparent, and over a busy
        // painting they would lose the 3:1 a meaningful mark needs against what is next to it.
        <span
          data-testid="gift-keyword"
          data-keyword={gift.keyword}
          className="absolute bottom-px right-px inline-flex items-center justify-center rounded-full bg-surface p-px"
          style={{ boxShadow: '0 0 0 1px var(--color-kw-outline)' }}
          aria-hidden
        >
          <img
            src={badgeIcon}
            alt=""
            loading="lazy"
            draggable={false}
            className="block object-contain"
            style={{ width: iconBadgeSize, height: iconBadgeSize }}
          />
        </span>
      ) : badge ? (
        <span
          data-testid="gift-keyword"
          data-keyword={gift.keyword}
          className={`absolute bottom-0.5 right-0.5 ${badge.fill} ${badge.shape}`}
          style={{ width: markSize, height: markSize, boxShadow: '0 0 0 1px var(--color-kw-outline)' }}
          aria-hidden
        />
      ) : null}
    </span>
  );
  if (!name) return tile;
  return (
    <span className="flex min-w-0 flex-col items-center gap-0.5" style={{ width: Math.max(size, 52) }}>
      {tile}
      <span className="line-clamp-2 w-full break-keep text-center text-caption text-fg" aria-hidden>
        {label}
      </span>
    </span>
  );
}
