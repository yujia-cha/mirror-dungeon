/**
 * A small dense simplex for the search's root bound (M84).
 *
 * Solves  maximize c·x  subject to  A x ≤ b,  x ≥ 0,  with every b ≥ 0 — so the origin is feasible
 * and no first phase is needed. Bland's rule picks both the entering and the leaving variable, which
 * rules out cycling and makes the answer a pure function of the input: the planner has to be
 * deterministic, and this only does IEEE arithmetic in a fixed order.
 *
 * The problems it sees have a few hundred rows; a dense tableau is the simplest thing that is fast
 * enough. Returns null when the pivot budget runs out (the caller then has no bound, not a wrong one).
 */
export function maximizeLp(c: number[], rows: number[][], b: number[], maxPivots = 5_000): number | null {
  const m = rows.length;
  const n = c.length;
  const width = n + m + 1;
  // Tableau rows: the constraint rows with their slacks, then the objective row (negated costs).
  const t: Float64Array[] = [];
  for (let i = 0; i < m; i += 1) {
    const row = new Float64Array(width);
    const source = rows[i]!;
    for (let j = 0; j < n; j += 1) row[j] = source[j] ?? 0;
    row[n + i] = 1;
    row[width - 1] = b[i]!;
    t.push(row);
  }
  const objective = new Float64Array(width);
  for (let j = 0; j < n; j += 1) objective[j] = -c[j]!;
  const basis = Array.from({ length: m }, (_, i) => n + i);
  const EPS = 1e-9;

  for (let pivots = 0; ; pivots += 1) {
    if (pivots > maxPivots) return null;
    let enter = -1;
    for (let j = 0; j < width - 1; j += 1) {
      if (objective[j]! < -EPS) {
        enter = j;
        break;
      }
    }
    if (enter < 0) return objective[width - 1]!;
    let leave = -1;
    let ratio = Number.POSITIVE_INFINITY;
    for (let i = 0; i < m; i += 1) {
      const a = t[i]![enter]!;
      if (a <= EPS) continue;
      const r = t[i]![width - 1]! / a;
      if (r < ratio - EPS || (Math.abs(r - ratio) <= EPS && basis[i]! < basis[leave]!)) {
        ratio = r;
        leave = i;
      }
    }
    // Unbounded cannot happen for the bound's problems (every variable is capped); give up anyway.
    if (leave < 0) return null;
    const pivotRow = t[leave]!;
    const p = pivotRow[enter]!;
    for (let j = 0; j < width; j += 1) pivotRow[j] = pivotRow[j]! / p;
    for (let i = 0; i < m; i += 1) {
      if (i === leave) continue;
      const row = t[i]!;
      const f = row[enter]!;
      if (f === 0) continue;
      for (let j = 0; j < width; j += 1) row[j] = row[j]! - f * pivotRow[j]!;
    }
    const f = objective[enter]!;
    for (let j = 0; j < width; j += 1) objective[j] = objective[j]! - f * pivotRow[j]!;
    basis[leave] = enter;
  }
}
