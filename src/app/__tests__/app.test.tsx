/**
 * UI pieces with logic of their own: the store, share links, condition wording, the setup tabs,
 * the run stage and the side panels. Rendering uses the real generated data, like the planner
 * tests. jsdom has no matchMedia, so the shell renders as a phone unless a test stubs it.
 */
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import lzString from 'lz-string';
import userEvent from '@testing-library/user-event';
import { loadGameDataFromDisk } from '../../core/data/node.ts';
import { analyseDeck, buildIndexes, defaultOptions, evaluateConditions } from '../../core/index.ts';
import { conditionText, josa, reachedTierText } from '../condition-text.ts';
import { PERSIST_KEY, PERSIST_VERSION, appDefaultOptions, decodeShared, defaultUi, emptyRun, encodeShared, sanitizeOptions, sanitizePersisted, sanitizeRun, sanitizeUi, sinnerOf, useApp, withoutLegacyGot } from '../store.ts';
import { planInputFor } from '../lib/plan-input.ts';
import { classifyGift, compareEntries, prioritiseGifts } from '../lib/gift-priority.ts';
import { defaultDeck } from '../lib/default-deck.ts';
import { tierLabel } from '../lib/labels.ts';
import { DeckStep } from '../steps/DeckStep.tsx';
import { GiftsStep } from '../steps/GiftsStep.tsx';
import { GiftIcon } from '../components/GiftIcon.tsx';
import { App } from '../App.tsx';
import { ErrorBoundary } from '../ErrorBoundary.tsx';
import { AppShell } from '../shell/AppShell.tsx';
import { PlanProvider } from '../shell/PlanContext.tsx';
import { RoutePlanPanel } from '../shell/RoutePlanPanel.tsx';
import { GoalsPanel } from '../shell/GoalsPanel.tsx';
import { RouteOptions } from '../shell/RouteOptions.tsx';
import { RunStage } from '../stage/RunStage.tsx';
import { Tracker } from '../tracker/Tracker.tsx';
import { planToText } from '../lib/plan-text.ts';
import { actionsFor } from '../lib/unresolved-actions.ts';
import { keywordName } from '../format.ts';
import { observable as observableGift, planRoute } from '../../core/index.ts';
// Namespace import so the mock factory can spread the real module (the lint rule forbids an
// inline `import()` type annotation).
import type * as LoadModule from '../../core/data/load.ts';


// The real module fetches; tests read the generated files off disk instead. Spread the real module
// so anything it exports but this factory does not name (`DataLoadError`, which `App` needs for
// `instanceof`) still resolves — a partial mock of it used to be a latent crash.
vi.mock('../../core/data/load.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof LoadModule>();
  const { loadGameDataFromDisk, readSeasonIndex } = await import('../../core/data/node.ts');
  return {
    ...actual,
    loadGameData: async (_base?: string, options?: { season?: number }) =>
      loadGameDataFromDisk(undefined, options?.season),
    loadSeasonIndex: async () => readSeasonIndex(),
    // No art is committed yet, and jsdom has no server to fetch one from.
    loadArtManifest: async () => null,
  };
});

const data = loadGameDataFromDisk();
const indexes = buildIndexes(data);
const statsFor = (deck: number[], deployed?: number[]) => analyseDeck(deck, indexes, data.rules.deployment, deployed);

/** A combustion-heavy formation, one identity per sinner. */
/** The six EXTREME clear rewards: five floors cannot hold them all, and none can be observed. */
const CLEAR_REWARDS = [9250, 9251, 9252, 9253, 9254, 9255];

const BURN_DECK = [10112, 10216, 10311, 10415, 10512, 10604, 10715, 10808, 10916, 11009, 11115, 11216];
/** The app's default deck (LCB 수감자 ×12); its dominant keyword is Burst. */
const LCB_DECK = [10101, 10201, 10301, 10401, 10501, 10601, 10701, 10801, 10901, 11001, 11101, 11201];

beforeEach(() => {
  useApp.setState({ deck: [], deployed: [], wanted: [], priority: {}, fusionGoal: {}, run: emptyRun(), ui: defaultUi(), options: appDefaultOptions(), lang: 'ko', dark: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  // `stubMatchMedia` defines a property rather than a mock, so it would otherwise leak into the
  // next test and turn a phone-layout case into a desktop one.
  Reflect.deleteProperty(window, 'matchMedia');
});

/** Render a piece of the shell with the plan computed from the store, as the shell does. */
const renderPlanned = (node: ReactNode, override?: typeof data) => {
  const { deck, deployed } = useApp.getState();
  return render(
    <PlanProvider data={override ?? data} indexes={indexes} stats={statsFor(deck, deployed)} lang="ko">
      {node}
    </PlanProvider>,
  );
};

/** Pretend the viewport is a desktop (or not); jsdom has no matchMedia of its own. */
const stubMatchMedia = (desktop: boolean): void => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({ matches: desktop, media: query, addEventListener: () => undefined, removeEventListener: () => undefined }),
  });
};

describe('share links', () => {
  it('round-trips a deck, who is deployed, a gift list with priorities and the options', () => {
    const state = {
      deck: [10101, 10403],
      deployed: [10403],
      wanted: [9283, 9088],
      priority: { 9283: 'must' as const },
      fusionGoal: { 9088: 'resultOnly' as const },
      options: { ...appDefaultOptions(), startKeyword: 'auto' as const },
    };
    const decoded = decodeShared(encodeShared(state));
    expect(decoded).toEqual(state);
  });

  it('carries fusion goals but never the run in progress, and strips run options from any link', () => {
    useApp.getState().visitPack(1402, 4, { got: [9283] });
    const hash = encodeShared({ deck: [10101], deployed: [10101], wanted: [9088], priority: {}, fusionGoal: { 9088: 'resultOnly' }, options: { ...appDefaultOptions(), currentFloor: 4, ownedGifts: [9283] } });
    const raw = JSON.parse(lzString.decompressFromEncodedURIComponent(hash.slice(3))!) as Record<string, unknown>;
    expect(raw.v).toBe(5);
    expect('run' in raw).toBe(false);
    expect(raw.fusionGoal).toEqual({ 9088: 'resultOnly' });
    const decoded = decodeShared(hash)!;
    expect(decoded.fusionGoal).toEqual({ 9088: 'resultOnly' });
    expect(decoded.options).toMatchObject({ currentFloor: 1, ownedGifts: [], unobtainableGifts: [] });
    expect(sanitizeOptions({ currentFloor: 9, unobtainableGifts: [1] })).toMatchObject({ currentFloor: 1, unobtainableGifts: [] });
  });

  it('carries the season, and reads a link made before seasons as Mirror Dungeon 7', () => {
    const hash = encodeShared({ season: 8, deck: [10101], deployed: [10101], wanted: [9088], priority: {}, fusionGoal: {}, options: appDefaultOptions() });
    const raw = JSON.parse(lzString.decompressFromEncodedURIComponent(hash.slice(3))!) as Record<string, unknown>;
    expect(raw.s).toBe(8);
    expect(decodeShared(hash)!.season).toBe(8);
    // A v4 link could only have been MD7; the version field, written since v1, is what says so.
    const old = lzString.compressToEncodedURIComponent(
      JSON.stringify({ v: 4, deck: [10101], deployed: [10101], wanted: [9283], priority: {}, options: appDefaultOptions() }),
    );
    expect(decodeShared(`#s=${old}`)!.season).toBe(7);
  });

  it('plans every link for floors 1-15 on Hard and keeps priorities only for wanted gifts', () => {
    const old = lzString.compressToEncodedURIComponent(
      JSON.stringify({ v: 2, deck: [10101], deployed: [10101], wanted: [9283], priority: { 9283: 'must', 9088: 'skip', 9222: 'other' }, options: { ...defaultOptions(), lastFloor: 5, hardFromFloor: 3 } }),
    );
    const decoded = decodeShared(`#s=${old}`)!;
    expect(decoded.options).toMatchObject({ lastFloor: 15, hardFromFloor: 1 });
    expect(decoded.priority).toEqual({ 9283: 'must' });
  });

  it('reads a v1 link without a deployed list as "the first six fight"', () => {
    const v1 =
      '#s=' +
      lzString.compressToEncodedURIComponent(
        JSON.stringify({ v: 1, deck: [10101, 10203, 10312, 10403, 10505, 10601, 10707], wanted: [], options: defaultOptions() }),
      );
    const decoded = decodeShared(v1);
    expect(decoded?.deck).toEqual([10101, 10203, 10312, 10403, 10505, 10601, 10707]);
    expect(decoded?.deployed).toEqual([10101, 10203, 10312, 10403, 10505, 10601]);
  });

  it('drops option keys the planner no longer knows, such as the old observation count', () => {
    const stale = lzString.compressToEncodedURIComponent(
      JSON.stringify({ v: 2, deck: [10101], deployed: [10101], wanted: [9283], options: { ...defaultOptions(), giftObservationMax: 2, observedGifts: [9222, 9222] } }),
    );
    const decoded = decodeShared(`#s=${stale}`)!;
    expect('giftObservationMax' in decoded.options).toBe(false);
    expect(decoded.options.observedGifts).toEqual([9222]);
  });

  it('survives a mangled payload instead of taking the page down with it', () => {
    // lz-string throws on some strings rather than returning nothing; the throw used to escape
    // `decodeShared`, break the effect that reads the hash and leave a blank page.
    expect(decodeShared('#s=zzzznotalink')).toBeNull();
    expect(decodeShared('#s=')).toBeNull();
    expect(decodeShared('#s=' + 'A'.repeat(5000))).toBeNull();
  });

  it('ignores a hash that is not a share link', () => {
    expect(decodeShared('#other')).toBeNull();
    expect(decodeShared('#s=not-valid')).toBeNull();
  });

  it('starts a recipient on a fresh run, whatever this device had recorded', () => {
    useApp.getState().visitPack(1402, 4);
    useApp.getState().setGiftStatus(9267, 'got');
    useApp.getState().applyShared({ deck: [10101], deployed: [10101], wanted: [9283], priority: {}, options: defaultOptions() });
    expect(useApp.getState().run).toEqual(emptyRun());
    expect(useApp.getState().wanted).toEqual([9283]);
  });

  it('consumes the hash once so a reload keeps later edits', async () => {
    window.location.hash = encodeShared({ deck: [10101], deployed: [10101], wanted: [9283], priority: {}, options: defaultOptions() });
    render(<App />);
    await waitFor(() => expect(useApp.getState().wanted).toEqual([9283]));
    expect(window.location.hash).toBe('');
  });

  // A link replaces the deck, the goals and the run, and the hash is gone afterwards — so mid-run
  // it destroyed a record with no warning and no way back.
  it('asks before a link discards a run in progress, and keeps the hash when the answer is no', async () => {
    const user = userEvent.setup();
    useApp.getState().visitPack(1402, 1);
    useApp.getState().setStageFloor(4);
    const hash = encodeShared({ deck: [10101], deployed: [10101], wanted: [9283], priority: {}, options: defaultOptions() });
    window.location.hash = hash;
    render(<App />);
    const dialog = await screen.findByTestId('confirm-dialog');
    expect(useApp.getState().wanted).not.toEqual([9283]);
    await user.click(within(dialog).getByRole('button', { name: '취소' }));
    // Cancelling leaves the link in the URL: it is the reader's only copy.
    expect(window.location.hash).toBe(hash);
    expect(useApp.getState().run.visits).toEqual({ 1: 1402 });

    render(<App />);
    const again = await screen.findByTestId('confirm-dialog');
    await user.click(within(again).getByRole('button', { name: /링크 열기/ }));
    await waitFor(() => expect(useApp.getState().wanted).toEqual([9283]));
    expect(useApp.getState().run).toEqual(emptyRun());
    expect(window.location.hash).toBe('');
  });

  it('applies a link with no question when no run is under way', async () => {
    window.location.hash = encodeShared({ deck: [10101], deployed: [10101], wanted: [9283], priority: {}, options: defaultOptions() });
    render(<App />);
    await waitFor(() => expect(useApp.getState().wanted).toEqual([9283]));
    expect(screen.queryByTestId('confirm-dialog')).toBeNull();
  });

  // `copyFailed` and the season-dropped notice both time out; this one did not, so one bad link
  // left the warning sitting over the UI for the rest of the session.
  it('schedules the broken-link warning to go away instead of covering the app for the session', async () => {
    const timer = vi.spyOn(window, 'setTimeout');
    try {
      window.location.hash = '#s=zzzznotalink';
      render(<App />);
      await waitFor(() => expect(screen.getByText('공유 링크를 읽지 못했습니다')).toBeTruthy());
      expect(timer.mock.calls.some(([, delay]) => delay === 6000)).toBe(true);
    } finally {
      timer.mockRestore();
    }
  });
});

describe('a saved state that cannot be trusted', () => {
  // zustand only runs `migrate` when the stored version differs from ours, so the blob that claims
  // the current version is the one that used to reach state unchecked — and that is what a
  // truncated write or a partial eviction leaves behind.
  it('sanitizes a blob that claims the current version, instead of merging it as it stands', () => {
    const state = sanitizePersisted({ deck: 'abc', deployed: 5, wanted: [9267, 'x', null], run: 42, ui: 'nope', priority: 7 }, PERSIST_VERSION);
    expect(state.deck).toEqual([]);
    expect(state.deployed).toEqual([]);
    expect(state.wanted).toEqual([9267]);
    expect(state.run).toEqual(emptyRun());
    expect(state.ui).toEqual(defaultUi());
    expect(state.priority).toEqual({});
    expect(state.lang).toBe('ko');
  });

  it('keeps a deployed list inside the deck it came with', () => {
    const state = sanitizePersisted({ deck: [10101, 10102], deployed: [10102, 99999] }, PERSIST_VERSION);
    expect(state.deployed).toEqual([10102]);
  });

  it('renders the app from defaults when the stored blob is nonsense', async () => {
    window.localStorage.setItem(PERSIST_KEY, JSON.stringify({ version: PERSIST_VERSION, state: { deck: 'abc', run: 42 } }));
    useApp.persist.rehydrate();
    render(<App />);
    // The first visit's LCB deck, not a crash: the sanitizer emptied the deck and `App` filled it.
    await waitFor(() => expect(useApp.getState().deck).toEqual(defaultDeck(data)));
  });
});

describe('ErrorBoundary', () => {
  function Boom(): never {
    throw new Error('planner exploded');
  }

  it('offers a way out of a crash instead of a white screen, and clearing the state is one of them', async () => {
    const user = userEvent.setup();
    // React logs the caught error on purpose; let it.
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // jsdom has no navigation, so the reload would print a 「Not implemented」 trace. `reload`
    // itself is non-writable and non-configurable, but `window.location` is a configurable
    // accessor, so the whole object is what gets swapped — and that also lets the assertion
    // below prove the escape hatch really reloads.
    const reload = vi.fn();
    const realLocation = Object.getOwnPropertyDescriptor(window, 'location')!;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload },
    });
    window.localStorage.setItem(PERSIST_KEY, '{"version":7,"state":{}}');
    try {
      render(
        <ErrorBoundary>
          <Boom />
        </ErrorBoundary>,
      );
      expect(screen.getByTestId('crash')).toHaveTextContent('planner exploded');
      // The store may be the broken thing, so the wording comes from the browser, not from `lang`.
      // jsdom reports en-US, so this card is the English one.
      expect(screen.getByTestId('crash')).toHaveTextContent('The app stopped');
      // The header's 초기화 died with the tree, so the escape hatch has to live on this card.
      await user.click(screen.getByRole('button', { name: /Clear saved state|저장된 상태를 지우고/ }));
      expect(window.localStorage.getItem(PERSIST_KEY)).toBeNull();
      expect(reload).toHaveBeenCalled();
    } finally {
      Object.defineProperty(window, 'location', realLocation);
      quiet.mockRestore();
    }
  });
});

describe('state that outlived the game data', () => {
  // `adoptSeason` runs on every load, so this is the one gate everything stale passes through.
  const adopt = () =>
    useApp.getState().adoptSeason({
      season: data.meta.dungeon.id,
      lastFloor: 15,
      giftIds: new Set(data.gifts.map((gift) => gift.id)),
      packIds: new Set(data.packs.map((pack) => pack.id)),
    });

  it('drops ids this season cannot resolve, from the goals, the options and the run alike', () => {
    useApp.setState({
      wanted: [9267, 999999],
      priority: { 999999: 'must' },
      fusionGoal: { 999999: 'resultOnly' },
      options: { ...appDefaultOptions(), observedGifts: [9267, 999999], bannedPacks: [1402, 888888], preferredPacks: [888888], pinnedPacks: { 3: 888888, 4: 1402 } },
      run: { currentFloor: 3, stageFloor: 2, visits: { 1: 888888, 2: 1402 }, giftStatus: { 9267: 'got', 999999: 'got' }, startGifts: [999999] },
    });
    const counts = adopt();
    const state = useApp.getState();
    expect(state.wanted).toEqual([9267]);
    expect(state.priority).toEqual({});
    expect(state.fusionGoal).toEqual({});
    expect(state.options).toMatchObject({ observedGifts: [9267], bannedPacks: [1402], preferredPacks: [], pinnedPacks: { 4: 1402 } });
    // The run is kept — it still fits the season — but nothing unresolvable rides along in it.
    expect(state.run).toMatchObject({ visits: { 2: 1402 }, giftStatus: { 9267: 'got' }, startGifts: [] });
    expect(counts.gifts).toBe(1);
  });

  it('keeps a pin only for a gift that is still a goal, from a link and from a saved state', () => {
    // A pin is a decision about a goal, like a priority — a link carrying one for anything else
    // used to spend observation budget on it and then lose it without a word.
    useApp.getState().applyShared({ deck: LCB_DECK, deployed: LCB_DECK.slice(0, 6), wanted: [9267], priority: {}, options: { ...appDefaultOptions(), observedGifts: [9267, 9283] } });
    expect(useApp.getState().options.observedGifts).toEqual([9267]);
    useApp.setState({ options: { ...useApp.getState().options, observedGifts: [9267, 9283] } });
    adopt();
    expect(useApp.getState().options.observedGifts).toEqual([9267]);
  });
});

describe('run store', () => {
  it('tracks visits and gift status, feeds them to the planner, and clears on a new run', () => {
    useApp.getState().setDeck([10101], 6);
    useApp.getState().toggleWanted(9249);
    expect(useApp.getState().run).toMatchObject({ currentFloor: 1, stageFloor: 1 });
    useApp.getState().visitPack(1016, 1, { got: [9222] });
    expect(useApp.getState().run).toMatchObject({ visits: { 1: 1016 }, currentFloor: 2, stageFloor: 1, giftStatus: { 9222: 'got' } });
    // A pack is entered once per run: a new floor replaces the old one.
    useApp.getState().visitPack(1016, 3);
    expect(useApp.getState().run.visits).toEqual({ 3: 1016 });
    expect(useApp.getState().run.currentFloor).toBe(4);
    useApp.getState().setGiftStatus(9431, 'failed');
    useApp.getState().setFusionGoal(9249, 'resultOnly');
    const input = planInputFor(useApp.getState());
    expect(input.options).toMatchObject({ currentFloor: 4, pinnedPacks: { 3: 1016 }, ownedGifts: [9222], unobtainableGifts: [9431] });
    expect(input.wanted).toEqual([{ giftId: 9249, required: false, ingredientsAsGoals: false }]);
    // Undoing an entry can take the statuses recorded for that pack's own drops with it.
    useApp.getState().setGiftStatus(9267, 'got');
    useApp.getState().unvisitPack(1016, { reset: [9267, 9431] });
    expect(useApp.getState().run.visits).toEqual({});
    expect(useApp.getState().run.giftStatus).toEqual({ 9222: 'got' });
    useApp.getState().resetRun();
    expect(useApp.getState().run).toEqual(emptyRun());
    expect(planInputFor(useApp.getState()).options).toMatchObject({ currentFloor: 1, ownedGifts: [], pinnedPacks: {} });
  });

  it('walks the floors: entering, skipping, looking back, and taking a decision back', () => {
    const run = () => useApp.getState().run;
    // Floor 1 undecided → skipped; the frontier moves with the stage.
    useApp.getState().nextFloor({ got: [9423] });
    expect(run()).toMatchObject({ currentFloor: 2, stageFloor: 2, giftStatus: { 9423: 'got' } });
    // Entering keeps the stage on the entered floor so its gifts can be marked.
    useApp.getState().visitPack(1008, 2, { got: [9415] });
    expect(run()).toMatchObject({ currentFloor: 3, stageFloor: 2, visits: { 2: 1008 }, giftStatus: { 9423: 'got', 9415: 'got' } });
    // Leaving an entered floor never skips: the frontier is already past it; a recorded gift is never overridden by a miss.
    useApp.getState().nextFloor({ failed: [9415, 9419] });
    expect(run()).toMatchObject({ currentFloor: 3, stageFloor: 3, giftStatus: { 9423: 'got', 9415: 'got', 9419: 'failed' } });
    useApp.getState().nextFloor();
    expect(run()).toMatchObject({ currentFloor: 4, stageFloor: 4 });
    // Stepping back onto the skip right before the frontier takes it back, but not an older one.
    useApp.getState().setStageFloor(3);
    expect(run()).toMatchObject({ currentFloor: 3, stageFloor: 3 });
    useApp.getState().setStageFloor(2);
    expect(run()).toMatchObject({ currentFloor: 3, stageFloor: 2 });
    useApp.getState().setStageFloor(9); // never past the frontier
    expect(run().stageFloor).toBe(3);
    // Undoing the last decided visit reopens that floor; undoing an older one leaves a skip.
    useApp.getState().visitPack(1402, 3);
    useApp.getState().visitPack(1109, 4);
    expect(run()).toMatchObject({ currentFloor: 5, stageFloor: 3 });
    useApp.getState().unvisitPack(1109);
    expect(run()).toMatchObject({ currentFloor: 4, visits: { 2: 1008, 3: 1402 } });
    useApp.getState().unvisitPack(1008);
    expect(run()).toMatchObject({ currentFloor: 4, visits: { 3: 1402 } });
    useApp.getState().resetRun();
    expect(run()).toMatchObject({ currentFloor: 1, stageFloor: 1, visits: {}, giftStatus: {} });
  });

  it('keeps panel widths inside the band they may be dragged to', () => {
    expect(sanitizeUi({ rightTab: 'goals' }).rightTab).toBe('goals');
    // The old 「루트 설정」 tab lives under the items tab now.
    expect(sanitizeUi({ leftTab: 'settings' }).leftTab).toBe('gifts');
    expect(sanitizeUi({}).leftWidth).toBe(336);
    expect(sanitizeUi({ leftWidth: 900, rightWidth: 40 })).toMatchObject({ leftWidth: 560, rightWidth: 260 });
    expect(sanitizeUi({ leftWidth: 412.6 }).leftWidth).toBe(413);
    expect(sanitizeUi({ leftWidth: 'wide' }).leftWidth).toBe(336);
  });

  it('keeps a saved run only where it still makes sense', () => {
    expect(sanitizeRun({ visits: { 2: 1102, 5: 1102, 99: 1016, x: 1 }, giftStatus: { 9431: 'failed', 9706: 'odd' }, currentFloor: 1, stageFloor: 7 })).toEqual({
      currentFloor: 3,
      stageFloor: 3,
      visits: { 2: 1102 },
      giftStatus: { 9431: 'failed' },
      startGifts: [],
    });
    // The stage may stand on the done floor (16), never past it.
    expect(sanitizeRun({ currentFloor: 20, stageFloor: 20, visits: {}, giftStatus: {} })).toMatchObject({ currentFloor: 16, stageFloor: 16 });
    expect(sanitizeRun({ currentFloor: 16, stageFloor: 15, visits: {}, giftStatus: {} })).toMatchObject({ currentFloor: 16, stageFloor: 15 });
    // A record saved before the run-first shell, while no run was on: nothing to keep.
    expect(sanitizeRun({ active: false, visits: { 2: 1102 } })).toEqual(emptyRun());
    expect(sanitizeRun({ active: true, visits: { 2: 1102 }, currentFloor: 3 })).toMatchObject({ visits: { 2: 1102 }, currentFloor: 3, stageFloor: 3 });
    expect(sanitizeRun(null)).toEqual(emptyRun());
  });

  it('drops the collected marks an earlier build left on non-goal gifts when upgrading a saved run', async () => {
    const wanted = [9191, 9410, 9419, 9423];
    const giftStatus: Record<number, 'got' | 'failed'> = { 9419: 'got', 9423: 'got', 9409: 'got', 9431: 'failed' };
    expect(withoutLegacyGot(giftStatus, wanted)).toEqual({ 9419: 'got', 9423: 'got', 9431: 'failed' });
    const migrate = useApp.persist.getOptions().migrate!;
    const saved = { deck: LCB_DECK, deployed: LCB_DECK.slice(0, 6), wanted, priority: {}, fusionGoal: {}, options: { ...appDefaultOptions(), observedGifts: [9191, 9419, 9423] }, run: { currentFloor: 2, stageFloor: 2, visits: { 1: 1004 }, giftStatus }, ui: defaultUi(), lang: 'ko', dark: true };
    const upgraded = (await migrate(saved, 6)) as ReturnType<typeof useApp.getState>;
    expect(upgraded.run).toEqual({ currentFloor: 2, stageFloor: 2, visits: { 1: 1004 }, giftStatus: { 9419: 'got', 9423: 'got', 9431: 'failed' }, startGifts: [] });
    // The phantom ingredient is gone, so the plan routes for it again.
    const plan = planRoute(planInputFor({ ...upgraded, run: upgraded.run }), data, indexes);
    expect(plan.stats.requiredPacks).toBe(1);
    expect(plan.floors.find((f) => f.floor === 2)!.packId).toBe(1005);
    // A save from this version keeps whatever the player marked.
    const same = (await migrate(saved, 7)) as ReturnType<typeof useApp.getState>;
    expect(same.run.giftStatus).toEqual(giftStatus);
    // A run still on floor 1 has nothing to clean.
    const fresh = (await migrate({ ...saved, run: { currentFloor: 1, stageFloor: 1, visits: {}, giftStatus } }, 6)) as ReturnType<typeof useApp.getState>;
    expect(fresh.run.giftStatus).toEqual(giftStatus);
  });

  it('keeps a fusion goal only for a wanted gift', () => {
    useApp.getState().setFusionGoal(9249, 'resultOnly');
    expect(useApp.getState().fusionGoal).toEqual({});
    useApp.getState().toggleWanted(9249);
    useApp.getState().setFusionGoal(9249, 'resultOnly');
    expect(useApp.getState().fusionGoal).toEqual({ 9249: 'resultOnly' });
    useApp.getState().toggleWanted(9249); // deselecting drops the goal setting
    expect(useApp.getState().fusionGoal).toEqual({});
  });
});

describe('run store · statuses that outlive their goal', () => {
  it('drops a miss when the gift stops being a goal, and keeps what the tracker marked', () => {
    const app = useApp.getState();
    app.toggleWanted(9267);
    app.toggleWanted(9088);
    useApp.setState({ run: { ...useApp.getState().run, giftStatus: { 9267: 'failed', 9088: 'got', 9400: 'got' } } });
    // 9400 is nobody's goal but the tracker and the stage mark such gifts on purpose.
    useApp.getState().removeWanted(9267);
    expect(useApp.getState().run.giftStatus).toEqual({ 9088: 'got', 9400: 'got' });
    // Clearing the selection takes every miss with it; collected marks still stand.
    useApp.setState({ run: { ...useApp.getState().run, giftStatus: { 9088: 'failed', 9400: 'got' } } });
    useApp.getState().clearWanted();
    expect(useApp.getState().run.giftStatus).toEqual({ 9400: 'got' });
  });

  it('leaves a gift the run start put in hand alone when an entry is undone', () => {
    const app = useApp.getState();
    app.visitPack(1402, 1, { got: [9267, 9191] });
    expect(useApp.getState().run).toMatchObject({ currentFloor: 2, startGifts: [9267, 9191] });
    app.visitPack(1109, 2);
    useApp.getState().setGiftStatus(9270, 'got');
    // 9267 came from the run start, 9270 from this pack: only the second is the entry's to take.
    useApp.getState().unvisitPack(1109, { reset: [9267, 9270] });
    expect(useApp.getState().run.giftStatus).toMatchObject({ 9267: 'got', 9191: 'got' });
    expect(useApp.getState().run.giftStatus[9270]).toBeUndefined();
  });
});

describe('deck store', () => {
  it('keeps one identity per sinner and keeps the order the user built', () => {
    useApp.getState().setDeckSlot(4, 10403);
    useApp.getState().setDeckSlot(1, 10101);
    expect(useApp.getState().deck).toEqual([10403, 10101]);

    // Choosing another identity for the same sinner replaces it in place.
    useApp.getState().setDeckSlot(4, 10408);
    expect(useApp.getState().deck).toEqual([10408, 10101]);
    expect(useApp.getState().deck.filter((id) => sinnerOf(id) === 4)).toEqual([10408]);
  });

  it('deploys newcomers automatically until the default party is full', () => {
    for (const id of BURN_DECK.slice(0, 8)) useApp.getState().setDeckSlot(sinnerOf(id), id, 6);
    expect(useApp.getState().deployed).toEqual(BURN_DECK.slice(0, 6));
    // Replacing a deployed identity keeps the seat.
    useApp.getState().setDeckSlot(sinnerOf(BURN_DECK[0]!), 10115, 6);
    expect(useApp.getState().deployed[0]).toBe(10115);
  });

  it('clears a slot and its deployed seat when the identity is null', () => {
    useApp.getState().setDeckSlot(1, 10101);
    useApp.getState().toggleDeployed(10101, 7);
    expect(useApp.getState().deployed).toEqual([10101]);
    useApp.getState().setDeckSlot(1, null);
    expect(useApp.getState().deck).toEqual([]);
    expect(useApp.getState().deployed).toEqual([]);
  });

  it('caps deployment at the given maximum, in deck order', () => {
    useApp.getState().setDeck(BURN_DECK, 6);
    expect(useApp.getState().deployed).toEqual(BURN_DECK.slice(0, 6));
    useApp.getState().toggleDeployed(BURN_DECK[11]!, 7);
    expect(useApp.getState().deployed).toEqual([...BURN_DECK.slice(0, 6), BURN_DECK[11]]);
    // The eighth is refused.
    useApp.getState().toggleDeployed(BURN_DECK[7]!, 7);
    expect(useApp.getState().deployed).toHaveLength(7);
    // Un-deploying one makes room again, and order still follows the deck.
    useApp.getState().toggleDeployed(BURN_DECK[0]!, 7);
    useApp.getState().toggleDeployed(BURN_DECK[7]!, 7);
    expect(useApp.getState().deployed).toEqual([...BURN_DECK.slice(1, 6), BURN_DECK[7], BURN_DECK[11]]);
  });

  it('drops a lower-tier gift when its upgrade result is chosen', () => {
    useApp.getState().toggleWanted(9157);
    expect(useApp.getState().wanted).toEqual([9157]);
    useApp.getState().toggleWanted(9088, [9157]);
    expect(useApp.getState().wanted).toEqual([9088]);
  });
});

describe('gift priority', () => {
  it('groups gifts by how close the deployed party is to activating them', () => {
    const stats = statsFor(BURN_DECK, BURN_DECK.slice(0, 7));
    const reports = evaluateConditions([9088, 9092, 9208], stats, indexes);
    const byGift = new Map<number, typeof reports>();
    for (const r of reports) byGift.set(r.giftId, [...(byGift.get(r.giftId) ?? []), r]);
    const groups = prioritiseGifts([9088, 9092, 9208].map((id) => indexes.giftById.get(id)!), byGift);
    // 진혼 needs 5 combustion inflictors among the deployed 7 — every one of them qualifies.
    expect(groups.active.map((e) => e.gift.id)).toContain(9088);
    // 인연 얽힘 is a full-resonance condition: it cannot be judged from a deck.
    const resonance = groups.other.find((e) => e.gift.id === 9208);
    expect(resonance?.unjudgeable).toBe(true);
  });

  it('puts pack-bound gifts ahead of 범용 ones inside a group', () => {
    const packBound = data.gifts.find((g) => g.acquisition.kind === 'packLimited' && g.conditions.length === 0)!;
    const general = data.gifts.find((g) => g.acquisition.kind === 'general' && g.conditions.length === 0 && g.id < packBound.id)!;
    const a = classifyGift(packBound, []);
    const b = classifyGift(general, []);
    // Both sit in "other" with no condition; the pack-bound one wins even with the larger id.
    expect(compareEntries(a, b)).toBeLessThan(0);
    expect(compareEntries(b, a)).toBeGreaterThan(0);
    const groups = prioritiseGifts([general, packBound], new Map());
    expect(groups.other.map((e) => e.gift.id)).toEqual([packBound.id, general.id]);
    // A closer 범용 gift still trails a pack-bound one; two pack-bound gifts keep the closeness order.
    const stats = statsFor(BURN_DECK, BURN_DECK.slice(0, 7));
    const active = classifyGift(indexes.giftById.get(9088)!, evaluateConditions([9088], stats, indexes));
    expect(active.group).toBe('active');
    expect(compareEntries(active, a)).toBeGreaterThan(0);
  });

  it('reads the shortfall off the worst condition', () => {
    const gift = indexes.giftById.get(9092)!; // 연성진동: 5 vibration inflictors
    const entry = classifyGift(gift, evaluateConditions([9092], statsFor([10216, 10512, 10916]), indexes));
    // Close is not active: there is no 「거의 활성」 group any more.
    expect(entry.group).toBe('other');
    expect(entry.lack?.need).toBe(5);
    expect(entry.lack?.have).toBe(3);
  });
});

describe('condition wording', () => {
  const reportFor = (giftId: number, deck: number[]) => evaluateConditions([giftId], statsFor(deck), indexes)[0]!;

  it('picks the object particle by the final consonant', () => {
    expect(josa('화상', '을/를')).toBe('화상을');
    expect(josa('연기', '을/를')).toBe('연기를');
    expect(josa('Burn', '을/를')).toBe('Burn을(를)');
    const report = reportFor(9088, BURN_DECK);
    expect(conditionText(report, data.enums, 'ko')).toMatch(/^화상을 부여하는/);
  });

  it('names the faction in Korean instead of showing the raw id', () => {
    const report = reportFor(9283, [10101]);
    const text = conditionText(report, data.enums, 'ko');
    expect(text).not.toContain('THUMB_FINGER');
    expect(text).toContain('엄지');
  });

  it('says nothing about reached tiers when the deck reaches none', () => {
    const tiered = data.gifts.find((gift) => gift.conditions.some((c) => 'tiers' in c && c.tiers.length > 0));
    expect(tiered).toBeDefined();
    expect(reachedTierText(reportFor(tiered!.id, []), 'ko')).toBeNull();
  });
});

describe('DeckStep', () => {
  const renderDeck = () => {
    const { deck, deployed } = useApp.getState();
    return render(<DeckStep data={data} indexes={indexes} stats={statsFor(deck, deployed)} lang="ko" />);
  };

  it('shows twelve empty slots to start with and fills them with the LCB deck on request', async () => {
    const user = userEvent.setup();
    renderDeck();
    expect(screen.getAllByText('인격 선택')).toHaveLength(12);
    await user.click(screen.getByRole('button', { name: '기본 덱' }));
    expect(useApp.getState().deck).toEqual(defaultDeck(data));
    expect(useApp.getState().deck).toHaveLength(12);
    expect(useApp.getState().deployed).toHaveLength(6);
    expect(new Set(useApp.getState().deck.map((id) => indexes.identityById.get(id)!.title.ko))).toEqual(new Set(['LCB 수감자']));
  });

  it('finds identities across every sinner from the global search', async () => {
    const user = userEvent.setup();
    renderDeck();
    await user.type(screen.getByLabelText(/전체 인격 검색/), '리우');
    const list = screen.getByRole('listbox');
    const options = within(list).getAllByRole('option');
    expect(options.length).toBeGreaterThan(3);
    const sinners = new Set(options.map((o) => o.textContent?.slice(0, 2)));
    expect(sinners.size).toBeGreaterThan(1);
    await user.click(options[0]!);
    expect(useApp.getState().deck).toHaveLength(1);
  });

  it('finds identities by the 초성 of the name too', async () => {
    const user = userEvent.setup();
    renderDeck();
    await user.type(screen.getByLabelText(/전체 인격 검색/), 'ㄹㅇ');
    const options = within(screen.getByRole('listbox')).getAllByRole('option');
    expect(options.some((o) => o.textContent?.includes('리우'))).toBe(true);
  });

  it('walks the search results with the keyboard, keeps the list up while picking, and closes on Escape', async () => {
    const user = userEvent.setup();
    renderDeck();
    const input = screen.getByRole('combobox', { name: /전체 인격 검색/ });
    await user.type(input, '리우{ArrowDown}{Enter}');
    expect(useApp.getState().deck).toHaveLength(1);
    // The query and the list survive a pick, so the next one is a click away.
    expect((input as HTMLInputElement).value).toBe('리우');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('takes several identities from one search and drops one by pressing it again', async () => {
    const user = userEvent.setup();
    renderDeck();
    await user.type(screen.getByLabelText(/전체 인격 검색/), 'LCB');
    const options = () => within(screen.getByRole('listbox')).getAllByRole('option');
    expect(options()).toHaveLength(12);
    for (const i of [0, 1, 2]) await user.click(options()[i]!);
    expect(useApp.getState().deck).toHaveLength(3);
    expect(screen.getByText('덱에 3명')).toBeInTheDocument();
    expect(options()[0]).toHaveAttribute('aria-pressed', 'true');
    expect(options()[3]).toHaveAttribute('aria-pressed', 'false');
    await user.click(options()[0]!);
    expect(useApp.getState().deck).toHaveLength(2);
    expect(options()[0]).toHaveAttribute('aria-pressed', 'false');
  });

  it('finds identities matching any one of several keywords, and sums keywords over the formation', async () => {
    const user = userEvent.setup();
    useApp.getState().setDeck(BURN_DECK, 7);
    renderDeck();
    const input = screen.getByLabelText(/전체 인격 검색/);
    await user.type(input, '화상');
    const burn = within(screen.getByRole('listbox')).getAllByRole('option').length;
    await user.clear(input);
    await user.type(input, '침잠');
    const sink = within(screen.getByRole('listbox')).getAllByRole('option').length;
    await user.clear(input);
    // Two words are an OR: neither list shrinks the other.
    await user.type(input, '화상 침잠');
    const both = within(screen.getByRole('listbox')).getAllByRole('option').length;
    expect(both).toBeGreaterThan(Math.max(burn, sink));
    expect(both).toBeLessThanOrEqual(burn + sink);
    await user.keyboard('{Escape}');
    // The keyword chips count the deployed seven and the whole formation of twelve.
    const chip = screen.getAllByTitle(/출격 \d+명 · 편성 전체 \d+명/)[0]!;
    expect(chip.textContent).toMatch(/\d+\/\d+$/);
    expect(screen.getByText('출격 / 편성 12인')).toBeInTheDocument();
  });

  it('names each keyword on the identity chips without a skill count, marking the 특수 variants', async () => {
    const user = userEvent.setup();
    // 10614 거미집 약지 아비 uses 충전 and 특수 충전 (생체 재료); 10504 N사 큰 망치 only 못 (특수 출혈).
    useApp.getState().setDeck([10614, 10504, 10101], 3);
    renderDeck();
    const chip = (title: RegExp) => screen.getAllByTitle(title)[0]!;
    expect(chip(/^충전 또는 특수 충전/).textContent).toBe('충전(특수)');
    expect(chip(/^특수 출혈만/).textContent).toBe('특수 출혈');
    expect(chip(/^침잠 부여 공격 스킬 보유$/).textContent).toBe('침잠');
    // 특수 shows in the search too.
    await user.type(screen.getByLabelText(/전체 인격 검색/), '특수 충전');
    const options = within(screen.getByRole('listbox')).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(expect.arrayContaining([expect.stringContaining('거미집 약지 제자'), expect.stringContaining('거미집 약지 아비')]));
    for (const option of options) expect(option.textContent).not.toMatch(/충전\s*\d/);
  });

  it('shows 탄환 on the identities that spend ammo, marking the 특수 ones', async () => {
    const user = userEvent.setup();
    // 10611 마침표 사무소 대표 spends plain 탄환, 10414 잔향・외로움 only 탄환 - 고독,
    // 10711 마침표 해결사 both.
    useApp.getState().setDeck([10611, 10414, 10711], 3);
    renderDeck();
    const chip = (title: RegExp) => screen.getAllByTitle(title)[0]!;
    expect(chip(/^탄환 소모/).textContent).toBe('탄환');
    expect(chip(/^특수 탄환만 소모/).textContent).toBe('특수 탄환');
    expect(chip(/^탄환 또는 특수 탄환 소모/).textContent).toBe('탄환(특수)');
    // 탄환 is a keyword of the formation like any other, so the summary counts it.
    expect(screen.getAllByTitle(/출격 \d+명 · 편성 전체 \d+명/).map((el) => el.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining('탄환')]),
    );
    await user.type(screen.getByLabelText(/전체 인격 검색/), '탄환');
    expect(within(screen.getByRole('listbox')).getAllByRole('option')).toHaveLength(13);
  });

  it('refuses an eighth deployed identity', () => {
    useApp.getState().setDeck(BURN_DECK, 7);
    renderDeck();
    const boxes = screen.getAllByRole('checkbox', { name: /출격/ });
    expect(boxes).toHaveLength(12);
    expect(boxes.filter((b) => (b as HTMLInputElement).checked)).toHaveLength(7);
    expect(boxes.filter((b) => (b as HTMLInputElement).disabled)).toHaveLength(5);
    expect(screen.getByText('7/7')).toBeInTheDocument();
  });

  it('reports a formation code it cannot read', async () => {
    const user = userEvent.setup();
    renderDeck();
    await user.click(screen.getByRole('button', { name: '코드 가져오기' }));
    await user.type(screen.getByLabelText('편성 코드를 붙여넣으세요'), 'not-a-code');
    await user.click(screen.getByRole('button', { name: '불러오기' }));
    expect(await screen.findByText('편성 코드를 읽을 수 없습니다')).toBeInTheDocument();
    expect(useApp.getState().deck).toEqual([]);
  });
});

describe('GiftIcon', () => {
  it('puts the keyword in a corner badge (hue, or one ink with a shape for an attack type), the tier opposite it, and the judgement as a ring', () => {
    const icon = (id: number, judgement: 'met' | 'unmet' | null = null) => {
      const { unmount } = render(<GiftIcon gift={indexes.giftById.get(id)!} size={32} judgement={judgement} lang="ko" />);
      const el = screen.getByTestId('gift-icon');
      return { el, badge: screen.queryByTestId('gift-keyword'), unmount };
    };
    let r = icon(9088); // 진혼: Combustion
    expect(r.el).toHaveAttribute('data-keyword', 'Combustion');
    expect(r.badge).toHaveAttribute('data-keyword', 'Combustion');
    expect(r.badge!.className).toContain('bg-kw-combustion');
    // The keyword left the border behind; the tile keeps one neutral line.
    expect(r.el.className).toContain('border-line');
    expect(r.el.className).not.toContain('border-kw-');
    expect(r.el.className).not.toMatch(/ring-(ok|bad)/);
    // Tier top-left, keyword bottom-right.
    expect(within(r.el).getByText('T4').className).toContain('top-0');
    expect(r.badge!.className).toContain('bottom-0.5');
    r.unmount();
    r = icon(9032); // 꿈을 꾸는 전기양: Slash — one ink, a diamond
    expect(r.badge!.className).toContain('bg-kw-attack');
    expect(r.badge!.className).toContain('rotate-45');
    r.unmount();
    r = icon(9012); // 오늘의 표정: Hit — the same ink, a square
    expect(r.badge!.className).toContain('bg-kw-attack');
    expect(r.badge!.className).toContain('rounded-none');
    r.unmount();
    r = icon(9423); // 깨진 안경: 범용 carries no badge
    expect(r.el).toHaveAttribute('data-keyword', 'None');
    expect(r.badge).toBeNull();
    r.unmount();
    r = icon(9088, 'met');
    expect(r.el.className).toContain('ring-ok');
    r.unmount();
    r = icon(9088, 'unmet');
    expect(r.el.className).toContain('ring-bad');
    r.unmount();
  });
});

describe('text the screen gets wrong', () => {
  it('writes the EX tier as EX, in the icon and in the tier filter', () => {
    // 9799 어떤 철학 and 9800 부 are the season's two obtainable EX gifts; `T{tier}` read 「TEX」.
    const ex = indexes.giftById.get(9799)!;
    expect(ex.tier).toBe('EX');
    render(<GiftIcon gift={ex} size={32} lang="ko" />);
    expect(screen.getByTestId('gift-icon')).toHaveTextContent('EX');
    expect(screen.getByTestId('gift-icon').textContent).not.toContain('TEX');
    useApp.getState().setDeck(BURN_DECK, 7);
    const { deck, deployed } = useApp.getState();
    renderPlanned(<GiftsStep data={data} indexes={indexes} stats={statsFor(deck, deployed)} lang="ko" />);
    const tiers = within(screen.getByLabelText('등급')).getAllByRole('option').map((o) => o.textContent);
    expect(tiers).toContain('EX');
    expect(tiers).not.toContain('TEX');
    // The price bands do not overlap, so each label names the band it keeps.
    const prices = within(screen.getByLabelText('가격')).getAllByRole('option').map((o) => o.textContent);
    expect(prices).toContain('151~250');
  });

  it('names the dungeon in the chosen language, not always in Korean', () => {
    stubMatchMedia(true);
    useApp.setState({ lang: 'en' });
    render(
      <AppShell
        data={data}
        indexes={indexes}
        stats={statsFor(LCB_DECK)}
        lang="en"
        dark
        seasons={[]}
        onSeason={() => undefined}
        onShare={() => undefined}
        onToggleLang={() => undefined}
        onToggleDark={() => undefined}
      />,
    );
    expect(screen.getByRole('contentinfo')).toHaveTextContent(data.meta.dungeon.name.en);
    expect(screen.getByRole('contentinfo')).not.toHaveTextContent(data.meta.dungeon.name.ko);
  });
});

describe('GiftsStep', () => {
  // The detail sheet is hosted by the provider, not by the tab, so the tab needs the shell context.
  const renderGifts = () => {
    const { deck, deployed } = useApp.getState();
    return renderPlanned(<GiftsStep data={data} indexes={indexes} stats={statsFor(deck, deployed)} lang="ko" />);
  };
  const tile = (id: number) => screen.getAllByTestId('gift-tile').find((el) => el.getAttribute('data-gift') === String(id))!;

  it('marks a condition it cannot judge as such, not as unmet', async () => {
    const user = userEvent.setup();
    useApp.getState().setDeck(BURN_DECK, 7);
    renderGifts();
    await user.click(screen.getByRole('button', { name: /^기타/, expanded: false }));
    // 인연 얽힘 asks for a full resonance, which cannot be read off the deck — the tile says so
    // rather than calling it unmet. The route panel no longer repeats the judgement anywhere.
    const icon = within(tile(9208)).getByTestId('gift-icon');
    expect(icon).toHaveAttribute('data-judgement', 'unknown');
    expect(icon.getAttribute('aria-label')).toMatch(/^판정 불가 · 인연 얽힘/);
    expect(screen.queryAllByLabelText(/^미충족 · 인연 얽힘/)).toHaveLength(0);
  });

  /*
   * Nothing is drawn in place of a missing picture — not the old grey `Gem` (1.65:1 against its
   * own tile, 1.29:1 inside a pending one), and not the name's first character that replaced it.
   * A gift keeps a wash of its keyword colour; 범용 keeps nothing, the same way it gets no badge.
   * Which gift a tile is comes from the name beside it and from `aria-label`.
   */
  it('draws no letter where the artwork is missing — a keyword wash, and nothing at all for 범용', () => {
    const tinted = data.gifts.find((g) => g.keyword === 'Combustion')!;
    const general = data.gifts.find((g) => g.keyword === 'None')!;
    render(
      <>
        <GiftIcon gift={tinted} size={44} lang="ko" />
        <GiftIcon gift={general} size={44} lang="ko" />
        <GiftIcon gift={tinted} size={20} lang="ko" />
      </>,
    );
    const icons = screen.getAllByTestId('gift-icon');
    // The tier chip is the only text a tile may carry — and it is not drawn below 32px, so the
    // small tile has to come out completely empty.
    expect(icons[0]!.textContent).toBe(tierLabel(tinted.tier));
    expect(icons[1]!.textContent).toBe(tierLabel(general.tier));
    expect(icons[2]!.textContent).toBe('');
    // The name still reaches a screen reader, so removing the letter costs nothing there.
    expect(icons[0]!).toHaveAccessibleName(new RegExp(tinted.name.ko));
    expect(icons[0]!.querySelector('.bg-kw-combustion')).not.toBeNull();
    expect(icons[1]!.querySelector('[class*="bg-kw-"]')).toBeNull();
  });

  it('dims the square and not the name, the same way with artwork or without', () => {
    const gift = data.gifts.find((g) => g.keyword === 'Combustion')!;
    const { unmount } = render(<GiftIcon gift={gift} size={44} dim lang="ko" />);
    expect(screen.getByTestId('gift-icon').className).toContain('grayscale opacity-55');
    unmount();
    render(<GiftIcon gift={gift} size={44} lang="ko" />);
    expect(screen.getByTestId('gift-icon').className).not.toContain('grayscale');
  });

  it('colours a gift icon by whether the deck meets its condition', async () => {
    const user = userEvent.setup();
    useApp.getState().setDeck(BURN_DECK, 7);
    renderGifts();
    await user.click(screen.getByRole('button', { name: /^기타/, expanded: false }));
    // 진혼 wants combustion, which this deck has; 먹장구름 wants sinking, which it does not.
    expect(within(tile(9088)).getByTestId('gift-icon')).toHaveAttribute('data-judgement', 'met');
    expect(within(tile(9211)).getByTestId('gift-icon')).toHaveAttribute('data-judgement', 'unmet');
  });

  it('folds 요리 비법 전서 under 진혼, lets it be chosen alone, and locks it once 진혼 is chosen', async () => {
    const user = userEvent.setup();
    useApp.getState().setDeck(BURN_DECK, 7);
    renderGifts();
    // 진혼 is active with this deck, so it sits in the first section with its child right after it.
    expect(tile(9157)).toBeDefined();
    const order = screen.getAllByTestId('gift-tile').map((el) => el.getAttribute('data-gift'));
    expect(order.indexOf('9157')).toBeGreaterThan(order.indexOf('9088'));
    await user.click(within(tile(9157)).getByRole('button', { name: '요리 비법 전서' }));
    expect(useApp.getState().wanted).toEqual([9157]);
    // Choosing the parent absorbs the child: its tile locks and reads as chosen.
    await user.click(within(tile(9088)).getByRole('button', { name: '진혼' }));
    expect(useApp.getState().wanted).toEqual([9088]);
    expect(tile(9157)).toHaveAttribute('data-locked');
    // A disabled button takes no focus, so the lock reason has to be in its name, not its title.
    const childButton = within(tile(9157)).getByRole('button', { name: /^요리 비법 전서 · / });
    expect(childButton).toBeDisabled();
    expect(childButton).toHaveAttribute('aria-pressed', 'true');
    expect(childButton).toHaveAccessibleName(expect.stringContaining('진혼'));
    // And visible under the tile, which is the only path a touch reader has.
    expect(tile(9157)).toHaveTextContent('진혼');
    // The tiles carry no acquisition badges or tier text any more; the tier stays on the icon.
    expect(within(tile(9088)).queryByText('조합')).toBeNull();
    expect(within(tile(9157)).queryByText('포함')).toBeNull();
    const tiers = within(tile(9088)).getAllByText('T4'); // the tier survives only as the icon's corner chip
    expect(tiers).toHaveLength(1);
    expect(within(tile(9088)).getByTestId('gift-icon')).toContainElement(tiers[0]!);
  });

  it('keeps 탄환 out of the gift keyword filter', () => {
    renderGifts();
    const select = screen.getByLabelText('키워드') as HTMLSelectElement;
    const labels = [...select.options].map((o) => o.textContent);
    expect(labels).toContain('화상');
    expect(labels).not.toContain('탄환');
  });

  it('shows the deciding condition as a count and folds every section', async () => {
    const user = userEvent.setup();
    useApp.getState().setDeck(BURN_DECK, 7);
    renderGifts();
    // 진혼 needs 5 화상 identities and the burn deck has 7; 연성진동 wants 5 진동 and is short.
    expect(tile(9088)).toHaveTextContent('화상 7/5');
    // Two sections only: 「거의 활성」 is gone, so a gift short of its condition sits in 「기타」, which starts folded.
    expect(screen.queryByRole('button', { name: /거의 활성/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: /기타/, expanded: false }));
    expect(tile(9092)).toHaveTextContent('진동 3/5');
    // Every header folds.
    for (const name of [/지금 덱으로 활성/, /기타/]) {
      const header = screen.getByRole('button', { name, expanded: true });
      await user.click(header);
      expect(screen.getByRole('button', { name, expanded: false })).toBeInTheDocument();
    }
    expect(screen.queryByTestId('gift-tile')).toBeNull();
    await user.click(screen.getByRole('button', { name: /기타/, expanded: false }));
    expect(tile(9717)).toBeDefined();
  });

  it('locks what a chosen goal already carries, even when the keywords differ', async () => {
    const user = userEvent.setup();
    useApp.getState().setDeck(BURN_DECK, 7);
    renderGifts();
    await user.click(screen.getByRole('button', { name: /기타/, expanded: false }));
    // 노이즈 섞인 무전기(침잠) is an ingredient of 데스페라도(관통); nothing but the recipe says so.
    expect(tile(9233)).not.toHaveAttribute('data-locked');
    await user.click(within(tile(9235)).getByRole('button', { name: '데스페라도' }));
    expect(useApp.getState().wanted).toEqual([9235]);
    expect(tile(9233)).toHaveAttribute('data-locked');
    expect(tile(9233)).toHaveAttribute('data-block', 'included');
    expect(within(tile(9233)).getByRole('button', { name: /^노이즈 섞인 무전기 · / })).toBeDisabled();
    expect(tile(9233).title).toContain('데스페라도');
    // The name beside the icon is never disabled, so the sheet behind it has to hold the same lock
    // — it used to be the way around it.
    await user.click(within(tile(9233)).getByRole('button', { name: '노이즈 섞인 무전기 자세히' }));
    const sheet = screen.getByRole('dialog', { name: '노이즈 섞인 무전기' });
    expect(within(sheet).getByRole('button', { name: '목표로 삼기' })).toBeDisabled();
    expect(sheet).toHaveTextContent('데스페라도');
  });

  // `aria-modal="true"` tells assistive tech the rest of the page is not there, and the sheets are
  // portalled to `document.body`, so everything behind them is a tabbable sibling. Tab used to
  // walk straight out into a page the reader had been told did not exist.
  it('keeps Tab inside an open sheet, at both ends', async () => {
    const user = userEvent.setup();
    useApp.getState().setDeck(BURN_DECK, 7);
    renderGifts();
    await user.click(within(tile(9088)).getByRole('button', { name: '진혼 자세히' }));
    const sheet = screen.getByRole('dialog', { name: '진혼' });
    const stops = within(sheet)
      .getAllByRole('button')
      .filter((el) => !el.hasAttribute('disabled'));
    expect(stops.length).toBeGreaterThan(1);
    const first = stops[0]!;
    const last = stops[stops.length - 1]!;

    last.focus();
    await user.tab();
    expect(document.activeElement).toBe(first);

    first.focus();
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(last);
  });

  it('takes the same goal out of the selection from every sheet, not only from the grid', async () => {
    const user = userEvent.setup();
    useApp.getState().setDeck(BURN_DECK, 7);
    useApp.getState().toggleWanted(9233); // an ingredient of 데스페라도, chosen on its own first
    // This sheet is the shell's, not the item tab's: it used to drop only 조합 계승 children, so
    // the ingredient stayed selected *and* locked, with no way back but the chip's ✕.
    renderPlanned(<GoalsPanel />);
    await user.click(within(screen.getByTestId('route-goal')).getByTestId('gift-tile-info'));
    await user.click(await screen.findByRole('button', { name: '목표에서 빼기' }));
    expect(useApp.getState().wanted).toEqual([]);
  });

  it('absorbs an ingredient that was already a goal, and still lets a goal that shares one be chosen', async () => {
    const user = userEvent.setup();
    useApp.getState().setDeck(BURN_DECK, 7);
    useApp.getState().toggleWanted(9233); // the ingredient first
    renderGifts();
    await user.click(screen.getByRole('button', { name: /기타/, expanded: false }));
    await user.click(within(tile(9235)).getByRole('button', { name: '데스페라도' }));
    expect(useApp.getState().wanted).toEqual([9235]);
    // 장관 and 부동 both eat 녹슨 칼자루. That is 얽힘, not a block — the planner routes a copy each.
    await user.click(within(tile(9717)).getByRole('button', { name: '장관' }));
    expect(tile(9718)).not.toHaveAttribute('data-block');
    expect(within(tile(9718)).getByRole('button', { name: '부동' })).toBeEnabled();
    await user.click(within(tile(9718)).getByRole('button', { name: '부동' }));
    expect(useApp.getState().wanted).toEqual([9235, 9717, 9718]);
  });

  it('marks two goals that eat the same ingredient as 얽힘 and names it in the sheet', async () => {
    const user = userEvent.setup();
    useApp.getState().setDeck(BURN_DECK, 7);
    // 장관 and 부동 are both fused from 녹슨 칼자루, so the shop cannot serve both from one pickup.
    for (const id of [9717, 9718]) useApp.getState().toggleWanted(id);
    renderGifts();
    await user.click(screen.getByRole('button', { name: /기타/, expanded: false }));
    expect(tile(9717)).toHaveAttribute('data-entangled');
    expect(tile(9718)).toHaveAttribute('data-entangled');
    await user.click(within(tile(9717)).getByRole('button', { name: '장관 자세히' }));
    expect(screen.getByTestId('gift-entangled')).toHaveTextContent('부동');
    expect(screen.getByTestId('gift-entangled')).toHaveTextContent('녹슨 칼자루');
  });

  it('opens a gift sheet with its effect, conditions and a recipe that starts folded', async () => {
    const user = userEvent.setup();
    useApp.getState().setDeck(BURN_DECK, 7);
    renderGifts();
    await user.click(within(tile(9088)).getByRole('button', { name: '진혼 자세히' }));
    const sheet = screen.getByTestId('gift-detail');
    expect(sheet).toHaveTextContent('조합');
    expect(within(sheet).getByTestId('gift-conditions')).toHaveTextContent('화상 7/5');
    expect(within(sheet).getByTestId('gift-conditions')).toHaveTextContent('부여하는 공격 스킬 보유 인격');
    // The recipe is behind a fold, and opening it lists the ingredients the planner would use.
    const recipe = within(sheet).getByTestId('gift-recipe');
    expect(recipe).not.toHaveAttribute('open'); // folded until asked for
    await user.click(within(recipe).getByText('조합식'));
    expect(recipe).toHaveAttribute('open');
    expect(within(recipe).getAllByTestId('recipe-item').length).toBeGreaterThan(1);
    expect(recipe).toHaveTextContent('요리 비법 전서');
    // The sheet can take the gift as a goal, and only then offers the ingredient question.
    expect(within(sheet).queryByRole('checkbox')).toBeNull();
    await user.click(within(sheet).getByRole('button', { name: '목표로 삼기' }));
    expect(useApp.getState().wanted).toEqual([9088]);
    expect(within(sheet).getByRole('checkbox', { name: /재료도 목표/ })).toBeChecked();
  });

  it('pins observations through the slots: the 「+」 list offers only observable goals, ✕ unpins, a full row has no 「+」', async () => {
    const user = userEvent.setup();
    useApp.getState().setDeck(BURN_DECK, 7);
    for (const id of [9283, 9222, 9217, 9435, 9751]) useApp.getState().toggleWanted(id);
    const { deck, deployed } = useApp.getState();
    renderPlanned(<GiftsStep data={data} indexes={indexes} stats={statsFor(deck, deployed)} lang="ko" />);
    const slots = () => within(screen.getByTestId('observe-slots')).getAllByTestId('observe-slot');
    // Pins fill from the cheapest cell outward, so the 「+」 no longer claims a numbered slot.
    const plus = () => screen.queryAllByRole('button', { name: '관측 지정 추가' });
    expect(slots()).toHaveLength(3);
    expect(plus()).toHaveLength(3);
    // The chips carry no star or eye buttons any more.
    expect(screen.queryByRole('button', { name: /우선순위|관측 지정$/ })).toBeNull();
    await user.click(plus()[0]!);
    const list = screen.getByTestId('observe-candidates');
    expect(within(list).queryByRole('button', { name: '상납된 시가 관측 지정' })).toBeNull(); // not in the season's observation pool
    expect(within(list).getAllByRole('button')).toHaveLength(4);
    await user.click(within(list).getByRole('button', { name: '새하얀 캔버스 관측 지정' }));
    expect(useApp.getState().options.observedGifts).toEqual([9222]);
    expect(screen.queryByTestId('observe-candidates')).toBeNull();
    expect(slots()[0]).toHaveAttribute('data-gift', '9222');
    // A pinned gift leaves the list; the next 「+」 is the next empty cell.
    await user.click(plus()[0]!);
    expect(within(screen.getByTestId('observe-candidates')).getAllByRole('button')).toHaveLength(3);
    await user.click(screen.getByRole('button', { name: '누군가의 단말기 관측 지정' }));
    await user.click(plus()[0]!);
    await user.click(screen.getByRole('button', { name: '버틀러식 포박술 관측 지정' }));
    expect(useApp.getState().options.observedGifts).toEqual([9222, 9217, 9435]);
    expect(plus()).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: '새하얀 캔버스 관측 해제' }));
    expect(useApp.getState().options.observedGifts).toEqual([9217, 9435]);
    expect(plus()).toHaveLength(1);
    // Deselecting a pinned gift drops its pin too.
    await user.click(screen.getByRole('button', { name: '누군가의 단말기 선택 해제' }));
    expect(useApp.getState().options.observedGifts).toEqual([9435]);
  });

  it('opens the gift sheet from a selected chip instead of jumping to its tile', async () => {
    const user = userEvent.setup();
    useApp.getState().setDeck(BURN_DECK, 7);
    useApp.getState().toggleWanted(9283);
    const { deck, deployed } = useApp.getState();
    renderPlanned(<GiftsStep data={data} indexes={indexes} stats={statsFor(deck, deployed)} lang="ko" />);
    const chip = screen.getByTestId('gift-chip');
    expect(chip).toHaveAttribute('data-gift', '9283');
    await user.click(within(chip).getByRole('button', { name: '상납된 시가 자세히' }));
    expect(screen.getByRole('dialog', { name: '상납된 시가' })).toBeInTheDocument();
  });

  it('puts the search results under the box that asked for them, and back at the foot when the query goes', async () => {
    const user = userEvent.setup();
    useApp.getState().setDeck(BURN_DECK, 7);
    useApp.getState().toggleWanted(9267);
    renderGifts();
    const box = screen.getByRole('textbox', { name: '기프트 검색' });
    const slots = () => screen.getByTestId('observe-slots');
    const grid = () => screen.getAllByTestId('gift-grid')[0]!;
    // With no query the grid sits below the slots and the selection tray, where it always did.
    expect(grid().compareDocumentPosition(slots())).toBe(Node.DOCUMENT_POSITION_PRECEDING);
    await user.type(box, '달궈진');
    // While searching it comes first: the results belong to the box above them.
    expect(grid().compareDocumentPosition(slots())).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    await user.clear(box);
    expect(grid().compareDocumentPosition(slots())).toBe(Node.DOCUMENT_POSITION_PRECEDING);
  });

  it('sorts the selection tray by keyword or by name, and holds the order things were picked in by default', async () => {
    const user = userEvent.setup();
    useApp.getState().setDeck(BURN_DECK, 7);
    // Picked in an order that is neither alphabetical nor keyword order.
    for (const id of [9267, 9088, 9211]) useApp.getState().toggleWanted(id);
    renderGifts();
    const chips = () => within(screen.getByTestId('gift-chips')).getAllByTestId('gift-chip').map((el) => el.getAttribute('data-gift'));
    expect(chips()).toEqual(['9267', '9088', '9211']);
    await user.selectOptions(screen.getByRole('combobox', { name: '정렬' }), 'name');
    expect(chips()).toEqual(['9267', '9211', '9088']); // 달궈진 놋쇠 · 먹장구름 · 진혼
    await user.selectOptions(screen.getByRole('combobox', { name: '정렬' }), 'keyword');
    // Keyword order is the enum's — the two 화상 gifts before the 침잠 one, names breaking the tie —
    // and the store's own order never moved.
    expect(chips()).toEqual(['9267', '9088', '9211']);
    expect(useApp.getState().wanted).toEqual([9267, 9088, 9211]);
  });

  it('filters the tray by keyword and by pack, hiding chips without unselecting them', async () => {
    const user = userEvent.setup();
    useApp.getState().setDeck(BURN_DECK, 7);
    for (const id of [9267, 9088, 9211]) useApp.getState().toggleWanted(id);
    renderGifts();
    const chips = () => within(screen.getByTestId('gift-chips')).getAllByTestId('gift-chip').map((el) => el.getAttribute('data-gift'));
    const trayFilters = () => within(screen.getByTestId('gift-chips').parentElement!).getAllByRole('combobox');
    // The tray's keyword filter offers only the keywords its own chips carry.
    const keyword = trayFilters().find((el) => el.getAttribute('aria-label') === '키워드')!;
    await user.selectOptions(keyword, 'Sinking');
    expect(chips()).toEqual(['9211']);
    expect(useApp.getState().wanted).toEqual([9267, 9088, 9211]);
    await user.selectOptions(keyword, 'all');
    // 달궈진 놋쇠 is 화왕지절's alone, so the pack filter keeps it and nothing else.
    const pack = trayFilters().find((el) => el.getAttribute('aria-label') === '팩')!;
    await user.selectOptions(pack, within(pack).getByRole('option', { name: '화왕지절' }).getAttribute('value')!);
    expect(chips()).toEqual(['9267']);
    expect(useApp.getState().wanted).toEqual([9267, 9088, 9211]);
  });

  it('pins a chip dragged onto a slot, ignores one that cannot be observed, and a tap still opens the sheet', async () => {
    const user = userEvent.setup();
    useApp.getState().setDeck(BURN_DECK, 7);
    for (const id of [9283, 9222, 9217]) useApp.getState().toggleWanted(id);
    const { deck, deployed } = useApp.getState();
    renderPlanned(<GiftsStep data={data} indexes={indexes} stats={statsFor(deck, deployed)} lang="ko" />);
    const chip = (id: number) => screen.getAllByTestId('gift-chip').find((c) => c.getAttribute('data-gift') === String(id))!;
    const slot = (i: number) => screen.getAllByTestId('observe-slot')[i]!;
    const drag = (id: number, i: number) => {
      fireEvent.pointerDown(chip(id), { button: 0, clientX: 10, clientY: 10 });
      fireEvent.pointerMove(window, { clientX: 10, clientY: 15 }); // under the start distance: not a drag yet
      expect(screen.queryByTestId('chip-ghost')).toBeNull();
      fireEvent.pointerMove(window, { clientX: 60, clientY: 60 });
      expect(screen.getByTestId('chip-ghost')).toBeInTheDocument();
      fireEvent.pointerEnter(slot(i));
      fireEvent.pointerUp(window);
      expect(screen.queryByTestId('chip-ghost')).toBeNull();
    };
    drag(9222, 0);
    expect(useApp.getState().options.observedGifts).toEqual([9222]);
    // Dropping on a filled cell swaps the gift in.
    drag(9217, 0);
    expect(useApp.getState().options.observedGifts).toEqual([9217]);
    // 상납된 시가 is not in the observation pool: the drop does nothing.
    drag(9283, 1);
    expect(useApp.getState().options.observedGifts).toEqual([9217]);
    // The click the browser fires after a drag is swallowed; a plain tap still opens the sheet.
    fireEvent.click(within(chip(9217)).getByRole('button', { name: '누군가의 단말기 자세히' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(within(chip(9217)).getByRole('button', { name: '누군가의 단말기 자세히' }));
    expect(screen.getByRole('dialog', { name: '누군가의 단말기' })).toBeInTheDocument();
  });

  it('points an empty deck at the deck tab only when it is given somewhere to go', async () => {
    const user = userEvent.setup();
    const onGoDeck = vi.fn();
    const { unmount } = renderPlanned(<GiftsStep data={data} indexes={indexes} stats={statsFor([])} lang="ko" />);
    expect(screen.getByText('덱이 비어 있습니다')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '덱 탭으로' })).toBeNull();
    unmount();
    renderPlanned(<GiftsStep data={data} indexes={indexes} stats={statsFor([])} lang="ko" onGoDeck={onGoDeck} />);
    await user.click(screen.getByRole('button', { name: '덱 탭으로' }));
    expect(onGoDeck).toHaveBeenCalledTimes(1);
  });

  it('finds a gift by the 초성 of its name', async () => {
    const user = userEvent.setup();
    useApp.getState().setDeck(BURN_DECK, 7);
    const { deck, deployed } = useApp.getState();
    renderPlanned(<GiftsStep data={data} indexes={indexes} stats={statsFor(deck, deployed)} lang="ko" />);
    // 「ㅈㄱㅁㄱ」 is how the name is reached on a Korean keyboard without committing to the vowels.
    await user.type(screen.getByRole('textbox', { name: '기프트 검색' }), 'ㅈㄱㅁㄱ');
    await user.click(screen.getByRole('button', { name: /기타/, expanded: false }));
    expect(within(screen.getByTestId('gift-scroller')).getByRole('button', { name: '조그맣고 근사한 바이올린 자세히' })).toBeInTheDocument();
  });

  it('lets a chosen fusion result decide whether its ingredients are goals too', async () => {
    const user = userEvent.setup();
    useApp.getState().setDeck(BURN_DECK, 7);
    useApp.getState().toggleWanted(9249);
    const { deck, deployed } = useApp.getState();
    renderPlanned(<GiftsStep data={data} indexes={indexes} stats={statsFor(deck, deployed)} lang="ko" />);
    await user.type(screen.getByRole('textbox', { name: '기프트 검색' }), '조그맣고');
    await user.click(screen.getByRole('button', { name: /기타/, expanded: false }));
    // The chip above the grid opens the same sheet; here it is opened from the tile.
    await user.click(within(screen.getByTestId('gift-scroller')).getByRole('button', { name: '조그맣고 근사한 바이올린 자세히' }));
    await user.click(within(screen.getByTestId('gift-recipe')).getByText('조합식'));
    const box = screen.getByRole('checkbox', { name: '조그맣고 근사한 바이올린 재료도 목표' });
    expect(box).toBeChecked();
    await user.click(box);
    expect(useApp.getState().fusionGoal).toEqual({ 9249: 'resultOnly' });
    await user.click(box);
    expect(useApp.getState().fusionGoal).toEqual({});
  });
});


describe('RouteOptions', () => {
  it('shows the start keyword and the pack choices, with no difficulty text, observation list or resets', async () => {
    const user = userEvent.setup();
    useApp.getState().setDeck(BURN_DECK, 7);
    for (const id of [9267, 9423]) useApp.getState().toggleWanted(id);
    useApp.getState().banPack(1402);
    renderPlanned(<RouteOptions />);
    expect(screen.getByRole('combobox', { name: '시작 키워드' })).toBeInTheDocument();
    expect(screen.getByTestId('route-options').textContent).not.toMatch(/Hard|1~15/);
    expect(screen.queryByTestId('settings-observed')).toBeNull();
    expect(screen.queryByRole('button', { name: /옵션 초기화|새 런/ })).toBeNull();
    // The given-up pack is listed with its restore action.
    const packs = screen.getByTestId('settings-packs');
    expect(within(packs).getByTestId('settings-pack')).toHaveAttribute('data-pack', '1402');
    await user.click(within(packs).getByRole('button', { name: '화왕지절 되돌리기' }));
    expect(useApp.getState().options.bannedPacks).toEqual([]);
  });
});

describe('RoutePlanPanel', () => {
  const renderRoute = () => renderPlanned(<RoutePlanPanel onOpenGifts={() => undefined} />);

  it('keeps the goals grid out of the route tab', () => {
    useApp.getState().setDeck(BURN_DECK, 7);
    useApp.getState().toggleWanted(9267);
    renderRoute();
    expect(screen.getByTestId('route-plan')).toBeInTheDocument();
    expect(screen.queryByTestId('route-goals')).toBeNull();
    expect(screen.queryByTestId('gift-tile')).toBeNull();
  });

  /*
   * A general gift counts as covered because no pack visit can improve it — the route has nothing
   * left to do for it. Naming those goals is the useful part (they are the ones no pack is
   * fetching); the certain/uncertain judgement is the item tab's 「가능」 badge and the gift sheet,
   * deliberately not repeated here. 187 of 446 gifts are general, so this is the ordinary case.
   */
  it('names the general gifts no pack is fetching, and counts them next to 확보', () => {
    useApp.getState().setDeck(BURN_DECK, 7);
    const general = data.gifts.filter((gift) => gift.acquisition.kind === 'general').slice(0, 4);
    for (const gift of general) useApp.getState().toggleWanted(gift.id);
    renderRoute();

    const summary = screen.getByTestId('route-summary');
    expect(summary).toHaveTextContent(`${general.length}/${general.length}`);

    // Not `general.length`: an observation or the starting gift can make one of them certain, and
    // then it is not a general drop any more. The badge counts what the route leaves to the pool.
    const card = screen.getByTestId('route-general-drops');
    const named = general.filter((gift) => card.textContent?.includes(gift.name.ko));
    expect(named.length).toBeGreaterThan(0);
    expect(summary).toHaveTextContent(`범용 ${named.length}`);
    // No 확정/비확정 wording anywhere in the route panel — neither in the card nor the 「참고」 list.
    expect(screen.getByTestId('route-plan').textContent).not.toMatch(/확정/);
  });

  it('draws no general-drops card when every goal is a sure thing', () => {
    useApp.getState().setDeck(BURN_DECK, 7);
    useApp.getState().toggleWanted(9267);
    renderRoute();
    expect(screen.queryByTestId('route-general-drops')).toBeNull();
    expect(screen.getByTestId('route-summary')).not.toHaveTextContent('범용');
  });
  const rows = () => screen.getByTestId('metro-rows');
  /** Spend all three observation slots on other gifts so observable fixtures get routed. */
  const fillObservations = () => {
    for (const id of [9435, 9222, 9217]) useApp.getState().toggleWanted(id);
    useApp.getState().setOptions({ observedGifts: [9435, 9222, 9217] });
  };

  it('shows an empty state without goals and fifteen stations on the vertical line with them', () => {
    useApp.getState().setDeck(BURN_DECK, 7);
    const { unmount } = renderRoute();
    expect(screen.getByTestId('route-empty')).toHaveTextContent('기프트를 고르면 루트가 나옵니다');
    unmount();
    useApp.getState().toggleWanted(9267);
    renderRoute();
    expect(screen.queryByTestId('metro-columns')).toBeNull();
    expect(within(rows()).getAllByTestId('station')).toHaveLength(15);
    expect(screen.getByTestId('route-summary')).toHaveTextContent('필요 팩');
  });

  it('draws a pack that may sit on several floors as one dashed segment with no suggested floor', () => {
    useApp.getState().setDeck(BURN_DECK, 7);
    useApp.getState().toggleWanted(9267); // 화왕지절, Hard 4-5, not observable
    renderRoute();
    const segment = within(rows()).getByTestId('segment');
    expect(segment).toHaveAttribute('data-from', '4');
    expect(segment).toHaveAttribute('data-to', '5');
    expect(segment).not.toHaveAttribute('data-partial');
    expect(segment.textContent).not.toMatch(/고정|한 층|추천|어느 층/);
    expect(within(segment).getByRole('button', { name: '화왕지절' })).toBeInTheDocument();
    expect(within(rows()).queryByTestId('suggested')).toBeNull();
    expect(segment.style.height).toBe(`${64 * 2 - 8}px`);
  });

  it('draws two fixed packs as solid blocks over their stations', () => {
    useApp.getState().setDeck(BURN_DECK, 7);
    useApp.getState().toggleWanted(9754); // 2호선 (1109), Hard 4-5, not observable
    useApp.getState().toggleWanted(9208); // 해방된 분노 (1302), Hard 5 only
    renderRoute();
    const segments = within(rows()).getAllByTestId('segment');
    expect(segments.map((s) => [s.getAttribute('data-from'), s.getAttribute('data-to')])).toEqual([
      ['4', '4'],
      ['5', '5'],
    ]);
    expect(segments[0]).not.toHaveTextContent('고정');
  });

  it('keeps partly overlapping windows on separate lanes with suggested stops and a half-filled station', () => {
    useApp.getState().setDeck(BURN_DECK, 7);
    for (const id of [9415, 9427]) useApp.getState().toggleWanted(id); // 2-3 and 3-4
    fillObservations();
    renderRoute();
    const segments = within(rows()).getAllByTestId('segment');
    expect(segments).toHaveLength(2);
    expect(segments.every((s) => s.hasAttribute('data-partial'))).toBe(true);
    expect(new Set(segments.map((s) => s.getAttribute('data-lane'))).size).toBe(2);
    expect(within(rows()).getAllByTestId('suggested').map((c) => c.getAttribute('data-floor'))).toEqual(['2', '3']);
    const overlapped = within(rows()).getAllByTestId('station').filter((el) => el.hasAttribute('data-overlap'));
    expect(overlapped.map((el) => el.getAttribute('data-floor'))).toEqual(['3']);
    expect(segments[0]).not.toHaveTextContent('추천');
  });

  it('rides packs with identical windows on one segment and lists every name', () => {
    useApp.getState().setDeck(BURN_DECK, 7);
    for (const id of [9415, 9419]) useApp.getState().toggleWanted(id); // both Hard 2-3
    fillObservations();
    renderRoute();
    const segment = within(rows()).getByTestId('segment');
    expect(within(segment).getAllByTestId('segment-pack')).toHaveLength(2);
    expect(within(rows()).queryByTestId('suggested')).toBeNull();
  });

  it('draws no legend and no wording on the map itself: no band, segment, starlight or drop text', () => {
    useApp.getState().setDeck(BURN_DECK, 7);
    for (const id of [9415, 9427, 9267]) useApp.getState().toggleWanted(id); // partial windows and a fixed pack
    fillObservations();
    renderRoute();
    expect(screen.queryByTestId('legend')).toBeNull();
    // Scoped to the map: fill, dash and weight are its whole vocabulary. The panel around it does
    // carry prose where the plan has to explain itself (the general-drops card, the 「참고」 list).
    expect(rows().textContent).not.toMatch(/고정|한 층|추천|어느 층|Hard|EXTREME|평행중첩|범례|별빛|합성|범용 드랍|나올 수 있음/);
  });

  it('rides no gift on a route block: the map is packs and floors alone', () => {
    useApp.getState().setDeck(BURN_DECK, 7);
    useApp.getState().toggleWanted(9267);
    renderRoute();
    const segment = within(rows()).getByTestId('segment');
    // The portrait and the name stay; what the pack drops is the sheet behind it.
    expect(within(segment).getByTestId('pack-image')).toBeInTheDocument();
    expect(within(segment).queryByTestId('gift-icon')).toBeNull();
  });

  it('gives the start and the observations a line each at the head of the map', () => {
    useApp.getState().setDeck(BURN_DECK, 7);
    useApp.getState().toggleWanted(9267);
    useApp.getState().toggleWanted(9423); // observable; the planner recommends observing it
    renderRoute();
    const cell = within(rows()).getByTestId('start-cell');
    const start = within(cell).getByTestId('start-line');
    const observed = within(cell).getByTestId('observed-line');
    // The row carries 「관측」 as visible text: it used to live in `aria-label` only, which left a
    // row of dashed eyes saying nothing to a touch or no-hover reader.
    expect(observed.textContent).toMatch(/관측/);
    expect(within(observed).getAllByTestId('observed-tile').length).toBeGreaterThan(0);
    // Before the run it is a recommendation, not a record.
    expect(observed).not.toHaveAttribute('data-history');
    // They are two decisions, so nothing from one line leaks into the other.
    expect(within(start).queryByTestId('observed-tile')).toBeNull();
  });

  /*
   * Core stops proposing observations once the run is past floor 1 — the starlight is long spent,
   * and recommending something you can no longer do would be a lie. But the row was derived from
   * that same empty list, so a player on floor 3 saw three unexplained dashed eyes even though
   * they had observed. `run.startGifts` is the only thing that still knows.
   */
  it('turns the observation row into the record of what the run started with, once it is under way', () => {
    useApp.getState().setDeck(BURN_DECK, 7);
    useApp.getState().toggleWanted(9267);
    useApp.getState().toggleWanted(9423);
    renderRoute();
    const observed = () => within(rows()).getByTestId('observed-line');
    const held = within(observed()).getAllByTestId('observed-tile')[0]!.textContent!;

    // Leaving floor 1 is what records the start-of-run gifts (`moveFrontier`'s 1 → >1 branch).
    act(() => {
      useApp.getState().visitPack(1002, 1, { got: [9423] });
      useApp.getState().visitPack(1101, 2);
    });
    expect(useApp.getState().run.currentFloor).toBeGreaterThan(1);
    expect(useApp.getState().run.startGifts).toContain(9423);

    expect(observed()).toHaveAttribute('data-history');
    expect(observed().textContent).toMatch(/시작 시 보유/);
    expect(within(observed()).getAllByTestId('observed-tile')[0]!.textContent).toBe(held);
    // The decision is past, so unspent slots are no longer a decision left open.
    expect(within(observed()).queryAllByTestId('observed-empty')).toHaveLength(0);
  });

  it('keeps every observation slot on screen, filled or not', () => {
    useApp.getState().setDeck(BURN_DECK, 7);
    useApp.getState().toggleWanted(9267);
    useApp.getState().toggleWanted(9423); // the planner recommends observing this one
    renderRoute();
    const line = () => within(rows()).getByTestId('observed-line');
    const cells = () => within(line()).queryAllByTestId('observed-tile').length + within(line()).queryAllByTestId('observed-empty').length;
    // Three slots this season funds, however many the plan spends.
    expect(cells()).toBe(3);
    expect(within(line()).getAllByTestId('observed-tile')).toHaveLength(1);
    expect(within(line()).getAllByTestId('observed-empty')).toHaveLength(2);
    // With nothing observed the row still stands: an unspent slot is a decision left open. And it
    // says why it is empty rather than leaving three unexplained dashed eyes.
    act(() => useApp.getState().removeWanted(9423));
    expect(cells()).toBe(3);
    expect(within(line()).queryAllByTestId('observed-tile')).toHaveLength(0);
    expect(within(line()).getByTestId('observed-none')).toHaveTextContent('추천할 관측이 없습니다');
  });

  it('opens a pack in a sheet from its card, lists its gifts, and lets it be given up and restored', async () => {
    const user = userEvent.setup();
    useApp.getState().setDeck(BURN_DECK, 7);
    useApp.getState().toggleWanted(9267); // 화왕지절 or 해방된 분노
    renderRoute();
    await user.click(within(rows()).getByRole('button', { name: '화왕지절' }));
    const sheet = screen.getByRole('dialog', { name: '화왕지절' });
    expect(sheet).toHaveAttribute('data-testid', 'block-sheet');
    expect(sheet).toHaveTextContent('4~5층');
    expect(sheet).not.toHaveTextContent('Hard');
    expect(within(sheet).getAllByTestId('pack-gift').length).toBeGreaterThan(1);
    const wantedRow = within(sheet).getAllByTestId('pack-gift').find((el) => el.hasAttribute('data-wanted'))!;
    expect(wantedRow).toHaveTextContent('달궈진 놋쇠');
    expect(wantedRow).toHaveTextContent('전용');
    // The run context is on: each gift is a pressable tile, and floor 4 is not on stage so no entry button.
    expect(within(wantedRow).getByTestId('gift-tile')).toHaveAttribute('aria-pressed', 'false');
    expect(within(sheet).queryByRole('button', { name: '화왕지절 입장' })).toBeNull();
    await user.click(within(sheet).getByRole('button', { name: '화왕지절 이 팩 포기' }));
    // Giving up the only source of a wanted gift asks first — in the app's own dialog, not the
    // browser's, which failed open where `window.confirm` is withheld.
    const ask = screen.getByTestId('confirm-dialog');
    expect(ask).toHaveTextContent('달궈진 놋쇠');
    await user.click(within(ask).getByRole('button', { name: '이 팩 포기' }));
    expect(useApp.getState().options.bannedPacks).toEqual([1402]);
    // The gift now comes from the other pack, and the given-up pack can be restored.
    expect(within(rows()).getByRole('button', { name: '해방된 분노' })).toBeInTheDocument();
    const banned = within(screen.getByTestId('unresolved')).getByTestId('banned-pack');
    expect(banned).toHaveTextContent('화왕지절');
    await user.click(within(banned).getByRole('button', { name: '화왕지절 되돌리기' }));
    expect(useApp.getState().options.bannedPacks).toEqual([]);
  });

  it('opens a sheet from an observed tile and pins the observation from it', async () => {
    const user = userEvent.setup();
    useApp.getState().setDeck(BURN_DECK, 7);
    useApp.getState().toggleWanted(9267);
    useApp.getState().toggleWanted(9423); // observable; the planner recommends observing it
    renderRoute();
    const tile = within(within(rows()).getByTestId('start-cell')).getByTestId('observed-tile');
    expect(tile).not.toHaveAttribute('data-pinned');
    expect(tile.textContent).not.toMatch(/추천|지정/);
    expect(tile).toHaveAttribute('title', '깨진 안경 · 관측 · 변하지 않는 안 가도 됨');
    await user.click(tile);
    const observed = screen.getByTestId('block-sheet');
    expect(observed).toHaveTextContent('변하지 않는 안 가도 됨');
    await user.click(within(observed).getByRole('button', { name: '깨진 안경 관측 지정 전환' }));
    expect(useApp.getState().options.observedGifts).toEqual([9423]);
    await user.click(within(observed).getByRole('button', { name: '닫기' }));
    expect(screen.queryByTestId('block-sheet')).toBeNull();
    expect(within(within(rows()).getByTestId('start-cell')).getByTestId('observed-tile')).toHaveAttribute('data-pinned');
  });

  it('groups a pack conflict by its floors and lets a pack be included or given up as a whole', async () => {
    const user = userEvent.setup();
    useApp.getState().setDeck(BURN_DECK, 7);
    for (const id of CLEAR_REWARDS) useApp.getState().toggleWanted(id); // six EXTREME packs for five floors
    renderRoute();
    const group = screen.getByTestId('conflict-group');
    expect(group).toHaveAttribute('data-from', '11');
    expect(group).toHaveTextContent('11~15층 · 자리 5개에 팩 6개');
    const cards = within(group).getAllByTestId('pack-conflict-card');
    expect(cards).toHaveLength(6);
    expect(cards.filter((c) => c.hasAttribute('data-included'))).toHaveLength(5);
    const left = cards.find((c) => !c.hasAttribute('data-included'))!;
    expect(left).toHaveTextContent('핏물진 비린내');
    expect(left).toHaveTextContent('박수 짝짝!');
    expect(screen.getByRole('button', { name: '대안 루트 보기' })).toBeInTheDocument();
    expect(screen.getByTestId('route-summary')).toHaveTextContent('미해결 1');
    // Include the left-out pack: it takes a floor and another pack drops out.
    await user.click(within(left).getByRole('button', { name: '핏물진 비린내 이 팩으로' }));
    expect(useApp.getState().options.preferredPacks).toEqual([1516]);
    const after = within(screen.getByTestId('conflict-group')).getAllByTestId('pack-conflict-card');
    expect(after.find((c) => c.getAttribute('data-pack') === '1516')).toHaveAttribute('data-included');
    expect(after.filter((c) => !c.hasAttribute('data-included'))).toHaveLength(1);
    // Give up an included pack: it leaves the plan and shows in the given-up list until restored.
    const included = after.find((c) => c.hasAttribute('data-included') && c.getAttribute('data-pack') !== '1516')!;
    await user.click(within(included).getByRole('button', { name: /이 팩 포기$/ }));
    expect(useApp.getState().options.bannedPacks).toHaveLength(1);
    const banned = screen.getByTestId('banned');
    expect(banned).toHaveTextContent('포기한 팩 1');
    await user.click(within(banned).getByRole('button', { name: /되돌리기$/ }));
    expect(useApp.getState().options.bannedPacks).toEqual([]);
  });

  it('offers alternative routes as tabs and confirming one deselects that gift', async () => {
    const user = userEvent.setup();
    useApp.getState().setDeck(BURN_DECK, 7);
    for (const id of CLEAR_REWARDS) useApp.getState().toggleWanted(id);
    renderRoute();
    const tabs = within(screen.getByRole('tablist', { name: '대안 루트' })).getAllByRole('tab');
    expect(tabs).toHaveLength(5);
    await user.click(tabs[1]!);
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByTestId('conflict-group')).toBeNull();
    expect(screen.getByText(/^확보/).parentElement).toHaveTextContent('5/5');
    await user.click(screen.getByRole('button', { name: '이 기프트 선택 해제' }));
    // 포기 is no longer a priority: the gift simply leaves the selection.
    expect(useApp.getState().wanted).toHaveLength(CLEAR_REWARDS.length - 1);
    expect(useApp.getState().priority).toEqual({});
    expect(screen.queryByTestId('skipped')).toBeNull();
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  it('deselects an unresolved gift from its row in the unresolved card', async () => {
    const user = userEvent.setup();
    useApp.getState().setDeck(BURN_DECK, 7);
    for (const id of CLEAR_REWARDS) useApp.getState().toggleWanted(id);
    useApp.getState().banPack(1516);
    renderRoute();
    // With one pack given up, the sixth reward fails on its own instead of as a pack conflict.
    const row = screen.getAllByTestId('unresolved-row')[0]!;
    expect(within(row).queryByRole('button', { name: /포기/ })).toBeNull();
    await user.click(within(row).getByRole('button', { name: /선택 해제$/ }));
    expect(useApp.getState().wanted).toHaveLength(CLEAR_REWARDS.length - 1);
  });

  it('lets a must-have gift win the conflict and shows its pack as included', () => {
    useApp.getState().setDeck(BURN_DECK, 7);
    for (const id of CLEAR_REWARDS) useApp.getState().toggleWanted(id);
    useApp.getState().setPriority(9255, 'must');
    renderRoute();
    const cards = within(screen.getByTestId('conflict-group')).getAllByTestId('pack-conflict-card');
    expect(cards.find((c) => c.getAttribute('data-pack') === '1516')).toHaveAttribute('data-included');
    expect(cards.filter((c) => !c.hasAttribute('data-included'))).toHaveLength(1);
  });

  it('offers an observation for an unresolved gift only while it is observable and a slot is free', () => {
    const conflict = (giftId: number) => ({ giftId, reason: 'pack-conflict' as const, detail: { ko: '', en: '' } });
    const free = appDefaultOptions();
    expect(actionsFor(conflict(9423), indexes.giftById.get(9423), free, data.rules)).toEqual([
      { kind: 'observeGift', giftId: 9423, patch: { observedGifts: [9423] } },
    ]);
    // EXTREME clear rewards cannot be observed.
    expect(actionsFor(conflict(9255), indexes.giftById.get(9255), free, data.rules)).toEqual([]);
    const full = { ...free, observedGifts: [9283, 9222, 9217] };
    expect(actionsFor(conflict(9423), indexes.giftById.get(9423), full, data.rules)).toEqual([{ kind: 'releaseObservations', patch: { observedGifts: [] } }]);
    expect(actionsFor(conflict(9283), indexes.giftById.get(9283), full, data.rules)).toEqual([]);
  });

  it('toggles a goal between 보통 and 반드시 from its sheet; 포기 is not a priority any more', async () => {
    const user = userEvent.setup();
    useApp.getState().setDeck(BURN_DECK, 7);
    useApp.getState().toggleWanted(9283);
    const { deck, deployed } = useApp.getState();
    renderPlanned(<GiftsStep data={data} indexes={indexes} stats={statsFor(deck, deployed)} lang="ko" />);
    await user.click(within(screen.getByTestId('gift-chip')).getByRole('button', { name: '상납된 시가 자세히' }));
    const sheet = screen.getByRole('dialog', { name: '상납된 시가' });
    await user.click(within(sheet).getByRole('button', { name: '상납된 시가 우선순위: 보통' }));
    expect(useApp.getState().priority).toEqual({ 9283: 'must' });
    await user.click(within(sheet).getByRole('button', { name: '상납된 시가 우선순위: 반드시' }));
    expect(useApp.getState().priority).toEqual({});
    expect(within(sheet).queryByRole('button', { name: /포기/ })).toBeNull();
    // Deselecting a gift forgets its priority.
    useApp.getState().setPriority(9283, 'must');
    useApp.getState().toggleWanted(9283);
    expect(useApp.getState().priority).toEqual({});
  });

  it('copies the plan by segment with localized names instead of raw ids', () => {
    useApp.getState().setDeck(BURN_DECK, 7);
    const oneSlot = { ...data, rules: { ...data.rules, giftObservation: { ...data.rules.giftObservation, max: 1 } } };
    const plan = planRoute(
      {
        deck: BURN_DECK,
        wanted: [{ giftId: 9423, required: true }, { giftId: 9415, required: true }, { giftId: 9419, required: true }],
        options: { ...defaultOptions(), lastFloor: 15, hardFromFloor: 1, observedGifts: [9423] },
      },
      oneSlot,
      indexes,
    );
    const text = planToText(
      plan,
      (id) => indexes.giftById.get(id)?.name.ko ?? '',
      (id) => indexes.packById.get(id)?.name.ko ?? '',
      (id) => keywordName(id, data.enums, 'ko'),
      'ko',
    );
    expect(text).not.toContain('Combustion');
    expect(text).toContain('시작: 화상');
    expect(text).toContain('관측: 깨진 안경 (지정)');
    // The floor unit follows the language, like everywhere else in the app.
    expect(text).toContain('2~3층: 마주하지 않는 · 낙화');
    expect(text).not.toMatch(/\d+F/);
    expect(text).not.toMatch(/어느 층|추천|Hard/);
    expect(text).toContain('  - 불결함 (마주하지 않는)');
    expect(text).toContain('4~15층: 자유');
    for (const word of ['별빛', '조합', '범용']) expect(text).not.toContain(word);
    const without = planToText(plan, (id) => indexes.giftById.get(id)?.name.ko ?? '', () => '', () => '', 'ko', [9283]);
    expect(without.split('\n')[0]).toBe('상납된 시가 제외');
    const marked = planToText(plan, (id) => indexes.giftById.get(id)?.name.ko ?? '', (id) => indexes.packById.get(id)?.name.ko ?? '', () => '', 'ko', [], { must: [9423], bannedPacks: [1402] });
    expect(marked).toContain('깨진 안경 (반드시)');
    expect(marked.trim().split('\n').at(-1)).toBe('포기한 팩: 화왕지절');
    expect(marked).not.toContain('포기: ');
  });

  it('drops the visits made only for the other ingredients once the result alone is the goal', () => {
    useApp.getState().setDeck(BURN_DECK, 7);
    useApp.getState().toggleWanted(9249); // ← 9431 (1016, Hard 1) + 9706·9707 (1102, Hard 2-3)
    // Observation off, or the planner would simply observe the ingredients instead of visiting.
    const noObservation = { ...data, rules: { ...data.rules, giftObservation: { ...data.rules.giftObservation, max: 0 } } };
    renderPlanned(<RoutePlanPanel />, noObservation);
    const packs = () => within(rows()).getAllByTestId('segment-pack').map((el) => el.getAttribute('data-pack'));
    expect(packs()).toEqual(['1016', '1102']);
    act(() => useApp.getState().setGiftStatus(9707, 'failed'));
    // Ingredients stay goals by default, so both packs are still on the map.
    expect(packs()).toEqual(['1016', '1102']);
    expect(screen.getByTestId('unresolved')).toHaveTextContent('수집 실패');
    expect(screen.getByTestId('route-summary')).toHaveTextContent('실패 1');
    act(() => useApp.getState().setFusionGoal(9249, 'resultOnly'));
    expect(within(rows()).queryByTestId('segment-pack')).toBeNull();
    expect(screen.getByTestId('unresolved')).toHaveTextContent('취소했습니다');
  });
});

describe('AppShell', () => {
  const seasonEntry = (id: number, name: string) => ({
    id,
    name: { ko: name, en: name },
    dataVersion: `${id}.0`,
    lastFloor: 15,
    provisional: false,
  });
  const renderShell = (seasons = [seasonEntry(data.meta.dungeon.id, data.meta.dungeon.name.ko)], onSeason = () => undefined) => {
    const { deck, deployed } = useApp.getState();
    return render(<AppShell data={data} indexes={indexes} stats={statsFor(deck, deployed)} lang="ko" dark seasons={seasons} onSeason={onSeason} onShare={() => undefined} onToggleLang={() => undefined} onToggleDark={() => undefined} />);
  };

  it('opens each panel as its own full-screen page on a phone, one at a time, and remembers the tab', async () => {
    const user = userEvent.setup();
    renderShell();
    expect(screen.queryByTestId('page-left')).toBeNull();
    expect(screen.queryByTestId('panel-left')).toBeNull();
    expect(screen.getByTestId('run-stage')).toHaveAttribute('data-mode', 'undecided');
    const left = screen.getByRole('button', { name: '덱' });
    expect(left).toHaveAttribute('aria-expanded', 'false');
    await user.click(left);
    const page = screen.getByTestId('page-left');
    expect(left).toHaveAttribute('aria-expanded', 'true');
    // A page, not a dialog: no backdrop, no modal semantics, and the shell behind it goes inert.
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(within(page).getByRole('heading', { level: 1 })).toHaveTextContent('설정 패널');
    expect(screen.getByTestId('app-shell')).toHaveAttribute('inert');
    // The default tab is the items tab; the deck tab shows the twelve slots.
    expect(within(page).getByRole('tab', { name: '아이템' })).toHaveAttribute('aria-selected', 'true');
    // Two tabs only: the route options (start keyword, chosen packs) sit under the items tab.
    expect(within(page).getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['덱', '아이템']);
    expect(within(page).getByRole('combobox', { name: '시작 키워드' })).toBeInTheDocument();
    expect(within(page).getByTestId('settings-packs')).toBeInTheDocument();
    await user.click(within(page).getByRole('tab', { name: '덱' }));
    expect(useApp.getState().ui.leftTab).toBe('deck');
    expect(within(page).getAllByText('인격 선택')).toHaveLength(12);
    // The header is behind the page, so the way out is the page's own back button.
    await user.click(within(page).getByRole('button', { name: '뒤로' }));
    expect(screen.queryByTestId('page-left')).toBeNull();
    expect(screen.getByTestId('app-shell')).not.toHaveAttribute('inert');

    await user.click(screen.getByRole('button', { name: '전체 루트' }));
    const right = screen.getByTestId('page-right');
    expect(within(right).getByTestId('route-empty')).toBeInTheDocument();
    // One page hands over to the other from inside: the empty state opens the items tab.
    await user.click(within(right).getByRole('button', { name: '아이템' }));
    expect(screen.queryByTestId('page-right')).toBeNull();
    expect(within(screen.getByTestId('page-left')).getByRole('tab', { name: '아이템' })).toHaveAttribute('aria-selected', 'true');
    await user.click(screen.getByRole('button', { name: '뒤로' }));
    expect(screen.queryByTestId('page-left')).toBeNull();
    // The tracker tab lives in the right page.
    await user.click(screen.getByRole('button', { name: '전체 루트' }));
    await user.click(screen.getByRole('tab', { name: '목표' }));
    expect(screen.getByTestId('goals-empty')).toBeInTheDocument();
    expect(useApp.getState().ui.rightTab).toBe('goals');
    await user.click(screen.getByRole('tab', { name: '추적기' }));
    expect(screen.getByTestId('tracker')).toBeInTheDocument();
    expect(useApp.getState().ui.rightTab).toBe('tracker');
  });

  // The phone bug this guards: every dismiss listener sits on `document`, and a sheet portals to
  // the body, so a press inside the sheet used to read as "outside" to the panel page under it and
  // one tap closed both.
  it('closes only the sheet on a phone, leaving the page it was opened from', async () => {
    const user = userEvent.setup();
    useApp.getState().setDeck(BURN_DECK, 7);
    renderShell();
    await user.click(screen.getByRole('button', { name: '덱' }));
    const page = screen.getByTestId('page-left');
    const tile = within(page).getAllByTestId('gift-tile').find((el) => el.getAttribute('data-gift') === '9088')!;
    await user.click(within(tile).getByRole('button', { name: '진혼 자세히' }));
    expect(screen.getByTestId('gift-detail')).toBeInTheDocument();

    await user.click(within(screen.getByTestId('block-sheet')).getByRole('button', { name: '닫기' }));
    expect(screen.queryByTestId('gift-detail')).toBeNull();
    expect(screen.getByTestId('page-left')).toBeInTheDocument();
  });

  it('closes only the sheet on Escape and on a press outside it, never the page beneath', async () => {
    const user = userEvent.setup();
    useApp.getState().setDeck(BURN_DECK, 7);
    renderShell();
    await user.click(screen.getByRole('button', { name: '덱' }));
    const openSheet = async () => {
      const page = screen.getByTestId('page-left');
      const tile = within(page).getAllByTestId('gift-tile').find((el) => el.getAttribute('data-gift') === '9088')!;
      await user.click(within(tile).getByRole('button', { name: '진혼 자세히' }));
      expect(screen.getByTestId('gift-detail')).toBeInTheDocument();
    };

    await openSheet();
    await user.keyboard('{Escape}');
    expect(screen.queryByTestId('gift-detail')).toBeNull();
    expect(screen.getByTestId('page-left')).toBeInTheDocument();

    // A press on the backdrop is 「outside」 for the sheet and for the page alike; only the top layer answers.
    await openSheet();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByTestId('gift-detail')).toBeNull();
    expect(screen.getByTestId('page-left')).toBeInTheDocument();

    // With the sheet gone the page is topmost again — and a page ignores outside presses entirely.
    fireEvent.pointerDown(document.body);
    expect(screen.getByTestId('page-left')).toBeInTheDocument();
  });

  it('resets the deck, items, route options and run from the header after a confirmation, keeping the panel state', async () => {
    const user = userEvent.setup();
    useApp.getState().setDeck(BURN_DECK, 7);
    for (const id of [9267, 9423, 9249]) useApp.getState().toggleWanted(id);
    useApp.getState().setPriority(9267, 'must');
    useApp.getState().setFusionGoal(9249, 'resultOnly');
    useApp.getState().toggleObserved(9423, { max: 3, observable: () => true });
    useApp.getState().banPack(1402);
    useApp.getState().visitPack(1008, 2);
    useApp.getState().setUi({ leftTab: 'deck', rightTab: 'goals' });
    renderShell();
    // The four one-off actions live behind 「⋯」 now; the header itself carries only the two doors.
    const openMenu = async () => user.click(screen.getByRole('button', { name: '더 보기' }));
    const reset = async () => {
      await openMenu();
      await user.click(within(screen.getByTestId('header-menu')).getByRole('button', { name: '초기화' }));
    };
    await openMenu();
    expect(within(screen.getByTestId('header-menu')).getAllByRole('button').map((b) => b.textContent)).toEqual(['초기화', '링크 복사', 'English', '화면 전환']);
    // A menu, not a detail: no close row above the first item (it drew an empty band on a phone,
    // where the fixed-width popover ran off the right edge and hid the ✕), and anchored to the
    // header's right edge so it stays on screen.
    const popover = screen.getByTestId('block-popover');
    expect(within(popover).queryByRole('button', { name: '닫기' })).toBeNull();
    expect(popover.style.right).toBe('0px');
    expect(popover.className).not.toMatch(/w-\[320px\]/);
    await user.keyboard('{Escape}');
    expect(screen.queryByTestId('header-menu')).toBeNull();
    await reset();
    await user.click(within(screen.getByTestId('confirm-dialog')).getByRole('button', { name: '취소' }));
    expect(useApp.getState().wanted).toEqual([9267, 9423, 9249]); // as picked, not by id
    expect(screen.queryByTestId('confirm-dialog')).toBeNull();
    await reset();
    await user.click(within(screen.getByTestId('confirm-dialog')).getAllByRole('button', { name: '초기화' })[0]!);
    const state = useApp.getState();
    expect(state.deck).toEqual(defaultDeck(data));
    expect(state.deployed).toEqual(defaultDeck(data).slice(0, data.rules.deployment.default));
    expect(state.wanted).toEqual([]);
    expect(state.priority).toEqual({});
    expect(state.fusionGoal).toEqual({});
    expect(state.options).toEqual(appDefaultOptions());
    expect(state.run).toEqual(emptyRun());
    expect(state.ui).toMatchObject({ leftTab: 'deck', rightTab: 'goals' });
    expect(screen.getByTestId('run-stage')).toHaveAttribute('data-mode', 'undecided');
    expect(screen.getByTestId('stage-floor')).toHaveTextContent('1');
    // The same button starts over after a finished run, where the old 「새 런」 used to be.
    act(() => useApp.setState({ run: { currentFloor: 16, stageFloor: 16, visits: { 4: 1402 }, giftStatus: { 9267: 'got' }, startGifts: [] } }));
    expect(screen.getByTestId('run-stage')).toHaveAttribute('data-mode', 'done');
    await reset();
    await user.click(within(screen.getByTestId('confirm-dialog')).getAllByRole('button', { name: '초기화' })[0]!);
    expect(useApp.getState().run).toEqual(emptyRun());
    expect(screen.getByTestId('run-stage')).toHaveAttribute('data-mode', 'undecided');
  });

  it('keeps both panels beside the stage on a desktop and folds them from the header', async () => {
    stubMatchMedia(true);
    const user = userEvent.setup();
    renderShell();
    expect(screen.getByTestId('panel-left')).toBeInTheDocument();
    expect(screen.getByTestId('panel-right')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    const left = screen.getByRole('button', { name: '덱' });
    expect(left).toHaveAttribute('aria-expanded', 'true');
    expect(left).toHaveAttribute('aria-controls', 'panel-left');
    await user.click(left);
    expect(screen.queryByTestId('panel-left')).toBeNull();
    expect(useApp.getState().ui.leftOpen).toBe(false);
    await user.click(left);
    expect(screen.getByTestId('panel-left')).toBeInTheDocument();
  });

  it('resizes a desktop panel by dragging the divider, by the keyboard, and back to the default', async () => {
    stubMatchMedia(true);
    const user = userEvent.setup();
    renderShell();
    const panel = () => screen.getByTestId('panel-left');
    expect(panel()).toHaveStyle({ width: '336px' });
    const divider = screen.getByTestId('panel-resizer-left');
    expect(divider).toHaveAttribute('role', 'separator');
    expect(divider).toHaveAttribute('aria-valuenow', '336');
    // Dragging right widens the left panel; the width is remembered.
    fireEvent.pointerDown(divider, { pointerId: 1, button: 0, clientX: 336 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 436 });
    expect(useApp.getState().ui.leftWidth).toBe(436);
    expect(panel()).toHaveStyle({ width: '436px' });
    // It never gets wider than the band allows, and the drag ends with the pointer.
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 2000 });
    expect(useApp.getState().ui.leftWidth).toBe(560);
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 2000 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 300 });
    expect(useApp.getState().ui.leftWidth).toBe(560);
    // The keyboard nudges it, and a double press puts it back.
    divider.focus();
    await user.keyboard('{ArrowLeft}');
    expect(useApp.getState().ui.leftWidth).toBe(544);
    await user.dblClick(divider);
    expect(useApp.getState().ui.leftWidth).toBe(336);
    // The right panel mirrors the direction: dragging left widens it.
    fireEvent.pointerDown(screen.getByTestId('panel-resizer-right'), { pointerId: 2, button: 0, clientX: 900 });
    fireEvent.pointerMove(window, { pointerId: 2, clientX: 850 });
    expect(useApp.getState().ui.rightWidth).toBe(386);
    fireEvent.pointerUp(window, { pointerId: 2, clientX: 850 });
  });
});

describe('gestures that used to run into each other', () => {
  const pointer = { pointerId: 1, button: 0, clientX: 60, clientY: 200 };

  it('abandons a hold once the pointer moves, so a drag cannot also open the details', async () => {
    const user = userEvent.setup();
    useApp.getState().setDeck(BURN_DECK, 7);
    useApp.getState().toggleWanted(9267);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderPlanned(<GoalsPanel />);
      const tile = within(screen.getByTestId('route-goal')).getByTestId('gift-tile');
      // A tile inside a pack area follows the finger one-to-one, so `pointerleave` never comes; a
      // slow drag used to open the sheet at one second and commit the pull on release.
      fireEvent.pointerDown(tile, pointer);
      fireEvent.pointerMove(window, { ...pointer, clientY: pointer.clientY + 40 });
      await act(async () => {
        vi.advanceTimersByTime(1200);
      });
      expect(screen.queryByTestId('gift-detail')).toBeNull();
      fireEvent.pointerUp(window, { ...pointer, clientY: pointer.clientY + 40 });
    } finally {
      vi.useRealTimers();
    }
    // A hold that stays put still opens it.
    await user.pointer({ keys: '[MouseLeft>]', target: within(screen.getByTestId('route-goal')).getByTestId('gift-tile') });
    await waitFor(() => expect(screen.getByTestId('gift-detail')).toBeInTheDocument(), { timeout: 2000 });
  });

  it('takes a fresh press on a card even after a release the window never saw', () => {
    useApp.getState().setDeck(BURN_DECK, 7);
    useApp.getState().toggleWanted(9267);
    useApp.setState({ run: { ...emptyRun(), currentFloor: 4, stageFloor: 4 } });
    renderPlanned(<RunStage onOpenGifts={() => undefined} />);
    const card = screen.getByTestId('stage-pack');
    // Releasing over another monitor never reaches the window listeners; the leftover candidate
    // used to refuse every later press for the component's lifetime.
    fireEvent.pointerDown(card, pointer);
    fireEvent.pointerDown(card, pointer);
    fireEvent.pointerMove(window, { ...pointer, clientY: pointer.clientY + 90 });
    fireEvent.pointerUp(window, { ...pointer, clientY: pointer.clientY + 90 });
    expect(useApp.getState().run.visits).toEqual({ 4: 1402 });
  });

  it('keeps every touch on a pulled element for the gesture, at rest and mid-pull', () => {
    useApp.getState().setDeck(BURN_DECK, 7);
    useApp.getState().toggleWanted(9267);
    useApp.setState({ run: { ...emptyRun(), currentFloor: 4, stageFloor: 4 } });
    renderPlanned(<RunStage onOpenGifts={() => undefined} />);
    const card = screen.getByTestId('stage-pack');
    // `pan-x` let a phone browser judge the direction first and take a vertical drag for a scroll —
    // the pull got a `pointercancel` and the page a pull-to-refresh. Nothing on the stage scrolls
    // sideways, so the element gives the browser nothing.
    expect(card.style.touchAction).toBe('none');
    fireEvent.pointerDown(card, pointer);
    fireEvent.pointerMove(window, { ...pointer, clientY: pointer.clientY + 40 });
    expect(card).toHaveAttribute('data-pulling');
    expect(card.style.touchAction).toBe('none');
    fireEvent.pointerUp(window, { ...pointer, clientY: pointer.clientY + 40 });
    expect(useApp.getState().run.visits).toEqual({});
  });
});

describe('overlays that used to fight each other', () => {
  it('lets the 「+」 close the popover it opened', async () => {
    const user = userEvent.setup();
    useApp.getState().setDeck(BURN_DECK, 7);
    useApp.getState().toggleWanted(9222);
    renderPlanned(<GiftsStep data={data} indexes={indexes} stats={statsFor(useApp.getState().deck, useApp.getState().deployed)} lang="ko" />);
    const plus = () => screen.getAllByRole('button', { name: '관측 지정 추가' })[0]!;
    await user.click(plus());
    expect(screen.getByTestId('observe-candidates')).toBeInTheDocument();
    expect(plus()).toHaveAttribute('aria-expanded', 'true');
    // The button's own `pointerdown` used to dismiss the popover and its `click` to re-open it, so
    // it could never close what it had opened and `aria-expanded` lied. `aria-controls` tells the
    // dismiss which press is its own opener.
    await user.click(plus());
    expect(screen.queryByTestId('observe-candidates')).toBeNull();
    expect(plus()).toHaveAttribute('aria-expanded', 'false');
  });

  it('holds the background still while a sheet is open and hands focus back when it closes', async () => {
    const user = userEvent.setup();
    useApp.getState().setDeck(BURN_DECK, 7);
    useApp.getState().toggleWanted(9283);
    renderPlanned(<GiftsStep data={data} indexes={indexes} stats={statsFor(useApp.getState().deck, useApp.getState().deployed)} lang="ko" />);
    const name = within(screen.getByTestId('gift-chip')).getByRole('button', { name: '상납된 시가 자세히' });
    name.focus();
    await user.click(name);
    expect(screen.getByTestId('gift-detail')).toBeInTheDocument();
    expect(document.body.style.overflow).toBe('hidden');
    await user.keyboard('{Escape}');
    expect(screen.queryByTestId('gift-detail')).toBeNull();
    expect(document.body.style.overflow).toBe('');
    // Focus used to fall to `<body>`, so the next Tab restarted at the top of the document.
    expect(document.activeElement).toBe(name);
  });
});

describe('RunStage', () => {
  const renderStage = (withPlan = false) =>
    renderPlanned(
      <>
        <RunStage onOpenGifts={() => undefined} />
        {withPlan ? <RoutePlanPanel /> : null}
      </>,
    );
  const header = () => screen.getByTestId('floor-header');
  const skipFloor = async (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole('button', { name: '넘기기' }));
  const lookBack = async (user: ReturnType<typeof userEvent.setup>, floor: number) =>
    user.click(within(header()).getAllByTestId('floor-cell').find((cell) => cell.getAttribute('data-floor') === String(floor))!);
  const pointer = { pointerId: 1, button: 0, clientX: 60, clientY: 200 };
  /** Pull an element vertically by `dy` and let go. */
  const pull = (el: HTMLElement, dy: number) => {
    fireEvent.pointerDown(el, pointer);
    fireEvent.pointerMove(window, { ...pointer, clientY: pointer.clientY + dy });
    fireEvent.pointerUp(window, { ...pointer, clientY: pointer.clientY + dy });
  };

  it('draws the fifteen floors alike, with no dot for the floors that hold a pack', () => {
    useApp.getState().setDeck(BURN_DECK, 7);
    useApp.getState().toggleWanted(9267);
    renderStage();
    const cells = within(header()).getAllByTestId('floor-cell');
    expect(cells).toHaveLength(15);
    for (const cell of cells) {
      // The number is all a cell says; the pack stays in the label and the data attribute.
      expect(cell.textContent).toMatch(/^\d+$/);
      expect(cell.querySelector('.rounded-full')).toBeNull();
      // No band shading: 1-5, 6-10 and 11-15 are drawn the same.
      expect(cell.className).not.toContain('bg-hatch');
      expect(cell.className).not.toContain('bg-surface-2');
    }
    expect(cells.some((cell) => cell.getAttribute('data-pack'))).toBe(true);
  });

  it('asks for goals first, then walks to the recommended pack, enters it, marks its gifts and goes back', async () => {
    const user = userEvent.setup();
    useApp.getState().setDeck(BURN_DECK, 7);
    const { unmount } = renderStage();
    expect(screen.getByText('아직 목표 기프트가 없습니다.')).toBeInTheDocument();
    unmount();
    useApp.getState().toggleWanted(9267); // 화왕지절 (1402), Hard 4-5
    renderStage();
    expect(screen.getByTestId('stage-floor')).toHaveTextContent('1');
    // The header names no difficulty: the app always plays Hard, so the word says nothing.
    expect(header().textContent).not.toMatch(/Hard|EXTREME|평행중첩/);
    expect(screen.queryByTestId('stage-pack')).toBeNull();
    expect(screen.getByText('계획된 팩 없음')).toBeInTheDocument();
    expect(screen.getByTestId('other-entry-card')).toHaveTextContent('넘기기');
    for (let i = 0; i < 3; i += 1) await skipFloor(user);
    expect(screen.getByTestId('stage-floor')).toHaveTextContent('4');
    expect(useApp.getState().run).toMatchObject({ currentFloor: 4, stageFloor: 4 });
    // The route's pack for this floor comes first; the other floors read as skipped. The card
    // carries no badge — neither 「추천」 nor a pack-state word.
    const card = screen.getByTestId('stage-pack');
    expect(card).toHaveAttribute('data-pack', '1402');
    expect(card.textContent).not.toMatch(/추천|포함/);
    // Portrait, name, then the gifts only this pack drops with the goal ringed; the foot says 입장.
    expect(within(card).getByTestId('pack-image')).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: '화왕지절 자세히' })).toBeInTheDocument();
    const icons = within(screen.getByTestId('stage-pack-gifts')).getAllByTestId('gift-icon');
    expect(icons.length).toBeGreaterThan(1);
    expect(within(screen.getByTestId('stage-pack-gifts')).getAllByRole('img', { name: /달궈진 놋쇠/ })[0]!.parentElement).toHaveAttribute('data-wanted');
    expect(within(card).getByRole('button', { name: '화왕지절 입장' })).toHaveTextContent('입장');
    expect(screen.getAllByTestId('floor-cell').filter((c) => c.getAttribute('data-state') === 'skipped')).toHaveLength(3);
    await user.click(within(card).getByRole('button', { name: '화왕지절 입장' }));
    expect(useApp.getState().run).toMatchObject({ visits: { 4: 1402 }, currentFloor: 5, stageFloor: 4 });
    // The pack area: the pack on the left, its exclusive drops on the right, goals first and ringed.
    expect(screen.getByTestId('run-stage')).toHaveAttribute('data-mode', 'entered');
    const entered = screen.getByTestId('entered-pack');
    expect(entered).toHaveAttribute('data-pack', '1402');
    // The floor is the header's job; the area does not repeat it.
    expect(entered.textContent).not.toMatch(/4층에 입장/);
    expect(within(entered).getByTestId('area-back')).toHaveTextContent('돌아가기');
    expect(within(entered).getByTestId('area-next')).toHaveTextContent('다음 층');
    const tiles = within(screen.getByTestId('exclusive-gifts')).getAllByTestId('gift-tile');
    expect(tiles.length).toBeGreaterThan(1);
    expect(tiles[0]).toHaveAttribute('data-gift', '9267');
    expect(tiles[0]).toHaveAttribute('data-wanted');
    expect(tiles[0]).toHaveAttribute('aria-pressed', 'false');
    expect(tiles[1]).not.toHaveAttribute('data-wanted');
    await user.click(tiles[0]!);
    expect(useApp.getState().run.giftStatus).toMatchObject({ 9267: 'got' });
    expect(tiles[0]).toHaveAttribute('aria-pressed', 'true');
    expect(tiles[0]).toHaveAttribute('data-status', 'got');
    // Looking ahead and back keeps the record; going back clears the entry and what was marked in it.
    await user.click(within(entered).getByTestId('area-next'));
    expect(screen.getByTestId('stage-floor')).toHaveTextContent('5');
    expect(screen.getByTestId('run-stage')).toHaveAttribute('data-mode', 'undecided');
    await lookBack(user, 4);
    expect(screen.getByTestId('run-stage')).toHaveAttribute('data-mode', 'entered');
    expect(useApp.getState().run.giftStatus).toMatchObject({ 9267: 'got' });
    await user.click(screen.getByRole('button', { name: '화왕지절 돌아가기' }));
    expect(useApp.getState().run).toMatchObject({ visits: {}, currentFloor: 4, stageFloor: 4 });
    expect(useApp.getState().run.giftStatus[9267]).toBeUndefined();
    expect(screen.getByTestId('run-stage')).toHaveAttribute('data-mode', 'undecided');
    // The area folds away before it goes, above the card row that is back.
    expect(screen.getByTestId('pack-area-closing')).toBeInTheDocument();
    expect(screen.getByTestId('stage-pack')).toHaveAttribute('data-pack', '1402');
    await waitFor(() => expect(screen.queryByTestId('pack-area-closing')).toBeNull());
  });

  it('enters a pack by pulling its card down past the threshold, but not by a tap, a short pull or a sideways move', async () => {
    const user = userEvent.setup();
    useApp.getState().setDeck(BURN_DECK, 7);
    useApp.getState().toggleWanted(9267);
    renderStage();
    for (let i = 0; i < 3; i += 1) await skipFloor(user);
    const card = screen.getByTestId('stage-pack');
    // A tap: down and up without moving is not a pull.
    fireEvent.pointerDown(card, pointer);
    fireEvent.pointerUp(window, pointer);
    expect(useApp.getState().run.visits).toEqual({});
    // A press on the card's title (a button) that does not move is a click: the sheet opens, nothing enters.
    const title = within(card).getByRole('button', { name: '화왕지절 자세히' });
    fireEvent.pointerDown(title, pointer);
    fireEvent.pointerUp(window, pointer);
    await user.click(title);
    expect(screen.getByTestId('block-sheet')).toBeInTheDocument();
    expect(useApp.getState().run.visits).toEqual({});
    await user.click(screen.getByRole('button', { name: '닫기' }));
    // A sideways move scrolls instead of starting a pull.
    fireEvent.pointerDown(card, pointer);
    fireEvent.pointerMove(window, { ...pointer, clientX: 160, clientY: 210 });
    expect(card).not.toHaveAttribute('data-pulling');
    fireEvent.pointerUp(window, { ...pointer, clientX: 160, clientY: 210 });
    // A short pull moves the card but lets it spring back; past the threshold the foot says so.
    fireEvent.pointerDown(card, pointer);
    fireEvent.pointerMove(window, { ...pointer, clientY: 205 });
    expect(card).not.toHaveAttribute('data-pulling');
    fireEvent.pointerMove(window, { ...pointer, clientY: 240 });
    expect(card).toHaveAttribute('data-pulling');
    expect(card).not.toHaveAttribute('data-past');
    expect(card.style.transform).toBe('translateY(40px)');
    expect(within(card).getByRole('button', { name: '화왕지절 입장' })).toHaveTextContent('입장');
    fireEvent.pointerUp(window, { ...pointer, clientY: 240 });
    expect(useApp.getState().run.visits).toEqual({});
    expect(card.style.transform).toBe(''); // at rest the card carries no transform (a fixed sheet inside must stay fixed)
    fireEvent.pointerDown(card, pointer);
    fireEvent.pointerMove(window, { ...pointer, clientY: 290 });
    expect(card).toHaveAttribute('data-past', 'down');
    expect(within(card).getByRole('button', { name: '화왕지절 입장' })).toHaveTextContent('놓으면 입장');
    // Pulling up is not allowed here: it resists and never commits.
    fireEvent.pointerMove(window, { ...pointer, clientY: 100 });
    expect(card).not.toHaveAttribute('data-past');
    expect(card.style.transform).toBe('translateY(-30px)');
    fireEvent.pointerMove(window, { ...pointer, clientY: 290 });
    fireEvent.pointerUp(window, { ...pointer, clientY: 290 });
    expect(useApp.getState().run).toMatchObject({ visits: { 4: 1402 }, currentFloor: 5, stageFloor: 4 });
    // A pull may start on a handle button and end over it (the area moves with the pointer): the
    // click the browser fires afterwards is swallowed, so the floor advances once, not twice.
    const nextHandle = screen.getByTestId('area-next');
    fireEvent.pointerDown(nextHandle, pointer);
    fireEvent.pointerMove(window, { ...pointer, clientY: 290 });
    fireEvent.pointerUp(window, { ...pointer, clientY: 290 });
    fireEvent.click(nextHandle);
    expect(useApp.getState().run).toMatchObject({ currentFloor: 5, stageFloor: 5 });
  });

  it('passes a floor by pulling the dashed card, and the pack area moves on down and goes back up', async () => {
    const user = userEvent.setup();
    useApp.getState().setDeck(BURN_DECK, 7);
    useApp.getState().toggleWanted(9267);
    renderStage(true);
    expect(within(screen.getByTestId('other-entry-card')).getByRole('button', { name: '넘기기' })).toHaveTextContent('다음 층');
    pull(screen.getByTestId('other-entry-card'), 90);
    expect(useApp.getState().run).toMatchObject({ currentFloor: 2, stageFloor: 2, visits: {} });
    for (let i = 0; i < 2; i += 1) await skipFloor(user);
    await user.click(screen.getByRole('button', { name: '화왕지절 입장' }));
    expect(screen.getByTestId('route-summary')).not.toHaveTextContent('실패');
    // Pulling the area down leaves the floor: the unmarked goal counts as missed, and the plan reports it.
    const area = screen.getByTestId('entered-pack');
    fireEvent.pointerDown(area, pointer);
    fireEvent.pointerMove(window, { ...pointer, clientY: 290 });
    expect(area).toHaveAttribute('data-past', 'down');
    expect(within(area).getByTestId('area-next')).toHaveTextContent('놓으면 다음 층');
    fireEvent.pointerUp(window, { ...pointer, clientY: 290 });
    expect(useApp.getState().run).toMatchObject({ currentFloor: 5, stageFloor: 5, giftStatus: { 9267: 'failed' } });
    expect(screen.getByTestId('route-summary')).toHaveTextContent('실패 1');
    expect(screen.getByTestId('unresolved-row')).toHaveTextContent('수집 실패');
    expect(screen.getByText(/^확보/).parentElement).toHaveTextContent('0/1');
    // Back on the floor, the missed tile reads as such and a press turns it into got.
    await lookBack(user, 4);
    const tile = within(screen.getByTestId('exclusive-gifts')).getAllByTestId('gift-tile')[0]!;
    expect(tile).toHaveAttribute('data-status', 'failed');
    await user.click(tile);
    expect(useApp.getState().run.giftStatus).toMatchObject({ 9267: 'got' });
    expect(screen.getByText(/^확보/).parentElement).toHaveTextContent('1/1');
    // Pushing the area up goes back: the entry and the marks made in it are gone, the frontier retreats.
    const again = screen.getByTestId('entered-pack');
    fireEvent.pointerDown(again, pointer);
    fireEvent.pointerMove(window, { ...pointer, clientY: 110 });
    expect(again).toHaveAttribute('data-past', 'up');
    expect(within(again).getByTestId('area-back')).toHaveTextContent('놓으면 돌아가기');
    fireEvent.pointerUp(window, { ...pointer, clientY: 110 });
    expect(useApp.getState().run).toMatchObject({ visits: {}, currentFloor: 4, stageFloor: 4 });
    expect(useApp.getState().run.giftStatus[9267]).toBeUndefined();
    // The gift is a plain goal again: the plan covers it through the pack, not through a record.
    expect(screen.getByText(/^확보/).parentElement).toHaveTextContent('1/1');
    expect(screen.getByTestId('route-summary')).not.toHaveTextContent('실패');
    expect(screen.getByTestId('run-stage')).toHaveAttribute('data-mode', 'undecided');
    await waitFor(() => expect(screen.queryByTestId('pack-area-closing')).toBeNull());
  });

  it('collects the observed gift on the first move off floor 1 and shows played floors as history', async () => {
    const user = userEvent.setup();
    useApp.getState().setDeck(BURN_DECK, 7);
    for (const id of [9267, 9423]) useApp.getState().toggleWanted(id); // 깨진 안경 is observable and recommended
    renderStage();
    expect(useApp.getState().run.giftStatus).toEqual({});
    await skipFloor(user);
    expect(useApp.getState().run.giftStatus).toEqual({ 9423: 'got' });
    await lookBack(user, 1);
    // Stepping back onto the skip right before the frontier reopens that floor.
    expect(useApp.getState().run).toMatchObject({ currentFloor: 1, stageFloor: 1 });
    expect(screen.getByTestId('run-stage')).toHaveAttribute('data-mode', 'undecided');
    await skipFloor(user);
    await skipFloor(user);
    await user.click(screen.getByRole('button', { name: '1층' }));
    expect(useApp.getState().run).toMatchObject({ currentFloor: 3, stageFloor: 1 });
    expect(screen.getByTestId('run-stage')).toHaveAttribute('data-mode', 'skipped');
    // No explanatory sentence any more: the mode alone tells the story.
    expect(screen.queryByText(/지나간 층/)).toBeNull();
    expect(screen.queryByTestId('other-entry-card')).toBeNull();
  });

  it("shows each other pack's exclusive gifts beside its name, the wanted ones ringed, with no count", async () => {
    const user = userEvent.setup();
    useApp.getState().setDeck(BURN_DECK, 7);
    for (const id of [9267, 9754]) useApp.getState().toggleWanted(id); // 화왕지절 and 2호선, both Hard 4-5
    useApp.getState().banPack(1109); // 2호선 leaves the route, so it is listed among the other packs
    renderStage();
    for (let i = 0; i < 3; i += 1) await skipFloor(user);
    const rows = within(screen.getByTestId('other-packs')).getAllByTestId('other-pack');
    const row = rows.find((r) => r.getAttribute('data-pack') === '1109')!;
    const icons = within(row).getAllByTestId('gift-icon');
    expect(icons.length).toBeGreaterThan(1);
    expect(row.querySelectorAll('[data-wanted]')).toHaveLength(1);
    expect(within(row).getByRole('img', { name: /^굴레 ·/ })).toBeInTheDocument();
    expect(row).not.toHaveTextContent('원함');
    // A row with exclusives but nothing wanted has icons and no ring; a pack without exclusives has neither.
    const other = rows.find((r) => r.getAttribute('data-pack') !== '1109' && within(r).queryAllByTestId('gift-icon').length > 0)!;
    expect(other).toBeDefined();
    expect(other.querySelector('[data-wanted]')).toBeNull();
    for (const r of rows) expect(within(r).getByTestId('other-pack-gifts')).toBeInTheDocument();
  });

  it('finds any other pack of the floor by name and adds a gift from it as a goal', async () => {
    const user = userEvent.setup();
    useApp.getState().setDeck(BURN_DECK, 7);
    useApp.getState().toggleWanted(9267);
    renderStage();
    for (let i = 0; i < 3; i += 1) await skipFloor(user);
    const others = screen.getByTestId('other-packs');
    const search = within(others).getByRole('searchbox', { name: '이 층의 팩 검색' });
    await user.type(search, '2호선');
    const packs = within(others).getAllByTestId('other-pack');
    expect(packs).toHaveLength(1);
    expect(packs[0]).toHaveAttribute('data-pack', '1109');
    // The same pack answers to the 초성 of its name.
    await user.clear(search);
    await user.type(search, 'ㅎㅅ');
    expect(within(others).getAllByTestId('other-pack').map((el) => el.getAttribute('data-pack'))).toContain('1109');
    await user.clear(search);
    await user.type(search, '2호선');
    await user.click(within(packs[0]!).getByRole('button', { name: '2호선' }));
    await user.click(screen.getByRole('button', { name: '굴레 목표에 추가' }));
    expect(useApp.getState().wanted).toEqual([9267, 9754]);
    // 2호선 sits on Hard 4-5 too, so it joins the floor's route packs.
    expect(screen.getAllByTestId('stage-pack').map((c) => c.getAttribute('data-pack'))).toContain('1109');
    await user.click(screen.getByRole('button', { name: '닫기' }));
    // It left the "other packs" list for the route row, and enters from there.
    expect(within(others).queryByTestId('other-pack')).toBeNull();
    await user.click(screen.getByRole('button', { name: '2호선 입장' }));
    expect(useApp.getState().run.visits).toEqual({ 4: 1109 });
  });

  it('closes the run after floor 15 and starts the next one from the done card, keeping the deck and the goals', async () => {
    const user = userEvent.setup();
    useApp.getState().setDeck(BURN_DECK, 7);
    useApp.getState().toggleWanted(9267);
    renderStage();
    for (let i = 0; i < 15; i += 1) await skipFloor(user);
    // The done card is its own floor past the end; floor 15 keeps reading as the skip it was.
    expect(useApp.getState().run).toMatchObject({ currentFloor: 16, stageFloor: 16 });
    expect(screen.getAllByTestId('floor-cell').filter((c) => c.getAttribute('data-state') === 'skipped')).toHaveLength(15);
    expect(screen.getByTestId('run-stage')).toHaveAttribute('data-mode', 'done');
    // Nothing in the header moves the run any more: the cards and the pack area do.
    expect(within(header()).queryByRole('button', { name: /넘기기|다음 층|이전 층/ })).toBeNull();
    expect(screen.queryByTestId('other-entry-card')).toBeNull();
    // The dungeon is repeated content, so the next run keeps the plan the player came with. The
    // header's 초기화 is the one that also throws the deck and the goals away.
    const deck = [...useApp.getState().deck];
    await user.click(within(screen.getByTestId('stage-done')).getByRole('button', { name: /새 런/ }));
    expect(useApp.getState().run).toMatchObject({ currentFloor: 1, stageFloor: 1, visits: {} });
    expect(useApp.getState().deck).toEqual(deck);
    expect(useApp.getState().wanted).toEqual([9267]);
  });

  it('draws every route pack of the floor as the same card, planned one first, then the dashed one', async () => {
    const user = userEvent.setup();
    useApp.getState().setDeck(BURN_DECK, 7);
    // Six goals outrun the three observation slots, so two packs whose windows both cover 6~10층
    // have to be walked into — the planner puts one here and the other later.
    for (const id of [9274, 9420, 9706, 9715, 9744]) useApp.getState().toggleWanted(id);
    renderStage();
    for (let i = 0; i < 5; i += 1) await skipFloor(user);
    expect(screen.getByTestId('stage-floor')).toHaveTextContent('6');
    const cards = within(screen.getByTestId('stage-packs')).getAllByTestId('stage-pack');
    expect(cards.length).toBeGreaterThan(1);
    // No card is singled out: same width, no badge, and the planned pack is simply first.
    for (const card of cards) {
      expect(card).not.toHaveAttribute('data-row');
      expect(card).not.toHaveAttribute('data-recommended');
      expect(card.textContent).not.toMatch(/추천|포함/);
    }
    expect(screen.queryByTestId('stage-recommended')).toBeNull();
    // Any of them enters on a pull, and the dashed card at the end passes the floor by.
    pull(cards[1]!, 90);
    expect(useApp.getState().run.visits).toEqual({ 6: Number(cards[1]!.getAttribute('data-pack')) });
  });

  it('rings what a fusion goal carries: its ingredients wear the goal ring on the pack that drops them', async () => {
    const user = userEvent.setup();
    useApp.getState().setDeck(BURN_DECK, 7);
    // 데스페라도 is fused from 노이즈 섞인 무전기 and 부리 모양 목걸이, both 호박색 어스름의 시련's alone.
    useApp.getState().toggleWanted(9235);
    renderStage();
    for (let i = 0; i < 3; i += 1) await skipFloor(user);
    const iconOf = (root: HTMLElement, name: RegExp) => within(root).getAllByRole('img', { name })[0]!.parentElement!;
    const cardIcons = () => screen.getByTestId('stage-pack-gifts');
    expect(iconOf(cardIcons(), /노이즈 섞인 무전기/)).toHaveAttribute('data-wanted');
    expect(iconOf(cardIcons(), /부리 모양 목걸이/)).toHaveAttribute('data-wanted');
    // 재료는 목표가 아님: the ring goes with the promise.
    act(() => useApp.getState().setFusionGoal(9235, 'resultOnly'));
    expect(iconOf(cardIcons(), /노이즈 섞인 무전기/)).not.toHaveAttribute('data-wanted');
    act(() => useApp.getState().setFusionGoal(9235, 'withIngredients'));
    // The entered pack's tiles say the same, and count the ingredients among its goals.
    await user.click(screen.getByRole('button', { name: '호박색 어스름의 시련 입장' }));
    const tiles = within(screen.getByTestId('exclusive-gifts')).getAllByTestId('gift-tile');
    const tileOf = (id: number) => tiles.find((el) => el.getAttribute('data-gift') === String(id))!;
    expect(tileOf(9233)).toHaveAttribute('data-wanted');
    expect(tileOf(9234)).toHaveAttribute('data-wanted');
    expect(screen.getByTestId('entered-pack')).toHaveTextContent('목표 2');
  });

  it('settles the floor it walks off, whether that is 「다음 층」 or a forward step on the strip', async () => {
    const user = userEvent.setup();
    useApp.getState().setDeck(BURN_DECK, 7);
    useApp.getState().toggleWanted(9267); // 화왕지절 (1402), Hard 4-5
    renderStage();
    for (let i = 0; i < 3; i += 1) await skipFloor(user);
    await user.click(screen.getByRole('button', { name: '화왕지절 입장' }));
    expect(useApp.getState().run).toMatchObject({ visits: { 4: 1402 }, currentFloor: 5, stageFloor: 4 });
    // Leaving the floor by the strip instead of the handle used to skip the miss entirely, so a
    // goal nobody marked stayed 「확보」 for the rest of the run.
    await lookBack(user, 5);
    expect(useApp.getState().run).toMatchObject({ stageFloor: 5 });
    expect(useApp.getState().run.giftStatus[9267]).toBe('failed');
    // Looking back the other way settles nothing and leaves the record alone.
    useApp.getState().setGiftStatus(9267, null);
    await lookBack(user, 4);
    expect(useApp.getState().run.giftStatus[9267]).toBeUndefined();
  });

  it('still settles and closes the run when the last pack was entered on floor 15', async () => {
    const user = userEvent.setup();
    useApp.getState().setDeck(BURN_DECK, 7);
    useApp.getState().toggleWanted(9267);
    renderStage();
    for (let i = 0; i < 14; i += 1) await skipFloor(user);
    expect(useApp.getState().run).toMatchObject({ currentFloor: 15, stageFloor: 15 });
    const pack = Number(screen.getAllByTestId('other-pack')[0]!.getAttribute('data-pack'));
    await user.click(within(screen.getByTestId('other-packs')).getAllByRole('button', { name: /입장$/ })[0]!);
    expect(useApp.getState().run).toMatchObject({ visits: { 15: pack }, currentFloor: 16, stageFloor: 15 });
    // The frontier is past the end, but floor 15 is still on stage with an entry left to settle:
    // 「다음 층」 has to work, or the run can never reach its done card.
    expect(screen.getByTestId('run-stage')).toHaveAttribute('data-mode', 'entered');
    await user.click(within(screen.getByTestId('entered-pack')).getByTestId('area-next'));
    expect(screen.getByTestId('run-stage')).toHaveAttribute('data-mode', 'done');
  });

  it('keeps the entry undone from a pack sheet in step with 「돌아가기」', async () => {
    const user = userEvent.setup();
    useApp.getState().setDeck(BURN_DECK, 7);
    useApp.getState().toggleWanted(9267);
    renderStage(true);
    for (let i = 0; i < 3; i += 1) await skipFloor(user);
    await user.click(screen.getByRole('button', { name: '화왕지절 입장' }));
    await user.click(within(screen.getByTestId('entered-pack')).getByTestId('area-next'));
    expect(useApp.getState().run.giftStatus[9267]).toBe('failed');
    // Undoing the entry from the sheet used to leave the miss behind, so the planner kept the gift
    // in `unobtainableGifts` and re-routing the pack was pointless.
    await user.click(within(screen.getByTestId('other-packs')).getByText('다른 팩'));
    const row = screen.getAllByTestId('other-pack').find((r) => r.getAttribute('data-pack') === '1402')!;
    // The row says where the pack was entered instead of offering a second entry on this floor.
    expect(row).toHaveTextContent('방문 · 4층');
    expect(within(row).queryByRole('button', { name: '화왕지절 입장' })).toBeNull();
    await user.click(within(row).getByRole('button', { name: '화왕지절' }));
    await user.click(await screen.findByRole('button', { name: /입장 취소/ }));
    expect(useApp.getState().run.visits).toEqual({});
    expect(useApp.getState().run.giftStatus[9267]).toBeUndefined();
  });

  it('offers no second entry from a pack sheet while the stage floor already holds one', async () => {
    const user = userEvent.setup();
    useApp.getState().setDeck(BURN_DECK, 7);
    useApp.getState().toggleWanted(9267);
    renderStage(true);
    for (let i = 0; i < 3; i += 1) await skipFloor(user);
    // On the frontier the sheet offers the way in, as the cards do.
    await user.click(within(screen.getByTestId('metro-rows')).getByRole('button', { name: '화왕지절' }));
    expect(within(await screen.findByTestId('enter-actions')).getByRole('button', { name: '화왕지절 입장' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await user.click(within(screen.getByTestId('stage-pack')).getByRole('button', { name: '화왕지절 입장' }));
    expect(useApp.getState().run.visits).toEqual({ 4: 1402 });
    // With floor 4 taken, the sheet must not offer an entry that would replace the record.
    await user.click(within(screen.getByTestId('metro-rows')).getByRole('button', { name: '화왕지절' }));
    const actions = await screen.findByTestId('enter-actions');
    expect(within(actions).queryByRole('button', { name: /입장$/ })).toBeNull();
    expect(actions).toHaveTextContent('4층에 입장');
  });
});

describe('RunStage · start-of-run gifts', () => {
  /** The reported goals on the default deck: three pins, one a general drop, and a fusion. */
  const PINS = [9191, 9419, 9423];
  const observable = (id: number) => {
    const gift = indexes.giftById.get(id);
    return gift ? observableGift(gift, data.rules) : false;
  };
  const setup = () => {
    useApp.getState().setDeck(LCB_DECK, 6);
    for (const id of [9191, 9410, 9419, 9423]) useApp.getState().toggleWanted(id);
    for (const id of PINS) useApp.getState().toggleObserved(id, { max: 3, observable });
    return renderPlanned(
      <>
        <RunStage onOpenGifts={() => undefined} />
        <RoutePlanPanel />
      </>,
    );
  };
  const currentPlan = () => planRoute(planInputFor(useApp.getState()), data, indexes);
  const header = () => screen.getByTestId('floor-header');
  const lookBack = async (user: ReturnType<typeof userEvent.setup>, floor: number) =>
    user.click(within(header()).getAllByTestId('floor-cell').find((cell) => cell.getAttribute('data-floor') === String(floor))!);
  const got = (ids: number[]) => Object.fromEntries(ids.map((id) => [id, 'got']));

  it('plans the ingredient packs on floors 1-2 around the three pins', () => {
    setup();
    const plan = currentPlan();
    expect(plan.start.observed.map((o) => [o.giftId, o.pinned])).toEqual(PINS.map((id) => [id, true]));
    expect(plan.stats.requiredPacks).toBe(2);
    expect(screen.getAllByTestId('stage-pack').map((c) => c.getAttribute('data-pack'))).toEqual(['1004', '1005']);
    expect(screen.getByText(/^필요 팩/).parentElement).toHaveTextContent('2');
    expect(screen.getByText(/^확보/).parentElement).toHaveTextContent('4/4');
    expect(screen.getAllByTestId('observed-tile')).toHaveLength(3);
  });

  it('takes the start-of-run record back when an entry on floor 1 is undone, however often', async () => {
    const user = userEvent.setup();
    setup();
    for (let round = 0; round < 3; round += 1) {
      await user.click(screen.getByRole('button', { name: '공장 자동화 입장' }));
      expect(useApp.getState().run).toMatchObject({ visits: { 1: 1004 }, currentFloor: 2, giftStatus: got(PINS), startGifts: PINS });
      expect(currentPlan().stats.requiredPacks).toBe(1);
      await user.click(screen.getByRole('button', { name: '공장 자동화 돌아가기' }));
      expect(useApp.getState().run).toMatchObject({ visits: {}, currentFloor: 1, stageFloor: 1, giftStatus: {}, startGifts: [] });
      const plan = currentPlan();
      expect(plan.stats.requiredPacks).toBe(2);
      expect(plan.start.observed.map((o) => o.giftId)).toEqual(PINS);
      await waitFor(() => expect(screen.queryByTestId('pack-area-closing')).toBeNull());
    }
    expect(screen.getAllByTestId('stage-pack').map((c) => c.getAttribute('data-pack'))).toEqual(['1004', '1005']);
    expect(screen.getByText(/^필요 팩/).parentElement).toHaveTextContent('2');
    expect(screen.getByText(/^확보/).parentElement).toHaveTextContent('4/4');
  });

  it('takes the record back when a skipped floor 1 is reopened from the strip', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('button', { name: '넘기기' }));
    expect(useApp.getState().run).toMatchObject({ currentFloor: 2, giftStatus: got(PINS), startGifts: PINS });
    await lookBack(user, 1);
    expect(useApp.getState().run).toMatchObject({ currentFloor: 1, stageFloor: 1, giftStatus: {}, startGifts: [] });
    expect(currentPlan().stats.requiredPacks).toBe(2);
  });

  it('keeps the record while the run goes on, and a later floor undone leaves it alone', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('button', { name: '공장 자동화 입장' }));
    await user.click(screen.getByTestId('area-next'));
    expect(useApp.getState().run).toMatchObject({ currentFloor: 2, stageFloor: 2, giftStatus: got(PINS), startGifts: PINS });
    expect(currentPlan().stats.requiredPacks).toBe(1);
    await user.click(screen.getByRole('button', { name: '사랑할 수 없는 입장' }));
    expect(useApp.getState().run).toMatchObject({ visits: { 1: 1004, 2: 1005 }, currentFloor: 3 });
    await user.click(screen.getByRole('button', { name: '사랑할 수 없는 돌아가기' }));
    expect(useApp.getState().run).toMatchObject({ visits: { 1: 1004 }, currentFloor: 2, giftStatus: got(PINS), startGifts: PINS });
  });

  it('leaves a status the player changed by hand alone when the record is taken back', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('button', { name: '넘기기' }));
    act(() => useApp.getState().setGiftStatus(9419, 'failed'));
    await lookBack(user, 1);
    expect(useApp.getState().run.giftStatus).toEqual({ 9419: 'failed' });
    expect(useApp.getState().run.startGifts).toEqual([]);
  });

  it('refuses a pin on a gift that cannot be observed, and forgets a stale record on load', () => {
    useApp.getState().toggleWanted(9410);
    useApp.getState().toggleWanted(9423);
    useApp.getState().toggleObserved(9410, { max: 3, observable });
    expect(useApp.getState().options.observedGifts).toEqual([]);
    useApp.getState().toggleObserved(9423, { max: 3, observable });
    expect(useApp.getState().options.observedGifts).toEqual([9423]);
    expect(sanitizeRun({ currentFloor: 1, visits: {}, giftStatus: { 9423: 'got' }, startGifts: [9423] }).startGifts).toEqual([]);
    expect(sanitizeRun({ currentFloor: 2, visits: {}, giftStatus: { 9423: 'got', 9419: 'failed' }, startGifts: [9423, 9419, 9423, 'x'] }).startGifts).toEqual([9423]);
    expect(sanitizeRun({ currentFloor: 2, visits: {}, giftStatus: { 9423: 'got' } }).startGifts).toEqual([]);
  });
});

describe('GoalsPanel', () => {
  const renderBoth = (override?: typeof data) =>
    renderPlanned(
      <>
        <RunStage onOpenGifts={() => undefined} />
        <GoalsPanel />
      </>,
      override,
    );
  const goals = () => screen.getByTestId('route-goals');
  const tileIn = (root: HTMLElement, id: number) => within(root).getAllByTestId('gift-tile').find((el) => el.getAttribute('data-gift') === String(id))!;
  const goalTile = (id: number) => tileIn(goals(), id);
  const stageTile = (id: number) => tileIn(screen.getByTestId('exclusive-gifts'), id);
  const skipFloor = async (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole('button', { name: '넘기기' }));
  /** Walk to floor 4 and enter 화왕지절 (1402), whose exclusive 9267 is the goal. */
  const enter1402 = async (user: ReturnType<typeof userEvent.setup>) => {
    for (let i = 0; i < 3; i += 1) await skipFloor(user);
    await user.click(screen.getByRole('button', { name: '화왕지절 입장' }));
    expect(useApp.getState().run).toMatchObject({ visits: { 4: 1402 }, currentFloor: 5 });
  };

  it('lists every goal the player set and nothing else', () => {
    useApp.getState().setDeck(BURN_DECK, 7);
    for (const id of [9267, 9283, 9410]) useApp.getState().toggleWanted(id);
    renderBoth();
    const rows = within(goals()).getAllByTestId('route-goal');
    expect(rows.map((r) => r.getAttribute('data-gift'))).toEqual(['9267', '9283', '9410']);
    expect(goals()).toHaveTextContent('0/3');
    expect(goalTile(9267)).toHaveAttribute('data-wanted');
    expect(goalTile(9283)).toHaveAttribute('data-wanted');
    // Only the chosen gifts: a fusion goal does not drag its ingredients in.
    expect(within(goals()).getAllByTestId('gift-tile').map((el) => el.getAttribute('data-gift'))).toEqual(['9267', '9283', '9410']);
    expect(screen.getByTestId('goals-panel')).toBeInTheDocument();
  });

  it('marks a must-have gift with a star badge on its tile', () => {
    useApp.getState().setDeck(BURN_DECK, 7);
    useApp.getState().toggleWanted(9267);
    useApp.getState().setPriority(9267, 'must');
    renderBoth();
    expect(within(goalTile(9267)).getByTestId('gift-icon')).toHaveAttribute('data-must', 'true');
  });

  it('shares one record with the tiles of the entered pack, in both directions', async () => {
    const user = userEvent.setup();
    useApp.getState().setDeck(BURN_DECK, 7);
    useApp.getState().toggleWanted(9267);
    renderBoth();
    await enter1402(user);
    // Panel → stage.
    await user.click(goalTile(9267));
    expect(useApp.getState().run.giftStatus).toEqual({ 9267: 'got' });
    expect(stageTile(9267)).toHaveAttribute('aria-pressed', 'true');
    expect(stageTile(9267)).toHaveAttribute('data-status', 'got');
    expect(goals()).toHaveTextContent('1/1');
    await user.click(goalTile(9267));
    expect(useApp.getState().run.giftStatus).toEqual({});
    expect(stageTile(9267)).toHaveAttribute('data-status', 'pending');
    // Stage → panel, and going back clears both.
    await user.click(stageTile(9267));
    expect(goalTile(9267)).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: '화왕지절 돌아가기' }));
    expect(useApp.getState().run.giftStatus).toEqual({});
    expect(goalTile(9267)).toHaveAttribute('data-status', 'pending');
    await waitFor(() => expect(screen.queryByTestId('pack-area-closing')).toBeNull());
  });

  it('feeds a goal marked in the panel back into the route', async () => {
    const user = userEvent.setup();
    useApp.getState().setDeck(BURN_DECK, 7);
    for (const id of [9419, 9423]) useApp.getState().toggleWanted(id); // 낙화 (1010, Hard 2-3) and 변하지 않는 (1012, Hard 4-5)
    // Observation off, or the planner would observe both instead of visiting.
    const noObservation = { ...data, rules: { ...data.rules, giftObservation: { ...data.rules.giftObservation, max: 0 } } };
    renderBoth(noObservation);
    const packs = () => planRoute(planInputFor(useApp.getState()), noObservation, indexes).floors.filter((f) => f.packId !== null).map((f) => f.packId);
    expect(packs()).toEqual([1010, 1012]);
    await user.click(goalTile(9419));
    expect(useApp.getState().run.giftStatus).toEqual({ 9419: 'got' });
    expect(packs()).toEqual([1012]);
    expect(goals()).toHaveTextContent('1/2');
  });

  it('shows a goal the run marked as missed, and a press turns it into got', async () => {
    const user = userEvent.setup();
    useApp.getState().setDeck(BURN_DECK, 7);
    useApp.getState().toggleWanted(9267);
    renderBoth();
    await enter1402(user);
    await user.click(screen.getByTestId('area-next'));
    expect(useApp.getState().run.giftStatus).toEqual({ 9267: 'failed' });
    expect(goalTile(9267)).toHaveAttribute('data-status', 'failed');
    await user.click(goalTile(9267));
    expect(useApp.getState().run.giftStatus).toEqual({ 9267: 'got' });
    expect(goalTile(9267)).toHaveAttribute('data-status', 'got');
  });

  it('raises the 달의 기억 reminder from the goals grid too', async () => {
    const user = userEvent.setup();
    useApp.getState().setDeck(BURN_DECK, 7);
    useApp.getState().toggleWanted(9083);
    useApp.getState().setGiftStatus(9105, 'got'); // 업화 조각
    renderBoth();
    await user.click(goalTile(9083));
    const notice = within(goals()).getByTestId('fusion-notice');
    expect(notice).toHaveTextContent('합성으로 소모한 조각 2개·기억 3개는 미획득으로 표시하세요.');
    await user.click(within(notice).getByRole('button', { name: '업화 조각 미획득으로' }));
    expect(useApp.getState().run.giftStatus).toEqual({ 9083: 'got' });
    await user.click(goalTile(9083));
    expect(within(goals()).queryByTestId('fusion-notice')).toBeNull();
  });

  it('opens the gift details from a tile: a one-second hold, the corner button, or a right-click — a short press still toggles', async () => {
    const user = userEvent.setup();
    useApp.getState().setDeck(BURN_DECK, 7);
    useApp.getState().toggleWanted(9267);
    renderBoth();
    await enter1402(user);
    const dialog = () => screen.queryByRole('dialog', { name: '달궈진 놋쇠' }); // the goal 9267, a drop of 화왕지절
    const close = async () => {
      await user.click(within(dialog()!).getByRole('button', { name: '닫기' }));
      expect(dialog()).toBeNull();
    };
    vi.useFakeTimers();
    try {
      // A hold opens the sheet and the click on release does not toggle.
      fireEvent.pointerDown(stageTile(9267), { button: 0 });
      act(() => {
        vi.advanceTimersByTime(999);
      });
      expect(dialog()).toBeNull();
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(dialog()).toBeInTheDocument();
      fireEvent.pointerUp(stageTile(9267));
      fireEvent.click(stageTile(9267));
      expect(useApp.getState().run.giftStatus).toEqual({});
      // A short press is a plain toggle.
      fireEvent.click(within(dialog()!).getByRole('button', { name: '닫기' }));
      expect(dialog()).toBeNull();
      fireEvent.pointerDown(stageTile(9267), { button: 0 });
      act(() => {
        vi.advanceTimersByTime(300);
      });
      fireEvent.pointerUp(stageTile(9267));
      fireEvent.click(stageTile(9267));
      expect(useApp.getState().run.giftStatus).toEqual({ 9267: 'got' });
      expect(dialog()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
    // The corner button and a right-click open the same sheet, which carries the items-tab controls.
    await user.click(within(screen.getByTestId('exclusive-gifts')).getAllByTestId('gift-tile-info')[0]!);
    expect(dialog()).toBeInTheDocument();
    await user.click(within(dialog()!).getByRole('button', { name: '달궈진 놋쇠 우선순위: 보통' }));
    expect(useApp.getState().priority).toEqual({ 9267: 'must' });
    await close();
    fireEvent.contextMenu(stageTile(9267));
    expect(dialog()).toBeInTheDocument();
    await close();
    await user.click(within(goals()).getAllByTestId('gift-tile-info')[0]!);
    expect(dialog()).toBeInTheDocument();
    await close();
  });
});

describe('Tracker', () => {
  const tile = (id: number) => screen.getAllByTestId('gift-tile').find((el) => el.getAttribute('data-gift') === String(id))!;

  it('lists the twenty-five pack-independent T4 gifts in five groups and marks them by a press', async () => {
    const user = userEvent.setup();
    useApp.getState().setDeck(BURN_DECK, 7);
    renderPlanned(<Tracker />);
    for (const group of ['keyword', 'shard', 'memory', 'attack', 'plain']) expect(screen.getByTestId(`tracker-${group}`)).toBeInTheDocument();
    expect(screen.getAllByTestId('gift-tile')).toHaveLength(25);
    expect(screen.getByTestId('tracker-keyword')).toHaveTextContent('0/7');
    await user.click(screen.getByRole('button', { name: /^불꽃의 편린 획득 표시/ }));
    expect(useApp.getState().run.giftStatus).toEqual({ 9045: 'got' });
    expect(tile(9045)).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('tracker-keyword')).toHaveTextContent('1/7');
    expect(screen.queryByTestId('fusion-notice')).toBeNull();
  });

  it('reminds the player to unmark the ingredients 달의 기억 consumed, and lets them do it in place', async () => {
    const user = userEvent.setup();
    useApp.getState().setDeck(BURN_DECK, 7);
    useApp.getState().setGiftStatus(9105, 'got'); // 업화 조각
    useApp.getState().setGiftStatus(9142, 'got'); // 잘려나간 기억
    renderPlanned(<Tracker />);
    await user.click(tile(9083));
    const notice = screen.getByTestId('fusion-notice');
    expect(notice).toHaveTextContent('합성으로 소모한 조각 2개·기억 3개는 미획득으로 표시하세요.');
    expect(within(notice).getAllByRole('listitem')).toHaveLength(3); // the heading and the two held ingredients
    await user.click(within(notice).getByRole('button', { name: '업화 조각 미획득으로' }));
    expect(useApp.getState().run.giftStatus).toEqual({ 9142: 'got', 9083: 'got' });
    expect(within(notice).queryByRole('button', { name: '업화 조각 미획득으로' })).toBeNull();
    // Unmarking 달의 기억 closes the reminder.
    await user.click(tile(9083));
    expect(screen.queryByTestId('fusion-notice')).toBeNull();
    expect(useApp.getState().run.giftStatus).toEqual({ 9142: 'got' });
  });
});
