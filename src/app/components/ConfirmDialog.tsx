/**
 * The app's own confirmation, in place of `window.confirm`.
 *
 * The native dialog was not only out of keeping with the rest of the app — it failed open. The
 * guard read `typeof window.confirm === 'function' && !window.confirm(…)`, so anywhere the browser
 * withholds it (a standalone iOS web app, a sandboxed frame without `allow-modals`) the whole
 * reset ran with nothing asked; and a browser that auto-dismisses answers `false`, so the action
 * silently never happened. This asks, and the answer is the app's to read.
 */
import type { ReactNode } from 'react';
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
  confirmVariant = 'danger',
  alternative,
  children,
}: {
  title: string;
  message?: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  lang: Lang;
  /** `primary` when the confirmed action can be taken back (M143); `danger` when it cannot. */
  confirmVariant?: 'danger' | 'primary';
  /** A third answer between cancel and confirm (M143 — 「이어서」 beside 「새 런으로 시작」). */
  alternative?: { label: string; onClick: () => void; testId?: string };
  /** Below the message: what the action changes, as a list (M143). */
  children?: ReactNode;
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
            <span id="confirm-dialog-message" className="text-body text-fg-muted">
              {message}
            </span>
          ) : null}
          {children}
        </div>
        <div className="flex flex-wrap justify-end gap-1.5" data-uniform="height">
          <Button variant="ghost" onClick={onCancel}>
            {t('confirmCancel', lang)}
          </Button>
          {alternative ? (
            <Button onClick={alternative.onClick} testId={alternative.testId}>
              {alternative.label}
            </Button>
          ) : null}
          <Button variant={confirmVariant} onClick={onConfirm} testId="confirm-dialog-confirm">
            {confirmLabel}
          </Button>
        </div>
      </div>
    </DetailSurface>
  );
}
