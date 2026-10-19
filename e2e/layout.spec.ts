import { expect, test } from '@playwright/test';
import { auditLayout } from './lib/layout-audit.ts';
import { DEVICES, TEXT_SCALES, startWithTextScale, walkLayoutStates } from './lib/layout-states.ts';

/**
 * The layout audit (M128, `lib/layout-audit.ts`) over the app's main states (`lib/layout-states.ts`):
 * a desktop and a phone, each at the default text size and at the largest. Every state is checked
 * against the same geometry invariants — no sideways scroll, no clipped text, no overlapping
 * controls, declared groups (`data-uniform`) the same size, menu rows spanning the menu, targets big
 * enough — so a change that pushes something else out of shape fails here, not in the owner's hands.
 *
 * One test per device × text size walks every state in a row on one page, and reports every
 * offender of every state at once (`expect.soft`), so one run lists the whole to-do.
 */

for (const device of ['desktop', 'phone'] as const) {
  test.describe(() => {
    test.use(DEVICES[device]);
    for (const { step, label } of TEXT_SCALES) {
      test(`${device} · 글자 ${label}: every state keeps its layout`, async ({ page }) => {
        test.setTimeout(60_000);
        await startWithTextScale(page, step);
        const seen = { states: 0, groups: 0, spans: 0 };
        await walkLayoutStates(page, device, async (state) => {
          // Transitions are 150ms; let them and the first image decode settle before measuring.
          await page.waitForTimeout(200);
          const { issues, counts } = await auditLayout(page, { touch: device === 'phone' });
          expect.soft(issues, `${device} · ${label} · ${state.title}`).toEqual([]);
          expect.soft(counts.controls, `${state.title}: controls measured`).toBeGreaterThan(5);
          seen.states += 1;
          seen.groups += counts.groups;
          seen.spans += counts.spans;
        });
        // The conventions were met on the way: groups compared, menu sections and card feet spanned.
        expect(seen.states).toBe(16);
        expect(seen.groups).toBeGreaterThan(seen.states);
        expect(seen.spans).toBeGreaterThan(0);
      });
    }
  });
}

/**
 * The audit itself, on a page made of known faults: each check has to find its own, and leave the
 * deliberate truncation alone. Without this a check that silently stopped matching (a selector
 * typo, a browser change) would pass every state above.
 */
test('the audit finds each kind of fault it is meant to find', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await page.setContent(`
    <body style="margin:0;font:13px sans-serif">
      <div style="width:1200px;height:4px"></div>
      <div data-testid="clipped" style="width:60px;white-space:nowrap;overflow:hidden">a label too long for its box</div>
      <div data-testid="truncated" style="width:60px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">a label too long for its box</div>
      <div style="position:relative;height:40px">
        <button data-testid="under" style="position:absolute;left:0;top:0;width:60px;height:30px">A</button>
        <button data-testid="over" style="position:absolute;left:30px;top:0;width:60px;height:30px">B</button>
      </div>
      <div data-testid="row" data-uniform="width" style="display:flex;gap:4px">
        <button style="width:40px;height:30px">1</button><button style="width:70px;height:30px">2</button>
      </div>
      <ul data-testid="column" data-uniform="width" style="display:flex;flex-direction:column;width:200px;margin:0;padding:0">
        <li style="list-style:none;width:200px"><button style="width:100%;height:30px">x</button></li>
        <li style="list-style:none;width:150px"><button style="width:100%;height:30px">y</button></li>
      </ul>
      <div data-variant="menu" style="width:200px;padding:6px">
        <div data-testid="section" style="width:max-content"><button style="height:30px">only as wide as me</button></div>
      </div>
      <button data-testid="small" style="width:16px;height:16px;margin-top:8px">s</button>
      <button data-testid="offscreen" style="position:absolute;left:-30px;top:560px;width:60px;height:30px">o</button>
    </body>`);
  const { issues: found } = await auditLayout(page, { touch: false, allow: [] });
  const has = (check: string, testId: string): boolean =>
    found.some((line) => line.startsWith(`${check} ·`) && line.includes(`[data-testid=${testId}]`));
  expect(found.some((line) => line.startsWith('h-scroll ·'))).toBe(true);
  expect(has('clipped', 'clipped')).toBe(true);
  expect(has('clipped', 'truncated')).toBe(false);
  expect(has('overlap', 'over')).toBe(true);
  expect(has('uniform', 'row')).toBe(true);
  expect(has('uniform', 'column')).toBe(true);
  expect(has('span', 'section')).toBe(true);
  expect(has('target', 'small')).toBe(true);
  expect(has('offscreen', 'offscreen')).toBe(true);
  // A 44px floor on a touch screen: the 30px buttons that pass with a mouse do not.
  const { issues: touch } = await auditLayout(page, { touch: true, allow: [] });
  expect(touch.some((line) => line.startsWith('target ·') && line.includes('[data-testid=under]'))).toBe(
    true,
  );
});
