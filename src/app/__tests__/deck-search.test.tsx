/**
 * The deck tab's two identity searches (M126): the global one at the top and the picker a sinner's
 * slot opens. Both show keywords and attack types per row, mark the identity in the deck, and take
 * several words as OR or AND; the picker is a sheet fixed to its sinner.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { loadGameDataFromDisk } from '../../core/data/node.ts';
import { analyseDeck, buildIndexes } from '../../core/index.ts';
import { appDefaultOptions, defaultUi, emptyRun, forgetRecipes, useApp } from '../store.ts';
import { defaultDeck } from '../lib/default-deck.ts';
import { DeckStep } from '../steps/DeckStep.tsx';

const data = loadGameDataFromDisk();
const indexes = buildIndexes(data);

/** Faust's two 화상 identities: LCE E.G.O:: 홍염살 and 새벽 사무소 해결사. */
const ARDOR = 10211;
const DAWN = 10216;
const FAUST_COUNT = data.identities.filter((identity) => identity.sinnerId === 2).length;

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

const renderDeck = () => {
  const { deck, deployed } = useApp.getState();
  return render(
    <DeckStep
      data={data}
      indexes={indexes}
      stats={analyseDeck(deck, indexes, data.rules.deployment, deployed)}
      lang="ko"
    />,
  );
};

/** The LCB deck with Faust's slot holding 새벽 사무소 해결사. */
const deckWithDawnFaust = () => defaultDeck(data).map((id) => (Math.floor(id / 100) % 100 === 2 ? DAWN : id));

const globalOptions = () => within(screen.getByRole('listbox')).getAllByRole('option');
const optionFor = (id: number) => document.getElementById(`deck-option-${id}`)!;

/** The slot button that opens a sinner's picker; slots run in sinner order. */
const slotTrigger = (sinnerIndex: number) => {
  const slot = within(screen.getByRole('list', { name: '덱' })).getAllByRole('listitem')[sinnerIndex]!;
  return within(slot)
    .getAllByRole('button')
    .find((button) => button.getAttribute('aria-haspopup') === 'dialog')!;
};

describe('global identity search', () => {
  it('shows each result’s keywords and attack types in its row', async () => {
    // Arrange
    const user = userEvent.setup();
    renderDeck();
    // Act
    await user.type(screen.getByLabelText(/전체 인격 검색/), '새벽 사무소');
    // Assert: 새벽 사무소 해결사 inflicts 화상 and 진동 and attacks with 참격 only.
    const row = optionFor(DAWN);
    const meta = within(row).getByTestId('identity-meta');
    expect(within(meta).getByTitle('화상 부여 공격 스킬 보유')).toHaveTextContent('화상');
    expect(within(meta).getByTitle('진동 부여 공격 스킬 보유')).toHaveTextContent('진동');
    expect(within(meta).getByTitle('공격 유형')).toHaveTextContent('참격');
    expect(within(meta).getByTitle('죄악 속성')).toHaveTextContent('분노 · 나태 · 오만');
  });

  it('marks the identity in the deck, and says which non-LCB identity a pick would replace', async () => {
    // Arrange
    const user = userEvent.setup();
    useApp.getState().setDeck(deckWithDawnFaust(), 0);
    renderDeck();
    // Act
    await user.type(screen.getByLabelText(/전체 인격 검색/), '파우스트');
    // Assert: the one in the deck carries 「편성 중」 (a word, not only a tint) and is pressed.
    const dawn = optionFor(DAWN);
    expect(dawn).toHaveAttribute('aria-pressed', 'true');
    expect(within(dawn).getByTestId('deck-in-deck')).toHaveTextContent('편성 중');
    expect(within(dawn).queryByTestId('deck-current')).toBeNull();
    // Every other Faust row names the deliberate choice it would replace.
    const ardor = optionFor(ARDOR);
    expect(ardor).toHaveAttribute('aria-pressed', 'false');
    expect(within(ardor).queryByTestId('deck-in-deck')).toBeNull();
    expect(within(ardor).getByTestId('deck-current')).toHaveTextContent('현재 편성: 새벽 사무소 해결사');
  });

  it('does not name the LCB base identity as something a pick would replace', async () => {
    // Arrange
    const user = userEvent.setup();
    useApp.getState().setDeck(defaultDeck(data), 0);
    renderDeck();
    // Act
    await user.type(screen.getByLabelText(/전체 인격 검색/), '파우스트');
    // Assert
    expect(screen.queryAllByTestId('deck-current')).toHaveLength(0);
    expect(within(optionFor(10201)).getByTestId('deck-in-deck')).toHaveTextContent('편성 중');
  });

  it('ANDs several words when 「모두」 is chosen: 화상 파우스트 is Faust’s 화상 identities', async () => {
    // Arrange
    const user = userEvent.setup();
    renderDeck();
    const input = screen.getByLabelText(/전체 인격 검색/);
    await user.type(input, '화상 파우스트');
    const orCount = globalOptions().length;
    const mode = screen.getByRole('group', { name: '검색어 조합' });
    expect(within(mode).getByRole('button', { name: '하나라도' })).toHaveAttribute('aria-pressed', 'true');
    // Act
    await user.click(within(mode).getByRole('button', { name: '모두' }));
    // Assert
    expect(within(mode).getByRole('button', { name: '모두' })).toHaveAttribute('aria-pressed', 'true');
    expect(globalOptions().map((option) => option.id)).toEqual([
      `deck-option-${ARDOR}`,
      `deck-option-${DAWN}`,
    ]);
    // OR, the default, is the old behaviour: either word is enough.
    expect(orCount).toBeGreaterThan(FAUST_COUNT);
  });

  it('finds identities by attack type', async () => {
    // Arrange
    const user = userEvent.setup();
    renderDeck();
    await user.click(screen.getByRole('button', { name: '모두' }));
    // Act
    await user.type(screen.getByLabelText(/전체 인격 검색/), '타격 파우스트');
    // Assert: every row is Faust's and shows 타격 on its attack chip.
    const options = globalOptions();
    expect(options.length).toBeGreaterThan(0);
    for (const option of options) {
      expect(option.textContent).toMatch(/^파우스트/);
      expect(within(option).getByTitle('공격 유형')).toHaveTextContent('타격');
    }
  });
});

describe('sinner picker', () => {
  it('opens as a sheet outside the panel, with the search mode, the count and the field focused', async () => {
    // Arrange
    const user = userEvent.setup();
    const { container } = renderDeck();
    const trigger = slotTrigger(1); // 파우스트
    // Act
    await user.click(trigger);
    // Assert
    const sheet = screen.getByTestId('block-sheet');
    expect(sheet).toHaveAttribute('role', 'dialog');
    expect(sheet).toHaveAccessibleName('파우스트 인격 선택');
    // Portaled to the body, so no panel can clip it.
    expect(container.contains(sheet)).toBe(false);
    const picker = within(sheet).getByTestId('sinner-picker');
    expect(within(picker).getByRole('group', { name: '검색어 조합' })).toBeInTheDocument();
    expect(within(picker).getByTestId('sinner-picker-count')).toHaveTextContent(
      `${FAUST_COUNT}명 중 ${FAUST_COUNT}명`,
    );
    expect(within(picker).getByRole('combobox', { name: '파우스트 인격 검색' })).toHaveFocus();
    // Every row shows its keywords, and only Faust's identities are listed.
    expect(within(picker).getAllByRole('option')).toHaveLength(FAUST_COUNT);
    expect(
      within(document.getElementById(`sinner-option-${DAWN}`)!).getByTitle('공격 유형'),
    ).toHaveTextContent('참격');
  });

  it('searches inside its own sinner only, with the same OR / AND', async () => {
    // Arrange
    const user = userEvent.setup();
    renderDeck();
    await user.click(slotTrigger(1));
    const picker = screen.getByTestId('sinner-picker');
    const field = within(picker).getByRole('combobox');
    // Act
    await user.type(field, '화상');
    // Assert
    const ids = () =>
      within(picker)
        .queryAllByRole('option')
        .map((option) => option.id);
    expect(new Set(ids())).toEqual(new Set([`sinner-option-${ARDOR}`, `sinner-option-${DAWN}`]));
    // 이상 is another sinner: OR still finds Faust's 화상 two, AND finds nobody.
    await user.type(field, ' 이상');
    expect(ids()).toHaveLength(2);
    await user.click(within(picker).getByRole('button', { name: '모두' }));
    expect(ids()).toEqual([]);
    expect(within(picker).getByText('일치하는 인격 없음')).toBeInTheDocument();
  });

  it('marks the identity in the slot, picks with Enter, and clears the slot with 「칸 비우기」', async () => {
    // Arrange
    const user = userEvent.setup();
    useApp.getState().setDeck(deckWithDawnFaust(), 0);
    renderDeck();
    await user.click(slotTrigger(1));
    let picker = screen.getByTestId('sinner-picker');
    // The slot's identity is named at the top and marked in its row.
    expect(within(picker).getByText('현재 편성: 새벽 사무소 해결사')).toBeInTheDocument();
    const dawn = document.getElementById(`sinner-option-${DAWN}`)!;
    expect(within(dawn).getByRole('button')).toHaveAttribute('aria-pressed', 'true');
    expect(within(dawn).getByTestId('deck-in-deck')).toHaveTextContent('편성 중');
    // Act: Enter on the first match picks it and closes the sheet.
    await user.type(within(picker).getByRole('combobox'), '홍염살{Enter}');
    // Assert
    expect(useApp.getState().deck).toContain(ARDOR);
    expect(useApp.getState().deck).not.toContain(DAWN);
    expect(screen.queryByTestId('sinner-picker')).toBeNull();
    // Act: reopen and clear the slot.
    await user.click(slotTrigger(1));
    picker = screen.getByTestId('sinner-picker');
    await user.click(within(picker).getByRole('button', { name: '칸 비우기' }));
    // Assert
    expect(useApp.getState().deck.some((id) => Math.floor(id / 100) % 100 === 2)).toBe(false);
    expect(screen.queryByTestId('sinner-picker')).toBeNull();
  });

  it('closes on Escape and hands focus back to the slot', async () => {
    // Arrange
    const user = userEvent.setup();
    renderDeck();
    const trigger = slotTrigger(1);
    await user.click(trigger);
    expect(screen.getByTestId('sinner-picker')).toBeInTheDocument();
    // Act
    await user.keyboard('{Escape}');
    // Assert
    expect(screen.queryByTestId('sinner-picker')).toBeNull();
    expect(slotTrigger(1)).toHaveFocus();
  });
});
