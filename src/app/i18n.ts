/**
 * UI strings. Korean is the product language; English exists so the page is usable by the
 * English-speaking part of the community and is never the source of truth for a label.
 *
 * The words themselves live in `docs/copy.md`, with every other sentence a visitor reads (guide,
 * route warnings, README); `npm run copy` writes them out as `strings.generated.ts`. Edit the
 * Markdown, not the generated file. `{name}` placeholders are filled by `t(key, lang, params)`.
 */
import type { Localized } from '../core/schema.ts';
import { STRINGS } from './strings.generated.ts';

export { STRINGS, GUIDE_CARDS } from './strings.generated.ts';

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
 * The guide the header's 「?」 opens, one card per section. It follows the visitor-facing sections
 * of `README.md` — same titles, same order — so a reader who met the README on GitHub finds the
 * same map here; `src/app/__tests__/guide.test.ts` holds every Korean title to a README heading.
 * The development section is left out: it is for someone cloning the repository, not using the
 * site. Each card says the least that gets a first-time visitor through that part of the page.
 */
export interface GuideCard {
  title: Localized;
  lines: Localized[];
  /** The card ends with the link to `NOTICE`. */
  notice?: true;
}
