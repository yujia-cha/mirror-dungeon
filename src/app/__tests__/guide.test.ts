/**
 * The guide is the README's visitor sections, card for card. Each card's Korean title has to be a
 * heading in `README.md` (a leading 「1.」 aside), and the cards keep the README's order — so when
 * the README is rewritten, this is what says the guide needs the same change.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GUIDE_CARDS } from '../i18n.ts';

// The repository root: vitest runs from it, and jsdom's `import.meta.url` is not a file URL.
const readme = readFileSync(resolve(process.cwd(), 'README.md'), 'utf8');

/** Heading texts in document order, fenced code skipped, list numbering and HTML stripped. */
function headings(markdown: string): string[] {
  const out: string[] = [];
  let fenced = false;
  for (const line of markdown.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    if (fenced) continue;
    const md = /^#{1,6}\s+(.*)$/.exec(line);
    // A heading inside `<summary>` is how a collapsed section is titled.
    const summary = /<summary>(?:<[^>]+>)*\s*(.*?)\s*(?:<\/[^>]+>)*<\/summary>/.exec(line);
    const text = md?.[1] ?? summary?.[1];
    if (text === undefined) continue;
    out.push(
      text
        .replace(/<[^>]+>/g, '')
        .replace(/^\d+\.\s*/, '')
        .trim(),
    );
  }
  return out;
}

describe('guide cards follow README.md', () => {
  const titles = GUIDE_CARDS.map((card) => card.title.ko);
  const found = headings(readme);

  it('names every card after a README heading', () => {
    expect(titles.filter((title) => !found.includes(title))).toEqual([]);
  });

  it('keeps the README order', () => {
    const positions = titles.map((title) => found.indexOf(title));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });
});
