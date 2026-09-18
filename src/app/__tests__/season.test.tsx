/**
 * Switching seasons.
 *
 * Mirror Dungeon 8 has no data yet, so the second season here is the live one reshaped to five
 * floors. What these cases hold is the part that must be right before that data arrives: the app
 * offers a choice only when there is one, a shorter season really draws fewer floors, and goals
 * the new season has never heard of are dropped out loud rather than vanishing.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { loadGameDataFromDisk } from '../../core/data/node.ts';
import { analyseDeck, buildIndexes } from '../../core/index.ts';
import type { GameData, SeasonEntry } from '../../core/schema.ts';
import { appDefaultOptions, defaultUi, emptyRun, useApp } from '../store.ts';
import { lastFloorOf } from '../lib/stage.ts';
import { AppShell } from '../shell/AppShell.tsx';
import { PlanProvider } from '../shell/PlanContext.tsx';
import { FloorHeader } from '../stage/FloorHeader.tsx';

const md7 = loadGameDataFromDisk();
const md7Indexes = buildIndexes(md7);

/** The live season reshaped to one that has opened only 1~5, with a smaller gift roster. */
const KEPT_GIFTS = 40;
const short: GameData = {
  ...md7,
  meta: {
    ...md7.meta,
    dataVersion: '8.short',
    dungeon: { id: 8, name: { ko: '짧은 거울', en: 'Short Mirror' } },
    provisional: true,
  },
  rules: {
    ...md7.rules,
    dungeonId: 8,
    floors: { normal: [1, 2, 3, 4, 5], hard: [1, 2, 3, 4, 5], parallel: [], extreme: [] },
  },
  gifts: md7.gifts.slice(0, KEPT_GIFTS),
};
const shortIndexes = buildIndexes(short);

const entry = (data: GameData): SeasonEntry => ({
  id: data.meta.dungeon.id,
  name: data.meta.dungeon.name,
  dataVersion: data.meta.dataVersion,
  lastFloor: lastFloorOf(data),
  provisional: data.meta.provisional,
});

const adopt = (data: GameData) =>
  useApp.getState().adoptSeason({
    season: data.meta.dungeon.id,
    lastFloor: lastFloorOf(data),
    giftIds: new Set(data.gifts.map((gift) => gift.id)),
    packIds: new Set(data.packs.map((pack) => pack.id)),
  });

const renderShell = (data: GameData, seasons: SeasonEntry[], onSeason = vi.fn()) => {
  const { deck, deployed } = useApp.getState();
  render(
    <AppShell
      data={data}
      indexes={data === short ? shortIndexes : md7Indexes}
      stats={analyseDeck(deck, md7Indexes, data.rules.deployment, deployed)}
      lang="ko"
      dark
      seasons={seasons}
      onSeason={onSeason}
      onShare={() => undefined}
      onToggleLang={() => undefined}
      onToggleDark={() => undefined}
    />,
  );
  return onSeason;
};

beforeEach(() => {
  useApp.setState({
    deck: [],
    deployed: [],
    wanted: [],
    priority: {},
    fusionGoal: {},
    run: emptyRun(),
    ui: defaultUi(),
    options: appDefaultOptions(),
    lang: 'ko',
    dark: true,
    season: undefined,
    lastFloor: 15,
  });
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({ matches: true, media: query, addEventListener: () => undefined, removeEventListener: () => undefined }),
  });
});

describe('the season selector', () => {
  it('is plain text while only one season is published', () => {
    renderShell(md7, [entry(md7)]);
    expect(screen.queryByTestId('season-select')).toBeNull();
    expect(screen.getByText(md7.meta.dungeon.name.ko)).toBeInTheDocument();
  });

  it('offers the choice once a second season exists, and says which one is half-known', async () => {
    const user = userEvent.setup();
    const onSeason = renderShell(short, [entry(md7), entry(short)]);
    const select = screen.getByTestId('season-select');
    expect(select).toHaveValue('8');
    expect(screen.getByTestId('season-provisional')).toBeInTheDocument();
    await user.selectOptions(select, '7');
    expect(onSeason).toHaveBeenCalledWith(7);
  });

  it('says nothing about half-known data for a season that is fully known', () => {
    renderShell(md7, [entry(md7), entry(short)]);
    expect(screen.queryByTestId('season-provisional')).toBeNull();
  });
});

describe('adopting a season', () => {
  it('drops the goals and pack choices it has never heard of, and counts them', () => {
    const kept = short.gifts[0]!.id;
    const gone = md7.gifts[md7.gifts.length - 1]!.id;
    const unknownPack = -1;
    act(() => {
      useApp.setState({
        wanted: [kept, gone],
        priority: { [gone]: 'must' },
        fusionGoal: { [gone]: 'resultOnly' },
        options: { ...appDefaultOptions(), observedGifts: [gone], bannedPacks: [unknownPack] },
      });
    });
    let counts!: { gifts: number; packs: number };
    act(() => {
      counts = adopt(short);
    });
    expect(counts).toEqual({ gifts: 1, packs: 1 });
    const state = useApp.getState();
    expect(state.wanted).toEqual([kept]);
    expect(state.priority).toEqual({});
    expect(state.fusionGoal).toEqual({});
    expect(state.options.observedGifts).toEqual([]);
    expect(state.options.bannedPacks).toEqual([]);
    expect(state.season).toBe(8);
    expect(state.lastFloor).toBe(5);
  });

  it('keeps a gift the season ships but cannot award — the planner explains that one itself', () => {
    const shipped = short.gifts[1]!.id;
    act(() => useApp.setState({ wanted: [shipped] }));
    let counts!: { gifts: number; packs: number };
    act(() => {
      counts = adopt(short);
    });
    expect(counts.gifts).toBe(0);
    expect(useApp.getState().wanted).toEqual([shipped]);
  });

  it('drops a run recorded on floors the new season does not open', () => {
    act(() => {
      useApp.setState({ lastFloor: 15, run: { ...emptyRun(), currentFloor: 9, stageFloor: 8, visits: { 7: 1402 } } });
    });
    act(() => {
      adopt(short);
    });
    expect(useApp.getState().run).toEqual(emptyRun());
  });
});

describe('the floor strip', () => {
  it('draws one cell per floor the season opens', () => {
    act(() => {
      adopt(short);
    });
    render(
      <PlanProvider data={short} indexes={shortIndexes} stats={analyseDeck([], shortIndexes, short.rules.deployment, [])} lang="ko">
        <FloorHeader mode="undecided" />
      </PlanProvider>,
    );
    expect(screen.getAllByTestId('floor-cell')).toHaveLength(5);
    expect(screen.getByTestId('stage-floor')).toHaveTextContent('1');
    expect(screen.getByText('/ 5')).toBeInTheDocument();
  });
});
