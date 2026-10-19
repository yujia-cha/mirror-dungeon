/**
 * The 복각 (BokGak) packs (M159): six packs come twice, the reprint named after its original with
 * 「BokGak」 behind (「시간살인시간」/「시간살인시간 BokGak」). The map header prints that word as a logo
 * the OCR reads as digits — 「80<68<」, 「8068」, 「808」, 「800<696」 — so by name alone the two
 * were a coin toss (the owner's run asked on both its reprint floors), and a read that lost the
 * logo named the original outright and overwrote the owner's answer. On that run the logo's 「80」
 * stood behind the name in ~75% of the reprint floors' header reads and in none of the ~600 reads
 * of the thirteen other floors, so it is the sign:
 *
 * - `matchPack`: a header line with the logo is matched among the reprints only, by the name
 *   before the logo. Without it the match is as before — a reprint's header that lost its logo
 *   still names the original.
 * - `reprintsOf` + `apply.ts`: so an entry never steps down from a reprint to its original — the
 *   logo is never on an original's header, so a reprint once seen (or answered) is the truth.
 *
 * Pure: names in, ids out.
 */
import { matchName, type MatchResult, type NameCandidate } from './match-name.ts';

const REPRINT_SUFFIX = /\s*BokGak$/i;

/**
 * Where the logo starts in an OCR'd line, or -1: 「80」 not right after another digit (the name
 * may carry digits — 「20번구의 기적」), or the word itself, as a Latin model may read it.
 */
export function reprintMark(line: string): number {
  const digits = /(^|[^0-9])80/.exec(line);
  const word = /bokgak/i.exec(line);
  const at = [digits ? digits.index + digits[1]!.length : -1, word ? word.index : -1].filter((i) => i >= 0);
  return at.length > 0 ? Math.min(...at) : -1;
}

/** Reprint id → its original's id, from the names (either language: both end in 「BokGak」). */
export function reprintsOf(packs: Iterable<{ id: number; name: string }>): Map<number, number> {
  const list = [...packs];
  const byName = new Map(list.map((p) => [p.name.trim(), p.id]));
  const out = new Map<number, number>();
  for (const p of list) {
    if (!REPRINT_SUFFIX.test(p.name)) continue;
    const original = byName.get(p.name.replace(REPRINT_SUFFIX, '').trim());
    if (original !== undefined) out.set(p.id, original);
  }
  return out;
}

/**
 * The pack a map header names. A line with the reprint logo is matched against the reprints'
 * own names, the logo and what follows it cut off; otherwise every pack as `matchName` does.
 */
export function matchPack(lines: readonly string[], packs: readonly NameCandidate[]): MatchResult {
  if (lines.some((line) => reprintMark(line) >= 0)) {
    const reprints = packs
      .filter((p) => REPRINT_SUFFIX.test(p.name))
      .map((p) => ({ id: p.id, name: p.name.replace(REPRINT_SUFFIX, '') }));
    // The logo may come on a line of its own; what stands before it is the name.
    const cut = lines
      .map((line) => (reprintMark(line) >= 0 ? line.slice(0, reprintMark(line)) : line))
      .filter((line) => line.trim() !== '');
    const read = matchName(cut, reprints);
    if (read.status !== 'none') return read;
  }
  return matchName(lines, packs);
}
