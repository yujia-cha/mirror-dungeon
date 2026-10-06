import { describe, expect, it } from 'vitest';
import { maximizeLp, solveLp, Tableau } from '../lp.ts';

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

describe('bounded variables and warm starts (M87)', () => {
  // Seeded random problems shaped like the goal relaxation: non-negative right-hand sides, every
  // variable in [0, 1].
  let seed = 20261006;
  const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const problem = () => {
    const n = 3 + Math.floor(next() * 6);
    const m = 2 + Math.floor(next() * 6);
    const c = Array.from({ length: n }, () => Math.floor(next() * 5) - 1);
    const rows = Array.from({ length: m }, () => Array.from({ length: n }, () => Math.floor(next() * 5) - 2));
    const b = Array.from({ length: m }, () => Math.floor(next() * 4));
    return { n, c, rows, b };
  };
  const caps = (n: number) =>
    Array.from({ length: n }, (_, j) => {
      const row = new Array<number>(n).fill(0);
      row[j] = 1;
      return { row, b: 1 };
    });

  it('keeps upper bounds out of the tableau and gets the same optimum as with rows for them', () => {
    for (let k = 0; k < 200; k += 1) {
      const { n, c, rows, b } = problem();
      const bounded = solveLp(c, rows, b, 5_000, new Array<number>(n).fill(1));
      const extra = caps(n);
      const explicit = maximizeLp(c, [...rows, ...extra.map((e) => e.row)], [...b, ...extra.map((e) => e.b)]);
      expect(bounded).not.toBeNull();
      expect(bounded!.value).toBeCloseTo(explicit!, 6);
      for (let j = 0; j < n; j += 1) {
        expect(bounded!.x[j]).toBeGreaterThanOrEqual(-1e-9);
        expect(bounded!.x[j]).toBeLessThanOrEqual(1 + 1e-9);
      }
    }
  });

  it('fixes variables of a solved tableau and solves on to what solving from scratch gives', () => {
    let infeasible = 0;
    let compared = 0;
    for (let k = 0; k < 200; k += 1) {
      const { n, c, rows, b } = problem();
      const lp = Tableau.build(c, rows, b, new Array<number>(n).fill(1));
      expect(lp.resolve(5_000)).toBe('optimal');
      // Fix two variables, each to 0 or 1, one at a time as the branch and bound does.
      const fixed = new Map<number, number>();
      let node = lp;
      for (const j of [Math.floor(next() * n), Math.floor(next() * n)]) {
        if (fixed.has(j)) continue;
        const value = next() < 0.5 ? 0 : 1;
        fixed.set(j, value);
        node = node.clone();
        node.fix(j, value);
        const status = node.resolve(5_000);
        if (status === 'infeasible') {
          infeasible += 1;
          break;
        }
        expect(status).toBe('optimal');
        // The point it stands on is feasible, holds the fixed values, and is worth what it says.
        const x = node.point();
        for (const [f, v] of fixed) expect(x[f]).toBeCloseTo(v, 9);
        rows.forEach((row, i) =>
          expect(row.reduce((sum, a, f) => sum + a * x[f]!, 0)).toBeLessThanOrEqual(b[i]! + 1e-9),
        );
        expect(node.value()).toBeCloseTo(
          c.reduce((sum, cf, f) => sum + cf * x[f]!, 0),
          9,
        );
        // And optimal: with the fixed values moved to the right-hand side, solving from scratch
        // (which needs that side non-negative) gives the same.
        const shifted = b.map((bi, i) => bi - [...fixed].reduce((sum, [f, v]) => sum + rows[i]![f]! * v, 0));
        if (shifted.some((v) => v < 0)) continue;
        compared += 1;
        const free = [...Array(n).keys()].filter((f) => !fixed.has(f));
        const scratch = solveLp(
          free.map((f) => c[f]!),
          rows.map((row) => free.map((f) => row[f]!)),
          shifted,
          5_000,
          free.map(() => 1),
        )!;
        const constant = [...fixed].reduce((sum, [f, v]) => sum + c[f]! * v, 0);
        expect(node.value()).toBeCloseTo(scratch.value + constant, 6);
      }
    }
    // Both kinds of node turn up.
    expect(infeasible).toBeGreaterThan(5);
    expect(compared).toBeGreaterThan(100);
  });
});
