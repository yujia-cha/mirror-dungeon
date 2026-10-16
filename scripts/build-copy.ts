/**
 * Turn `docs/copy.md` — the one file that holds every sentence a visitor reads — into the files
 * that ship it.
 *
 *   npm run copy            write src/app/strings.generated.ts, src/core/messages.generated.ts,
 *                           README.md, and the `- 쓰는 곳:` lines of docs/copy.md itself
 *   npm run copy -- --check write nothing; fail when any of those differs (part of `npm run check`)
 *
 * The parsing and rendering are pure (`scripts/lib/copy-format.ts`); this file reads, scans `src/`
 * for where each key is used, formats the TypeScript with the repository's prettier settings so
 * `format:check` stays green, and writes. Output is deterministic: same copy.md, same bytes.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import * as prettier from 'prettier';
import {
  checkMedia,
  COPY_PATH,
  findUsages,
  parseCopy,
  renderMessagesModule,
  renderReadme,
  renderStringsModule,
  unmatchedQuotes,
  withUsageLines,
  type MediaProbe,
  type SourceFile,
} from './lib/copy-format.ts';
import { imageSize } from './lib/image-size.ts';
import { repoPath, repoRoot } from './lib/io.ts';

const check = process.argv.includes('--check');

const STRINGS_OUT = 'src/app/strings.generated.ts';
const MESSAGES_OUT = 'src/core/messages.generated.ts';
const README_OUT = 'README.md';

/** Production sources under `dir`: no tests, no generated files. */
function sourcesUnder(dir: string): SourceFile[] {
  const out: SourceFile[] = [];
  const walk = (abs: string): void => {
    for (const entry of readdirSync(abs, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const path = join(abs, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== '__tests__') walk(path);
      } else if (/\.tsx?$/.test(entry.name) && !/\.(test|generated)\.tsx?$/.test(entry.name)) {
        out.push({ path: relative(repoRoot, path).split('\\').join('/'), text: readFileSync(path, 'utf8') });
      }
    }
  };
  walk(repoPath(dir));
  return out;
}

async function formatted(source: string, path: string): Promise<string> {
  const options = (await prettier.resolveConfig(repoPath(path))) ?? {};
  return prettier.format(source, { ...options, filepath: repoPath(path) });
}

function readOrEmpty(path: string): string {
  try {
    return readFileSync(repoPath(path), 'utf8');
  } catch {
    return '';
  }
}

const source = readFileSync(repoPath(COPY_PATH), 'utf8');
const { doc, issues } = parseCopy(source);
if (issues.length > 0) {
  for (const i of issues) console.error(`${COPY_PATH}:${i.line}: ${i.message}`);
  console.error(`\n${issues.length}개 문제 — ${COPY_PATH}를 고친 뒤 다시 돌리세요.`);
  process.exit(1);
}

/** A guide picture on disk: its size in bytes and, for an image, its pixel box. */
const probed = new Map<string, MediaProbe>();
function probe(src: string): MediaProbe | null {
  const path = repoPath('public', src);
  if (!existsSync(path)) return null;
  const bytes = readFileSync(path);
  const box = imageSize(bytes);
  const info: MediaProbe = { bytes: bytes.length, ...(box ?? {}) };
  probed.set(src, info);
  return info;
}
const media = checkMedia(doc, probe);
for (const w of media.warnings) console.warn(`${COPY_PATH}:${w.line}: 경고 — ${w.message}`);
// A picture no card points at is shipped for nothing (public/ is deployed whole) — say so.
const guideDir = repoPath('public/guide');
const used = new Set(
  doc.guide.flatMap((card) => card.items.flatMap((i) => (i.kind === 'media' ? [i.src] : []))),
);
const unusedMedia = existsSync(guideDir)
  ? readdirSync(guideDir)
      .sort()
      .filter((name) => !used.has(`guide/${name}`))
  : [];
if (unusedMedia.length > 0)
  console.warn(
    `경고 — 어느 카드도 쓰지 않는 public/guide 파일: ${unusedMedia.join(', ')} (지우거나 「- 그림:」으로 쓰세요)`,
  );
if (media.issues.length > 0) {
  for (const i of media.issues) console.error(`${COPY_PATH}:${i.line}: ${i.message}`);
  console.error(`\n${media.issues.length}개 문제 — 그림 파일이나 ${COPY_PATH}를 고친 뒤 다시 돌리세요.`);
  process.exit(1);
}

const appFiles = sourcesUnder('src/app');
const coreFiles = sourcesUnder('src/core');
const usages = new Map([
  ...findUsages(
    doc.strings.map((e) => e.key),
    appFiles,
    't',
  ),
  ...findUsages(
    doc.messages.map((e) => e.key),
    coreFiles,
    'msg',
  ),
]);

const outputs: [string, string][] = [
  [STRINGS_OUT, await formatted(renderStringsModule(doc, probed), STRINGS_OUT)],
  [MESSAGES_OUT, await formatted(renderMessagesModule(doc), MESSAGES_OUT)],
  [README_OUT, renderReadme(doc)],
  [COPY_PATH, withUsageLines(source, doc, usages)],
];

const changed = outputs.filter(([path, text]) => readOrEmpty(path) !== text);

if (check) {
  if (changed.length > 0) {
    console.error(`${COPY_PATH}와 맞지 않는 파일: ${changed.map(([p]) => p).join(', ')}`);
    console.error(
      '`npm run copy`를 돌려 다시 만드세요. (생성 파일을 직접 고쳤다면 그 변경을 docs/copy.md로 옮기세요.)',
    );
    process.exit(1);
  }
  console.log(
    `copy: ${doc.strings.length}개 화면 문구 · ${doc.messages.length}개 루트 문장 · 설명서 ${doc.guide.length}장 — 생성물 일치`,
  );
} else {
  for (const [path, text] of changed) writeFileSync(repoPath(path), text);
  console.log(
    `copy: ${doc.strings.length}개 화면 문구 · ${doc.messages.length}개 루트 문장 · 설명서 ${doc.guide.length}장` +
      (changed.length > 0 ? ` — 다시 씀: ${changed.map(([p]) => p).join(', ')}` : ' — 바뀐 것 없음'),
  );
  const unused = [...doc.strings, ...doc.messages].filter((e) => !usages.has(e.key)).map((e) => e.key);
  if (unused.length > 0) console.log(`참조 없음 ${unused.length}개: ${unused.join(', ')}`);
  const quotes = unmatchedQuotes(doc);
  if (quotes.length > 0) {
    console.log(
      `\n화면 문구에 없는 「」 인용 ${quotes.length}개 — 버튼 이름이 바뀌었는지 확인하세요(예시·게임 문장이면 그대로 둬도 됩니다):`,
    );
    for (const q of quotes) console.log(`  ${q.where}: 「${q.quote}」`);
  }
}
