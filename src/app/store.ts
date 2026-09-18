import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import lzString from 'lz-string';
import type { PlanOptions } from '../core/types.ts';
import { defaultOptions } from '../core/index.ts';
import type { Lang } from './i18n.ts';
import type { FusionGoalMap, Priority, PriorityMap, RunState } from './lib/plan-input.ts';

export type LeftTab = 'deck' | 'gifts';
export type RightTab = 'plan' | 'goals' | 'tracker';

/** Which side panels are open on a desktop layout, and which tab each shows. Device-only. */
export interface UiState {
  leftOpen: boolean;
  leftTab: LeftTab;
  rightOpen: boolean;
  rightTab: RightTab;
  /** Desktop panel widths in px, dragged by the divider between panel and stage. */
  leftWidth: number;
  rightWidth: number;
}

/** How wide a side panel may be dragged: narrow enough to read, never eating the whole stage. */
export const PANEL_WIDTH = { min: 260, max: 560, default: 336 } as const;

export interface SharedState {
  /**
   * The Mirror Dungeon the goals belong to. A season replaces the gift pool, so a link opened in
   * another season would resolve nothing; absent means a link made before seasons existed, which
   * can only have meant 7.
   */
  season?: number;
  /** Identity ids in formation order (at most 12, one per sinner). */
  deck: number[];
  /** Who fights, as a subset of `deck`; the order comes from the deck. */
  deployed: number[];
  wanted: number[];
  /** Per-gift priority; gifts absent here are planned as best-effort. */
  priority: PriorityMap;
  options: PlanOptions;
  /** Fusion results whose ingredients are not goals of their own. Absent = ingredients count too. */
  fusionGoal?: FusionGoalMap;
}

interface AppState extends SharedState {
  fusionGoal: FusionGoalMap;
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
  ui: UiState;
  lang: Lang;
  dark: boolean;

  /** Fill a sinner's slot; a newcomer is deployed while fewer than `autoDeployUpTo` fight. */
  setDeckSlot: (sinnerId: number, identityId: number | null, autoDeployUpTo?: number) => void;
  setDeck: (deck: number[], deployedDefault: number) => void;
  clearDeck: () => void;
  toggleDeployed: (identityId: number, max: number) => void;
  toggleWanted: (giftId: number, dropWithIt?: number[]) => void;
  removeWanted: (giftId: number) => void;
  clearWanted: () => void;
  /** Pin or unpin a wanted gift for 기프트 관측; at most `max` pins. */
  /** Pin or unpin a wanted gift for 기프트 관측; a pin needs a free slot and an observable gift. */
  toggleObserved: (giftId: number, limits: ObserveLimits) => void;
  /** 반드시 / 보통 for a wanted gift; giving a gift up is `removeWanted`. */
  setPriority: (giftId: number, priority: Priority) => void;
  /** Pack-level choices: include somewhere (the planner picks the floor), give up, or neither. */
  preferPack: (packId: number) => void;
  banPack: (packId: number) => void;
  restorePack: (packId: number) => void;
  setFusionGoal: (giftId: number, goal: 'resultOnly' | 'withIngredients') => void;
  /**
   * Record that `packId` was entered on `floor`; a pack is visited once, so an earlier floor for it
   * is replaced. `settle.got` marks gifts collected in the same update (the start-of-run gifts).
   */
  visitPack: (packId: number, floor: number, settle?: { got?: number[] }) => void;
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
  setGiftStatus: (giftId: number, status: 'got' | 'failed' | null) => void;
  setOptions: (patch: Partial<PlanOptions>) => void;
  /** The header's 초기화: deck back to `deck` (the LCB default), no items, default options, no run. `ui`, `lang`, `dark` stay. */
  resetAll: (deck: number[], deployedDefault: number) => void;
  setUi: (patch: Partial<UiState>) => void;
  setLang: (lang: Lang) => void;
  toggleDark: () => void;
  /** Choose the season to plan. The run belongs to the old season's floors, so it is dropped. */
  setSeason: (season: number) => void;
  /**
   * Take on the season that just loaded and drop what it has never heard of.
   *
   * A gift or pack id this season does not ship cannot be drawn, named or planned, so keeping it
   * would leave a blank in the list. One this season ships but cannot award is a different thing
   * and stays: the planner already explains it as 미해결. Returns what was dropped so the app can
   * say so rather than letting choices disappear quietly.
   */
  adoptSeason: (info: { season: number; lastFloor: number; giftIds: Set<number>; packIds: Set<number> }) => {
    gifts: number;
    packs: number;
  };
  applyShared: (shared: SharedState) => void;
}

const SINNER_COUNT = 12;
const LEGACY_DEPLOYED = 6;
/** Every share link made before links carried a season was a Mirror Dungeon 7 plan. */
const LEGACY_SEASON = 7;

/** Identity ids are 1SSNN, so the sinner a slot belongs to is derivable from the id. */
export function sinnerOf(identityId: number): number {
  return Math.floor(identityId / 100) % 100;
}

function prefersDark(): boolean {
  return typeof window === 'undefined' || typeof window.matchMedia !== 'function'
    ? true
    : window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/**
 * The most floors any Mirror Dungeon has opened.
 *
 * This is a bound for saved and shared state, not a season's floor count: how far *this* season
 * goes comes from `rules.floors` and reaches the store as `lastFloor` when the data loads. A season
 * that opens only 1~5 is shorter; none has ever been longer.
 */
export const MAX_FLOOR_EVER = 15;

/** The planner's defaults with the app's fixed floor range applied. */
export function appDefaultOptions(): PlanOptions {
  return { ...defaultOptions(), lastFloor: MAX_FLOOR_EVER, hardFromFloor: 1 };
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
  if ('deployed' in source) out.deployed = source.deployed;
  const observed = Array.isArray(out.observedGifts) ? out.observedGifts : [];
  out.observedGifts = [...new Set(observed.filter((n): n is number => typeof n === 'number'))];
  const ids = (value: unknown): number[] => (Array.isArray(value) ? [...new Set(value.filter((n): n is number => typeof n === 'number'))] : []);
  const bannedPacks = ids(out.bannedPacks);
  out.bannedPacks = bannedPacks;
  out.preferredPacks = ids(out.preferredPacks).filter((id) => !bannedPacks.includes(id));
  const pins: Record<number, number> = {};
  if (out.pinnedPacks && typeof out.pinnedPacks === 'object') {
    for (const [floor, packId] of Object.entries(out.pinnedPacks as Record<string, unknown>)) {
      if (Number.isInteger(Number(floor)) && typeof packId === 'number') pins[Number(floor)] = packId;
    }
  }
  out.pinnedPacks = pins;
  out.lastFloor = MAX_FLOOR_EVER;
  out.hardFromFloor = 1;
  // Run progress lives in the `run` slice, never in shared or saved options.
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

/** What a pin must satisfy: the slot limit and whether the gift can be observed at all. */
export interface ObserveLimits {
  max: number;
  observable: (giftId: number) => boolean;
}

export function emptyRun(): RunState {
  return { currentFloor: 1, stageFloor: 1, visits: {}, giftStatus: {}, startGifts: [] };
}

export function defaultUi(): UiState {
  return { leftOpen: true, leftTab: 'gifts', rightOpen: true, rightTab: 'plan', leftWidth: PANEL_WIDTH.default, rightWidth: PANEL_WIDTH.default };
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
  if (source.rightTab === 'plan' || source.rightTab === 'goals' || source.rightTab === 'tracker') out.rightTab = source.rightTab;
  out.leftWidth = clampPanelWidth(source.leftWidth);
  out.rightWidth = clampPanelWidth(source.rightWidth);
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
      if (!Number.isInteger(f) || f < 1 || f > MAX_FLOOR_EVER || typeof packId !== 'number' || seen.has(packId)) continue;
      seen.add(packId);
      out.visits[f] = packId;
    }
  }
  if (source.giftStatus && typeof source.giftStatus === 'object') {
    for (const [id, status] of Object.entries(source.giftStatus as Record<string, unknown>)) {
      if (Number.isInteger(Number(id)) && (status === 'got' || status === 'failed')) out.giftStatus[Number(id)] = status;
    }
  }
  const floor = typeof source.currentFloor === 'number' ? Math.round(source.currentFloor) : 1;
  out.currentFloor = Math.min(MAX_RUN_DONE_FLOOR, Math.max(1, floor, ...Object.keys(out.visits).map((f) => Number(f) + 1)));
  const stage = typeof source.stageFloor === 'number' ? Math.round(source.stageFloor) : out.currentFloor;
  // Up to the done floor, never past it: the stage stands one beyond the last floor when the run
  // is over, and that is where the done card lives.
  out.stageFloor = Math.min(MAX_RUN_DONE_FLOOR, out.currentFloor, Math.max(1, stage));
  // The start-of-run record only means something once floor 1 is behind, and only for gifts
  // still marked as collected.
  if (out.currentFloor > 1 && Array.isArray(source.startGifts)) {
    out.startGifts = [...new Set(source.startGifts.filter((id): id is number => Number.isInteger(id) && out.giftStatus[id as number] === 'got'))];
  }
  return out;
}

/**
 * Builds before M17 recorded the planner's recommended observations as collected on leaving
 * floor 1 and never took that back, so a saved run can carry a "got" ingredient nobody has. Dropping
 * every collected mark on a gift that is no goal makes the planner route for it again (a pack
 * already visited still supplies its own drops through the played floor), at the cost of tracker
 * marks on non-goal gifts, which the player can set again.
 */
export function withoutLegacyGot(giftStatus: RunState['giftStatus'], wanted: number[]): RunState['giftStatus'] {
  const out: RunState['giftStatus'] = {};
  for (const [id, status] of Object.entries(giftStatus)) {
    if (status === 'got' && !wanted.includes(Number(id))) continue;
    out[Number(id)] = status;
  }
  return out;
}

/**
 * Misses only ever land on goal gifts (`autoFailedFor` filters by the goal list), and only the
 * goals panel and the entered pack can take one back. So a gift dropped from the goals carrying a
 * 「실패」 becomes unreachable while `planInputFor` keeps handing it to the planner as
 * `unobtainableGifts` — a fusion that eats it stays unresolvable with nothing on screen to undo.
 * Collected marks are left alone: the tracker and the stage set those on non-goal gifts on purpose.
 */
export function withoutStaleFailures(giftStatus: RunState['giftStatus'], wanted: number[]): RunState['giftStatus'] {
  const stale = Object.entries(giftStatus).filter(([id, status]) => status === 'failed' && !wanted.includes(Number(id)));
  if (stale.length === 0) return giftStatus;
  const out = { ...giftStatus };
  for (const [id] of stale) delete out[Number(id)];
  return out;
}

/** The run with every unreachable miss dropped; the same object when nothing was stale. */
function withRunFor(run: RunState, wanted: number[]): RunState {
  const giftStatus = withoutStaleFailures(run.giftStatus, wanted);
  return giftStatus === run.giftStatus ? run : { ...run, giftStatus };
}

function withoutPack(visits: Record<number, number>, packId: number): Record<number, number> {
  const out: Record<number, number> = {};
  for (const [f, id] of Object.entries(visits)) if (id !== packId) out[Number(f)] = id;
  return out;
}

/**
 * Move the frontier. Leaving floor 1 is when `settle.got` — the start-of-run gifts — lands in hand
 * and is remembered; coming back to floor 1 takes that record out again (a status the player
 * changed by hand in the meantime is left alone).
 */
function moveFrontier(
  run: RunState,
  currentFloor: number,
  settle?: { got?: number[]; failed?: number[] },
): Pick<RunState, 'currentFloor' | 'giftStatus' | 'startGifts'> {
  let giftStatus = withStatus(run.giftStatus, settle);
  let startGifts = run.startGifts;
  if (run.currentFloor === 1 && currentFloor > 1) {
    startGifts = [...new Set(settle?.got ?? [])];
  } else if (run.currentFloor > 1 && currentFloor === 1) {
    giftStatus = { ...giftStatus };
    for (const id of run.startGifts) if (giftStatus[id] === 'got') delete giftStatus[id];
    startGifts = [];
  }
  return { currentFloor, giftStatus, startGifts };
}

function withStatus(giftStatus: RunState['giftStatus'], settle?: { got?: number[]; failed?: number[] }): RunState['giftStatus'] {
  if (!settle) return giftStatus;
  const next = { ...giftStatus };
  for (const id of settle.got ?? []) next[id] = 'got';
  // A miss never overrides what the player already recorded.
  for (const id of settle.failed ?? []) if (next[id] === undefined) next[id] = 'failed';
  return next;
}

/** Priorities only for the gifts in `wanted`, with the two non-default values. */
export function sanitizePriority(raw: unknown, wanted: number[]): PriorityMap {
  const out: PriorityMap = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const id = Number(key);
    if (!wanted.includes(id)) continue;
    if (value === 'must') out[id] = value;
  }
  return out;
}

function withoutGift(priority: PriorityMap, giftId: number): PriorityMap {
  if (!(giftId in priority)) return priority;
  const next = { ...priority };
  delete next[giftId];
  return next;
}

/** A pinned observation only makes sense for a wanted gift. */
function withObservedIn(options: PlanOptions, wanted: number[]): PlanOptions {
  const observedGifts = options.observedGifts.filter((id) => wanted.includes(id));
  return observedGifts.length === options.observedGifts.length ? options : { ...options, observedGifts };
}

function uniqueDeck(ids: number[]): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const id of ids) {
    const sinner = sinnerOf(id);
    if (seen.has(sinner)) continue;
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
      priority: {},
      options: appDefaultOptions(),
      fusionGoal: {},
      run: emptyRun(),
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

      setDeck: (deck, deployedDefault) =>
        set(() => {
          const next = uniqueDeck(deck);
          return { deck: next, deployed: next.slice(0, deployedDefault) };
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
          // Kept in the order things were picked, not by id: that order is what the selection tray
          // shows by default and what a shared link hands the next person. The planner sorts the
          // goals itself (`expandRequirements`), so the route does not depend on it.
          const wanted = state.wanted.includes(giftId)
            ? state.wanted.filter((id) => id !== giftId)
            : [...state.wanted.filter((id) => !dropWithIt.includes(id)), giftId];
          return {
            wanted,
            priority: sanitizePriority(state.priority, wanted),
            fusionGoal: sanitizeFusionGoal(state.fusionGoal, wanted),
            options: withObservedIn(state.options, wanted),
            run: withRunFor(state.run, wanted),
          };
        }),

      removeWanted: (giftId) =>
        set((state) => {
          const wanted = state.wanted.filter((id) => id !== giftId);
          return {
            wanted,
            priority: withoutGift(state.priority, giftId),
            fusionGoal: sanitizeFusionGoal(state.fusionGoal, wanted),
            options: withObservedIn(state.options, wanted),
            run: withRunFor(state.run, wanted),
          };
        }),

      clearWanted: () =>
        set((state) => ({ wanted: [], priority: {}, fusionGoal: {}, options: { ...state.options, observedGifts: [] }, run: withRunFor(state.run, []) })),

      setFusionGoal: (giftId, goal) =>
        set((state) => {
          if (!state.wanted.includes(giftId)) return {};
          const next = { ...state.fusionGoal };
          if (goal === 'resultOnly') next[giftId] = 'resultOnly';
          else delete next[giftId];
          return { fusionGoal: next };
        }),

      visitPack: (packId, floor, settle) =>
        set((state) => {
          if (!Number.isInteger(floor) || floor < 1 || floor > state.lastFloor) return {};
          const visits = withoutPack(state.run.visits, packId);
          visits[floor] = packId;
          return {
            run: { ...state.run, visits, ...moveFrontier(state.run, Math.max(state.run.currentFloor, floor + 1), settle) },
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
          return { run: { ...state.run, visits, ...moved, stageFloor: Math.min(state.run.stageFloor, currentFloor), giftStatus } };
        }),
      nextFloor: (settle) =>
        set((state) => {
          const { run } = state;
          // Only a run that is over *and* holds nothing left to settle on the last floor is done.
          // An entry made on the last floor pushes the frontier past it while that floor is still
          // on stage, and it has to settle its misses before the run can close.
          if (run.currentFloor >= runDoneFloor(state.lastFloor) && run.stageFloor >= state.lastFloor && run.visits[run.stageFloor] === undefined) return {};
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
          const currentFloor = stageFloor === run.currentFloor - 1 && run.visits[stageFloor] === undefined ? stageFloor : run.currentFloor;
          // Walking forward off a floor settles it, exactly as 「다음 층」 does; walking back never does.
          return { run: { ...run, stageFloor, ...moveFrontier(run, currentFloor, stageFloor > run.stageFloor ? settle : undefined) } };
        }),
      resetRun: () => set({ run: emptyRun() }),
      setGiftStatus: (giftId, status) =>
        set((state) => {
          const giftStatus = { ...state.run.giftStatus };
          if (status === null) delete giftStatus[giftId];
          else giftStatus[giftId] = status;
          return { run: { ...state.run, giftStatus } };
        }),

      setPriority: (giftId, priority) =>
        set((state) => {
          if (!state.wanted.includes(giftId)) return {};
          return { priority: priority === 'normal' ? withoutGift(state.priority, giftId) : { ...state.priority, [giftId]: priority } };
        }),

      preferPack: (packId) =>
        set((state) => ({
          options: {
            ...state.options,
            preferredPacks: [...new Set([...state.options.preferredPacks, packId])],
            bannedPacks: state.options.bannedPacks.filter((id) => id !== packId),
          },
        })),
      banPack: (packId) =>
        set((state) => ({
          options: {
            ...state.options,
            bannedPacks: [...new Set([...state.options.bannedPacks, packId])],
            preferredPacks: state.options.preferredPacks.filter((id) => id !== packId),
          },
        })),
      restorePack: (packId) =>
        set((state) => ({
          options: {
            ...state.options,
            bannedPacks: state.options.bannedPacks.filter((id) => id !== packId),
            preferredPacks: state.options.preferredPacks.filter((id) => id !== packId),
          },
        })),

      toggleObserved: (giftId, limits) =>
        set((state) => {
          const has = state.options.observedGifts.includes(giftId);
          if (!has && (state.options.observedGifts.length >= limits.max || !state.wanted.includes(giftId) || !limits.observable(giftId))) return {};
          const observedGifts = has
            ? state.options.observedGifts.filter((id) => id !== giftId)
            : [...state.options.observedGifts, giftId];
          return { options: { ...state.options, observedGifts } };
        }),

      setOptions: (patch) => set((state) => ({ options: { ...state.options, ...patch } })),
      resetAll: (deck, deployedDefault) => {
        const next = uniqueDeck(deck);
        set({ deck: next, deployed: next.slice(0, deployedDefault), wanted: [], priority: {}, fusionGoal: {}, options: appDefaultOptions(), run: emptyRun() });
      },
      setUi: (patch) => set((state) => ({ ui: sanitizeUi({ ...state.ui, ...patch }) })),
      setLang: (lang) => set({ lang }),
      toggleDark: () => set((state) => ({ dark: !state.dark })),

      setSeason: (season) =>
        set((state) => (state.season === season ? {} : { season, run: emptyRun() })),

      adoptSeason: ({ season, lastFloor, giftIds, packIds }) => {
        const state = get();
        const wanted = state.wanted.filter((id) => giftIds.has(id));
        // A pin is a decision about a goal, like a priority: one left on a gift that is no longer
        // wanted would spend observation budget and then vanish without a word at the next toggle.
        const observed = (state.options.observedGifts ?? []).filter((id) => giftIds.has(id) && wanted.includes(id));
        const preferredPacks = state.options.preferredPacks.filter((id) => packIds.has(id));
        const bannedPacks = state.options.bannedPacks.filter((id) => packIds.has(id));
        const pinnedPacks = Object.fromEntries(
          Object.entries(state.options.pinnedPacks).filter(
            ([floor, packId]) => packIds.has(packId) && Number(floor) <= lastFloor,
          ),
        );
        const droppedGifts = state.wanted.length - wanted.length;
        const droppedPacks =
          state.options.preferredPacks.length -
          preferredPacks.length +
          (state.options.bannedPacks.length - bannedPacks.length) +
          (Object.keys(state.options.pinnedPacks).length - Object.keys(pinnedPacks).length);
        // A run recorded on a longer season cannot be replayed on a shorter one; one that still
        // fits keeps only the packs and gifts this season can draw, so no nameless row survives.
        const run =
          state.run.currentFloor > lastFloor + 1 || state.run.stageFloor > lastFloor
            ? emptyRun()
            : {
                ...state.run,
                visits: Object.fromEntries(Object.entries(state.run.visits).filter(([, packId]) => packIds.has(packId))),
                giftStatus: Object.fromEntries(Object.entries(state.run.giftStatus).filter(([id]) => giftIds.has(Number(id)))),
                startGifts: state.run.startGifts.filter((id) => giftIds.has(id)),
              };
        set({
          season,
          lastFloor,
          run,
          wanted,
          priority: sanitizePriority(state.priority, wanted),
          fusionGoal: sanitizeFusionGoal(state.fusionGoal, wanted),
          options: { ...state.options, observedGifts: observed, preferredPacks, bannedPacks, pinnedPacks },
        });
        return { gifts: droppedGifts, packs: droppedPacks };
      },

      // A link is someone's plan, not this device's run: the run record starts over with it.
      applyShared: (shared) =>
        set({
          ...(shared.season === undefined ? {} : { season: shared.season }),
          deck: shared.deck,
          deployed: shared.deployed.filter((id) => shared.deck.includes(id)),
          wanted: shared.wanted,
          priority: sanitizePriority(shared.priority, shared.wanted),
          fusionGoal: sanitizeFusionGoal(shared.fusionGoal, shared.wanted),
          // Pins follow the same rule priorities and fusion goals do: only a goal can be observed.
          // A link that carried a pin for something else used to spend observation budget on it and
          // then drop it without a word the next time any gift was toggled.
          options: withObservedIn(sanitizeOptions(shared.options), shared.wanted),
          run: emptyRun(),
        }),
    }),
    {
      name: 'md-route-planner',
      version: 7,
      migrate: (persisted, version) => {
        let state = (persisted ?? {}) as Partial<AppState> & { step?: unknown };
        if (version < 2) {
          const deck = Array.isArray(state.deck) ? state.deck : [];
          state = { ...state, deck, deployed: deck.slice(0, LEGACY_DEPLOYED) };
        }
        // v3 replaced the observation count with pinned observation gifts; v4 fixed the floor
        // range at 15 and added per-gift priorities; v5 added fusion goals and the run in
        // progress; v6 dropped the step flow (the run is always on) and added the panel state;
        // v7 (M17) records the start-of-run gifts so returning to floor 1 takes them back — a run
        // saved by an earlier build may still hold a recommended observation as collected.
        const wanted = Array.isArray(state.wanted) ? state.wanted : [];
        const { step: _step, ...rest } = state;
        void _step;
        const run = sanitizeRun(state.run);
        if (version < 7 && run.currentFloor > 1) run.giftStatus = withoutLegacyGot(run.giftStatus, wanted);
        return {
          ...rest,
          wanted,
          priority: sanitizePriority(state.priority, wanted),
          fusionGoal: sanitizeFusionGoal(state.fusionGoal, wanted),
          run,
          ui: sanitizeUi(state.ui),
          options: withObservedIn(sanitizeOptions(state.options), wanted),
        } as AppState;
      },
      partialize: (state) => ({
        deck: state.deck,
        deployed: state.deployed,
        wanted: state.wanted,
        priority: state.priority,
        fusionGoal: state.fusionGoal,
        run: state.run,
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

export function encodeShared(state: SharedState): string {
  const payload = JSON.stringify({
    v: 5,
    ...(state.season === undefined ? {} : { s: state.season }),
    deck: state.deck,
    deployed: state.deployed,
    wanted: state.wanted,
    priority: state.priority,
    fusionGoal: state.fusionGoal ?? {},
    options: state.options,
  });
  return HASH_PREFIX + lzString.compressToEncodedURIComponent(payload);
}

export function decodeShared(hash: string): SharedState | null {
  if (!hash.startsWith(HASH_PREFIX)) return null;
  try {
    // lz-string does not merely return nothing for a payload it cannot read — on some strings it
    // throws, which used to escape this function, blow up the effect that consumes the hash and
    // leave the reader with a blank page instead of a mangled link.
    const json = lzString.decompressFromEncodedURIComponent(hash.slice(HASH_PREFIX.length));
    if (!json) return null;
    const parsed = JSON.parse(json) as Partial<SharedState> & { v?: number; s?: unknown };
    if (!Array.isArray(parsed.deck) || !Array.isArray(parsed.wanted)) return null;
    // v5 carries the season. Links before it could only have been Mirror Dungeon 7, and the `v`
    // field — written since v1 and never read until now — is what says so.
    const season =
      typeof parsed.s === 'number' && Number.isInteger(parsed.s)
        ? parsed.s
        : (parsed.v ?? 0) < 5
          ? LEGACY_SEASON
          : undefined;
    const deck = parsed.deck.filter((n): n is number => typeof n === 'number');
    // v1 links carried no deployed list: the first six fought.
    const deployed = Array.isArray(parsed.deployed)
      ? parsed.deployed.filter((n): n is number => typeof n === 'number' && deck.includes(n))
      : deck.slice(0, LEGACY_DEPLOYED);
    const wanted = parsed.wanted.filter((n): n is number => typeof n === 'number');
    return {
      ...(season === undefined ? {} : { season }),
      deck,
      deployed,
      wanted,
      priority: sanitizePriority(parsed.priority, wanted),
      fusionGoal: sanitizeFusionGoal(parsed.fusionGoal, wanted),
      options: sanitizeOptions(parsed.options),
    };
  } catch {
    return null;
  }
}
