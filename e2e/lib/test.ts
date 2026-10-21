/**
 * The suite's `test`: Playwright's, plus a guard that fails any test during which the page violated
 * its Content Security Policy (M164).
 *
 * The policy lives in `index.html` and allows only what the app really loads, so a violation is a
 * broken feature — an image that did not draw, a worker that did not start, the pre-paint script
 * refused — that no visible assertion may notice. Every page in the context (the overlay's
 * picture-in-picture window included) reports `securitypolicyviolation` events through a binding,
 * and the browser's own console lines are collected as a second source for the cases the event does
 * not cover (a refused `<meta>`-time resource).
 */
import { test as base, expect, type Page } from '@playwright/test';

declare global {
  interface Window {
    __cspViolation?: (text: string) => void;
  }
}

export const test = base.extend<{ cspGuard: void }>({
  cspGuard: [
    // `page` is a dependency so the test's own page exists before the listeners go on: a page the
    // context opens later (the overlay window) arrives through the `page` event.
    async ({ context, page }, use) => {
      const violations: string[] = [];
      const watched = new Set<Page>();
      const watch = (target: Page) => {
        if (watched.has(target)) return;
        watched.add(target);
        target.on('console', (message) => {
          if (/Content Security Policy/.test(message.text())) violations.push(`console: ${message.text()}`);
        });
      };
      await context.exposeBinding('__cspViolation', (_source, text: string) => {
        violations.push(text);
      });
      await context.addInitScript(() => {
        document.addEventListener('securitypolicyviolation', (event) => {
          window.__cspViolation?.(
            `${event.violatedDirective} blocked ${event.blockedURI || '(inline)'} at ${event.sourceFile || event.documentURI}:${event.lineNumber}`,
          );
        });
      });
      context.on('page', watch);
      for (const open of [page, ...context.pages()]) watch(open);
      await use();
      expect(violations, 'the page violated its CSP').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
