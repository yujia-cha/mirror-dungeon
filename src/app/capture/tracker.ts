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
 *   pack picker only narrows the candidates). Once per floor and pack. A read that would move the
 *   entry already made — the same pack on another floor, a floor beyond the next — waits for a
 *   second map read that agrees (M172, `pendingEnter`).
 * - `got` — the 「E.G.O 기프트를 획득했습니다.」 popup names a gift. Once per gift while popups follow
 *   each other: several popups in a row (three start gifts, a fusion's two results) each count, the
 *   same name seen again after a blink does not.
 * - `sold` — the sell confirm names a gift and the sell list comes back with nothing selected
 *   (confirmed). Back with the same gift still selected means 「취소」, and nothing is sold. A frame
 *   of nothing between them (the dialog fading) decides nothing (M151). The gift the sell list had
 *   selected before the confirm checks it: when both are read and differ, one of them is a misread
 *   and nothing is sold — a missed sale costs less than unmarking a gift still held; when the
 *   confirm's name is muddled between candidates and the selection is one of them, the selection
 *   names it.
 * - `fused` — the fusion confirm was seen and the popup that follows names the result (M101): the
 *   result is `got` as usual, and the ingredients it ate are to be unmarked. What it ate is worked
 *   out before this file (`fusion.ts`) from the icons, and after it from the result's recipe
 *   (`apply.ts`, M151) — so a confirm whose slot count went unread still waits for its popup. A
 *   muddled result name carries the fusion into its question (`unsure.fusing`): the answer settles
 *   both.
 *   The fusion screen's ring of picked gifts (M175, `ringPick`) makes up a confirm read short: the
 *   confirm is up for half a second and its icons slide in late, the ring for seconds before it.
 * - A popup whose name blurs past right after a purchase dialog named its gift is that gift (M175,
 *   `purchasePick`) — the shop hands out what was bought.
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
   * On the fusion confirm: how many filled slots read no gift well (M159). The game slides the icons
   * in after the dialog, so a confirm read too early sees empty frames; the loop reads the slots
   * again (`ReadContext.slotsOnly`).
   */
  weakSlots?: number;
  /** On the fusion screen: the gifts its ring surely shows picked (M175, `readRing`). */
  ring?: number[];
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
  /** `purchase`: the popup's name blurred and the purchase dialog before it named the gift (M175). */
  | { kind: 'got'; giftId: number; source?: StartSource; purchase?: true }
  | { kind: 'sold'; giftId: number }
  | { kind: 'fused'; resultId: number; consumed: number[]; unsure: number[]; filled?: number; ring?: true }
  /** The run start is behind the player (M135). */
  | { kind: 'startDone' }
  /** The player walked into a pack's shop, or out of it (M148). Changes nothing in the run. */
  | { kind: 'place'; shop: boolean }
  | { kind: 'unsure'; about: 'enter'; floor: number; ids: number[] }
  /** `fusing`: the popup was a fusion's result (M151) — the answer names it, and what it ate. */
  | { kind: 'unsure'; about: 'got'; ids: number[]; fusing?: Consumed };

export interface TrackerState {
  /** The last pack entered, so the map seen again on the same floor enters nothing. */
  entered: { floor: number; packId: number } | null;
  /**
   * A map read that would move the entry already recorded (M172): the same pack on another floor,
   * or a floor beyond the next. It enters only when a second map read agrees — one noisy header
   * (particles over it read 「9층」 and 「20번구의 기적」 at 0.79 on floor 8 of the owner's 2026-10-22
   * run) moved the entry, skipped the floor and failed its gifts.
   */
  pendingEnter?: { floor: number; packId: number } | null;
  /** Gifts recorded (or asked about) by the current run of popups; cleared when popups end. */
  popupGifts: readonly number[];
  /** A gift whose sale awaits the sell list's answer. */
  selling: number | null;
  /** The gift the sell list shows selected, read before its confirm (M151). */
  sellPick?: number | null;
  /** What a confirmed fusion will eat, waiting for the popup that names its result. */
  fusing: Consumed | null;
  /** The gifts the fusion screen's ring last showed picked (M175), for the confirm to fall back on. */
  ringPick?: readonly number[] | null;
  /**
   * The gift the purchase dialog named (M175), and whether that dialog is still up: a read of it
   * fading out keeps the name, a dialog opened again after the shop starts over.
   */
  purchasePick?: { id: number | null; open: boolean } | null;
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

/** Whether `whole` holds every id of `part`, as many times as `part` does. */
function includesAll(whole: readonly number[], part: readonly number[]): boolean {
  const left = [...whole];
  return part.every((id) => {
    const at = left.indexOf(id);
    if (at < 0) return false;
    left.splice(at, 1);
    return true;
  });
}

/**
 * What the confirm says a fusion eats, made up from the ring where the confirm read short (M175).
 * The ring stands in only when it agrees: as many gifts as the confirm's 「N/M」 says are filled,
 * and every gift the confirm did read among them. An unread count leaves only the ring to go by.
 * A confirm read whole is kept as it is.
 */
function withRing(read: Consumed | null, ring: readonly number[] | null | undefined): Consumed | null {
  if (!ring || ring.length === 0) return read;
  if (!read) return { consumed: [...ring], unsure: [], ring: true };
  const whole = read.unsure.length === 0 && read.filled !== undefined && read.consumed.length === read.filled;
  if (whole || read.filled === undefined || ring.length !== read.filled) return read;
  return includesAll(ring, read.consumed)
    ? { consumed: [...ring], unsure: [], filled: read.filled, ring: true }
    : read;
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

  // A sale is decided by what the sell list shows after the confirm, and by nothing else. A frame
  // of nothing (the dialog fading out) is not that answer (M151).
  if (next.selling !== null && frame.screen !== null && frame.screen !== 'sellConfirm') {
    if (frame.screen === 'sell') {
      const selected = matchedId(frame.gift);
      if (selected === null && frame.gift?.status !== 'ambiguous')
        events.push({ kind: 'sold', giftId: next.selling });
    }
    next = { ...next, selling: null };
  }
  // What the sell list has selected, for the confirm to agree with (M151).
  if (frame.screen === 'sell') {
    const picked = matchedId(frame.gift);
    if (picked !== null || frame.gift?.status !== 'ambiguous') next = { ...next, sellPick: picked };
  } else if (frame.screen !== null && frame.screen !== 'sellConfirm' && next.sellPick != null) {
    next = { ...next, sellPick: null };
  }

  // The ring's picks hold through the confirm and its popup; any other screen ends them (M175).
  if (frame.screen === 'fusion') {
    if (frame.ring) next = { ...next, ringPick: frame.ring };
  } else if (
    next.ringPick &&
    frame.screen !== null &&
    frame.screen !== 'fusionConfirm' &&
    frame.screen !== 'fusionKeyword' &&
    frame.screen !== 'acquired'
  ) {
    next = { ...next, ringPick: null };
  }
  // The purchase dialog's gift (M175): kept through the dialog fading out and the shop behind it,
  // for the popup that follows a purchase; a new dialog starts over, and anywhere else ends it.
  if (frame.screen === 'purchase') {
    const named = matchedId(frame.gift);
    const pick = next.purchasePick;
    if (!pick?.open) next = { ...next, purchasePick: { id: named, open: true } };
    else if (named !== null && named !== pick.id) next = { ...next, purchasePick: { id: named, open: true } };
  } else if (frame.screen === 'shop') {
    if (next.purchasePick?.open) next = { ...next, purchasePick: { ...next.purchasePick, open: false } };
  } else if (frame.screen !== null && frame.screen !== 'acquired' && next.purchasePick) {
    next = { ...next, purchasePick: null };
  }

  // A fusion waits through the confirm, the animation (no screen) and its popup; going back to the
  // fusion screen or anywhere else means it was cancelled.
  if (next.fusing && frame.screen !== null && frame.screen !== 'fusionConfirm' && frame.screen !== 'acquired')
    next = { ...next, fusing: null };

  switch (frame.screen) {
    case 'acquired': {
      // A popup right after a purchase whose name came out muddled or not at all is what was
      // bought (M175): a muddled name that leaves the purchase out is still asked.
      const bought = next.purchasePick?.id ?? null;
      const blurred =
        bought !== null &&
        (frame.gift === null ||
          frame.gift.status === 'none' ||
          (frame.gift.status === 'ambiguous' && frame.gift.ids.includes(bought)));
      const gift: MatchResult | null = blurred
        ? { status: 'match', id: bought, score: 0, margin: 0 }
        : frame.gift;
      if (next.purchasePick) next = { ...next, purchasePick: null };
      if (gift?.status === 'match' && !next.popupGifts.includes(gift.id)) {
        const source = popupSource(next, frame);
        events.push({
          kind: 'got',
          giftId: gift.id,
          ...(source ? { source } : {}),
          ...(blurred ? { purchase: true as const } : {}),
        });
        next = { ...next, popupGifts: [...next.popupGifts, gift.id] };
        // The first popup after a confirmed fusion is its result; a second (조합식 합성 can show
        // two) is an ordinary gain.
        if (next.fusing) {
          events.push({ kind: 'fused', resultId: gift.id, ...next.fusing });
          next = { ...next, fusing: null, ringPick: null };
        }
      } else if (gift?.status === 'ambiguous' && !gift.ids.some((id) => next.popupGifts.includes(id))) {
        // A muddled fusion result takes the fusion into its question (M151): dropped here, what
        // the fusion ate would never be settled.
        events.push(
          next.fusing
            ? { kind: 'unsure', about: 'got', ids: gift.ids, fusing: next.fusing }
            : { kind: 'unsure', about: 'got', ids: gift.ids },
        );
        next = { ...next, popupGifts: [...next.popupGifts, ...gift.ids], fusing: null };
      }
      break;
    }
    case 'exploring': {
      const floor = frame.floor;
      const pack = frame.pack;
      if (floor === null || !pack) break;
      if (pack.status === 'match') {
        const same = next.entered?.floor === floor && next.entered.packId === pack.id;
        if (same) {
          if (next.pendingEnter) next = { ...next, pendingEnter: null };
          break;
        }
        // A read that moves the entry already recorded, or jumps a floor, is a likely misread
        // of a header something passed over: it enters when the next map read says the same
        // (M172). A first entry and the next floor's pack enter at once, as before.
        const moves =
          next.entered !== null && (next.entered.packId === pack.id || floor > next.entered.floor + 1);
        const agreed = next.pendingEnter?.floor === floor && next.pendingEnter.packId === pack.id;
        if (moves && !agreed) {
          next = { ...next, pendingEnter: { floor, packId: pack.id } };
          break;
        }
        events.push({ kind: 'enter', floor, packId: pack.id });
        next = { ...next, entered: { floor, packId: pack.id }, pendingEnter: null };
      } else if (pack.status === 'ambiguous' && next.entered?.floor !== floor) {
        events.push({ kind: 'unsure', about: 'enter', floor, ids: pack.ids });
        // Asked once per floor: the answer, or a clean read later, settles it.
        next = { ...next, entered: { floor, packId: -1 } };
      }
      break;
    }
    case 'fusionConfirm': {
      // Seen is enough to wait for the result (M151): its recipe can settle what the icons did not.
      // A read with ingredients replaces whatever came before; an unread frame keeps it.
      // What the ring showed picked makes up a read that came short (M175).
      if (frame.ingredients) next = { ...next, fusing: withRing(frame.ingredients, next.ringPick) };
      else if (!next.fusing)
        next = { ...next, fusing: withRing(null, next.ringPick) ?? { consumed: [], unsure: [] } };
      break;
    }
    case 'sellConfirm': {
      const named = matchedId(frame.gift);
      const pick = next.sellPick ?? null;
      const muddled = frame.gift?.status === 'ambiguous' ? frame.gift.ids : [];
      const id = named ?? (pick !== null && muddled.includes(pick) ? pick : null);
      if (named !== null && pick !== null && named !== pick) next = { ...next, selling: null };
      else if (id !== null) next = { ...next, selling: id };
      break;
    }
    default:
      break;
  }
  return { state: next, events };
}
