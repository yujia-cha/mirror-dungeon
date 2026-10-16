/**
 * The feedback issue (M127): a title, a readable Markdown body and the GitHub new-issue URL that
 * carries both, within the length GitHub accepts.
 *
 * GitHub's prefilled new-issue URL stops working somewhere past 8 KB (the server answers 414 or
 * drops the body), so the URL is held to `MAX_ISSUE_URL`. Korean text costs nine characters a
 * syllable once percent-encoded, which is why the readable half stays short and the rest rides in
 * the compressed payload (`payload.ts`). When even that is too long, `LEVELS` are tried in turn —
 * fewer log lines in the readable half, fewer log entries and diagnostics records in the payload —
 * and the body says 「기록 일부 생략」. A message too long for any level leaves a body that asks the
 * reader to paste; the form copies the full body to the clipboard for that (`fullBody`, held only
 * to GitHub's own body limit).
 *
 * Pure: everything it reads is in `FeedbackInput`, every sentence comes from `docs/copy.md`.
 */
import { t, type Lang, type StringKey } from '../i18n.ts';
import type { FeedbackLogEntry } from '../lib/feedback-log.ts';
import type { RunState } from '../lib/plan-input.ts';
import type { SharedState } from '../store.ts';
import {
  encodePayload,
  PAYLOAD_VERSION,
  type FeedbackEnv,
  type FeedbackKind,
  type FeedbackPayload,
  type RouteSummary,
} from './payload.ts';
import { summarize, type VisitorRecord } from './visitor-diagnostics.ts';

/** The public repository the issues go to — the one visitors can see, not the development one. */
export const FEEDBACK_REPO = 'yujia-cha/mirror-dungeon';
export const FEEDBACK_LABEL = 'feedback';
/** Under GitHub's ~8 KB limit for a prefilled new-issue URL, with room to spare. */
export const MAX_ISSUE_URL = 8000;
/** GitHub refuses an issue body over 65 536 characters; the copied body stays under it. */
export const MAX_ISSUE_BODY = 60000;

export interface FeedbackInput {
  /** When the form was sent, ms since the epoch. */
  t: number;
  kind: FeedbackKind;
  title: string;
  message: string;
  env: FeedbackEnv;
  include: { state: boolean; log: boolean; diagnostics: boolean; screenshot: boolean };
  state: { shareUrl: string; shared: SharedState; run: RunState; route: RouteSummary | null };
  log: readonly FeedbackLogEntry[];
  diagnostics: readonly VisitorRecord[];
}

/** How much one attempt keeps. `log` and `diag` bound the payload, `human` the readable lines. */
interface Level {
  log: number;
  diag: number;
  human: number;
}

export const LEVELS: readonly Level[] = [
  { log: Infinity, diag: 120, human: 8 },
  { log: 30, diag: 60, human: 5 },
  { log: 15, diag: 30, human: 3 },
  { log: 8, diag: 12, human: 2 },
  { log: 4, diag: 0, human: 1 },
  { log: 0, diag: 0, human: 0 },
];
/** What the copied body keeps: everything the form holds. */
const FULL: Level = { log: Infinity, diag: Infinity, human: 12 };

export interface FeedbackIssue {
  title: string;
  /** The body the URL carries. */
  body: string;
  url: string;
  /** The body as complete as GitHub allows, for 「내용 복사」. */
  fullBody: string;
  /** Some log or diagnostics were left out of `body` to fit the URL. */
  trimmed: boolean;
  /** False when `body` is only a request to paste `fullBody`: the message itself was too long. */
  fits: boolean;
}

/**
 * The newest `n` entries, errors first: an error explains a report better than the click before
 * it. Returned oldest first, as the ring holds them.
 */
export function trimLog(entries: readonly FeedbackLogEntry[], n: number): FeedbackLogEntry[] {
  if (n >= entries.length) return [...entries];
  if (n <= 0) return [];
  const keep = new Set<FeedbackLogEntry>();
  for (let i = entries.length - 1; i >= 0 && keep.size < n; i -= 1)
    if (entries[i]!.kind === 'error') keep.add(entries[i]!);
  for (let i = entries.length - 1; i >= 0 && keep.size < n; i -= 1) keep.add(entries[i]!);
  return entries.filter((entry) => keep.has(entry));
}

/** `HH:MM:SS` in the reader's time zone. */
function clock(ms: number): string {
  const d = new Date(ms);
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
}

/** `a 2 · b 1`, most frequent first; `none` when empty. */
function tally(codes: readonly string[], none: string): string {
  if (!codes.length) return none;
  const counts = new Map<string, number>();
  for (const code of codes) counts.set(code, (counts.get(code) ?? 0) + 1);
  return [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([code, n]) => (n > 1 ? `${code} ${n}` : code))
    .join(' · ');
}

export function issueTitle(input: Pick<FeedbackInput, 'kind' | 'title' | 'message'>, lang: Lang): string {
  const own = input.title.trim();
  const firstLine = input.message.trim().split('\n')[0] ?? '';
  const text = own || (firstLine.length > 60 ? `${firstLine.slice(0, 59)}…` : firstLine);
  return t('feedbackIssueTitle', lang, { kind: t(`feedbackKind_${input.kind}` as StringKey, lang), text });
}

function envLines(env: FeedbackEnv, lang: Lang): string[] {
  return [
    `- ${t('feedbackBodyEnvData', lang, { dataVersion: env.dataVersion, season: env.seasonName || `MD${env.season}` })}`,
    `- ${t('feedbackBodyEnvDevice', lang, {
      browser: env.browser,
      viewport: env.viewport,
      input: t(env.touch ? 'feedbackBodyTouch' : 'feedbackBodyMouse', lang),
      lang: env.lang,
      theme: t(env.theme === 'dark' ? 'feedbackBodyDark' : 'feedbackBodyLight', lang),
    })}`,
  ];
}

function stateLines(state: FeedbackInput['state'], lang: Lang): string[] {
  const { run, route } = state;
  const statuses = Object.values(run.giftStatus);
  const visits = Object.keys(run.visits).length;
  const started = visits > 0 || run.currentFloor > 1 || statuses.length > 0;
  const none = t('feedbackBodyNone', lang);
  return [
    `- ${t('feedbackBodyPlanLink', lang, { url: state.shareUrl })}`,
    `- ${
      started
        ? t('feedbackBodyRun', lang, {
            current: run.currentFloor,
            stage: run.stageFloor,
            visits,
            got: statuses.filter((s) => s === 'got').length,
            failed: statuses.filter((s) => s === 'failed').length,
          })
        : t('feedbackBodyRunNone', lang)
    }`,
    `- ${
      route
        ? t('feedbackBodyRoute', lang, {
            covered: route.covered,
            total: route.total,
            unresolved: tally(
              route.unresolved.map((u) => u.reason),
              none,
            ),
            warnings: tally(route.warnings, none),
          })
        : t('feedbackBodyRouteNone', lang)
    }`,
  ];
}

function logLines(log: readonly FeedbackLogEntry[], n: number, lang: Lang): string[] {
  if (n <= 0) return [];
  const errors = log.filter((e) => e.kind === 'error').slice(-n);
  const actions = log.filter((e) => e.kind === 'action').slice(-n);
  const out: string[] = [];
  if (errors.length) {
    out.push(`**${t('feedbackBodyErrors', lang)}**`, '');
    for (const e of errors) {
      if (e.kind !== 'error') continue;
      out.push(`- ${clock(e.t)} [${e.source}] ${e.message.replace(/\s+/g, ' ')}`);
      if (e.stack) out.push('  ```', ...e.stack.split('\n').map((line) => `  ${line}`), '  ```');
    }
    out.push('');
  }
  if (actions.length) {
    out.push(`**${t('feedbackBodyActions', lang)}**`, '');
    for (const e of actions) if (e.kind === 'action') out.push(`- ${clock(e.t)} ${e.text}`);
    out.push('');
  }
  return out;
}

function render(input: FeedbackInput, lang: Lang, level: Level, trimmed: boolean): string {
  const none = t('feedbackBodyNotAttached', lang);
  const log = input.include.log ? trimLog(input.log, level.log) : [];
  const diag =
    input.include.diagnostics && input.diagnostics.length
      ? summarize(input.diagnostics, Math.min(level.diag, input.diagnostics.length))
      : null;
  const payload: FeedbackPayload = {
    v: PAYLOAD_VERSION,
    t: input.t,
    kind: input.kind,
    title: input.title.trim(),
    message: input.message.trim(),
    env: input.env,
    ...(input.include.state
      ? {
          state: {
            shareUrl: input.state.shareUrl,
            shared: input.state.shared,
            run: input.state.run,
            route: input.state.route,
          },
        }
      : {}),
    ...(input.include.log ? { log: { entries: log, omitted: input.log.length - log.length } } : {}),
    ...(diag ? { diagnostics: diag } : {}),
    screenshot: input.include.screenshot,
  };
  const lines: string[] = [
    `## ${t('feedbackBodyMessage', lang)}`,
    '',
    input.message.trim(),
    '',
    `## ${t('feedbackBodyEnv', lang)}`,
    '',
    ...envLines(input.env, lang),
    '',
    `## ${t('feedbackBodyState', lang)}`,
    '',
    ...(input.include.state ? stateLines(input.state, lang) : [none]),
    '',
  ];
  if (input.include.screenshot)
    lines.push(`## ${t('feedbackBodyScreen', lang)}`, '', t('feedbackBodyScreenPaste', lang), '');
  const human = input.include.log ? logLines(log, level.human, lang) : [];
  const diagLine = diag
    ? t('feedbackBodyDiag', lang, {
        n: diag.total,
        detail: Object.entries(diag.counts)
          .map(([kind, n]) => `${kind} ${n}`)
          .join(' · '),
      })
    : null;
  if (human.length || diagLine || trimmed || input.include.log) {
    lines.push(`<details><summary>${t('feedbackBodyLog', lang)}</summary>`, '');
    if (human.length) lines.push(...human);
    else if (input.include.log) lines.push(t('feedbackBodyNoLog', lang), '');
    if (diagLine) lines.push(diagLine, '');
    if (trimmed) lines.push(`_${t('feedbackBodyTrimmed', lang)}_`, '');
    lines.push('</details>', '');
  }
  lines.push(
    `<details><summary>${t('feedbackBodyPayload', lang)}</summary>`,
    '',
    encodePayload(payload),
    '',
    '</details>',
    '',
    '---',
    t('feedbackBodyFooter', lang),
  );
  return lines.join('\n');
}

export function issueUrl(title: string, body: string, repo = FEEDBACK_REPO): string {
  return `https://github.com/${repo}/issues/new?labels=${FEEDBACK_LABEL}&title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
}

/** Did a level leave anything out compared with what the form holds? */
function leavesOut(input: FeedbackInput, level: Level): boolean {
  const logOut = input.include.log && level.log < input.log.length;
  const diagOut = input.include.diagnostics && level.diag < input.diagnostics.length;
  return logOut || diagOut;
}

export function buildFeedback(input: FeedbackInput, lang: Lang, maxUrl = MAX_ISSUE_URL): FeedbackIssue {
  const title = issueTitle(input, lang);
  let fullBody = render(input, lang, FULL, false);
  for (const level of LEVELS) {
    if (fullBody.length <= MAX_ISSUE_BODY) break;
    fullBody = render(input, lang, level, true);
  }
  for (const level of LEVELS) {
    const trimmed = leavesOut(input, level);
    const body = render(input, lang, level, trimmed);
    const url = issueUrl(title, body);
    if (url.length <= maxUrl) return { title, body, url, fullBody, trimmed, fits: true };
  }
  // The message alone is past the limit: open the issue with a request to paste instead.
  const body = [t('feedbackBodyPasteHere', lang), '', '---', t('feedbackBodyFooter', lang)].join('\n');
  return { title, body, url: issueUrl(title, body), fullBody, trimmed: true, fits: false };
}
