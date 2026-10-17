/**
 * The screen reader's words, shared by the header popover (`shell/CapturePanel.tsx`) and the
 * overlay window (`overlay/OverlayView.tsx`, M132): what the session is doing, and what a log entry
 * did. Out of the panel so both say exactly the same thing.
 */
import { pick, t, type Lang } from '../i18n.ts';
import type { GameIndexes } from '../../core/types.ts';
import type { CaptureError, CaptureStatus } from './session.ts';
import type { CaptureLogEntry } from './useCapture.ts';

export function giftName(indexes: GameIndexes, id: number, lang: Lang): string {
  return pick(indexes.giftById.get(id)?.name, lang) || String(id);
}

/** One log entry in words: 「3층 입장 · {팩}」, 「획득 · {기프트}」 … */
export function logText(
  entry: Pick<CaptureLogEntry, 'event'>,
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

/** What the session is doing, in words — the same sentence in the popover and on the button. */
export function statusTextOf(
  capture: { status: CaptureStatus; error: CaptureError | null },
  lang: Lang,
): string {
  if (capture.error) return t(`captureErr_${capture.error}`, lang);
  if (capture.status === 'running') return t('captureRunning', lang);
  if (capture.status === 'starting') return t('captureStarting', lang);
  return t('captureIdle', lang);
}
