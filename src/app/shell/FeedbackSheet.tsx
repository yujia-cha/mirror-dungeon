/**
 * 「피드백 보내기」 (M127): the sheet the header's 「⋯」 opens. The visitor writes; the app fills in
 * the rest and opens a prefilled GitHub issue on the public repository (`feedback/body.ts`).
 *
 * Nothing is sent from here. 「GitHub에서 이슈 열기」 opens github.com in a new tab with the issue
 * written into the address; the visitor reads it there and presses GitHub's own submit. 「내용
 * 복사」 is the way round a URL GitHub will not take. What goes with the message is the visitor's
 * choice, ticked here: the app state (share link, run and route summary), the error and action log
 * (`lib/feedback-log.ts`, this tab only) and the 피드백용 진단 기록 they may have recorded
 * (`feedback/visitor-diagnostics.ts`, this device only — not the owner's `#diag` recorder). A
 * picture of the app is a separate press (`feedback/screen-capture.ts`): the clipboard holds one
 * thing, and the body text may need it too.
 */
import { useDeferredValue, useMemo, useRef, useState } from 'react';
import { Camera, Copy, ExternalLink, Globe } from 'lucide-react';
import type { GameData } from '../../core/schema.ts';
import type { RoutePlan } from '../../core/types.ts';
import { pick, t, type Lang, type StringKey } from '../i18n.ts';
import { encodeShared, useApp } from '../store.ts';
import { DetailSurface } from '../components/BlockDetail.tsx';
import { Button, Checkbox, Select, TextArea, TextField } from '../components/ui.tsx';
import { feedbackLog, type FeedbackLogEntry } from '../lib/feedback-log.ts';
import { buildFeedback, type FeedbackInput } from '../feedback/body.ts';
import { readEnv, routeSummary } from '../feedback/env.ts';
import { FEEDBACK_KINDS, type FeedbackKind } from '../feedback/payload.ts';
import { copyAppScreen } from '../feedback/screen-capture.ts';
import { visitorDiagnostics } from '../feedback/visitor-diagnostics.ts';
import { useVisitorDiagSnapshot } from '../feedback/useVisitorDiagnostics.ts';
import { usePlan } from './plan-context.ts';

type Status =
  | { kind: 'copied' }
  | { kind: 'copyFailed' }
  | { kind: 'shot'; result: 'copied' | 'downloaded' }
  | { kind: 'shotFailed' }
  | null;

const STATUS_KEY: Record<string, StringKey> = {
  copied: 'feedbackCopied',
  copyFailed: 'copyFailed',
  shotcopied: 'feedbackShotCopied',
  shotdownloaded: 'feedbackShotDownloaded',
  shotFailed: 'feedbackShotFailed',
};

/** The issue for the form as it stands: the store's state now, the given text. */
function issueFor(p: {
  t: number;
  log: FeedbackLogEntry[];
  kind: FeedbackKind;
  data: GameData;
  plan: RoutePlan | null;
  lang: Lang;
  dark: boolean;
  include: FeedbackInput['include'];
  title: string;
  message: string;
}) {
  const state = useApp.getState();
  const shared = {
    ...(state.season === undefined ? {} : { season: state.season }),
    deck: state.deck,
    deployed: state.deployed,
    wanted: state.wanted,
    fusionGoal: state.fusionGoal,
    options: state.options,
  };
  return buildFeedback(
    {
      t: p.t,
      kind: p.kind,
      title: p.title,
      message: p.message,
      env: readEnv({
        dataVersion: p.data.meta.dataVersion,
        season: p.data.meta.dungeon.id,
        seasonName: pick(p.data.meta.dungeon.name, p.lang),
        lang: p.lang,
        dark: p.dark,
      }),
      include: p.include,
      state: {
        shareUrl: `${window.location.origin}${window.location.pathname}${encodeShared(shared)}`,
        shared,
        run: state.run,
        route: routeSummary(p.plan),
      },
      log: p.log,
      diagnostics: p.include.diagnostics ? visitorDiagnostics.list() : [],
    },
    p.lang,
  );
}

export function FeedbackSheet({ onClose }: { onClose: () => void }) {
  const { data, plan, lang } = usePlan();
  const dark = useApp((s) => s.dark);
  const [kind, setKind] = useState<FeedbackKind>('bug');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [missing, setMissing] = useState(false);
  const [include, setInclude] = useState({ state: true, log: true, diagnostics: true });
  const [shot, setShot] = useState(false);
  const [shooting, setShooting] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const diag = useVisitorDiagSnapshot();
  // The log as it stood when the form opened: what led up to the report, not the typing in it.
  const [opened] = useState(() => ({ t: Date.now(), log: feedbackLog.entries() }));
  const messageRef = useRef<HTMLDivElement>(null);
  // Building the body compresses the payload; let a fast typist's keystrokes run ahead of it.
  const deferredMessage = useDeferredValue(message);
  const deferredTitle = useDeferredValue(title);

  const attach = { ...include, diagnostics: include.diagnostics && diag.count > 0, screenshot: shot };
  const form = { t: opened.t, log: opened.log, kind, data, plan, lang, dark, include: attach };
  // What the form says about length (trimmed, too long) follows the deferred text. `diag.count`
  // stands for the record list: it changes whenever a record is added or cleared.
  const issue = useMemo(
    () =>
      issueFor({
        t: opened.t,
        log: opened.log,
        kind,
        data,
        plan,
        lang,
        dark,
        include: { ...include, diagnostics: include.diagnostics && diag.count > 0, screenshot: shot },
        title: deferredTitle,
        message: deferredMessage,
      }),
    [opened, kind, deferredTitle, deferredMessage, data, lang, dark, include, diag.count, shot, plan],
  );

  const requireMessage = (): boolean => {
    if (message.trim()) return true;
    setMissing(true);
    messageRef.current?.querySelector('textarea')?.focus();
    return false;
  };

  const open = (): void => {
    if (!requireMessage()) return;
    // The body as typed this instant, not the deferred one a keystroke behind.
    const target = issueFor({ ...form, title, message });
    // A message too long for any URL: the full text goes to the clipboard, the issue asks for it.
    // Started before the tab opens — the clipboard wants the press and the page's focus.
    if (!target.fits) void navigator.clipboard?.writeText(target.fullBody).catch(() => undefined);
    window.open(target.url, '_blank', 'noopener,noreferrer');
  };

  const copy = async (): Promise<void> => {
    if (!requireMessage()) return;
    try {
      await navigator.clipboard.writeText(issueFor({ ...form, title, message }).fullBody);
      setStatus({ kind: 'copied' });
    } catch {
      setStatus({ kind: 'copyFailed' });
    }
  };

  const takeShot = async (): Promise<void> => {
    setShooting(true);
    try {
      const result = await copyAppScreen();
      setShot(true);
      setStatus({ kind: 'shot', result });
    } catch {
      setStatus({ kind: 'shotFailed' });
    } finally {
      setShooting(false);
    }
  };

  const statusText = status
    ? t(STATUS_KEY[status.kind === 'shot' ? `shot${status.result}` : status.kind]!, lang)
    : '';

  return (
    <DetailSurface
      mode="sheet"
      label={t('feedback', lang)}
      closeLabel={t('routeClose', lang)}
      onClose={onClose}
    >
      <div className="flex flex-col gap-4" data-testid="feedback-sheet">
        <div className="flex flex-col gap-1">
          <h2 className="text-title text-fg">{t('feedback', lang)}</h2>
          <p className="text-caption text-fg-muted">{t('feedbackIntro', lang)}</p>
        </div>

        <div className="flex flex-col gap-1">
          <span id="feedback-kind-label" className="text-label text-fg">
            {t('feedbackKindLabel', lang)}
          </span>
          <Select<FeedbackKind>
            label={t('feedbackKindLabel', lang)}
            value={kind}
            options={FEEDBACK_KINDS.map((value) => ({
              value,
              label: t(`feedbackKind_${value}` as StringKey, lang),
            }))}
            onChange={setKind}
            className="self-start"
            testId="feedback-kind"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="feedback-title" className="text-label text-fg">
            {t('feedbackTitleLabel', lang)}
          </label>
          <TextField
            value={title}
            onChange={setTitle}
            label={t('feedbackTitleLabel', lang)}
            placeholder={t('feedbackTitlePlaceholder', lang)}
            inputProps={{ id: 'feedback-title', maxLength: 120 }}
            testId="feedback-title"
          />
        </div>

        <div ref={messageRef}>
          <TextArea
            id="feedback-message"
            value={message}
            onChange={(next) => {
              setMessage(next);
              if (next.trim()) setMissing(false);
            }}
            label={t('feedbackMessageLabel', lang)}
            placeholder={t('feedbackMessagePlaceholder', lang)}
            rows={6}
            maxLength={20000}
            required
            error={missing ? t('feedbackMessageRequired', lang) : null}
            testId="feedback-message"
          />
        </div>

        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-label text-fg">{t('feedbackAttach', lang)}</legend>
          <Checkbox
            checked={include.state}
            onChange={(state) => setInclude((prev) => ({ ...prev, state }))}
            testId="feedback-attach-state"
            className="text-body text-fg"
          >
            {t('feedbackAttachState', lang)}
          </Checkbox>
          <Checkbox
            checked={include.log}
            onChange={(log) => setInclude((prev) => ({ ...prev, log }))}
            testId="feedback-attach-log"
            className="text-body text-fg"
          >
            {t('feedbackAttachLog', lang)}
          </Checkbox>
          {diag.count > 0 ? (
            <Checkbox
              checked={include.diagnostics}
              onChange={(diagnostics) => setInclude((prev) => ({ ...prev, diagnostics }))}
              testId="feedback-attach-diag"
              className="text-body text-fg"
            >
              {t('feedbackAttachDiag', lang, { n: diag.count })}
            </Checkbox>
          ) : null}
        </fieldset>

        <section
          className="flex flex-col gap-2 rounded-md border border-border bg-surface-muted px-3 py-3"
          aria-labelledby="feedback-diag-title"
          data-testid="feedback-diag"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 id="feedback-diag-title" className="text-subheading text-fg">
              {t('feedbackDiagTitle', lang)}
            </h3>
            <Checkbox
              checked={diag.on}
              onChange={(on) => visitorDiagnostics.setOn(on)}
              testId="feedback-diag-record"
              className="text-label text-fg"
            >
              {t('feedbackDiagRecord', lang)}
            </Checkbox>
          </div>
          <p className="text-caption text-fg-muted">{t('feedbackDiagHint', lang)}</p>
          <div className="flex items-center justify-between gap-2">
            <span className="text-caption text-fg-muted" data-testid="feedback-diag-count">
              {diag.count > 0
                ? t('feedbackDiagCount', lang, { n: diag.count })
                : t('feedbackDiagEmpty', lang)}
            </span>
            {diag.count > 0 ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => visitorDiagnostics.clear()}
                testId="feedback-diag-clear"
              >
                {t('feedbackDiagClear', lang)}
              </Button>
            ) : null}
          </div>
        </section>

        <div className="flex flex-col gap-1">
          <Button
            onClick={() => void takeShot()}
            loading={shooting}
            className="self-start"
            testId="feedback-shot"
          >
            <Camera size={14} aria-hidden />
            {t('feedbackShot', lang)}
          </Button>
          <p className="text-caption text-fg-muted">{t('feedbackShotHint', lang)}</p>
        </div>

        <p
          className="flex items-start gap-2 rounded-md border border-border-strong bg-surface px-3 py-2 text-caption text-fg"
          data-testid="feedback-privacy"
        >
          <Globe size={14} className="mt-0.5 flex-none" aria-hidden />
          <span>{t('feedbackPrivacy', lang)}</span>
        </p>

        {!issue.fits ? (
          <p className="text-caption text-fg" data-testid="feedback-too-long">
            {t('feedbackTooLong', lang)}
          </p>
        ) : issue.trimmed ? (
          <p className="text-caption text-fg-muted" data-testid="feedback-trimmed">
            {t('feedbackTrimmed', lang)}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" onClick={open} testId="feedback-open">
            <ExternalLink size={14} aria-hidden />
            {t('feedbackOpen', lang)}
          </Button>
          <Button onClick={() => void copy()} testId="feedback-copy">
            <Copy size={14} aria-hidden />
            {t('feedbackCopy', lang)}
          </Button>
        </div>
        <p className="text-caption text-fg-muted">{t('feedbackCopyHint', lang)}</p>
        <p
          role="status"
          aria-live="polite"
          className="min-h-4 text-caption text-fg"
          data-testid="feedback-status"
        >
          {statusText}
        </p>
      </div>
    </DetailSurface>
  );
}
