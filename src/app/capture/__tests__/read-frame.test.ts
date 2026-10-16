import { describe, expect, it } from 'vitest';
import { CAPTURE_SCREENS, type CaptureLayout } from '../../../core/schema.ts';
import { ICON_SIZE, prepareReference } from '../match-icon.ts';
import { parseFusionCount, readFrame, type ReadContext, type RegionReader } from '../read-frame.ts';
import { SCREEN_TITLES } from '../screens.ts';

const R = (n: number): [number, number, number, number] => [n / 10, 0, 0.05, 0.05];
const LAYOUT: CaptureLayout = {
  reference: { width: 1920, height: 1009 },
  titles: [
    { region: R(0), screens: ['acquired'] },
    { region: R(1), screens: ['fusionConfirm'] },
    { region: R(2), screens: ['sell', 'fusion'] },
    { region: R(3), screens: ['exploring'] },
  ],
  names: { popup: R(4), selected: R(5), centerConfirm: R(6), mapHeader: R(3) },
  fusion: { count: R(7), five: [R(8), R(9), R(8), R(9), R(8)], three: [R(9), R(8), R(9)] },
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

  it('reads raw when the light pass finds nothing (the brown-on-red map header)', async () => {
    const { reader, calls } = fakeReader({ '0.3': { light: [], raw: ['1층 탐사 중', '속하지 못하는'] } });
    const { frame } = await readFrame(reader, LAYOUT, CTX);
    expect(frame).toMatchObject({ screen: 'exploring', floor: 1, pack: { status: 'match', id: 1002 } });
    expect(calls.slice(0, 8)).toEqual([
      '0:light',
      '0:raw',
      '0.1:light',
      '0.1:raw',
      '0.2:light',
      '0.2:raw',
      '0.3:light',
      '0.3:raw',
    ]);
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
