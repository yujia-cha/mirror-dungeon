/**
 * `docs/copy.md` — every sentence a visitor reads, in one file the owner edits.
 *
 * The file is plain Markdown so GitHub and the Claude app render it as it is, and it is read line
 * by line so a mistake points at a line number instead of failing somewhere downstream. Four parts,
 * each opened by a fixed `# ` heading:
 *
 *   # 화면 문구               the app's `STRINGS` — `## 화면` sections, `### key` entries
 *   # 루트 경고·미해결 사유     core's sentences — same entry shape, `warn.x`-style keys
 *   # 설명서 카드             the 「?」 guide — `## 한국어 제목 | English title` cards
 *   # README                 one ````markdown fence, written out as README.md
 *
 * An entry is its `### key` heading followed by `메모:` lines (optional), `- ko:` and `- en:`,
 * and a `- 쓰는 곳:` line the generator rewrites from a scan of `src/` (never edited by hand).
 * Prose anywhere outside an entry is a free comment. Everything here is pure; the script
 * (`scripts/build-copy.ts`) does the reading, scanning and writing.
 */
import { PLACEHOLDER } from '../../src/core/text.ts';

export interface CopyText {
  ko: string;
  en: string;
}

export interface CopyEntry extends CopyText {
  key: string;
  /** The `## ` heading it sits under — where on the page it shows up. */
  section: string;
  notes: string[];
  /** 0-based line of the `### key` heading. */
  line: number;
  /** 0-based line of the last line that belongs to the entry's body (for inserting 쓰는 곳). */
  lastLine: number;
  /** 0-based line of an existing `- 쓰는 곳:` line. */
  usageLine: number | null;
}

export interface GuideCardModel {
  title: CopyText;
  lines: CopyText[];
  notice: boolean;
  line: number;
}

export interface CopyDoc {
  strings: CopyEntry[];
  messages: CopyEntry[];
  guide: GuideCardModel[];
  readme: string | null;
}

export interface CopyIssue {
  /** 1-based, as an editor shows it. */
  line: number;
  message: string;
}

export const COPY_PATH = 'docs/copy.md';

const PARTS = {
  '화면 문구': 'strings',
  '루트 경고·미해결 사유': 'messages',
  '설명서 카드': 'guide',
  README: 'readme',
} as const;
type Part = (typeof PARTS)[keyof typeof PARTS];

const STRING_KEY = /^[A-Za-z][A-Za-z0-9_]*$/;
const MESSAGE_KEY = /^[a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)+$/;
const USAGE_PREFIX = '- 쓰는 곳:';
const NOTE_PREFIX = '메모:';

/** `{name}` / `{name|은/는}` placeholders of one text, in order of first use. */
export function placeholdersOf(text: string): { name: string; josa: string | undefined }[] {
  return [...text.matchAll(PLACEHOLDER)].map((m) => ({ name: m[1]!, josa: m[2] }));
}

/** A brace that is not part of a well-formed placeholder: 「{ name}」, 「{0}」, a lone 「}」. */
function strayBrace(text: string): boolean {
  return /[{}]/.test(text.replace(PLACEHOLDER, ''));
}

function valueLine(line: string, lang: 'ko' | 'en'): string | null {
  const prefix = `- ${lang}:`;
  return line.startsWith(prefix) ? line.slice(prefix.length).trim() : null;
}

export function parseCopy(source: string): { doc: CopyDoc; issues: CopyIssue[] } {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const doc: CopyDoc = { strings: [], messages: [], guide: [], readme: null };
  const issues: CopyIssue[] = [];
  const issue = (index: number, message: string): void => {
    issues.push({ line: index + 1, message });
  };

  let part: Part | null = null;
  let seenTitle = false;
  let section = '';
  let entry: (Omit<CopyEntry, 'ko' | 'en'> & Partial<CopyText>) | null = null;
  let card: GuideCardModel | null = null;
  let pendingKo: { text: string; line: number } | null = null;
  let fence: { marks: string; start: number; body: string[] } | null = null;

  const closeEntry = (): void => {
    if (!entry) return;
    const target = part === 'messages' ? doc.messages : doc.strings;
    if (!entry.ko) issue(entry.line, `${entry.key}: 「- ko:」가 없거나 비어 있습니다`);
    if (!entry.en) issue(entry.line, `${entry.key}: 「- en:」이 없거나 비어 있습니다`);
    const { key, ko, en } = entry;
    if (target.some((e) => e.key === key)) issue(entry.line, `${key}: 같은 키가 이미 있습니다`);
    else if (ko && en) target.push({ ...entry, ko, en });
    entry = null;
  };
  const closePendingKo = (): void => {
    if (pendingKo) issue(pendingKo.line, '설명서 줄의 「- ko:」 다음에 「- en:」이 와야 합니다');
    pendingKo = null;
  };
  const closeCard = (): void => {
    closePendingKo();
    if (card) {
      if (card.lines.length === 0) issue(card.line, `설명서 카드 「${card.title.ko}」에 줄이 없습니다`);
      doc.guide.push(card);
    }
    card = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    if (fence) {
      if (line.trimEnd() === fence.marks) {
        if (doc.readme !== null) issue(fence.start, 'README 울타리 블록은 하나만 둡니다');
        else doc.readme = fence.body.join('\n') + '\n';
        fence = null;
      } else fence.body.push(line);
      continue;
    }

    const h1 = /^# (.+)$/.exec(line);
    if (h1) {
      closeEntry();
      closeCard();
      const title = h1[1]!.trim();
      if (title in PARTS) part = PARTS[title as keyof typeof PARTS];
      else if (!seenTitle && part === null) part = null;
      else issue(i, `모르는 큰 제목 「${title}」 — ${Object.keys(PARTS).join(' / ')} 중 하나여야 합니다`);
      seenTitle = true;
      section = '';
      continue;
    }
    if (part === null) continue;

    if (part === 'readme') {
      const open = /^(`{4,})markdown\s*$/.exec(line);
      if (open) fence = { marks: open[1]!, start: i, body: [] };
      continue;
    }

    const h2 = /^## (.+)$/.exec(line);
    if (h2) {
      closeEntry();
      closeCard();
      section = h2[1]!.trim();
      if (part === 'guide') {
        const [ko, en, ...rest] = section.split(' | ').map((s) => s.trim());
        if (!ko || !en || rest.length > 0) issue(i, '설명서 카드 제목은 「## 한국어 | English」 꼴입니다');
        card = { title: { ko: ko ?? '', en: en ?? '' }, lines: [], notice: false, line: i };
      }
      continue;
    }

    if (part === 'guide') {
      if (line.trim() === '' || line.startsWith(NOTE_PREFIX)) continue;
      if (!card) continue; // prose before the first card
      const ko = valueLine(line, 'ko');
      const en = valueLine(line, 'en');
      if (ko !== null) {
        closePendingKo();
        if (!ko) issue(i, '「- ko:」가 비어 있습니다');
        pendingKo = { text: ko, line: i };
      } else if (en !== null) {
        if (!pendingKo) issue(i, '「- en:」 앞에 「- ko:」가 있어야 합니다');
        else if (!en) issue(i, '「- en:」이 비어 있습니다');
        else card.lines.push({ ko: pendingKo.text, en });
        pendingKo = null;
      } else if (line.trim() === '- notice: true') card.notice = true;
      else issue(i, `설명서 카드에서 읽을 수 없는 줄: ${line}`);
      continue;
    }

    // strings / messages
    const h3 = /^### (.+)$/.exec(line);
    if (h3) {
      closeEntry();
      const key = h3[1]!.trim();
      const shape = part === 'messages' ? MESSAGE_KEY : STRING_KEY;
      if (!shape.test(key))
        issue(
          i,
          `키 「${key}」의 꼴이 맞지 않습니다 (${part === 'messages' ? 'warn.fusionSlots' : 'stageEnter'}처럼)`,
        );
      entry = { key, section, notes: [], line: i, lastLine: i, usageLine: null };
      continue;
    }
    if (!entry) continue; // prose under a section heading
    if (line.trim() === '') continue;
    entry.lastLine = i;
    const ko = valueLine(line, 'ko');
    const en = valueLine(line, 'en');
    if (line.startsWith(NOTE_PREFIX)) entry.notes.push(line.slice(NOTE_PREFIX.length).trim());
    else if (ko !== null) {
      if (entry.ko !== undefined) issue(i, `${entry.key}: 「- ko:」가 두 번 있습니다`);
      entry.ko = ko;
    } else if (en !== null) {
      if (entry.en !== undefined) issue(i, `${entry.key}: 「- en:」이 두 번 있습니다`);
      entry.en = en;
    } else if (line.startsWith(USAGE_PREFIX)) entry.usageLine = i;
    else issue(i, `${entry.key}: 읽을 수 없는 줄 — 「메모:」·「- ko:」·「- en:」만 씁니다: ${line}`);
  }
  if (fence) issue(fence.start, 'README 울타리 블록이 닫히지 않았습니다');
  closeEntry();
  closeCard();

  for (const e of doc.strings) checkPlaceholders(e, false, issue);
  for (const e of doc.messages) checkPlaceholders(e, true, issue);
  for (const c of doc.guide)
    for (const l of [c.title, ...c.lines])
      for (const text of [l.ko, l.en])
        if (strayBrace(text) || placeholdersOf(text).length > 0)
          issue(c.line, `설명서 카드 「${c.title.ko}」에는 {자리표시}를 쓸 수 없습니다`);
  if (doc.readme === null) issue(lines.length - 1, '「# README」 아래에 ````markdown 울타리 블록이 없습니다');

  issues.sort((a, b) => a.line - b.line);
  return { doc, issues };
}

/**
 * App strings are filled by `t()`, which knows `{name}` only and fills the same names in both
 * languages, so their sets must match. A core message may leave a name out of the English (the
 * Korean sentence names the gift, the English does not), but never invent one.
 */
function checkPlaceholders(
  entry: CopyEntry,
  isMessage: boolean,
  issue: (index: number, message: string) => void,
): void {
  for (const lang of ['ko', 'en'] as const)
    if (strayBrace(entry[lang]))
      issue(entry.line, `${entry.key}: ${lang}에 짝이 맞지 않는 중괄호가 있습니다`);
  const ko = placeholdersOf(entry.ko);
  const en = placeholdersOf(entry.en);
  if (!isMessage && [...ko, ...en].some((p) => p.josa))
    issue(entry.line, `${entry.key}: 화면 문구는 조사 자리표시({이름|을/를})를 쓸 수 없습니다`);
  const koNames = new Set(ko.map((p) => p.name));
  const enNames = new Set(en.map((p) => p.name));
  for (const name of enNames)
    if (!koNames.has(name)) issue(entry.line, `${entry.key}: en에만 있는 자리표시 {${name}}`);
  if (!isMessage)
    for (const name of koNames)
      if (!enNames.has(name)) issue(entry.line, `${entry.key}: ko에만 있는 자리표시 {${name}}`);
}

// ---- Output ------------------------------------------------------------------------------------

const HEADER = (what: string): string =>
  `// 생성 파일 — ${COPY_PATH}의 「${what}」에서 \`npm run copy\`가 만든다. 직접 고치지 않는다.\n`;

const lit = (value: string): string => JSON.stringify(value);
const propKey = (key: string): string => (/^[A-Za-z_$][\w$]*$/.test(key) ? key : lit(key));

function notesAsComments(notes: string[], indent: string): string {
  return notes.map((note) => `${indent}// ${note}\n`).join('');
}

/** `src/app/strings.generated.ts` — before prettier. */
export function renderStringsModule(doc: CopyDoc): string {
  let out = HEADER('화면 문구」·「설명서 카드');
  out +=
    "import type { Localized } from '../core/schema.ts';\nimport type { GuideCard } from './i18n.ts';\n\n";
  out += 'export const STRINGS = {\n';
  let section = '';
  for (const entry of doc.strings) {
    if (entry.section !== section) {
      section = entry.section;
      out += `\n  // ── ${section}\n`;
    }
    out += notesAsComments(entry.notes, '  ');
    out += `  ${propKey(entry.key)}: { ko: ${lit(entry.ko)}, en: ${lit(entry.en)} },\n`;
  }
  out += '} as const satisfies Record<string, Localized>;\n\n';
  out += 'export const GUIDE_CARDS = [\n';
  for (const card of doc.guide) {
    out += `  {\n    title: { ko: ${lit(card.title.ko)}, en: ${lit(card.title.en)} },\n    lines: [\n`;
    for (const l of card.lines) out += `      { ko: ${lit(l.ko)}, en: ${lit(l.en)} },\n`;
    out += '    ],\n';
    if (card.notice) out += '    notice: true,\n';
    out += '  },\n';
  }
  out += '] as const satisfies readonly GuideCard[];\n';
  return out;
}

/** `src/core/messages.generated.ts` — the table and, per key, the parameters it must be given. */
export function renderMessagesModule(doc: CopyDoc): string {
  let out = HEADER('루트 경고·미해결 사유');
  out += "import type { MessageParam } from './messages.ts';\n\n";
  out += 'export const MESSAGES = {\n';
  let section = '';
  for (const entry of doc.messages) {
    if (entry.section !== section) {
      section = entry.section;
      out += `\n  // ── ${section}\n`;
    }
    out += notesAsComments(entry.notes, '  ');
    out += `  ${propKey(entry.key)}: { ko: ${lit(entry.ko)}, en: ${lit(entry.en)} },\n`;
  }
  out += '} as const;\n\n';
  out += '/** The parameters each message takes — `msg()` will not compile without them. */\n';
  out += 'export interface MessageParams {\n';
  for (const entry of doc.messages) {
    const names = [...new Set(placeholdersOf(entry.ko).map((p) => p.name))];
    const type =
      names.length === 0
        ? 'Record<never, never>'
        : `{ ${names.map((n) => `${n}: MessageParam`).join('; ')} }`;
    out += `  ${lit(entry.key)}: ${type};\n`;
  }
  out += '}\n';
  return out;
}

export const README_NOTICE = `<!-- 이 파일은 ${COPY_PATH}의 「README」에서 \`npm run copy\`가 만듭니다. 고칠 때는 그 파일을 고치세요. -->\n`;

export function renderReadme(doc: CopyDoc): string {
  return README_NOTICE + (doc.readme ?? '');
}

// ---- Where each text is used ---------------------------------------------------------------------

export interface SourceFile {
  /** Repository-relative, forward slashes. */
  path: string;
  text: string;
}

/**
 * Which source files use each key. Three passes, from surest to loosest:
 *  1. a call — `t('key'` / `msg('key'` (whitespace and line breaks allowed before the quote);
 *  2. the key as a quoted literal anywhere — handed over through a table (`FAILURE_KEY`, labels);
 *  3. a template prefix — `` `captureErr_${…}` `` marks every key starting `captureErr_` (동적).
 * A key no pass finds is reported as unused, which is the point: the owner sees dead copy.
 */
export function findUsages(keys: string[], files: SourceFile[], call: 't' | 'msg'): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const add = (key: string, label: string): void => {
    const list = out.get(key) ?? [];
    if (!list.includes(label)) list.push(label);
    out.set(key, list);
  };
  const callPattern = new RegExp(`\\b${call}\\(\\s*['"]([^'"]+)['"]`, 'g');
  const keySet = new Set(keys);
  for (const file of files) {
    for (const m of file.text.matchAll(callPattern)) if (keySet.has(m[1]!)) add(m[1]!, file.path);
  }
  for (const key of keys) {
    if (out.has(key)) continue;
    const quoted = new RegExp(`['"\`]${key.replace(/[.$]/g, '\\$&')}['"\`]`);
    for (const file of files) if (quoted.test(file.text)) add(key, file.path);
  }
  const unfound = keys.filter((key) => !out.has(key));
  for (const file of files) {
    for (const m of file.text.matchAll(/`([A-Za-z][\w.]*?)\$\{/g)) {
      const prefix = m[1]!;
      for (const key of unfound)
        if (key.startsWith(prefix) && key.length > prefix.length) add(key, `${file.path} (동적)`);
    }
  }
  for (const list of out.values()) list.sort();
  return out;
}

export function usageText(paths: string[] | undefined): string {
  return `${USAGE_PREFIX} ${paths && paths.length > 0 ? paths.join(', ') : '참조 없음'}`;
}

/** The source with every entry's `- 쓰는 곳:` line set to `usages` (inserted when missing). */
export function withUsageLines(source: string, doc: CopyDoc, usages: Map<string, string[]>): string {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const entries = [...doc.strings, ...doc.messages].sort((a, b) => b.line - a.line);
  for (const entry of entries) {
    const text = usageText(usages.get(entry.key));
    if (entry.usageLine !== null) lines[entry.usageLine] = text;
    else lines.splice(entry.lastLine + 1, 0, text);
  }
  return lines.join('\n');
}

// ---- Staleness ---------------------------------------------------------------------------------

/**
 * 「…」 quotes in the guide and the README that match no screen text. Those quotes name buttons and
 * labels, so one that matches nothing usually means the UI was renamed and the explanation was not.
 * A `{name}` in a screen text matches any run of characters (「획득 M/T」 ↔ 「획득 {covered}」).
 * Some quotes are examples or game text, so this warns rather than fails.
 */
export function unmatchedQuotes(doc: CopyDoc): { where: string; quote: string }[] {
  const patterns = doc.strings.map((e) => {
    const parts = e.ko.split(PLACEHOLDER);
    // split() with two capture groups interleaves name and josa; keep the literal pieces only.
    const literal = parts.filter((_, i) => i % 3 === 0);
    return new RegExp(`^${literal.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.+?')}$`);
  });
  const out: { where: string; quote: string }[] = [];
  const scan = (where: string, text: string): void => {
    for (const m of text.matchAll(/「([^」]+)」/g)) {
      const quote = m[1]!;
      if (!patterns.some((p) => p.test(quote)) && !out.some((o) => o.quote === quote && o.where === where))
        out.push({ where, quote });
    }
  };
  for (const card of doc.guide) for (const l of card.lines) scan(`설명서 「${card.title.ko}」`, l.ko);
  if (doc.readme) scan('README', doc.readme);
  return out;
}
