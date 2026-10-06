/**
 * A small dense simplex for the search's root bound (M84) and its branch and bound (M87).
 *
 * Solves  maximize c·x  subject to  A x ≤ b,  0 ≤ x ≤ upper,  with every b ≥ 0 — so the origin is
 * feasible and no first phase is needed. Bland's rule picks both the entering and the leaving
 * variable, which rules out cycling and makes the answer a pure function of the input: the planner
 * has to be deterministic, and this only does IEEE arithmetic in a fixed order.
 *
 * Upper bounds are kept out of the tableau (M87): a variable at its bound is complemented
 * (x' = upper - x) instead of costing a row of its own. And a solved tableau can fix variables and
 * solve again from where it stands (`fix`, `resolve`): the branch and bound's children differ from
 * their parent by one fixed variable, and the dual simplex gets there in a few pivots where solving
 * from scratch took a hundred.
 *
 * The problems it sees have a few hundred rows; a dense tableau is the simplest thing that is fast
 * enough. A pivot budget that runs out means no answer (the caller then has no bound, not a wrong
 * one).
 */
export function maximizeLp(c: number[], rows: number[][], b: number[], maxPivots = 5_000): number | null {
  return solveLp(c, rows, b, maxPivots)?.value ?? null;
}

/**
 * `maximizeLp` with the optimal point as well: `x[j]` for each of the `c.length` variables.
 * `upper[j]` bounds variable j from above (none when left out).
 */
export function solveLp(
  c: number[],
  rows: number[][],
  b: number[],
  maxPivots = 5_000,
  upper?: readonly number[],
): { value: number; x: Float64Array } | null {
  const lp = Tableau.build(c, rows, b, upper);
  return lp.resolve(maxPivots) === 'optimal' ? { value: lp.value(), x: lp.point() } : null;
}

const EPS = 1e-9;

export class Tableau {
  private constructor(
    /** Constraint rows, slacks included; the last entry of a row is its basic variable's value. */
    private readonly t: Float64Array[],
    /** The objective row: negated reduced costs, and the objective's value last. */
    private readonly objective: Float64Array,
    private readonly basis: Int32Array,
    /** 1 for the variables in `basis`. */
    private readonly inBasis: Uint8Array,
    /** The bound each variable's complement is taken against (Infinity for the slacks). */
    private readonly cap: Float64Array,
    /** The bound in force: `cap`, or 0 for a variable fixed where it stands. */
    private readonly ub: Float64Array,
    /** Variables standing for cap - x rather than x. */
    private readonly flipped: Uint8Array,
    private readonly n: number,
  ) {}

  static build(c: number[], rows: number[][], b: number[], upper?: readonly number[]): Tableau {
    const m = rows.length;
    const n = c.length;
    const width = n + m + 1;
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
    const cap = new Float64Array(n + m).fill(Number.POSITIVE_INFINITY);
    for (let j = 0; j < n; j += 1) cap[j] = upper?.[j] ?? Number.POSITIVE_INFINITY;
    const inBasis = new Uint8Array(n + m);
    inBasis.fill(1, n);
    return new Tableau(
      t,
      objective,
      Int32Array.from({ length: m }, (_, i) => n + i),
      inBasis,
      cap,
      Float64Array.from(cap),
      new Uint8Array(n + m),
      n,
    );
  }

  clone(): Tableau {
    return new Tableau(
      this.t.map((row) => Float64Array.from(row)),
      Float64Array.from(this.objective),
      Int32Array.from(this.basis),
      Uint8Array.from(this.inBasis),
      this.cap,
      Float64Array.from(this.ub),
      Uint8Array.from(this.flipped),
      this.n,
    );
  }

  value(): number {
    return this.objective[this.objective.length - 1]!;
  }

  /** Each original variable's value. */
  point(): Float64Array {
    const last = this.objective.length - 1;
    const x = new Float64Array(this.n);
    this.basis.forEach((v, i) => {
      if (v < this.n) x[v] = this.t[i]![last]!;
    });
    for (let j = 0; j < this.n; j += 1) if (this.flipped[j]) x[j] = this.cap[j]! - x[j]!;
    return x;
  }

  /**
   * For original variable `j` off the basis: what moving it to its other bound costs the objective
   * at least (the reduced cost), and where it stands. Null for a basic or fixed variable.
   */
  nonbasic(j: number): { cost: number; at: number } | null {
    if (this.inBasis[j] || this.ub[j] === 0) return null;
    return { cost: this.objective[j]!, at: this.flipped[j] ? this.cap[j]! : 0 };
  }

  /**
   * Hold original variable `j` at `value` (0 or its cap) from now on. The tableau may be left
   * infeasible; `resolve` repairs it.
   */
  fix(j: number, value: number): void {
    const row = this.inBasis[j] ? this.basis.indexOf(j) : -1;
    const internal = this.flipped[j] ? this.cap[j]! - value : value;
    if (row >= 0) {
      if (internal !== 0) this.complementBasic(row);
    } else if (internal !== 0) this.complementColumn(j);
    this.ub[j] = 0;
  }

  /**
   * Bring the tableau to an optimum: the dual simplex while some basic variable is out of its
   * bounds, then the primal simplex. 'infeasible' when no point meets the bounds, null when the
   * pivot budget runs out.
   */
  resolve(maxPivots: number): 'optimal' | 'infeasible' | null {
    const last = this.objective.length - 1;
    const { t, objective, basis, inBasis, ub } = this;
    const m = t.length;
    for (let pivots = 0; ; pivots += 1) {
      if (pivots > maxPivots) return null;
      // Dual step: the lowest-numbered basic variable out of its bounds leaves.
      let leave = -1;
      for (let i = 0; i < m; i += 1) {
        const value = t[i]![last]!;
        const v = basis[i]!;
        if (value < -EPS || value > ub[v]! + EPS) {
          if (leave < 0 || v < basis[leave]!) leave = i;
        }
      }
      if (leave >= 0) {
        const v = basis[leave]!;
        if (t[leave]![last]! > ub[v]! + EPS && ub[v] === this.cap[v]) this.complementBasic(leave);
        const below = t[leave]![last]! < 0;
        const row = t[leave]!;
        let enter = -1;
        let ratio = Number.POSITIVE_INFINITY;
        for (let k = 0; k < last; k += 1) {
          if (ub[k] === 0 || inBasis[k]) continue;
          const a = below ? -row[k]! : row[k]!;
          if (a <= EPS) continue;
          const r = objective[k]! / a;
          if (r < ratio - EPS) {
            ratio = r;
            enter = k;
          }
        }
        if (enter < 0) return 'infeasible';
        this.pivot(leave, enter);
        continue;
      }
      // Primal step.
      let enter = -1;
      for (let j = 0; j < last; j += 1) {
        if (objective[j]! < -EPS && ub[j] !== 0) {
          enter = j;
          break;
        }
      }
      if (enter < 0) return 'optimal';
      // Ratio test: a basic variable reaching 0 or its bound, or the entering one its own bound.
      let leaveRow = -1;
      let toBound = false;
      let ratio = ub[enter]!;
      let leavingVar = enter;
      for (let i = 0; i < m; i += 1) {
        const a = t[i]![enter]!;
        const v = basis[i]!;
        let r: number;
        let atBound: boolean;
        if (a > EPS) {
          r = t[i]![last]! / a;
          atBound = false;
        } else if (a < -EPS && Number.isFinite(ub[v]!)) {
          r = (ub[v]! - t[i]![last]!) / -a;
          atBound = true;
        } else continue;
        if (r < ratio - EPS || (Math.abs(r - ratio) <= EPS && v < leavingVar)) {
          ratio = r;
          leaveRow = i;
          toBound = atBound;
          leavingVar = v;
        }
      }
      if (leaveRow < 0) {
        // Unbounded cannot happen for the bound's problems (every variable is capped); give up anyway.
        if (!Number.isFinite(ratio)) return null;
        this.complementColumn(enter);
        continue;
      }
      if (toBound) {
        // Leaving at a bound of 0 (a fixed variable) is leaving at 0: nothing to complement.
        if (ub[leavingVar] === this.cap[leavingVar]) this.complementBasic(leaveRow);
      }
      this.pivot(leaveRow, enter);
    }
  }

  private pivot(leave: number, enter: number): void {
    const { t, objective } = this;
    const width = objective.length;
    const pivotRow = t[leave]!;
    const p = pivotRow[enter]!;
    for (let j = 0; j < width; j += 1) pivotRow[j] = pivotRow[j]! / p;
    for (let i = 0; i < t.length; i += 1) {
      if (i === leave) continue;
      const row = t[i]!;
      const f = row[enter]!;
      if (f === 0) continue;
      for (let j = 0; j < width; j += 1) row[j] = row[j]! - f * pivotRow[j]!;
    }
    const f = objective[enter]!;
    if (f !== 0) for (let j = 0; j < width; j += 1) objective[j] = objective[j]! - f * pivotRow[j]!;
    this.inBasis[this.basis[leave]!] = 0;
    this.inBasis[enter] = 1;
    this.basis[leave] = enter;
  }

  /** Swap nonbasic column j for its complement: every row, objective included, sees cap - x'. */
  private complementColumn(j: number): void {
    const { t, objective } = this;
    const last = objective.length - 1;
    const u = this.cap[j]!;
    for (const row of t) {
      const a = row[j]!;
      if (a === 0) continue;
      row[last] = row[last]! - a * u;
      row[j] = -a;
    }
    objective[last] = objective[last]! - objective[j]! * u;
    objective[j] = -objective[j]!;
    this.flipped[j] = this.flipped[j]! ^ 1;
  }

  /** Swap the basic variable of row r for its complement. Only its own row mentions it. */
  private complementBasic(r: number): void {
    const row = this.t[r]!;
    const last = row.length - 1;
    const v = this.basis[r]!;
    for (let k = 0; k < last; k += 1) if (k !== v) row[k] = -row[k]!;
    row[last] = this.cap[v]! - row[last]!;
    this.flipped[v] = this.flipped[v]! ^ 1;
  }
}
