/**
 * The overlay window (M132): a small always-on-top window over the game, through Document
 * Picture-in-Picture (`documentPictureInPicture.requestWindow`, Chrome and Edge 116+). A web page
 * cannot draw on the game itself; this window floats over a borderless-windowed game, though an
 * exclusive-fullscreen game covers it. Where the API is missing there is no window and no button.
 *
 * The window is an empty document of the page's own origin. React draws into it through a portal
 * (`OverlayView`), so it shares the page's stores; what it lacks is the page's look. `mirrorDocument`
 * copies the stylesheets (the built `<link>`s, and the `<style>`s Vite injects and rewrites in
 * development) and the `<html>` attributes that carry the theme, the text size and the language,
 * and keeps both in step while the window is open.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { feedbackLog } from '../lib/feedback-log.ts';

/** The part of `window.documentPictureInPicture` the overlay uses. */
export interface PictureInPictureApi {
  requestWindow: (options?: { width?: number; height?: number }) => Promise<Window>;
}

/** The size the overlay asks for: a phone-narrow column the game leaves room for. */
export const OVERLAY_SIZE = { width: 320, height: 480 } as const;

/** The browser's Document Picture-in-Picture, or null where it has none. */
export function pictureInPictureApi(
  host: Window & { documentPictureInPicture?: PictureInPictureApi } = window,
): PictureInPictureApi | null {
  return 'documentPictureInPicture' in host ? (host.documentPictureInPicture ?? null) : null;
}

const COPY_MARK = 'data-overlay-copy';
const STYLE_SOURCES = 'link[rel~="stylesheet"], style';

/**
 * Give `to` the look of `from` and keep it: the `<html>` attributes (class `dark`,
 * `data-text-scale`, `lang` …) and every stylesheet in the head. Returns the stop.
 *
 * The inline `style` attribute of `<html>` is left out: it is a scroll lock or a measurement of
 * the page, not its theme. A `<base>` keeps relative URLs inside copied `<style>`s (the fonts, in
 * development) pointing at the page rather than at the window's `about:blank`. Copies are matched
 * to their source, so a stylesheet added later (a lazy chunk, a Vite update) is added or rewritten
 * in place instead of reloading them all and flashing the window unstyled.
 */
export function mirrorDocument(from: Document, to: Document): () => void {
  const target = to.documentElement;
  const syncAttributes = (): void => {
    const source = from.documentElement;
    for (const { name } of [...target.attributes]) {
      if (name !== 'style' && !source.hasAttribute(name)) target.removeAttribute(name);
    }
    for (const { name, value } of [...source.attributes]) {
      if (name !== 'style' && target.getAttribute(name) !== value) target.setAttribute(name, value);
    }
  };

  const base = to.createElement('base');
  base.setAttribute('href', from.baseURI);
  base.setAttribute(COPY_MARK, '');
  to.head.prepend(base);

  const copies = new Map<Element, Element>();
  const copyOf = (source: Element): Element => {
    const copy = to.importNode(source, true) as Element;
    copy.setAttribute(COPY_MARK, '');
    // The page's address for the sheet, not one relative to the window's blank document.
    if (source.tagName === 'LINK') copy.setAttribute('href', (source as HTMLLinkElement).href);
    return copy;
  };
  const syncStyles = (): void => {
    const sources = [...from.head.querySelectorAll(STYLE_SOURCES)];
    const live = new Set(sources);
    for (const [source, copy] of copies) {
      if (live.has(source)) continue;
      copy.remove();
      copies.delete(source);
    }
    for (const source of sources) {
      const copy = copies.get(source);
      if (!copy) {
        const made = copyOf(source);
        to.head.append(made);
        copies.set(source, made);
      } else if (source.tagName === 'STYLE') {
        if (copy.textContent !== source.textContent) copy.textContent = source.textContent;
      } else {
        const href = (source as HTMLLinkElement).href;
        if (copy.getAttribute('href') !== href) copy.setAttribute('href', href);
        const media = source.getAttribute('media');
        if (media === null) copy.removeAttribute('media');
        else copy.setAttribute('media', media);
      }
    }
  };

  syncAttributes();
  syncStyles();
  const Observer = from.defaultView?.MutationObserver ?? MutationObserver;
  const attributes = new Observer(syncAttributes);
  attributes.observe(from.documentElement, { attributes: true });
  const head = new Observer(syncStyles);
  head.observe(from.head, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['href', 'media'],
  });
  return () => {
    attributes.disconnect();
    head.disconnect();
  };
}

export interface OverlayWindowApi {
  /** The browser can open the window at all. */
  supported: boolean;
  /** The open window, or null. */
  window: Window | null;
  /** Open it (a press on a button: the browser wants a user gesture). A second call does nothing. */
  open: () => Promise<void>;
  close: () => void;
}

/**
 * The window's lifecycle: open, mirror the page into it, and forget it when it goes — closed from
 * here, by its own close button (`pagehide`), or with the page (the browser closes it then; the
 * provider unmounting closes it too).
 */
export function useOverlayWindow(
  title: string,
  api: PictureInPictureApi | null = pictureInPictureApi(),
): OverlayWindowApi {
  const [win, setWin] = useState<Window | null>(null);
  const current = useRef<{ window: Window; stop: () => void } | null>(null);
  const opening = useRef(false);
  const titleRef = useRef(title);

  // The title follows the language while the window is open.
  useEffect(() => {
    titleRef.current = title;
    if (current.current) current.current.window.document.title = title;
  }, [title, win]);

  const forget = useCallback((which: Window): void => {
    if (current.current?.window !== which) return;
    current.current.stop();
    current.current = null;
    setWin(null);
  }, []);

  const open = useCallback(async (): Promise<void> => {
    if (!api || current.current || opening.current) return;
    opening.current = true;
    let next: Window;
    try {
      next = await api.requestWindow(OVERLAY_SIZE);
    } catch (cause) {
      // Refused (no gesture, a policy) — the button stays 「열기」; the feedback log keeps why.
      feedbackLog.error('promise', cause);
      return;
    } finally {
      opening.current = false;
    }
    const stop = mirrorDocument(document, next.document);
    next.document.title = titleRef.current;
    current.current = { window: next, stop };
    next.addEventListener('pagehide', () => forget(next), { once: true });
    setWin(next);
  }, [api, forget]);

  const close = useCallback((): void => {
    const open = current.current?.window;
    if (!open) return;
    forget(open);
    open.close();
  }, [forget]);

  // The window lives as long as the app around it.
  useEffect(
    () => () => {
      const open = current.current?.window;
      current.current?.stop();
      current.current = null;
      open?.close();
    },
    [],
  );

  const supported = api !== null;
  return useMemo(() => ({ supported, window: win, open, close }), [supported, win, open, close]);
}
