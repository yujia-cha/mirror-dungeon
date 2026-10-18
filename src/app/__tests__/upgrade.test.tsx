/**
 * M130: gift enhancement. The `+` / `++` choice is a per-gift value in the store (`upgrades`),
 * kept on the device and carried by a share link for the goals; the goal tile and the gift sheet
 * show the chosen step's name and text.
 */
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import lzString from 'lz-string';
import { loadGameDataFromDisk } from '../../core/data/node.ts';
import { analyseDeck, buildIndexes } from '../../core/index.ts';
import {
  appDefaultOptions,
  decodeShared,
  defaultUi,
  emptyRun,
  encodeShared,
  forgetRecipes,
  PERSIST_VERSION,
  sanitizePersisted,
  sanitizeUpgrades,
  useApp,
} from '../store.ts';
import { ingredientTree } from '../lib/entangle.ts';
import { nextUpgrade, upgradeLevelsOf, upgradedName } from '../lib/upgrade.ts';
import { GiftsStep } from '../steps/GiftsStep.tsx';
import { PlanProvider } from '../shell/PlanContext.tsx';
import { usePlan } from '../shell/plan-context.ts';

const data = loadGameDataFromDisk();
const indexes = buildIndexes(data);
const BURN_DECK = [10112, 10216, 10311, 10415, 10512, 10604, 10715, 10808, 10916, 11009, 11115, 11216];
/** 하모닉스 — two steps. 덧붙인 반창고 — one. 상납된 시가 — none. */
const HARMONICS = 9236;
const BANDAGE = 9192;
const CIGAR = 9283;

beforeEach(() => {
  useApp.setState({
    deck: [],
    deployed: [],
    wanted: [],
    fusionGoal: {},
    upgrades: {},
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

const adopt = (giftIds = new Set(data.gifts.map((gift) => gift.id)), levels = upgradeLevelsOf(data.gifts)) =>
  useApp.getState().adoptSeason({
    season: data.meta.dungeon.id,
    lastFloor: 15,
    giftIds,
    packIds: new Set(data.packs.map((pack) => pack.id)),
    recipes: ingredientTree(indexes, data.rules.fusion.maxShopSlots),
    upgradeLevels: levels,
  });

describe('enhancement store (M130)', () => {
  it('keeps a clean per-gift value: 1 or 2, absent for none, and a goal taken out keeps it', () => {
    const { setUpgrade, toggleWanted } = useApp.getState();
    toggleWanted(HARMONICS);
    setUpgrade(HARMONICS, 2);
    setUpgrade(BANDAGE, 1);
    expect(useApp.getState().upgrades).toEqual({ [HARMONICS]: 2, [BANDAGE]: 1 });
    setUpgrade(BANDAGE, 0);
    expect(useApp.getState().upgrades).toEqual({ [HARMONICS]: 2 });
    // A preference about the gift, not the goal.
    useApp.getState().removeWanted(HARMONICS);
    expect(useApp.getState().upgrades).toEqual({ [HARMONICS]: 2 });
    // 초기화 forgets it.
    useApp.getState().resetAll([], 0);
    expect(useApp.getState().upgrades).toEqual({});
  });

  it('sanitizes a saved blob whatever its version', () => {
    expect(sanitizeUpgrades({ 9236: 2, 9192: 1, 9001: 3, x: 1, 9010: '2', 9.5: 1 })).toEqual({
      9236: 2,
      9192: 1,
    });
    expect(sanitizeUpgrades([1, 2])).toEqual({});
    expect(sanitizePersisted({ upgrades: { 9236: 1 } }, PERSIST_VERSION).upgrades).toEqual({ 9236: 1 });
    // A blob from before M130 has none.
    expect(sanitizePersisted({ wanted: [9236] }, 6).upgrades).toEqual({});
  });

  it('drops, on a data load, a step the season does not have and a gift it does not ship', () => {
    useApp.setState({ upgrades: { [HARMONICS]: 2, [BANDAGE]: 2, [CIGAR]: 1, 999999: 1 } });
    adopt();
    // 반창고 has one step only; 상납된 시가 has none; 999999 is no gift at all.
    expect(useApp.getState().upgrades).toEqual({ [HARMONICS]: 2 });
    adopt(new Set([CIGAR]), new Map());
    expect(useApp.getState().upgrades).toEqual({});
  });

  it('carries the goals’ steps in a share link, and an old link simply has none', () => {
    const shared = {
      deck: [10101],
      deployed: [10101],
      wanted: [HARMONICS, BANDAGE],
      fusionGoal: {},
      upgrades: { [HARMONICS]: 2 as const, 9001: 1 as const },
      options: appDefaultOptions(),
    };
    const hash = encodeShared(shared);
    const raw = JSON.parse(lzString.decompressFromEncodedURIComponent(hash.slice(3))!) as Record<
      string,
      unknown
    >;
    // Only goals ride along (9001 is not one), under the short key.
    expect(raw.up).toEqual({ [HARMONICS]: 2 });
    expect(raw.v).toBe(5);
    expect(decodeShared(hash)!.upgrades).toEqual({ [HARMONICS]: 2 });
    // No choice for any goal: no key at all.
    const plain = JSON.parse(
      lzString.decompressFromEncodedURIComponent(encodeShared({ ...shared, upgrades: {} }).slice(3))!,
    ) as Record<string, unknown>;
    expect('up' in plain).toBe(false);
    expect(decodeShared(encodeShared({ ...shared, upgrades: undefined }))!.upgrades).toEqual({});
  });

  it('lets a link decide its goals’ steps and keeps this device’s other choices', () => {
    useApp.setState({ upgrades: { [BANDAGE]: 1, 9001: 2 } });
    const link = decodeShared(
      encodeShared({
        deck: [10101],
        deployed: [],
        wanted: [HARMONICS, BANDAGE],
        upgrades: { [HARMONICS]: 1 },
        options: appDefaultOptions(),
      }),
    )!;
    useApp.getState().applyShared(link);
    // 반창고 is a goal of the link with no step there, so it goes plain; 9001 is not the link's.
    expect(useApp.getState().upgrades).toEqual({ [HARMONICS]: 1, 9001: 2 });
  });
});

describe('enhancement on screen (M130)', () => {
  it('cycles the badge through the steps the gift has text for, then back to plain', () => {
    expect([0, 1, 2].map((level) => nextUpgrade([1, 2], level as 0 | 1 | 2))).toEqual([1, 2, 0]);
    expect([0, 1].map((level) => nextUpgrade([1], level as 0 | 1))).toEqual([1, 0]);
    // A step without text is skipped; a stale choice starts the cycle again.
    expect([0, 2].map((level) => nextUpgrade([2], level as 0 | 2))).toEqual([2, 0]);
    expect(nextUpgrade([1], 2)).toBe(1);
  });

  const renderGifts = () => {
    return renderPlanned(<GiftsStep data={data} indexes={indexes} lang="ko" />);
  };
  const chip = (id: number) =>
    screen.getAllByTestId('gift-chip').find((el) => el.getAttribute('data-gift') === String(id))!;

  it('gives a goal tile a corner badge only when the gift has steps, cycling through them', async () => {
    const user = userEvent.setup();
    useApp.getState().setDeck(BURN_DECK, 7);
    for (const id of [HARMONICS, BANDAGE, CIGAR]) useApp.getState().toggleWanted(id);
    renderGifts();

    const badge = (id: number) => within(chip(id)).getByTestId('gift-upgrade-badge');
    // No buttons under the name any more (M131): one badge, and none for a gift without steps.
    for (const id of [HARMONICS, BANDAGE, CIGAR])
      expect(within(chip(id)).queryByTestId('gift-upgrade')).toBeNull();
    expect(within(chip(CIGAR)).queryByTestId('gift-upgrade-badge')).toBeNull();
    // It sits with the icon, not under the name.
    expect(badge(HARMONICS).parentElement).toContainElement(within(chip(HARMONICS)).getByTestId('gift-icon'));

    // Not enhanced by default: a dashed 「+」 that says where a press goes.
    expect(badge(HARMONICS)).toHaveAttribute('data-level', '0');
    expect(badge(HARMONICS)).toHaveTextContent(/^\+$/);
    expect(badge(HARMONICS)).toHaveClass('border-dashed');
    expect(badge(HARMONICS)).toHaveAccessibleName('하모닉스 강화 전 · 누르면 +');

    // 강화 전 → + → ++ → 강화 전.
    await user.click(badge(HARMONICS));
    expect(useApp.getState().upgrades).toEqual({ [HARMONICS]: 1 });
    expect(badge(HARMONICS)).toHaveAttribute('data-level', '1');
    expect(badge(HARMONICS)).toHaveTextContent(/^\+$/);
    expect(badge(HARMONICS)).not.toHaveClass('border-dashed');
    expect(badge(HARMONICS)).toHaveAccessibleName('하모닉스 강화: + · 누르면 ++');
    expect(within(chip(HARMONICS)).getByRole('button', { name: '하모닉스+ 자세히' })).toHaveTextContent(
      '하모닉스+',
    );

    await user.click(badge(HARMONICS));
    expect(useApp.getState().upgrades).toEqual({ [HARMONICS]: 2 });
    expect(badge(HARMONICS)).toHaveAttribute('data-level', '2');
    expect(badge(HARMONICS)).toHaveTextContent(/^\+\+$/);
    expect(badge(HARMONICS)).toHaveAccessibleName('하모닉스 강화: ++ · 누르면 강화 전');
    expect(within(chip(HARMONICS)).getByRole('button', { name: '하모닉스++ 자세히' })).toHaveTextContent(
      '하모닉스++',
    );

    await user.click(badge(HARMONICS));
    expect(useApp.getState().upgrades).toEqual({});
    expect(badge(HARMONICS)).toHaveAttribute('data-level', '0');
    expect(within(chip(HARMONICS)).getByRole('button', { name: '하모닉스 자세히' })).toBeInTheDocument();

    // One step only: 강화 전 ↔ +.
    expect(badge(BANDAGE)).toHaveAccessibleName('덧붙인 반창고 강화 전 · 누르면 +');
    await user.click(badge(BANDAGE));
    expect(useApp.getState().upgrades).toEqual({ [BANDAGE]: 1 });
    expect(badge(BANDAGE)).toHaveAccessibleName('덧붙인 반창고 강화: + · 누르면 강화 전');
    await user.click(badge(BANDAGE));
    expect(useApp.getState().upgrades).toEqual({});

    // The search still answers to the plain name.
    act(() => useApp.getState().setUpgrade(HARMONICS, 1));
    await user.type(screen.getByRole('textbox', { name: '기프트 검색' }), '하모닉스');
    expect(
      screen.getAllByTestId('gift-tile').some((el) => el.getAttribute('data-gift') === String(HARMONICS)),
    ).toBe(true);
  });

  it('shares one choice between the tile’s badge and the sheet’s steps', async () => {
    const user = userEvent.setup();
    useApp.getState().toggleWanted(HARMONICS);
    renderGifts();
    const badge = () => within(chip(HARMONICS)).getByTestId('gift-upgrade-badge');

    await user.click(badge());
    await user.click(within(chip(HARMONICS)).getByRole('button', { name: '하모닉스+ 자세히' }));
    const sheet = screen.getByTestId('gift-detail');
    const plus = within(sheet).getByRole('button', { name: '하모닉스 강화 +' });
    const plusPlus = within(sheet).getByRole('button', { name: '하모닉스 강화 ++' });
    expect(plus).toHaveAttribute('aria-pressed', 'true');
    expect(plusPlus).toHaveAttribute('aria-pressed', 'false');

    // The sheet's ++ moves the badge on with it, and pressing it again goes back to plain.
    await user.click(plusPlus);
    expect(badge()).toHaveAttribute('data-level', '2');
    expect(badge()).toHaveTextContent(/^\+\+$/);
    await user.click(plusPlus);
    expect(badge()).toHaveAttribute('data-level', '0');
    expect(useApp.getState().upgrades).toEqual({});
  });

  it('switches the sheet’s title and text to the chosen step, the changed numbers in bold', async () => {
    const user = userEvent.setup();
    const Opener = () => {
      const { openGift } = usePlan();
      return (
        <button type="button" onClick={() => openGift(HARMONICS)}>
          open
        </button>
      );
    };
    renderPlanned(<Opener />);
    await user.click(screen.getByRole('button', { name: 'open' }));
    const sheet = screen.getByTestId('gift-detail');
    expect(within(sheet).getByRole('heading')).toHaveTextContent(/^하모닉스$/);
    const desc = within(sheet).getByTestId('gift-desc');
    expect(desc.querySelector('strong')).toBeNull();

    await user.click(within(sheet).getByRole('button', { name: '하모닉스 강화 +' }));
    expect(within(sheet).getByRole('heading')).toHaveTextContent('하모닉스+');
    expect(screen.getByRole('dialog', { name: '하모닉스+' })).toBeInTheDocument();
    expect([...desc.querySelectorAll('strong')].map((el) => el.textContent)).toEqual(['2', '2']);
    // Nothing of the marker reaches the screen.
    expect(desc.textContent).not.toContain('**');
    expect(desc.textContent).toContain('[취약] 2 얻음');
    expect(upgradedName(indexes.giftById.get(HARMONICS)!, useApp.getState().upgrades[HARMONICS], 'ko')).toBe(
      '하모닉스+',
    );
  });

  it('draws no control in the sheet of a gift without steps', async () => {
    const user = userEvent.setup();
    const Opener = () => {
      const { openGift } = usePlan();
      return (
        <button type="button" onClick={() => openGift(CIGAR)}>
          open
        </button>
      );
    };
    renderPlanned(<Opener />);
    await user.click(screen.getByRole('button', { name: 'open' }));
    expect(within(screen.getByTestId('gift-detail')).queryByTestId('gift-upgrade')).toBeNull();
  });
});
