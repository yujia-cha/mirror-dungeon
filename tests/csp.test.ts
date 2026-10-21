/**
 * The Content Security Policy in `index.html` (M164).
 *
 * The policy allows exactly one inline script — the pre-paint theme/text-size script — by its
 * sha256. A hash is over the script's bytes, so any edit to that script (even whitespace) silently
 * turns it into a CSP violation and a light-theme reader gets the dark flash back. This recomputes
 * the hash from the file and compares it with the policy, so the two cannot drift. The build keeps
 * the script byte for byte (verified at M164 against `dist/index.html`; `e2e/lib/test.ts` fails any
 * browser test on a CSP violation, which is what would catch a bundler changing that).
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8');

function policy(): string {
  const meta = html.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"/);
  if (!meta) throw new Error('index.html has no Content-Security-Policy meta');
  return meta[1]!;
}

function directive(name: string): string[] {
  const found = policy()
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name} `) || part === name);
  if (!found) throw new Error(`policy has no ${name}`);
  return found.split(/\s+/).slice(1);
}

/** Every inline classic script's text, as the browser hashes it. */
function inlineScripts(): string[] {
  return [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]!);
}

describe('index.html CSP (M164)', () => {
  it('hashes the one inline script, byte for byte', () => {
    const scripts = inlineScripts();
    expect(scripts).toHaveLength(1);
    const hash = `'sha256-${createHash('sha256').update(scripts[0]!).digest('base64')}'`;
    expect(directive('script-src')).toContain(hash);
  });

  it('allows no other inline script and nothing off the origin', () => {
    const script = directive('script-src');
    expect(script).not.toContain("'unsafe-inline'");
    expect(script).not.toContain("'unsafe-eval'");
    expect(script.filter((s) => /^https?:/.test(s) || s === '*')).toEqual([]);
    for (const name of ['default-src', 'connect-src', 'font-src', 'media-src']) {
      expect(directive(name)).toEqual(["'self'"]);
    }
    expect(directive('object-src')).toEqual(["'none'"]);
    expect(directive('base-uri')).toEqual(["'self'"]);
  });

  it('comes before the inline script it hashes', () => {
    // A meta policy only governs what follows it in the document.
    expect(html.indexOf('http-equiv="Content-Security-Policy"')).toBeLessThan(html.indexOf('<script>'));
  });

  it('leaves the external image host as a build-time placeholder', () => {
    // vite.config.ts fills `%ASSET_SRC%` from VITE_ASSET_BASE, or removes it.
    expect(directive('img-src')).toEqual(["'self'", 'data:%ASSET_SRC%']);
  });
});
