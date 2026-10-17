/**
 * M129: the gift sheet draws a description effect by effect — which effects the deployed party sets
 * off, and who sets each off (hover / focus / tap).
 */
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { loadGameDataFromDisk } from '../../core/data/node.ts';
import { analyseDeck, buildIndexes, giftEffectsReport } from '../../core/index.ts';
import { EffectLines } from '../components/EffectLines.tsx';
import { renderEffect } from '../format.ts';
import { effectBlocksFor } from '../lib/effect-text.ts';

const data = loadGameDataFromDisk();
const indexes = buildIndexes(data);
const PIPE = indexes.giftById.get(9767)!; // 흑염 파이프: slot heading, two plain effects, Pride Pierce

function renderFor(deployed: number[]) {
  const stats = analyseDeck(deployed, indexes, data.rules.deployment, deployed);
  const report = giftEffectsReport(PIPE, stats, indexes.identityById);
  const text = renderEffect(PIPE.desc, data.enums, 'ko');
  render(
    <EffectLines
      text={text}
      report={report}
      enums={data.enums}
      identityById={indexes.identityById}
      lang="ko"
    />,
  );
  return screen.getAllByTestId('effect-who').map((tip) => tip.closest('[data-effect]') as HTMLElement);
}

describe('effect lines (M129)', () => {
  it('marks the Pride Pierce effect not active for a deck without one, and names nobody', () => {
    // Arrange + Act: 10101 (LCB 이상) has no Pride Pierce skill.
    const effects = renderFor([10101]);
    // Assert: the two plain effects are active, the third is not, and says so in words.
    expect(effects.map((e) => e.getAttribute('data-active'))).toEqual(['true', 'true', 'false']);
    expect(effects[2]).toHaveTextContent('발동하지 않음');
    expect(within(effects[2]!).getByTestId('effect-who')).toHaveTextContent('오만 관통 스킬 — 없음');
    expect(within(effects[0]!).getByTestId('effect-who')).toHaveTextContent('조건 없음');
  });

  it('names the identity and the skill slot that set the effect off', () => {
    // Arrange: 10104 has a Pride Pierce base skill.
    const slots = indexes.identityById
      .get(10104)!
      .skills!.filter((s) => s.sin === 'PRIDE' && s.attackType === 'Penetrate')
      .map((s) => s.slot);
    // Act
    const effects = renderFor([10104]);
    // Assert
    expect(effects[2]).toHaveAttribute('data-active', 'true');
    expect(within(effects[2]!).getByTestId('effect-who')).toHaveTextContent(`S${slots.join('·S')}`);
  });

  it('is focusable, and describes itself with the who-line', () => {
    const effects = renderFor([10101]);
    const tip = within(effects[2]!).getByTestId('effect-who');
    expect(effects[2]).toHaveAttribute('tabindex', '0');
    expect(effects[2]).toHaveAttribute('aria-describedby', tip.id);
  });

  it('leaves the text plain when it does not split into the judged effects', () => {
    const stats = analyseDeck([10101], indexes, data.rules.deployment, [10101]);
    const report = giftEffectsReport(PIPE, stats, indexes.identityById);
    expect(effectBlocksFor('한 줄뿐인 글', report)).toBeNull();
    expect(effectBlocksFor(renderEffect(PIPE.desc, data.enums, 'ko'), report)).not.toBeNull();
  });
});
