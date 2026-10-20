/**
 * The machine-readable half of a feedback issue (M127): the whole report as JSON, compressed with
 * lz-string to base64 and fenced as ```` ```md-feedback ````, so the owner can decode everything
 * the readable half had to leave out (`npm run feedback:decode`).
 *
 * Pure, and shared by the app (which encodes) and `scripts/lib/feedback-decode.ts` (which decodes).
 * The block survives the trips an issue body takes: GitHub keeps fenced text as typed, a reader's
 * editor may wrap it — whitespace inside the block is ignored on the way back.
 */
import lzString from 'lz-string';
import {
  FEEDBACK_PAYLOAD_VERSION,
  feedbackPayloadSchema,
  type CheckedFeedbackPayload,
} from '../../core/schema.ts';
import type { FeedbackLogEntry } from '../lib/feedback-log.ts';
import type { RunState } from '../lib/plan-input.ts';
import type { SharedState } from '../store.ts';
import type { VisitorDiagSummary } from './visitor-diagnostics.ts';

export const PAYLOAD_FENCE = 'md-feedback';
export const PAYLOAD_VERSION = FEEDBACK_PAYLOAD_VERSION;
/**
 * The longest block the decoder reads (M160): lz-string's output can grow far past its input, and
 * the issue is public. GitHub holds a body to 65 536 characters, so no real block comes near this.
 */
export const MAX_PAYLOAD_CHARS = 262_144;

export type FeedbackKind = 'bug' | 'idea' | 'data' | 'other';
export const FEEDBACK_KINDS: readonly FeedbackKind[] = ['bug', 'idea', 'data', 'other'];

export interface FeedbackEnv {
  dataVersion: string;
  season: number;
  seasonName: string;
  lang: 'ko' | 'en';
  theme: 'dark' | 'light';
  /** `390x844@3` — CSS pixels and the device pixel ratio. */
  viewport: string;
  /** Browser and OS in a few words (`shortUserAgent`). */
  browser: string;
  touch: boolean;
  /** The page the report was sent from, without hash or query. */
  page: string;
}

export interface RouteSummary {
  covered: number;
  total: number;
  unresolved: { giftId: number; reason: string }[];
  warnings: string[];
  capped: boolean;
}

export interface FeedbackPayload {
  v: typeof PAYLOAD_VERSION;
  /** When the form was sent, ms since the epoch. */
  t: number;
  kind: FeedbackKind;
  title: string;
  message: string;
  env: FeedbackEnv;
  /** Absent when the visitor unticked 「앱 상태 첨부」. */
  state?: {
    /** The share link that reopens the deck, goals and options. */
    shareUrl: string;
    shared: SharedState;
    run: RunState;
    route: RouteSummary | null;
  };
  /** Absent when the visitor unticked 「오류·조작 기록 첨부」. */
  log?: { entries: FeedbackLogEntry[]; omitted: number };
  /** Absent unless the visitor recorded and attached 피드백용 진단 기록. */
  diagnostics?: VisitorDiagSummary;
  /** Whether the visitor copied a screen picture to paste into the issue. */
  screenshot: boolean;
}

/**
 * What the app sends must pass the decoder's check (`feedbackPayloadSchema`): a field changed here
 * and not there fails the type check, not a visitor's report.
 */
export type PayloadMatchesSchema = FeedbackPayload extends CheckedFeedbackPayload ? true : never;
const payloadMatchesSchema: PayloadMatchesSchema = true;
void payloadMatchesSchema;

/** The fenced block for an issue body. One line: the decoder ignores whitespace anyway. */
export function encodePayload(payload: FeedbackPayload): string {
  return `\`\`\`${PAYLOAD_FENCE}\n${lzString.compressToBase64(JSON.stringify(payload))}\n\`\`\``;
}

/**
 * The base64 text of the **last** `md-feedback` block in an issue body, whitespace removed; null if
 * none. The last, because the visitor's message comes first in the body: an old report pasted into
 * it carries a block of its own, and that one must not stand in for the report's (M160).
 */
export function extractPayloadText(body: string): string | null {
  const blocks = new RegExp('```' + PAYLOAD_FENCE + '\\s*\\n([\\s\\S]*?)```', 'g');
  let last: string | null = null;
  for (const match of body.replace(/\r\n/g, '\n').matchAll(blocks)) last = match[1]!;
  if (last === null) return null;
  const text = last.replace(/\s+/g, '');
  return text || null;
}

export type DecodeResult = { ok: true; payload: FeedbackPayload } | { ok: false; error: string };

/** An issue body (or just the block's text) back to the payload. Never throws. */
export function decodePayload(body: string): DecodeResult {
  const text =
    extractPayloadText(body) ?? (/^[A-Za-z0-9+/=\s]+$/.test(body.trim()) ? body.replace(/\s+/g, '') : null);
  if (!text) return { ok: false, error: `no \`\`\`${PAYLOAD_FENCE} block found` };
  if (text.length > MAX_PAYLOAD_CHARS)
    return { ok: false, error: `the block is longer than ${MAX_PAYLOAD_CHARS} characters` };
  let json: string | null;
  try {
    json = lzString.decompressFromBase64(text);
  } catch {
    json = null;
  }
  if (!json) return { ok: false, error: 'the block did not decompress (cut short or edited?)' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, error: 'the block decompressed to something that is not JSON' };
  }
  if (!parsed || typeof parsed !== 'object' || (parsed as { v?: unknown }).v !== PAYLOAD_VERSION)
    return { ok: false, error: `unknown payload version ${String((parsed as { v?: unknown })?.v)}` };
  // The issue is public: anyone can write the block. Check every field before trusting it (M154).
  const checked = feedbackPayloadSchema.safeParse(parsed);
  if (!checked.success) {
    const issue = checked.error.issues[0]!;
    const where = issue.path.length ? issue.path.join('.') : '(root)';
    return { ok: false, error: `the payload is malformed at ${where}: ${issue.message}` };
  }
  // The object as sent (the check strips nothing it keeps), now known to have the shape.
  return { ok: true, payload: parsed as FeedbackPayload };
}
