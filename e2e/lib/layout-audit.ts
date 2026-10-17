/**
 * The layout audit (M128): geometry invariants that hold for every screen of the app, checked in a
 * real layout. It exists for the class of bug that throws no error — something is added, changed
 * or removed and, as a side effect, something else ends up the wrong size or in the wrong place
 * (M122: a new section widened the 「⋯」 menu and the four rows above it stayed narrower).
 *
 * `auditLayout(page, …)` runs every check in the page at once and returns what it found, one line
 * per offender (`check · element path · detail`), so a failure reads like a to-do list. The checks:
 *
 * - `h-scroll`  — the page never scrolls sideways (the phone rule).
 * - `clipped`   — text does not overflow the box that holds it, unless the box truncates on purpose
 *                 (`text-overflow: ellipsis`, `line-clamp`) or scrolls (`overflow: auto|scroll`).
 * - `overlap`   — two visible controls in the same layer do not cover each other by more than 1px.
 * - `offscreen` — no control or popover sits past the viewport's side where nothing scrolls to it.
 * - `uniform`   — the direct children of a `data-uniform="width|height|both"` container are the
 *                 same size; a column of them (a menu list) also spans the container's inner width.
 * - `span`      — every section of a `variant="menu"` popover, and every `data-span="padding"`
 *                 element, spans its container (the generalised M122 check).
 * - `target`    — a control is at least 44px on a touch screen and 24px with a mouse (the design
 *                 system rule), counting a pseudo-element that enlarges the hit area.
 *
 * A finding that is meant to be the way it is goes in `LAYOUT_ALLOW` with a one-line reason.
 */
import type { Page } from '@playwright/test';

export type LayoutCheck = 'h-scroll' | 'clipped' | 'overlap' | 'offscreen' | 'uniform' | 'span' | 'target';

export interface AllowEntry {
  check: LayoutCheck;
  /** A CSS selector matched against the offender (or one of its ancestors, through `closest`). */
  selector: string;
  /** Why this is intended. Shown nowhere at run time; it is the review's record. */
  reason: string;
}

/**
 * Findings that are the design, not a regression. Keep each entry narrow — a selector for the one
 * kind of element, never a whole screen — so a new problem next to it is still caught.
 */
export const LAYOUT_ALLOW: AllowEntry[] = [
  {
    check: 'target',
    selector: '[data-link]',
    reason:
      'A name that opens its sheet (`LinkButton`) is text in content — a caption under a tile, a row, a sentence — and the line is its height; a 24/44px box would steal presses from the icon above it or double the grid.',
  },
  {
    check: 'target',
    selector: '[data-testid="other-pack"] [data-testid="pack-card"]',
    reason:
      "The 28px portrait in a 「다른 팩」 row is a second door to the sheet the row's name already opens; widening it would push the name and the 44px 입장 button out of the row.",
  },
  {
    check: 'target',
    selector: '[data-testid="gift-tile"] > button[aria-pressed]',
    reason:
      "A gift tile's icon is as big as the visitor's own 「기프트 아이콘 크기」 (32px at 보통, 44px+ from 크게); a 44px floor would make the smaller steps meaningless.",
  },
];

export interface AuditOptions {
  /** Touch screen: 44px targets instead of 24px. */
  touch: boolean;
  allow?: AllowEntry[];
}

export interface AuditResult {
  /** One line per finding; empty when the page is clean. */
  issues: string[];
  /** What was measured — so a walk can tell a clean page from a check that matched nothing. */
  counts: { controls: number; groups: number; spans: number };
}

/** Run every check on the page as it is now. */
export async function auditLayout(page: Page, options: AuditOptions): Promise<AuditResult> {
  const allow = (options.allow ?? LAYOUT_ALLOW).map(({ check, selector }) => ({ check, selector }));
  return page.evaluate(
    ({ touch, allow }) => {
      const found: string[] = [];
      let groups = 0;
      const TOL = 1;
      const minTarget = touch ? 44 : 24;
      const INTERACTIVE = [
        'button',
        'a[href]',
        'input:not([type="hidden"])',
        'select',
        'textarea',
        'summary',
        '[role="tab"]',
        '[role="option"]',
        '[role="button"]',
        'label:has(input[type="checkbox"])',
      ].join(',');
      type Box = { left: number; top: number; right: number; bottom: number };

      const allowed = (check: string, el: Element): boolean =>
        allow.some((entry) => entry.check === check && el.closest(entry.selector) !== null);

      /** A short readable path: the nearest test id / id / role on the way up, then the element. */
      const describe = (el: Element): string => {
        const part = (node: Element): string => {
          const testId = node.getAttribute('data-testid');
          if (testId) return `[data-testid=${testId}]`;
          if (node.id) return `#${node.id}`;
          const role = node.getAttribute('role');
          return role ? `${node.tagName.toLowerCase()}[role=${role}]` : node.tagName.toLowerCase();
        };
        const parts = [part(el)];
        let node = el.parentElement;
        while (node && parts.length < 4 && node !== document.body) {
          if (node.getAttribute('data-testid') || node.id) parts.unshift(part(node));
          node = node.parentElement;
        }
        const label = (el.getAttribute('aria-label') ?? el.textContent ?? '').replace(/\s+/g, ' ').trim();
        return `${parts.join(' > ')}${label ? ` "${label.slice(0, 40)}"` : ''}`;
      };

      const report = (check: string, el: Element, detail: string): void => {
        if (allowed(check, el)) return;
        found.push(`${check} · ${describe(el)} · ${detail}`);
      };

      /**
       * Painted where the visitor can see it. `checkVisibility` also answers for a closed
       * `<details>` (its content keeps a layout box under `content-visibility: hidden`). The shell
       * behind a phone page is `inert`, and the drag ghost follows the finger on purpose.
       */
      const rendered = (el: Element): boolean => {
        if (el.closest('[inert], .sr-only, [data-testid="chip-ghost"]')) return false;
        if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
        if (getComputedStyle(el).display === 'contents') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      /** The part of the element not cut off by a clipping ancestor or the viewport; null when none is. */
      const visibleBox = (el: Element): Box | null => {
        const r = el.getBoundingClientRect();
        const box: Box = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
        let node = el.parentElement;
        while (node) {
          const style = getComputedStyle(node);
          if (style.overflowX !== 'visible' || style.overflowY !== 'visible') {
            const c = node.getBoundingClientRect();
            if (style.overflowX !== 'visible') {
              box.left = Math.max(box.left, c.left);
              box.right = Math.min(box.right, c.right);
            }
            if (style.overflowY !== 'visible') {
              box.top = Math.max(box.top, c.top);
              box.bottom = Math.min(box.bottom, c.bottom);
            }
          }
          if (style.position === 'fixed') break;
          node = node.parentElement;
        }
        box.left = Math.max(box.left, 0);
        box.top = Math.max(box.top, 0);
        box.right = Math.min(box.right, window.innerWidth);
        box.bottom = Math.min(box.bottom, window.innerHeight);
        return box.right - box.left > 0.5 && box.bottom - box.top > 0.5 ? box : null;
      };

      // h-scroll
      const extra = document.documentElement.scrollWidth - window.innerWidth;
      if (extra > 0) found.push(`h-scroll · html · the page is ${extra}px wider than the viewport`);

      // clipped: a box whose own text runs past it.
      const all = [...document.body.querySelectorAll('*')];
      for (const el of all) {
        if (el instanceof SVGElement || !rendered(el)) continue;
        const style = getComputedStyle(el);
        if (style.display === 'inline') continue;
        const ownText = [...el.childNodes].some(
          (node) =>
            (node.nodeType === Node.TEXT_NODE && node.textContent!.trim() !== '') ||
            (node instanceof HTMLElement &&
              getComputedStyle(node).display === 'inline' &&
              node.textContent!.trim() !== ''),
        );
        if (!ownText) continue;
        if (style.textOverflow === 'ellipsis' || style.webkitLineClamp !== 'none') continue;
        const html = el as HTMLElement;
        const scrollsX = style.overflowX === 'auto' || style.overflowX === 'scroll';
        const scrollsY = style.overflowY === 'auto' || style.overflowY === 'scroll';
        if (!scrollsX && html.scrollWidth > html.clientWidth + TOL) {
          report('clipped', el, `text needs ${html.scrollWidth}px, the box is ${html.clientWidth}px wide`);
        } else if (
          !scrollsY &&
          (style.overflowY === 'hidden' || style.overflowY === 'clip') &&
          html.scrollHeight > html.clientHeight + TOL + 1
        ) {
          report('clipped', el, `text needs ${html.scrollHeight}px, the box is ${html.clientHeight}px tall`);
        }
      }

      // The controls on screen, with their visible boxes and their layer.
      // A layer: a dialog or popover, or a box pinned while the page scrolls under it (the sticky
      // header, a panel, a phone page). Content scrolled beneath the header is covered, not
      // overlapping — two controls compete only inside one layer.
      const layerOf = (el: Element): Element => {
        for (let node: Element | null = el; node && node !== document.body; node = node.parentElement) {
          if (node.matches('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]'))
            return node;
          const position = getComputedStyle(node).position;
          if (position === 'fixed' || position === 'sticky') return node;
        }
        return document.body;
      };
      const controls = [...document.body.querySelectorAll(INTERACTIVE)]
        .filter((el) => rendered(el) && !el.closest('[aria-hidden="true"]'))
        // A control inside another control is part of it (a label's checkbox, a summary's button).
        .filter((el) => !el.parentElement?.closest(INTERACTIVE))
        .map((el) => ({ el, box: visibleBox(el), layer: layerOf(el) }))
        .filter((entry): entry is { el: Element; box: Box; layer: Element } => entry.box !== null);

      // overlap
      for (let i = 0; i < controls.length; i++) {
        for (let j = i + 1; j < controls.length; j++) {
          const a = controls[i]!;
          const b = controls[j]!;
          if (a.layer !== b.layer || a.el.contains(b.el) || b.el.contains(a.el)) continue;
          const w = Math.min(a.box.right, b.box.right) - Math.max(a.box.left, b.box.left);
          const h = Math.min(a.box.bottom, b.box.bottom) - Math.max(a.box.top, b.box.top);
          if (w <= TOL || h <= TOL) continue;
          // Only what is actually on top: under a sheet's scrim, neither is.
          const x = Math.max(a.box.left, b.box.left) + w / 2;
          const y = Math.max(a.box.top, b.box.top) + h / 2;
          const hit = document.elementFromPoint(x, y);
          if (!hit || !(a.el.contains(hit) || b.el.contains(hit))) continue;
          if (allowed('overlap', a.el) || allowed('overlap', b.el)) continue;
          found.push(
            `overlap · ${describe(a.el)} × ${describe(b.el)} · ${Math.round(w)}×${Math.round(h)}px in common`,
          );
        }
      }

      // offscreen: a control or a popover past the viewport's side, where no scroll reaches it (a
      // popover pinned to the wrong edge does not widen the page, so `h-scroll` cannot see it). A
      // box inside a sideways scroller or a clipping box is that box's business.
      const clipsX = (el: Element): boolean => {
        for (let node = el.parentElement; node; node = node.parentElement) {
          if (getComputedStyle(node).overflowX !== 'visible') return true;
        }
        return false;
      };
      const floating = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].filter((el) =>
        rendered(el),
      );
      for (const el of [...controls.map((entry) => entry.el), ...floating]) {
        const r = el.getBoundingClientRect();
        if ((r.left < -TOL || r.right > window.innerWidth + TOL) && !clipsX(el)) {
          report(
            'offscreen',
            el,
            `spans ${Math.round(r.left)}…${Math.round(r.right)}px of a ${window.innerWidth}px viewport`,
          );
        }
      }

      // target: what a finger aims at. A control that fills a framed box (a field's input, a
      // select in its frame, a slot's button) is aimed at through the frame; an absolutely placed
      // pseudo-element on a positioned control grows it (the tile ✕). A link inside a sentence is
      // exempt (WCAG 2.5.8's inline exception) — its size is the line's.
      for (const { el } of controls) {
        if (getComputedStyle(el).display === 'inline') continue;
        let rect = el.getBoundingClientRect();
        const field = el.matches('input, select, textarea') ? el.closest('label') : null;
        const frame = el.parentElement;
        if (field) rect = field.getBoundingClientRect();
        else if (frame) {
          const f = getComputedStyle(frame);
          const innerW = frame.clientWidth - parseFloat(f.paddingLeft) - parseFloat(f.paddingRight);
          const innerH = frame.clientHeight - parseFloat(f.paddingTop) - parseFloat(f.paddingBottom);
          if (rect.width >= innerW - TOL && rect.height >= innerH - TOL) rect = frame.getBoundingClientRect();
        }
        let width = rect.width;
        let height = rect.height;
        if (getComputedStyle(el).position !== 'static') {
          for (const pseudo of ['::before', '::after']) {
            const p = getComputedStyle(el, pseudo);
            if (p.content === 'none' || p.position !== 'absolute') continue;
            const px = (v: string): number => (v.endsWith('px') ? parseFloat(v) : 0);
            width = Math.max(width, rect.width - px(p.left) - px(p.right));
            height = Math.max(height, rect.height - px(p.top) - px(p.bottom));
          }
        }
        if (Math.min(width, height) + 0.5 < minTarget) {
          report('target', el, `${Math.round(width)}×${Math.round(height)}px, under ${minTarget}px`);
        }
      }

      // uniform
      for (const group of document.querySelectorAll('[data-uniform]')) {
        if (!rendered(group)) continue;
        const mode = group.getAttribute('data-uniform');
        const items = [...group.children].filter((child) => rendered(child));
        if (items.length < 2) continue;
        groups += 1;
        const rects = items.map((child) => child.getBoundingClientRect());
        const first = rects[0]!;
        rects.forEach((rect, index) => {
          if (index === 0) return;
          if ((mode === 'width' || mode === 'both') && Math.abs(rect.width - first.width) > TOL) {
            report(
              'uniform',
              items[index]!,
              `${Math.round(rect.width)}px wide, its first sibling is ${Math.round(first.width)}px`,
            );
          }
          if ((mode === 'height' || mode === 'both') && Math.abs(rect.height - first.height) > TOL) {
            report(
              'uniform',
              items[index]!,
              `${Math.round(rect.height)}px tall, its first sibling is ${Math.round(first.height)}px`,
            );
          }
        });
        // A column (every item under the previous one) is a list: each row spans the container.
        const column = rects.every(
          (rect, index) => index === 0 || rect.top >= rects[index - 1]!.bottom - TOL,
        );
        if (column && (mode === 'width' || mode === 'both')) {
          const style = getComputedStyle(group);
          const inner =
            (group as HTMLElement).clientWidth -
            parseFloat(style.paddingLeft) -
            parseFloat(style.paddingRight);
          rects.forEach((rect, index) => {
            if (Math.abs(rect.width - inner) > TOL) {
              report(
                'uniform',
                items[index]!,
                `${Math.round(rect.width)}px of a ${Math.round(inner)}px list`,
              );
            }
          });
        }
      }

      // span: a menu's sections, and anything that says it spans its container's padding box.
      const spans: Array<{ el: Element; inner: number }> = [];
      for (const menu of document.querySelectorAll('[data-variant="menu"]')) {
        if (!rendered(menu)) continue;
        const style = getComputedStyle(menu);
        const inner =
          (menu as HTMLElement).clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
        for (const child of menu.children) if (rendered(child)) spans.push({ el: child, inner });
      }
      for (const el of document.querySelectorAll('[data-span="padding"]')) {
        if (!rendered(el) || !el.parentElement) continue;
        spans.push({ el, inner: el.parentElement.clientWidth });
      }
      for (const { el, inner } of spans) {
        const width = el.getBoundingClientRect().width;
        if (Math.abs(width - inner) > TOL) {
          report('span', el, `${Math.round(width)}px of its container's ${Math.round(inner)}px`);
        }
      }

      return { issues: found, counts: { controls: controls.length, groups, spans: spans.length } };
    },
    { touch: options.touch, allow },
  );
}
