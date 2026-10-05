import { describe, expect, it } from 'vitest';
import { maximizeLp } from '../lp.ts';

describe('maximizeLp', () => {
  it('solves a textbook problem', () => {
    // max 3x + 5y  s.t.  x ≤ 4,  2y ≤ 12,  3x + 2y ≤ 18  →  x = 2, y = 6, 36.
    expect(
      maximizeLp(
        [3, 5],
        [
          [1, 0],
          [0, 2],
          [3, 2],
        ],
        [4, 12, 18],
      ),
    ).toBeCloseTo(36, 9);
  });

  it('gives fractional optima — the root bound floors them itself', () => {
    // Three gifts, each supplied by two of three packs, two floors: 3 copies, LP 3, but x = 2/3 each.
    // max a + b + c  s.t.  a ≤ x1 + x2,  b ≤ x2 + x3,  c ≤ x1 + x3,  each ≤ 1,  x1 + x2 + x3 ≤ 2.
    const rows = [
      [-1, -1, 0, 1, 0, 0],
      [0, -1, -1, 0, 1, 0],
      [-1, 0, -1, 0, 0, 1],
      [0, 0, 0, 1, 0, 0],
      [0, 0, 0, 0, 1, 0],
      [0, 0, 0, 0, 0, 1],
      [1, 1, 1, 0, 0, 0],
    ];
    expect(maximizeLp([0, 0, 0, 1, 1, 1], rows, [0, 0, 0, 1, 1, 1, 2])).toBeCloseTo(3, 9);
  });

  it('is zero with nothing to gain and gives up past the pivot budget', () => {
    expect(maximizeLp([0, 0], [[1, 1]], [5])).toBe(0);
    expect(
      maximizeLp(
        [3, 5],
        [
          [1, 0],
          [0, 2],
          [3, 2],
        ],
        [4, 12, 18],
        0,
      ),
    ).toBeNull();
  });
});
