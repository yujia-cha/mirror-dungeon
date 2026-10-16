/**
 * The screen reader's place on the stage (M107): start and stop, how often it reads, the game's
 * language, what it recorded (each line undoable) and the questions it could not settle.
 *
 * Drawn only where the browser can share a screen — phones cannot, so they never see it.
 */
import { useState } from 'react';
import { CircleHelp, ScanEye } from 'lucide-react';
import { pick, t, type Lang } from '../i18n.ts';
import type { GameIndexes } from '../../core/types.ts';
import { useApp } from '../store.ts';
import { READ_INTERVALS, type ReadIntervalPreset } from '../capture/loop.ts';
import { useCapture, type CaptureLogEntry, type CaptureQuestion } from '../capture/useCapture.ts';
import { Button, Card, Checkbox, Select } from '../components/ui.tsx';
import { usePlan } from '../shell/plan-context.ts';

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

export function CapturePanel() {
  const { indexes, lang, packName } = usePlan();
  const capture = useCapture();
  const interval = useApp((s) => s.ui.captureInterval);
  const gameLang = useApp((s) => s.ui.captureLang);
  const setUi = useApp((s) => s.setUi);
  if (!capture.supported) return null;
  const running = capture.status === 'running';
  const starting = capture.status === 'starting';
  const statusText = capture.error
    ? t(`captureErr_${capture.error}`, lang)
    : running
      ? t('captureRunning', lang)
      : starting
        ? t('captureStarting', lang)
        : t('captureIdle', lang);

  return (
    <Card className="flex flex-col gap-3 px-3 py-3" testId="capture-panel">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-1.5 text-subheading">
          <ScanEye size={15} aria-hidden />
          {t('captureTitle', lang)}
        </h2>
        <span
          className={`min-w-0 flex-1 text-caption ${capture.error ? 'text-fg' : 'text-fg-muted'}`}
          role="status"
          data-testid="capture-status"
          data-status={capture.status}
          data-error={capture.error ?? undefined}
        >
          {/* State in words and a mark, never by colour alone. */}
          {running ? '● ' : ''}
          {statusText}
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

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-caption text-fg-muted">
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

      {capture.questions.map((question) => (
        <Question key={question.id} question={question} onAnswer={capture.answer} />
      ))}

      {running || capture.log.length > 0 ? (
        <div className="flex flex-col gap-1">
          <h3 className="text-caption-strong text-fg-muted">{t('captureLog', lang)}</h3>
          {capture.log.length === 0 ? (
            <p className="text-caption text-fg-subtle">{t('captureLogEmpty', lang)}</p>
          ) : (
            <ul className="flex flex-col" data-testid="capture-log">
              {capture.log.slice(0, 8).map((entry) => (
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
        </div>
      ) : null}

      <p className="text-caption text-fg-subtle">{t('capturePrivacy', lang)}</p>
    </Card>
  );
}
