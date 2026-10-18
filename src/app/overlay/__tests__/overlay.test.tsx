import { act, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadGameDataFromDisk } from '../../../core/data/node.ts';
import { buildIndexes } from '../../../core/index.ts';
import type { FloorPlan, RoutePlan } from '../../../core/types.ts';
import { pick } from '../../i18n.ts';
import { FeedbackLog } from '../../lib/feedback-log.ts';
import { FactLog } from '../overlay-log.ts';
import { emptyRun, useApp } from '../../store.ts';
import { CaptureContext, type CaptureApi } from '../../capture/capture-context.ts';
import type { CaptureLogEntry, CaptureQuestion } from '../../capture/useCapture.ts';

const data = loadGameDataFromDisk();
const indexes = buildIndexes(data);
const offeredOn2 = indexes.packsByFloor.hard.get(2) ?? [];
const PACK_1 = indexes.packsByFloor.hard.get(1)![0]!;
const PACK_2 = offeredOn2[0]!;
/** A route pack seated on floor 3 whose window reaches back to floor 2. */
const PACK_3 = offeredOn2[1]!;
const [GIFT_A, GIFT_B, GIFT_C] = data.gifts.slice(0, 3).map((gift) => gift.id) as [number, number, number];
const giftLabel = (id: number) => pick(indexes.giftById.get(id)!.name, 'ko');
const packLabel = (id: number) => pick(indexes.packById.get(id)!.name, 'ko');

const floorPlan = (over: Partial<FloorPlan>): FloorPlan => ({
  floor: 1,
  mode: 'hard',
  packId: null,
  reason: 'required',
  passed: false,
  pickups: [],
  observation: { needed: false, possible: true, starlight: 0 },
  alternatives: [],
  window: null,
  ...over,
});

/** The slice of the plan context the overlay reads; tests change it per case. */
const plan = {
  indexes,
  lang: 'ko' as const,
  shown: null as RoutePlan | null,
  packName: packLabel,
  expectedIn: (floor: number, _packId: number): number[] => (floor === 1 ? [GIFT_A, GIFT_B, GIFT_C] : []),
  confirmStart: vi.fn(),
  reopenStart: vi.fn(),
  data,
  needed: new Set<number>(),
  exclusivesOf: (packId: number): number[] => (packId === PACK_1 ? [GIFT_A, GIFT_B] : []),
};
vi.mock('../../shell/plan-context.ts', () => ({ usePlan: () => plan }));

const { OverlayView } = await import('../OverlayView.tsx');
const { OverlayProvider } = await import('../OverlayProvider.tsx');
const { OverlayToggle } = await import('../OverlayToggle.tsx');
const { mirrorDocument, useOverlayWindow } = await import('../useOverlayWindow.ts');

function captureOf(over: Partial<CaptureApi> = {}): CaptureApi {
  return {
    supported: true,
    status: 'idle',
    error: null,
    log: [] as CaptureLogEntry[],
    questions: [] as CaptureQuestion[],
    start: async () => undefined,
    stop: () => undefined,
    undo: () => undefined,
    answer: () => undefined,
    applying: { current: false },
    diagnostics: {} as CaptureApi['diagnostics'],
    ...over,
  } as CaptureApi;
}

const withCapture = (capture: CaptureApi) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return <CaptureContext.Provider value={capture}>{children}</CaptureContext.Provider>;
  };

/** A stand-in for the browser's PiP: an iframe's window, whose `close` fires `pagehide` like a real one. */
function fakePictureInPicture() {
  const frames: HTMLIFrameElement[] = [];
  const api = {
    requestWindow: vi.fn(async () => {
      const frame = document.createElement('iframe');
      document.body.append(frame);
      frames.push(frame);
      const win = frame.contentWindow! as Window & typeof globalThis;
      Object.defineProperty(win, 'close', {
        configurable: true,
        value: () => win.dispatchEvent(new win.Event('pagehide')),
      });
      return win as Window;
    }),
  };
  return { api, frames };
}

beforeEach(() => {
  useApp.setState({ run: emptyRun(), wanted: [], lang: 'ko', lastFloor: 15 });
  plan.shown = null;
  plan.confirmStart.mockClear();
  plan.reopenStart.mockClear();
});

afterEach(() => {
  Reflect.deleteProperty(window, 'documentPictureInPicture');
  for (const node of document.querySelectorAll('iframe, [data-test-style]')) node.remove();
  document.documentElement.removeAttribute('class');
  document.documentElement.removeAttribute('data-text-scale');
});

describe('OverlayView (M132)', () => {
  it('shows the state, the floor, the next pack, what is left and the recent actions', () => {
    // Arrange: floor 1 entered with one of three gifts in hand; the route enters PACK_2 on floor 2,
    // and PACK_3, seated on floor 3, may be entered on floor 2 too.
    useApp.setState({
      run: {
        ...emptyRun(),
        currentFloor: 2,
        stageFloor: 2,
        visits: { 1: PACK_1 },
        giftStatus: { [GIFT_B]: 'got' },
      },
    });
    plan.shown = {
      floors: [
        floorPlan({ floor: 2, packId: PACK_2, window: { from: 2, to: 2 } }),
        floorPlan({ floor: 3, packId: PACK_3, window: { from: 2, to: 3 } }),
      ],
    } as unknown as RoutePlan;
    const log = new FeedbackLog(50, () => 1_000);
    const facts = new FactLog(() => 1_000);
    facts.push([{ kind: 'enter', floor: 1, packId: PACK_1 }]);
    const capture = captureOf({
      log: [{ id: 1, at: 2_000, event: { kind: 'got', giftId: GIFT_B }, actions: [], undone: true }],
    });
    const target = document.createElement('div');
    document.body.append(target);
    // Act
    render(<OverlayView target={target} log={log} facts={facts} />, { wrapper: withCapture(capture) });
    // Assert: everything lands in the target, not in the page's own container.
    const overlay = within(target).getByTestId('overlay');
    const status = within(overlay).getByTestId('overlay-status');
    expect(status).toHaveAttribute('data-status', 'idle');
    expect(status).toHaveTextContent('화면 인식 꺼짐');
    expect(within(overlay).getByTestId('overlay-floor')).toHaveTextContent('2/ 15');
    const next = within(overlay).getByTestId('overlay-next');
    expect(next).toHaveAttribute('data-kind', 'pack');
    expect(next).toHaveTextContent('2층에 들어갈 수 있는 팩');
    // Every pack the floor can take, the one planned here first (M148).
    const rows = [...within(next).getByTestId('overlay-pack-list').querySelectorAll('[data-pack]')];
    expect(rows.map((row) => Number(row.getAttribute('data-pack')))).toEqual([PACK_2, PACK_3]);
    expect(rows.map((row) => row.hasAttribute('data-planned'))).toEqual([true, false]);
    expect(rows[1]).toHaveTextContent(packLabel(PACK_3));
    const remaining = within(overlay).getByTestId('overlay-remaining');
    expect(remaining).toHaveTextContent(`1층 · ${packLabel(PACK_1)}`);
    const left = within(remaining).getByTestId('overlay-remaining-list');
    expect(
      [...left.querySelectorAll('[data-gift]')].map((row) => Number(row.getAttribute('data-gift'))),
    ).toEqual([GIFT_A, GIFT_C]);
    expect(left).toHaveTextContent(giftLabel(GIFT_A));
    // Past the start nothing in the window can be pressed or followed.
    expect(overlay.querySelectorAll('button, a, input, [role="button"]')).toHaveLength(0);
    const recent = within(overlay).getByTestId('overlay-recent');
    const lines = within(recent).getAllByRole('listitem');
    // Sentences with names (M151): the reader's entry tagged, its undo said; the run's entry by hand.
    expect(lines[0]).toHaveTextContent(`인식「${giftLabel(GIFT_B)}」 기프트를 획득했습니다 · 되돌림`);
    expect(lines[1]).toHaveTextContent(`1층 「${packLabel(PACK_1)}」에 입장했습니다`);
    expect(screen.queryByTestId('overlay')).toBe(overlay);
  });

  it('says reading, how many questions wait, and that nothing was entered yet', () => {
    // Arrange: a fresh run, the reader running with two questions.
    const capture = captureOf({
      status: 'running',
      questions: [
        { id: 1, ask: { kind: 'gift', ids: [GIFT_A, GIFT_B] } },
        { id: 2, ask: { kind: 'pack', floor: 1, ids: [PACK_1] } },
      ] as CaptureQuestion[],
    });
    const target = document.createElement('div');
    // Act
    render(<OverlayView target={target} log={new FeedbackLog()} />, { wrapper: withCapture(capture) });
    // Assert
    expect(within(target).getByTestId('overlay-status')).toHaveTextContent('● 인식 중');
    expect(within(target).getByTestId('overlay-asking')).toHaveTextContent('확인할 것 2개');
    expect(within(target).getByTestId('overlay-next')).toHaveAttribute('data-kind', 'noPlan');
    expect(within(target).getByTestId('overlay-remaining')).toHaveTextContent('아직 입장한 팩이 없습니다');
    expect(within(target).getByTestId('overlay-recent')).toHaveTextContent('아직 없습니다');
  });

  it('says an error in a word and a sentence, and the end of the run', () => {
    useApp.setState({ run: { ...emptyRun(), currentFloor: 16, stageFloor: 16 } });
    const target = document.createElement('div');
    render(<OverlayView target={target} log={new FeedbackLog()} />, {
      wrapper: withCapture(captureOf({ status: 'error', error: 'ended' })),
    });
    expect(within(target).getByTestId('overlay-status')).toHaveTextContent('오류');
    expect(within(target).getByTestId('overlay-head')).toHaveTextContent('화면 공유가 끝났습니다');
    expect(within(target).getByTestId('overlay-next')).toHaveAttribute('data-kind', 'done');
    // Past the end the floor reads the last floor, like the stage header.
    expect(within(target).getByTestId('overlay-floor')).toHaveTextContent('15/ 15');
  });
});

describe('OverlayView run start (M138)', () => {
  const startPlan = () =>
    ({
      floors: [],
      start: {
        startGifts: [GIFT_A],
        observed: [
          { giftId: GIFT_B, pinned: true, freedPack: null },
          { giftId: GIFT_C, pinned: false, freedPack: null },
        ],
      },
    }) as unknown as RoutePlan;

  it('lists the expected start all on, and confirms only what is left on', async () => {
    // Arrange
    const user = userEvent.setup();
    plan.shown = startPlan();
    const target = document.createElement('div');
    document.body.append(target);
    render(<OverlayView target={target} log={new FeedbackLog()} />, { wrapper: withCapture(captureOf()) });
    const section = within(target).getByTestId('overlay-start');
    const rows = within(section).getAllByTestId('overlay-start-gift');
    expect(rows.map((row) => row.getAttribute('data-kind'))).toEqual(['start', 'pinned', 'recommended']);
    expect(rows.every((row) => row.getAttribute('aria-pressed') === 'true')).toBe(true);
    expect(rows[1]).toHaveTextContent('지정됨');
    expect(rows[2]).toHaveTextContent('추천');
    // Act: the pinned observation did not come.
    await user.click(rows[1]!);
    await user.click(within(section).getByTestId('overlay-start-confirm'));
    // Assert
    expect(rows[1]).toHaveAttribute('aria-pressed', 'false');
    expect(plan.confirmStart).toHaveBeenCalledWith({
      got: [GIFT_A, GIFT_C],
      dropped: [GIFT_B],
      observed: [GIFT_C],
    });
  });

  it('with the reader running, shows what floor 1 collected with nothing to press (M140, M141)', () => {
    // Arrange: the reader saw the pinned GIFT_B and an unplanned gift; the start gift's popup went by.
    const extra = data.gifts[3]!.id;
    plan.shown = startPlan();
    useApp.setState({ run: { ...emptyRun(), giftStatus: { [GIFT_B]: 'got', [extra]: 'got' } } });
    const target = document.createElement('div');
    // Act
    render(<OverlayView target={target} log={new FeedbackLog()} />, {
      wrapper: withCapture(captureOf({ status: 'running' })),
    });
    // Assert: the same rows in the same order, the recorded ones collected, the rest dotted.
    const section = within(target).getByTestId('overlay-start');
    expect(section).toHaveAttribute('data-live');
    expect(section).toHaveTextContent('1층 테마팩 선택에서 자동으로 확정됩니다');
    const rows = within(section).getAllByTestId('overlay-start-gift');
    expect(
      rows.map((row) => [
        Number(row.getAttribute('data-gift')),
        row.getAttribute('data-kind'),
        row.hasAttribute('data-got'),
      ]),
    ).toEqual([
      [GIFT_A, 'start', false],
      [GIFT_B, 'pinned', true],
      [GIFT_C, 'recommended', false],
      [extra, 'got', true],
    ]);
    expect(rows[3]).toHaveTextContent('획득');
    // No toggle and no confirm: the reader settles the start on floor 1's pack select.
    expect(section.querySelectorAll('[aria-pressed]')).toHaveLength(0);
    expect(section.querySelectorAll('button, a, input, [role="button"]')).toHaveLength(0);
    expect(within(target).queryByTestId('overlay-start-confirm')).toBeNull();
  });

  it('with the reader running and nothing seen yet, lists every expected gift as not yet seen (M141)', () => {
    plan.shown = startPlan();
    const target = document.createElement('div');
    render(<OverlayView target={target} log={new FeedbackLog()} />, {
      wrapper: withCapture(captureOf({ status: 'running' })),
    });
    const rows = within(target).getAllByTestId('overlay-start-gift');
    expect(rows.map((row) => Number(row.getAttribute('data-gift')))).toEqual([GIFT_A, GIFT_B, GIFT_C]);
    expect(rows.some((row) => row.hasAttribute('data-got'))).toBe(false);
  });

  it('with the reader running, turns into the confirmed line once the store settles the start (M141)', () => {
    // Arrange: one observation popup seen, the start still open.
    plan.shown = startPlan();
    useApp.setState({ run: { ...emptyRun(), giftStatus: { [GIFT_B]: 'got' } } });
    const target = document.createElement('div');
    render(<OverlayView target={target} log={new FeedbackLog()} />, {
      wrapper: withCapture(captureOf({ status: 'running' })),
    });
    expect(within(target).getByTestId('overlay-start')).toHaveAttribute('data-live');
    // Act: the reader saw floor 1's theme pack select (tracker startDone → settleStart).
    act(() => {
      useApp.getState().settleStart();
    });
    // Assert
    expect(within(target).queryByTestId('overlay-start')).toBeNull();
    expect(within(target).getByTestId('overlay-start-done')).toHaveTextContent('시작 확인 · 획득 1');
    expect(plan.confirmStart).not.toHaveBeenCalled();
  });

  it('with the reader stopped, offers the toggles and the confirm again', () => {
    // Arrange: the reader recorded GIFT_B, then stopped before the start was settled.
    plan.shown = startPlan();
    useApp.setState({ run: { ...emptyRun(), giftStatus: { [GIFT_B]: 'got' } } });
    const target = document.createElement('div');
    document.body.append(target);
    // Act
    render(<OverlayView target={target} log={new FeedbackLog()} />, {
      wrapper: withCapture(captureOf({ status: 'idle' })),
    });
    // Assert: the plan's guess, all on, to correct by hand.
    const section = within(target).getByTestId('overlay-start');
    expect(section).not.toHaveAttribute('data-live');
    const rows = within(section).getAllByTestId('overlay-start-gift');
    expect(rows.every((row) => row.getAttribute('aria-pressed') === 'true')).toBe(true);
    expect(within(section).getByTestId('overlay-start-confirm')).toBeInTheDocument();
  });

  it('says the start is confirmed on floor 1 and offers to choose again', async () => {
    const user = userEvent.setup();
    plan.shown = startPlan();
    useApp.setState({ run: { ...emptyRun(), startDone: true, startGifts: [GIFT_A, GIFT_C] } });
    const target = document.createElement('div');
    document.body.append(target);
    render(<OverlayView target={target} log={new FeedbackLog()} />, { wrapper: withCapture(captureOf()) });

    expect(within(target).queryByTestId('overlay-start')).toBeNull();
    expect(within(target).getByTestId('overlay-start-done')).toHaveTextContent('시작 확인 · 획득 2');
    await user.click(within(target).getByTestId('overlay-start-reopen'));
    expect(plan.reopenStart).toHaveBeenCalledTimes(1);
  });

  it('shows nothing about the start past floor 1', () => {
    plan.shown = startPlan();
    useApp.setState({ run: { ...emptyRun(), currentFloor: 2, stageFloor: 2, startGifts: [GIFT_A] } });
    const target = document.createElement('div');
    render(<OverlayView target={target} log={new FeedbackLog()} />, { wrapper: withCapture(captureOf()) });
    expect(within(target).queryByTestId('overlay-start')).toBeNull();
    expect(within(target).queryByTestId('overlay-start-done')).toBeNull();
  });
});

describe('OverlayView in the shop (M148)', () => {
  it('shows this floor’s exclusives marked got or not and the tier-4 gifts instead of the next pack', () => {
    // Arrange: floor 1 entered, one of two goals in hand, the reader in the shop.
    useApp.setState({
      run: {
        ...emptyRun(),
        currentFloor: 2,
        stageFloor: 2,
        visits: { 1: PACK_1 },
        giftStatus: { [GIFT_A]: 'got' },
      },
      wanted: [GIFT_A, GIFT_C],
    });
    const target = document.createElement('div');
    // Act
    render(<OverlayView target={target} log={new FeedbackLog()} />, {
      wrapper: withCapture(captureOf({ status: 'running', inShop: true })),
    });
    // Assert
    expect(within(target).queryByTestId('overlay-next')).toBeNull();
    expect(within(target).queryByTestId('overlay-remaining')).toBeNull();
    const exclusive = within(target).getByTestId('overlay-shop-exclusive');
    expect(exclusive).toHaveTextContent(packLabel(PACK_1));
    expect(
      [...exclusive.querySelectorAll('[data-gift]')].map((n) => Number(n.getAttribute('data-gift'))),
    ).toEqual([GIFT_A, GIFT_B]);
    expect(
      within(target).getByTestId('overlay-shop-t4').querySelectorAll('[data-gift]').length,
    ).toBeGreaterThan(0);
    // M151: each exclusive says whether the run has it; the goals left are not listed any more.
    const got = exclusive.querySelector(`[data-gift="${GIFT_A}"]`)!;
    expect(got).toHaveAttribute('data-status', 'got');
    expect(got).toHaveTextContent('획득');
    const missing = exclusive.querySelector(`[data-gift="${GIFT_B}"]`)!;
    expect(missing).toHaveAttribute('data-status', 'missing');
    expect(missing).toHaveTextContent('미획득');
    expect(missing.querySelector('[data-pending]')).not.toBeNull();
    expect(within(target).queryByTestId('overlay-shop-goals')).toBeNull();
    expect(within(target).queryByTestId('overlay-recent')).not.toBeNull();
  });

  it('goes back to the next pack once the reader is out of the shop', () => {
    const target = document.createElement('div');
    render(<OverlayView target={target} log={new FeedbackLog()} />, {
      wrapper: withCapture(captureOf({ status: 'running', inShop: false })),
    });
    expect(within(target).queryByTestId('overlay-next')).not.toBeNull();
    expect(within(target).queryByTestId('overlay-shop-exclusive')).toBeNull();
  });
});

describe('mirrorDocument', () => {
  it('copies the theme attributes and the stylesheets, and follows their changes', async () => {
    // Arrange: a page in dark, extra-large text, with a stylesheet link and a Vite-style <style>.
    const root = document.documentElement;
    root.className = 'dark';
    root.setAttribute('data-text-scale', 'xl');
    root.lang = 'ko';
    root.style.overflow = 'hidden';
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/assets/index.css';
    link.setAttribute('data-test-style', '');
    const style = document.createElement('style');
    style.textContent = 'body { color: red; }';
    style.setAttribute('data-test-style', '');
    document.head.append(link, style);
    const frame = document.createElement('iframe');
    document.body.append(frame);
    const to = frame.contentDocument!;
    // Act
    const stop = mirrorDocument(document, to);
    // Assert: the attributes but not the page's inline style (a scroll lock is not a theme).
    expect(to.documentElement.className).toBe('dark');
    expect(to.documentElement.getAttribute('data-text-scale')).toBe('xl');
    expect(to.documentElement.lang).toBe('ko');
    expect(to.documentElement.hasAttribute('style')).toBe(false);
    const copiedLink = to.head.querySelector('link[rel="stylesheet"]')!;
    expect(copiedLink.getAttribute('href')).toBe(link.href);
    expect(link.href).toMatch(/^https?:\/\//);
    expect([...to.head.querySelectorAll('style')].map((node) => node.textContent)).toContain(
      'body { color: red; }',
    );
    expect(to.head.querySelector('base')?.getAttribute('href')).toBe(document.baseURI);
    // Act: the theme, the text size and the Vite-injected CSS change; the link goes.
    root.classList.remove('dark');
    root.setAttribute('data-text-scale', 'sm');
    style.textContent = 'body { color: blue; }';
    link.remove();
    // Assert
    await waitFor(() => expect(to.documentElement.getAttribute('data-text-scale')).toBe('sm'));
    expect(to.documentElement.className).toBe('');
    await waitFor(() => expect(to.head.querySelector('link[rel="stylesheet"]')).toBeNull());
    expect([...to.head.querySelectorAll('style')].map((node) => node.textContent)).toContain(
      'body { color: blue; }',
    );
    stop();
    root.removeAttribute('style');
  });
});

describe('useOverlayWindow', () => {
  it('opens one window, names it, and forgets it on pagehide', async () => {
    // Arrange
    const { api } = fakePictureInPicture();
    const { result } = renderHook(() => useOverlayWindow('거울 던전 오버레이', api));
    expect(result.current).toMatchObject({ supported: true, window: null });
    // Act
    await act(() => result.current.open());
    // Assert
    const win = result.current.window! as Window & typeof globalThis;
    expect(api.requestWindow).toHaveBeenCalledWith({ width: 320, height: 480 });
    expect(win.document.title).toBe('거울 던전 오버레이');
    await act(() => result.current.open());
    expect(api.requestWindow).toHaveBeenCalledTimes(1);
    // Act: the window's own close button.
    act(() => {
      win.dispatchEvent(new win.Event('pagehide'));
    });
    // Assert
    expect(result.current.window).toBeNull();
  });

  it('is unsupported without the API and stays closed when the browser refuses', async () => {
    const { result } = renderHook(() => useOverlayWindow('t', null));
    expect(result.current.supported).toBe(false);
    const refusing = { requestWindow: vi.fn(async () => Promise.reject(new Error('no gesture'))) };
    const { result: refused } = renderHook(() => useOverlayWindow('t', refusing));
    await act(() => refused.current.open());
    expect(refused.current.window).toBeNull();
  });
});

describe('overlay toggle in the 「화면 인식」 popover', () => {
  const renderToggle = () =>
    render(
      <OverlayProvider>
        <OverlayToggle />
      </OverlayProvider>,
      { wrapper: withCapture(captureOf()) },
    );

  it('is not drawn where the browser has no Document Picture-in-Picture', () => {
    renderToggle();
    expect(screen.queryByTestId('overlay-toggle')).toBeNull();
  });

  it('opens the window with the overlay in it, and closes it again', async () => {
    // Arrange: a browser with the API.
    const user = userEvent.setup();
    const { api, frames } = fakePictureInPicture();
    Object.defineProperty(window, 'documentPictureInPicture', { configurable: true, value: api });
    renderToggle();
    const toggle = screen.getByTestId('overlay-toggle');
    expect(toggle).toHaveTextContent('오버레이 창 열기');
    // Act
    await user.click(toggle);
    // Assert: the contents are in the window's body, not in the page.
    const body = frames[0]!.contentDocument!.body;
    await waitFor(() => expect(within(body).getByTestId('overlay')).toBeInTheDocument());
    expect(screen.queryByTestId('overlay')).toBeNull();
    expect(frames[0]!.contentDocument!.title).toBe('거울 던전 오버레이');
    expect(toggle).toHaveTextContent('오버레이 창 닫기');
    // Act
    await user.click(toggle);
    // Assert
    expect(toggle).toHaveTextContent('오버레이 창 열기');
    expect(within(body).queryByTestId('overlay')).toBeNull();
  });
});
