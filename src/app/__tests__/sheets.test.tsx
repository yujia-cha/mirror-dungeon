/**
 * M120: the observation slots' 「관측하지 않기」, the route's 「자동」 start, and the one detail sheet
 * that gifts and packs share — names inside it move it, 「←」 walks back.
 */
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { loadGameDataFromDisk } from '../../core/data/node.ts';
import { analyseDeck, buildIndexes } from '../../core/index.ts';
import { appDefaultOptions, defaultUi, emptyRun, forgetRecipes, sanitizeOptions, useApp } from '../store.ts';
import { GiftsStep } from '../steps/GiftsStep.tsx';
import { PlanProvider } from '../shell/PlanContext.tsx';
import { RoutePlanPanel } from '../shell/RoutePlanPanel.tsx';

const data = loadGameDataFromDisk();
const indexes = buildIndexes(data);
const BURN_DECK = [10112, 10216, 10311, 10415, 10512, 10604, 10715, 10808, 10916, 11009, 11115, 11216];

beforeEach(() => {
  useApp.setState({
    deck: [],
    deployed: [],
    wanted: [],
    fusionGoal: {},
    run: emptyRun(),
    ui: defaultUi(),
    options: appDefaultOptions(),
    lang: 'ko',
    dark: true,
  });
  forgetRecipes();
});

const renderPlanned = (node: ReactNode) => {
  const { deck, deployed } = useApp.getState();
  return render(
    <PlanProvider
      data={data}
      indexes={indexes}
      stats={analyseDeck(deck, indexes, data.rules.deployment, deployed)}
      lang="ko"
    >
      {node}
    </PlanProvider>,
  );
};

describe('observation slots (M120)', () => {
  it('opens the list as a sheet with 「관측하지 않기」 first, and turns the slot off and on again', async () => {
    // Arrange: a goal the planner observes, so an empty cell carries a suggestion.
    const user = userEvent.setup();
    useApp.getState().setDeck(BURN_DECK, 7);
    useApp.getState().toggleWanted(9267);
    useApp.getState().toggleWanted(9423);
    renderPlanned(
      <GiftsStep
        data={data}
        indexes={indexes}
        stats={analyseDeck(BURN_DECK, indexes, data.rules.deployment)}
        lang="ko"
      />,
    );
    const slots = () => screen.getAllByTestId('observe-slot');
    const open = slots().find((s) => s.querySelector('[data-suggested]'))!;

    // Act: open it.
    await user.click(within(open).getByRole('button'));

    // Assert: a sheet (not a popover clipped by the panel), the skip row before any gift.
    const sheet = screen.getByTestId('block-sheet');
    const skip = within(sheet).getByTestId('observe-skip');
    expect(skip).toHaveTextContent('관측하지 않기');
    const candidates = within(sheet).getByTestId('observe-candidates');
    expect(skip.compareDocumentPosition(candidates) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // Act: leave the slot unused.
    await user.click(skip);

    // Assert: one slot fewer for the plan, drawn at the end as 「관측 안 함」.
    expect(useApp.getState().options.observationSlots).toBe(data.rules.giftObservation.max - 1);
    expect(screen.queryByTestId('block-sheet')).toBeNull();
    const off = slots().filter((s) => s.hasAttribute('data-off'));
    expect(off).toHaveLength(1);
    expect(off[0]).toHaveTextContent('관측 안 함');
    expect(screen.getByTestId('observe-slots-count')).toHaveTextContent(
      `0/${data.rules.giftObservation.max - 1}`,
    );

    // Act + Assert: its ✕ turns it back on, and the option goes back to "every slot".
    await user.click(within(off[0]!).getByRole('button', { name: '관측 안 함 해제' }));
    expect(useApp.getState().options.observationSlots).toBeUndefined();
    expect(slots().some((s) => s.hasAttribute('data-off'))).toBe(false);
  });

  it('keeps a valid slot count from a link or a saved state and drops anything else', () => {
    expect(sanitizeOptions({ ...appDefaultOptions(), observationSlots: 1 }).observationSlots).toBe(1);
    expect(sanitizeOptions({ ...appDefaultOptions(), observationSlots: 0 }).observationSlots).toBe(0);
    expect('observationSlots' in sanitizeOptions({ ...appDefaultOptions(), observationSlots: -1 })).toBe(
      false,
    );
    expect('observationSlots' in sanitizeOptions({ ...appDefaultOptions(), observationSlots: 'x' })).toBe(
      false,
    );
  });
});

describe('route start line (M120)', () => {
  it('says 「자동」 while the start keyword is left on auto, and nothing once one is chosen', () => {
    useApp.getState().setDeck(BURN_DECK, 7);
    useApp.getState().toggleWanted(9267);
    const { unmount } = renderPlanned(<RoutePlanPanel onOpenGifts={() => undefined} />);
    expect(screen.getByTestId('start-line')).toContainElement(screen.getByTestId('start-auto'));
    expect(screen.getByTestId('start-auto')).toHaveTextContent('자동');
    unmount();
    useApp.getState().setOptions({ startKeyword: 'Combustion' });
    renderPlanned(<RoutePlanPanel onOpenGifts={() => undefined} />);
    expect(screen.queryByTestId('start-auto')).toBeNull();
  });
});

describe('one detail sheet for gifts and packs (M120)', () => {
  it('moves from a pack to its gift and on to the pack named there, and walks back', async () => {
    const user = userEvent.setup();
    useApp.getState().setDeck(BURN_DECK, 7);
    useApp.getState().toggleWanted(9267); // 달궈진 놋쇠 — 화왕지절 전용
    renderPlanned(<RoutePlanPanel onOpenGifts={() => undefined} />);

    await user.click(within(screen.getByTestId('metro-rows')).getByRole('button', { name: '화왕지절' }));
    await user.click(within(screen.getByTestId('pack-detail')).getByRole('button', { name: '달궈진 놋쇠' }));
    const gift = screen.getByTestId('gift-detail');
    // No observation button in a gift's sheet any more.
    expect(within(gift).queryByRole('button', { name: /관측 지정|지정 해제/ })).toBeNull();
    // The pack named in 「… 전용」 is a link to that pack.
    await user.click(
      within(screen.getByTestId('gift-acquisition')).getByRole('button', { name: '화왕지절' }),
    );
    expect(screen.getByTestId('pack-detail')).toBeInTheDocument();
    // 「←」 names where it goes back to: the gift, then the pack it was reached from.
    await user.click(screen.getByTestId('detail-back'));
    expect(screen.getByTestId('gift-detail')).toBeInTheDocument();
    await user.click(screen.getByTestId('gift-detail-back'));
    expect(screen.getByTestId('pack-detail')).toBeInTheDocument();
    expect(screen.queryByTestId('detail-back')).toBeNull();
  });
});
