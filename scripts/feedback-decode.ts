/**
 * Decode a visitor's feedback issue (M127).
 *
 *   npm run feedback:decode -- issue-body.md
 *   pbpaste | npm run feedback:decode -- -
 *
 * Takes the issue body as GitHub shows it in 「Edit」 (or just the ```` ```md-feedback ```` block),
 * decodes the payload the app compressed into it and writes
 * `local-fixtures/feedback/<when>/{feedback.json,report.md}` — gitignored, like the owner's
 * diagnostics sessions, because a report carries a visitor's deck and run. Prints the share link
 * that reopens the visitor's plan and a short summary. Gift and pack ids are named against the
 * season the report came from when this checkout still has it.
 *
 * Local only.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadGameDataFromDisk } from '../src/core/data/node.ts';
import {
  decodePayload,
  feedbackReport,
  publicShareLink,
  reportFolderOf,
  type Names,
} from './lib/feedback-decode.ts';
import { repoPath } from './lib/io.ts';

function fail(message: string): never {
  console.error(`feedback-decode: ${message}`);
  process.exit(1);
}

function readInput(arg: string | undefined): string {
  if (!arg) fail('give the issue body as a file, or - to read stdin');
  if (arg === '-') return readFileSync(0, 'utf8');
  return readFileSync(resolve(arg), 'utf8');
}

function namesFor(season: number): Names {
  try {
    const data = loadGameDataFromDisk(undefined, season);
    const gifts = new Map(data.gifts.map((g) => [g.id, g.name.ko || g.name.en]));
    const packs = new Map(data.packs.map((p) => [p.id, p.name.ko || p.name.en]));
    return { gift: (id) => gifts.get(id), pack: (id) => packs.get(id) };
  } catch {
    console.warn(`feedback-decode: season ${season} is not in this checkout; ids are left unnamed`);
    return { gift: () => undefined, pack: () => undefined };
  }
}

function main(): void {
  const body = readInput(process.argv.slice(2).find((a) => a !== '--'));
  const result = decodePayload(body);
  if (!result.ok) fail(result.error);
  const { payload } = result;
  const dir = repoPath('local-fixtures', 'feedback', reportFolderOf(payload));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'feedback.json'), `${JSON.stringify(payload, null, 2)}\n`);
  writeFileSync(join(dir, 'report.md'), `${feedbackReport(payload, namesFor(payload.env.season))}\n`);
  const link = publicShareLink(payload);
  console.log(`feedback-decode: ${payload.kind} · ${payload.env.browser} · data ${payload.env.dataVersion}`);
  if (payload.state?.route)
    console.log(`  route: got ${payload.state.route.covered}/${payload.state.route.total}`);
  console.log(
    `  log: ${payload.log?.entries.length ?? 0} entries · diagnostics: ${payload.diagnostics?.total ?? 0}`,
  );
  if (link) console.log(`  plan: ${link}`);
  console.log(`  wrote ${dir}/{feedback.json,report.md}`);
}

main();
