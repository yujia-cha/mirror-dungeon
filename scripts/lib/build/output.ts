/**
 * The validate and write phases (M168).
 *
 * Everything the build is about to write is parsed through its schema first — the season files,
 * the shared files, the capture layout and the season index — and only when every parse passes
 * does a single write phase put the files on disk. Before M168 the script wrote as it went, so a
 * late failure (`capture-layout.json` was parsed *after* `gifts.json` was written) left a season
 * half on disk.
 */
import { existsSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ZodType } from 'zod';
import { readJson, writeJsonStable } from '../io.ts';
import {
  captureLayoutSchema,
  enumsSchema,
  giftsFileSchema,
  identitiesFileSchema,
  metaSchema,
  packsFileSchema,
  rulesSchema,
  seasonIndexSchema,
  type Enums,
  type Gift,
  type Identity,
  type Meta,
  type Rules,
  type SeasonEntry,
  type SeasonIndex,
  type ThemePack,
} from '../../../src/core/schema.ts';
import { fail } from './errors.ts';
import { withoutNotes } from './util.ts';

type CaptureLayout = ReturnType<typeof captureLayoutSchema.parse>;

/** What one build produces, before any of it touches the disk. */
export interface BuildOutput {
  dungeonId: number;
  meta: Meta;
  rules: Rules;
  gifts: Gift[];
  packs: ThemePack[];
  /** `md{n}/skill-gifts.json`, already formatted (one identity per line). */
  skillGiftsText: string;
  enums: Enums;
  identities: Identity[];
  /** `data/curated/capture-layout.json` as read; parsed (notes dropped) by `validateOutput`. */
  captureLayout: unknown;
}

/** `BuildOutput` after every schema parse, plus the index the write phase puts beside it. */
export interface ValidatedOutput extends Omit<BuildOutput, 'captureLayout'> {
  captureLayout: CaptureLayout;
  index: SeasonIndex;
}

function parseOrFail<T>(schema: ZodType<T>, value: unknown, file: string): T {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  const issues = parsed.error.issues
    .slice(0, 20)
    .map((issue) => `  ${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`);
  const more = parsed.error.issues.length - issues.length;
  return fail(
    `${file} does not match its schema; nothing was written:\n${issues.join('\n')}` +
      (more > 0 ? `\n  … and ${more} more` : ''),
  );
}

/**
 * `index.json` from the season directories already on disk — the frozen ones — and the season
 * being built, so the app can ask what exists instead of probing for directory names. The season
 * being built comes from memory: its files are not on disk yet.
 */
function seasonIndexFor(out: BuildOutput, outDir: string): SeasonIndex {
  const current = `md${out.dungeonId}`;
  const frozen: SeasonEntry[] = (existsSync(outDir) ? readdirSync(outDir) : [])
    .filter(
      (entry) => /^md\d+$/.test(entry) && entry !== current && statSync(join(outDir, entry)).isDirectory(),
    )
    .map((entry) => {
      const seasonMeta = metaSchema.parse(readJson(join(outDir, entry, 'meta.json')));
      const seasonRules = rulesSchema.parse(readJson(join(outDir, entry, 'rules.json')));
      return entryOf(seasonMeta, seasonRules);
    });
  const seasons = [...frozen, entryOf(out.meta, out.rules)].sort((a, b) => a.id - b.id);
  const newest = seasons[seasons.length - 1]!;
  // The app opens the newest season whose data is whole. A new season arrives knowing only half
  // of itself — no general gift pool — and a half-known season is something to step into on
  // purpose, not the page everyone lands on. It becomes the default the moment it is complete.
  const complete = seasons.filter((entry) => !entry.provisional);
  const opens = complete[complete.length - 1] ?? newest;
  return { default: opens.id, seasons };
}

function entryOf(meta: Meta, rules: Rules): SeasonEntry {
  return {
    id: meta.dungeon.id,
    name: meta.dungeon.name,
    dataVersion: meta.dataVersion,
    lastFloor: Math.max(...Object.values(rules.floors).flat()),
    provisional: meta.provisional,
  };
}

/** Every schema parse the build owes, with nothing written. Throws `BuildError` on the first miss. */
export function validateOutput(out: BuildOutput, outDir: string): ValidatedOutput {
  const season = `public/data/md${out.dungeonId}`;
  parseOrFail(metaSchema, out.meta, `${season}/meta.json`);
  parseOrFail(rulesSchema, out.rules, `${season}/rules.json`);
  parseOrFail(giftsFileSchema, out.gifts, `${season}/gifts.json`);
  parseOrFail(packsFileSchema, out.packs, `${season}/packs.json`);
  parseOrFail(enumsSchema, out.enums, 'public/data/enums.json');
  parseOrFail(identitiesFileSchema, out.identities, 'public/data/identities.json');
  // The screen tracker's layout (M103) is the game client's, not the dungeon's, so it is shared too.
  const captureLayout = parseOrFail(
    captureLayoutSchema,
    withoutNotes(out.captureLayout),
    'public/data/capture-layout.json',
  );
  const index = parseOrFail(seasonIndexSchema, seasonIndexFor(out, outDir), 'public/data/index.json');
  return { ...out, captureLayout, index };
}

/** The write phase: nothing here can fail for a reason the validate phase could have caught. */
export function writeOutput(out: ValidatedOutput, outDir: string): void {
  const seasonOut = join(outDir, `md${out.dungeonId}`);
  // What the season owns.
  writeJsonStable(join(seasonOut, 'meta.json'), out.meta);
  writeJsonStable(join(seasonOut, 'rules.json'), out.rules);
  writeJsonStable(join(seasonOut, 'gifts.json'), out.gifts);
  writeJsonStable(join(seasonOut, 'packs.json'), out.packs);
  writeFileSync(join(seasonOut, 'skill-gifts.json'), out.skillGiftsText, 'utf8');
  // What every season shares. Neither looks at the dungeon, so a frozen season keeps getting new
  // identities instead of going stale with the build that made it.
  writeJsonStable(join(outDir, 'enums.json'), out.enums);
  writeJsonStable(join(outDir, 'identities.json'), out.identities);
  writeJsonStable(join(outDir, 'capture-layout.json'), out.captureLayout);
  writeJsonStable(join(outDir, 'index.json'), out.index);
}

/** Validate, then write — the only order the build knows. */
export function validateAndWrite(out: BuildOutput, outDir: string): ValidatedOutput {
  const validated = validateOutput(out, outDir);
  writeOutput(validated, outDir);
  return validated;
}
