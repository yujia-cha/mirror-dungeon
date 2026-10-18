/**
 * M129: the gift sheet draws a description effect by effect — which effects the deployed party sets
 * off. M131: who sets each off is a line of chips under the effect, always shown.
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

function renderFor(deployed: number[], gift = PIPE) {
  const stats = analyseDeck(deployed, indexes, data.rules.deployment, deployed);
  const report = giftEffectsReport(gift, stats, indexes.identityById);
  const text = renderEffect(gift.desc, data.enums, 'ko');
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

describe('effect lines (M129, chips M131)', () => {
  it('marks the Pride Pierce effect not active for a deck without one, and names nobody', () => {
    // Arrange + Act: 10101 (LCB 이상) has no Pride Pierce skill.
    const effects = renderFor([10101]);
    // Assert: the two plain effects are active, the third is not, and says so in words.
    expect(effects.map((e) => e.getAttribute('data-active'))).toEqual(['true', 'true', 'false']);
    expect(effects[2]).toHaveTextContent('발동하지 않음');
    const who = within(effects[2]!).getByTestId('effect-who');
    expect(who).toHaveTextContent('오만 관통 스킬');
    expect(within(who).getByText('없음')).toHaveClass('border-dashed');
    expect(within(effects[0]!).getByTestId('effect-who')).toHaveTextContent('조건 없음');
  });

  it('puts a chip per identity: the sinner and the slots, the whole identity as its name', () => {
    // Arrange: 10104 (개화 E.G.O:: 동백 이상) has a Pride Pierce base skill.
    const identity = indexes.identityById.get(10104)!;
    const slots = identity
      .skills!.filter((s) => s.sin === 'PRIDE' && s.attackType === 'Penetrate')
      .map((s) => s.slot);
    // The chip reads 「이상 1.3」 (no S); its name says 「스킬 1, 3」 (M133).
    const full = `${identity.title.ko} ${identity.sinner.ko} 스킬 ${slots.join(', ')}`;
    // Act
    const effects = renderFor([10104]);
    // Assert
    expect(effects[2]).toHaveAttribute('data-active', 'true');
    const who = within(effects[2]!).getByTestId('effect-who');
    const chip = within(who).getByText(`${identity.sinner.ko} ${slots.join('.')}`);
    expect(chip).toHaveAttribute('aria-label', full);
    expect(chip).toHaveAttribute('title', full);
  });

  it('always shows who sets an effect off — no popover, nothing to hover or focus', () => {
    const effects = renderFor([10101]);
    for (const effect of effects) {
      const who = within(effect).getByTestId('effect-who');
      expect(who).not.toHaveClass('hidden');
      expect(who).not.toHaveAttribute('role', 'tooltip');
      expect(effect).not.toHaveAttribute('tabindex');
      expect(effect).not.toHaveAttribute('aria-describedby');
    }
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('names who could set off a hinted explosion, only when someone can (M150)', () => {
    // Arrange: 진실의 종 (9091) asks nothing, hints explosion skills; 10216 explodes, 10101 does not.
    const bell = indexes.giftById.get(9091)!;
    const exploder = indexes.identityById.get(10216)!;
    // Act
    const [withIt] = renderFor([10216], bell);
    // Assert: still active and unconditional, the hint follows with the chip.
    expect(withIt).toHaveAttribute('data-active', 'true');
    const who = within(withIt!).getByTestId('effect-who');
    expect(who).toHaveTextContent('조건 없음');
    const hint = within(who).getByTestId('effect-hint');
    expect(hint).toHaveTextContent('참고: 진동 폭발 스킬');
    expect(hint).toHaveTextContent(exploder.sinner.ko);
  });

  it('draws no hint when no deployed identity has the skill', () => {
    const [effect] = renderFor([10101], indexes.giftById.get(9091)!);
    expect(effect).toHaveAttribute('data-active', 'true');
    expect(within(effect!).queryByTestId('effect-hint')).toBeNull();
  });

  it('leaves the text plain when it does not split into the judged effects', () => {
    const stats = analyseDeck([10101], indexes, data.rules.deployment, [10101]);
    const report = giftEffectsReport(PIPE, stats, indexes.identityById);
    expect(effectBlocksFor('한 줄뿐인 글', report)).toBeNull();
    expect(effectBlocksFor(renderEffect(PIPE.desc, data.enums, 'ko'), report)).not.toBeNull();
  });
});
