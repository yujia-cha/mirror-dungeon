/**
 * Reading a gift or pack name off a screen capture.
 *
 * OCR gets game fonts slightly wrong — a dropped 받침, 「l」 for 「1」, a stray space — but what it
 * reads is always one of a few hundred names we already hold. So this does not trust the text; it
 * picks the closest known name and says how sure it is. Hangul is compared as jamo (NFD splits a
 * syllable into lead, vowel and final), so one misread 받침 costs one edit instead of a whole
 * syllable.
 *
 * Pure: no DOM, no OCR engine. The caller narrows `candidates` by context (the packs open on this
 * floor, the gifts the entered pack can give) — fewer candidates is the main defence against a
 * confident wrong answer.
 */

export interface NameCandidate {
  id: number;
  name: string;
}

export type MatchResult =
  | { status: 'match'; id: number; score: number; margin: number }
  /** Close to something, but not clearly one thing: the UI asks instead of applying. */
  | { status: 'ambiguous'; ids: number[]; score: number; margin: number }
  | { status: 'none' };

export interface MatchThresholds {
  /** Similarity (0..1) the best candidate needs before it counts at all. */
  minScore: number;
  /** How far ahead of the runner-up the best must be to be applied without asking. */
  minMargin: number;
}

export const DEFAULT_THRESHOLDS: MatchThresholds = { minScore: 0.75, minMargin: 0.1 };

/**
 * The comparable form of a name: Unicode-decomposed, lowercase, without whitespace or punctuation.
 * Upgrade marks (「+」「++」) go with the punctuation — the game prints them after the name, the data
 * keeps them in `upgradeLevels`.
 */
export function normalizeName(text: string): string {
  return text
    .normalize('NFD')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, '');
}

/** Levenshtein distance over code points. Names are short (≤ ~40 jamo), so O(n·m) is fine. */
export function editDistance(a: string, b: string): number {
  const x = [...a];
  const y = [...b];
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const row = [i];
    for (let j = 1; j <= y.length; j++) {
      const cost = x[i - 1] === y[j - 1] ? 0 : 1;
      row[j] = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + cost);
    }
    prev = row;
  }
  return prev[y.length]!;
}

/** 1 for identical normalized names, 0 for nothing in common. Empty text never matches. */
export function similarity(text: string, name: string): number {
  const a = normalizeName(text);
  const b = normalizeName(name);
  const longest = Math.max([...a].length, [...b].length);
  if (a === '' || b === '') return 0;
  return 1 - editDistance(a, b) / longest;
}

/**
 * How well `title` appears somewhere inside `text` (0..1): the edit distance of the best-matching
 * stretch of `text` against all of `title`, over the title's length. A banner line often carries
 * more than its title — a price beside it, or a name in the middle of a sentence — and what matters
 * is whether the title is in there.
 */
export function containedSimilarity(text: string, title: string): number {
  const x = [...normalizeName(text)];
  const y = [...normalizeName(title)];
  if (x.length === 0 || y.length === 0) return 0;
  // Rows walk the title, columns the text; starting and ending anywhere in the text is free.
  let prev = new Array<number>(x.length + 1).fill(0);
  for (let i = 1; i <= y.length; i++) {
    const row = [i];
    for (let j = 1; j <= x.length; j++) {
      const cost = y[i - 1] === x[j - 1] ? 0 : 1;
      row[j] = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + cost);
    }
    prev = row;
  }
  return Math.max(0, 1 - Math.min(...prev) / y.length);
}

/**
 * Sentences the game wraps a name in, with the name as the first group: the sell confirm puts it in
 * brackets (「[빛나는 잔영]을(를) 코스트 300에…」), a buff toast says 「…효과로 잔영 획득」, an event
 * result 「E.G.O 기프트 커피와 종이학 획득!」. The name is matched on its own, not inside the sentence.
 */
const NAME_HINTS: readonly RegExp[] = [/\[([^\]]+)\]/g, /효과로\s*(.+?)\s*획득/g, /기프트\s+(.+?)\s*획득/g];

/**
 * The pieces of OCR lines worth matching a name against: each line and its side-by-side parts, the
 * names known sentences wrap, and each pair of neighbouring lines joined — a long name wraps inside
 * its button (「붉게 물든」 / 「목화」), and Tesseract does not always return the two halves in order,
 * so both orders are tried.
 */
export function namePieces(lines: readonly string[]): string[] {
  const own = lines.flatMap((line) => [
    ...line.split(SIDE_BY_SIDE),
    ...NAME_HINTS.flatMap((hint) => [...line.matchAll(hint)].map((m) => m[1]!)),
  ]);
  const joined = lines
    .slice(1)
    .flatMap((line, i) => [joinLines(lines[i]!, line), joinLines(line, lines[i]!)]);
  return [...own, ...joined];
}

/**
 * Two OCR lines as one, without repeating the words where they overlap: Tesseract sometimes reads
 * a wrapped name as 「붉게 물든」 + 「물든 목하」, and 「붉게 물든 목하」 is what the button says.
 */
function joinLines(first: string, second: string): string {
  const a = first.trim().split(/\s+/);
  const b = second.trim().split(/\s+/);
  for (let k = Math.min(a.length, b.length); k > 0; k--) {
    if (a.slice(-k).join(' ') === b.slice(0, k).join(' ')) return [...a, ...b.slice(k)].join(' ');
  }
  return [...a, ...b].join(' ');
}

/**
 * A wide gap inside an OCR line is two things side by side (a name and the price beside it), not
 * one name: Tesseract keeps the gap as a run of spaces. Names themselves use single spaces.
 */
const SIDE_BY_SIDE = /\s{3,}/;

/**
 * The closest candidate to any of the OCR'd `lines`. Each line — each side-by-side piece of a line,
 * and each name a known sentence wraps (`namePieces`) — is tried on its own because a crop often
 * catches a label or a price beside the name; the best piece wins.
 *
 * Two candidates that tie (or nearly) come back as `ambiguous` with both ids, ordered by score
 * then id — deterministic, so the same frame always gives the same answer.
 */
export function matchName(
  lines: readonly string[],
  candidates: readonly NameCandidate[],
  thresholds: MatchThresholds = DEFAULT_THRESHOLDS,
): MatchResult {
  const best = new Map<number, number>();
  const pieces = namePieces(lines);
  for (const line of pieces) {
    if (normalizeName(line) === '') continue;
    for (const c of candidates) {
      const score = similarity(line, c.name);
      if (score > (best.get(c.id) ?? 0)) best.set(c.id, score);
    }
  }
  const ranked = [...best].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const [first, second] = ranked;
  if (!first || first[1] < thresholds.minScore) return { status: 'none' };

  const score = first[1];
  const margin = score - (second?.[1] ?? 0);
  // Some names differ by one character on purpose (「4호선 - 제 3 구간」/「제 4 구간」, 「타입 L」/
  // 「타입 E」), so a perfect read sits a hair above its siblings. A unique exact read is taken; a
  // misread that happens to spell a sibling exactly is the one error context has to catch.
  const exact = score === 1 && margin > 0;
  if (exact || margin >= thresholds.minMargin) return { status: 'match', id: first[0], score, margin };
  const ids = ranked.filter(([, s]) => score - s < thresholds.minMargin).map(([id]) => id);
  return { status: 'ambiguous', ids, score, margin };
}
