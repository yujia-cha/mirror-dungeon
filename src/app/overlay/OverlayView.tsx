/**
 * What the overlay window (M132) shows, top to bottom: the screen reader's state and the floor, the
 * pack the route enters next, what is still to collect in the pack the player is in, and the last
 * few things that happened. Drawn into the window's body through a portal, so it reads the same
 * plan, store and session as the page.
 *
 * A glance, not a second app (the owner's call). Every listener the app's floating layers use
 * (`useDismiss`, `DetailSurface`, the sheets) is on the page's `document`, which a press in this
 * window never reaches — so nothing here opens a sheet or a popover, and names are plain words, not
 * links. The one thing it does change is the run start (M138): plain buttons, whose React handlers
 * do reach this window (React listens on the portal's container), say which start gifts and
 * observations the game actually gave, because that is decided in the game while this window is
 * the one in view.
 */
import { useCallback, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { TriangleAlert } from 'lucide-react';
import { pick, t } from '../i18n.ts';
import { useApp } from '../store.ts';
import { feedbackLog, type FeedbackLog, type FeedbackLogEntry } from '../lib/feedback-log.ts';
import { useCaptureSession } from '../capture/capture-context.ts';
import { logText, statusTextOf } from '../capture/capture-text.ts';
import { GiftIcon } from '../components/GiftIcon.tsx';
import { PackCard } from '../components/PackCard.tsx';
import { Badge, Button } from '../components/ui.tsx';
import { usePlan } from '../shell/plan-context.ts';
import {
  clockOf,
  nextPack,
  recentLines,
  remainingIn,
  startCandidates,
  startEvidence,
  startInitiallyOn,
  startPicks,
  type StartCandidate,
} from './overlay-model.ts';

/** One copy of the log's entries per revision, so `useSyncExternalStore` sees a stable snapshot. */
const snapshots = new WeakMap<FeedbackLog, { revision: number; entries: FeedbackLogEntry[] }>();
function snapshotOf(log: FeedbackLog): FeedbackLogEntry[] {
  const cached = snapshots.get(log);
  if (cached?.revision === log.revision) return cached.entries;
  const entries = log.entries();
  snapshots.set(log, { revision: log.revision, entries });
  return entries;
}

/** The feedback log's entries, re-read whenever it grows. */
function useFeedbackEntries(log: FeedbackLog): FeedbackLogEntry[] {
  const subscribe = useCallback((onChange: () => void) => log.subscribe(() => onChange()), [log]);
  return useSyncExternalStore(subscribe, () => snapshotOf(log));
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
 * The run start the plan expects (M138) and what floor 1 already collected (M140). The toggles
 * start from `initial` (`startInitiallyOn`: the reader's evidence, or everything when nobody
 * watched) and the player fixes what differs. Keyed by both, so a recalculated start or a popup
 * the reader just saw starts it over.
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

/** The window's contents. `log` is the page's feedback log unless a test hands in its own. */
export function OverlayBody({ log = feedbackLog }: { log?: FeedbackLog }) {
  const { indexes, lang, shown, packName, expectedIn, reopenStart } = usePlan();
  const capture = useCaptureSession();
  const run = useApp((s) => s.run);
  const lastFloor = useApp((s) => s.lastFloor);
  const feedback = useFeedbackEntries(log);

  const running = capture.status === 'running';
  const asking = capture.questions.length;
  const next = nextPack(shown, run, lastFloor, indexes);
  const left = remainingIn(run, expectedIn);
  const start = startCandidates(shown, run);
  const evidence = startEvidence(run);
  const startOn = start ? startInitiallyOn(start, evidence, running) : null;
  const recent = recentLines(feedback, capture.log, (entry) => logText(entry, indexes, lang, packName));

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

  const nextPackData = next.kind === 'pack' ? indexes.packById.get(next.packId) : undefined;

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

      {start ? (
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

      <section className="flex flex-col gap-2" data-testid="overlay-next" data-kind={next.kind}>
        <SectionTitle>
          {next.kind === 'done'
            ? t('stageDone', lang, { last: lastFloor })
            : t('overlayNext', lang, { floor: next.floor })}
        </SectionTitle>
        {next.kind === 'pack' && nextPackData ? (
          <div className="flex min-w-0 items-center gap-3" data-pack={next.packId}>
            <PackCard pack={nextPackData} size={48} lang={lang} testId="overlay-pack-card" />
            <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
              <span className="break-keep text-subheading text-fg">{pick(nextPackData.name, lang)}</span>
              {next.alternatives > 0 ? (
                <span data-testid="overlay-alternatives">
                  <Badge tone="neutral">{t('stagePackAlternatives', lang, { n: next.alternatives })}</Badge>
                </span>
              ) : null}
            </div>
          </div>
        ) : next.kind === 'noPlan' ? (
          <p className="text-caption text-fg-subtle">{t('stageNoGoals', lang)}</p>
        ) : next.kind === 'none' ? (
          <p className="text-caption text-fg-subtle">{t('stageNoRoutePack', lang)}</p>
        ) : null}
      </section>

      <section className="flex flex-col gap-2" data-testid="overlay-remaining">
        <SectionTitle>{t('overlayRemaining', lang)}</SectionTitle>
        {left ? (
          <>
            <p className="break-keep text-caption text-fg-muted" data-pack={left.packId}>
              {t('overlayEntered', lang, { floor: left.floor, name: packName(left.packId) })}
            </p>
            {left.remaining.length === 0 ? (
              <p className="text-caption text-fg-subtle">{t('overlayRemainingNone', lang)}</p>
            ) : (
              <ul className="flex flex-col gap-1.5" data-testid="overlay-remaining-list">
                {left.remaining.map((id) => {
                  const gift = indexes.giftById.get(id);
                  return gift ? (
                    <li key={id} className="flex min-w-0 items-center gap-2" data-gift={id}>
                      <GiftIcon gift={gift} size={32} lang={lang} />
                      <span className="min-w-0 flex-1 break-keep text-caption text-fg">
                        {pick(gift.name, lang)}
                      </span>
                    </li>
                  ) : null;
                })}
              </ul>
            )}
          </>
        ) : (
          <p className="text-caption text-fg-subtle">{t('overlayNotEntered', lang)}</p>
        )}
      </section>

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
                  className={`min-w-0 flex-1 break-words ${line.undone ? 'text-fg-subtle line-through' : line.kind === 'error' ? 'text-fg' : 'text-fg-muted'}`}
                >
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
export function OverlayView({ target, log }: { target: HTMLElement; log?: FeedbackLog }) {
  return createPortal(<OverlayBody log={log} />, target);
}
