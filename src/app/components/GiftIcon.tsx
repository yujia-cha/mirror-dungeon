/**
 * An E.G.O gift as a square tile. Artwork loads from the asset host when one is configured and
 * otherwise a grey placeholder stands in.
 *
 * The four corners each say one thing: the tier top-left, the run status top-right, 반드시
 * bottom-left, and the keyword bottom-right. The keyword badge is a small chip — the seven status
 * keywords each have a hue, the three attack types share one neutral ink and are told apart by
 * shape (slash a diamond, pierce a circle, blunt a square), and 범용 gets no badge at all. The
 * condition judgement sits outside the tile as a ring (green = met, red = not met, grey = cannot
 * judge). These are the only places the palette uses hue.
 */
import { useState } from 'react';
import { Check, Gem, Star, X } from 'lucide-react';
import type { Gift, Keyword } from '../../core/schema.ts';
import { pick, t, type Lang } from '../i18n.ts';
import { giftIconUrl } from '../lib/assets.ts';
import { tierLabel } from '../lib/labels.ts';
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

export function GiftIcon({
  gift,
  size,
  judgement = null,
  name = false,
  must = false,
  status = null,
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
  lang: Lang;
}) {
  const url = giftIconUrl(gift.icon);
  // Keyed by the url: a 404 must not follow the component to the next gift it is asked to draw.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const failed = failedUrl !== null && failedUrl === url;
  const label = pick(gift.name, lang);
  const judged = judgement ? t(JUDGEMENT_KEY[judgement], lang) : null;
  const statusText = status === 'got' ? t('giftStatusGot', lang) : status === 'failed' ? t('giftStatusFailed', lang) : null;
  const aria = [must ? t('priorityMust', lang) : null, statusText, judged, label].filter(Boolean).join(' · ');
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
      className={`relative inline-flex flex-none items-center justify-center overflow-hidden rounded-sm border border-line bg-surface-3 text-fg-3 ${ring} ${status === 'failed' ? 'opacity-50' : ''}`}
      style={{ width: size, height: size }}
    >
      {url && !failed ? (
        <img src={url} alt="" loading="lazy" onError={() => setFailedUrl(url)} className="h-full w-full object-cover" />
      ) : (
        <Gem size={Math.round(size * 0.45)} aria-hidden className="opacity-40" />
      )}
      {must ? (
        <span className="absolute bottom-0 left-0 rounded-tr-sm bg-ink p-px text-ink-fg" aria-hidden>
          <Star size={size >= 32 ? 9 : 7} fill="currentColor" />
        </span>
      ) : null}
      {status ? (
        <span className={`absolute right-0 top-0 rounded-bl-sm p-px ${status === 'got' ? 'bg-ink text-ink-fg' : 'bg-surface text-fg'}`} aria-hidden>
          {status === 'got' ? <Check size={size >= 32 ? 10 : 8} strokeWidth={3} /> : <X size={size >= 32 ? 10 : 8} strokeWidth={3} />}
        </span>
      ) : null}
      {size >= 32 && gift.tier !== null ? (
        // 'EX' is a tier of its own; 'TEX' was a number template applied to a word.
        <span className="absolute left-0 top-0 rounded-br-sm bg-surface px-0.5 font-num text-[9px] leading-[11px] text-fg-2">{tierLabel(gift.tier)}</span>
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
      <span className="line-clamp-2 w-full break-keep text-center text-[10px] leading-tight text-fg" aria-hidden>
        {label}
      </span>
    </span>
  );
}
