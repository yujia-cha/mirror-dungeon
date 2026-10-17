/**
 * What the overlay window (M132) shows, top to bottom: the screen reader's state and the floor, the
 * pack the route enters next, what is still to collect in the pack the player is in, and the last
 * few things that happened. Drawn into the window's body through a portal, so it reads the same
 * plan, store and session as the page.
 *
 * View only (the owner's call). Every listener the app's floating layers use (`useDismiss`,
 * `DetailSurface`, the sheets) is on the page's `document`, which a press in this window never
 * reaches — so nothing here opens a sheet or a popover, and names are plain words, not links. Being
 * a glance while the game runs, it would be the wrong place to change the run anyway.
 */
import { useCallback, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { TriangleAlert } from 'lucide-react';
import { pick, t } from '../i18n.ts';
import { useApp } from '../store.ts';
import { feedbackLog, type FeedbackLog, type FeedbackLogEntry } from '../lib/feedback-log.ts';
import { useCaptureSession } from '../capture/capture-context.ts';
import { logText, statusTextOf } from '../capture/capture-text.ts';
import { GiftIcon } from '../components/GiftIcon.tsx';
import { PackCard } from '../components/PackCard.tsx';
import { Badge } from '../components/ui.tsx';
import { usePlan } from '../shell/plan-context.ts';
import { clockOf, nextPack, recentLines, remainingIn } from './overlay-model.ts';

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

/** The window's contents. `log` is the page's feedback log unless a test hands in its own. */
export function OverlayBody({ log = feedbackLog }: { log?: FeedbackLog }) {
  const { indexes, lang, shown, packName, expectedIn } = usePlan();
  const capture = useCaptureSession();
  const run = useApp((s) => s.run);
  const lastFloor = useApp((s) => s.lastFloor);
  const feedback = useFeedbackEntries(log);

  const running = capture.status === 'running';
  const asking = capture.questions.length;
  const next = nextPack(shown, run, lastFloor, indexes);
  const left = remainingIn(run, expectedIn);
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
