/**
 * The guide cards and README.md come from the same 「안내」 cards in `docs/copy.md` (M114), so a
 * card is a README section by construction. What this checks is the generated result: README.md
 * has a `## 제목` section per card, in card order, and each card's pictures sit inside its own
 * section — so a README edited by hand, around the generator, shows up here as well as in
 * `copy:check`.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GUIDE_CARDS, isGuideMedia } from '../i18n.ts';

// The repository root: vitest runs from it, and jsdom's `import.meta.url` is not a file URL.
const readme = readFileSync(resolve(process.cwd(), 'README.md'), 'utf8');

/** `## ` sections of the README, fenced code skipped: title → body up to the next `## `. */
function sections(markdown: string): { title: string; body: string }[] {
  const out: { title: string; body: string }[] = [];
  let fenced = false;
  for (const line of markdown.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    const heading = fenced ? null : /^## (.+)$/.exec(line);
    if (heading) out.push({ title: heading[1]!.trim(), body: '' });
    else if (out.length > 0) out[out.length - 1]!.body += `${line}\n`;
  }
  return out;
}

describe('README.md carries the guide cards', () => {
  const found = sections(readme);
  const titles = found.map((s) => s.title);

  it('has a section for every card, in card order', () => {
    const positions = GUIDE_CARDS.map((card) => titles.indexOf(card.title.ko));
    expect(positions.filter((p) => p < 0)).toEqual([]);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("puts each card's pictures inside that card's section", () => {
    for (const card of GUIDE_CARDS) {
      const body = found.find((s) => s.title === card.title.ko)?.body ?? '';
      for (const line of card.lines) if (isGuideMedia(line)) expect(body).toContain(`public/${line.src}`);
    }
  });
});
