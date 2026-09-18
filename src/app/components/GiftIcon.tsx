/**
 * An E.G.O gift as a square tile. Artwork loads from the asset host or `public/art/` when there is
 * any for this gift; with none, the tile keeps its own ground and a wash of the gift's keyword
 * colour — nothing is drawn in place of the missing picture.
 *
 * The four corners each say one thing: the tier top-left, the run status top-right, 반드시
 * bottom-left, and the keyword bottom-right. The keyword badge is a small chip — the seven status
 * keywords each have a hue, the three attack types share one neutral ink and are told apart by
 * shape (slash a diamond, pierce a circle, blunt a square), and 범용 gets no badge at all. The
 * condition judgement sits outside the tile as a ring (green = met, red = not met, grey = cannot
 * judge). These are the only places the palette uses hue.
 */
import { useState } from 'react';
import { Check, Star, X } from 'lucide-react';
import type { Gift, Keyword } from '../../core/schema.ts';
import { pick, t, type Lang } from '../i18n.ts';
import { giftIconUrl } from '../lib/assets.ts';
import { tierLabel } from '../lib/labels.ts';
import { useKeywordName } from '../lib/useEnums.ts';
import type { Judgement } from '../lib/judgement.ts';

export type GiftIconSize = 20 | 32 | 44;

/**
 * The keyword badge: a hue for each status keyword, and one ink with a shape for the attack types.
 * `null` is 범용 — over a hundred gifts carry it, so a badge there would be noise, not information.
 */
const KEYWORD_BADGE: Record<Keyword, { fill: string; shape: string } | null> = {
  Combustion: { fill: 'bg-kw-combustion', shape: 'rounded-[2px]' },
  Laceration: { fill: 'bg-kw-laceration', shape: 'rounded-[2px]' },
  Vibration: { fill: 'bg-kw-vibration', shape: 'rounded-[2px]' },
  Burst: { fill: 'bg-kw-burst', shape: 'rounded-[2px]' },
  Sinking: { fill: 'bg-kw-sinking', shape: 'rounded-[2px]' },
  Breath: { fill: 'bg-kw-breath', shape: 'rounded-[2px]' },
  Charge: { fill: 'bg-kw-charge', shape: 'rounded-[2px]' },
  Slash: { fill: 'bg-kw-attack', shape: 'rotate-45 rounded-[1px]' },
  Penetrate: { fill: 'bg-kw-attack', shape: 'rounded-full' },
  Hit: { fill: 'bg-kw-attack', shape: 'rounded-none' },
  None: null,
};

const RING: Record<Judgement, string> = {
  met: 'ring-2 ring-ok ring-offset-1 ring-offset-surface',
  unmet: 'ring-2 ring-bad ring-offset-1 ring-offset-surface',
  unknown: 'ring-2 ring-line-strong ring-offset-1 ring-offset-surface',
};

const JUDGEMENT_KEY = { met: 'condMet', unmet: 'condUnmet', unknown: 'giftUnjudgeable' } as const;

/**
 * How an inactive tile reads: greyscale drops the keyword hue, the opacity pushes it back. The
 * icon applies this itself rather than letting a caller dim it from outside, so the name beside a
 * tile keeps full contrast — small text taken down by `opacity` falls under 4.5:1.
 */
const DIM = 'grayscale opacity-55';

export function GiftIcon({
  gift,
  size,
  judgement = null,
  name = false,
  must = false,
  status = null,
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
  /** The user marked this gift 반드시; drawn as a star badge. */
  must?: boolean;
  /** Run progress: collected (check badge) or missed (dimmed, cross badge). */
  status?: 'got' | 'failed' | null;
  /**
   * This tile is inactive — not collected yet, or locked by another goal. The icon owns the dim
   * (see `DIM`) so that only the picture goes grey; the name beside it stays at full contrast.
   */
  dim?: boolean;
  lang: Lang;
}) {
  const url = giftIconUrl(gift.icon);
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
  // So a screen reader could not learn the keyword, the tier, or whether a gift is guaranteed:
  // the three axes the app sorts and filters on. They go in the name instead (WCAG 1.4.1, 1.1.1).
  // `None` is a keyword in the data with a name of its own (「범용」 / 「Keywordless」), so even the
  // badge-less case reads from the enums rather than from a string written here.
  const tierAria = gift.tier === null ? null : tierLabel(gift.tier);
  const aria = [must ? t('priorityMust', lang) : null, statusText, judged, label, keywordText, tierAria]
    .filter(Boolean)
    .join(' · ');
  const badge = KEYWORD_BADGE[gift.keyword] ?? null;
  // A rotated square needs room for its diagonal, so the diamond is drawn a shade smaller.
  const badgeSize = (size >= 32 ? 9 : 6) - (gift.keyword === 'Slash' ? 2 : 0);
  const ring = judgement ? RING[judgement] : '';
  const tile = (
    <span
      role="img"
      aria-label={aria}
      title={title ? `${label} · ${title}` : label}
      data-testid="gift-icon"
      data-keyword={gift.keyword}
      data-judgement={judgement ?? 'none'}
      data-must={must || undefined}
      data-status={status ?? undefined}
      className={`relative inline-flex flex-none items-center justify-center overflow-hidden rounded-sm border border-line bg-surface-3 text-fg-3 ${ring} ${dim || status === 'failed' ? DIM : ''}`}
      style={{ width: size, height: size }}
    >
      {hasArt ? (
        // `pixelated` because the artwork is pixel art: smooth scaling turns it to mush, and none
        // of 20/32/44px is an integer divisor of the source, so the browser is always scaling.
        <img
          src={url}
          alt=""
          loading="lazy"
          onError={() => setFailedUrl(url)}
          className="h-full w-full object-cover"
          style={{ imageRendering: 'pixelated' }}
        />
      ) : badge ? (
        /*
         * No artwork: a wash of the gift's keyword colour and nothing else. The wash is the keyword
         * badge's own `bg-kw-*` at 25%, so it adds no new palette entry, and a 범용 gift gets no wash
         * at all — the same way it gets no badge. Which gift this is comes from the name beside the
         * tile and from `aria-label`, never from inside the square.
         */
        <span className={`absolute inset-0 ${badge.fill} opacity-25`} aria-hidden />
      ) : null}
      {must ? (
        <span className="absolute bottom-0 left-0 rounded-tr-sm bg-ink p-px text-ink-fg" aria-hidden>
          <Star size={size >= 32 ? 9 : 7} fill="currentColor" />
        </span>
      ) : null}
      {status ? (
        <span
          className={`absolute right-0 top-0 rounded-bl-sm p-px ${status === 'got' ? 'bg-ink text-ink-fg' : 'bg-surface text-fg'}`}
          aria-hidden
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
        <span className="absolute left-0 top-0 rounded-br-sm bg-surface px-0.5 font-num text-[9px] leading-[11px] text-fg-2">
          {tierLabel(gift.tier)}
        </span>
      ) : null}
      {badge ? (
        <span
          data-testid="gift-keyword"
          data-keyword={gift.keyword}
          className={`absolute bottom-0.5 right-0.5 ${badge.fill} ${badge.shape}`}
          style={{ width: badgeSize, height: badgeSize, boxShadow: '0 0 0 1px var(--color-kw-outline)' }}
          aria-hidden
        />
      ) : null}
    </span>
  );
  if (!name) return tile;
  return (
    <span className="flex min-w-0 flex-col items-center gap-0.5" style={{ width: Math.max(size, 52) }}>
      {tile}
      <span
        className="line-clamp-2 w-full break-keep text-center text-[10px] leading-tight text-fg"
        aria-hidden
      >
        {label}
      </span>
    </span>
  );
}
