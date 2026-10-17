/**
 * The app's main states, walked in one pass (M128). The layout audit (`e2e/layout.spec.ts`) checks
 * each state as it is reached, and `npm run layout:shots` photographs the same states — one list,
 * so the automatic check and the before/after pictures never look at different screens.
 *
 * The walk waits with locators only (no `expect`), so it runs in a Playwright test and in a plain
 * script alike. It starts from whatever `baseURL` the page's context has.
 */
import type { Page } from '@playwright/test';
import { shareHash } from '../share.ts';

/** Six clear-reward gifts that cannot all fit one run: the route offers a decision card. */
export const CONFLICTING = [9250, 9251, 9252, 9253, 9254, 9255];

/**
 * Two general drops the game lets you enhance (M130) — 지옥나비의 꿈 (`+`/`++`) and 덧붙인 반창고
 * (`+`) — so the tray shows its enhancement row beside tiles without one. General drops need no
 * pack, so they leave the conflict (and the decision card) as it is.
 */
export const ENHANCEABLE = [9001, 9192];

export type Device = 'desktop' | 'phone';

/** The viewports the walk is meant for: a laptop, and a phone held upright (a touch screen). */
export const DEVICES = {
  desktop: { viewport: { width: 1280, height: 800 } },
  phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
} as const;

/** The text sizes the walk is repeated at: the default and the largest (`ui.textScale`). */
export const TEXT_SCALES = [
  { step: 'md', label: '보통' },
  { step: 'xl', label: '아주 크게' },
] as const;

export interface LayoutState {
  /** File-safe, stable: the screenshot's name. */
  id: string;
  /** What the state is, for a reader. */
  title: string;
}

/** Make every page of this context start at the given text size, as a returning visitor's storage would. */
export async function startWithTextScale(page: Page, step: string): Promise<void> {
  await page.addInitScript((textScale) => {
    if (window.localStorage.getItem('md-route-planner')) return;
    window.localStorage.setItem(
      'md-route-planner',
      JSON.stringify({ state: { ui: { textScale } }, version: 7 }),
    );
  }, step);
}

async function textChanges(page: Page, testId: string, from: string | null): Promise<void> {
  await page.waitForFunction(
    ({ id, before }) => document.querySelector(`[data-testid="${id}"]`)?.textContent !== before,
    { id: testId, before: from },
  );
}

/** Press 「다음 층」 until the stage offers a route pack. */
async function walkToRoutePack(page: Page): Promise<void> {
  for (let step = 0; step < 15; step++) {
    if ((await page.getByTestId('stage-pack').count()) > 0) return;
    const floor = await page.getByTestId('stage-floor').textContent();
    await page.getByRole('button', { name: '다음 층' }).last().click();
    await textChanges(page, 'stage-floor', floor);
  }
  throw new Error('the conflicting plan never put a route pack on the stage');
}

/** A fresh document on the share link: a hash alone would be a same-document navigation. */
async function openPlan(page: Page): Promise<void> {
  await page.goto('about:blank');
  await page.goto(`./${shareHash([...CONFLICTING, ...ENHANCEABLE])}`);
  await page.getByTestId('stage-floor').waitFor();
}

async function routeReady(page: Page): Promise<void> {
  await page.getByTestId('route-plan').waitFor();
  // The ways to fit lead the card (M144); the bars are under 「자세히」, opened so both are audited.
  await page.getByTestId('resolution').first().waitFor();
  await page.getByTestId('route-decision-pending').waitFor({ state: 'detached' });
  const details = page.getByTestId('drop-details');
  if ((await details.getAttribute('open')) === null) await details.locator('summary').click();
  await page.getByTestId('drop-effect').first().waitFor();
}

async function closeSheet(page: Page): Promise<void> {
  await page.getByTestId('block-sheet').getByRole('button', { name: '닫기' }).first().click();
  await page.getByTestId('block-sheet').waitFor({ state: 'detached' });
}

/**
 * Walk every state for one device, calling `visit` once each state is on screen. The page should
 * be fresh (no storage), with the context's viewport already set for the device.
 */
export async function walkLayoutStates(
  page: Page,
  device: Device,
  visit: (state: LayoutState) => Promise<void>,
): Promise<void> {
  const menu = async (): Promise<void> => {
    await page.getByRole('button', { name: '더 보기' }).click();
    await page.getByTestId('header-menu').waitFor();
    await visit({ id: 'menu', title: '「⋯」 menu' });
    await page.keyboard.press('Escape');
    await page.getByTestId('header-menu').waitFor({ state: 'detached' });
  };

  await page.goto('./');
  await page.getByTestId('stage-floor').waitFor();
  await visit({ id: 'first-load', title: 'first load (no goals)' });
  await menu();

  // The left panel: beside the stage on a desktop, a page of its own on a phone.
  let left = page.getByTestId('panel-left');
  if (device === 'phone') {
    await page.getByRole('button', { name: '덱' }).click();
    left = page.getByTestId('page-left');
    await left.waitFor();
  }
  await left.getByRole('tab', { name: '덱' }).click();
  await visit({ id: 'deck', title: 'deck tab' });
  await left.getByRole('tab', { name: '기프트' }).click();
  await left.getByRole('textbox', { name: '기프트 검색' }).fill('불');
  await left.getByTestId('gift-tile').first().waitFor();
  await visit({ id: 'gift-search', title: 'gifts tab with search results' });

  await left.getByTestId('gift-tile').first().getByRole('button').last().click();
  await page.getByTestId('block-sheet').waitFor();
  await visit({ id: 'gift-sheet', title: 'gift sheet' });
  await closeSheet(page);

  await page.getByTestId('gift-browse-all').click();
  const browser = page.getByTestId('gift-browser');
  await browser.waitFor();
  await visit({ id: 'browser-recommended', title: '「모두 보기」 · 추천 기프트' });
  await browser.getByRole('tab', { name: '모든 기프트' }).click();
  await browser.getByTestId('gift-filters').waitFor();
  await visit({ id: 'browser-all', title: '「모두 보기」 · 모든 기프트' });

  // A planned run whose goals do not all fit: the tray holds eight goals (two with 강화), the route a
  // decision card.
  await openPlan(page);
  if (device === 'phone') {
    await page.getByRole('button', { name: '덱' }).click();
    left = page.getByTestId('page-left');
    await left.waitFor();
  }
  await left.getByRole('tab', { name: '기프트' }).click();
  await left.getByTestId('gift-chips').waitFor();
  await visit({ id: 'goals', title: 'gifts tab with eight goals, two enhanceable' });
  // The gift sheet of an enhanceable goal, at its `++` step (M130): the steps in the name row.
  const enhanced = left.locator(`[data-testid="gift-chip"][data-gift="${ENHANCEABLE[0]}"]`);
  // The corner badge cycles 강화 전 → + → ++ (M131).
  const badge = enhanced.getByTestId('gift-upgrade-badge');
  await badge.click();
  await badge.click();
  await enhanced.locator('[data-testid="gift-upgrade-badge"][data-level="2"]').waitFor();
  await enhanced.getByRole('button', { name: /자세히$/ }).click();
  await page.getByTestId('block-sheet').waitFor();
  await visit({ id: 'goal-sheet', title: 'gift sheet of an enhanced goal' });
  await closeSheet(page);
  if (device === 'phone') {
    await page.goBack();
    await left.waitFor({ state: 'detached' });
  }
  let right = page.getByTestId('panel-right');
  if (device === 'phone') {
    await page.getByTestId('toggle-panel-right').click();
    right = page.getByTestId('page-right');
    await right.waitFor();
  }
  await right.getByRole('tab', { name: '전체 루트' }).click();
  await routeReady(page);
  await visit({ id: 'route', title: 'route panel with a decision card' });
  await right.getByRole('tab', { name: '추적기' }).click();
  await page.getByTestId('tracker').waitFor();
  await visit({ id: 'tracker', title: 'tracker' });
  if (device === 'phone') {
    await page.goBack();
    await right.waitFor({ state: 'detached' });
  }

  await walkToRoutePack(page);
  await visit({ id: 'stage-pack', title: 'stage with a route pack' });
  const others = page.getByTestId('other-packs');
  await others.locator('summary').click();
  await others.getByTestId('other-pack').first().waitFor();
  await visit({ id: 'other-packs', title: 'stage with 「다른 팩」 open' });
  await others.locator('summary').click();
  const card = page.getByTestId('stage-pack').first();
  await card.getByRole('button', { name: /자세히$/ }).click();
  await page.getByTestId('block-sheet').waitFor();
  await visit({ id: 'pack-sheet', title: 'pack sheet' });
  await closeSheet(page);

  await card.getByRole('button', { name: /입장$/ }).click();
  await page.getByTestId('entered-pack').waitFor();
  await visit({ id: 'entered', title: 'stage after entering a pack' });
}
