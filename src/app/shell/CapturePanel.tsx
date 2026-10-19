/**
 * The screen reader's controls (M107), in a header popover since M111: start and stop, the
 * questions it could not settle, what it recorded (each line undoable), how often it reads and the
 * game's language. The header button says the state at a glance — off, connecting, reading, or an
 * error — and how many questions wait, so the popover can stay closed while the player plays.
 *
 * Drawn only where the browser can share a screen — phones cannot, so they never see it. The
 * session itself is `CaptureProvider`'s: closing the popover does not end the share.
 *
 * Starting the reader is starting the run (M143): on a run with progress it first asks 「새 런으로
 * 시작」 or 「이어서」, and the answer's own press starts the share (the browser asks for the screen
 * only inside a gesture). While that run's start is open a note says what can still change, and
 * 「런 중단 · 시작 전으로 되돌리기」 puts the state from before the start back.
 */
import { useState, type ReactNode } from 'react';
import { CircleHelp, ScanEye, TriangleAlert } from 'lucide-react';
import { t } from '../i18n.ts';
import { runHasProgress, useApp } from '../store.ts';
import { observationClosed } from '../lib/plan-input.ts';
import { READ_INTERVALS, type ReadIntervalPreset } from '../capture/loop.ts';
import type { CaptureQuestion } from '../capture/useCapture.ts';
import { giftName, logText, statusTextOf } from '../capture/capture-text.ts';
import { useCaptureSession } from '../capture/capture-context.ts';
import { DetailSurface } from '../components/BlockDetail.tsx';
import { ConfirmDialog } from '../components/ConfirmDialog.tsx';
import { Button, Checkbox, Notice, Select } from '../components/ui.tsx';
import { usePlan } from './plan-context.ts';
import { DiagnosticsSection } from './DiagnosticsSection.tsx';
import { OverlayToggle } from '../overlay/OverlayToggle.tsx';

const PRESETS = Object.keys(READ_INTERVALS) as ReadIntervalPreset[];

function Question({
  question,
  onAnswer,
}: {
  question: CaptureQuestion;
  onAnswer: (id: number, picked: number[]) => void;
}) {
  const { indexes, lang, packName } = usePlan();
  const [ticked, setTicked] = useState<number[]>([]);
  const { ask } = question;
  const name = (id: number) => (ask.kind === 'pack' ? packName(id) : giftName(indexes, id, lang));
  const title =
    ask.kind === 'pack'
      ? t('captureAskPack', lang, { floor: ask.floor })
      : ask.kind === 'gift'
        ? t('captureAskGift', lang)
        : t('captureAskConsumed', lang, { name: giftName(indexes, ask.resultId, lang) });
  return (
    <div
      className="flex flex-col gap-2 rounded-sm border border-border-strong bg-surface-muted px-3 py-2"
      role="group"
      aria-label={title}
      data-testid="capture-question"
    >
      <p className="flex items-center gap-1.5 text-subheading">
        <CircleHelp size={14} aria-hidden />
        {title}
      </p>
      {ask.kind === 'consumed' ? (
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {ask.ids.map((id) => (
            <Checkbox
              key={id}
              checked={ticked.includes(id)}
              onChange={(on) => setTicked((all) => (on ? [...all, id] : all.filter((x) => x !== id)))}
              className="text-caption"
            >
              {name(id)}
            </Checkbox>
          ))}
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {ask.ids.map((id) => (
            <Button key={id} size="sm" onClick={() => onAnswer(question.id, [id])}>
              {name(id)}
            </Button>
          ))}
        </div>
      )}
      <div className="flex gap-1.5">
        {ask.kind === 'consumed' ? (
          <Button
            size="sm"
            variant="primary"
            disabled={ticked.length === 0}
            onClick={() => onAnswer(question.id, ticked)}
          >
            {t('captureAskApply', lang)}
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" onClick={() => onAnswer(question.id, [])}>
          {t('captureAskDismiss', lang)}
        </Button>
      </div>
    </div>
  );
}

/** The popover's body. `children` is the owner's diagnostics section (M112), when it is on. */
export function CapturePanel({ children }: { children?: ReactNode }) {
  const { indexes, lang, packName } = usePlan();
  const capture = useCaptureSession();
  const interval = useApp((s) => s.ui.captureInterval);
  const gameLang = useApp((s) => s.ui.captureLang);
  const setUi = useApp((s) => s.setUi);
  const run = useApp((s) => s.run);
  const snapshot = useApp((s) => s.runSnapshot);
  const running = capture.status === 'running';
  const starting = capture.status === 'starting';
  const [asking, setAsking] = useState<'start' | 'rollback' | null>(null);
  /** The share is asked for inside this press, or inside the dialog's (M143). */
  const startRun = () => {
    if (runHasProgress(useApp.getState().run)) setAsking('start');
    else void capture.begin('new');
  };
  const answerStart = (mode: 'new' | 'continue') => {
    setAsking(null);
    void capture.begin(mode);
  };
  const statuses = Object.keys(run.giftStatus).length;
  const visits = Object.keys(run.visits).length;

  return (
    <div className="flex flex-col gap-3" data-testid="capture-panel">
      <div className="flex items-center gap-2">
        <span
          className={`min-w-0 flex-1 text-body ${capture.error ? 'text-fg' : 'text-fg-muted'}`}
          role="status"
          data-testid="capture-status"
          data-status={capture.status}
          data-error={capture.error ?? undefined}
        >
          {/* State in words and a mark, never by colour alone. */}
          {running ? '● ' : ''}
          {statusTextOf(capture, lang)}
        </span>
        {running || starting ? (
          <Button onClick={capture.stop} testId="capture-stop">
            {t('captureStop', lang)}
          </Button>
        ) : (
          <Button variant="primary" onClick={startRun} testId="capture-start">
            {t('captureStart', lang)}
          </Button>
        )}
      </div>
      {/*
        The load ladder (M142): when this machine makes the reader cut optional reads, one line
        says so. A live region that is always there (empty and out of the flow until it speaks), so
        a screen reader hears the change.
      */}
      <p
        role="status"
        className={capture.strained ? 'text-body text-fg-muted' : 'sr-only'}
        data-testid="capture-strain"
        data-strained={capture.strained || undefined}
      >
        {capture.strained ? t('captureStrained', lang) : ''}
      </p>

      {/* The run's start, while the reader has it open (M143): the lock itself stays where it is. */}
      {(running || starting) && !observationClosed(run) ? (
        <div data-testid="capture-run-note">
          <Notice>
            <strong className="block text-fg">{t('captureRunNoteTitle', lang)}</strong>
            <span className="block">{t('captureRunNoteFree', lang)}</span>
            <span className="block">{t('captureRunNoteFixed', lang)}</span>
          </Notice>
        </div>
      ) : null}

      {/* Questions first: they are the one thing here that waits on the player. */}
      {capture.questions.map((question) => (
        <Question key={question.id} question={question} onAnswer={capture.answer} />
      ))}

      {running || capture.log.length > 0 ? (
        <section className="flex flex-col gap-1" aria-labelledby="capture-log-title">
          <h3 id="capture-log-title" className="text-caption-strong text-fg-muted">
            {t('captureLog', lang)}
          </h3>
          {capture.log.length === 0 ? (
            <p className="text-body text-fg-subtle">{t('captureLogEmpty', lang)}</p>
          ) : (
            <ul className="flex max-h-60 flex-col overflow-y-auto" data-testid="capture-log">
              {capture.log.map((entry) => (
                <li
                  key={entry.id}
                  className="flex items-center gap-2 border-b border-border py-1 last:border-b-0"
                >
                  <span
                    className={`min-w-0 flex-1 truncate text-caption ${entry.undone ? 'text-fg-subtle line-through' : 'text-fg'}`}
                  >
                    {logText(entry, indexes, lang, packName)}
                  </span>
                  {entry.undone ? (
                    <span className="text-caption text-fg-subtle">{t('captureUndone', lang)}</span>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => capture.undo(entry.id)}>
                      {t('captureUndo', lang)}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {/* The run this start began can be taken back to before it (M143); a run the reader did not
          start goes back to its very beginning (M158). */}
      {snapshot || runHasProgress(run) ? (
        <div className="flex">
          <Button size="sm" onClick={() => setAsking('rollback')} testId="capture-rollback">
            {t('captureRollback', lang)}
          </Button>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-3 text-caption text-fg-muted">
        <label className="flex items-center gap-2">
          {t('captureInterval', lang)}
          <Select
            label={t('captureInterval', lang)}
            value={interval}
            options={PRESETS.map((preset) => ({
              value: preset,
              label: t(`captureInterval_${preset}`, lang),
            }))}
            onChange={(next) => setUi({ captureInterval: next })}
            testId="capture-interval"
          />
        </label>
        <label className="flex items-center gap-2">
          {t('captureLang', lang)}
          <Select
            label={t('captureLang', lang)}
            value={gameLang}
            options={[
              { value: 'ko', label: t('captureLang_ko', lang) },
              { value: 'en', label: t('captureLang_en', lang) },
            ]}
            onChange={(next) => setUi({ captureLang: next })}
            // The engine loads one language when the share starts.
            disabled={running || starting}
          />
        </label>
      </div>

      {/* The overlay window (M132): opens without a share, and outlives this popover. */}
      <OverlayToggle />

      {children}

      <p className="text-body text-fg-subtle">{t('capturePrivacy', lang)}</p>

      {asking === 'start' ? (
        <ConfirmDialog
          lang={lang}
          title={t('captureRunAskTitle', lang)}
          message={t('captureRunAskMessage', lang)}
          confirmLabel={t('captureRunNew', lang)}
          // Recoverable: the run it clears is the snapshot 「시작 전으로 되돌리기」 brings back.
          confirmVariant="primary"
          onConfirm={() => answerStart('new')}
          alternative={{
            label: t('captureRunContinue', lang),
            onClick: () => answerStart('continue'),
            testId: 'capture-run-continue',
          }}
          onCancel={() => setAsking(null)}
        />
      ) : asking === 'rollback' ? (
        <ConfirmDialog
          lang={lang}
          title={t('captureRollbackTitle', lang)}
          message={t('captureRollbackMessage', lang)}
          confirmLabel={t('captureRollbackConfirm', lang)}
          onConfirm={() => {
            setAsking(null);
            capture.rollback();
          }}
          onCancel={() => setAsking(null)}
        >
          <ul className="list-disc pl-4 text-body text-fg-muted" data-testid="capture-rollback-list">
            <li>{t('captureRollbackGifts', lang, { n: statuses })}</li>
            <li>{t('captureRollbackVisits', lang, { n: visits })}</li>
            <li>{t('captureRollbackStart', lang)}</li>
            {snapshot ? <li>{t('captureRollbackPins', lang)}</li> : null}
          </ul>
          <span className="text-body text-fg-muted">
            {t(snapshot ? 'captureRollbackKeep' : 'captureRollbackKeepPins', lang)}
          </span>
        </ConfirmDialog>
      ) : null}
    </div>
  );
}

/**
 * The header's 「화면 인식」 button and its popover. Off it is an icon; connecting, reading and an
 * error each add a word (and a mark, never colour alone); waiting questions add a count. A screen
 * reader hears the count change through a live region, since the popover may be closed.
 */
export function CaptureMenu() {
  const { lang } = usePlan();
  const capture = useCaptureSession();
  const [open, setOpen] = useState(false);
  if (!capture.supported) return null;
  const running = capture.status === 'running';
  const starting = capture.status === 'starting';
  const asking = capture.questions.length;
  const word = capture.error
    ? t('captureErrShort', lang)
    : running
      ? t('captureRunning', lang)
      : starting
        ? t('captureStarting', lang)
        : null;
  const name = `${t('captureTitle', lang)} · ${statusTextOf(capture, lang)}${asking ? ` · ${t('captureAsking', lang, { n: asking })}` : ''}`;
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="capture-popover"
        aria-label={name}
        title={name}
        data-testid="capture-open"
        data-status={capture.status}
        data-open={open || undefined}
        className={`inline-flex h-9 min-w-9 items-center justify-center gap-1.5 rounded-sm border px-2 text-label transition-colors duration-150 touch:min-h-11 touch:min-w-11 ${
          open
            ? 'border-border-strong bg-surface-muted text-fg'
            : 'border-border bg-surface text-fg-muted hover:bg-surface-muted hover:text-fg'
        }`}
      >
        {capture.error ? <TriangleAlert size={15} aria-hidden /> : <ScanEye size={15} aria-hidden />}
        {word ? (
          <span className={running ? 'text-fg' : undefined}>
            {running ? '● ' : ''}
            {word}
          </span>
        ) : null}
        {asking ? (
          <span
            className="inline-flex min-h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-micro text-primary-fg"
            data-testid="capture-asking"
          >
            {asking}
          </span>
        ) : null}
      </button>
      <span className="sr-only" aria-live="polite">
        {asking ? t('captureAsking', lang, { n: asking }) : ''}
      </span>
      {open ? (
        <DetailSurface
          id="capture-popover"
          mode="popover"
          variant="panel"
          placement={{ vertical: 'below', horizontal: 'end' }}
          label={t('captureTitle', lang)}
          closeLabel={t('routeClose', lang)}
          onClose={() => setOpen(false)}
        >
          <CapturePanel>
            <DiagnosticsSection />
          </CapturePanel>
        </DetailSurface>
      ) : null}
    </div>
  );
}
