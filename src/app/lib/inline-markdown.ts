/**
 * The little Markdown a guide line may carry — `**bold**`, `` `code` `` and `[text](link)` — and
 * nothing else (M114). A line shared with the README is written as Markdown there, so the guide
 * has to read the same marks; a full Markdown library would be a big dependency for three marks
 * and would open HTML into the page. Anything this does not recognise stays literal text.
 *
 * Links go only where a reader expects: `http(s)` addresses as written, and a repository path
 * (`docs/route-algorithm.md`) to that file in the public repository, since the site has no copy.
 * Any other scheme (`javascript:`, `data:`) is not a link — its text is shown, the address dropped.
 */
export type InlineToken =
  | { kind: 'text'; text: string }
  | { kind: 'strong'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'link'; text: string; href: string };

export const REPO_FILE_BASE = 'https://github.com/yujia-cha/mirror-dungeon/blob/main/';

const MARK = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;

export function linkTarget(href: string): string | null {
  if (/^https?:\/\//i.test(href)) return href;
  // A repository path: no scheme, no leading slash, no climbing out.
  if (/^[\w.-]+(?:\/[\w.-]+)*(?:#[\w-]+)?$/.test(href) && !href.split('/').includes('..'))
    return REPO_FILE_BASE + href;
  return null;
}

export function parseInline(source: string): InlineToken[] {
  const out: InlineToken[] = [];
  const text = (value: string): void => {
    if (!value) return;
    const last = out[out.length - 1];
    if (last?.kind === 'text') last.text += value;
    else out.push({ kind: 'text', text: value });
  };
  let at = 0;
  for (const m of source.matchAll(MARK)) {
    text(source.slice(at, m.index));
    at = m.index + m[0].length;
    if (m[1] !== undefined) out.push({ kind: 'strong', text: m[1] });
    else if (m[2] !== undefined) out.push({ kind: 'code', text: m[2] });
    else {
      const href = linkTarget(m[4]!);
      if (href) out.push({ kind: 'link', text: m[3]!, href });
      else text(m[3]!);
    }
  }
  text(source.slice(at));
  return out;
}
