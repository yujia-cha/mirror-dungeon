/**
 * Switching seasons.
 *
 * The second season here is the live one (MD8) reshaped to a hypothetical MD9 that has opened only
 * five floors. What these cases hold is the part that must be right before that data arrives: the app
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
import { ingredientTree } from '../lib/entangle.ts';
import { upgradeLevelsOf } from '../lib/upgrade.ts';
import { AppShell } from '../shell/AppShell.tsx';
import { PlanProvider } from '../shell/PlanContext.tsx';
import { FloorHeader } from '../stage/FloorHeader.tsx';
import { MetroMap } from '../components/MetroMap.tsx';
import { usePlan } from '../shell/plan-context.ts';

/** The map with whatever the provider has, drawn at the season's own length. */
function Metro({
  lastFloor,
  fixedModeByFloor,
}: {
  lastFloor: number;
  fixedModeByFloor: Map<number, 'parallel' | 'extreme'>;
}) {
  const { ctx, keywordLabel, plan } = usePlan();
  const empty = {
    start: { keyword: null, startGifts: [], observed: [] },
    floors: [],
    fusions: [],
    unresolved: [],
    warnings: [],
    generalDrops: [],
    stats: {
      requiredPacks: 0,
      starlight: 0,
      coveredWanted: 0,
      totalWanted: 0,
      searchCapped: false,
      searchTieCut: false,
      elapsedMs: 0,
    },
  };
  return (
    <MetroMap
      plan={plan ?? (empty as unknown as Parameters<typeof MetroMap>[0]['plan'])}
      ctx={ctx}
      keywordLabel={keywordLabel}
      lastFloor={lastFloor}
      fixedModeByFloor={fixedModeByFloor}
      variant="vertical"
      detailMode="sheet"
    />
  );
}

const ShortMetro = () => <Metro lastFloor={5} fixedModeByFloor={shortIndexes.fixedModeByFloor} />;
const FullMetro = () => <Metro lastFloor={15} fixedModeByFloor={liveIndexes.fixedModeByFloor} />;

const live = loadGameDataFromDisk();
const liveIndexes = buildIndexes(live);

/** The live season reshaped to one that has opened only 1~5, with a smaller gift roster. */
const KEPT_GIFTS = 40;
const short: GameData = {
  ...live,
  meta: {
    ...live.meta,
    dataVersion: '9.short',
    dungeon: { id: 9, name: { ko: '짧은 거울', en: 'Short Mirror' } },
    provisional: true,
  },
  rules: {
    ...live.rules,
    dungeonId: 9,
    floors: { normal: [1, 2, 3, 4, 5], hard: [1, 2, 3, 4, 5], parallel: [], extreme: [] },
  },
  gifts: live.gifts.slice(0, KEPT_GIFTS),
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
    recipes: ingredientTree(buildIndexes(data), data.rules.fusion.maxShopSlots),
    upgradeLevels: upgradeLevelsOf(data.gifts),
  });

const renderShell = (data: GameData, seasons: SeasonEntry[], onSeason = vi.fn()) => {
  const { deck, deployed } = useApp.getState();
  render(
    <AppShell
      data={data}
      indexes={data === short ? shortIndexes : liveIndexes}
      stats={analyseDeck(deck, liveIndexes, data.rules.deployment, deployed)}
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
    value: (query: string) => ({
      matches: true,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
});

describe('the season selector', () => {
  it('is plain text while only one season is published', () => {
    renderShell(live, [entry(live)]);
    expect(screen.queryByTestId('season-select')).toBeNull();
    expect(screen.getByText(live.meta.dungeon.name.ko)).toBeInTheDocument();
  });

  it('offers the choice once a second season exists, and says which one is half-known', async () => {
    const user = userEvent.setup();
    const onSeason = renderShell(short, [entry(live), entry(short)]);
    const select = screen.getByTestId('season-select');
    expect(select).toHaveValue('9');
    expect(screen.getByTestId('season-provisional')).toBeInTheDocument();
    await user.selectOptions(select, String(live.meta.dungeon.id));
    expect(onSeason).toHaveBeenCalledWith(live.meta.dungeon.id);
  });

  it('says nothing about half-known data for a season that is fully known', () => {
    // Forced whole so the case holds whichever season is live (md7 was provisional while the
    // Canto X packs waited on the static data).
    const whole: GameData = { ...live, meta: { ...live.meta, provisional: false } };
    renderShell(whole, [entry(whole), entry(short)]);
    expect(screen.queryByTestId('season-provisional')).toBeNull();
  });
});

describe('adopting a season', () => {
  it('drops the goals it has never heard of and counts them; a pack pin goes without a word (M118)', () => {
    const kept = short.gifts[0]!.id;
    const gone = live.gifts[live.gifts.length - 1]!.id;
    const unknownPack = -1;
    act(() => {
      useApp.setState({
        wanted: [kept, gone],
        fusionGoal: { [gone]: 'resultOnly' },
        options: { ...appDefaultOptions(), observedGifts: [gone], pinnedPacks: { 3: unknownPack } },
      });
    });
    let counts!: { gifts: number };
    act(() => {
      counts = adopt(short);
    });
    expect(counts).toEqual({ gifts: 1 });
    const state = useApp.getState();
    expect(state.wanted).toEqual([kept]);
    expect(state.fusionGoal).toEqual({});
    expect(state.options.observedGifts).toEqual([]);
    expect(state.options.pinnedPacks).toEqual({});
    expect(state.season).toBe(9);
    expect(state.lastFloor).toBe(5);
  });

  it('keeps a gift the season ships but cannot award — the planner explains that one itself', () => {
    const shipped = short.gifts[1]!.id;
    act(() => useApp.setState({ wanted: [shipped] }));
    let counts!: { gifts: number };
    act(() => {
      counts = adopt(short);
    });
    expect(counts.gifts).toBe(0);
    expect(useApp.getState().wanted).toEqual([shipped]);
  });

  it('drops a run recorded on floors the new season does not open', () => {
    act(() => {
      useApp.setState({
        lastFloor: 15,
        run: { ...emptyRun(), currentFloor: 9, stageFloor: 8, visits: { 7: 1402 } },
      });
    });
    act(() => {
      adopt(short);
    });
    expect(useApp.getState().run).toEqual(emptyRun());
  });

  it('keeps a finished run: the done floor is one past the last, and that is where the done card lives', () => {
    // The done state used to fail the "stage past the last floor" test and be wiped on every load.
    const done = {
      ...emptyRun(),
      currentFloor: 16,
      stageFloor: 16,
      visits: { 15: 1511 },
      giftStatus: { 9250: 'got' as const },
    };
    act(() => useApp.setState({ lastFloor: 15, run: done }));
    act(() => {
      adopt(live);
    });
    expect(useApp.getState().run).toEqual(done);
    // The same on a five-floor season: floor 6 is its done floor.
    const shortDone = { ...emptyRun(), currentFloor: 6, stageFloor: 6, visits: { 5: 1402 } };
    act(() => useApp.setState({ lastFloor: 5, run: shortDone }));
    act(() => {
      adopt(short);
    });
    expect(useApp.getState().run).toEqual(shortDone);
  });
});

describe('the metro map', () => {
  // The map used to hold `MAX_FLOOR = 15` and the 1-5 / 6-10 / 11-15 bands as constants, so a
  // five-floor season would have drawn fifteen stations and hatched an EXTREME block it has not
  // got. The floor strip already read the season; this makes the map read it too.
  it('draws one station per floor the season opens, and no band the season does not have', () => {
    act(() => {
      adopt(short);
    });
    render(
      <PlanProvider
        data={short}
        indexes={shortIndexes}
        stats={analyseDeck([], shortIndexes, short.rules.deployment, [])}
        lang="ko"
      >
        <ShortMetro />
      </PlanProvider>,
    );
    const stations = screen.getAllByTestId('station').map((el) => el.getAttribute('data-floor'));
    expect(stations).toEqual(['1', '2', '3', '4', '5']);
  });

  it('still draws all fifteen for a season that opens them', () => {
    act(() => {
      adopt(live);
    });
    render(
      <PlanProvider
        data={live}
        indexes={liveIndexes}
        stats={analyseDeck([], liveIndexes, live.rules.deployment, [])}
        lang="ko"
      >
        <FullMetro />
      </PlanProvider>,
    );
    expect(screen.getAllByTestId('station')).toHaveLength(15);
  });
});

describe('the floor strip', () => {
  it('draws one cell per floor the season opens', () => {
    act(() => {
      adopt(short);
    });
    render(
      <PlanProvider
        data={short}
        indexes={shortIndexes}
        stats={analyseDeck([], shortIndexes, short.rules.deployment, [])}
        lang="ko"
      >
        <FloorHeader mode="undecided" />
      </PlanProvider>,
    );
    expect(screen.getAllByTestId('floor-cell')).toHaveLength(5);
    expect(screen.getByTestId('stage-floor')).toHaveTextContent('1');
    expect(screen.getByText('/ 5')).toBeInTheDocument();
  });
});
