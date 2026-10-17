/**
 * How a gift description divides into effects (M129) — shared by the build, which reads what each
 * effect asks of the deck, and the gift sheet, which marks which effects the deck sets off. Pure.
 */

/** One effect as written: the head line and the bullets under it. */
export interface EffectBlock {
  head: string;
  bullets: string[];
  paragraph: number;
  /** A 「- 」 line listed under a bare 「[… 전용 효과]」 heading. */
  underHeading?: boolean;
  /** Indexes into `text.split('\n')` of the head and its bullets — how the gift sheet draws it. */
  lines: number[];
}

/** A line that is only an exclusive-effect heading: 「[검지 소속 인격 전용 효과]」. */
const PURE_HEADING_RE = /^\[[^\]]*전용\s*효과\]$/;

export const BULLET_RE = /^[-•·]\s*/;

/**
 * Split a description into effects. A blank line ends a paragraph; inside a paragraph every line
 * that is not a bullet starts an effect, and a bullet belongs to the effect above it. A bullet with
 * no line above it in its paragraph (「- 6인 이상」 under a 「편성된 수에 따라」 heading) is an
 * effect of its own. The same function splits the shipped (localized) text for the review table,
 * so the n-th block there is the n-th effect.
 */
export function splitEffectBlocks(text: string): EffectBlock[] {
  const blocks: EffectBlock[] = [];
  let paragraph = 0;
  let current = null as EffectBlock | null;
  text.split('\n').forEach((line, lineIndex) => {
    const trimmed = line.trim();
    if (trimmed === '') {
      if (current) paragraph += 1;
      current = null;
      return;
    }
    // Under a bare 「[… 전용 효과]」 heading each 「- 」 line is an effect of its own; 「·」 lines still
    // belong to the effect above them.
    const above: EffectBlock | null = current;
    const underHeading: boolean =
      above !== null &&
      (PURE_HEADING_RE.test(above.head.replace(BULLET_RE, '')) || above.underHeading === true);
    const listedUnderHeading: boolean = /^-/.test(trimmed) && underHeading;
    if (BULLET_RE.test(trimmed) && above !== null && !listedUnderHeading) {
      above.bullets.push(trimmed);
      above.lines.push(lineIndex);
      return;
    }
    current = { head: trimmed, bullets: [], paragraph, underHeading: listedUnderHeading, lines: [lineIndex] };
    blocks.push(current);
  });
  return blocks;
}
