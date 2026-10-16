/**
 * A sentence whose gift and pack names open their details (M120 — every name in the app is a way
 * to its sheet). The sentence is built from `docs/copy.md` as plain text; the names it carries are
 * found in it again and turned into `LinkButton`s, so no string has to be split by hand. A name
 * that does not occur is simply left out; one that occurs twice links the first time.
 */
import type { ReactNode } from 'react';
import { LinkButton } from './ui.tsx';

export interface NameLink {
  name: string;
  onOpen: () => void;
}

export function LinkedText({ text, links }: { text: string; links: readonly NameLink[] }) {
  const pending = links.filter((link) => link.name !== '');
  const out: ReactNode[] = [];
  let rest = text;
  let key = 0;
  while (rest.length > 0) {
    let best: { at: number; link: NameLink } | null = null;
    for (const link of pending) {
      const at = rest.indexOf(link.name);
      if (
        at >= 0 &&
        (best === null || at < best.at || (at === best.at && link.name.length > best.link.name.length))
      )
        best = { at, link };
    }
    if (!best) break;
    if (best.at > 0) out.push(rest.slice(0, best.at));
    const { link } = best;
    out.push(
      <LinkButton key={key++} onClick={link.onOpen}>
        {link.name}
      </LinkButton>,
    );
    pending.splice(pending.indexOf(link), 1);
    rest = rest.slice(best.at + link.name.length);
  }
  if (rest.length > 0) out.push(rest);
  return <>{out}</>;
}
