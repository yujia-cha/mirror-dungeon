/**
 * A theme pack as the game shows it: a portrait card (8:15) with the name underneath. Artwork
 * loads from the asset host when one is configured; otherwise a grey placeholder stands in.
 * With `onOpen` the card is a button that opens the pack's gift list.
 */
import { useState } from 'react';
import { Image } from 'lucide-react';
import type { ThemePack } from '../../core/schema.ts';
import { pick, type Lang } from '../i18n.ts';
import { packImageUrl } from '../lib/assets.ts';

export type PackCardSize = 20 | 28 | 48 | 64 | 96;

export function PackCard({
  pack,
  size,
  caption = false,
  selected = false,
  onOpen,
  lang,
  testId = 'pack-card',
}: {
  pack: ThemePack;
  size: PackCardSize;
  /** Show the name under the card. */
  caption?: boolean;
  selected?: boolean;
  onOpen?: (packId: number) => void;
  lang: Lang;
  testId?: string;
}) {
  const [failed, setFailed] = useState(false);
  const url = packImageUrl(pack.sprite);
  const name = pick(pack.name, lang);
  const height = Math.round((size * 15) / 8);
  const image = (
    <span
      role="img"
      aria-label={name}
      data-testid="pack-image"
      className={`inline-flex flex-none items-center justify-center overflow-hidden rounded-sm border bg-surface-3 text-fg-3 ${
        selected ? 'border-ink ring-2 ring-ink' : 'border-line'
      }`}
      style={{ width: size, height }}
    >
      {url && !failed ? (
        <img src={url} alt="" loading="lazy" onError={() => setFailed(true)} className="h-full w-full object-cover" />
      ) : (
        <Image size={Math.max(10, Math.round(size * 0.42))} aria-hidden className="opacity-40" />
      )}
    </span>
  );
  const body = (
    <>
      {image}
      {caption ? (
        <span
          className={`line-clamp-2 w-full break-keep text-center leading-tight text-fg ${size >= 64 ? 'text-xs' : 'text-[10px]'}`}
          style={{ width: Math.max(size, 52) }}
        >
          {name}
        </span>
      ) : null}
    </>
  );
  const className = 'inline-flex flex-none flex-col items-center gap-1';
  if (!onOpen) {
    return (
      <span className={className} title={name} data-testid={testId}>
        {body}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onOpen(pack.id)}
      aria-haspopup="dialog"
      aria-label={name}
      title={name}
      data-testid={testId}
      className={`${className} rounded-sm outline-none hover:opacity-90 focus-visible:outline`}
    >
      {body}
    </button>
  );
}
