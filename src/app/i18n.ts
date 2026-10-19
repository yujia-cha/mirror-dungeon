/**
 * UI strings. Korean is the product language; English exists so the page is usable by the
 * English-speaking part of the community and is never the source of truth for a label.
 *
 * The words themselves live in `docs/copy.md`, with every other sentence a visitor reads (guide,
 * route warnings, README); `npm run copy` writes them out as `strings.generated.ts`. Edit the
 * Markdown, not the generated file. `{name}` placeholders are filled by `t(key, lang, params)`.
 */
import type { Localized } from '../core/schema.ts';
import { GUIDE_CARDS as GENERATED_GUIDE_CARDS, STRINGS } from './strings.generated.ts';

export { STRINGS } from './strings.generated.ts';

export type Lang = 'ko' | 'en';

export type StringKey = keyof typeof STRINGS;

export function t(key: StringKey, lang: Lang, params?: Record<string, string | number>): string {
  let out: string = STRINGS[key][lang];
  if (params)
    for (const [name, value] of Object.entries(params)) out = out.split(`{${name}}`).join(String(value));
  return out;
}

export function pick(value: Localized | undefined, lang: Lang): string {
  if (!value) return '';
  return value[lang] || value.ko || value.en;
}

/**
 * The guide the header's 「?」 opens, one card per section. Each card is also a section of
 * `README.md` — both come from the 「안내」 part of `docs/copy.md` (M114), so the guide and the
 * README share titles, order and pictures. A line is a sentence or a picture, in the order shown.
 */
export interface GuideMedia {
  /** Relative to `public/`, e.g. `guide/deck.webp`; the page prefixes `BASE_URL`. */
  src: string;
  kind: 'image' | 'video';
  alt: Localized;
  /** Pixel size of an image, so the page reserves its box before it loads. */
  width?: number;
  height?: number;
}

/** A text line of a guide card: a list item unless `form` says otherwise (M157). */
export interface GuideLine extends Localized {
  form?: 'numbered' | 'heading' | 'paragraph';
  /** The step number of a `numbered` line. */
  n?: number;
}

export interface GuideCard {
  title: Localized;
  lines: readonly (GuideLine | GuideMedia)[];
  /** The card ends with the link to `NOTICE`. */
  notice?: true;
}

/** The guide's cards, read as the general shape (the generated literals each lack the optional fields). */
export const GUIDE_CARDS: readonly GuideCard[] = GENERATED_GUIDE_CARDS;

export function isGuideMedia(line: GuideLine | GuideMedia): line is GuideMedia {
  return 'src' in line;
}
