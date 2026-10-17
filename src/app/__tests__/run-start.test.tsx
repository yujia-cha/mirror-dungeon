/**
 * M143: starting the screen reader is starting the run. The store keeps the state from before the
 * start (`runSnapshot`) and puts it back on 「런 중단 · 시작 전으로 되돌리기」; the popover asks
 * 「새 런으로 시작」 / 「이어서」 when a run with progress is still there, and the answer's own press
 * asks for the share.
 */
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { loadGameDataFromDisk } from '../../core/data/node.ts';
import { analyseDeck, buildIndexes } from '../../core/index.ts';
import {
  PERSIST_VERSION,
  appDefaultOptions,
  defaultUi,
  emptyRun,
  forgetRecipes,
  runHasProgress,
  sanitizePersisted,
  useApp,
} from '../store.ts';
import { describeChange, type LoggedState } from '../lib/feedback-log.ts';
import { PlanProvider } from '../shell/PlanContext.tsx';
import { CaptureProvider } from '../capture/CaptureProvider.tsx';
import { CaptureMenu } from '../shell/CapturePanel.tsx';

const data = loadGameDataFromDisk();
const indexes = buildIndexes(data);
const DECK = [10101, 10201, 10301, 10401, 10501, 10601, 10701, 10801, 10901, 11001, 11101, 11201];

beforeEach(() => {
  useApp.setState({
    deck: DECK,
    deployed: [],
    wanted: [9006, 9007],
    fusionGoal: {},
    upgrades: {},
    run: emptyRun(),
    runSnapshot: null,
    ui: defaultUi(),
    options: appDefaultOptions(),
    lang: 'ko',
    dark: true,
  });
  forgetRecipes();
});

/** A run under way: floor 1 entered, the start settled, a gift marked. */
function playSomeRun(): void {
  const store = useApp.getState();
  store.setOptions({ observedGifts: [9006], observationSlots: 2 });
  store.setGiftStatus(9006, 'got');
  store.settleStart();
  store.visitPack(1001, 1);
}

describe('run snapshot store (M143)', () => {
  it('snapshots the run, pins and slots and starts over on a new run', () => {
    // Arrange
    playSomeRun();
    const before = useApp.getState().run;
    // Act
    useApp.getState().beginRun('new');
    // Assert
    const { run, runSnapshot, options, wanted } = useApp.getState();
    expect(run).toEqual(emptyRun());
    expect(runSnapshot).toEqual({ run: before, observedGifts: [9006], observationSlots: 2 });
    // The pins themselves are the run start's to change, not the reset's.
    expect(options.observedGifts).toEqual([9006]);
    expect(wanted).toEqual([9006, 9007]);
  });

  it('only snapshots a run with no progress, and keeps the snapshot it already has', () => {
    // Arrange: a new run over a played one, then the share was refused and tried again.
    playSomeRun();
    useApp.getState().beginRun('new');
    const first = useApp.getState().runSnapshot;
    // Act
    useApp.getState().beginRun('new');
    // Assert
    expect(useApp.getState().runSnapshot).toBe(first);
    expect(useApp.getState().run).toEqual(emptyRun());
  });

  it('snapshots an untouched run without changing it', () => {
    // Act
    useApp.getState().beginRun('new');
    // Assert
    expect(useApp.getState().runSnapshot).toEqual({ run: emptyRun(), observedGifts: [] });
    expect(useApp.getState().run).toEqual(emptyRun());
  });

  it('keeps the run and the snapshot as they are to continue', () => {
    // Arrange
    playSomeRun();
    const run = useApp.getState().run;
    // Act
    useApp.getState().beginRun('continue');
    // Assert
    expect(useApp.getState().run).toBe(run);
    expect(useApp.getState().runSnapshot).toBeNull();
  });

  it('puts the run, pins and slots back on rollback and keeps goals and deck', () => {
    // Arrange: a new run over a played one, then the reader pinned and settled something new and
    // the player changed the goals.
    playSomeRun();
    const played = useApp.getState().run;
    useApp.getState().beginRun('new');
    useApp.getState().setOptions({ observedGifts: [9007], startGiftCount: 2, observationSlots: 3 });
    useApp.getState().setGiftStatus(9007, 'got');
    useApp.getState().toggleWanted(9008);
    // Act
    const done = useApp.getState().rollbackRun();
    // Assert
    const { run, runSnapshot, options, wanted, deck } = useApp.getState();
    expect(done).toBe(true);
    expect(run).toEqual(played);
    expect(options.observedGifts).toEqual([9006]);
    expect(options.observationSlots).toBe(2);
    // Other options are not the start's.
    expect(options.startGiftCount).toBe(2);
    expect(wanted).toEqual([9006, 9007, 9008]);
    expect(deck).toEqual(DECK);
    expect(runSnapshot).toBeNull();
  });

  it('drops the slot setting on rollback when the snapshot had none', () => {
    // Arrange
    useApp.getState().beginRun('new');
    useApp.getState().setOptions({ observationSlots: 1 });
    // Act
    useApp.getState().rollbackRun();
    // Assert
    expect('observationSlots' in useApp.getState().options).toBe(false);
  });

  it('changes nothing on rollback without a snapshot', () => {
    // Arrange
    playSomeRun();
    const state = useApp.getState();
    // Act
    const done = state.rollbackRun();
    // Assert
    expect(done).toBe(false);
    expect(useApp.getState().run).toBe(state.run);
    expect(useApp.getState().options).toBe(state.options);
  });

  it('forgets the snapshot when the run is thrown away some other way', () => {
    for (const discard of [
      () => useApp.getState().resetRun(),
      () => useApp.getState().resetAll(DECK, 0),
      () => useApp.getState().setSeason(99),
      () =>
        useApp.getState().applyShared({ deck: DECK, deployed: [], wanted: [], options: appDefaultOptions() }),
    ]) {
      // Arrange
      useApp.getState().beginRun('new');
      expect(useApp.getState().runSnapshot).not.toBeNull();
      // Act
      discard();
      // Assert
      expect(useApp.getState().runSnapshot).toBeNull();
    }
  });

  it('counts any record of the run as progress', () => {
    expect(runHasProgress(emptyRun())).toBe(false);
    expect(runHasProgress({ ...emptyRun(), giftStatus: { 9006: 'failed' } })).toBe(true);
    expect(runHasProgress({ ...emptyRun(), startDone: true })).toBe(true);
    expect(runHasProgress({ ...emptyRun(), startGifts: [9006] })).toBe(true);
    expect(runHasProgress({ ...emptyRun(), visits: { 1: 1001 }, currentFloor: 2, stageFloor: 2 })).toBe(true);
    expect(runHasProgress({ ...emptyRun(), currentFloor: 3, stageFloor: 3 })).toBe(true);
  });

  it('saves and restores the snapshot through the persisted blob', () => {
    // Arrange
    playSomeRun();
    useApp.getState().beginRun('new');
    const saved = JSON.parse(JSON.stringify(useApp.getState())) as unknown;
    // Act
    const restored = sanitizePersisted(saved, PERSIST_VERSION);
    // Assert
    expect(restored.runSnapshot).toEqual(useApp.getState().runSnapshot);
  });

  it('reads a blob from before the snapshot, and a broken one, as no snapshot', () => {
    // Arrange
    const old = { deck: DECK, wanted: [9006], run: { currentFloor: 2, visits: { 1: 1001 } } };
    // Act / Assert
    expect(sanitizePersisted(old, PERSIST_VERSION).runSnapshot).toBeNull();
    expect(sanitizePersisted({ ...old, runSnapshot: 'x' }, PERSIST_VERSION).runSnapshot).toBeNull();
    expect(
      sanitizePersisted({ ...old, runSnapshot: { observedGifts: [1] } }, PERSIST_VERSION).runSnapshot,
    ).toBeNull();
    // A sound shape comes back with its run sanitized and bad ids dropped.
    expect(
      sanitizePersisted(
        {
          ...old,
          runSnapshot: {
            run: { visits: { 1: 1001 } },
            observedGifts: [9006, 'a', 9006],
            observationSlots: -1,
          },
        },
        PERSIST_VERSION,
      ).runSnapshot,
    ).toEqual({
      run: { ...emptyRun(), visits: { 1: 1001 }, currentFloor: 2, stageFloor: 2 },
      observedGifts: [9006],
    });
  });

  it('never puts the snapshot in a share link', async () => {
    // Arrange
    playSomeRun();
    useApp.getState().beginRun('new');
    const { encodeShared, decodeShared } = await import('../store.ts');
    // Act
    const shared = decodeShared(encodeShared(useApp.getState()));
    // Assert
    expect(JSON.stringify(shared)).not.toContain('runSnapshot');
  });

  it('tells the snapshot saved, rolled back and cleared in the feedback log', () => {
    // Arrange
    const states: LoggedState[] = [];
    const unsubscribe = useApp.subscribe((s) => states.push(s));
    playSomeRun();
    // Act
    useApp.getState().beginRun('new');
    const saved = states.length;
    useApp.getState().rollbackRun();
    const rolled = states.length;
    useApp.getState().beginRun('new');
    useApp.getState().resetRun();
    unsubscribe();
    // Assert
    expect(describeChange(states[saved - 2]!, states[saved - 1]!)).toContain('run snapshot saved');
    expect(describeChange(states[rolled - 2]!, states[rolled - 1]!)).toContain('run rolled back');
    expect(describeChange(states.at(-2)!, states.at(-1)!)).toContain('run snapshot cleared');
  });
});

describe('starting the screen reader starts the run (M143)', () => {
  const getDisplayMedia = vi.fn<() => Promise<MediaStream>>();
  beforeEach(() => {
    // A share that never answers: the session stays 「연결 중」.
    getDisplayMedia.mockReset();
    getDisplayMedia.mockImplementation(() => new Promise<MediaStream>(() => undefined));
    Object.defineProperty(navigator, 'mediaDevices', { value: { getDisplayMedia }, configurable: true });
  });
  afterEach(() => {
    Reflect.deleteProperty(navigator, 'mediaDevices');
  });

  const renderMenu = (extra?: ReactNode) => {
    const { deck, deployed } = useApp.getState();
    return render(
      <PlanProvider
        data={data}
        indexes={indexes}
        stats={analyseDeck(deck, indexes, data.rules.deployment, deployed)}
        lang="ko"
      >
        <CaptureProvider>
          <CaptureMenu />
          {extra}
        </CaptureProvider>
      </PlanProvider>,
    );
  };
  const openPanel = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByTestId('capture-open'));
    return screen.getByTestId('capture-panel');
  };

  it('starts at once on a run with no progress, with the run start noted', async () => {
    // Arrange
    const user = userEvent.setup();
    renderMenu();
    const panel = await openPanel(user);
    // Act
    await user.click(within(panel).getByTestId('capture-start'));
    // Assert
    expect(screen.queryByTestId('confirm-dialog')).toBeNull();
    expect(getDisplayMedia).toHaveBeenCalledTimes(1);
    expect(useApp.getState().runSnapshot).not.toBeNull();
    const note = within(panel).getByTestId('capture-run-note');
    expect(note).toHaveTextContent('바꿀 수 있는 것: 목표 기프트와 그에 따른 루트');
    expect(note).toHaveTextContent('정해지는 것: 시작 기프트·관측');
    // Act: the reader settles the start (floor 1's pack select).
    act(() => useApp.getState().markStartDone());
    // Assert
    expect(within(panel).queryByTestId('capture-run-note')).toBeNull();
  });

  it('asks first on a run with progress, and cancel does nothing', async () => {
    // Arrange
    const user = userEvent.setup();
    playSomeRun();
    const run = useApp.getState().run;
    renderMenu();
    const panel = await openPanel(user);
    // Act
    await user.click(within(panel).getByTestId('capture-start'));
    // Assert
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('지난 런의 기록이 남아 있습니다');
    expect(getDisplayMedia).not.toHaveBeenCalled();
    // Act
    await user.click(within(dialog).getAllByRole('button', { name: '취소' }).at(-1)!);
    // Assert: nothing changed, and the popover is still open.
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(getDisplayMedia).not.toHaveBeenCalled();
    expect(useApp.getState().run).toBe(run);
    expect(useApp.getState().runSnapshot).toBeNull();
    expect(screen.getByTestId('capture-panel')).toBeInTheDocument();
  });

  it('starts a fresh run from 「새 런으로 시작」, asking for the share in that press', async () => {
    // Arrange
    const user = userEvent.setup();
    playSomeRun();
    const played = useApp.getState().run;
    renderMenu();
    const panel = await openPanel(user);
    await user.click(within(panel).getByTestId('capture-start'));
    // Act
    await user.click(screen.getByRole('button', { name: '새 런으로 시작' }));
    // Assert
    expect(getDisplayMedia).toHaveBeenCalledTimes(1);
    expect(useApp.getState().run).toEqual(emptyRun());
    expect(useApp.getState().runSnapshot?.run).toEqual(played);
    expect(within(screen.getByTestId('capture-panel')).getByTestId('capture-run-note')).toBeInTheDocument();
  });

  it('reads on the same run from 「이어서」', async () => {
    // Arrange
    const user = userEvent.setup();
    playSomeRun();
    const run = useApp.getState().run;
    renderMenu();
    const panel = await openPanel(user);
    await user.click(within(panel).getByTestId('capture-start'));
    // Act
    await user.click(screen.getByRole('button', { name: '이어서' }));
    // Assert: the start of this run is settled already, so there is no note.
    expect(getDisplayMedia).toHaveBeenCalledTimes(1);
    expect(useApp.getState().run).toBe(run);
    expect(within(screen.getByTestId('capture-panel')).queryByTestId('capture-run-note')).toBeNull();
  });

  it('rolls back to before the start after saying what goes', async () => {
    // Arrange: a new run over a played one, and the new one recorded a gift and an entry.
    const user = userEvent.setup();
    playSomeRun();
    const played = useApp.getState().run;
    useApp.getState().beginRun('new');
    useApp.getState().setOptions({ observedGifts: [9007] });
    useApp.getState().setGiftStatus(9007, 'got');
    useApp.getState().visitPack(1002, 1);
    renderMenu();
    const panel = await openPanel(user);
    // Act
    await user.click(within(panel).getByTestId('capture-rollback'));
    // Assert: the dialog names what is undone, and what stays.
    const dialog = screen.getByRole('alertdialog');
    const list = within(dialog).getByTestId('capture-rollback-list');
    expect(list).toHaveTextContent('획득·미획득 기록 1개');
    expect(list).toHaveTextContent('입장 기록 1개');
    expect(list).toHaveTextContent('시작 기록');
    expect(list).toHaveTextContent('관측 지정은 시작 전 값으로 돌아갑니다');
    expect(dialog).toHaveTextContent('목표와 덱은 그대로입니다');
    // Act: cancel first, then confirm.
    await user.click(within(dialog).getAllByRole('button', { name: '취소' }).at(-1)!);
    expect(useApp.getState().runSnapshot).not.toBeNull();
    await user.click(within(screen.getByTestId('capture-panel')).getByTestId('capture-rollback'));
    await user.click(screen.getByRole('button', { name: '시작 전으로 되돌리기' }));
    // Assert
    expect(useApp.getState().run).toEqual(played);
    expect(useApp.getState().options.observedGifts).toEqual([9006]);
    expect(useApp.getState().wanted).toEqual([9006, 9007]);
    expect(useApp.getState().runSnapshot).toBeNull();
    expect(within(screen.getByTestId('capture-panel')).queryByTestId('capture-rollback')).toBeNull();
  });

  it('stops a running share on rollback', async () => {
    // Arrange: the share is asked for (and never answers), then rolled back.
    const user = userEvent.setup();
    renderMenu();
    const panel = await openPanel(user);
    await user.click(within(panel).getByTestId('capture-start'));
    expect(within(panel).getByTestId('capture-status')).toHaveAttribute('data-status', 'starting');
    // Act
    await user.click(within(panel).getByTestId('capture-rollback'));
    await user.click(screen.getByRole('button', { name: '시작 전으로 되돌리기' }));
    // Assert
    expect(within(screen.getByTestId('capture-panel')).getByTestId('capture-status')).toHaveAttribute(
      'data-status',
      'idle',
    );
  });
});
