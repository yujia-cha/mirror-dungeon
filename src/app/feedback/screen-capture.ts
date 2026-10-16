/**
 * 「앱 화면을 클립보드에 복사」 (M127): this app's own view as a PNG, drawn inside the browser, put
 * on the clipboard for the visitor to paste into the issue (a prefilled GitHub URL cannot carry a
 * picture). Where the clipboard takes no pictures (Firefox, older Safari) the PNG is downloaded.
 *
 * - **What is drawn**: the page as it stands under the feedback sheet — the sheet, its backdrop and
 *   any toast are left out, and so is every `<video>` and `<canvas>`: the screen reader's game frames
 *   never sit in the page, but nothing that could ever hold one is drawn (`EXCLUDE`).
 * - **How**: `modern-screenshot` (npm, bundled, loaded only when pressed) clones the page into an
 *   SVG `foreignObject` and paints it on a canvas. An image painted from a data URL cannot load
 *   anything itself, so every picture and font is inlined first. All of them are ours (same origin),
 *   so the canvas is never tainted; anything from another origin — an external art host, if one were
 *   ever set — is replaced with a blank instead of being fetched (`fetchFn`). No request leaves the
 *   origin.
 * - **Fonts**: Pretendard ships as 92 `unicode-range` slices. Inlining them all would fetch 3 MB, so
 *   only the slices whose range meets a character on the page are inlined (`fontCss`).
 */
import { downloadBlob } from '../lib/download.ts';

/** A transparent 1×1 GIF: what a picture from another origin is drawn as. */
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
/** How long one picture or font may take to load before it is drawn without. */
const CAPTURE_TIMEOUT_MS = 4000;
const EXCLUDE = 'video, canvas, [data-testid="block-sheet"], .bg-scrim, [data-testid="toast"]';

/** `U+0000-00FF, U+0131, U+4??` → inclusive code point ranges. Unparseable parts are skipped. */
export function parseUnicodeRange(value: string): [number, number][] {
  const out: [number, number][] = [];
  for (const part of value.split(',')) {
    const m = /^\s*U\+([0-9A-F?]{1,6})(?:-([0-9A-F]{1,6}))?\s*$/i.exec(part);
    if (!m) continue;
    const start = m[1]!;
    if (start.includes('?')) {
      out.push([parseInt(start.replace(/\?/g, '0'), 16), parseInt(start.replace(/\?/g, 'F'), 16)]);
    } else {
      const lo = parseInt(start, 16);
      out.push([lo, m[2] ? parseInt(m[2], 16) : lo]);
    }
  }
  return out;
}

/** Every code point in `text`. */
export function codePoints(text: string): Set<number> {
  const out = new Set<number>();
  for (const ch of text) out.add(ch.codePointAt(0)!);
  return out;
}

/** Whether any of `points` falls in `ranges`. An empty range list (no `unicode-range`) covers all. */
export function rangeHits(ranges: readonly [number, number][], points: ReadonlySet<number>): boolean {
  if (!ranges.length) return true;
  for (const point of points) for (const [lo, hi] of ranges) if (point >= lo && point <= hi) return true;
  return false;
}

/** Whether `url` is on the page's own origin (or a data/blob URL, which needs no fetch). */
export function sameOrigin(url: string, base: string): boolean {
  if (url.startsWith('data:') || url.startsWith('blob:')) return true;
  try {
    return new URL(url, base).origin === new URL(base).origin;
  } catch {
    return false;
  }
}

async function dataUrl(url: string): Promise<string> {
  const blob = await (await fetch(url, { cache: 'force-cache' })).blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** The page's own `@font-face` rules the visible text needs, with their files inlined. */
async function fontCss(doc: Document, text: string): Promise<string> {
  const points = codePoints(text);
  const rules: { css: string; base: string }[] = [];
  for (const sheet of Array.from(doc.styleSheets)) {
    let list: CSSRuleList;
    try {
      list = sheet.cssRules;
    } catch {
      continue; // another origin's sheet: we have none, and would not read it
    }
    for (const rule of Array.from(list)) {
      if (!(rule instanceof CSSFontFaceRule)) continue;
      const ranges = parseUnicodeRange(rule.style.getPropertyValue('unicode-range'));
      if (rangeHits(ranges, points)) rules.push({ css: rule.cssText, base: sheet.href ?? doc.baseURI });
    }
  }
  const inlined = await Promise.all(
    rules.map(async ({ css, base }) => {
      let out = css;
      for (const m of css.matchAll(/url\((['"]?)([^'")]+)\1\)/g)) {
        const url = new URL(m[2]!, base).href;
        if (!sameOrigin(url, doc.baseURI)) return '';
        out = out.replace(m[0], `url("${await dataUrl(url)}")`);
      }
      return out;
    }),
  );
  return inlined.filter(Boolean).join('\n');
}

/** The app's view as a PNG. Rejects when the browser cannot draw it. */
export async function captureApp(doc: Document = document): Promise<Blob> {
  const { domToBlob } = await import('modern-screenshot');
  // The app's root, not `<body>`: a cloned body takes the browser's default 8px margin inside the
  // picture. The sheets portalled to the body are the ones left out anyway.
  const body = doc.getElementById('root') ?? doc.body;
  const view = doc.defaultView ?? window;
  const base = doc.baseURI;
  // The library first waits for every picture in the page to load. A lazy one off screen never
  // starts until scrolled to, so it held the capture for the whole timeout (30 s measured). Ask
  // them to load now — ours, small, same origin — and cap the wait for anything still slow.
  for (const img of Array.from(body.querySelectorAll<HTMLImageElement>('img[loading="lazy"]')))
    if (!img.complete) img.loading = 'eager';
  return domToBlob(body, {
    type: 'image/png',
    timeout: CAPTURE_TIMEOUT_MS,
    scale: Math.min(view.devicePixelRatio || 1, 2),
    width: view.innerWidth,
    height: Math.max(view.innerHeight, body.scrollHeight),
    backgroundColor: view.getComputedStyle(doc.body).backgroundColor,
    filter: (node) => !(node instanceof Element && node.matches(EXCLUDE)),
    font: { cssText: await fontCss(doc, body.innerText ?? '') },
    // Ours are fetched as usual (`false`); anything else becomes a blank instead of a request.
    fetchFn: async (url) => (sameOrigin(url, base) ? false : BLANK),
  });
}

export type ShotResult = 'copied' | 'downloaded';

/**
 * Draw the app and put it on the clipboard, or download it where the clipboard takes no pictures.
 * Call it from the press itself: the clipboard needs the user's gesture, which is why the picture
 * is handed over as a promise (`ClipboardItem` accepts one) instead of awaited first.
 */
export async function copyAppScreen(capture: () => Promise<Blob> = () => captureApp()): Promise<ShotResult> {
  const shot = capture();
  // Rejections are read below; this keeps an early one from being reported as unhandled.
  shot.catch(() => undefined);
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': shot })]);
      return 'copied';
    } catch {
      /* no pictures on this clipboard, or the drawing failed: try the download, which rethrows */
    }
  }
  const blob = await shot;
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  downloadBlob(blob, `mirror-dungeon-${stamp}.png`);
  return 'downloaded';
}
