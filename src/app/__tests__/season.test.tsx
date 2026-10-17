/**
 * Seasons.
 *
 * The app plans the default season only (M145): the footer names it and offers no choice, and a
 * saved state or a link from another season is adopted into it. The second season here is the
 * live one (MD8) reshaped to a hypothetical MD9 that has opened only five floors. What these cases
 * hold is the part that must be right before that data arrives: a shorter season really draws
 * fewer floors, and goals the season has never heard of are dropped out loud rather than vanishing.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { loadGameDataFromDisk } from '../../core/data/node.ts';
import { analyseDeck, buildIndexes } from '../../core/index.ts';
import type { GameData } from '../../core/schema.ts';
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
  const { ctx, plan } = usePlan();
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

const adopt = (data: GameData) =>
  useApp.getState().adoptSeason({
    season: data.meta.dungeon.id,
    lastFloor: lastFloorOf(data),
    giftIds: new Set(data.gifts.map((gift) => gift.id)),
    packIds: new Set(data.packs.map((pack) => pack.id)),
    recipes: ingredientTree(buildIndexes(data), data.rules.fusion.maxShopSlots),
    upgradeLevels: upgradeLevelsOf(data.gifts),
  });

const renderShell = (data: GameData) => {
  const { deck, deployed } = useApp.getState();
  render(
    <AppShell
      data={data}
      indexes={data === short ? shortIndexes : liveIndexes}
      stats={analyseDeck(deck, liveIndexes, data.rules.deployment, deployed)}
      lang="ko"
      dark
      onShare={() => undefined}
      onToggleLang={() => undefined}
      onToggleDark={() => undefined}
    />,
  );
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

describe('the footer', () => {
  // MD7 is still published beside MD8 (`index.json` lists both), but the reader no longer picks
  // one (M145): the footer names the season the app opened, as plain text.
  it('names the season and offers no choice', () => {
    renderShell(live);
    expect(screen.queryByTestId('season-select')).toBeNull();
    expect(screen.getByRole('contentinfo').querySelector('select')).toBeNull();
    expect(screen.getByTestId('season-name')).toHaveTextContent(live.meta.dungeon.name.ko);
  });

  it('says which season is half-known', () => {
    renderShell(short);
    expect(screen.getByTestId('season-provisional')).toBeInTheDocument();
  });

  it('says nothing about half-known data for a season that is fully known', () => {
    // Forced whole so the case holds whichever season is live (md7 was provisional while the
    // Canto X packs waited on the static data).
    const whole: GameData = { ...live, meta: { ...live.meta, provisional: false } };
    renderShell(whole);
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

  it('drops a run saved while another season was open (M145: a stored MD7 adopts into MD8)', () => {
    const run = { ...emptyRun(), currentFloor: 3, stageFloor: 3, visits: { 1: live.packs[0]!.id } };
    act(() => {
      useApp.setState({ season: 7, run, runSnapshot: { run, observedGifts: [] } });
    });
    act(() => {
      adopt(live);
    });
    expect(useApp.getState().season).toBe(live.meta.dungeon.id);
    expect(useApp.getState().run).toEqual(emptyRun());
    expect(useApp.getState().runSnapshot).toBeNull();
    // The same season loading again keeps the run.
    act(() => useApp.setState({ run }));
    act(() => {
      adopt(live);
    });
    expect(useApp.getState().run).toEqual(run);
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
    // (Saved under that season: a run from another season is dropped whatever its floors.)
    act(() => useApp.setState({ lastFloor: 5, run: shortDone, season: short.meta.dungeon.id }));
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
