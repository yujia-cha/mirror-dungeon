/**
 * The owner's diagnostics, at the foot of the screen reader's popover (M112). Shown only after
 * `#diag` opened it (`ui.diagEnabled`); visitors never see it.
 *
 * The flow it is built around: record → export one zip → clear the device → hand over the zip.
 * The browser cannot say whether the download was saved, so clearing is the player's step right
 * after the export, never automatic; until then the section says how much exported data is still
 * here. Where the zip goes is said on the section itself, not left to memory.
 *
 * One thing at a time (M116): while an export or a clearing runs, the other buttons wait — they
 * work on the same records. An export that fails says so and offers nothing to clear.
 */
import { useState } from 'react';
import { Download, Trash2 } from 'lucide-react';
import { t } from '../i18n.ts';
import { useCaptureSession } from '../capture/capture-context.ts';
import { ConfirmDialog } from '../components/ConfirmDialog.tsx';
import { Button, Checkbox, LinkButton } from '../components/ui.tsx';
import { useApp } from '../store.ts';
import { usePlan } from './plan-context.ts';

function megabytes(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0);
}

export function DiagnosticsSection() {
  const { lang } = usePlan();
  const { diagnostics } = useCaptureSession();
  const recordOn = useApp((s) => s.ui.diagRecord);
  const imagesOn = useApp((s) => s.ui.diagImages);
  const setUi = useApp((s) => s.setUi);
  /** What is running: the buttons that touch the stored records wait for it. */
  const [busy, setBusy] = useState<'export' | 'clear' | null>(null);
  const [failed, setFailed] = useState(false);
  /** The file just exported: the clean-up step shows until the player answers it. */
  const [justExported, setJustExported] = useState<string | null>(null);
  const [cleared, setCleared] = useState<{ records: number; frames: number } | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const { stats } = diagnostics;
  if (!diagnostics.enabled) return null;

  const onExport = async (): Promise<void> => {
    setBusy('export');
    setCleared(null);
    setFailed(false);
    try {
      setJustExported(await diagnostics.exportZip());
    } catch {
      setFailed(true);
    } finally {
      setBusy(null);
    }
  };
  const clearing = async (work: () => Promise<void>): Promise<void> => {
    setBusy('clear');
    try {
      await work();
    } finally {
      setBusy(null);
    }
  };
  const onClearExported = (): Promise<void> =>
    clearing(async () => {
      setCleared(await diagnostics.clearExported());
      setJustExported(null);
    });
  const time = (ms: number) =>
    new Date(ms).toLocaleString(lang === 'ko' ? 'ko-KR' : 'en-GB', {
      dateStyle: 'short',
      timeStyle: 'short',
    });

  return (
    <section
      className="flex flex-col gap-2 border-t border-border pt-3"
      aria-labelledby="diag-title"
      data-testid="diag-section"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 id="diag-title" className="text-caption-strong text-fg-muted">
          {t('diagTitle', lang)}
        </h3>
        <LinkButton muted onClick={() => setUi({ diagEnabled: false })} className="text-caption">
          {t('diagHide', lang)}
        </LinkButton>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <Checkbox
          checked={recordOn}
          onChange={(on) => setUi({ diagRecord: on, ...(on ? {} : { diagImages: false }) })}
          className="text-caption"
        >
          {t('diagRecord', lang)}
        </Checkbox>
        <Checkbox
          checked={imagesOn}
          disabled={!recordOn}
          onChange={(on) => setUi({ diagImages: on })}
          className="text-caption"
        >
          {t('diagImages', lang)}
        </Checkbox>
      </div>
      <p className="text-body text-fg-muted">{t('diagImagesWarn', lang)}</p>

      <p className="text-caption text-fg" role="status" data-testid="diag-stats" data-records={stats.records}>
        {stats.records === 0 && stats.frames === 0
          ? t('diagEmpty', lang)
          : t('diagStats', lang, {
              records: stats.records,
              frames: stats.frames,
              mb: megabytes(stats.bytes),
            })}
        {stats.lastExportAt !== null
          ? ` · ${t('diagLastExport', lang, { time: time(stats.lastExportAt) })}`
          : ''}
      </p>
      {stats.full ? <p className="text-body text-fg">⚠ {t('diagFull', lang)}</p> : null}
      {stats.trimmedFrames > 0 ? (
        <p className="text-body text-fg-muted">{t('diagTrimmed', lang, { n: stats.trimmedFrames })}</p>
      ) : null}

      {justExported ? (
        // The clean-up step: the one thing to do right after the export.
        <div
          className="flex flex-col gap-2 rounded-sm border border-border-strong bg-surface-muted px-3 py-2"
          role="group"
          aria-label={t('diagSavedTitle', lang)}
          data-testid="diag-cleanup"
        >
          <p className="text-body text-fg">{t('diagSavedPrompt', lang, { name: justExported })}</p>
          <div className="flex gap-1.5">
            <Button
              size="sm"
              variant="primary"
              loading={busy === 'clear'}
              disabled={busy !== null}
              onClick={() => void onClearExported()}
              testId="diag-clear-exported"
            >
              <Trash2 size={12} aria-hidden />
              {t('diagClearExported', lang)}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setJustExported(null)}>
              {t('diagLater', lang)}
            </Button>
          </div>
        </div>
      ) : stats.exportedRecords > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-body text-fg">{t('diagExportedLeft', lang, { n: stats.exportedRecords })}</p>
          <Button
            size="sm"
            loading={busy === 'clear'}
            disabled={busy !== null}
            onClick={() => void onClearExported()}
            testId="diag-clear-exported"
          >
            {t('diagClearExported', lang)}
          </Button>
        </div>
      ) : null}
      {failed ? (
        <p className="text-body text-danger" role="alert" data-testid="diag-export-failed">
          ⚠ {t('diagExportFailed', lang)}
        </p>
      ) : null}
      {cleared ? (
        <p className="text-body text-fg-muted" role="status">
          {t('diagCleared', lang, { records: cleared.records, frames: cleared.frames })}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-1.5">
        <Button
          variant="primary"
          size="sm"
          loading={busy === 'export'}
          disabled={busy !== null || !diagnostics.ready || (stats.records === 0 && stats.frames === 0)}
          onClick={() => void onExport()}
          testId="diag-export"
        >
          <Download size={12} aria-hidden />
          {t('diagExport', lang)}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={busy !== null || (stats.records === 0 && stats.frames === 0)}
          onClick={() => setConfirmAll(true)}
          testId="diag-clear-all"
        >
          {t('diagClearAll', lang)}
        </Button>
      </div>
      <p className="text-body text-fg-subtle" data-testid="diag-where">
        {t('diagWhere', lang)}
      </p>
      {confirmAll ? (
        <ConfirmDialog
          title={t('diagClearAll', lang)}
          message={t('diagClearAllConfirm', lang, { records: stats.records, frames: stats.frames })}
          confirmLabel={t('diagClearAll', lang)}
          onConfirm={() => {
            setConfirmAll(false);
            setJustExported(null);
            setFailed(false);
            const counts = { records: stats.records, frames: stats.frames };
            void clearing(async () => {
              await diagnostics.clearAll();
              setCleared(counts);
            });
          }}
          onCancel={() => setConfirmAll(false)}
          lang={lang}
        />
      ) : null}
    </section>
  );
}
