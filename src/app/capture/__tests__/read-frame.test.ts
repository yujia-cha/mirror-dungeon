import { describe, expect, it } from 'vitest';
import { CAPTURE_SCREENS, type CaptureLayout } from '../../../core/schema.ts';
import { ICON_SIZE, prepareReference } from '../match-icon.ts';
import {
  parseFusionCount,
  POPUP_ICON,
  readFrame,
  type ReadContext,
  type RegionReader,
} from '../read-frame.ts';
import { SCREEN_TITLES } from '../screens.ts';

const R = (n: number): [number, number, number, number] => [n / 10, 0, 0.05, 0.05];
/** A region the fake reader knows by its x, for the run start's (M135). */
const S = (x: number): [number, number, number, number] => [x, 0.5, 0.05, 0.05];
const LAYOUT: CaptureLayout = {
  reference: { width: 1920, height: 1009 },
  titles: [
    { region: R(0), screens: ['acquired'] },
    { region: S(0.15), screens: ['observationSelect'], raw: 'only' },
    { region: S(0.16), screens: ['startGiftSelect'], raw: 'only' },
    { region: R(1), screens: ['fusionConfirm'] },
    { region: R(2), screens: ['sell', 'fusion'] },
    { region: R(3), screens: ['exploring'], raw: true },
  ],
  names: { popup: R(4), selected: R(5), centerConfirm: R(6), mapHeader: R(3) },
  fusion: { count: R(7), five: [R(8), R(9), R(8), R(9), R(8)], three: [R(9), R(8), R(9)] },
  popupIcon: [0.55, 0.3, 0.05, 0.05],
};

/** A reader that answers each region with fixed lines, light pass and raw separately, and logs calls. */
function fakeReader(
  answers: Record<string, { light?: string[]; raw?: string[] }>,
  slots: Record<string, Float32Array[]> = {},
) {
  const calls: string[] = [];
  const reader: RegionReader = {
    ocr: async (region, light) => {
      calls.push(`${region[0]}:${light ? 'light' : 'raw'}`);
      return answers[String(region[0])]?.[light ? 'light' : 'raw'] ?? [];
    },
    slot: async (region) => slots[String(region[0])] ?? [new Float32Array(ICON_SIZE * ICON_SIZE * 3)],
  };
  return { reader, calls };
}

const CTX: ReadContext = {
  lang: 'ko',
  packs: [{ id: 1002, name: '속하지 못하는' }],
  gifts: [
    { id: 9091, name: '작고 나쁠 인형' },
    { id: 9993, name: '빛나는 잔영' },
  ],
  held: [],
  materials: [],
};

describe('readFrame', () => {
  it('stops at the first title region that names a screen, then reads the popup name', async () => {
    // Arrange
    const { reader, calls } = fakeReader({
      '0': { light: ['E.G.O 기프트를 획득했습니다.'] },
      '0.4': { light: ['작고 나쁜 인형'] },
    });
    // Act
    const { frame, ocrCalls } = await readFrame(reader, LAYOUT, CTX);
    // Assert: one title call, one name call; the later title regions are never read.
    expect(frame.screen).toBe('acquired');
    expect(frame.gift).toMatchObject({ status: 'match', id: 9091 });
    expect(calls).toEqual(['0:light', '0.4:light']);
    expect(ocrCalls).toBe(2);
  });

  it('reads raw only for titles marked raw, when the light pass finds nothing (the brown-on-red map header)', async () => {
    // Arrange
    const { reader, calls } = fakeReader({ '0.3': { light: [], raw: ['1층 탐사 중', '속하지 못하는'] } });
    // Act
    const { frame } = await readFrame(reader, LAYOUT, CTX);
    // Assert: the unmarked titles get one light read each; the map header gets both.
    expect(frame).toMatchObject({ screen: 'exploring', floor: 1, pack: { status: 'match', id: 1002 } });
    expect(calls.slice(0, 5)).toEqual(['0:light', '0.1:light', '0.2:light', '0.3:light', '0.3:raw']);
  });

  it('never reads an unmarked title raw, even when only raw would find it', async () => {
    const { reader, calls } = fakeReader({ '0': { light: [], raw: ['E.G.O 기프트를 획득했습니다.'] } });
    const { frame, ocrCalls } = await readFrame(reader, LAYOUT, CTX);
    expect(frame.screen).toBeNull();
    expect(calls).not.toContain('0:raw');
    // Four title regions, one raw for the marked one: what a frame showing nothing costs.
    expect(ocrCalls).toBe(5);
  });

  it('traces every pass: the lines, whether they were taken and what they matched (M112)', async () => {
    // Arrange: the popup title, then a name the light pass misses and raw reads.
    const { reader } = fakeReader({
      '0': { light: ['E.G.O 기프트를 획득했습니다.'] },
      '0.4': { light: ['???'], raw: ['작고 나쁜 인형'] },
    });
    // Act
    const { trace } = await readFrame(reader, LAYOUT, CTX);
    // Assert
    expect(trace.map((s) => [s.step, s.light, s.accepted])).toEqual([
      ['title', true, true],
      ['name', true, false],
      ['name', false, true],
    ]);
    expect(trace[0]).toMatchObject({ screen: 'acquired', lines: ['E.G.O 기프트를 획득했습니다.'] });
    expect(trace[1]!.match).toBeUndefined();
    expect(trace[2]).toMatchObject({ lines: ['작고 나쁜 인형'], match: { status: 'match', id: 9091 } });
  });

  it('does not let a region speak for a screen whose title lives elsewhere', async () => {
    // A dimmed full-screen title read in the popup region must not make it the popup.
    const { reader } = fakeReader({ '0': { light: ['E.G.O 기프트 판매'] } });
    const { frame } = await readFrame(reader, LAYOUT, CTX);
    expect(frame.screen).toBeNull();
  });

  it('reads the fusion confirm slots against held gifts and the materials, materials repeating', async () => {
    // Arrange: two slot views, both exactly the 빛나는 잔영 reference; three of five filled.
    const rgba = new Uint8ClampedArray(48 * 48 * 4).map((_, i) => (i % 4 === 3 ? 255 : (i * 37) % 251));
    const ref = prepareReference(9993, rgba, 48, 48);
    const other = prepareReference(
      9091,
      rgba.map((v, i) => (i % 4 === 3 ? 255 : 255 - v)),
      48,
      48,
    );
    const { reader } = fakeReader(
      {
        '0.1': { light: ['선택한 E.G.O 기프트를 조합하시겠습니까?'] },
        '0.7': { light: ['ㅣ . 선택한기프트 _ 3 __'] },
      },
      { '0.8': [ref.rgb], '0.9': [other.rgb] },
    );
    // Act
    const { frame } = await readFrame(reader, LAYOUT, { ...CTX, held: [other], materials: [ref] });
    // Assert: five-shape slots 8, 9, 8 → 잔영, 인형, 잔영 (the 잔영 fills two slots).
    expect(frame.screen).toBe('fusionConfirm');
    expect(frame.ingredients).toEqual({ consumed: [9091, 9993, 9993], unsure: [] });
  });

  it('leaves the ingredients unread when the header cannot be read', async () => {
    const { reader } = fakeReader({ '0.1': { light: ['선택한 E.G.O 기프트를 조합하시겠습니까?'] } });
    const { frame } = await readFrame(reader, LAYOUT, CTX);
    expect(frame.screen).toBe('fusionConfirm');
    expect(frame.ingredients).toBeUndefined();
  });
});

describe('readFrame at the run start (M135)', () => {
  const START: ReadContext = { ...CTX, startOpen: true };

  it('does not look for the start pickers once the start is closed', async () => {
    // Arrange: the observation title is there, but the run is past the start.
    const { reader, calls } = fakeReader({ '0.15': { raw: ['6.6.0 기프트 관측'] } });
    // Act
    const { frame, ocrCalls } = await readFrame(reader, LAYOUT, CTX);
    // Assert: the start regions cost nothing for the rest of the run.
    expect(frame.screen).toBeNull();
    expect(calls.some((c) => c.startsWith('0.15') || c.startsWith('0.16'))).toBe(false);
    expect(ocrCalls).toBe(5);
  });

  it('pays for the start titles on a frame of nothing: raw only, and no shop titles before floor 1 (M136)', async () => {
    // Arrange: a frame of nothing.
    const { reader, calls } = fakeReader({});
    // Act
    const { frame, ocrCalls } = await readFrame(reader, LAYOUT, START);
    // Assert: popup, the two start titles raw, the map header both ways — the fusion confirm and
    // the shop's full-screen title are not looked for; no more calls than with the start closed.
    expect(frame.screen).toBeNull();
    expect(calls).toEqual(['0:light', '0.15:raw', '0.16:raw', '0.3:light', '0.3:raw']);
    expect(ocrCalls).toBe(5);
  });

  it('names the observation picker and reads nothing else on it — no panel, no count (M136)', async () => {
    // Arrange: the blue title only the raw pass reads.
    const { reader, calls } = fakeReader({ '0.15': { raw: ['6.6.0 기프트 관측'] } });
    // Act
    const { frame } = await readFrame(reader, LAYOUT, START);
    // Assert
    expect(frame.screen).toBe('observationSelect');
    expect(calls.at(-1)).toBe('0.15:raw');
  });

  it('takes the observation picker by its own title, though its panel heading reads as the start one', async () => {
    // Arrange: on the observation picker the start heading region catches the same words.
    const { reader } = fakeReader({
      '0.15': { raw: ['6.6.0 기프트 관측'] },
      '0.16': { light: ['! 젠랙한6@ ㅇ기[므'], raw: ['ㅣ 선택한6&ㅇ기므'] },
    });
    // Act
    const { frame } = await readFrame(reader, LAYOUT, START);
    // Assert
    expect(frame.screen).toBe('observationSelect');
  });

  it('names the start gift picker by its panel heading', async () => {
    const { reader } = fakeReader({ '0.16': { raw: ['선택한6.0 기프트 ㅣ'] } });
    const { frame } = await readFrame(reader, LAYOUT, START);
    expect(frame.screen).toBe('startGiftSelect');
  });

  it('reads what a popup sits over while the start is open — and only then, raw only', async () => {
    // Arrange: the observation title behind the popup, dimmed a syllable off.
    const answers = {
      '0': { light: ['E.G.O 기프트를 획득했습니다.'] },
      '0.4': { light: ['프레스티지 카드'] },
      '0.15': { raw: ['6.6.0 기프트 관즉'] },
    };
    const open = fakeReader(answers);
    const closed = fakeReader(answers);
    // Act
    const during = await readFrame(open.reader, LAYOUT, {
      ...START,
      gifts: [...START.gifts, { id: 9191, name: '프레스티지 카드' }],
    });
    const after = await readFrame(closed.reader, LAYOUT, {
      ...CTX,
      gifts: [...CTX.gifts, { id: 9191, name: '프레스티지 카드' }],
    });
    // Assert
    expect(during.frame).toMatchObject({ screen: 'acquired', overObservation: true });
    expect(during.trace.at(-1)).toMatchObject({ step: 'context', accepted: true, light: false });
    expect(open.calls).toEqual(['0:light', '0.4:light', '0.15:raw']);
    expect(after.frame.overObservation).toBeUndefined();
    expect(closed.calls).toEqual(['0:light', '0.4:light']);
  });

  it('says a popup over anything else is not over the observation picker', async () => {
    const { reader } = fakeReader({
      '0': { light: ['E.G.O 기프트를 획득했습니다.'] },
      '0.4': { light: ['프레스티지 카드'] },
      '0.15': { raw: ['ㅣ] 711'] },
    });
    const { frame } = await readFrame(reader, LAYOUT, {
      ...START,
      gifts: [{ id: 9191, name: '프레스티지 카드' }],
    });
    expect(frame.overObservation).toBe(false);
  });
});

/** A reference icon of a noise pattern of its own: two seeds do not look alike. */
function iconOf(id: number, seed: number) {
  let x = seed;
  const rgba = new Uint8ClampedArray(48 * 48 * 4).map((_, i) => {
    if (i % 4 === 3) return 255;
    x = (x * 1103515245 + 12345) % 2147483648;
    return x % 256;
  });
  return prepareReference(id, rgba, 48, 48);
}

describe('readFrame: the popup icon when the name is unsure (M136)', () => {
  const GIFTS = [
    { id: 9191, name: '프레스티지 카드' },
    { id: 9192, name: '프레스티지 카트' },
    { id: 9243, name: '시험 추출 : 홍염살' },
    { id: 9244, name: '시험 추출 : 초롱' },
    { id: 9245, name: '변형 추출 : AEDD' },
    { id: 9091, name: '작고 나쁠 인형' },
  ];
  const ICONS = new Map(GIFTS.map((g, i) => [g.id, iconOf(g.id, i + 7)]));
  const POPUP = { light: ['E.G.O 기프트를 획득했습니다.'] };

  /** The context, with a loader that records what it was asked for. */
  function withIcons() {
    const asked: number[][] = [];
    const ctx: ReadContext = {
      ...CTX,
      gifts: GIFTS,
      iconRefs: async (ids) => {
        asked.push([...ids]);
        return ids.flatMap((id) => ICONS.get(id) ?? []);
      },
    };
    return { ctx, asked };
  }

  it('tells a name OCR mangles by its icon, among the names the text came closest to', async () => {
    // Arrange: 「변형 추출 : AEDD」 as OCR left it (0.67 — no match), and its icon in the popup.
    const { ctx, asked } = withIcons();
    const { reader } = fakeReader(
      { '0': POPUP, '0.4': { light: ['변형추줄: ^ㅅ600'], raw: ['.벼현 츠출ㆍ ^ㅅ600'] } },
      { '0.55': [ICONS.get(9245)!.rgb] },
    );
    // Act
    const { frame, trace } = await readFrame(reader, LAYOUT, ctx);
    // Assert
    expect(frame.gift).toMatchObject({ status: 'match', id: 9245 });
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain(9245);
    expect(asked[0]!.length).toBeLessThanOrEqual(POPUP_ICON.candidates);
    expect(trace.at(-1)).toMatchObject({
      step: 'icon',
      accepted: true,
      match: { status: 'match', id: 9245 },
    });
  });

  it('settles a name close to two gifts by the icon', async () => {
    // Arrange: 「프레스티지 카」 is as close to 카드 as to 카트; the icon is 카트's.
    const { ctx } = withIcons();
    const { reader } = fakeReader(
      { '0': POPUP, '0.4': { light: ['프레스티지 카'] } },
      { '0.55': [ICONS.get(9192)!.rgb] },
    );
    // Act
    const { frame } = await readFrame(reader, LAYOUT, ctx);
    // Assert
    expect(frame.gift).toMatchObject({ status: 'match', id: 9192 });
  });

  it('keeps the name result when the icon is no clearer — the muddled name is asked as before', async () => {
    // Arrange: an icon that looks like none of the candidates.
    const { ctx } = withIcons();
    const { reader } = fakeReader(
      { '0': POPUP, '0.4': { light: ['프레스티지 카'] } },
      { '0.55': [iconOf(1, 999).rgb] },
    );
    // Act
    const { frame, trace } = await readFrame(reader, LAYOUT, ctx);
    // Assert
    expect(frame.gift).toMatchObject({ status: 'ambiguous', ids: [9191, 9192] });
    expect(trace.at(-1)).toMatchObject({ step: 'icon', accepted: false });
  });

  it('does not look at the icon when the name is a sure match', async () => {
    // Arrange
    const { ctx, asked } = withIcons();
    const { reader } = fakeReader({ '0': POPUP, '0.4': { light: ['작고 나쁜 인형'] } });
    // Act
    const { frame, trace } = await readFrame(reader, LAYOUT, ctx);
    // Assert
    expect(frame.gift).toMatchObject({ status: 'match', id: 9091 });
    expect(asked).toEqual([]);
    expect(trace.some((s) => s.step === 'icon')).toBe(false);
  });

  it('does not guess from the icon when the text is close to no name', async () => {
    // Arrange: nothing in the text resembles a gift, so there is nothing to compare the icon with.
    const { ctx, asked } = withIcons();
    const { reader } = fakeReader(
      { '0': POPUP, '0.4': { light: ['^ㅅ600'] } },
      { '0.55': [ICONS.get(9245)!.rgb] },
    );
    // Act
    const { frame } = await readFrame(reader, LAYOUT, ctx);
    // Assert
    expect(frame.gift).toEqual({ status: 'none' });
    expect(asked).toEqual([]);
  });
});

describe('readFrame: a popup read of the popup burst (M136)', () => {
  it('reads the popup title only, and stops there when no popup shows', async () => {
    // Arrange: a map behind — a full read would find it.
    const { reader, calls } = fakeReader({ '0.3': { raw: ['1층 탐사 중', '속하지 못하는'] } });
    // Act
    const { frame, ocrCalls } = await readFrame(reader, LAYOUT, { ...CTX, startOpen: true, popupOnly: true });
    // Assert: one call, and the frame says it saw only that.
    expect(calls).toEqual(['0:light']);
    expect(ocrCalls).toBe(1);
    expect(frame).toMatchObject({ screen: null, partial: true });
  });

  it('reads a popup in full: its name and, at the start, what it sits over', async () => {
    // Arrange
    const { reader, calls } = fakeReader({
      '0': { light: ['E.G.O 기프트를 획득했습니다.'] },
      '0.4': { light: ['작고 나쁜 인형'] },
      '0.15': { raw: ['E.G.O 기프트 관측'] },
    });
    // Act
    const { frame } = await readFrame(reader, LAYOUT, { ...CTX, startOpen: true, popupOnly: true });
    // Assert
    expect(frame).toMatchObject({
      screen: 'acquired',
      gift: { status: 'match', id: 9091 },
      overObservation: true,
    });
    expect(frame.partial).toBeUndefined();
    expect(calls).toEqual(['0:light', '0.4:light', '0.15:raw']);
  });
});

describe('parseFusionCount', () => {
  it('reads N from the header as OCR leaves it', () => {
    expect(parseFusionCount(['ㅣ . 선택한기프트 _ 3 __'])).toBe(3);
    expect(parseFusionCount(['ㅣ 、_ 선택한기프트 _ 5/5'])).toBe(5);
    expect(parseFusionCount(['선택한 기프트 3/1'])).toBe(3);
  });

  it('returns null without the header or with a count no confirm has', () => {
    expect(parseFusionCount([])).toBeNull();
    expect(parseFusionCount(['선택한 기프트 _ 0'])).toBeNull();
    expect(parseFusionCount(['3/5'])).toBeNull();
  });
});

describe('screen titles and the layout schema', () => {
  it('keep one order of screens', () => {
    expect(Object.keys(SCREEN_TITLES)).toEqual([...CAPTURE_SCREENS]);
  });
});
