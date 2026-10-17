/**
 * The run-first shell: a header, the stage in the middle, and two collapsible panels — setup on
 * the left (deck, items with the route options), the route, the goals and the T4 tracker on the
 * right. On a desktop the panels sit beside the stage; on a phone they are drawers. The header's
 * reset puts the deck, the items, the route options and the run back to their first state.
 */
import { useState } from 'react';
import {
  CircleHelp,
  Globe,
  MessageSquareText,
  MoreHorizontal,
  Moon,
  PanelLeft,
  PanelLeftClose,
  PanelRight,
  PanelRightClose,
  RotateCcw,
  Share2,
  Sun,
} from 'lucide-react';
import type { GameData, SeasonEntry } from '../../core/schema.ts';
import type { DeckStats, GameIndexes } from '../../core/types.ts';
import { pick, t, type Lang } from '../i18n.ts';
import { GIFT_ICON_SCALES, TEXT_SCALES, useApp, type LeftTab, type RightTab } from '../store.ts';
import { DEPLOYED_AT_START, defaultDeck } from '../lib/default-deck.ts';
import { useDesktop } from '../lib/useMediaQuery.ts';
import { ConfirmDialog } from '../components/ConfirmDialog.tsx';
import { DetailSurface } from '../components/BlockDetail.tsx';
import { IconButton, Select } from '../components/ui.tsx';
import { DeckStep } from '../steps/DeckStep.tsx';
import { GiftsStep } from '../steps/GiftsStep.tsx';
import { RunStage } from '../stage/RunStage.tsx';
import { Tracker } from '../tracker/Tracker.tsx';
import { PlanProvider } from './PlanContext.tsx';
import { RoutePlanPanel } from './RoutePlanPanel.tsx';
import { RouteOptions } from './RouteOptions.tsx';
import { PanelResizer } from './PanelResizer.tsx';
import { EnumsContext } from '../lib/useEnums.ts';

/**
 * Straight to the file with the credits, the font licence and the takedown path — not the repo
 * root, whose heading anchor would have to stay in step with a Korean title.
 */
const NOTICE_URL = 'https://github.com/yujia-cha/mirror-dungeon/blob/main/NOTICE';
import { SidePanel } from './SidePanel.tsx';
import { GiftBrowser } from './GiftBrowser.tsx';
import { GuideSheet } from './GuideSheet.tsx';
import { FeedbackSheet } from './FeedbackSheet.tsx';
import { CaptureMenu } from './CapturePanel.tsx';
import { CaptureProvider } from '../capture/CaptureProvider.tsx';
import { usePageHistory } from '../lib/usePageHistory.ts';

/** What covers the shell on a phone, or (for `browser`) the stage on a desktop. */
type Drawer = 'left' | 'right' | 'browser' | null;

/**
 * A door to one of the side panels, named by the panel it opens. The name is the button's
 * accessible name too, so no `aria-label` competes with it.
 *
 * The mark is a panel on the side it opens, not the three-bar 「menu」 it used to be: three bars
 * promise a navigation menu, and they looked the same with the panel open or shut. Open, the mark
 * turns to its 「close」 form and the button sits on `surface-2`, so the state is on the button.
 */
function PanelToggle({
  side,
  label,
  open,
  controls,
  onClick,
}: {
  side: 'left' | 'right';
  label: string;
  open: boolean;
  controls: string;
  onClick: () => void;
}) {
  const Mark = side === 'left' ? (open ? PanelLeftClose : PanelLeft) : open ? PanelRightClose : PanelRight;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      aria-controls={controls}
      data-testid={`toggle-${controls}`}
      data-open={open || undefined}
      className={`inline-flex h-9 items-center gap-2 rounded-sm px-2 text-subheading text-fg hover:bg-surface-muted touch:min-h-11 ${open ? 'bg-surface-muted' : ''}`}
    >
      <Mark size={17} aria-hidden />
      {label}
    </button>
  );
}

/**
 * A size setting in the 「⋯」 menu: a titled row of the four steps 작게 · 보통 · 크게 · 아주 크게.
 * The gift icon size (M98) and the text size (M123) both use it, so the two rows share one look —
 * the same 36px buttons of label type as the menu items above them (44px on a touch screen).
 */
function SizeSteps<S extends 'sm' | 'md' | 'lg' | 'xl'>({
  id,
  label,
  lang,
  value,
  steps,
  onPick,
}: {
  id: string;
  label: string;
  lang: Lang;
  value: S;
  steps: readonly S[];
  onPick: (step: S) => void;
}) {
  return (
    <div
      role="group"
      aria-labelledby={`${id}-label`}
      className="mt-1 border-t border-border px-2 pb-1 pt-2"
      data-testid={id}
    >
      <div id={`${id}-label`} className="mb-1 text-caption text-fg-muted">
        {label}
      </div>
      {/* Four equal columns (M128): with `flex-1` each step was at least its own label's width, so
          「아주 크게」 stood wider than the other three. */}
      <div className="grid grid-cols-4 gap-1" data-uniform="both">
        {steps.map((step) => (
          <button
            key={step}
            type="button"
            aria-pressed={value === step}
            onClick={() => onPick(step)}
            className="min-h-9 whitespace-nowrap rounded-sm border border-border-control px-2 text-label text-fg hover:bg-surface-muted active:bg-surface-sunken aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-fg touch:min-h-11"
          >
            {t(`sizeStep_${step}`, lang)}
          </button>
        ))}
      </div>
    </div>
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
   * Phones keep their own drawer state: only one drawer at a time, closed on every load. The
   * 「모두 보기」 gift browser is the third drawer, and the one that both layouts share — on a
   * desktop the panels are `ui` state, but the browser is as unsaved as a phone's page.
   *
   * The layout it was opened under is stored with it. Crossing the breakpoint otherwise leaves the
   * two states disagreeing — a drawer opened on a phone would spring back open, backdrop and all,
   * after the same panel had been closed on a desktop — and the fix used to be an effect that
   * cleared it. Reading it as closed whenever the layout has changed does the same thing during
   * render, with no second pass.
   */
  const [drawerState, setDrawerState] = useState<{ desktop: boolean; side: Drawer }>({
    desktop,
    side: null,
  });
  const drawer = drawerState.desktop === desktop ? drawerState.side : null;
  const setDrawer = (side: Drawer): void => setDrawerState({ desktop, side });
  // The browser opens from the items tab. On a phone that tab is the left page, and the browser
  // page opens over it rather than in its place (M124): the left page stays open underneath,
  // covered, so its history entry stays and the browser's stacks on top. One back closes the
  // browser and shows the tab as it was left — the query typed in it and its scroll included.
  const leftOpen = desktop ? ui.leftOpen : drawer === 'left' || drawer === 'browser';
  const rightOpen = desktop ? ui.rightOpen : drawer === 'right';
  const browserOpen = drawer === 'browser';
  // On a phone a panel is a full-screen page portalled to the body, so the shell behind it is
  // inert: nothing under the page takes focus or a press, and it leaves the accessibility tree.
  const pageOpen = !desktop && drawer !== null;
  // It opens on the query typed in the tab. On a desktop the tab stays beside it and its >> turns
  // to a << that closes it; the next open remounts it on whatever the tab holds then.
  const [browserSeed, setBrowserSeed] = useState({ query: '', n: 0 });
  const openBrowser = (query: string): void => {
    setBrowserSeed((seed) => ({ query, n: seed.n + 1 }));
    setDrawer('browser');
  };
  const closeBrowser = (): void => setDrawer(desktop ? null : 'left');
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
  // The guide is a sheet over whatever is open, so on a phone it takes a history entry of its own:
  // the device's back closes the guide first, as it does a gift sheet.
  const [guide, setGuide] = useState(false);
  usePageHistory(guide, () => setGuide(false), !desktop);
  // The feedback form (M127) is a sheet the same way.
  const [feedback, setFeedback] = useState(false);
  usePageHistory(feedback, () => setFeedback(false), !desktop);
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
    { id: 'tracker', label: t('tabTracker', lang) },
  ];

  return (
    /* Leaves that need a game display name (a gift icon's keyword, for its accessible label) read
       it from here rather than having `enums` threaded through every component between. */
    <EnumsContext.Provider value={data.enums}>
      <PlanProvider data={data} indexes={indexes} stats={stats} lang={lang}>
        <CaptureProvider>
          <div className="flex min-h-dvh flex-col" data-testid="app-shell" inert={pageOpen || undefined}>
            {/*
            The header carries two panel doors and a menu before the stage begins; a keyboard reader
            had to tab past all of them on every load. Hidden until focused, so nothing changes for
            a pointer, and it is the first thing Tab reaches.
          */}
            <a
              href="#stage"
              className="sr-only rounded-sm bg-primary px-3 py-2 text-label text-primary-fg focus-visible:not-sr-only focus-visible:absolute focus-visible:left-3 focus-visible:top-3 focus-visible:z-40"
              data-testid="skip-link"
            >
              {t('skipToStage', lang)}
            </a>
            <header className="sticky top-0 z-30 flex h-[52px] flex-none items-center justify-between border-b border-border bg-surface px-4 lg:h-14 lg:px-6">
              {/* The page's one h1: the header shows doors, not a title, so it is for assistive tech. */}
              <h1 className="sr-only">{t('appTitle', lang)}</h1>
              {/*
            Two doors and a drawer of odds and ends. The panel buttons carry their own name, so the
            header needs no title to say where you are, and the four one-off actions sit behind 「⋯」
            rather than competing with the doors for the eye.
          */}
              <PanelToggle
                side="left"
                label={t('tabDeck', lang)}
                open={leftOpen}
                controls="panel-left"
                onClick={() => toggle('left')}
              />
              <div className="relative flex items-center gap-1.5">
                <CaptureMenu />
                <IconButton onClick={() => setGuide(true)} label={t('guide', lang)} testId="guide-open">
                  <CircleHelp size={15} />
                </IconButton>
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
                    {/* Full width, never `w-max` (M122): the menu is as wide as its widest section (the size
                        steps), and every row has to span it — a list sized to its own labels left
                        the four actions shorter than the steps below them. */}
                    <ul
                      className="flex w-full min-w-[9rem] flex-col gap-0.5"
                      data-testid="header-menu"
                      data-uniform="width"
                    >
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
                          // M127: a GitHub issue the app fills in (FeedbackSheet).
                          {
                            key: 'feedback',
                            icon: <MessageSquareText size={14} aria-hidden />,
                            run: () => setFeedback(true),
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
                            // One size with the icon-size steps below (M122): the same 36px row, the
                            // same label type, so the menu reads as one set of controls.
                            className="flex min-h-9 w-full items-center gap-2 rounded-sm px-2 text-left text-label text-fg hover:bg-surface-muted active:bg-surface-sunken touch:min-h-11"
                          >
                            {item.icon}
                            {t(item.key, lang)}
                          </button>
                        </li>
                      ))}
                    </ul>
                    {/*
                    Not menu actions: picking a step keeps the menu open, so the tiles (or the text)
                    behind it can be seen changing before the next pick. The two groups are one
                    component so they cannot drift apart in size or type (M122/M123).
                  */}
                    <SizeSteps
                      id="gift-icon-size"
                      label={t('giftIconSize', lang)}
                      lang={lang}
                      value={ui.giftIconScale}
                      steps={GIFT_ICON_SCALES}
                      onPick={(giftIconScale) => setUi({ giftIconScale })}
                    />
                    <SizeSteps
                      id="type-size"
                      label={t('textSize', lang)}
                      lang={lang}
                      value={ui.textScale}
                      steps={TEXT_SCALES}
                      onPick={(textScale) => setUi({ textScale })}
                    />
                  </DetailSurface>
                ) : null}
                <PanelToggle
                  side="right"
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
                covered={!desktop && browserOpen}
              >
                {ui.leftTab === 'deck' ? (
                  <DeckStep data={data} indexes={indexes} stats={stats} lang={lang} />
                ) : null}
                {ui.leftTab === 'gifts' ? (
                  <div className="flex flex-col gap-3">
                    <GiftsStep
                      data={data}
                      indexes={indexes}
                      stats={stats}
                      lang={lang}
                      onGoDeck={() => setUi({ leftTab: 'deck' })}
                      onBrowse={openBrowser}
                      browseOpen={desktop && browserOpen}
                      onCloseBrowse={closeBrowser}
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

              <main id="stage" tabIndex={-1} className="relative flex min-w-0 flex-1 flex-col">
                {/*
                On a desktop the gift browser takes the stage's column. The stage stays mounted
                underneath so nothing it holds is lost, but hidden and inert: it neither shows
                through nor takes a Tab while covered.
              */}
                {desktop && browserOpen ? (
                  <GiftBrowser
                    key={browserSeed.n}
                    page={false}
                    initialQuery={browserSeed.query}
                    onClose={closeBrowser}
                  />
                ) : null}
                <div
                  className={`flex flex-1 flex-col gap-3 px-4 pb-8 pt-3 lg:px-6 lg:pt-4 ${desktop && browserOpen ? 'hidden' : ''}`}
                  inert={(desktop && browserOpen) || undefined}
                  data-testid="stage-body"
                >
                  <RunStage onOpenGifts={openGifts} />
                  <footer className="mt-auto border-t border-border pt-3 text-caption text-fg-subtle">
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
                        <Select
                          label={t('season', lang)}
                          testId="season-select"
                          value={String(data.meta.dungeon.id)}
                          options={seasons.map((entry) => ({
                            value: String(entry.id),
                            label: pick(entry.name, lang) || `MD${entry.id}`,
                          }))}
                          onChange={(value) => onSeason(Number(value))}
                        />
                      ) : (
                        <span>{pick(data.meta.dungeon.name, lang)}</span>
                      )}
                      {data.meta.provisional ? (
                        <strong
                          className="text-fg-muted"
                          title={t('seasonProvisionalHint', lang)}
                          data-testid="season-provisional"
                        >
                          {t('seasonProvisional', lang)}
                        </strong>
                      ) : null}
                    </p>
                    <p className="mt-1">
                      {t('aboutData', lang)}{' '}
                      {/* The credits and the takedown path are too long for a footer, so the notice
                    links to the file that holds them rather than growing a third line. */}
                      <a
                        className="underline hover:text-fg-muted"
                        href={NOTICE_URL}
                        target="_blank"
                        rel="noreferrer noopener"
                      >
                        {t('aboutSource', lang)}
                      </a>
                    </p>
                  </footer>
                </div>
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
                {ui.rightTab === 'plan' ? <RoutePlanPanel onOpenGifts={openGifts} /> : <Tracker />}
              </SidePanel>
            </div>
            {!desktop && browserOpen ? (
              <GiftBrowser key={browserSeed.n} page initialQuery={browserSeed.query} onClose={closeBrowser} />
            ) : null}
            {guide ? <GuideSheet lang={lang} noticeUrl={NOTICE_URL} onClose={() => setGuide(false)} /> : null}
            {feedback ? <FeedbackSheet onClose={() => setFeedback(false)} /> : null}
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
        </CaptureProvider>
      </PlanProvider>
    </EnumsContext.Provider>
  );
}
