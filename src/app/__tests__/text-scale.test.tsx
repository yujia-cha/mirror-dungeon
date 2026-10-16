/**
 * M123: the text size setting reaches `<html data-text-scale>` — from the store once React is up,
 * and from `index.html`'s pre-paint script before that, both reading the same saved key.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { act, render } from '@testing-library/react';
import { App } from '../App.tsx';
import { PERSIST_KEY, TEXT_SCALES, defaultUi, useApp } from '../store.ts';

const root = document.documentElement;

afterEach(() => {
  root.removeAttribute('data-text-scale');
  root.classList.remove('dark');
  window.localStorage.clear();
  useApp.setState({ ui: defaultUi() });
});

/** The inline (non-module) script in `index.html`'s head, run as the browser would before paint. */
function runPrePaint(): void {
  const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8');
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1];
  if (!script) throw new Error('index.html has no inline pre-paint script');
  new Function(script)();
}

describe('text size (M123)', () => {
  it('keeps <html data-text-scale> on the stored step', () => {
    // Arrange
    render(<App />);
    expect(root.dataset.textScale).toBe('md');

    // Act + Assert: every step lands on the document, and back.
    for (const step of TEXT_SCALES) {
      act(() => useApp.getState().setUi({ textScale: step }));
      expect(root.dataset.textScale).toBe(step);
    }
  });

  it('applies the saved step before the first paint, and nothing for a missing or bad one', () => {
    // Arrange: a theme meta for the script to touch, as in the real head.
    const meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.append(meta);
    try {
      // A saved 「아주 크게」.
      window.localStorage.setItem(
        PERSIST_KEY,
        JSON.stringify({ state: { dark: true, ui: { textScale: 'xl' } } }),
      );
      runPrePaint();
      expect(root.dataset.textScale).toBe('xl');

      // A state saved before the setting existed: no attribute, so the CSS default (보통) holds.
      root.removeAttribute('data-text-scale');
      window.localStorage.setItem(PERSIST_KEY, JSON.stringify({ state: { dark: true, ui: {} } }));
      runPrePaint();
      expect(root.hasAttribute('data-text-scale')).toBe(false);

      // Not a step: ignored, as `sanitizeUi` ignores it.
      window.localStorage.setItem(PERSIST_KEY, JSON.stringify({ state: { ui: { textScale: '"><x' } } }));
      runPrePaint();
      expect(root.hasAttribute('data-text-scale')).toBe(false);

      // A half-written blob does not break the theme either.
      window.localStorage.setItem(PERSIST_KEY, '{"state":');
      runPrePaint();
      expect(root.classList.contains('dark')).toBe(true);
    } finally {
      meta.remove();
    }
  });

  it('scales every type role from one factor, with the 10px floor and the 16px touch input', () => {
    const css = readFileSync(join(process.cwd(), 'src/index.css'), 'utf8');
    const roles = [...css.matchAll(/@utility (text-[\w-]+) \{([^}]*)\}/g)];
    expect(roles.map((m) => m[1])).toEqual([
      'text-display',
      'text-title',
      'text-heading',
      'text-subheading',
      'text-body',
      'text-label',
      'text-caption',
      'text-caption-strong',
      'text-micro',
      'text-input',
    ]);
    for (const [, name, body] of roles)
      expect(body, name).toMatch(/font-size: max\(10px, calc\(\d+px \* var\(--type-scale\)\)\);/);
    expect(css).toMatch(/font-size: max\(16px, calc\(13px \* var\(--type-scale\)\)\);/);
    for (const step of ['sm', 'lg', 'xl']) expect(css).toContain(`:root[data-text-scale='${step}']`);
  });
});
