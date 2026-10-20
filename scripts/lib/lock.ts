/**
 * `data/sources.lock.json`, read in one place (M160, D4).
 *
 * The lock pins every upstream the pipeline vendors: which repository, which commit (one per
 * source, or one per language branch), where its files come from and go to, and which files. Eight
 * scripts used to declare their own slice of its shape; this is the whole of it, as a zod schema,
 * so a lock that does not say what a script assumes stops that script with a message instead of an
 * `undefined` somewhere downstream.
 *
 * `readLock` validates and then returns the object as `JSON.parse` made it — not zod's copy — so
 * `data:fetch -- --update`, which writes the lock back, keeps the hand-written key order, and keys
 * this schema does not know (`$comment`, a note someone adds) survive the round trip.
 */
import { z } from 'zod';
import { readJson, readJsonIfExists, repoPath } from './io.ts';

/** The raw file host every pinned download goes through. */
export const RAW = 'https://raw.githubusercontent.com';

/** `owner/name` as GitHub spells it — nothing a URL would read as a path above the repository. */
const repoSchema = z.string().regex(/^[\w.-]+\/[\w.-]+$/, 'a GitHub repository is `owner/name`');
/** A full commit id. */
const shaSchema = z.string().regex(/^[0-9a-f]{40}$/, 'a pinned sha is 40 hex digits');

/** One language of a source whose upstream keeps languages on branches. */
export const lockLanguagePinSchema = z.object({ ref: z.string().min(1), sha: shaSchema });

/**
 * One file of a source: a bare path is fetched for every language the source lists; an object
 * narrows it to some of them.
 */
export const lockFileSchema = z.union([
  z.string().min(1),
  z.object({ path: z.string().min(1), languages: z.array(z.string()).optional() }).loose(),
]);

export const lockSourceSchema = z
  .object({
    repo: repoSchema,
    /** The revision for a single-language source. Sources with per-language branches use `languages`. */
    ref: z.string().min(1).optional(),
    sha: shaSchema.optional(),
    fetchedAt: z.string(),
    note: z.string().optional(),
    remotePrefix: z.string(),
    localPrefix: z.string(),
    /**
     * The languages to fetch. An array means one revision serves them all and the language is a
     * path segment; a map gives each language its own branch.
     */
    languages: z.union([z.array(z.string()), z.record(z.string(), lockLanguagePinSchema)]).optional(),
    files: z.array(lockFileSchema),
  })
  .loose();

export const lockSchema = z
  .object({
    $comment: z.string().optional(),
    /** The Mirror Dungeon season the snapshot is declared to hold. */
    mirrorDungeonSeason: z.number().int().positive().optional(),
    sources: z.record(z.string(), lockSourceSchema),
  })
  .loose();

export type Lock = z.infer<typeof lockSchema>;
export type LockSource = z.infer<typeof lockSourceSchema>;
export type LockFile = z.infer<typeof lockFileSchema>;
export type LockLanguagePin = z.infer<typeof lockLanguagePinSchema>;

export const LOCK_PATH = repoPath('data/sources.lock.json');

/** Validate a parsed lock and hand back the very object given (see the file comment). */
export function parseLock(raw: unknown, label = 'data/sources.lock.json'): Lock {
  const result = lockSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(
      `${label} does not match lockSchema:\n` +
        result.error.issues
          .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
          .join('\n'),
    );
  }
  return raw as Lock;
}

/** The lock on disk, validated. Throws when it is missing or malformed. */
export function readLock(path = LOCK_PATH): Lock {
  return parseLock(readJson(path));
}

/** The lock on disk, validated, or null when there is none. */
export function readLockIfExists(path = LOCK_PATH): Lock | null {
  const raw = readJsonIfExists(path);
  return raw === null ? null : parseLock(raw);
}

/** The path a file entry names, whichever form it takes. */
export function lockFilePath(file: LockFile): string {
  return typeof file === 'string' ? file : file.path;
}

/** The language names a source fetches, or null for a source with none. */
export function lockLanguages(source: LockSource): string[] | null {
  if (!source.languages) return null;
  return Array.isArray(source.languages) ? source.languages : Object.keys(source.languages);
}
