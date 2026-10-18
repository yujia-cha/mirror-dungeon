/**
 * From what each captured frame shows to what happened in the run.
 *
 * The capture loop reads a frame every interval and hands this a `Frame`: which screen it is and
 * the names read on it, already matched against the season's packs and gifts. The game holds most
 * screens still — a popup stays until 「확인」 is pressed — so the same thing is seen many frames in a
 * row, and OCR can blink between a good read and a miss while it stays. This turns that stream into
 * events that each happened once:
 *
 * - `enter` — the map header reads 「N층 탐사 중」 over a pack's name (M95: the cleanest signal; the
 *   pack picker only narrows the candidates). Once per floor and pack.
 * - `got` — the 「E.G.O 기프트를 획득했습니다.」 popup names a gift. Once per gift while popups follow
 *   each other: several popups in a row (three start gifts, a fusion's two results) each count, the
 *   same name seen again after a blink does not.
 * - `sold` — the sell confirm names a gift and the sell list comes back with nothing selected
 *   (confirmed). Back with the same gift still selected means 「취소」, and nothing is sold.
 * - `fused` — the fusion confirm read its ingredients and the popup that follows names the result
 *   (M101): the result is `got` as usual, and the ingredients it ate are to be unmarked. What it ate
 *   is worked out before this file (`fusion.ts`); this only ties it to the result that came of it.
 * - `unsure` — a name that is close to more than one candidate. The UI asks instead of recording.
 * - `place` (M148, `trackPlace`) — into a pack's shop (its front 「상점」 or any screen opened from
 *   it) or out of it (the map, a pack picker). Nothing in the run changes; the overlay shows other
 *   things while the player shops.
 * - The run start (M135, `trackStart`): a popup says which picker its gift came from
 *   (`got.source`) — the observation when its title shows behind the popup, the start gift picker
 *   when that was the picker last seen — and `startDone` says the start is over: the observation
 *   picker left, or a pack picker or map seen. **Only a popup records a gift** (M136, owner's
 *   decision): what a picker shows picked is not read, so a gift whose popup went by unread stays
 *   un-got and unobserved.
 *
 * Pure and deterministic: state in, state and events out. What an event does to the run is the
 * app's business, not this file's.
 */
import type { Consumed } from './fusion.ts';
import type { MatchResult } from './match-name.ts';
import { isShopScreen, isStartScreen, type Screen, type StartScreen } from './screens.ts';

/** What one captured frame shows, as read and matched. */
export interface Frame {
  screen: Screen | null;
  /** The floor read off the map header or the pack picker title. */
  floor: number | null;
  /** The pack named under 「N층 탐사 중」. */
  pack: MatchResult | null;
  /** The gift named by the popup, the sell confirm, or the sell list's selection. */
  gift: MatchResult | null;
  /** On the fusion confirm: what the fusion would eat, read off its ingredient icons (`fusion.ts`). */
  ingredients?: Consumed | null;
  /**
   * On an acquired popup during the run start: whether the observation picker's title shows
   * behind it (M135). Missing when it was not looked at.
   */
  overObservation?: boolean;
  /**
   * A read of the popup burst that found no popup (M136): only the popup's title was looked at, so
   * `screen: null` says nothing about what else is on screen. The tracker passes over it.
   */
  partial?: boolean;
}

/** Which start picker a gift came from (M135). */
export type StartSource = 'start' | 'observation';

export type CaptureEvent =
  | { kind: 'enter'; floor: number; packId: number }
  | { kind: 'got'; giftId: number; source?: StartSource }
  | { kind: 'sold'; giftId: number }
  | { kind: 'fused'; resultId: number; consumed: number[]; unsure: number[] }
  /** The run start is behind the player (M135). */
  | { kind: 'startDone' }
  /** The player walked into a pack's shop, or out of it (M148). Changes nothing in the run. */
  | { kind: 'place'; shop: boolean }
  | { kind: 'unsure'; about: 'enter'; floor: number; ids: number[] }
  | { kind: 'unsure'; about: 'got'; ids: number[] };

export interface TrackerState {
  /** The last pack entered, so the map seen again on the same floor enters nothing. */
  entered: { floor: number; packId: number } | null;
  /** Gifts recorded (or asked about) by the current run of popups; cleared when popups end. */
  popupGifts: readonly number[];
  /** A gift whose sale awaits the sell list's answer. */
  selling: number | null;
  /** What a confirmed fusion will eat, waiting for the popup that names its result. */
  fusing: Consumed | null;
  /** The start picker last seen while the run start is open (M135). */
  start?: StartScreen | null;
  /** `startDone` was told, and is not told again until a start picker is seen (M135). */
  startClosed?: boolean;
  /** The player is in a pack's shop (M148): its front or a screen opened from it. */
  inShop?: boolean;
}

export const INITIAL_TRACKER: TrackerState = { entered: null, popupGifts: [], selling: null, fusing: null };

/**
 * Where a popup's gift came from (M135): the observation when its title shows behind the popup;
 * the start gift picker when that is the picker last seen. A popup after the observation picker
 * over anything else is neither — the boon 「완전한 가능성」 hands out gifts of its own right after
 * the observation, and those are no observation. Since M136 the title behind is the only thing
 * that tells them apart: the picker's panel is not read.
 */
function popupSource(state: TrackerState, frame: Frame): StartSource | undefined {
  if (frame.overObservation) return 'observation';
  return state.start === 'startGiftSelect' ? 'start' : undefined;
}

/**
 * The run start (M135): boons → start gift picker → 기프트 관측 → popups → floor 1's pack picker.
 * Either picker may be confirmed with nothing picked, and observation can be off altogether. The
 * picker last seen is kept to tell where a popup's gift came from; the observation picker behind a
 * popup counts as seen. Leaving the observation picker for a named screen, or reaching a pack
 * picker or a map, ends the start. A frame of nothing ends nothing (M136): popups follow each other
 * with blinks between them, and a start closed in the first blink left the next observation
 * popups unpinned. Floor 1's pack picker always comes, and closes it.
 */
function trackStart(state: TrackerState, frame: Frame): { state: TrackerState; events: CaptureEvent[] } {
  const events: CaptureEvent[] = [];
  let start = state.start ?? null;
  let closed = state.startClosed ?? false;
  const screen = frame.screen;
  if (screen === 'acquired') {
    if (frame.overObservation && !closed) start = 'observationSelect';
  } else if (isStartScreen(screen)) {
    closed = false;
    start = screen;
  } else if (screen !== null) {
    if (!closed && (start === 'observationSelect' || screen === 'packSelect' || screen === 'exploring')) {
      events.push({ kind: 'startDone' });
      closed = true;
    }
    start = null;
  }
  if (start === (state.start ?? null) && closed === (state.startClosed ?? false)) return { state, events };
  return { state: { ...state, start, startClosed: closed }, events };
}

/**
 * In the shop or not (M148). The shop's front and every screen opened from it (`isShopScreen`) put
 * the player in it; the map or a pack picker — and the run start's pickers — take them out. A
 * popup or a frame that names nothing says nothing: popups come in the shop too, and a battle
 * shows no title at all.
 */
function trackPlace(state: TrackerState, frame: Frame): { state: TrackerState; events: CaptureEvent[] } {
  const screen = frame.screen;
  const was = state.inShop ?? false;
  const now = isShopScreen(screen)
    ? true
    : screen === 'exploring' || screen === 'packSelect' || isStartScreen(screen)
      ? false
      : was;
  if (now === was) return { state, events: [] };
  return { state: { ...state, inShop: now }, events: [{ kind: 'place', shop: now }] };
}

/** The gift a confirmed match names, or null. */
function matchedId(result: MatchResult | null): number | null {
  return result?.status === 'match' ? result.id : null;
}

/**
 * Fold one frame into the state. Frames that change nothing — the same popup again, the map of a
 * floor already entered, a screen the tracker does not act on — return no events.
 */
export function trackFrame(
  state: TrackerState,
  frame: Frame,
): { state: TrackerState; events: CaptureEvent[] } {
  // A burst read that found no popup saw only the popup's title (M136): no screen ends, and the
  // popups seen in the burst stay deduplicated across the blinks between them.
  if (frame.partial && frame.screen === null) return { state, events: [] };

  const started = trackStart(state, frame);
  const placed = trackPlace(started.state, frame);
  const events: CaptureEvent[] = [...started.events, ...placed.events];
  let next: TrackerState = placed.state;

  // Popups follow each other; anything else ends the run of them.
  if (frame.screen !== 'acquired' && next.popupGifts.length > 0) next = { ...next, popupGifts: [] };

  // A sale is decided by what the sell list shows after the confirm, and by nothing else.
  if (next.selling !== null && frame.screen !== 'sellConfirm') {
    if (frame.screen === 'sell') {
      const selected = matchedId(frame.gift);
      if (selected === null && frame.gift?.status !== 'ambiguous')
        events.push({ kind: 'sold', giftId: next.selling });
    }
    next = { ...next, selling: null };
  }

  // A fusion waits through the confirm, the animation (no screen) and its popup; going back to the
  // fusion screen or anywhere else means it was cancelled.
  if (next.fusing && frame.screen !== null && frame.screen !== 'fusionConfirm' && frame.screen !== 'acquired')
    next = { ...next, fusing: null };

  switch (frame.screen) {
    case 'acquired': {
      const gift = frame.gift;
      if (gift?.status === 'match' && !next.popupGifts.includes(gift.id)) {
        const source = popupSource(next, frame);
        events.push(source ? { kind: 'got', giftId: gift.id, source } : { kind: 'got', giftId: gift.id });
        next = { ...next, popupGifts: [...next.popupGifts, gift.id] };
        // The first popup after a confirmed fusion is its result; a second (조합식 합성 can show
        // two) is an ordinary gain.
        if (next.fusing) {
          events.push({ kind: 'fused', resultId: gift.id, ...next.fusing });
          next = { ...next, fusing: null };
        }
      } else if (gift?.status === 'ambiguous' && !gift.ids.some((id) => next.popupGifts.includes(id))) {
        events.push({ kind: 'unsure', about: 'got', ids: gift.ids });
        next = { ...next, popupGifts: [...next.popupGifts, ...gift.ids] };
      }
      break;
    }
    case 'exploring': {
      const floor = frame.floor;
      const pack = frame.pack;
      if (floor === null || !pack) break;
      if (pack.status === 'match') {
        const same = next.entered?.floor === floor && next.entered.packId === pack.id;
        if (!same) {
          events.push({ kind: 'enter', floor, packId: pack.id });
          next = { ...next, entered: { floor, packId: pack.id } };
        }
      } else if (pack.status === 'ambiguous' && next.entered?.floor !== floor) {
        events.push({ kind: 'unsure', about: 'enter', floor, ids: pack.ids });
        // Asked once per floor: the answer, or a clean read later, settles it.
        next = { ...next, entered: { floor, packId: -1 } };
      }
      break;
    }
    case 'fusionConfirm': {
      if (frame.ingredients) next = { ...next, fusing: frame.ingredients };
      break;
    }
    case 'sellConfirm': {
      const id = matchedId(frame.gift);
      if (id !== null) next = { ...next, selling: id };
      break;
    }
    default:
      break;
  }
  return { state: next, events };
}
