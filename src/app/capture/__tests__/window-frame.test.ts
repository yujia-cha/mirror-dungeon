import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { captureLayoutSchema } from '../../../core/schema.ts';
import type { Region } from '../preprocess.ts';
import {
  layoutInFrame,
  regionInFrame,
  TITLE_BAR_MAX,
  titleBarHeight,
  titleBarRows,
} from '../window-frame.ts';

const W = 400;

type Rgb = readonly [number, number, number];
const LIGHT: Rgb = [243, 243, 243];
const DARK_BAR: Rgb = [32, 32, 32];
const GAME: Rgb = [8, 6, 10];

/** An RGBA frame `rows` tall: `band` rows of `bar` over the game colour. */
function frame(rows: number, band: number, bar: Rgb, game: Rgb = GAME): Uint8ClampedArray {
  const out = new Uint8ClampedArray(W * rows * 4);
  for (let y = 0; y < rows; y++) {
    const [r, g, b] = y < band ? bar : game;
    for (let x = 0; x < W; x++) out.set([r, g, b, 255], (y * W + x) * 4);
  }
  return out;
}

/** Paint dark text pixels into the band: a block of the left fifth of rows `from`–`to`. */
function withText(rgba: Uint8ClampedArray, from: number, to: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rgba);
  for (let y = from; y < to; y++)
    for (let x = 10; x < 10 + W / 5; x += 2) out.set([20, 20, 20, 255], (y * W + x) * 4);
  return out;
}

describe('titleBarHeight', () => {
  it('finds a light title bar over the game', () => {
    // Arrange: the owner's session — 30 light rows over a dark game, 1043 rows in all.
    const rows = titleBarRows(1043);
    const rgba = frame(rows, 30, LIGHT);

    // Act
    const top = titleBarHeight(rgba, W, rows, 1043);

    // Assert
    expect(top).toBe(30);
  });

  it('finds a dark title bar over a darker game', () => {
    // Arrange
    const rows = titleBarRows(1043);
    const rgba = frame(rows, 31, DARK_BAR);

    // Act
    const top = titleBarHeight(rgba, W, rows, 1043);

    // Assert
    expect(top).toBe(31);
  });

  it('keeps a bar whose title text and buttons break up some rows', () => {
    // Arrange
    const rows = titleBarRows(1043);
    const rgba = withText(frame(rows, 30, LIGHT), 8, 22);

    // Act
    const top = titleBarHeight(rgba, W, rows, 1043);

    // Assert
    expect(top).toBe(30);
  });

  it('gives 0 for a client-only frame whose top is the game', () => {
    // Arrange: game content from the first row — a bright line low down, nothing at the top.
    const rows = titleBarRows(1009);
    const rgba = frame(rows, 0, LIGHT, [120, 40, 30]);

    // Act
    const top = titleBarHeight(rgba, W, rows, 1009);

    // Assert
    expect(top).toBe(0);
  });

  it('gives 0 for an all-black frame', () => {
    // Arrange
    const rows = titleBarRows(1009);
    const rgba = frame(rows, rows, [0, 0, 0]);

    // Act
    const top = titleBarHeight(rgba, W, rows, 1009);

    // Assert
    expect(top).toBe(0);
  });

  it('gives 0 for an all-white frame', () => {
    // Arrange
    const rows = titleBarRows(1009);
    const rgba = frame(rows, rows, [255, 255, 255]);

    // Act
    const top = titleBarHeight(rgba, W, rows, 1009);

    // Assert
    expect(top).toBe(0);
  });

  it('does not take a black band above the game for a bar', () => {
    // Arrange: a letterbox, or the game's own dark top over something brighter.
    const rows = titleBarRows(1009);
    const rgba = frame(rows, 30, [2, 2, 2], [180, 160, 140]);

    // Act
    const top = titleBarHeight(rgba, W, rows, 1009);

    // Assert
    expect(top).toBe(0);
  });

  it('gives 0 for a band taller than a title bar', () => {
    // Arrange: 100 uniform rows in a 1440-row frame (8% would allow 115, the cap is 80).
    const rows = 120;
    const rgba = frame(rows, TITLE_BAR_MAX + 20, LIGHT);

    // Act
    const top = titleBarHeight(rgba, W, rows, 1440);

    // Assert
    expect(top).toBe(0);
  });

  it('gives 0 for a band over 8% of a short frame', () => {
    // Arrange: 30 rows of a 300-row frame is 10%.
    const rgba = frame(60, 30, LIGHT);

    // Act
    const top = titleBarHeight(rgba, W, 60, 300);

    // Assert
    expect(top).toBe(0);
  });

  it('gives 0 for a band too thin to be a bar', () => {
    // Arrange
    const rows = titleBarRows(1043);
    const rgba = frame(rows, 8, LIGHT);

    // Act
    const top = titleBarHeight(rgba, W, rows, 1043);

    // Assert
    expect(top).toBe(0);
  });
});

describe('titleBarRows', () => {
  it('reads the tallest bar and the row under it, never past the frame', () => {
    // Arrange + Act + Assert
    expect(titleBarRows(1043)).toBe(TITLE_BAR_MAX + 1);
    expect(titleBarRows(300)).toBe(25);
    expect(titleBarRows(0)).toBe(0);
  });
});

describe('regionInFrame / layoutInFrame', () => {
  const layout = captureLayoutSchema.parse(
    JSON.parse(readFileSync('data/curated/capture-layout.json', 'utf8')),
  );

  it('leaves the layout as it is without a bar', () => {
    // Arrange + Act
    const moved = layoutInFrame(layout, 0, 1009);

    // Assert
    expect(moved).toEqual(layout);
  });

  it('maps the client top to the bar bottom and the client bottom to the frame bottom', () => {
    // Arrange
    const whole: Region = [0.1, 0, 0.5, 1];

    // Act
    const [x, y, w, h] = regionInFrame(whole, 30, 1043);

    // Assert: x and width stay; the region spans rows 30–1043.
    expect([x, w]).toEqual([0.1, 0.5]);
    expect(y * 1043).toBeCloseTo(30, 9);
    expect((y + h) * 1043).toBeCloseTo(1043, 9);
  });

  it('puts the full-screen title where the 30px bar pushed it', () => {
    // Arrange: the title region in client pixels of the 1013-row client under the bar.
    const title = layout.titles.find((t) => t.screens.includes('packSelect'))!.region;

    // Act
    const [, y, , h] = regionInFrame(title, 30, 1043);

    // Assert
    expect(y * 1043).toBeCloseTo(30 + title[1] * 1013, 6);
    expect(h * 1043).toBeCloseTo(title[3] * 1013, 6);
  });

  it('moves every region and keeps the moved layout valid', () => {
    // Arrange + Act
    const moved = layoutInFrame(layout, 30, 1043);

    // Assert
    expect(captureLayoutSchema.safeParse(moved).success).toBe(true);
    expect(moved.reference).toEqual(layout.reference);
    const all = (l: typeof layout) => [
      ...l.titles.map((t) => t.region),
      ...Object.values(l.names),
      l.fusion.count,
      ...l.fusion.five,
      ...l.fusion.three,
    ];
    const before = all(layout);
    all(moved).forEach((region, i) => {
      expect(region[1]).toBeGreaterThan(before[i]![1]);
      expect(region[3]).toBeLessThan(before[i]![3]);
      expect(region[0]).toBe(before[i]![0]);
      expect(region[2]).toBe(before[i]![2]);
    });
  });
});
