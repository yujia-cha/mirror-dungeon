import { describe, expect, it } from 'vitest';
import { CAPTURE_SCREENS, type CaptureLayout } from '../../../core/schema.ts';
import { ICON_SIZE, prepareReference } from '../match-icon.ts';
import {
  fusionShapeOf,
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
    { region: S(0.17), screens: ['purchase'] },
  ],
  names: {
    popup: R(4),
    selected: R(5),
    centerConfirm: R(6),
    mapHeader: R(3),
    mapPack: S(0.35),
    purchase: S(0.36),
  },
  fusion: {
    count: R(7),
    five: [R(8), R(9), R(8), R(9), R(8)],
    three: [R(9), R(8), R(9)],
    ring: [S(0.4), S(0.41), S(0.42), S(0.43), S(0.44)],
  },
  popupIcon: [0.55, 0.3, 0.05, 0.05],
  purchaseIcon: [0.57, 0.3, 0.05, 0.05],
};

/** A reader that answers each region with fixed lines, one set per pass, and logs calls. */
function fakeReader(
  answers: Record<string, { light?: string[]; raw?: string[]; dim?: string[] }>,
  slots: Record<string, Float32Array[]> = {},
) {
  const calls: string[] = [];
  const reader: RegionReader = {
    ocr: async (region, pass) => {
      calls.push(`${region[0]}:${pass}`);
      return answers[String(region[0])]?.[pass] ?? [];
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
    // Five title regions (the purchase dialog since M175), one raw for the marked one: what a frame showing nothing costs.
    expect(ocrCalls).toBe(6);
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

  it('names a sale only among what the run holds, every name while it holds nothing (M151)', async () => {
    // Arrange: the sell list, its selection read as 「작고 나쁜 인형」; the run holds 9993 only.
    const answers = { '0.2': { light: ['E.G.O 기프트 판매'] }, '0.5': { light: ['작고 나쁜 인형'] } };
    const rgba = new Uint8ClampedArray(48 * 48 * 4).fill(255);
    const held = [prepareReference(9993, rgba, 48, 48)];
    // Act
    const holding = await readFrame(fakeReader(answers).reader, LAYOUT, { ...CTX, held });
    const empty = await readFrame(fakeReader(answers).reader, LAYOUT, CTX);
    // Assert: a gift the run does not hold cannot be what it sells.
    expect(holding.frame).toMatchObject({ screen: 'sell' });
    expect(holding.frame.gift?.status).not.toBe('match');
    expect(empty.frame.gift).toMatchObject({ status: 'match', id: 9091 });
  });

  it('names a sale among the held ids even when a held gift’s icon did not load (M154)', async () => {
    // Arrange: the run holds 9091, whose icon failed to load — no reference for it.
    const answers = { '0.2': { light: ['E.G.O 기프트 판매'] }, '0.5': { light: ['작고 나쁜 인형'] } };
    const rgba = new Uint8ClampedArray(48 * 48 * 4).fill(255);
    const ctx = { ...CTX, held: [prepareReference(9993, rgba, 48, 48)], heldIds: [9091, 9993] };
    // Act
    const { frame } = await readFrame(fakeReader(answers).reader, LAYOUT, ctx);
    // Assert
    expect(frame.gift).toMatchObject({ status: 'match', id: 9091 });
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
    expect(frame.ingredients).toEqual({ consumed: [9091, 9993, 9993], unsure: [], filled: 3 });
  });

  it('reads an empty confirm as no gift yet, every filled slot weak (M159)', async () => {
    // Arrange: the dialog is up, its frames empty — 45 dark views per slot, as prepareSlot makes.
    const dark = Array.from({ length: 45 }, () => new Float32Array(ICON_SIZE * ICON_SIZE * 3).fill(3));
    const rgba = new Uint8ClampedArray(48 * 48 * 4).map((_, i) => (i % 4 === 3 ? 255 : (i * 37) % 251));
    const held = prepareReference(9091, rgba, 48, 48);
    const { reader } = fakeReader(
      {
        '0.1': { light: ['선택한 E.G.O 기프트를 조합하시겠습니까?'] },
        '0.7': { light: ['선택한 기프트 3/3'] },
      },
      { '0.8': dark, '0.9': dark },
    );
    // Act
    const { frame } = await readFrame(reader, LAYOUT, { ...CTX, held: [held] });
    // Assert
    expect(frame.ingredients).toEqual({ consumed: [], unsure: [], filled: 3 });
    expect(frame.weakSlots).toBe(3);
  });

  it('counts a slot too close between two candidates as weak (M172)', async () => {
    // Arrange: two held gifts with the same picture — the slot's icon fits both alike, so the
    // slot is ambiguous: it names no gift and must be read again.
    const base = new Uint8ClampedArray(48 * 48 * 4).map((_, i) => (i % 4 === 3 ? 255 : (i * 37) % 251));
    const a = prepareReference(9091, base, 48, 48);
    const b = prepareReference(9092, base, 48, 48);
    const { reader } = fakeReader(
      {
        '0.1': { light: ['선택한 E.G.O 기프트를 조합하시겠습니까?'] },
        '0.7': { light: ['선택한 기프트 1/3'] },
      },
      { '0.8': [a.rgb] },
    );
    // Act
    const { frame } = await readFrame(reader, LAYOUT, { ...CTX, held: [a, b] });
    // Assert
    expect(frame.ingredients).toMatchObject({ consumed: [], unsure: [9091, 9092], filled: 1 });
    expect(frame.weakSlots).toBe(1);
  });

  it('reads the slots alone, no OCR, on a re-read of the confirm (M159)', async () => {
    // Arrange: the icons are in now.
    const rgba = new Uint8ClampedArray(48 * 48 * 4).map((_, i) => (i % 4 === 3 ? 255 : (i * 37) % 251));
    const ref = prepareReference(9993, rgba, 48, 48);
    const { reader, calls } = fakeReader({}, { '0.8': [ref.rgb], '0.9': [ref.rgb] });
    // Act
    const { frame, ocrCalls } = await readFrame(reader, LAYOUT, { ...CTX, materials: [ref], slotsOnly: 2 });
    // Assert
    expect(calls).toEqual([]);
    expect(ocrCalls).toBe(0);
    expect(frame.screen).toBe('fusionConfirm');
    expect(frame.ingredients).toEqual({ consumed: [9993, 9993], unsure: [], filled: 2 });
    expect(frame.weakSlots).toBe(0);
  });

  it('keeps each slot to the candidates of the tier its numeral shows (M152)', async () => {
    // Arrange: a held gift (Ⅰ) whose icon is the same picture as a 잔영 (Ⅱ) — the icons alone tie.
    const rgba = new Uint8ClampedArray(48 * 48 * 4).map((_, i) => (i % 4 === 3 ? 255 : (i * 37) % 251));
    const held = prepareReference(9091, rgba, 48, 48);
    const material = prepareReference(9992, rgba, 48, 48);
    const answers = {
      '0.1': { light: ['선택한 E.G.O 기프트를 조합하시겠습니까?'] },
      '0.7': { light: ['선택한 기프트 1/5'] },
    };
    const base = { ...CTX, held: [held], materials: [material] };
    const tiers = new Map([
      [9091, 1],
      [9992, 2],
    ]);
    const withTier = (numeral: number[] | null) => {
      const { reader } = fakeReader(answers, { '0.8': [held.rgb] });
      return { ...reader, tier: async () => numeral };
    };
    // Act
    const tie = await readFrame(withTier(null), LAYOUT, { ...base, tiers });
    const residue = await readFrame(withTier([2]), LAYOUT, { ...base, tiers });
    const gift = await readFrame(withTier([1]), LAYOUT, { ...base, tiers });
    // Assert: unread, the tie is asked; read, the numeral settles it either way.
    expect(tie.frame.ingredients).toMatchObject({ consumed: [], unsure: [9091, 9992] });
    expect(residue.frame.ingredients).toMatchObject({ consumed: [9992], unsure: [] });
    expect(gift.frame.ingredients).toMatchObject({ consumed: [9091], unsure: [] });
    expect(residue.trace.find((step) => step.step === 'slots')?.slots?.tiers).toEqual([[2]]);
  });

  it('ranks every candidate after all when nothing of the numeral’s tier looks like the icon (M152)', async () => {
    // Arrange: the numeral reads Ⅲ (yellow art beside it), but the only Ⅲ candidate is unlike the icon.
    const rgba = new Uint8ClampedArray(48 * 48 * 4).map((_, i) => (i % 4 === 3 ? 255 : (i * 37) % 251));
    const held = prepareReference(9091, rgba, 48, 48);
    const unlike = prepareReference(
      9993,
      rgba.map((v, i) => (i % 4 === 3 ? 255 : 255 - v)),
      48,
      48,
    );
    const { reader } = fakeReader(
      {
        '0.1': { light: ['선택한 E.G.O 기프트를 조합하시겠습니까?'] },
        '0.7': { light: ['선택한 기프트 1/5'] },
      },
      { '0.8': [held.rgb] },
    );
    const tiers = new Map([
      [9091, 1],
      [9993, 3],
    ]);
    // Act
    const { frame } = await readFrame({ ...reader, tier: async () => [3] }, LAYOUT, {
      ...CTX,
      held: [held],
      materials: [unlike],
      tiers,
    });
    // Assert: the misread numeral did not cost the slot its gift.
    expect(frame.ingredients).toMatchObject({ consumed: [9091] });
  });

  it('takes the slot shape the header names over the one that looks more like gifts (M176)', async () => {
    // Arrange: one held gift in the second small slot, the others not in yet. The large slots'
    // regions (9, 8, 9) land the gift twice, so by looks they win — over a 「3/5」 confirm.
    const dark = Array.from({ length: 45 }, () => new Float32Array(ICON_SIZE * ICON_SIZE * 3).fill(3));
    const rgba = new Uint8ClampedArray(48 * 48 * 4).map((_, i) => (i % 4 === 3 ? 255 : (i * 37) % 251));
    const held = prepareReference(9091, rgba, 48, 48);
    const confirm = (header: string) =>
      fakeReader(
        { '0.1': { light: ['선택한 E.G.O 기프트를 조합하시겠습니까?'] }, '0.7': { light: [header] } },
        { '0.8': dark, '0.9': [held.rgb] },
      ).reader;
    const ctx = { ...CTX, held: [held] };
    // Act
    const small = await readFrame(confirm('ㅣ 、_ 선택한 기프트 _ 3/5 ㅣ'), LAYOUT, ctx);
    const large = await readFrame(confirm('ㅣ 、_ 선택한기프트 _ 3/] ㅣ'), LAYOUT, ctx);
    const unread = await readFrame(confirm('ㅣ . 선택한기프트 _ 3 __'), LAYOUT, ctx);
    // Assert: 「/5」 keeps the small slots, the gift once and two slots to read again; 「3/3」 (read
    // 「3/]」) is the large slots; with M unread the looks decide, as before.
    expect(small.frame.ingredients).toEqual({ consumed: [9091], unsure: [], filled: 3 });
    expect(small.frame.weakSlots).toBe(2);
    expect(small.frame.slotShape).toBe('five');
    expect(small.trace.find((step) => step.step === 'slots')?.slots?.shape).toBe('five');
    expect(large.frame.slotShape).toBe('three');
    expect(large.trace.find((step) => step.step === 'slots')?.slots?.shape).toBe('three');
    expect(unread.frame.slotShape).toBeUndefined();
    expect(unread.trace.find((step) => step.step === 'slots')?.slots?.shape).toBe('three');
  });

  it('re-reads the slots in the shape the confirm’s header named (M176)', async () => {
    // Arrange: the same frame as above, re-read alone after a 「3/5」 header.
    const dark = Array.from({ length: 45 }, () => new Float32Array(ICON_SIZE * ICON_SIZE * 3).fill(3));
    const rgba = new Uint8ClampedArray(48 * 48 * 4).map((_, i) => (i % 4 === 3 ? 255 : (i * 37) % 251));
    const held = prepareReference(9091, rgba, 48, 48);
    const { reader } = fakeReader({}, { '0.8': dark, '0.9': [held.rgb] });
    // Act
    const { frame } = await readFrame(reader, LAYOUT, {
      ...CTX,
      held: [held],
      slotsOnly: 3,
      slotsShape: 'five',
    });
    // Assert
    expect(frame.ingredients).toEqual({ consumed: [9091], unsure: [], filled: 3 });
    expect(frame.slotShape).toBe('five');
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
    expect(ocrCalls).toBe(6);
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

describe('readFrame: the map (M148)', () => {
  /** The shipped order: the map header right after the popup, raw only. */
  const MAP_FIRST: CaptureLayout = {
    ...LAYOUT,
    titles: [
      { region: R(0), screens: ['acquired'] },
      { region: R(3), screens: ['exploring'], raw: 'only' },
      { region: R(1), screens: ['fusionConfirm'] },
      { region: R(2), screens: ['sell', 'fusion'] },
    ],
  };

  it('reads a map frame in two calls: the floor and the pack come from the title pass itself', async () => {
    // Arrange
    const { reader, calls } = fakeReader({ '0.3': { raw: ['1증탐사 중', '속하지 못하는'] } });
    // Act
    const { frame, ocrCalls } = await readFrame(reader, MAP_FIRST, CTX);
    // Assert
    expect(frame).toMatchObject({ screen: 'exploring', floor: 1, pack: { status: 'match', id: 1002 } });
    expect(calls).toEqual(['0:light', '0.3:raw']);
    expect(ocrCalls).toBe(2);
  });

  it('reads the region again only for what the title pass lacked', async () => {
    // Arrange: the title pass caught the floor but not the pack's name (mid-transition).
    const { reader, calls } = fakeReader({ '0.3': { raw: ['2증탐사중'] } });
    // Act
    const { frame } = await readFrame(reader, MAP_FIRST, CTX);
    // Assert: no second floor read; the pack is looked for on its own line (M172), then in the
    // whole header in both passes, and not found.
    expect(frame).toMatchObject({ screen: 'exploring', floor: 2, pack: { status: 'none' } });
    expect(calls).toEqual(['0:light', '0.3:raw', '0.35:raw', '0.3:light', '0.3:raw']);
  });

  it('reads a short dim pack name off its own line when the header never shows it (M172)', async () => {
    // Arrange: floor 10's 「교본」 — the whole header reads only the floor in every pass; the name
    // line alone, raw, reads the name.
    const { reader, calls } = fakeReader({
      '0.3': { raw: ['10증탐사 중'], light: [] },
      '0.35': { raw: ['교본'] },
    });
    const packs = [...CTX.packs, { id: 1025, name: '교본' }];
    // Act
    const { frame, ocrCalls } = await readFrame(reader, MAP_FIRST, { ...CTX, packs });
    // Assert: one more call than a header that names both, and no whole-header name reads.
    expect(frame).toMatchObject({ screen: 'exploring', floor: 10, pack: { status: 'match', id: 1025 } });
    expect(calls).toEqual(['0:light', '0.3:raw', '0.35:raw']);
    expect(ocrCalls).toBe(3);
  });

  it('keeps a muddled name-line read when the whole header names nothing (M172)', async () => {
    // Arrange
    const { reader } = fakeReader({
      '0.3': { raw: ['3증탐사 중'] },
      '0.35': { raw: ['가라'] },
    });
    // One jamo from each of two names.
    const packs = [
      { id: 10, name: '가나' },
      { id: 11, name: '가다' },
    ];
    // Act
    const { frame } = await readFrame(reader, MAP_FIRST, { ...CTX, packs });
    // Assert
    expect(frame.pack?.status).toBe('ambiguous');
  });

  it('still lets a popup over the map win', async () => {
    const { reader, calls } = fakeReader({
      '0': { light: ['E.G.O 기프트를 획득했습니다.'] },
      '0.4': { light: ['작고 나쁜 인형'] },
      '0.3': { raw: ['1층 탐사 중', '속하지 못하는'] },
    });
    const { frame } = await readFrame(reader, MAP_FIRST, CTX);
    expect(frame.screen).toBe('acquired');
    expect(calls).toEqual(['0:light', '0.4:light']);
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

describe('fusionShapeOf (M176)', () => {
  it('reads the shape from M as raw OCR leaves it', () => {
    expect(fusionShapeOf(['ㅣ 、_ 선택한 기프트 _ 3/5 ㅣ'])).toBe('five');
    expect(fusionShapeOf(['선택한 기프트 2/5'])).toBe('five');
    expect(fusionShapeOf(['ㅣ 、_ 선택한 기프트 _ 3/1 ㅣ'])).toBe('three');
    expect(fusionShapeOf(['ㅣ 、_ 선택한기프트 _ 3/] ㅣ'])).toBe('three');
    expect(fusionShapeOf(['선택한 기프트 3/3'])).toBe('three');
  });

  it('says nothing without M, or with an M no confirm prints', () => {
    expect(fusionShapeOf(['ㅣ . 선택한기프트  ]'])).toBeNull();
    expect(fusionShapeOf(['ㅣ . 선택한기프트 _ 3 __'])).toBeNull();
    expect(fusionShapeOf(['선택한 기프트 3/'])).toBeNull();
    expect(fusionShapeOf(['선택한 기프트 3/8'])).toBeNull();
    expect(fusionShapeOf([])).toBeNull();
  });
});

describe('screen titles and the layout schema', () => {
  it('keep one order of screens', () => {
    expect(Object.keys(SCREEN_TITLES)).toEqual([...CAPTURE_SCREENS]);
  });
});

describe('readFrame on a strained machine (M142, `lean`)', () => {
  /** The test layout with the pack picker's title, raw-marked, before the map header. */
  const WITH_PACKS: CaptureLayout = {
    ...LAYOUT,
    titles: [
      ...LAYOUT.titles.slice(0, -1),
      { region: [0.25, 0, 0.05, 0.05], screens: ['packSelect'], raw: true },
      LAYOUT.titles.at(-1)!,
    ],
  };

  it('skips the pack picker’s raw pass once the start is closed, and nothing else', async () => {
    // Arrange: a frame of nothing.
    const { reader, calls } = fakeReader({});
    // Act
    const lean = await readFrame(reader, WITH_PACKS, { ...CTX, lean: true });
    const full = await readFrame(fakeReader({}).reader, WITH_PACKS, CTX);
    // Assert: the map header keeps both passes.
    expect(calls).toContain('0.25:light');
    expect(calls).not.toContain('0.25:raw');
    expect(calls).toContain('0.3:raw');
    expect(lean.ocrCalls).toBe(full.ocrCalls - 1);
  });

  it('keeps the pack picker’s raw pass while the start is open: it closes the start', async () => {
    // Arrange: the pack picker, which only the raw pass reads.
    const { reader, calls } = fakeReader({ '0.25': { light: [], raw: ['1층 테마팩 선택'] } });
    // Act
    const { frame } = await readFrame(reader, WITH_PACKS, { ...CTX, lean: true, startOpen: true });
    // Assert
    expect(frame.screen).toBe('packSelect');
    expect(calls).toContain('0.25:raw');
  });

  it('reads a popup the same, lean or not', async () => {
    // Arrange
    const answers = {
      '0': { light: ['E.G.O 기프트를 획득했습니다.'] },
      '0.4': { light: [], raw: ['작고 나쁜 인형'] },
    };
    // Act
    const lean = await readFrame(fakeReader(answers).reader, WITH_PACKS, { ...CTX, lean: true });
    const full = await readFrame(fakeReader(answers).reader, WITH_PACKS, CTX);
    // Assert
    expect(lean.frame).toEqual(full.frame);
    expect(lean.ocrCalls).toBe(full.ocrCalls);
  });
});

describe('readFrame: the shop heading’s dim-text pass (M159)', () => {
  const SHOP: CaptureLayout = {
    ...LAYOUT,
    titles: [
      { region: R(0), screens: ['acquired'] },
      { region: R(2), screens: ['shop'], dim: true, raw: 'only' },
    ],
  };
  const IN_PACK = { ...CTX, startOpen: false };

  it('names the shop from the dim-text pass, with no raw pass after it', async () => {
    // Arrange: the brown 「상점」 the raw pass reads as 「사저」.
    const { reader, calls } = fakeReader({ '0.2': { dim: ['상점'], raw: ['사저'] } });
    // Act
    const { frame, trace } = await readFrame(reader, SHOP, IN_PACK);
    // Assert
    expect(frame.screen).toBe('shop');
    expect(calls).toEqual(['0:light', '0.2:dim']);
    expect(trace.at(-1)).toMatchObject({ light: false, dim: true, accepted: true });
  });

  it('falls back to the raw pass when the dim one names nothing', async () => {
    // Arrange
    const { reader, calls } = fakeReader({ '0.2': { dim: ['둘'], raw: ['특별한 상점'] } });
    // Act
    const { frame, trace } = await readFrame(reader, SHOP, IN_PACK);
    // Assert
    expect(frame.screen).toBe('shop');
    expect(calls).toEqual(['0:light', '0.2:dim', '0.2:raw']);
    expect(trace.at(-1)).toMatchObject({ light: false, accepted: true });
    expect(trace.at(-1)).not.toHaveProperty('dim');
  });
});

describe('readFrame: a reprint’s map header (M159)', () => {
  const PACKS = [
    { id: 1105, name: '시간살인시간' },
    { id: 1120, name: '시간살인시간 BokGak' },
  ];

  it('names the reprint by the logo the OCR reads as digits behind its name', async () => {
    // Arrange: the header the owner's run asked about.
    const { reader } = fakeReader({ '0.3': { light: ['7증탐사 중', '시간살인시간 80<68<'] } });
    // Act
    const { frame } = await readFrame(reader, LAYOUT, { ...CTX, packs: PACKS });
    // Assert
    expect(frame).toMatchObject({ screen: 'exploring', floor: 7, pack: { status: 'match', id: 1120 } });
  });
});

describe('readFrame: the purchase dialog and the fusion screen ring (M175)', () => {
  it('names the gift the purchase dialog shows', async () => {
    // Arrange
    const { reader } = fakeReader({
      '0.17': { light: ['E.G.O 기프트 구매'] },
      '0.36': { light: ['작고 나쁜 인형'] },
    });
    // Act
    const { frame } = await readFrame(reader, LAYOUT, CTX);
    // Assert
    expect(frame.screen).toBe('purchase');
    expect(frame.gift).toMatchObject({ status: 'match', id: 9091 });
  });

  it('reads the ring for the gifts it surely shows, leaving the weak slots out', async () => {
    // Arrange: two slots show the 빛나는 잔영, one the held gift, two show nothing like either.
    const material = iconOf(9993, 1);
    const held = iconOf(9091, 2);
    const unlike = iconOf(9000, 3);
    const { reader } = fakeReader(
      { '0.2': { light: ['E.G.O 기프트 합성'] } },
      {
        '0.4': [held.rgb],
        '0.41': [material.rgb],
        '0.42': [material.rgb],
        '0.43': [unlike.rgb],
        '0.44': [unlike.rgb],
      },
    );
    // Act
    const { frame, trace } = await readFrame(reader, LAYOUT, { ...CTX, held: [held], materials: [material] });
    // Assert
    expect(frame.screen).toBe('fusion');
    expect(frame.ring).toEqual([9091, 9993, 9993]);
    expect(trace.find((s) => s.step === 'slots')?.slots?.shape).toBe('ring');
  });

  it("keeps a slot's ranking while its picture is the same, and ranks a changed one (ringMemo)", async () => {
    // Arrange: a read that ranks the held gift in the first slot, then the same picture against a
    // reference of the same id that no longer looks like it — the memo answers, not the icons.
    const held = iconOf(9091, 2);
    const unlike = iconOf(9091, 9);
    const answers = { '0.2': { light: ['E.G.O 기프트 합성'] } };
    const ringMemo = new Map();
    const first = fakeReader(answers, { '0.4': [held.rgb] });
    await readFrame(first.reader, LAYOUT, { ...CTX, held: [held], ringMemo });
    // Act
    const same = await readFrame(first.reader, LAYOUT, { ...CTX, held: [unlike], ringMemo });
    const changed = await readFrame(fakeReader(answers, { '0.4': [iconOf(9000, 5).rgb] }).reader, LAYOUT, {
      ...CTX,
      held: [unlike],
      ringMemo,
    });
    // Assert
    expect(same.frame.ring).toEqual([9091]);
    expect(changed.frame.ring).toEqual([]);
  });

  it('does not read the ring when the run holds nothing to match', async () => {
    // Arrange
    const { reader } = fakeReader({ '0.2': { light: ['E.G.O 기프트 합성'] } });
    // Act
    const { frame } = await readFrame(reader, LAYOUT, CTX);
    // Assert
    expect(frame.screen).toBe('fusion');
    expect(frame.ring).toBeUndefined();
  });
});
