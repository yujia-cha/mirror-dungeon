/**
 * Read-only questions to a remote git repository over plain HTTPS. The GitHub API is blocked in the
 * sandboxes this runs in, but `git ls-remote` and a commits-only fetch still get through.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function git(args: string[], cwd?: string): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    timeout: 60_000,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

/** The branch tip as git itself reports it: `git ls-remote` goes over plain HTTPS, no API token needed. */
export function shaFromGit(repo: string, ref: string): string | null {
  return tipOf(`https://github.com/${repo}.git`, ref);
}

/** The tip of `refs/heads/<ref>` on any remote (a URL or a configured remote name), or null. */
export function tipOf(remote: string, ref: string, cwd?: string): string | null {
  try {
    const sha = git(['ls-remote', remote, `refs/heads/${ref}`], cwd).split(/\s+/)[0];
    return sha && /^[0-9a-f]{40}$/.test(sha) ? sha : null;
  } catch {
    return null;
  }
}

export interface RemoteCommit {
  sha: string;
  /** Committer time, ISO 8601 in UTC. */
  committedAt: string;
  subject: string;
}

/**
 * The newest `depth` commits of a branch, newest first — commit objects only (`--filter=tree:0`), so
 * a week of history costs a few kilobytes whatever the repository's size. Null when unreachable.
 */
export function recentCommits(repo: string, ref: string, depth = 20): RemoteCommit[] | null {
  const dir = mkdtempSync(join(tmpdir(), 'upstream-'));
  try {
    git(['init', '-q', '--bare'], dir);
    git(
      [
        'fetch',
        '-q',
        `--depth=${depth}`,
        '--filter=tree:0',
        `https://github.com/${repo}.git`,
        `refs/heads/${ref}`,
      ],
      dir,
    );
    const out = git(['log', '--format=%H%x09%cI%x09%s', 'FETCH_HEAD'], dir);
    return out
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [sha = '', date = '', ...subject] = line.split('\t');
        return { sha, committedAt: new Date(date).toISOString(), subject: subject.join('\t') };
      });
  } catch {
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
