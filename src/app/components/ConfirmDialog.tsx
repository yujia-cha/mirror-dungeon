/**
 * The app's own confirmation, in place of `window.confirm`.
 *
 * The native dialog was not only out of keeping with the rest of the app — it failed open. The
 * guard read `typeof window.confirm === 'function' && !window.confirm(…)`, so anywhere the browser
 * withholds it (a standalone iOS web app, a sandboxed frame without `allow-modals`) the whole
 * reset ran with nothing asked; and a browser that auto-dismisses answers `false`, so the action
 * silently never happened. This asks, and the answer is the app's to read.
 */
import { t, type Lang } from '../i18n.ts';
import { DetailSurface } from './BlockDetail.tsx';
import { Button } from './ui.tsx';

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
  lang,
}: {
  title: string;
  message?: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  lang: Lang;
}) {
  return (
    <DetailSurface
      mode="sheet"
      alert
      describedBy={message ? 'confirm-dialog-message' : undefined}
      label={title}
      closeLabel={t('confirmCancel', lang)}
      onClose={onCancel}
    >
      <div className="flex flex-col gap-3" data-testid="confirm-dialog">
        <div className="flex flex-col gap-1">
          <h2 className="text-subheading">{title}</h2>
          {message ? (
            <span id="confirm-dialog-message" className="text-caption text-fg-muted">
              {message}
            </span>
          ) : null}
        </div>
        <div className="flex justify-end gap-1.5">
          <Button variant="ghost" onClick={onCancel}>
            {t('confirmCancel', lang)}
          </Button>
          <Button variant="danger" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </DetailSurface>
  );
}
