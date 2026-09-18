/**
 * Record a data refresh in docs/research/changelog.md.
 *
 *   npm run data:changelog                    compare the freshly built public/data against HEAD
 *   npm run data:changelog -- --ref HEAD~1    compare against an older commit
 *   npm run data:changelog -- --date 2026-10-01
 *
 * Run it after `data:build`, before committing: the "previous" side is what git still has.
 * Writing nothing is a normal outcome — a refresh that changed neither the sources nor the counts
 * has nothing to say.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { appendRow, changelogRow } from './lib/changelog.ts';
import { flagValue, readJson, repoPath } from './lib/io.ts';
import { defaultSeason, outPath, outRelPath } from './lib/out.ts';
import type { Meta } from '../src/core/schema.ts';

const ref = flagValue('--ref') ?? 'HEAD';
const season = Number(flagValue('--season') ?? defaultSeason() ?? 7);
const date = flagValue('--date') ?? new Date().toISOString().slice(0, 10);
const changelogPath = repoPath('docs/research/changelog.md');

function committedMeta(): Meta | null {
  try {
    const text = execFileSync('git', ['show', `${ref}:${outRelPath('meta', season)}`], {
      cwd: repoPath(''),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return JSON.parse(text) as Meta;
  } catch {
    return null;
  }
}

const before = committedMeta();
const after = readJson<Meta>(outPath('meta', season));

// meta.json carries the dataVersion (a hash of every input), the source shas and the counts, so an
// identical one means the refresh produced exactly what is already committed.
if (before && JSON.stringify(before) === JSON.stringify(after)) {
  console.log(`changelog: ${outRelPath('meta', season)}이 ${ref}와 같습니다 — 기록할 변경이 없습니다`);
  process.exit(0);
}

const row = changelogRow(before, after, date);

const markdown = readFileSync(changelogPath, 'utf8');
const next = appendRow(markdown, row);

if (next === markdown) {
  console.log('changelog: 이미 기록된 내용입니다 (추가하지 않음)');
} else {
  writeFileSync(changelogPath, next, 'utf8');
  console.log(`changelog: ${row}`);
}
