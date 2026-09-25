/**
 * The run-first shell: a header, the stage in the middle, and two collapsible panels — setup on
 * the left (deck, items with the route options), the route, the goals and the T4 tracker on the
 * right. On a desktop the panels sit beside the stage; on a phone they are drawers. The header's
 * reset puts the deck, the items, the route options and the run back to their first state.
 */
import { useState } from 'react';
import { Globe, Menu, MoreHorizontal, Moon, RotateCcw, Share2, Sun } from 'lucide-react';
import type { GameData, SeasonEntry } from '../../core/schema.ts';
import type { DeckStats, GameIndexes } from '../../core/types.ts';
import { pick, t, type Lang } from '../i18n.ts';
import { useApp, type LeftTab, type RightTab } from '../store.ts';
import { DEPLOYED_AT_START, defaultDeck } from '../lib/default-deck.ts';
import { useDesktop } from '../lib/useMediaQuery.ts';
import { ConfirmDialog } from '../components/ConfirmDialog.tsx';
import { DetailSurface } from '../components/BlockDetail.tsx';
import { IconButton } from '../components/ui.tsx';
import { DeckStep } from '../steps/DeckStep.tsx';
import { GiftsStep } from '../steps/GiftsStep.tsx';
import { RunStage } from '../stage/RunStage.tsx';
import { Tracker } from '../tracker/Tracker.tsx';
import { PlanProvider } from './PlanContext.tsx';
import { RoutePlanPanel } from './RoutePlanPanel.tsx';
import { GoalsPanel } from './GoalsPanel.tsx';
import { RouteOptions } from './RouteOptions.tsx';
import { PanelResizer } from './PanelResizer.tsx';
import { EnumsContext } from '../lib/useEnums.ts';

/**
 * Straight to the file with the credits, the font licence and the takedown path — not the repo
 * root, whose heading anchor would have to stay in step with a Korean title.
 */
const NOTICE_URL = 'https://github.com/yujia-cha/mirror-dungeon/blob/main/NOTICE';
import { SidePanel } from './SidePanel.tsx';

/**
 * A door to one of the side panels: the same three-bar mark on both sides, named by the panel it
 * opens. The name is the button's accessible name too, so no `aria-label` competes with it.
 */
function PanelToggle({
  label,
  open,
  controls,
  onClick,
}: {
  label: string;
  open: boolean;
  controls: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      aria-controls={controls}
      data-testid={`toggle-${controls}`}
      className="inline-flex h-9 items-center gap-2 rounded-sm px-2 text-sm font-semibold text-fg hover:bg-surface-2"
    >
      <Menu size={17} aria-hidden />
      {label}
    </button>
  );
}

export function AppShell({
  data,
  indexes,
  stats,
  lang,
  dark,
  seasons,
  onSeason,
  onShare,
  onToggleLang,
  onToggleDark,
}: {
  data: GameData;
  indexes: GameIndexes;
  stats: DeckStats;
  lang: Lang;
  dark: boolean;
  /** Every published season. One of them means there is nothing to choose between. */
  seasons: SeasonEntry[];
  onSeason: (season: number) => void;
  onShare: () => void;
  onToggleLang: () => void;
  onToggleDark: () => void;
}) {
  const ui = useApp((s) => s.ui);
  const setUi = useApp((s) => s.setUi);
  const resetAll = useApp((s) => s.resetAll);
  const desktop = useDesktop();
  /**
   * Phones keep their own drawer state: only one drawer at a time, closed on every load.
   *
   * The layout it was opened under is stored with it. Crossing the breakpoint otherwise leaves the
   * two states disagreeing — a drawer opened on a phone would spring back open, backdrop and all,
   * after the same panel had been closed on a desktop — and the fix used to be an effect that
   * cleared it. Reading it as closed whenever the layout has changed does the same thing during
   * render, with no second pass.
   */
  const [drawerState, setDrawerState] = useState<{ desktop: boolean; side: 'left' | 'right' | null }>({
    desktop,
    side: null,
  });
  const drawer = drawerState.desktop === desktop ? drawerState.side : null;
  const setDrawer = (side: 'left' | 'right' | null): void => setDrawerState({ desktop, side });
  const leftOpen = desktop ? ui.leftOpen : drawer === 'left';
  const rightOpen = desktop ? ui.rightOpen : drawer === 'right';
  // On a phone a panel is a full-screen page portalled to the body, so the shell behind it is
  // inert: nothing under the page takes focus or a press, and it leaves the accessibility tree.
  const pageOpen = !desktop && drawer !== null;
  const toggle = (side: 'left' | 'right'): void => {
    if (desktop) setUi(side === 'left' ? { leftOpen: !ui.leftOpen } : { rightOpen: !ui.rightOpen });
    else setDrawer(drawer === side ? null : side);
  };
  const close = (side: 'left' | 'right'): void => {
    if (desktop) setUi(side === 'left' ? { leftOpen: false } : { rightOpen: false });
    else setDrawer(null);
  };
  const openGifts = (): void => {
    setUi({ leftTab: 'gifts', ...(desktop ? { leftOpen: true } : {}) });
    if (!desktop) setDrawer('left');
  };
  const [confirmReset, setConfirmReset] = useState(false);
  const [menu, setMenu] = useState(false);
  const reset = (): void => {
    setConfirmReset(false);
    resetAll(defaultDeck(data), DEPLOYED_AT_START);
  };
  const leftTabs: { id: LeftTab; label: string }[] = [
    { id: 'deck', label: t('tabDeck', lang) },
    { id: 'gifts', label: t('tabGifts', lang) },
  ];
  const rightTabs: { id: RightTab; label: string }[] = [
    { id: 'plan', label: t('tabRoutePlan', lang) },
    { id: 'goals', label: t('tabGoals', lang) },
    { id: 'tracker', label: t('tabTracker', lang) },
  ];

  return (
    /* Leaves that need a game display name (a gift icon's keyword, for its accessible label) read
       it from here rather than having `enums` threaded through every component between. */
    <EnumsContext.Provider value={data.enums}>
      <PlanProvider data={data} indexes={indexes} stats={stats} lang={lang}>
        <div className="flex min-h-dvh flex-col" data-testid="app-shell" inert={pageOpen || undefined}>
          {/*
            The header carries two panel doors and a menu before the stage begins; a keyboard reader
            had to tab past all of them on every load. Hidden until focused, so nothing changes for
            a pointer, and it is the first thing Tab reaches.
          */}
          <a
            href="#stage"
            className="sr-only rounded-sm bg-ink px-3 py-2 text-sm font-medium text-ink-fg focus-visible:not-sr-only focus-visible:absolute focus-visible:left-3 focus-visible:top-3 focus-visible:z-40"
            data-testid="skip-link"
          >
            {t('skipToStage', lang)}
          </a>
          <header className="sticky top-0 z-30 flex h-[52px] flex-none items-center justify-between border-b border-line bg-surface px-4 lg:h-14 lg:px-6">
            {/*
            Two doors and a drawer of odds and ends. The panel buttons carry their own name, so the
            header needs no title to say where you are, and the four one-off actions sit behind 「⋯」
            rather than competing with the doors for the eye.
          */}
            <PanelToggle
              label={t('tabDeck', lang)}
              open={leftOpen}
              controls="panel-left"
              onClick={() => toggle('left')}
            />
            <div className="relative flex items-center gap-1.5">
              <IconButton
                onClick={() => setMenu((open) => !open)}
                label={t('moreActions', lang)}
                expanded={menu}
                controls="header-menu"
              >
                <MoreHorizontal size={15} />
              </IconButton>
              {menu ? (
                <DetailSurface
                  id="header-menu"
                  mode="popover"
                  variant="menu"
                  placement={{ vertical: 'below', horizontal: 'end' }}
                  label={t('moreActions', lang)}
                  closeLabel={t('routeClose', lang)}
                  onClose={() => setMenu(false)}
                >
                  <ul className="flex w-max min-w-[9rem] flex-col gap-0.5" data-testid="header-menu">
                    {(
                      [
                        {
                          key: 'resetAll',
                          icon: <RotateCcw size={14} aria-hidden />,
                          run: () => setConfirmReset(true),
                        },
                        { key: 'share', icon: <Share2 size={14} aria-hidden />, run: onShare },
                        { key: 'langToggle', icon: <Globe size={14} aria-hidden />, run: onToggleLang },
                        {
                          key: 'themeToggle',
                          icon: dark ? <Sun size={14} aria-hidden /> : <Moon size={14} aria-hidden />,
                          run: onToggleDark,
                        },
                      ] as const
                    ).map((item) => (
                      <li key={item.key}>
                        <button
                          type="button"
                          onClick={() => {
                            setMenu(false);
                            item.run();
                          }}
                          className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm text-fg hover:bg-surface-2"
                        >
                          {item.icon}
                          {t(item.key, lang)}
                        </button>
                      </li>
                    ))}
                  </ul>
                </DetailSurface>
              ) : null}
              <PanelToggle
                label={t('tabRoutePlan', lang)}
                open={rightOpen}
                controls="panel-right"
                onClick={() => toggle('right')}
              />
            </div>
          </header>

          <div className="flex flex-1 items-start">
            <SidePanel<LeftTab>
              id="panel-left"
              side="left"
              label={t('panelLeft', lang)}
              desktop={desktop}
              open={leftOpen}
              onClose={() => close('left')}
              tabs={leftTabs}
              tab={ui.leftTab}
              onTab={(leftTab) => setUi({ leftTab })}
              lang={lang}
              width={ui.leftWidth}
            >
              {ui.leftTab === 'deck' ? (
                <DeckStep data={data} indexes={indexes} stats={stats} lang={lang} />
              ) : null}
              {ui.leftTab === 'gifts' ? (
                <div className="flex flex-col gap-2.5">
                  <GiftsStep
                    data={data}
                    indexes={indexes}
                    stats={stats}
                    lang={lang}
                    onGoDeck={() => setUi({ leftTab: 'deck' })}
                  />
                  <RouteOptions />
                </div>
              ) : null}
            </SidePanel>

            {desktop && leftOpen ? (
              <PanelResizer
                side="left"
                width={ui.leftWidth}
                onWidth={(leftWidth) => setUi({ leftWidth })}
                lang={lang}
              />
            ) : null}

            <main
              id="stage"
              tabIndex={-1}
              className="flex min-w-0 flex-1 flex-col gap-3 px-4 pb-8 pt-3 lg:px-6 lg:pt-4"
            >
              <RunStage onOpenGifts={openGifts} />
              <footer className="mt-auto border-t border-line pt-3 text-xs text-fg-3">
                <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                  <span>
                    {t('dataVersion', lang)} {data.meta.dataVersion}
                  </span>
                  <span aria-hidden>·</span>
                  {/*
                  The season is named here already, so this is where it is chosen. Until a second
                  season is published there is nothing to choose and the line reads as it always
                  has — no control appears for a list of one.
                */}
                  {seasons.length > 1 ? (
                    <select
                      className="rounded border border-line bg-surface px-1.5 py-0.5 text-xs text-fg-2"
                      aria-label={t('season', lang)}
                      data-testid="season-select"
                      value={data.meta.dungeon.id}
                      onChange={(event) => onSeason(Number(event.target.value))}
                    >
                      {seasons.map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {pick(entry.name, lang) || `MD${entry.id}`}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span>{pick(data.meta.dungeon.name, lang)}</span>
                  )}
                  {data.meta.provisional ? (
                    <span
                      className="text-warn"
                      title={t('seasonProvisionalHint', lang)}
                      data-testid="season-provisional"
                    >
                      {t('seasonProvisional', lang)}
                    </span>
                  ) : null}
                </p>
                <p className="mt-1">
                  {t('aboutData', lang)}{' '}
                  {/* The credits and the takedown path are too long for a footer, so the notice
                    links to the file that holds them rather than growing a third line. */}
                  <a
                    className="underline hover:text-fg-2"
                    href={NOTICE_URL}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    {t('aboutSource', lang)}
                  </a>
                </p>
              </footer>
            </main>

            {desktop && rightOpen ? (
              <PanelResizer
                side="right"
                width={ui.rightWidth}
                onWidth={(rightWidth) => setUi({ rightWidth })}
                lang={lang}
              />
            ) : null}

            <SidePanel<RightTab>
              id="panel-right"
              side="right"
              label={t('panelRight', lang)}
              desktop={desktop}
              open={rightOpen}
              onClose={() => close('right')}
              tabs={rightTabs}
              tab={ui.rightTab}
              onTab={(rightTab) => setUi({ rightTab })}
              lang={lang}
              width={ui.rightWidth}
            >
              {ui.rightTab === 'plan' ? (
                <RoutePlanPanel onOpenGifts={openGifts} />
              ) : ui.rightTab === 'goals' ? (
                <GoalsPanel onOpenGifts={openGifts} />
              ) : (
                <Tracker />
              )}
            </SidePanel>
          </div>
          {confirmReset ? (
            <ConfirmDialog
              title={t('resetAll', lang)}
              message={t('resetAllConfirm', lang)}
              confirmLabel={t('resetAll', lang)}
              onConfirm={reset}
              onCancel={() => setConfirmReset(false)}
              lang={lang}
            />
          ) : null}
        </div>
      </PlanProvider>
    </EnumsContext.Provider>
  );
}
