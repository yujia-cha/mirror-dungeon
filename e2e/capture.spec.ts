import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';
import { diagnosticsBundleSchema, diagPartSchema } from '../src/core/schema.ts';
import { shareHash } from './share.ts';

/**
 * The screen reader end to end (M107): the shared window is a canvas the test paints — drawn text in
 * the layout's regions, never a game image — so the real OCR engine, the change detection and the
 * tracker all run on it in a real browser, and the run records what it read.
 *
 * Coordinates are the layout's fractions of the 1920×1009 reference (`capture-layout.json`), of
 * the game's client area: a share with a window title bar (`bar` px, M134) paints the client below it.
 */
const W = 1920;
const H = 1009;

type Region = [number, number, number, number];
type Paint = { text: string; region: Region; size: number }[];

/** Replace the share with a canvas the page can repaint through `window.__paint`. */
async function fakeShare(page: Page, frame = { width: W, height: H, bar: 0 }): Promise<void> {
  await page.addInitScript(({ width, height, bar }) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    const paint = async (items: Paint) => {
      // Pretendard ships split by unicode-range: load the subsets these glyphs live in first.
      await Promise.all(items.map((i) => document.fonts.load(`700 ${i.size}px Pretendard`, i.text)));
      ctx.fillStyle = '#16120f';
      ctx.fillRect(0, 0, width, height);
      // A light window title bar with its caption, as Windows draws one over a shared window.
      if (bar > 0) {
        ctx.fillStyle = '#f3f3f3';
        ctx.fillRect(0, 0, width, bar);
        ctx.fillStyle = '#1b1b1b';
        ctx.font = '12px sans-serif';
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        ctx.fillText('LimbusCompany', 12, bar / 2);
      }
      ctx.fillStyle = '#f4efe6';
      ctx.textBaseline = 'middle';
      for (const { text, region, size } of items) {
        const [x, y, w, h] = region;
        ctx.font = `700 ${size}px Pretendard`;
        ctx.textAlign = 'center';
        ctx.fillText(text, (x + w / 2) * width, bar + (y + h / 2) * (height - bar));
      }
    };
    (window as unknown as { __paint: typeof paint }).__paint = paint;
    void paint([]);
    // The real call needs a user gesture (transient activation): say whether this one had it (M143).
    navigator.mediaDevices.getDisplayMedia = async () => {
      (window as unknown as { __shareActive: boolean }).__shareActive = navigator.userActivation.isActive;
      return canvas.captureStream(8);
    };
  }, frame);
}

const paint = (page: Page, items: Paint) =>
  page.evaluate((all) => (window as unknown as { __paint: (p: Paint) => Promise<void> }).__paint(all), items);

test('reads an entry and a gift off the shared window, and takes them back', async ({ page }) => {
  test.setTimeout(90_000);
  await fakeShare(page);
  await page.goto('./');
  // The controls live in the header's popover (M111); the stage holds none.
  await expect(page.getByTestId('run-stage').getByTestId('capture-panel')).toHaveCount(0);
  await page.getByTestId('capture-open').click();
  const panel = page.getByTestId('capture-panel');
  await expect(panel).toBeVisible();

  await panel.getByTestId('capture-start').click();
  const status = panel.getByTestId('capture-status');
  // The OCR engine loads from our own origin; the models are a few MB.
  await expect(status).toHaveAttribute('data-status', 'running', { timeout: 45_000 });

  // The map header: 「1층 탐사 중」 over the pack's name.
  await paint(page, [
    { text: '1층 탐사 중', region: [0.01, 0.13, 0.17, 0.045], size: 34 },
    { text: '헬스치킨', region: [0.01, 0.175, 0.17, 0.045], size: 34 },
  ]);
  const log = panel.getByTestId('capture-log');
  await expect(log).toContainText('1층 입장 · 헬스치킨', { timeout: 20_000 });
  await expect(page.getByTestId('entered-pack')).toBeVisible();

  // An acquired popup: the banner title and the gift's name on its button.
  await paint(page, [
    { text: 'E.G.O 기프트를 획득했습니다.', region: [0.333, 0.205, 0.34, 0.07], size: 40 },
    { text: '커피와 종이학', region: [0.2526, 0.56, 0.138, 0.1338], size: 30 },
  ]);
  await expect(log).toContainText('획득 · 커피와 종이학', { timeout: 20_000 });
  const got = () =>
    page.evaluate(
      () =>
        JSON.parse(localStorage.getItem('md-route-planner') ?? '{}').state?.run?.giftStatus?.['9006'] ?? null,
    );
  await expect.poll(got).toBe('got');

  // Undo takes the gift back out of the run.
  await log.locator('li', { hasText: '커피와 종이학' }).getByRole('button', { name: '되돌리기' }).click();
  await expect.poll(got).toBe(null);
  await expect(log.locator('li', { hasText: '커피와 종이학' })).toContainText('되돌림');

  // A new session reads the map it stands on again: the run already holds that entry, so nothing
  // is logged twice (M116) — a duplicate's undo would have taken the entry away.
  await paint(page, [
    { text: '1층 탐사 중', region: [0.01, 0.13, 0.17, 0.045], size: 34 },
    { text: '헬스치킨', region: [0.01, 0.175, 0.17, 0.045], size: 34 },
  ]);
  await panel.getByTestId('capture-stop').click();
  // The run holds an entry now, so starting asks first (M143): reading on is 「이어서」.
  await panel.getByTestId('capture-start').click();
  await page.getByTestId('capture-run-continue').click();
  await expect(status).toHaveAttribute('data-status', 'running', { timeout: 45_000 });
  await page.waitForTimeout(3000);
  await expect(log.locator('li', { hasText: '1층 입장' })).toHaveCount(1);

  // Undoing the entry takes it out of the run.
  await log.locator('li', { hasText: '1층 입장' }).getByRole('button', { name: '되돌리기' }).click();
  await expect(page.getByTestId('entered-pack')).toHaveCount(0);

  // Closing the popover does not end the share: the header button still says it is reading.
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(page.getByTestId('capture-open')).toHaveAttribute('data-status', 'running');
  await page.getByTestId('capture-open').click();
  await page.getByTestId('capture-stop').click();
  await expect(page.getByTestId('capture-status')).toHaveAttribute('data-status', 'idle');
});

test('the owner records, exports one zip with frames, and clears the device (M112)', async ({ page }) => {
  test.setTimeout(90_000);
  await fakeShare(page);
  // Without #diag a visitor sees no diagnostics.
  await page.goto('./');
  await page.getByTestId('capture-open').click();
  await expect(page.getByTestId('capture-panel')).toBeVisible();
  await expect(page.getByTestId('diag-section')).toHaveCount(0);
  await page.keyboard.press('Escape');
  // Pasted into the open tab: a same-document navigation, caught by `hashchange`.
  await page.goto('./#diag');
  await page.getByTestId('capture-open').click();
  const diag = page.getByTestId('diag-section');
  await expect(diag).toBeVisible();
  await diag.getByRole('checkbox', { name: '진단 기록' }).check();
  await diag.getByRole('checkbox', { name: '화면 이미지 포함' }).check();

  // A read that makes an event, then the player undoes it.
  const panel = page.getByTestId('capture-panel');
  await panel.getByTestId('capture-start').click();
  await expect(panel.getByTestId('capture-status')).toHaveAttribute('data-status', 'running', {
    timeout: 45_000,
  });
  await paint(page, [
    { text: 'E.G.O 기프트를 획득했습니다.', region: [0.333, 0.205, 0.34, 0.07], size: 40 },
    { text: '커피와 종이학', region: [0.2526, 0.56, 0.138, 0.1338], size: 30 },
  ]);
  const log = panel.getByTestId('capture-log');
  await expect(log).toContainText('획득 · 커피와 종이학', { timeout: 20_000 });
  await log.locator('li', { hasText: '커피와 종이학' }).getByRole('button', { name: '되돌리기' }).click();
  await panel.getByTestId('capture-stop').click();

  // Export: one zip, holding the session and the kept frame.
  const downloading = page.waitForEvent('download');
  await diag.getByTestId('diag-export').click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/^md-diagnostics-\d{8}-\d{4}\.zip$/);
  // Kept when asked, to try `npm run capture:feedback` on a real export.
  if (process.env.DIAG_ZIP_OUT) await download.saveAs(process.env.DIAG_ZIP_OUT);
  const files = unzipSync(new Uint8Array(readFileSync((await download.path())!)));
  const bundle = diagnosticsBundleSchema.parse(JSON.parse(strFromU8(files['session.json']!)));
  // M146: a small export stays one file, saying it is part 1 of 1 and listing its frames.
  const part = diagPartSchema.parse(JSON.parse(strFromU8(files['part.json']!)));
  expect(part).toMatchObject({ bundleId: bundle.bundleId, exportedAt: bundle.exportedAt, part: 1, total: 1 });
  await expect(diag.getByTestId('diag-saved')).toHaveAttribute('data-parts', '1');
  await expect(diag.getByTestId('diag-split')).toHaveCount(0);
  const kinds = new Set(bundle.records.map((r) => r.kind));
  expect([...kinds]).toEqual(expect.arrayContaining(['session', 'read', 'applied', 'undo']));
  const popupRead = bundle.records.find((r) => r.kind === 'read' && r.events.length > 0);
  expect(popupRead?.kind === 'read' && popupRead.trace.length).toBeGreaterThan(0);
  const frames = Object.keys(files).filter((name) => name.startsWith('frames/'));
  expect(frames.length).toBe(bundle.frames.length);
  expect(frames.length).toBeGreaterThan(0);
  expect([...part.frames].sort()).toEqual([...frames].sort());
  expect(files[frames[0]!]!.slice(0, 2)).toEqual(new Uint8Array([0xff, 0xd8])); // JPEG
  // M134: the undone event's frame is evidence, and a filmstrip of tick previews surrounds it
  // (ended by Stop). When the popup came while a full read was busy, it was read from the queue
  // (M141): a crop, which keeps no frame by design — the filmstrip holds its ticks. Which of the
  // two happens is the timing of the paint against the read in flight.
  if (popupRead?.kind !== 'read') throw new Error('no popup read');
  if (popupRead.queued) expect(popupRead.frameId).toBeNull();
  else expect(bundle.frames.find((f) => f.id === popupRead.frameId)?.class).toBe('evidence');
  expect(popupRead.busyTicks).toBeGreaterThanOrEqual(0);
  const strip = bundle.records.find((r) => r.kind === 'strip');
  expect(strip?.kind === 'strip' && strip.reads).toContain(popupRead.t);
  const previews = bundle.frames.filter((f) => f.class === 'preview').map((f) => f.id);
  expect(previews.length).toBeGreaterThan(0);
  expect(strip?.kind === 'strip' && strip.frameIds).toEqual(previews);

  // The clean-up step clears exactly that, and says where the file goes.
  await expect(diag.getByTestId('diag-where')).toContainText('Claude Code');
  await diag.getByTestId('diag-clear-exported').click();
  await expect(diag.getByTestId('diag-stats')).toHaveAttribute('data-records', '0');
  // And it stays cleared across a reload (IndexedDB).
  await page.reload();
  await page.getByTestId('capture-open').click();
  await expect(page.getByTestId('diag-stats')).toHaveAttribute('data-records', '0');
});

test('reads a window shared with its title bar, and records the size and the bar (M134)', async ({
  page,
}) => {
  test.setTimeout(90_000);
  // The owner's session: a 1928×1013 client under a 30px light title bar.
  await fakeShare(page, { width: 1928, height: 1043, bar: 30 });
  await page.goto('./#diag');
  await page.getByTestId('capture-open').click();
  const diag = page.getByTestId('diag-section');
  await diag.getByRole('checkbox', { name: '진단 기록' }).check();
  const panel = page.getByTestId('capture-panel');
  await panel.getByTestId('capture-start').click();
  await expect(panel.getByTestId('capture-status')).toHaveAttribute('data-status', 'running', {
    timeout: 45_000,
  });

  // Without moving the regions below the bar, the pack's name falls out of the map header.
  await paint(page, [
    { text: '1층 탐사 중', region: [0.01, 0.13, 0.17, 0.045], size: 34 },
    { text: '헬스치킨', region: [0.01, 0.175, 0.17, 0.045], size: 34 },
  ]);
  await expect(panel.getByTestId('capture-log')).toContainText('1층 입장 · 헬스치킨', { timeout: 20_000 });
  await panel.getByTestId('capture-stop').click();

  const downloading = page.waitForEvent('download');
  await diag.getByTestId('diag-export').click();
  const files = unzipSync(new Uint8Array(readFileSync((await (await downloading).path())!)));
  const bundle = diagnosticsBundleSchema.parse(JSON.parse(strFromU8(files['session.json']!)));
  expect(bundle.records).toContainEqual(
    expect.objectContaining({
      kind: 'session',
      captureSize: { width: 1928, height: 1043 },
      inset: { top: 30 },
    }),
  );
});

test('reads the run start: only the popup it saw records a gift — the other pick stays un-got (M135, M136)', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await fakeShare(page);
  // Two goals the observation picker will take: 프레스티지 카드 and 다한 쓸모, 맺힌 증오.
  await page.goto(`./${shareHash([9191, 9809], 8)}`);
  await page.getByTestId('capture-open').click();
  const panel = page.getByTestId('capture-panel');
  await panel.getByTestId('capture-start').click();
  await expect(panel.getByTestId('capture-status')).toHaveAttribute('data-status', 'running', {
    timeout: 45_000,
  });

  // The observation picker with both picked: its title, the side panel's names and 「선택 2/3」 —
  // the panel is on screen, but only a popup records a gift (M136, owner's decision).
  const title = { text: 'E.G.O 기프트 관측', region: [0.1094, 0.0396, 0.1615, 0.0595] as Region, size: 40 };
  await paint(page, [
    title,
    { text: '프레스티지 카드', region: [0.724, 0.2825, 0.1979, 0.0347], size: 26 },
    { text: '다한 쓸모, 맺힌 증오', region: [0.724, 0.446, 0.1979, 0.0347], size: 26 },
    { text: '선택 2/3', region: [0.7969, 0.783, 0.125, 0.0743], size: 34 },
  ]);
  // Nothing to log; give the reader time to see the picker.
  await page.waitForTimeout(6000);

  // One popup over the picker; the other went by unseen.
  await paint(page, [
    title,
    { text: 'E.G.O 기프트를 획득했습니다.', region: [0.333, 0.205, 0.34, 0.07], size: 40 },
    { text: '프레스티지 카드', region: [0.2526, 0.56, 0.138, 0.1338], size: 30 },
  ]);
  const log = panel.getByTestId('capture-log');
  await expect(log).toContainText('관측으로 획득 · 프레스티지 카드', { timeout: 20_000 });

  // Floor 1's pack picker: the start is over. The pick whose popup went by unseen is not got.
  await paint(page, [{ text: '1층 테마팩 선택', region: [0.33, 0.075, 0.34, 0.105], size: 48 }]);
  await expect(log).toContainText('시작 단계 끝', { timeout: 20_000 });
  await expect(log).not.toContainText('다한 쓸모');

  const saved = () =>
    page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem('md-route-planner') ?? '{}').state ?? {};
      return {
        got: [9191, 9809].map((id) => state.run?.giftStatus?.[id] ?? null),
        observed: [...(state.options?.observedGifts ?? [])].sort((a: number, b: number) => a - b),
        startDone: state.run?.startDone ?? false,
      };
    });
  await expect.poll(saved).toEqual({ got: ['got', null], observed: [9191], startDone: true });

  // Undoing the end of the start opens it again.
  await log.locator('li', { hasText: '시작 단계 끝' }).getByRole('button', { name: '되돌리기' }).click();
  await expect.poll(async () => (await saved()).startDone).toBe(false);
  await panel.getByTestId('capture-stop').click();
});

test('starting the reader over an old run starts a new one, reads its start, and rolls back (M143)', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await fakeShare(page);
  await page.goto(`./${shareHash([9191, 9809], 8)}`);
  // An old run's record: floor 1 skipped on the stage, so its start is closed.
  await page.getByRole('button', { name: '다음 층' }).first().click();
  const saved = () =>
    page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem('md-route-planner') ?? '{}').state ?? {};
      return {
        floor: state.run?.currentFloor ?? null,
        got: state.run?.giftStatus?.['9191'] ?? null,
        snapshotFloor: state.runSnapshot?.run?.currentFloor ?? null,
      };
    });
  await expect.poll(async () => (await saved()).floor).toBe(2);
  const old = await saved();

  // Starting asks first; 「새 런으로 시작」 starts the share from the dialog's own press.
  await page.getByTestId('capture-open').click();
  const panel = page.getByTestId('capture-panel');
  await panel.getByTestId('capture-start').click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('지난 런의 기록이 남아 있습니다');
  await dialog.getByRole('button', { name: '새 런으로 시작' }).click();
  await expect(panel.getByTestId('capture-status')).toHaveAttribute('data-status', 'running', {
    timeout: 45_000,
  });
  await expect.poll(saved).toEqual({ floor: 1, got: null, snapshotFloor: 2 });
  // Asked from inside the dialog's press, so a real browser would show its picker.
  expect(await page.evaluate(() => (window as unknown as { __shareActive: boolean }).__shareActive)).toBe(
    true,
  );
  await expect(panel.getByTestId('capture-run-note')).toContainText('정해지는 것: 시작 기프트·관측');

  // The fresh run's start is open, so the reader looks for the observation screen.
  const title = { text: 'E.G.O 기프트 관측', region: [0.1094, 0.0396, 0.1615, 0.0595] as Region, size: 40 };
  await paint(page, [title]);
  await page.waitForTimeout(2000);
  await paint(page, [
    title,
    { text: 'E.G.O 기프트를 획득했습니다.', region: [0.333, 0.205, 0.34, 0.07], size: 40 },
    { text: '프레스티지 카드', region: [0.2526, 0.56, 0.138, 0.1338], size: 30 },
  ]);
  await expect(panel.getByTestId('capture-log')).toContainText('관측으로 획득 · 프레스티지 카드', {
    timeout: 20_000,
  });
  await expect.poll(async () => (await saved()).got).toBe('got');

  // 「런 중단 · 시작 전으로 되돌리기」 stops reading and brings the old run back.
  await panel.getByTestId('capture-rollback').click();
  await expect(page.getByTestId('capture-rollback-list')).toContainText('획득·미획득 기록 1개');
  await page.getByRole('alertdialog').getByRole('button', { name: '시작 전으로 되돌리기' }).click();
  await expect(panel.getByTestId('capture-status')).toHaveAttribute('data-status', 'idle');
  await expect.poll(saved).toEqual({ ...old, snapshotFloor: null });
  await expect(panel.getByTestId('capture-rollback')).toHaveCount(0);
});
