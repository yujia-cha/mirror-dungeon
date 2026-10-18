import { describe, expect, it } from 'vitest';
import type { MatchResult } from '../match-name.ts';
import { INITIAL_TRACKER, trackFrame, type CaptureEvent, type Frame, type TrackerState } from '../tracker.ts';

const match = (id: number): MatchResult => ({ status: 'match', id, score: 1, margin: 0.5 });
const unsure = (...ids: number[]): MatchResult => ({ status: 'ambiguous', ids, score: 0.8, margin: 0.02 });
const none: MatchResult = { status: 'none' };
const frame = (over: Partial<Frame>): Frame => ({
  screen: null,
  floor: null,
  pack: null,
  gift: null,
  ...over,
});

/**
 * Feed frames in order; return every event and the final state. Walking into or out of the shop
 * (`place`, M148) has its own tests below, so it is left out here.
 */
function run(frames: Frame[], from: TrackerState = INITIAL_TRACKER) {
  let state = from;
  const events: CaptureEvent[] = [];
  for (const f of frames) {
    const out = trackFrame(state, f);
    state = out.state;
    events.push(...out.events.filter((e) => e.kind !== 'place'));
  }
  return { state, events };
}

/** A session that has told the run start is over (M135): the map and the pack picker enter only. */
const PAST_START: TrackerState = { ...INITIAL_TRACKER, startClosed: true };

const popup = (gift: MatchResult | null) => frame({ screen: 'acquired', gift });
const map = (floor: number | null, pack: MatchResult | null) => frame({ screen: 'exploring', floor, pack });

describe('trackFrame — acquired popups', () => {
  it('records a gift once while its popup stays on screen', () => {
    // Arrange: the popup is seen for five frames.
    const frames = Array.from({ length: 5 }, () => popup(match(9091)));
    // Act
    const { events } = run(frames);
    // Assert
    expect(events).toEqual([{ kind: 'got', giftId: 9091 }]);
  });

  it('records each of several popups that follow each other', () => {
    // Three start gifts, one popup each, back to back.
    const { events } = run([popup(match(1)), popup(match(1)), popup(match(2)), popup(match(3))]);
    expect(events).toEqual([
      { kind: 'got', giftId: 1 },
      { kind: 'got', giftId: 2 },
      { kind: 'got', giftId: 3 },
    ]);
  });

  it('does not record the same gift again when OCR blinks while the popup stays', () => {
    const { events } = run([popup(match(7)), popup(none), popup(null), popup(match(7))]);
    expect(events).toEqual([{ kind: 'got', giftId: 7 }]);
  });

  it('records a gift that is only read on a later frame of its popup', () => {
    const { events } = run([popup(none), popup(match(7))]);
    expect(events).toEqual([{ kind: 'got', giftId: 7 }]);
  });

  it('starts a new run of popups after another screen', () => {
    // Arrange: the same gift, a map in between (sold and bought back, say).
    const frames = [popup(match(7)), map(1, match(1002)), popup(match(7))];
    // Act
    const { events } = run(frames);
    // Assert
    expect(events.filter((e) => e.kind === 'got')).toEqual([
      { kind: 'got', giftId: 7 },
      { kind: 'got', giftId: 7 },
    ]);
  });

  it('asks once about an ambiguous name, and not again for the same popup', () => {
    const { events } = run([popup(unsure(5, 6)), popup(unsure(5, 6)), popup(match(5))]);
    expect(events).toEqual([{ kind: 'unsure', about: 'got', ids: [5, 6] }]);
  });
});

describe('trackFrame — entering a pack', () => {
  it('enters once per floor and pack, however long the map is shown', () => {
    const { events, state } = run(
      [map(1, match(1002)), map(1, match(1002)), map(1, match(1002))],
      PAST_START,
    );
    expect(events).toEqual([{ kind: 'enter', floor: 1, packId: 1002 }]);
    expect(state.entered).toEqual({ floor: 1, packId: 1002 });
  });

  it('enters again on the next floor', () => {
    const { events } = run([map(1, match(1002)), popup(match(9)), map(2, match(1101))], PAST_START);
    expect(events.filter((e) => e.kind === 'enter')).toEqual([
      { kind: 'enter', floor: 1, packId: 1002 },
      { kind: 'enter', floor: 2, packId: 1101 },
    ]);
  });

  it('enters nothing until both the floor and the pack are read', () => {
    const { events } = run([map(null, match(1002)), map(1, none), map(1, null)], PAST_START);
    expect(events).toEqual([]);
  });

  it('asks once per floor about an ambiguous pack, and enters on a clean read after', () => {
    // Arrange
    const frames = [map(3, unsure(1008, 1014)), map(3, unsure(1008, 1014)), map(3, match(1008))];
    // Act
    const { events } = run(frames, PAST_START);
    // Assert
    expect(events).toEqual([
      { kind: 'unsure', about: 'enter', floor: 3, ids: [1008, 1014] },
      { kind: 'enter', floor: 3, packId: 1008 },
    ]);
  });
});

describe('trackFrame — selling', () => {
  const confirm = (gift: MatchResult | null) => frame({ screen: 'sellConfirm', gift });
  const list = (gift: MatchResult | null) => frame({ screen: 'sell', gift });

  it('records a sale when the list comes back with nothing selected', () => {
    // Arrange: select, confirm (seen twice), then the list shows 「???」.
    const frames = [list(match(9993)), confirm(match(9993)), confirm(match(9993)), list(none)];
    // Act
    const { events, state } = run(frames);
    // Assert
    expect(events).toEqual([{ kind: 'sold', giftId: 9993 }]);
    expect(state.selling).toBeNull();
  });

  it('records nothing when the confirm is cancelled and the gift stays selected', () => {
    const { events } = run([confirm(match(9993)), list(match(9993))]);
    expect(events).toEqual([]);
  });

  it('records nothing when the list after the confirm cannot be read for sure', () => {
    const { events } = run([confirm(match(9993)), list(unsure(9992, 9993))]);
    expect(events).toEqual([]);
  });

  it('forgets a pending sale when some other screen comes next', () => {
    const { events, state } = run([confirm(match(9993)), map(2, match(1101)), list(none)]);
    expect(events.filter((e) => e.kind === 'sold')).toEqual([]);
    expect(state.selling).toBeNull();
  });

  it('ignores a confirm whose name was not read', () => {
    const { events } = run([confirm(none), list(none)]);
    expect(events).toEqual([]);
  });

  it('waits through a frame of nothing between the confirm and the list (M151)', () => {
    // Arrange: the dialog fades out over a frame that names no screen.
    const frames = [list(match(9993)), confirm(match(9993)), frame({}), list(none)];
    // Act
    const { events } = run(frames);
    // Assert
    expect(events).toEqual([{ kind: 'sold', giftId: 9993 }]);
  });

  it('sells nothing when the confirm names another gift than the list had selected (M151)', () => {
    // Arrange: one of the two reads is wrong; unmarking a gift still held costs more than a miss.
    const { events, state } = run([list(match(9993)), confirm(match(9001)), list(none)]);
    // Assert
    expect(events).toEqual([]);
    expect(state.selling).toBeNull();
  });

  it('lets the selection name a muddled confirm when it is one of the candidates (M151)', () => {
    const { events } = run([list(match(9993)), confirm(unsure(9992, 9993)), list(none)]);
    expect(events).toEqual([{ kind: 'sold', giftId: 9993 }]);
  });

  it('does not take a selection from before another screen (M151)', () => {
    const { events } = run([list(match(9993)), map(2, match(1101)), confirm(unsure(9992, 9993)), list(none)]);
    expect(events.filter((e) => e.kind === 'sold')).toEqual([]);
  });
});

describe('trackFrame — fusion (M101)', () => {
  const confirm = (consumed: number[], unsure: number[] = []) =>
    frame({ screen: 'fusionConfirm', ingredients: { consumed, unsure } });

  it('ties what the confirm read to the result the popup names', () => {
    // Arrange: confirm (seen twice), the animation (no screen), then the result popup.
    const frames = [confirm([9105, 9131]), confirm([9105, 9131]), frame({}), popup(match(9083))];
    // Act
    const { events, state } = run(frames);
    // Assert
    expect(events).toEqual([
      { kind: 'got', giftId: 9083 },
      { kind: 'fused', resultId: 9083, consumed: [9105, 9131], unsure: [] },
    ]);
    expect(state.fusing).toBeNull();
  });

  it('treats a second popup after the fusion as an ordinary gain', () => {
    const { events } = run([confirm([1, 2]), popup(match(10)), popup(match(11))]);
    expect(events.filter((e) => e.kind === 'fused')).toEqual([
      { kind: 'fused', resultId: 10, consumed: [1, 2], unsure: [] },
    ]);
    expect(events.filter((e) => e.kind === 'got').map((e) => e.giftId)).toEqual([10, 11]);
  });

  it('forgets a fusion cancelled back to the fusion screen', () => {
    const { events, state } = run([confirm([1, 2]), frame({ screen: 'fusion' }), popup(match(10))]);
    expect(events).toEqual([{ kind: 'got', giftId: 10 }]);
    expect(state.fusing).toBeNull();
  });

  it('carries the unsure gifts through for the UI to ask about', () => {
    const { events } = run([confirm([9142], [9105, 9110, 9126]), popup(match(9083))]);
    expect(events.at(-1)).toEqual({
      kind: 'fused',
      resultId: 9083,
      consumed: [9142],
      unsure: [9105, 9110, 9126],
    });
  });

  it('still waits for the result when the confirm read no ingredients (M151)', () => {
    // Arrange: the 「N/M」 went unread, so no slot was ranked; the result's recipe settles it later.
    const unread = frame({ screen: 'fusionConfirm', ingredients: null });
    // Act
    const { events, state } = run([unread, popup(match(10))]);
    // Assert
    expect(events).toEqual([
      { kind: 'got', giftId: 10 },
      { kind: 'fused', resultId: 10, consumed: [], unsure: [] },
    ]);
    expect(state.fusing).toBeNull();
  });

  it('keeps a read of the slots over a later unread frame, and takes a later read over an unread one', () => {
    const unread = frame({ screen: 'fusionConfirm', ingredients: null });
    const kept = run([confirm([1, 2]), unread, popup(match(10))]).events.at(-1);
    const replaced = run([unread, confirm([1, 2]), popup(match(10))]).events.at(-1);
    expect(kept).toEqual({ kind: 'fused', resultId: 10, consumed: [1, 2], unsure: [] });
    expect(replaced).toEqual({ kind: 'fused', resultId: 10, consumed: [1, 2], unsure: [] });
  });

  it('carries the fusion into the question when its result name is muddled (M151)', () => {
    // Arrange: the confirm read, then a result popup close to two names.
    const { events, state } = run([confirm([1, 2]), popup(unsure(10, 11))]);
    // Assert: one question, with what the fusion ate; nothing waits any more.
    expect(events).toEqual([
      { kind: 'unsure', about: 'got', ids: [10, 11], fusing: { consumed: [1, 2], unsure: [] } },
    ]);
    expect(state.fusing).toBeNull();
  });
});

describe('trackFrame — other screens', () => {
  it('emits nothing for screens the tracker does not act on', () => {
    const frames = [frame({}), frame({ screen: 'packSelect', floor: 1 }), frame({ screen: 'fusion' })];
    expect(run(frames, PAST_START).events).toEqual([]);
  });

  it('returns the same state object when nothing changed', () => {
    const inShop = trackFrame(INITIAL_TRACKER, frame({ screen: 'purchase' })).state;
    const { state } = trackFrame(inShop, frame({ screen: 'purchase' }));
    expect(state).toBe(inShop);
  });
});

describe('trackFrame — the run start (M135, popups only since M136)', () => {
  const starts = frame({ screen: 'startGiftSelect' });
  const observes = frame({ screen: 'observationSelect' });
  const over = (gift: MatchResult | null, overObservation = true) =>
    frame({ screen: 'acquired', gift, overObservation });
  const packs = frame({ screen: 'packSelect' });

  it('records only what a popup names — a pick whose popup went by unread is not got', () => {
    // Arrange: three start gifts picked, the popup of only the first read, then the observation.
    const frames = [starts, popup(match(1)), frame({}), observes, packs];
    // Act
    const { events } = run(frames);
    // Assert: no settling of the picker, no question.
    expect(events).toEqual([{ kind: 'got', giftId: 1, source: 'start' }, { kind: 'startDone' }]);
  });

  it('says a popup over the observation title is the observation, and ends the start at the pack picker', () => {
    const { events, state } = run([observes, over(match(9191)), packs, packs]);
    expect(events).toEqual([{ kind: 'got', giftId: 9191, source: 'observation' }, { kind: 'startDone' }]);
    expect(state.start).toBeNull();
  });

  it('keeps the start open through the blinks between observation popups (M136)', () => {
    // Arrange: two observation popups with frames of nothing — and a burst read of nothing — between.
    const frames = [
      observes,
      over(match(9191)),
      frame({}),
      frame({ partial: true }),
      over(match(9230)),
      frame({}),
      packs,
    ];
    // Act
    const { events } = run(frames);
    // Assert: both are the observation's; the start ends only at the pack picker.
    expect(events).toEqual([
      { kind: 'got', giftId: 9191, source: 'observation' },
      { kind: 'got', giftId: 9230, source: 'observation' },
      { kind: 'startDone' },
    ]);
  });

  it('knows an observed gift by the title behind its popup when the picker itself was never read', () => {
    const { events, state } = run([starts, over(match(9))]);
    expect(events).toEqual([{ kind: 'got', giftId: 9, source: 'observation' }]);
    expect(state.start).toBe('observationSelect');
  });

  it('gives no source to a popup after the observation that does not sit over it — a boon gift', () => {
    const { events } = run([observes, over(match(5)), over(match(77), false)]);
    expect(events).toEqual([
      { kind: 'got', giftId: 5, source: 'observation' },
      { kind: 'got', giftId: 77 },
    ]);
  });

  it('asks about a muddled popup at the start as about any other — no observation question', () => {
    const { events } = run([observes, over(unsure(7, 8))]);
    expect(events).toEqual([{ kind: 'unsure', about: 'got', ids: [7, 8] }]);
  });

  it('ends the start when the observation picker is left for a named screen', () => {
    const { events } = run([observes, frame({ screen: 'purchase' })]);
    expect(events).toEqual([{ kind: 'startDone' }]);
  });

  it('tells the start is over once — again only after a start picker is seen', () => {
    // Arrange: a session that starts on floor 1's pack picker, then the map; later a new run.
    const first = run([packs, map(1, match(1002)), packs]);
    // Act
    const next = run([starts, packs], first.state);
    // Assert: the end of the start comes before the entry it makes possible.
    expect(first.events).toEqual([{ kind: 'startDone' }, { kind: 'enter', floor: 1, packId: 1002 }]);
    expect(next.events).toEqual([{ kind: 'startDone' }]);
  });
});

describe('trackFrame — a popup read of nothing (M136)', () => {
  it('passes over it: the popups around it stay one run, and nothing pending is dropped', () => {
    // Arrange: a sale awaiting the sell list, and a popup seen twice around a burst read of nothing.
    const selling: TrackerState = { ...INITIAL_TRACKER, selling: 9091 };
    const blink = frame({ partial: true });
    // Act
    const sale = trackFrame(selling, blink);
    const popups = run([popup(match(5)), blink, popup(match(5))]);
    // Assert
    expect(sale.state).toBe(selling);
    expect(sale.events).toEqual([]);
    expect(popups.events).toEqual([{ kind: 'got', giftId: 5 }]);
  });
});

describe('trackFrame — in the shop or not (M148)', () => {
  /** Fold frames in order; every event and the last state. */
  const fold = (frames: Frame[], from: TrackerState = INITIAL_TRACKER) => {
    let state = from;
    const events: CaptureEvent[] = [];
    for (const f of frames) {
      const out = trackFrame(state, f);
      state = out.state;
      events.push(...out.events);
    }
    return { state, events };
  };
  const places = (events: CaptureEvent[]) => events.filter((e) => e.kind === 'place');

  it('goes in at the shop front and out at the map, saying so once each', () => {
    // Act
    const { state, events } = fold([
      frame({ screen: 'shop' }),
      frame({ screen: 'shop' }),
      frame({ screen: 'purchase' }),
      map(2, match(1002)),
    ]);
    // Assert
    expect(places(events)).toEqual([
      { kind: 'place', shop: true },
      { kind: 'place', shop: false },
    ]);
    expect(state.inShop).toBe(false);
  });

  it('counts any screen opened from the shop as in it, even when its front was never read', () => {
    const { state, events } = fold([frame({ screen: 'fusion' })]);
    expect(places(events)).toEqual([{ kind: 'place', shop: true }]);
    expect(state.inShop).toBe(true);
  });

  it('stays put through popups and frames that name nothing', () => {
    // Arrange: in the shop.
    const inShop = fold([frame({ screen: 'shop' })]).state;
    // Act
    const { state, events } = fold([popup(match(9091)), frame({}), frame({ screen: null })], inShop);
    // Assert
    expect(places(events)).toEqual([]);
    expect(state.inShop).toBe(true);
  });

  it('leaves at a pack picker too', () => {
    const inShop = fold([frame({ screen: 'sell' })]).state;
    const { state } = fold([frame({ screen: 'packSelect', floor: 3 })], inShop);
    expect(state.inShop).toBe(false);
  });
});
