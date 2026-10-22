/**
 * What the overlay window (M132) shows, top to bottom: the screen reader's state and the floor,
 * what is still to collect in the pack the player is in and the packs the route can enter next, and
 * the last few things that happened. Inside a pack the gifts left come first; once the reader has
 * seen the player leave the shop — the floor's last stop — the next packs do (M157). Drawn into the window's body through a portal, so it reads the same
 * plan, store and session as the page.
 *
 * A glance, not a second app (the owner's call). Every listener the app's floating layers use
 * (`useDismiss`, `DetailSurface`, the sheets) is on the page's `document`, which a press in this
 * window never reaches — so nothing here opens a sheet or a popover, and names are plain words, not
 * links. The one thing it can change is the run start (M138): plain buttons, whose React handlers
 * do reach this window (React listens on the portal's container), say which start gifts and
 * observations the game actually gave, because that is decided in the game while this window is
 * the one in view. Only while the screen reader is off (M141): while it runs, the start is its
 * record — a confirm pressed early closed the start, and the reader stopped looking for the
 * observation screen — so the section just shows what it has seen and settles on floor 1's pack
 * select by itself (tracker `startDone` → `settleStart`).
 */
import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { TriangleAlert } from 'lucide-react';
import { pick, t } from '../i18n.ts';
import { useApp } from '../store.ts';
import { feedbackLog, type FeedbackLog } from '../lib/feedback-log.ts';
import { useCaptureSession } from '../capture/capture-context.ts';
import { giftName, statusTextOf } from '../capture/capture-text.ts';
import { factKeys, overlayFacts, type FactLog } from './overlay-log.ts';
import { captureKeys, captureSentence, factSentence, type NameOf } from './overlay-text.ts';
import { GiftIcon } from '../components/GiftIcon.tsx';
import { Badge, Button } from '../components/ui.tsx';
import { usePlan } from '../shell/plan-context.ts';
import { trackerGifts } from '../lib/tracker.ts';
import { holdImage, packImage } from '../lib/assets.ts';
import {
  clockOf,
  nextPack,
  recentLines,
  type RecentLine,
  remainingIn,
  shopView,
  startCandidates,
  startEvidence,
  startInitiallyOn,
  startPicks,
  type StartCandidate,
} from './overlay-model.ts';

/** A log the window reads: its entries, a revision that moves with them, and a way to listen. */
interface RevisionLog<T> {
  readonly revision: number;
  entries(): T[];
  subscribe(listener: () => void): () => void;
}

/** One copy of a log's entries per revision, so `useSyncExternalStore` sees a stable snapshot. */
const snapshots = new WeakMap<object, { revision: number; entries: unknown[] }>();

/** A log's entries — the feedback log's errors, the run facts (M151) — re-read whenever it grows. */
function useLogEntries<T>(log: RevisionLog<T>): T[] {
  const subscribe = useCallback((onChange: () => void) => log.subscribe(() => onChange()), [log]);
  return useSyncExternalStore(subscribe, () => {
    const cached = snapshots.get(log);
    if (cached?.revision === log.revision) return cached.entries as T[];
    const entries = log.entries();
    snapshots.set(log, { revision: log.revision, entries });
    return entries;
  });
}

function SectionTitle({ children }: { children: string }) {
  return <h2 className="text-caption-strong text-fg-muted">{children}</h2>;
}

const START_TAG = {
  start: 'routeStartGift',
  pinned: 'observePinned',
  recommended: 'routeObservedRecommended',
  got: 'giftStatusGot',
} as const;

/**
 * The run start the plan expects (M138) and what floor 1 already collected (M140), while the screen
 * reader is off (M141 — `StartLive` stands in while it runs). The toggles start from `initial`
 * (`startInitiallyOn`: everything, the plan's guess) and the player fixes what differs. Keyed by
 * both, so a recalculated start starts it over.
 */
function StartChoice({ candidates, initial }: { candidates: StartCandidate[]; initial: Set<number> }) {
  const { indexes, lang, confirmStart } = usePlan();
  const [taken, setTaken] = useState(() => new Set(initial));
  const toggle = (id: number): void =>
    setTaken((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <section className="flex flex-col gap-2" data-testid="overlay-start">
      <SectionTitle>{t('overlayStartTitle', lang)}</SectionTitle>
      <p className="text-caption text-fg-muted">{t('overlayStartHint', lang)}</p>
      <ul className="flex flex-col gap-1" data-uniform="width">
        {candidates.map((c) => {
          const gift = indexes.giftById.get(c.giftId);
          if (!gift) return null;
          const on = taken.has(c.giftId);
          return (
            <li key={c.giftId} className="flex">
              <button
                type="button"
                aria-pressed={on}
                onClick={() => toggle(c.giftId)}
                className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-sm px-1 py-1 text-left hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                data-testid="overlay-start-gift"
                data-gift={c.giftId}
                data-kind={c.kind}
              >
                <GiftIcon gift={gift} size={32} lang={lang} status={on ? 'got' : null} pending={!on} />
                <span className="min-w-0 flex-1 break-keep text-caption text-fg">
                  {pick(gift.name, lang)}
                </span>
                <span className="flex-none text-caption text-fg-subtle">{t(START_TAG[c.kind], lang)}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <Button
        variant="primary"
        onClick={() => confirmStart(startPicks(candidates, taken))}
        testId="overlay-start-confirm"
      >
        {t('overlayStartConfirm', lang)}
      </Button>
    </section>
  );
}

/** Rows of the pack grid shown at once (M151); the rest scroll into view under them. */
const PACK_GRID_ROWS = 2;
const PACK_GRID_COLUMNS = 3;
/**
 * The grid's height for `PACK_GRID_ROWS` rows: a cell is a third of the container less two gaps
 * (8px), its picture 8:15 of that, then a 4px gap and a two-line name (2.6em at the caption size
 * the list is set in), rows 8px apart. Measured in container units, so it follows the window's
 * width without a script.
 */
const PACK_GRID_HEIGHT = `calc(${PACK_GRID_ROWS} * ((100cqw - ${(PACK_GRID_COLUMNS - 1) * 8}px) / ${PACK_GRID_COLUMNS} * 15 / 8 + 4px + 2.6em) + ${(PACK_GRID_ROWS - 1) * 8}px + 1px)`;

/**
 * The packs the player may enter next (M148), as the game deals them (M151, the owner's pick): a
 * grid of three, each picture as wide as its column with the name under it — two rows in sight,
 * the rest under them by scrolling, which a line says. The pack the plan put on that floor comes
 * first; 「외 N」 sits on the picture's corner.
 */
function PackGrid({
  packs,
}: {
  packs: readonly { packId: number; planned: boolean; alternatives: number }[];
}) {
  const { indexes, lang } = usePlan();
  const hidden = packs.length - PACK_GRID_ROWS * PACK_GRID_COLUMNS;
  return (
    <div className="@container flex flex-col gap-1">
      <ul
        className="grid grid-cols-3 gap-2 overflow-y-auto text-caption"
        style={{ maxHeight: PACK_GRID_HEIGHT }}
        data-testid="overlay-pack-list"
        data-uniform="width"
      >
        {packs.map((row) => {
          const pack = indexes.packById.get(row.packId);
          if (!pack) return null;
          const name = pick(pack.name, lang);
          const picture = packImage(pack.sprite);
          return (
            <li
              key={row.packId}
              className="relative flex min-w-0 flex-col items-center gap-1"
              data-pack={row.packId}
              data-planned={row.planned || undefined}
              title={name}
            >
              <span
                role="img"
                aria-label={name}
                className="block aspect-[8/15] w-full overflow-hidden rounded-sm border border-border bg-surface-sunken"
                data-testid="overlay-pack-card"
              >
                {picture ? (
                  <img
                    src={picture.url}
                    alt=""
                    draggable={false}
                    onLoad={() => holdImage(picture.url)}
                    className="h-full w-full object-cover"
                    style={picture.pixelArt ? { imageRendering: 'pixelated' } : undefined}
                  />
                ) : null}
              </span>
              <span className="line-clamp-2 h-[2.6em] w-full break-keep text-center text-caption text-fg">
                {name}
              </span>
              {row.alternatives > 0 ? (
                <span className="absolute right-1 top-1" data-testid="overlay-alternatives">
                  <Badge tone="neutral">{t('stagePackAlternatives', lang, { n: row.alternatives })}</Badge>
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
      {hidden > 0 ? (
        <p className="text-caption text-fg-subtle" data-testid="overlay-pack-more">
          {t('overlayPacksMore', lang, { n: hidden })}
        </p>
      ) : null}
    </div>
  );
}

/** How many gifts a row of 「남은 기프트」 holds and how many rows show before it scrolls (M157). */
const GIFT_GRID_ROWS = 2;
const GIFT_GRID_COLUMNS = 4;
const GIFT_GRID_ICON = 44;
/** Rows of a 44px icon, a 4px gap and a two-line name (2.6em at the caption size), 8px apart. */
const GIFT_GRID_HEIGHT = `calc(${GIFT_GRID_ROWS} * (${GIFT_GRID_ICON}px + 4px + 2.6em) + ${(GIFT_GRID_ROWS - 1) * 8}px + 1px)`;

/**
 * The gifts to take from the pack entered last, laid out as the packs are (M157, the owner's
 * pick): rows of four, icon with the name under it — two rows in sight, the rest under them by
 * scrolling, which a line says. A long list no longer pushes everything below it away. A gift
 * collected keeps its place with the collected frame and ✓ (the fusion arrow when used), one still
 * to get the dotted frame — the stage's and the shop's marks, so shape says it, not colour alone.
 */
function GiftGrid({ ids }: { ids: readonly number[] }) {
  const { indexes, lang } = usePlan();
  const giftStatus = useApp((s) => s.run.giftStatus);
  const hidden = ids.length - GIFT_GRID_ROWS * GIFT_GRID_COLUMNS;
  return (
    <div className="flex flex-col gap-1">
      <ul
        className="grid grid-cols-4 gap-2 overflow-y-auto text-caption"
        style={{ maxHeight: GIFT_GRID_HEIGHT }}
        data-testid="overlay-remaining-list"
        data-uniform="width"
      >
        {ids.map((id) => {
          const gift = indexes.giftById.get(id);
          if (!gift) return null;
          const name = pick(gift.name, lang);
          const status = giftStatus[id] ?? null;
          return (
            <li
              key={id}
              className="flex min-w-0 flex-col items-center gap-1"
              data-gift={id}
              data-status={status ?? 'pending'}
              title={name}
            >
              <GiftIcon
                gift={gift}
                size={GIFT_GRID_ICON}
                lang={lang}
                status={status}
                pending={status === null}
              />
              <span className="line-clamp-2 h-[2.6em] w-full break-keep text-center text-caption text-fg">
                {name}
              </span>
            </li>
          );
        })}
      </ul>
      {hidden > 0 ? (
        <p className="text-caption text-fg-subtle" data-testid="overlay-remaining-more">
          {t('overlayGiftsMore', lang, { n: hidden })}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Whether the reader has seen the player leave the shop since the pack entered last (M157): the
 * shop is the floor's last stop, so from then on the next pack is what the player is choosing.
 * Read during render (not in an effect), so the window never draws one frame in the old order.
 * A session that stops while in the shop is not a way out of it.
 */
function useLeftShop(inShop: boolean, running: boolean, entry: string | null): boolean {
  const [seen, setSeen] = useState<{ inShop: boolean; leftFor: string | null | undefined }>({
    inShop,
    leftFor: undefined,
  });
  if (seen.inShop !== inShop)
    setSeen({ inShop, leftFor: seen.inShop && !inShop && running ? entry : seen.leftFor });
  return seen.leftFor !== undefined && seen.leftFor === entry;
}

/** The words a shop line says about a gift: in hand, used in a fusion, or not got (M151). */
const SHOP_STATUS = { got: 'giftStatusGot', used: 'giftStatusUsed', missing: 'giftStatusFailed' } as const;

/**
 * A gift of this floor's pack in the shop (M151): icon and name, then whether the run has it —
 * the collected frame and ✓ (or the fusion arrow) with 「획득」 / 「조합에 씀」, else the dotted
 * frame of one still to get with 「미획득」. Shape and words say it, never colour alone.
 */
/** The pack sheet's frame around a route goal's icon: `primary`, 2px; transparent otherwise. */
const GOAL_FRAME = (goal: boolean): string =>
  `inline-flex flex-none rounded-md border-2 p-0.5 ${goal ? 'border-primary' : 'border-transparent'}`;

function GiftLine({ id }: { id: number }) {
  const { indexes, lang, needed } = usePlan();
  const status = useApp((s) => s.run.giftStatus[id] ?? null);
  const gift = indexes.giftById.get(id);
  if (!gift) return null;
  const shown = status === 'got' || status === 'used' ? status : 'missing';
  const goal = needed.has(id);
  return (
    <li
      className="flex min-w-0 items-center gap-2"
      data-gift={id}
      data-status={shown}
      data-needed={goal || undefined}
    >
      {/* A route goal wears the pack sheet's frame and says so (M169 — on the shelves, the goals are what to buy). */}
      <span className={GOAL_FRAME(goal)}>
        <GiftIcon
          gift={gift}
          size={32}
          lang={lang}
          status={shown === 'missing' ? null : shown}
          pending={shown === 'missing'}
        />
      </span>
      <span className="min-w-0 flex-1 break-keep text-caption text-fg">{pick(gift.name, lang)}</span>
      {goal ? <Badge tone="goal">{t('giftWanted', lang)}</Badge> : null}
      <span className={`flex-none text-caption ${shown === 'missing' ? 'text-fg-muted' : 'text-fg-subtle'}`}>
        {t(SHOP_STATUS[shown], lang)}
      </span>
    </li>
  );
}

/**
 * In a pack's shop (M148, the owner's pick): every gift only this floor's pack hands out, each
 * marked got or not (M151 — the list of goals still to collect is gone), and the tracker's tier-4
 * gifts without the 조각 series — what to look for on the shelves. The next pack and what is left
 * in it come back when the player walks out.
 */
function ShopSections() {
  const { data, indexes, lang, packName, exclusivesOf, needed } = usePlan();
  const run = useApp((s) => s.run);
  const groups = useMemo(() => trackerGifts(data, indexes), [data, indexes]);
  const view = shopView(run, exclusivesOf, groups, needed);
  const none = <p className="text-caption text-fg-subtle">{t('overlayShopNone', lang)}</p>;
  return (
    <>
      <section className="flex flex-col gap-2" data-testid="overlay-shop-exclusive">
        <SectionTitle>{t('overlayShopExclusive', lang)}</SectionTitle>
        {view.packId !== null ? (
          <p className="break-keep text-caption text-fg-muted">{packName(view.packId)}</p>
        ) : null}
        {view.exclusive.length > 0 ? (
          <ul className="flex flex-col gap-1.5">
            {view.exclusive.map((id) => (
              <GiftLine key={id} id={id} />
            ))}
          </ul>
        ) : (
          none
        )}
      </section>
      <section className="flex flex-col gap-2" data-testid="overlay-shop-t4">
        <SectionTitle>{t('overlayShopT4', lang)}</SectionTitle>
        <ul className="flex flex-wrap gap-1.5">
          {view.t4.map((id) => {
            const gift = indexes.giftById.get(id);
            const goal = needed.has(id);
            return gift ? (
              <li
                key={id}
                className={GOAL_FRAME(goal)}
                data-gift={id}
                data-needed={goal || undefined}
                title={`${pick(gift.name, lang)}${goal ? ` · ${t('giftWanted', lang)}` : ''}`}
              >
                <GiftIcon
                  gift={gift}
                  size={32}
                  lang={lang}
                  status={run.giftStatus[id] === 'failed' ? null : (run.giftStatus[id] ?? null)}
                />
              </li>
            ) : null;
          })}
        </ul>
      </section>
    </>
  );
}

/**
 * The run start while the screen reader runs (M141): the same rows, nothing to press. A gift the
 * reader recorded on floor 1 (`got`) has the collected border and ✓, the rest the dotted border of
 * one not seen yet. The reader settles the start itself when it sees floor 1's theme pack select.
 */
function StartLive({ candidates, got }: { candidates: StartCandidate[]; got: Set<number> }) {
  const { indexes, lang } = usePlan();
  return (
    <section className="flex flex-col gap-2" data-testid="overlay-start" data-live="">
      <SectionTitle>{t('overlayStartTitle', lang)}</SectionTitle>
      <p className="text-caption text-fg-muted">{t('overlayStartLiveHint', lang)}</p>
      <ul className="flex flex-col gap-1" data-uniform="width">
        {candidates.map((c) => {
          const gift = indexes.giftById.get(c.giftId);
          if (!gift) return null;
          const on = got.has(c.giftId);
          return (
            <li
              key={c.giftId}
              className="flex min-h-11 min-w-0 items-center gap-2 px-1 py-1"
              data-testid="overlay-start-gift"
              data-gift={c.giftId}
              data-kind={c.kind}
              data-got={on ? '' : undefined}
            >
              <GiftIcon gift={gift} size={32} lang={lang} status={on ? 'got' : null} pending={!on} />
              <span className="min-w-0 flex-1 break-keep text-caption text-fg">{pick(gift.name, lang)}</span>
              <span className="flex-none text-caption text-fg-subtle">{t(START_TAG[c.kind], lang)}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * The window's contents. `log` is the page's feedback log (its errors) and `facts` the run's
 * changes (M151), unless a test hands in its own.
 */
export function OverlayBody({
  log = feedbackLog,
  facts = overlayFacts,
}: {
  log?: FeedbackLog;
  facts?: FactLog;
}) {
  const { indexes, lang, shown, packName, expectedIn, reopenStart } = usePlan();
  const capture = useCaptureSession();
  const run = useApp((s) => s.run);
  const lastFloor = useApp((s) => s.lastFloor);
  const feedback = useLogEntries(log);
  const changes = useLogEntries(facts);

  const running = capture.status === 'running';
  const asking = capture.questions.length;
  const next = nextPack(shown, run, lastFloor, indexes);
  const left = remainingIn(run, expectedIn);
  // In a pack, what is left to take comes first; once out of the shop, the next pack does (M157).
  const packsFirst = useLeftShop(capture.inShop, running, left ? `${left.floor}:${left.packId}` : null);
  const start = startCandidates(shown, run);
  const evidence = startEvidence(run);
  // While the reader runs its record is the answer (M141); without it, the plan's guess, all on.
  const startOn = start ? startInitiallyOn(start, evidence, running) : null;
  const names: NameOf = { lang, gift: (id) => giftName(indexes, id, lang), pack: packName };
  const recent = recentLines([
    ...feedback.flatMap((entry, i): RecentLine[] =>
      entry.kind === 'error'
        ? [{ at: entry.t, kind: 'error', text: entry.message, key: `e${entry.t}-${i}` }]
        : [],
    ),
    ...changes.flatMap((entry, i): RecentLine[] => {
      const text = factSentence(entry.fact, names);
      return text
        ? [{ at: entry.t, kind: 'action', text, key: `a${entry.t}-${i}`, about: factKeys(entry.fact) }]
        : [];
    }),
    ...capture.log.flatMap((entry): RecentLine[] => {
      const text = captureSentence(entry, names);
      return text
        ? [
            {
              at: entry.at,
              kind: 'capture',
              text,
              undone: entry.undone,
              key: `c${entry.id}`,
              about: captureKeys(entry),
            },
          ]
        : [];
    }),
  ]);

  let status;
  if (capture.error) {
    status = (
      <>
        <TriangleAlert size={14} aria-hidden className="flex-none" />
        {t('captureErrShort', lang)}
      </>
    );
  } else if (running) {
    status = `● ${t('captureRunning', lang)}`;
  } else if (capture.status === 'starting') {
    status = t('captureStarting', lang);
  } else {
    status = t('overlayCaptureOff', lang);
  }

  const nextSection = (
    <section className="flex flex-col gap-2" data-testid="overlay-next" data-kind={next.kind}>
      <SectionTitle>
        {next.kind === 'done'
          ? t('stageDone', lang, { last: lastFloor })
          : t('overlayNext', lang, { floor: next.floor })}
      </SectionTitle>
      {next.kind === 'pack' ? (
        <PackGrid packs={next.packs} />
      ) : next.kind === 'noPlan' ? (
        <p className="text-caption text-fg-subtle">{t('stageNoGoals', lang)}</p>
      ) : next.kind === 'none' ? (
        <p className="text-caption text-fg-subtle">{t('stageNoRoutePack', lang)}</p>
      ) : null}
    </section>
  );
  const remainingSection = (
    <section className="flex flex-col gap-2" data-testid="overlay-remaining">
      <SectionTitle>{t('overlayRemaining', lang)}</SectionTitle>
      {left ? (
        <>
          <p className="break-keep text-caption text-fg-muted" data-pack={left.packId}>
            {t('overlayEntered', lang, { floor: left.floor, name: packName(left.packId) })}
          </p>
          {left.listed.length === 0 ? (
            <p className="text-caption text-fg-subtle">{t('overlayRemainingNone', lang)}</p>
          ) : (
            <GiftGrid ids={left.listed} />
          )}
        </>
      ) : (
        <p className="text-caption text-fg-subtle">{t('overlayNotEntered', lang)}</p>
      )}
    </section>
  );

  return (
    <div className="flex min-w-0 flex-col gap-4 p-3" data-testid="overlay">
      <section className="flex flex-col gap-1" data-testid="overlay-head">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={`flex min-w-0 flex-1 items-center gap-1.5 text-label ${running || capture.error ? 'text-fg' : 'text-fg-muted'}`}
            data-testid="overlay-status"
            data-status={capture.status}
            data-error={capture.error ?? undefined}
          >
            {status}
          </span>
          <span className="flex flex-none items-baseline gap-1" data-testid="overlay-floor">
            <span className="font-num text-heading text-fg">{Math.min(run.currentFloor, lastFloor)}</span>
            <span className="font-num text-caption text-fg-subtle">
              {t('stageOf', lang, { last: lastFloor })}
            </span>
          </span>
        </div>
        {capture.error ? <p className="text-caption text-fg-muted">{statusTextOf(capture, lang)}</p> : null}
        {asking ? (
          <div data-testid="overlay-asking">
            <Badge tone="alert">{t('captureAsking', lang, { n: asking })}</Badge>
          </div>
        ) : null}
      </section>

      {start && running ? (
        <StartLive candidates={start} got={startOn!} />
      ) : start ? (
        <StartChoice
          key={`${start.map((c) => `${c.kind}:${c.giftId}`).join(',')}|${[...startOn!].join(',')}`}
          candidates={start}
          initial={startOn!}
        />
      ) : run.currentFloor === 1 && run.startDone ? (
        <div className="flex min-w-0 items-center gap-2" data-testid="overlay-start-done">
          <span className="min-w-0 flex-1 text-caption text-fg-muted">
            {t('overlayStartDone', lang, { n: run.startGifts.length })}
          </span>
          <Button size="sm" variant="ghost" onClick={reopenStart} testId="overlay-start-reopen">
            {t('overlayStartReopen', lang)}
          </Button>
        </div>
      ) : null}

      {capture.inShop ? (
        <ShopSections />
      ) : packsFirst ? (
        <>
          {nextSection}
          {remainingSection}
        </>
      ) : (
        <>
          {remainingSection}
          {nextSection}
        </>
      )}

      <section className="flex flex-col gap-1" data-testid="overlay-recent">
        <SectionTitle>{t('overlayRecent', lang)}</SectionTitle>
        {recent.length === 0 ? (
          <p className="text-caption text-fg-subtle">{t('overlayRecentEmpty', lang)}</p>
        ) : (
          <ul className="flex flex-col">
            {recent.map((line) => (
              <li
                key={line.key}
                className="flex min-w-0 gap-2 border-b border-border py-1 text-caption last:border-b-0"
                data-kind={line.kind}
              >
                <span className="flex-none font-num text-fg-subtle">{clockOf(line.at)}</span>
                <span
                  className={`min-w-0 flex-1 break-keep ${line.undone ? 'text-fg-subtle line-through' : line.kind === 'error' ? 'text-fg' : 'text-fg-muted'}`}
                >
                  {line.kind === 'capture' ? (
                    <span className="mr-1 text-fg-subtle">{t('overlayLogReader', lang)}</span>
                  ) : null}
                  {line.kind === 'error' ? t('overlayLogError', lang, { text: line.text }) : line.text}
                  {line.undone ? ` · ${t('captureUndone', lang)}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** The window's contents, in its body. */
export function OverlayView({
  target,
  log,
  facts,
}: {
  target: HTMLElement;
  log?: FeedbackLog;
  facts?: FactLog;
}) {
  return createPortal(<OverlayBody log={log} facts={facts} />, target);
}
