import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import lzString from 'lz-string';
import type { PlanOptions } from '../core/types.ts';
import type { UpgradeLevel } from '../core/schema.ts';
import { defaultOptions } from '../core/index.ts';
import type { Lang } from './i18n.ts';
import {
  APP_START,
  observationClosed,
  runHasProgress,
  type FusionGoalMap,
  type GiftStatus,
  type RunState,
} from './lib/plan-input.ts';
import { DEFAULT_READ_INTERVAL, READ_INTERVALS, type ReadIntervalPreset } from './capture/loop.ts';

export type LeftTab = 'deck' | 'gifts';
export type RightTab = 'plan' | 'tracker';

/** Which side panels are open on a desktop layout, and which tab each shows. Device-only. */
export interface UiState {
  leftOpen: boolean;
  leftTab: LeftTab;
  rightOpen: boolean;
  rightTab: RightTab;
  /** Desktop panel widths in px, dragged by the divider between panel and stage. */
  leftWidth: number;
  rightWidth: number;
  /** How large gift tiles are drawn in the grids, tray, tracker and stage (`lib/icon-size.ts`). */
  giftIconScale: GiftIconScale;
  /**
   * How large all text is drawn (M123): one factor on every type role, set on `<html>` as
   * `data-text-scale` (`src/index.css`). `index.html` applies it before the first paint too.
   */
  textScale: TextScale;
  /** Screen reader (M107): how often it looks, and the language the game client is in. */
  captureInterval: ReadIntervalPreset;
  captureLang: 'ko' | 'en';
  /**
   * The owner's diagnostics (M112): the section is shown (opened by `#diag`), recording is on,
   * and frames are kept with it. All off by default; visitors never see the section.
   */
  diagEnabled: boolean;
  diagRecord: boolean;
  diagImages: boolean;
}

/** Steps of the gift tile size setting; `md` is the size the layout was drawn at. */
export const GIFT_ICON_SCALES = ['sm', 'md', 'lg', 'xl'] as const;
export type GiftIconScale = (typeof GIFT_ICON_SCALES)[number];

/** Steps of the text size setting (M123); `md` is the size the type roles were drawn at. */
export const TEXT_SCALES = ['sm', 'md', 'lg', 'xl'] as const;
export type TextScale = (typeof TEXT_SCALES)[number];

/** How wide a side panel may be dragged: narrow enough to read, never eating the whole stage. */
export const PANEL_WIDTH = { min: 260, max: 560, default: 336 } as const;

export interface SharedState {
  /**
   * The Mirror Dungeon the goals were picked in, written into a link as `s`. The app always opens
   * the default season (M145) and adopts whatever a link carries into it, so nothing reads this
   * back; it is still written so a link says which season it was made in, should a later app
   * offer a choice again.
   */
  season?: number;
  /** Identity ids in formation order: at most 12, one per sinner (enforced by `uniqueDeck` on every way in). */
  deck: number[];
  /** Who fights, as a subset of `deck`; the order comes from the deck. */
  deployed: number[];
  wanted: number[];
  options: PlanOptions;
  /** Fusion results whose ingredients are not goals of their own. Absent = ingredients count too. */
  fusionGoal?: FusionGoalMap;
  /**
   * The enhancement step chosen for a goal (M130). A link carries the goals' choices only; absent
   * (every link before M130) means none.
   */
  upgrades?: GiftUpgradeMap;
}

/**
 * The enhancement step chosen per gift (M130): `+` = 1, `++` = 2, absent = not enhanced. It is a
 * preference about the gift, not about the goal, so taking the gift out of the goals keeps it.
 */
export type GiftUpgradeMap = Record<number, UpgradeLevel>;

interface AppState extends SharedState {
  fusionGoal: FusionGoalMap;
  upgrades: GiftUpgradeMap;
  /** The season being planned. Undefined until the data says which one the app opened. */
  season: number | undefined;
  /**
   * How many floors this season opens, from `rules.floors`. Not persisted — it is a fact about the
   * data, re-read on every load — and defaulted to the longest run so a rehydrate before the data
   * arrives cannot clamp a saved run away.
   */
  lastFloor: number;
  /** Progress of the run being played. Kept on this device only; never part of a share link. */
  run: RunState;
  /**
   * The state before the screen reader last started a run (M143): the run as it stood and the
   * observation pins and slots. 「런 중단 · 시작 전으로 되돌리기」 puts it back. Device only, never
   * shared; null when there is nothing to go back to.
   */
  runSnapshot: RunSnapshot | null;
  ui: UiState;
  lang: Lang;
  dark: boolean;

  /** Fill a sinner's slot; a newcomer is deployed while fewer than `autoDeployUpTo` fight. */
  setDeckSlot: (sinnerId: number, identityId: number | null, autoDeployUpTo?: number) => void;
  /** Replace the deck; `deployed` (a formation code's own order) wins over the first `deployedDefault`. */
  setDeck: (deck: number[], deployedDefault: number, deployed?: number[]) => void;
  clearDeck: () => void;
  toggleDeployed: (identityId: number, max: number) => void;
  toggleWanted: (giftId: number, dropWithIt?: number[]) => void;
  removeWanted: (giftId: number) => void;
  clearWanted: () => void;
  /** Pin or unpin a wanted gift for 기프트 관측; at most `max` pins. */
  /** Pin or unpin a wanted gift for 기프트 관측; a pin needs a free slot and an observable gift. */
  toggleObserved: (giftId: number, limits: ObserveLimits) => void;
  setFusionGoal: (giftId: number, goal: 'resultOnly' | 'withIngredients') => void;
  /** Choose a gift's enhancement step (M130); 0 goes back to the plain gift. */
  setUpgrade: (giftId: number, level: UpgradeLevel | 0) => void;
  /**
   * Record that `packId` was entered on `floor`; a pack is visited once, so an earlier floor for it
   * is replaced. `settle.got` marks gifts collected in the same update (the start-of-run gifts).
   */
  visitPack: (packId: number, floor: number, settle?: { got?: number[]; failed?: number[] }) => void;
  /** Drop the record; when it was the last decided floor, that floor becomes undecided again. */
  /** Undo an entry; `reset` names gift ids whose recorded status is cleared with it (the pack's own drops). */
  unvisitPack: (packId: number, opts?: { reset?: number[] }) => void;
  /** Leave the stage floor: an undecided floor is skipped; `settle` applies collected / missed gifts first. */
  nextFloor: (settle?: { got?: number[]; failed?: number[] }) => void;
  /**
   * Show another floor. A skip right before the frontier is taken back so the floor is decided
   * again. Walking *forward* settles the floors left behind — `settle` carries the same collected
   * and missed lists 「다음 층」 would have applied.
   */
  setStageFloor: (floor: number, settle?: { got?: number[]; failed?: number[] }) => void;
  resetRun: () => void;
  /**
   * Starting the screen reader is starting the run (M143). `'new'` saves what is there now as the
   * snapshot to go back to and starts the run over; a run with no progress is only snapshotted,
   * and keeps the snapshot it already has (a share refused and tried again must not overwrite the
   * run it saved). `'continue'` (a reload mid-run) leaves the run and the snapshot as they are.
   */
  beginRun: (mode: 'new' | 'continue') => void;
  /**
   * 「런 중단 · 시작 전으로 되돌리기」 (M143): the run and the observation pins and slots go back to
   * the snapshot, which is then spent. Goals, deck and the other options stay. Without a snapshot
   * a run with progress goes back to an empty run, pins kept (M158); false when nothing changes.
   */
  rollbackRun: () => boolean;
  /**
   * The run start is over while floor 1 is still ahead (M134): the start gifts and 기프트 관측 are
   * spent, so the plan stops choosing or recommending them (`run.startDone`). For the screen reader,
   * which sees the observation screen left or floor 1's pack select (M135); the overlay's
   * 「확인하고 진행」 closes it through `confirmStart` instead (M138).
   * `false` reopens the start — the reader's undo, nothing else.
   */
  markStartDone: (done?: boolean) => void;
  /**
   * Pin a gift the screen reader saw observed (M135). The same rules as `toggleObserved` for a new
   * pin — a free slot, an observable gift the route collects — and the start still open, except
   * that a gift already in hand on floor 1 may be pinned after the start closed: that is an
   * observation the run already spent (M134), which is what the reader records. Never unpins.
   */
  recordObserved: (giftId: number, limits: ObserveLimits) => void;
  /**
   * The player says what the run start actually handed over (M138, the overlay's 「확인하고 진행」):
   * `got` lands in hand, `dropped` (a candidate turned off) is not, the `observed` ones among `got`
   * are pinned under `recordObserved`'s rules, and the start is settled (`settleStart`). The plan
   * then routes every recommendation the player did not take. Floor 1 with the start open only.
   */
  confirmStart: (
    picks: { got: number[]; dropped: number[]; observed: number[] },
    limits: ObserveLimits,
  ) => void;
  /**
   * 시작 정산 (M140): close the run start on what it actually handed over. The plan assumes every
   * observation (pinned or recommended) and start gift is collected; whatever is marked collected
   * on floor 1 when the start closes — popups, `got` (the plan's guess, when nobody watched), the
   * overlay — is the answer: it is `run.startGifts`, and a pin on a gift not among it was never
   * observed and comes off. The plan then routes what the start did not give. Floor 1 with the
   * start open only; returns the pins it took off (the screen reader's undo puts them back).
   */
  settleStart: (got?: number[]) => number[];
  /**
   * Whether the screen reader is running (M140, never saved): the start is then settled on what
   * it saw, not on the plan's guess.
   */
  captureLive: boolean;
  setCaptureLive: (live: boolean) => void;
  setGiftStatus: (giftId: number, status: GiftStatus | null) => void;
  /**
   * 「남은 재료 모으기」 on a fusion the run lost: keep entering packs for its remaining
   * ingredients (`on`), or give them up with the fusion (the default once the run is under way).
   * Collecting them makes them goals again, so it also clears 「재료는 목표가 아님」.
   */
  setCollectRest: (giftId: number, on: boolean) => void;
  setOptions: (patch: Partial<PlanOptions>) => void;
  /** The header's 초기화: deck back to `deck` (the LCB default), no items, default options, no run. `ui`, `lang`, `dark` stay. */
  resetAll: (deck: number[], deployedDefault: number) => void;
  setUi: (patch: Partial<UiState>) => void;
  setLang: (lang: Lang) => void;
  toggleDark: () => void;
  /**
   * Take on the season that just loaded and drop what it has never heard of.
   *
   * A gift or pack id this season does not ship cannot be drawn, named or planned, so keeping it
   * would leave a blank in the list. One this season ships but cannot award is a different thing
   * and stays: the planner already explains it as 미해결. Returns what was dropped so the app can
   * say so rather than letting choices disappear quietly. A run saved under another season (the
   * app used to let the reader pick one, M145 fixed it to the default) belongs to that season's
   * floors and packs, so it is dropped.
   */
  adoptSeason: (info: {
    season: number;
    lastFloor: number;
    giftIds: Set<number>;
    packIds: Set<number>;
    /** This season's fusion recipes (`ingredientTree`). The store keeps it to judge pins. */
    recipes: ReadonlyMap<number, readonly number[]>;
    /** The highest enhancement step each gift has text for (`gift.upgrades`); others have none. */
    upgradeLevels: ReadonlyMap<number, UpgradeLevel>;
    /** The 잔영 materials (M152): no goal, no mark. Omitted = none. */
    materials?: ReadonlySet<number>;
    /**
     * Every identity the data ships (shared by the seasons). A deck slot or a deployed id outside
     * it cannot be drawn or analysed, so it goes — without a count: no reader chose it, it is a
     * blob or a link no build of this app wrote. Omitted = the deck is not checked.
     */
    identityIds?: ReadonlySet<number>;
  }) => {
    gifts: number;
  };
  /**
   * Take a share link's plan. Whatever season the link names, it is planned in the one loaded
   * (M145): once a season has been adopted, the link's goals go through the same `adoptSeason`
   * pass, and what it dropped is returned for the app to say. Before the first load nothing is
   * known yet and the count is 0 — that load adopts the link.
   */
  applyShared: (shared: SharedState) => { gifts: number };
}

const SINNER_COUNT = 12;
const LEGACY_DEPLOYED = 6;

/** Identity ids are 1SSNN, so the sinner a slot belongs to is derivable from the id. */
export function sinnerOf(identityId: number): number {
  return Math.floor(identityId / 100) % 100;
}

/**
 * The theme a first visit starts in: dark (M122, owner's call — the game is dark, and the app is
 * used beside it). The player's own choice (「테마 변경」) is saved and wins from then on.
 */
function prefersDark(): boolean {
  return true;
}

/**
 * The most floors any Mirror Dungeon has opened.
 *
 * This is a bound for saved and shared state, not a season's floor count: how far *this* season
 * goes comes from `rules.floors` and reaches the store as `lastFloor` when the data loads. A season
 * that opens only 1~5 is shorter; none has ever been longer.
 */
export const MAX_FLOOR_EVER = 15;

/** The planner's defaults with the app's fixed floor range and start applied. */
export function appDefaultOptions(): PlanOptions {
  return { ...defaultOptions(), lastFloor: MAX_FLOOR_EVER, hardFromFloor: 1, ...APP_START };
}

/**
 * Keep only the option keys the planner knows, so a link or a saved state from an older version
 * (which carried `giftObservationMax`, or a shorter floor range) cannot smuggle stale keys or a
 * partial run into the plan.
 */
export function sanitizeOptions(raw: unknown): PlanOptions {
  const defaults = appDefaultOptions();
  const source = (raw ?? {}) as Record<string, unknown>;
  const out = { ...defaults } as Record<string, unknown>;
  for (const key of Object.keys(defaults)) if (key in source) out[key] = source[key];
  const observed = Array.isArray(out.observedGifts) ? out.observedGifts : [];
  out.observedGifts = [...new Set(observed.filter((n): n is number => typeof n === 'number'))];
  // Slots turned off with 「관측하지 않기」 (M120). Core clamps the top to the rules' count.
  const slots = source.observationSlots;
  if (typeof slots === 'number' && Number.isInteger(slots) && slots >= 0) out.observationSlots = slots;
  else delete out.observationSlots;
  // No start keyword and no starting gift (M145): a saved state or a link from M134~M144 that
  // still carries a count or a keyword is planned the app's way, without a word.
  Object.assign(out, APP_START);
  // Whether the start is over is the run's (`run.startDone`), never a saved or shared option.
  delete out.startDecided;
  // Pack-level choices are the CLI's (`--ban`, `--prefer`); the app has no control for them, so a
  // saved state or an old link that still carries some would steer the route with nothing on
  // screen to say so or to undo it. They are dropped without a word.
  out.bannedPacks = [];
  out.preferredPacks = [];
  // No pinning a pack either (M118): the goals decide the route. The packs entered so far live in
  // the run (`run.visits`), never in saved or shared options; an old link's pins go quietly.
  out.pinnedPacks = {};
  out.lastFloor = MAX_FLOOR_EVER;
  out.hardFromFloor = 1;
  // Run progress lives in the `run` slice, never in shared or saved options — and who fights is the
  // store's `deployed` (`planInputFor` sets it), so a stored or linked copy is not carried along.
  out.currentFloor = 1;
  out.ownedGifts = [];
  out.unobtainableGifts = [];
  return out as unknown as PlanOptions;
}

/** Fusion goals only for wanted gifts, with the one non-default value. */
export function sanitizeFusionGoal(raw: unknown, wanted: number[]): FusionGoalMap {
  const out: FusionGoalMap = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const id = Number(key);
    if (wanted.includes(id) && value === 'resultOnly') out[id] = value;
  }
  return out;
}

/**
 * Enhancement choices with a sound shape: a finite integer gift id and step 1 or 2. Which steps a
 * gift really has is a fact of the season's data, judged by `adoptSeason`. With `only`, the
 * choices for those gifts alone (what a share link carries).
 */
export function sanitizeUpgrades(raw: unknown, only?: readonly number[]): GiftUpgradeMap {
  const out: GiftUpgradeMap = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const id = Number(key);
    if (!Number.isInteger(id) || (only && !only.includes(id))) continue;
    if (value === 1 || value === 2) out[id] = value;
  }
  return out;
}

/** What a pin must satisfy: the slot limit and whether the gift can be observed at all. */
export interface ObserveLimits {
  max: number;
  observable: (giftId: number) => boolean;
}

/*
 * The recipe tree, as the store's one piece of borrowed knowledge.
 *
 * A pin is only kept for something the route is out to collect, and that is not the goal list: a
 * fusion goal is a promise about its ingredients too, and those are exactly the gifts a player
 * wants to observe (they are the ones the shop has to hand over before the fusion can happen).
 * Deciding that needs `GameIndexes`, which the store does not hold and must not, so `adoptSeason`
 * — which runs on every data load — leaves the season's tree here. It is data, not state: it is
 * never persisted, and an empty tree just means 「아직 모른다」 — which `withObservedIn` treats as
 * 「판정하지 않는다」 rather than as 「모으는 것이 없다」.
 */
let recipeTree: ReadonlyMap<number, readonly number[]> = new Map();

/** What the last `adoptSeason` was told, so a share link applied after the load is adopted too. */
let adoptedSeason: Parameters<AppState['adoptSeason']>[0] | null = null;

/**
 * The season's 잔영 materials (M152, owner's call): always held, never a goal. They come from
 * toasts the reader cannot see, any number at a time, and are spent by fusions and sales the run
 * cannot count — and no recipe of the season eats one (`tests/generated-data.test.ts`). So the run
 * keeps no mark for them and the goals take none. Set by `adoptSeason`, like the recipe tree.
 */
let materialIds: ReadonlySet<number> = new Set();

/** For tests: forget the season's recipes, the way a fresh page load starts out. */
export function forgetRecipes(): void {
  recipeTree = new Map();
  adoptedSeason = null;
}

/**
 * The gifts a pin may sit on: the goals, and everything a fusion goal consumes on the way. It is
 * the store's copy of `PlanState.needed`, minus the one thing only the plan knows — whether a
 * fusion died — which core trims on its own.
 */
export function collectedGifts(wanted: readonly number[], fusionGoal: FusionGoalMap): Set<number> {
  const out = new Set(wanted);
  for (const id of wanted) {
    // 「재료는 목표가 아님」 keeps them out of the plan, so it keeps them out of observation too.
    if (fusionGoal[id] === 'resultOnly') continue;
    for (const ingredient of recipeTree.get(id) ?? []) out.add(ingredient);
  }
  return out;
}

// Whether a run holds anything worth asking about lives with the run's other predicates; the
// screen reader imports it from here.
export { runHasProgress } from './lib/plan-input.ts';

/** What 「시작 전으로 되돌리기」 restores (M143): the run, and the pins and slots the start may change. */
export interface RunSnapshot {
  run: RunState;
  observedGifts: number[];
  /** `options.observationSlots`; absent = the rules' count. */
  observationSlots?: number;
}

/** A snapshot of the state now. */
function snapshotOf(run: RunState, options: PlanOptions): RunSnapshot {
  return {
    run,
    observedGifts: [...options.observedGifts],
    ...(options.observationSlots === undefined ? {} : { observationSlots: options.observationSlots }),
  };
}

/** A stored snapshot, kept only when its shape is sound; null otherwise (and for every blob before M143). */
export function sanitizeRunSnapshot(raw: unknown): RunSnapshot | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  if (!source.run || typeof source.run !== 'object') return null;
  const observed = Array.isArray(source.observedGifts) ? source.observedGifts : [];
  const slots = source.observationSlots;
  return {
    run: sanitizeRun(source.run),
    observedGifts: [...new Set(observed.filter((n): n is number => Number.isInteger(n)))],
    ...(typeof slots === 'number' && Number.isInteger(slots) && slots >= 0
      ? { observationSlots: slots }
      : {}),
  };
}

export function emptyRun(): RunState {
  return { currentFloor: 1, stageFloor: 1, visits: {}, giftStatus: {}, startGifts: [] };
}

export function defaultUi(): UiState {
  return {
    leftOpen: true,
    leftTab: 'gifts',
    rightOpen: true,
    rightTab: 'plan',
    leftWidth: PANEL_WIDTH.default,
    rightWidth: PANEL_WIDTH.default,
    giftIconScale: 'md',
    textScale: 'md',
    captureInterval: DEFAULT_READ_INTERVAL,
    captureLang: 'ko',
    diagEnabled: false,
    diagRecord: false,
    diagImages: false,
  };
}

/** A stored or dragged width, rounded and held inside the allowed band. */
export function clampPanelWidth(raw: unknown): number {
  const value = typeof raw === 'number' && Number.isFinite(raw) ? Math.round(raw) : PANEL_WIDTH.default;
  return Math.min(PANEL_WIDTH.max, Math.max(PANEL_WIDTH.min, value));
}

export function sanitizeUi(raw: unknown): UiState {
  const out = defaultUi();
  if (!raw || typeof raw !== 'object') return out;
  const source = raw as Record<string, unknown>;
  if (typeof source.leftOpen === 'boolean') out.leftOpen = source.leftOpen;
  if (typeof source.rightOpen === 'boolean') out.rightOpen = source.rightOpen;
  // The old 「루트 설정」 tab folded into the items tab.
  if (source.leftTab === 'deck' || source.leftTab === 'gifts') out.leftTab = source.leftTab;
  else if (source.leftTab === 'settings') out.leftTab = 'gifts';
  // The old 「목표」 tab (`'goals'`) is gone; it falls back to the route like any unknown value.
  if (source.rightTab === 'plan' || source.rightTab === 'tracker') out.rightTab = source.rightTab;
  out.leftWidth = clampPanelWidth(source.leftWidth);
  out.rightWidth = clampPanelWidth(source.rightWidth);
  // `activeUnpickedOnly` went with the 「현재 활성」 section (M121): built from the defaults, the
  // saved key is simply not copied over.
  if ((GIFT_ICON_SCALES as readonly unknown[]).includes(source.giftIconScale))
    out.giftIconScale = source.giftIconScale as GiftIconScale;
  if ((TEXT_SCALES as readonly unknown[]).includes(source.textScale))
    out.textScale = source.textScale as TextScale;
  if (typeof source.captureInterval === 'string' && source.captureInterval in READ_INTERVALS)
    out.captureInterval = source.captureInterval as ReadIntervalPreset;
  if (source.captureLang === 'ko' || source.captureLang === 'en') out.captureLang = source.captureLang;
  if (typeof source.diagEnabled === 'boolean') out.diagEnabled = source.diagEnabled;
  if (typeof source.diagRecord === 'boolean') out.diagRecord = source.diagRecord;
  // Frames go with recording: kept only while recording is on.
  if (typeof source.diagImages === 'boolean') out.diagImages = source.diagImages && out.diagRecord;
  return out;
}

/** The floor after the longest possible run; `currentFloor` never exceeds it. */
export const MAX_RUN_DONE_FLOOR = MAX_FLOOR_EVER + 1;

/** The floor after this season's run: `currentFloor` reaching it means the run is over. */
export function runDoneFloor(lastFloor: number): number {
  return lastFloor + 1;
}

/** A saved run, kept only when it still makes sense: integer floors within the run, one floor per pack. */
export function sanitizeRun(raw: unknown): RunState {
  const out = emptyRun();
  if (!raw || typeof raw !== 'object') return out;
  const source = raw as Record<string, unknown>;
  // Before v6 a run had to be started; a saved run that never was carries nothing worth keeping.
  if (source.active === false) return out;
  const seen = new Set<number>();
  if (source.visits && typeof source.visits === 'object') {
    for (const [floor, packId] of Object.entries(source.visits as Record<string, unknown>)) {
      const f = Number(floor);
      if (
        !Number.isInteger(f) ||
        f < 1 ||
        f > MAX_FLOOR_EVER ||
        typeof packId !== 'number' ||
        seen.has(packId)
      )
        continue;
      seen.add(packId);
      out.visits[f] = packId;
    }
  }
  if (source.giftStatus && typeof source.giftStatus === 'object') {
    for (const [id, status] of Object.entries(source.giftStatus as Record<string, unknown>)) {
      if (Number.isInteger(Number(id)) && (status === 'got' || status === 'failed' || status === 'used'))
        out.giftStatus[Number(id)] = status;
    }
  }
  const floor = typeof source.currentFloor === 'number' ? Math.round(source.currentFloor) : 1;
  out.currentFloor = Math.min(
    MAX_RUN_DONE_FLOOR,
    Math.max(1, floor, ...Object.keys(out.visits).map((f) => Number(f) + 1)),
  );
  const stage = typeof source.stageFloor === 'number' ? Math.round(source.stageFloor) : out.currentFloor;
  // Up to the done floor, never past it: the stage stands one beyond the last floor when the run
  // is over, and that is where the done card lives.
  out.stageFloor = Math.min(MAX_RUN_DONE_FLOOR, out.currentFloor, Math.max(1, stage));
  // The start-of-run record only means something once floor 1 is behind or the start was confirmed,
  // and only for gifts still marked as collected.
  if ((out.currentFloor > 1 || source.startDone === true) && Array.isArray(source.startGifts)) {
    out.startGifts = [
      ...new Set(
        source.startGifts.filter(
          (id): id is number => Number.isInteger(id) && out.giftStatus[id as number] === 'got',
        ),
      ),
    ];
  }
  if (Array.isArray(source.collectRest)) {
    const collectRest = [...new Set(source.collectRest.filter((id): id is number => Number.isInteger(id)))];
    if (collectRest.length > 0) out.collectRest = collectRest;
  }
  if (source.startDone === true) out.startDone = true;
  return out;
}

/**
 * Builds before M17 recorded the planner's recommended observations as collected on leaving
 * floor 1 and never took that back, so a saved run can carry a "got" ingredient nobody has. Dropping
 * every collected mark on a gift that is no goal makes the planner route for it again (a pack
 * already visited still supplies its own drops through the played floor), at the cost of tracker
 * marks on non-goal gifts, which the player can set again.
 */
export function withoutLegacyGot(
  giftStatus: RunState['giftStatus'],
  wanted: number[],
): RunState['giftStatus'] {
  const out: RunState['giftStatus'] = {};
  for (const [id, status] of Object.entries(giftStatus)) {
    if (status === 'got' && !wanted.includes(Number(id))) continue;
    out[Number(id)] = status;
  }
  return out;
}

/**
 * Misses only ever land on what the route collects (`autoFailedFor` fails what a visited pack
 * was expected to drop), and only the goals panel and the entered pack can take one back. So a
 * gift no longer collected that carries a 「실패」 becomes unreachable while `planInputFor` keeps
 * handing it to the planner as `unobtainableGifts` — a fusion that eats it stays unresolvable with
 * nothing on screen to undo. `collected` is `collectedGifts`, the goals plus what a fusion goal
 * consumes: an ingredient's miss has to outlive toggles of the other goals, or the planner would
 * quietly count the ingredient as in hand again. Collected marks are left alone: the tracker and
 * the stage set those on non-goal gifts on purpose.
 */
export function withoutStaleFailures(
  giftStatus: RunState['giftStatus'],
  collected: ReadonlySet<number>,
): RunState['giftStatus'] {
  const stale = Object.entries(giftStatus).filter(
    ([id, status]) => status === 'failed' && !collected.has(Number(id)),
  );
  if (stale.length === 0) return giftStatus;
  const out = { ...giftStatus };
  for (const [id] of stale) delete out[Number(id)];
  return out;
}

/** The run with every unreachable miss dropped; the same object when nothing was stale. */
function withRunFor(run: RunState, wanted: number[], fusionGoal: FusionGoalMap): RunState {
  const giftStatus = withoutStaleFailures(run.giftStatus, collectedGifts(wanted, fusionGoal));
  // A 「남은 재료 모으기」 choice belongs to its goal and goes with it.
  const collectRest = run.collectRest?.filter((id) => wanted.includes(id));
  const prunedRest = collectRest !== undefined && collectRest.length !== run.collectRest?.length;
  if (giftStatus === run.giftStatus && !prunedRest) return run;
  return { ...run, giftStatus, ...(prunedRest ? { collectRest } : {}) };
}

function withoutPack(visits: Record<number, number>, packId: number): Record<number, number> {
  const out: Record<number, number> = {};
  for (const [f, id] of Object.entries(visits)) if (id !== packId) out[Number(f)] = id;
  return out;
}

/**
 * Move the frontier. Leaving floor 1 is when `settle.got` — the start-of-run gifts — lands in hand
 * and is remembered; coming back to floor 1 takes that record out again (a status the player
 * changed by hand in the meantime is left alone). A closed start (`run.startDone`) is a fact of the
 * game, not a guess from the plan: what `confirmStart` recorded stays through both moves.
 */
function moveFrontier(
  run: RunState,
  currentFloor: number,
  settle?: { got?: number[]; failed?: number[] },
): Pick<RunState, 'currentFloor' | 'giftStatus' | 'startGifts'> {
  let giftStatus = withStatus(run.giftStatus, settle);
  let startGifts = run.startGifts;
  if (run.currentFloor === 1 && currentFloor > 1) {
    startGifts = [...new Set([...(run.startDone ? run.startGifts : []), ...(settle?.got ?? [])])];
  } else if (run.currentFloor > 1 && currentFloor === 1 && !run.startDone) {
    giftStatus = { ...giftStatus };
    for (const id of run.startGifts) if (giftStatus[id] === 'got') delete giftStatus[id];
    startGifts = [];
  }
  return { currentFloor, giftStatus, startGifts };
}

function withStatus(
  giftStatus: RunState['giftStatus'],
  settle?: { got?: number[]; failed?: number[] },
): RunState['giftStatus'] {
  if (!settle) return giftStatus;
  const next = { ...giftStatus };
  for (const id of settle.got ?? []) next[id] = 'got';
  // A miss never overrides what the player already recorded.
  for (const id of settle.failed ?? []) if (next[id] === undefined) next[id] = 'failed';
  return next;
}

/** A pinned observation only makes sense for a wanted gift. */
/** The localStorage key and schema version. Exported so a crash screen can clear the state it saved. */
export const PERSIST_KEY = 'md-route-planner';
export const PERSIST_VERSION = 7;

/** Exactly the keys `partialize` writes — what a migration has to hand back, all of them present. */
export type PersistedState = Pick<
  AppState,
  | 'deck'
  | 'deployed'
  | 'wanted'
  | 'fusionGoal'
  | 'upgrades'
  | 'run'
  | 'runSnapshot'
  | 'ui'
  | 'options'
  | 'lang'
  | 'dark'
  | 'season'
>;

/**
 * Everything a stored blob has to pass to become state. Both the version migration and the plain
 * rehydrate go through here, so the checks run whether or not the version changed, and nothing
 * but the persisted keys comes out.
 *
 * Version gates: v2 backfilled the deployed list; v3 replaced the observation count with pinned
 * observation gifts; v4 fixed the floor range at 15 and added per-gift priorities; v5 added fusion
 * goals and the run in progress; v6 dropped the step flow (the run is always on) and added the
 * panel state; v7 (M17) records the start-of-run gifts so returning to floor 1 takes them back —
 * a run saved by an earlier build may still hold a recommended observation as collected.
 */
export function sanitizePersisted(persisted: unknown, version: number): PersistedState {
  let state = (persisted && typeof persisted === 'object' ? persisted : {}) as Partial<AppState> & {
    step?: unknown;
  };
  if (version < 2) {
    const legacyDeck = Array.isArray(state.deck) ? state.deck : [];
    state = { ...state, deck: legacyDeck, deployed: legacyDeck.slice(0, LEGACY_DEPLOYED) };
  }
  // An id list is the one shape a share link and a hand-edited blob both get wrong, so the
  // elements are filtered too — `deck: "abc"` used to survive as a string and break every reader.
  // Each id once, too: a goal named twice was counted twice by the planner (「획득 1/2」 for one
  // gift) and drawn as two tiles under one React key.
  const ids = (raw: unknown): number[] =>
    Array.isArray(raw)
      ? [...new Set(raw.filter((n): n is number => typeof n === 'number' && Number.isFinite(n)))]
      : [];
  // One identity per sinner and at most twelve, as `setDeck` enforces: a blob with two of one
  // sinner made the deck builder show one and the planner count both.
  const deck = uniqueDeck(ids(state.deck));
  const wanted = ids(state.wanted);
  const run = sanitizeRun(state.run);
  if (version < 7 && run.currentFloor > 1) run.giftStatus = withoutLegacyGot(run.giftStatus, wanted);
  // Only the keys `partialize` writes come back. Spreading the blob through used to let any other
  // key — `lastFloor`, or one named like an action — reach `merge` and overwrite live state.
  return {
    deck,
    deployed: ids(state.deployed).filter((id) => deck.includes(id)),
    wanted,
    fusionGoal: sanitizeFusionGoal(state.fusionGoal, wanted),
    // Added in M130 without a version step: a blob from before simply has none.
    upgrades: sanitizeUpgrades(state.upgrades),
    run,
    // Added in M143 without a version step: a blob from before has none.
    runSnapshot: sanitizeRunSnapshot(state.runSnapshot),
    ui: sanitizeUi(state.ui),
    // At rehydrate the recipes are not known yet, so this prunes nothing; `adoptSeason` does it.
    options: withObservedIn(
      sanitizeOptions(state.options),
      wanted,
      sanitizeFusionGoal(state.fusionGoal, wanted),
    ),
    lang: state.lang === 'en' ? 'en' : 'ko',
    dark: typeof state.dark === 'boolean' ? state.dark : prefersDark(),
    season: typeof state.season === 'number' && Number.isFinite(state.season) ? state.season : undefined,
  };
}

function withObservedIn(options: PlanOptions, wanted: number[], fusionGoal: FusionGoalMap): PlanOptions {
  /*
   * Without the season's recipes the question cannot be answered, and guessing drops the legal
   * answer: a pin on a fusion goal's ingredient looks exactly like a stale one. This is the state
   * a rehydrate and a share link both arrive in — both run before the data lands — so they defer,
   * and `adoptSeason` (which always follows a load, tree in hand) prunes for them.
   */
  if (recipeTree.size === 0) return options;
  const collected = collectedGifts(wanted, fusionGoal);
  const observedGifts = options.observedGifts.filter((id) => collected.has(id));
  return observedGifts.length === options.observedGifts.length ? options : { ...options, observedGifts };
}

/**
 * One identity per sinner, at most twelve, in the order given. An id that cannot be an identity at
 * all — not a positive integer, or one whose sinner digits are not 1..12 — is dropped here, on every
 * way in; an id shaped right that the data does not know goes in `adoptSeason`, which has the data.
 */
function uniqueDeck(ids: number[]): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const id of ids) {
    if (!Number.isInteger(id) || id <= 0) continue;
    const sinner = sinnerOf(id);
    if (sinner < 1 || sinner > SINNER_COUNT || seen.has(sinner)) continue;
    seen.add(sinner);
    out.push(id);
  }
  return out.slice(0, SINNER_COUNT);
}

export const useApp = create<AppState>()(
  persist(
    (set, get) => ({
      deck: [],
      deployed: [],
      wanted: [],
      options: appDefaultOptions(),
      fusionGoal: {},
      upgrades: {},
      run: emptyRun(),
      runSnapshot: null,
      ui: defaultUi(),
      lang: 'ko',
      dark: prefersDark(),
      season: undefined,
      lastFloor: MAX_FLOOR_EVER,

      setDeckSlot: (sinnerId, identityId, autoDeployUpTo = 0) =>
        set((state) => {
          const index = state.deck.findIndex((id) => sinnerOf(id) === sinnerId);
          const previous = index >= 0 ? state.deck[index]! : null;
          let deck: number[];
          if (identityId === null) deck = state.deck.filter((id) => sinnerOf(id) !== sinnerId);
          else if (index >= 0) deck = state.deck.map((id, i) => (i === index ? identityId : id));
          else deck = [...state.deck, identityId].slice(0, SINNER_COUNT);
          // A replaced identity keeps its deployed seat; a cleared one gives it up.
          let deployed = state.deployed
            .map((id) => (id === previous && identityId !== null ? identityId : id))
            .filter((id) => deck.includes(id));
          if (identityId !== null && previous === null && deployed.length < autoDeployUpTo) {
            deployed = deck.filter((id) => id === identityId || deployed.includes(id));
          }
          return { deck, deployed };
        }),

      setDeck: (deck, deployedDefault, deployed) =>
        set(() => {
          const next = uniqueDeck(deck);
          const given = deployed ? [...new Set(deployed)].filter((id) => next.includes(id)) : [];
          return { deck: next, deployed: given.length > 0 ? given : next.slice(0, deployedDefault) };
        }),

      clearDeck: () => set({ deck: [], deployed: [] }),

      toggleDeployed: (identityId, max) =>
        set((state) => {
          if (!state.deck.includes(identityId)) return {};
          const has = state.deployed.includes(identityId);
          if (!has && state.deployed.length >= max) return {};
          const deployed = has
            ? state.deployed.filter((id) => id !== identityId)
            : state.deck.filter((id) => id === identityId || state.deployed.includes(id));
          return { deployed };
        }),

      toggleWanted: (giftId, dropWithIt = []) =>
        set((state) => {
          // A 잔영 is held always and never a goal (M152); one already in the list can still go.
          if (materialIds.has(giftId) && !state.wanted.includes(giftId)) return {};
          // Kept in the order things were picked, not by id: that order is what the selection tray
          // shows by default and what a shared link hands the next person. The planner sorts the
          // goals itself (`expandRequirements`), so the route does not depend on it.
          const wanted = state.wanted.includes(giftId)
            ? state.wanted.filter((id) => id !== giftId)
            : [...state.wanted.filter((id) => !dropWithIt.includes(id)), giftId];
          const fusionGoal = sanitizeFusionGoal(state.fusionGoal, wanted);
          return {
            wanted,
            fusionGoal,
            options: withObservedIn(state.options, wanted, fusionGoal),
            run: withRunFor(state.run, wanted, fusionGoal),
          };
        }),

      removeWanted: (giftId) =>
        set((state) => {
          const wanted = state.wanted.filter((id) => id !== giftId);
          const fusionGoal = sanitizeFusionGoal(state.fusionGoal, wanted);
          return {
            wanted,
            fusionGoal,
            options: withObservedIn(state.options, wanted, fusionGoal),
            run: withRunFor(state.run, wanted, fusionGoal),
          };
        }),

      clearWanted: () =>
        set((state) => ({
          wanted: [],
          fusionGoal: {},
          options: { ...state.options, observedGifts: [] },
          run: withRunFor(state.run, [], {}),
        })),

      setFusionGoal: (giftId, goal) =>
        set((state) => {
          if (!state.wanted.includes(giftId)) return {};
          const next = { ...state.fusionGoal };
          if (goal === 'resultOnly') next[giftId] = 'resultOnly';
          else delete next[giftId];
          // 「재료는 목표가 아님」 takes the ingredients out of the plan, so a pin on one has nothing
          // left to buy — the same prune a dropped goal gets.
          return { fusionGoal: next, options: withObservedIn(state.options, state.wanted, next) };
        }),

      setUpgrade: (giftId, level) =>
        set((state) => {
          if (!Number.isInteger(giftId) || (state.upgrades[giftId] ?? 0) === level) return {};
          const upgrades = { ...state.upgrades };
          if (level === 0) delete upgrades[giftId];
          else upgrades[giftId] = level;
          return { upgrades };
        }),

      visitPack: (packId, floor, settle) =>
        set((state) => {
          if (!Number.isInteger(floor) || floor < 1 || floor > state.lastFloor) return {};
          const visits = withoutPack(state.run.visits, packId);
          visits[floor] = packId;
          return {
            run: {
              ...state.run,
              visits,
              ...moveFrontier(state.run, Math.max(state.run.currentFloor, floor + 1), settle),
            },
          };
        }),
      unvisitPack: (packId, opts) =>
        set((state) => {
          const entry = Object.entries(state.run.visits).find(([, id]) => id === packId);
          if (!entry) return {};
          const floor = Number(entry[0]);
          const visits = withoutPack(state.run.visits, packId);
          // The last decided floor becomes undecided again; an older one turns into a skip.
          const currentFloor = floor === state.run.currentFloor - 1 ? floor : state.run.currentFloor;
          const moved = moveFrontier(state.run, currentFloor);
          const giftStatus = { ...moved.giftStatus };
          // A pack's own drops are cleared with its entry — but not a gift the run start already
          // put in hand (150 of the 171 pack-exclusive gifts are observable, so the overlap is
          // ordinary). `moveFrontier` holds the same line for statuses the player set by hand.
          const fromStart = new Set(moved.startGifts);
          for (const id of opts?.reset ?? []) if (!fromStart.has(id)) delete giftStatus[id];
          return {
            run: {
              ...state.run,
              visits,
              ...moved,
              stageFloor: Math.min(state.run.stageFloor, currentFloor),
              giftStatus,
            },
          };
        }),
      nextFloor: (settle) =>
        set((state) => {
          const { run } = state;
          // Only a run that is over *and* holds nothing left to settle on the last floor is done.
          // An entry made on the last floor pushes the frontier past it while that floor is still
          // on stage, and it has to settle its misses before the run can close.
          if (
            run.currentFloor >= runDoneFloor(state.lastFloor) &&
            run.stageFloor >= state.lastFloor &&
            run.visits[run.stageFloor] === undefined
          )
            return {};
          const skipping = run.stageFloor === run.currentFloor;
          const currentFloor = skipping ? run.currentFloor + 1 : run.currentFloor;
          // Never past the frontier — which is the done floor once the last floor is decided, so
          // the final 「다음 층」 lands on the done card whether that floor was entered or skipped.
          const stageFloor = Math.min(currentFloor, run.stageFloor + 1);
          return { run: { ...run, stageFloor, ...moveFrontier(run, currentFloor, settle) } };
        }),
      setStageFloor: (floor, settle) =>
        set((state) => {
          if (!Number.isInteger(floor)) return {};
          const { run } = state;
          const stageFloor = Math.min(state.lastFloor, run.currentFloor, Math.max(1, floor));
          // A skip right before the frontier holds no record, so stepping back onto it takes it back.
          const currentFloor =
            stageFloor === run.currentFloor - 1 && run.visits[stageFloor] === undefined
              ? stageFloor
              : run.currentFloor;
          // Walking forward off a floor settles it, exactly as 「다음 층」 does; walking back never does.
          return {
            run: {
              ...run,
              stageFloor,
              ...moveFrontier(run, currentFloor, stageFloor > run.stageFloor ? settle : undefined),
            },
          };
        }),
      // The run thrown away was the one the snapshot led up to: nothing is left to go back from.
      resetRun: () => set({ run: emptyRun(), runSnapshot: null }),
      beginRun: (mode) =>
        set((state) => {
          if (mode === 'continue') return {};
          if (!runHasProgress(state.run)) {
            return state.runSnapshot ? {} : { runSnapshot: snapshotOf(state.run, state.options) };
          }
          return { runSnapshot: snapshotOf(state.run, state.options), run: emptyRun() };
        }),
      rollbackRun: () => {
        const { runSnapshot: snapshot, run } = get();
        // A run the screen reader did not start (M158): its beginning is an empty run, and the pins
        // from before it are unknown, so they stay as they are.
        if (!snapshot) {
          if (!runHasProgress(run)) return false;
          set({ run: emptyRun() });
          return true;
        }
        set((state) => {
          const options: PlanOptions = { ...state.options, observedGifts: [...snapshot.observedGifts] };
          if (snapshot.observationSlots === undefined) delete options.observationSlots;
          else options.observationSlots = snapshot.observationSlots;
          // The goals may have changed since: pins and misses follow the goals as they are now.
          return {
            run: withRunFor(snapshot.run, state.wanted, state.fusionGoal),
            options: withObservedIn(options, state.wanted, state.fusionGoal),
            runSnapshot: null,
          };
        });
        return true;
      },
      markStartDone: (done = true) =>
        set((state) => {
          if ((state.run.startDone === true) === done) return {};
          const run = { ...state.run };
          if (done) run.startDone = true;
          else {
            delete run.startDone;
            // A reopened start is decided again; its record goes with it (statuses stay).
            if (run.currentFloor === 1) run.startGifts = [];
          }
          return { run };
        }),
      recordObserved: (giftId, limits) =>
        set((state) => {
          const { run, options } = state;
          const spent = run.currentFloor === 1 && run.giftStatus[giftId] === 'got';
          if (
            options.observedGifts.includes(giftId) ||
            (observationClosed(run) && !spent) ||
            options.observedGifts.length >= limits.max ||
            !collectedGifts(state.wanted, state.fusionGoal).has(giftId) ||
            !limits.observable(giftId)
          )
            return {};
          return { options: { ...options, observedGifts: [...options.observedGifts, giftId] } };
        }),
      confirmStart: ({ got, dropped, observed }, limits) => {
        const { run } = get();
        if (run.currentFloor !== 1 || run.startDone) return;
        set((state) => {
          const giftStatus = { ...state.run.giftStatus };
          for (const id of dropped) if (giftStatus[id] === 'got') delete giftStatus[id];
          for (const id of got) giftStatus[id] = 'got';
          // A new pin follows `recordObserved`'s rules (a free slot, an observable gift the route
          // collects) — the gift is in hand now, which is what makes it a spent observation.
          const observedGifts = [...state.options.observedGifts];
          const collected = collectedGifts(state.wanted, state.fusionGoal);
          for (const id of observed) {
            if (observedGifts.includes(id) || !got.includes(id)) continue;
            if (observedGifts.length >= limits.max || !collected.has(id) || !limits.observable(id)) continue;
            observedGifts.push(id);
          }
          return { run: { ...state.run, giftStatus }, options: { ...state.options, observedGifts } };
        });
        get().settleStart();
      },
      settleStart: (got = []) => {
        const { run, options } = get();
        if (run.currentFloor !== 1 || run.startDone) return [];
        const giftStatus = { ...run.giftStatus };
        for (const id of got) giftStatus[id] = 'got';
        const collected = new Set(
          Object.entries(giftStatus)
            .filter(([, status]) => status === 'got')
            .map(([id]) => Number(id)),
        );
        const unpinned = options.observedGifts.filter((id) => !collected.has(id));
        set({
          run: { ...run, giftStatus, startGifts: [...collected], startDone: true },
          ...(unpinned.length > 0
            ? {
                options: {
                  ...options,
                  observedGifts: options.observedGifts.filter((id) => collected.has(id)),
                },
              }
            : {}),
        });
        return unpinned;
      },
      captureLive: false,
      setCaptureLive: (live) => set((state) => (state.captureLive === live ? {} : { captureLive: live })),
      setGiftStatus: (giftId, status) =>
        set((state) => {
          const giftStatus = { ...state.run.giftStatus };
          if (status === null) delete giftStatus[giftId];
          else giftStatus[giftId] = status;
          return { run: { ...state.run, giftStatus } };
        }),
      setCollectRest: (giftId, on) =>
        set((state) => {
          if (!state.wanted.includes(giftId)) return {};
          const rest = (state.run.collectRest ?? []).filter((id) => id !== giftId);
          const run = { ...state.run, collectRest: on ? [...rest, giftId] : rest };
          if (!on || state.fusionGoal[giftId] !== 'resultOnly') return { run };
          const fusionGoal = { ...state.fusionGoal };
          delete fusionGoal[giftId];
          return { run, fusionGoal, options: withObservedIn(state.options, state.wanted, fusionGoal) };
        }),

      toggleObserved: (giftId, limits) =>
        set((state) => {
          const has = state.options.observedGifts.includes(giftId);
          // A goal, or an ingredient a fusion goal has to consume — the shop hands those over too,
          // and observing one is often the only way a fusion finishes.
          const collected = collectedGifts(state.wanted, state.fusionGoal);
          // Once floor 1 is left the starlight is spent: a new pin would make the plan count a
          // gift as secured that the run can no longer observe. Taking a pin off stays allowed.
          if (
            !has &&
            (observationClosed(state.run) ||
              state.options.observedGifts.length >= limits.max ||
              !collected.has(giftId) ||
              !limits.observable(giftId))
          )
            return {};
          const observedGifts = has
            ? state.options.observedGifts.filter((id) => id !== giftId)
            : [...state.options.observedGifts, giftId];
          return { options: { ...state.options, observedGifts } };
        }),

      setOptions: (patch) => set((state) => ({ options: { ...state.options, ...patch } })),
      resetAll: (deck, deployedDefault) => {
        const next = uniqueDeck(deck);
        set({
          deck: next,
          deployed: next.slice(0, deployedDefault),
          wanted: [],
          fusionGoal: {},
          upgrades: {},
          options: appDefaultOptions(),
          run: emptyRun(),
          runSnapshot: null,
        });
      },
      setUi: (patch) => set((state) => ({ ui: sanitizeUi({ ...state.ui, ...patch }) })),
      setLang: (lang) => set({ lang }),
      toggleDark: () => set((state) => ({ dark: !state.dark })),

      adoptSeason: (info) => {
        const { season, lastFloor, giftIds, packIds, recipes, upgradeLevels } = info;
        recipeTree = recipes;
        materialIds = info.materials ?? new Set();
        adoptedSeason = info;
        const state = get();
        // A run saved while another season was open walked that season's floors and packs.
        const otherSeason = state.season !== undefined && state.season !== season;
        // A 잔영 goal goes too (M152), without a word: it is held always, so nothing was lost.
        const known = state.wanted.filter((id) => giftIds.has(id));
        const wanted = known.filter((id) => !materialIds.has(id));
        // A pin is a decision about what the route collects: one left on a gift that is neither a
        // goal nor a goal's ingredient would spend observation budget and then vanish without a
        // word at the next toggle. This is also where a rehydrated blob's pins are first judged —
        // `sanitizePersisted` cannot, having no recipes yet.
        const collected = collectedGifts(wanted, sanitizeFusionGoal(state.fusionGoal, wanted));
        const observed = (state.options.observedGifts ?? []).filter(
          (id) => giftIds.has(id) && collected.has(id),
        );
        const droppedGifts = state.wanted.length - known.length;
        // A run recorded on a longer season cannot be replayed on a shorter one; one that still
        // fits keeps only the packs and gifts this season can draw, so no nameless row survives.
        // The done floor is one past the last (that is where the done card lives), so a finished
        // run stands at `runDoneFloor` on both counts and is kept; only a run that walked further
        // than this season goes is gone. Testing the stage against `lastFloor` wiped every finished
        // run on the next load.
        const fit = (r: RunState): RunState =>
          r.currentFloor > runDoneFloor(lastFloor) || r.stageFloor > runDoneFloor(lastFloor)
            ? emptyRun()
            : {
                ...r,
                visits: Object.fromEntries(
                  Object.entries(r.visits).filter(([, packId]) => packIds.has(packId)),
                ),
                giftStatus: Object.fromEntries(
                  Object.entries(r.giftStatus).filter(
                    ([id]) => giftIds.has(Number(id)) && !materialIds.has(Number(id)),
                  ),
                ),
                startGifts: r.startGifts.filter((id) => giftIds.has(id)),
                ...(r.collectRest ? { collectRest: r.collectRest.filter((id) => giftIds.has(id)) } : {}),
              };
        const run = otherSeason ? emptyRun() : fit(state.run);
        // The snapshot to go back to (M143) holds a run too, and the same ids.
        const snapshot = otherSeason ? null : state.runSnapshot;
        const runSnapshot = snapshot
          ? {
              ...snapshot,
              run: fit(snapshot.run),
              observedGifts: snapshot.observedGifts.filter((id) => giftIds.has(id)),
            }
          : null;
        // A step the gift does not have in this season (or a gift it does not ship) cannot be drawn.
        const upgrades: GiftUpgradeMap = {};
        for (const [id, level] of Object.entries(state.upgrades)) {
          if (level <= (upgradeLevels.get(Number(id)) ?? 0)) upgrades[Number(id)] = level;
        }
        const deck = info.identityIds ? state.deck.filter((id) => info.identityIds!.has(id)) : state.deck;
        set({
          season,
          lastFloor,
          ...(deck.length === state.deck.length
            ? {}
            : { deck, deployed: state.deployed.filter((id) => deck.includes(id)) }),
          run,
          runSnapshot,
          wanted,
          upgrades,
          fusionGoal: sanitizeFusionGoal(state.fusionGoal, wanted),
          options: {
            ...state.options,
            observedGifts: observed,
            preferredPacks: [],
            bannedPacks: [],
            pinnedPacks: {},
          },
        });
        return { gifts: droppedGifts };
      },

      // A link is someone's plan, not this device's run: the run record starts over with it.
      applyShared: (shared) => {
        const deck = uniqueDeck(shared.deck);
        const wanted = [...new Set(shared.wanted)];
        // The link's season is not taken (M145): the app plans in the season it loaded.
        set({
          deck,
          deployed: [...new Set(shared.deployed)].filter((id) => deck.includes(id)),
          wanted,
          fusionGoal: sanitizeFusionGoal(shared.fusionGoal, wanted),
          // The link decides the steps of its goals; this device's choices on other gifts stay.
          upgrades: withSharedUpgrades(get().upgrades, wanted, shared.upgrades ?? {}),
          // Pins follow the same rule priorities and fusion goals do: only a goal can be observed.
          // A link that carried a pin for something else used to spend observation budget on it and
          // then drop it without a word the next time any gift was toggled.
          options: withObservedIn(
            sanitizeOptions(shared.options),
            wanted,
            sanitizeFusionGoal(shared.fusionGoal, wanted),
          ),
          run: emptyRun(),
          runSnapshot: null,
        });
        // Goals the loaded season has never heard of (an MD7 link) go now, counted.
        return adoptedSeason ? get().adoptSeason(adoptedSeason) : { gifts: 0 };
      },
    }),
    {
      name: PERSIST_KEY,
      version: PERSIST_VERSION,
      migrate: (persisted, version) => sanitizePersisted(persisted, version),
      // zustand only calls `migrate` when the stored version differs from ours, so a blob that
      // claims the current version reaches state unchecked — and that is the common shape of
      // corruption (a `setItem` truncated by a full quota, a partial eviction by Safari's ITP).
      // Merging through the same sanitizer makes the pass unconditional; it runs *before* the
      // merge so a bad value never touches state, which `onRehydrateStorage` could not promise.
      merge: (persisted, current) => ({ ...current, ...sanitizePersisted(persisted, PERSIST_VERSION) }),
      partialize: (state) => ({
        deck: state.deck,
        deployed: state.deployed,
        wanted: state.wanted,
        fusionGoal: state.fusionGoal,
        upgrades: state.upgrades,
        run: state.run,
        runSnapshot: state.runSnapshot,
        ui: state.ui,
        options: state.options,
        lang: state.lang,
        dark: state.dark,
        season: state.season,
      }),
    },
  ),
);

// ---------------------------------------------------------------------------
// URL sharing
// ---------------------------------------------------------------------------

const HASH_PREFIX = '#s=';

/** A link's `up` key: the goals' enhancement steps, left out when no goal has one. */
function upgradesForLink(
  upgrades: GiftUpgradeMap | undefined,
  wanted: readonly number[],
): { up?: GiftUpgradeMap } {
  const up = sanitizeUpgrades(upgrades ?? {}, wanted);
  return Object.keys(up).length > 0 ? { up } : {};
}

/** This device's choices with the link's goals set to the link's steps (none = not enhanced). */
function withSharedUpgrades(
  mine: GiftUpgradeMap,
  wanted: readonly number[],
  linked: GiftUpgradeMap,
): GiftUpgradeMap {
  const out = { ...mine };
  for (const id of wanted) {
    const level = linked[id];
    if (level === 1 || level === 2) out[id] = level;
    else delete out[id];
  }
  return out;
}

export function encodeShared(state: SharedState): string {
  const payload = JSON.stringify({
    v: 5,
    ...(state.season === undefined ? {} : { s: state.season }),
    deck: state.deck,
    deployed: state.deployed,
    wanted: state.wanted,
    fusionGoal: state.fusionGoal ?? {},
    // The goals' steps only, and only when there are any — older readers ignore the key.
    ...upgradesForLink(state.upgrades, state.wanted),
    options: state.options,
  });
  return HASH_PREFIX + lzString.compressToEncodedURIComponent(payload);
}

/**
 * The plan a link carries, read off the store's state: the same keys whichever surface builds the
 * link (the header's 「공유」, the feedback report), so the two can never disagree about it.
 */
export function sharedStateOf(state: SharedState): SharedState {
  return {
    ...(state.season === undefined ? {} : { season: state.season }),
    deck: state.deck,
    deployed: state.deployed,
    wanted: state.wanted,
    fusionGoal: state.fusionGoal,
    upgrades: state.upgrades,
    options: state.options,
  };
}

/** The address that opens `shared` on this page: its origin and path (Pages' base), then the hash. */
export function shareUrlOf(shared: SharedState): string {
  return `${window.location.origin}${window.location.pathname}${encodeShared(shared)}`;
}

export function decodeShared(hash: string): SharedState | null {
  if (!hash.startsWith(HASH_PREFIX)) return null;
  try {
    // lz-string does not merely return nothing for a payload it cannot read — on some strings it
    // throws, which used to escape this function, blow up the effect that consumes the hash and
    // leave the reader with a blank page instead of a mangled link.
    const json = lzString.decompressFromEncodedURIComponent(hash.slice(HASH_PREFIX.length));
    if (!json) return null;
    // `s` (the season, v5) is not read: the app plans every link in the season it loaded (M145).
    const parsed = JSON.parse(json) as Partial<SharedState> & { up?: unknown };
    if (!Array.isArray(parsed.deck) || !Array.isArray(parsed.wanted)) return null;
    const deck = uniqueDeck(parsed.deck.filter((n): n is number => typeof n === 'number'));
    // v1 links carried no deployed list: the first six fought.
    const deployed = Array.isArray(parsed.deployed)
      ? [...new Set(parsed.deployed.filter((n): n is number => typeof n === 'number' && deck.includes(n)))]
      : deck.slice(0, LEGACY_DEPLOYED);
    const wanted = [...new Set(parsed.wanted.filter((n): n is number => typeof n === 'number'))];
    return {
      deck,
      deployed,
      wanted,
      fusionGoal: sanitizeFusionGoal(parsed.fusionGoal, wanted),
      upgrades: sanitizeUpgrades(parsed.up, wanted),
      options: sanitizeOptions(parsed.options),
    };
  } catch {
    return null;
  }
}
