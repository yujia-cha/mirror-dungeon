/**
 * The screen reader's controls (M107), in a header popover since M111: start and stop, the
 * questions it could not settle, what it recorded (each line undoable), how often it reads and the
 * game's language. The header button says the state at a glance — off, connecting, reading, or an
 * error — and how many questions wait, so the popover can stay closed while the player plays.
 *
 * Drawn only where the browser can share a screen — phones cannot, so they never see it. The
 * session itself is `CaptureProvider`'s: closing the popover does not end the share.
 */
import { useState, type ReactNode } from 'react';
import { CircleHelp, ScanEye, TriangleAlert } from 'lucide-react';
import { pick, t, type Lang } from '../i18n.ts';
import type { GameIndexes } from '../../core/types.ts';
import { useApp } from '../store.ts';
import { READ_INTERVALS, type ReadIntervalPreset } from '../capture/loop.ts';
import type { CaptureLogEntry, CaptureQuestion } from '../capture/useCapture.ts';
import { useCaptureSession } from '../capture/capture-context.ts';
import { DetailSurface } from '../components/BlockDetail.tsx';
import { Button, Checkbox, Select } from '../components/ui.tsx';
import { usePlan } from './plan-context.ts';
import { DiagnosticsSection } from './DiagnosticsSection.tsx';

const PRESETS = Object.keys(READ_INTERVALS) as ReadIntervalPreset[];

function giftName(indexes: GameIndexes, id: number, lang: Lang): string {
  return pick(indexes.giftById.get(id)?.name, lang) || String(id);
}

function logText(
  entry: CaptureLogEntry,
  indexes: GameIndexes,
  lang: Lang,
  packName: (id: number) => string,
): string {
  const e = entry.event;
  switch (e.kind) {
    case 'enter':
      return t('captureLogEnter', lang, { floor: e.floor, name: packName(e.packId) });
    case 'got':
      return t('captureLogGot', lang, { name: giftName(indexes, e.giftId, lang) });
    case 'sold':
      return t('captureLogSold', lang, { name: giftName(indexes, e.giftId, lang) });
    case 'fused':
      return t('captureLogFused', lang, {
        name: `${giftName(indexes, e.resultId, lang)} ← ${e.consumed.map((id) => giftName(indexes, id, lang)).join(', ')}`,
      });
    case 'answer':
      return t('captureLogAnswer', lang, {
        name: e.picked
          .map((id) => (e.ask.kind === 'pack' ? packName(id) : giftName(indexes, id, lang)))
          .join(', '),
      });
    default:
      return '';
  }
}

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

/** What the session is doing, in words — the same sentence in the popover and on the button. */
function statusTextOf(capture: ReturnType<typeof useCaptureSession>, lang: Lang): string {
  if (capture.error) return t(`captureErr_${capture.error}`, lang);
  if (capture.status === 'running') return t('captureRunning', lang);
  if (capture.status === 'starting') return t('captureStarting', lang);
  return t('captureIdle', lang);
}

/** The popover's body. `children` is the owner's diagnostics section (M112), when it is on. */
export function CapturePanel({ children }: { children?: ReactNode }) {
  const { indexes, lang, packName } = usePlan();
  const capture = useCaptureSession();
  const interval = useApp((s) => s.ui.captureInterval);
  const gameLang = useApp((s) => s.ui.captureLang);
  const setUi = useApp((s) => s.setUi);
  const running = capture.status === 'running';
  const starting = capture.status === 'starting';

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
          <Button variant="primary" onClick={() => void capture.start()} testId="capture-start">
            {t('captureStart', lang)}
          </Button>
        )}
      </div>

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
            <p className="text-caption text-fg-subtle">{t('captureLogEmpty', lang)}</p>
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

      {children}

      <p className="text-caption text-fg-subtle">{t('capturePrivacy', lang)}</p>
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
