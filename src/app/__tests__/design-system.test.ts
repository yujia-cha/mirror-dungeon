/**
 * The design system (M104, docs/design/system.md) as a rule the code cannot drift from: every
 * class in `src/app` that sets type, spacing, radius, shadow or border width must come from the
 * system. A raw `text-sm` or `rounded-[3px]` fails here — under `--text-*: initial` it would not
 * even generate a rule, and the element would silently fall back to the body size.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const APP = join(process.cwd(), 'src/app');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return entry === '__tests__' ? [] : sources(path);
    return path.endsWith('.tsx') ? [path] : [];
  });
}

/** Type roles (src/index.css `@utility text-*`). Everything else after `text-` is a colour or alignment. */
const TYPE_ROLES = [
  'display',
  'title',
  'heading',
  'subheading',
  'body',
  'label',
  'caption',
  'caption-strong',
  'micro',
  'input',
] as const;
/** Spacing steps (×4px): 0 · 1px · 2 · 4 · 6 · 8 · 12 · 16 · 24 · 32 · 40. */
const SPACING_STEPS = ['0', 'px', '0.5', '1', '1.5', '2', '3', '4', '6', '8', '10'] as const;
const RADII = ['xs', 'sm', 'md', 'lg', 'full', 'none'];
const SHADOWS = ['sm', 'md', 'lg', 'none'];
const TEXT_NOT_SIZE = new Set([
  'left',
  'center',
  'right',
  'start',
  'end',
  'justify',
  'wrap',
  'nowrap',
  'balance',
  'pretty',
  'ellipsis',
  'clip',
  ...TYPE_ROLES,
]);

const CLASS = /(?<![\w-])(?:[a-z0-9@[\]&>*:_-]+:)?(-?[a-z][\w.-]*(?:-\[[^\]\s]+\])?)(?![\w[-])/g;

interface Violation {
  file: string;
  line: number;
  token: string;
  rule: string;
}

function check(token: string): string | null {
  const t = token.replace(/^-/, '');
  let m: RegExpExecArray | null;
  if ((m = /^text-(.+)$/.exec(t))) {
    const v = m[1]!;
    const isColour = /^(fg|primary|accent|success|danger|kw|bg|surface|border|current|transparent)/.test(v);
    if (!isColour && !TEXT_NOT_SIZE.has(v)) return 'type: use a role (text-display … text-micro)';
  }
  if (/^font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)$/.test(t))
    return 'type: weight comes with the role (or <strong>)';
  if (/^leading-/.test(t)) return 'type: line height comes with the role';
  if ((m = /^rounded(?:-([trblse]{1,2}))?(?:-(.+))?$/.exec(t))) {
    const v = m[2];
    if (v === undefined || !RADII.includes(v)) return `radius: one of ${RADII.join(' · ')}`;
  }
  if ((m = /^shadow(?:-(.+))?$/.exec(t))) {
    const v = m[1];
    if (v === undefined || (!SHADOWS.includes(v) && !v.startsWith('[') && !/^(fg|primary|border)/.test(v)))
      return `shadow: one of ${SHADOWS.join(' · ')}`;
    if (v.startsWith('[')) return 'shadow: no arbitrary shadows';
  }
  if ((m = /^(?:p[xytblrse]?|m[xytblrse]?|gap(?:-[xy])?|space-[xy])-(.+)$/.exec(t))) {
    const v = m[1]!;
    if (v.startsWith('[')) {
      if (/px\]$/.test(v)) return 'spacing: no arbitrary px — use a step';
    } else if (v !== 'auto' && !(SPACING_STEPS as readonly string[]).includes(v))
      return `spacing: steps ${SPACING_STEPS.join(' · ')}`;
  }
  if (/^border(?:-[xytblrse])?-\[/.test(t)) return 'border width: 1px (border) or 2px (border-2)';
  return null;
}

function violations(): Violation[] {
  const out: Violation[] = [];
  for (const file of sources(APP)) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((text, i) => {
      // Class strings only: string and template literals. Comments and JSX text are prose.
      for (const literal of text.match(/"[^"]*"|'[^']*'|`[^`]*`/g) ?? []) {
        for (const match of literal.matchAll(CLASS)) {
          const rule = check(match[1]!);
          if (rule) out.push({ file: relative(process.cwd(), file), line: i + 1, token: match[1]!, rule });
        }
      }
    });
  }
  return out;
}

describe('design system', () => {
  it('sets type, spacing, radius, shadow and border width only from the system', () => {
    const found = violations().map((v) => `${v.file}:${v.line}  ${v.token}  — ${v.rule}`);
    expect(found).toEqual([]);
  });

  it('defines every type role, radius and shadow it allows', () => {
    const css = readFileSync(join(process.cwd(), 'src/index.css'), 'utf8');
    for (const role of TYPE_ROLES) expect(css).toContain(`@utility text-${role} {`);
    for (const r of ['xs', 'sm', 'md', 'lg']) expect(css).toContain(`--radius-${r}:`);
    for (const s of ['sm', 'md', 'lg']) expect(css).toContain(`--shadow-${s}:`);
  });

  it('catches what it is meant to catch', () => {
    expect(check('text-sm')).not.toBeNull();
    expect(check('font-semibold')).not.toBeNull();
    expect(check('leading-tight')).not.toBeNull();
    expect(check('rounded-[3px]')).not.toBeNull();
    expect(check('rounded')).not.toBeNull();
    expect(check('shadow-pop')).not.toBeNull();
    expect(check('gap-2.5')).not.toBeNull();
    expect(check('px-[10px]')).not.toBeNull();
    expect(check('border-[1.5px]')).not.toBeNull();
    for (const ok of [
      'text-caption',
      'text-fg-muted',
      'text-center',
      'rounded-t-md',
      'shadow-lg',
      'gap-1.5',
      '-mx-1',
      'p-[6%]',
      'border-2',
      'border-border-control',
    ])
      expect(check(ok)).toBeNull();
  });
});
