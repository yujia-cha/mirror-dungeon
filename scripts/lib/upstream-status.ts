/**
 * Has this week's patch reached our sources yet? The weekly routine asks this before it imports, so
 * it runs *after* the upstreams update rather than at a fixed hour that may come before them.
 *
 * The two living sources update in a fixed order on a patch Thursday (measured, KST):
 *
 * - localize (x1bViolet) commits the patch's text at 12:02–17:47, usually 12:0x, with the patch
 *   date in the message (`24.09.2026 Update [...]`).
 * - eldritchtools, which backfills identities the static data lacks, pushes after that: 15:34–17:11
 *   on the five identity patches from 7/9 to 9/24, sometimes with a late follow-up, once not until
 *   the next day (the 9/10 patch arrived Fri 15:33). Every push rewrites its `meta.json` datetime.
 * - OpenLethe's capture is frozen and has no say.
 *
 * So the patch has landed when localize committed since this week's Thursday (KST) and the mirror
 * pushed after that. The 2026-09-24 routine fired at 14:02, between the two, and imported 10917 as an
 * empty hand-written stub; the mirror had it at 15:45.
 *
 * Pure: the CLI (`scripts/upstream-status.ts`) gathers the facts, this decides.
 */

export const LOCALIZE_LANGS = ['KR', 'EN'] as const;
export type LocalizeLang = (typeof LOCALIZE_LANGS)[number];

/** Pinned commits: what `data/sources.lock.json` on some branch says we imported. */
export interface PinnedShas {
  localize: Record<LocalizeLang, string | null>;
  eldritchtools: string | null;
  openLethe: string | null;
}

export interface UpstreamFacts {
  now: Date;
  /** Upstream tips (null = unreachable). */
  heads: PinnedShas;
  /** Commit times (ISO) of each localize branch's recent commits, newest first. */
  localizeCommits: Record<LocalizeLang, string[] | null>;
  /** eldritchtools `meta.json` datetime at its tip (ISO), or null. */
  mirrorUpdatedAt: string | null;
  /** The lock on the branch being compared against (main). */
  lock: PinnedShas;
  /** The lock on this week's `data/weekly-<patch day>` branch, when that branch already exists. */
  todayBranchLock: PinnedShas | null;
}

export type UpstreamVerdict =
  /** This week's branch already carries these heads — this patch is imported. */
  | 'done'
  /** The lock already matches every head; there is nothing to import. */
  | 'up-to-date'
  /** Localize has not committed since this week's Thursday — no patch yet (or none this week). */
  | 'no-patch'
  /** One localize language has this week's patch, the other not yet. */
  | 'waiting-localize'
  /** Localize has the patch; the derived mirror has not pushed since. */
  | 'waiting-mirror'
  /** Both sources caught up with this week's patch: import now. */
  | 'ready'
  /** A source could not be reached, so nothing can be said. */
  | 'unreachable';

export interface UpstreamStatus {
  verdict: UpstreamVerdict;
  /** Today's date in KST, `YYYY-MM-DD`. */
  date: string;
  /** This week's patch day: the latest Thursday (KST) on or before today — the branch's suffix. */
  patchDay: string;
  branch: string;
  /**
   * No scheduled run comes after this one for this patch: Friday 17:00 KST or later, or any day
   * but Thursday and Friday (a manual run). A run that is not ready and not last just waits.
   */
  lastChance: boolean;
  /** Sources whose tip differs from the lock. */
  moved: string[];
  /** One human-readable line. */
  summary: string;
}

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** `YYYY-MM-DD` of an instant in KST. */
export function kstDate(at: Date | string): string {
  return new Date(new Date(at).getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** `MM-DD HH:MM` of an instant in KST, for the summary line. */
export function kstStamp(at: Date | string): string {
  return new Date(new Date(at).getTime() + KST_OFFSET_MS).toISOString().slice(5, 16).replace('T', ' ');
}

/** The patch day for `now`: the latest Thursday (KST) on or before it. */
export function patchDayOf(now: Date | string): string {
  const kst = new Date(new Date(now).getTime() + KST_OFFSET_MS);
  const back = (kst.getUTCDay() - 4 + 7) % 7;
  return new Date(kst.getTime() - back * 86_400_000).toISOString().slice(0, 10);
}

/** Whether no scheduled run for this week's patch comes after `now` (see `lastChance`). */
export function isLastChance(now: Date | string): boolean {
  const kst = new Date(new Date(now).getTime() + KST_OFFSET_MS);
  const day = kst.getUTCDay();
  if (day === 4) return false;
  if (day === 5) return kst.getUTCHours() >= 17;
  return true;
}

function pinnedEntries(p: PinnedShas): [string, string | null][] {
  return [
    ['localize KR', p.localize.KR],
    ['localize EN', p.localize.EN],
    ['eldritchtools', p.eldritchtools],
    ['openLethe', p.openLethe],
  ];
}

/** Heads that moved away from `pin`. An unknown head is not counted as moved. */
function movedFrom(heads: PinnedShas, pin: PinnedShas): string[] {
  const pinned = new Map(pinnedEntries(pin));
  return pinnedEntries(heads)
    .filter(([name, sha]) => sha !== null && sha !== pinned.get(name))
    .map(([name]) => name);
}

export function judgeUpstream(facts: UpstreamFacts): UpstreamStatus {
  const date = kstDate(facts.now);
  const patchDay = patchDayOf(facts.now);
  const branch = `data/weekly-${patchDay}`;
  const moved = movedFrom(facts.heads, facts.lock);
  const out = (verdict: UpstreamVerdict, summary: string): UpstreamStatus => ({
    verdict,
    date,
    patchDay,
    branch,
    lastChance: isLastChance(facts.now),
    moved,
    summary,
  });

  const unreachable = pinnedEntries(facts.heads)
    .filter(([, sha]) => sha === null)
    .map(([name]) => name);
  if (
    facts.heads.localize.KR === null ||
    facts.heads.localize.EN === null ||
    facts.heads.eldritchtools === null
  ) {
    return out('unreachable', `출처에 닿지 못함: ${unreachable.join(', ')}`);
  }

  if (facts.todayBranchLock && movedFrom(facts.heads, facts.todayBranchLock).length === 0) {
    return out('done', `이번 주 브랜치 ${branch}가 현재 출처를 이미 담고 있음`);
  }
  if (moved.length === 0) return out('up-to-date', 'lock이 모든 출처의 최신 커밋과 같음');

  // The earliest commit since the patch day, per language: a hotfix later on must not make an import
  // that already followed the patch look premature. Counting from Thursday rather than from today is
  // what lets the Friday runs see Thursday's patch (the mirror was a day late for the 9/10 patch).
  const firstToday = {} as Record<LocalizeLang, string | null>;
  for (const lang of LOCALIZE_LANGS) {
    const since = (facts.localizeCommits[lang] ?? [])
      .filter((t) => kstDate(t) >= patchDay)
      .sort((a, b) => Date.parse(a) - Date.parse(b));
    firstToday[lang] = since[0] ?? null;
  }
  const patched = LOCALIZE_LANGS.filter((lang) => firstToday[lang] !== null);
  const mirror = facts.mirrorUpdatedAt ? `미러 마지막 ${kstStamp(facts.mirrorUpdatedAt)}` : '미러 시각 모름';
  const movedLine = `움직인 출처: ${moved.join(', ')}`;

  if (patched.length === 0)
    return out('no-patch', `localize에 ${patchDay}(목) 이후 커밋 없음 · ${mirror} · ${movedLine}`);
  if (patched.length < LOCALIZE_LANGS.length) {
    return out('waiting-localize', `localize ${patched.join('·')}만 이번 패치 반영 · ${mirror}`);
  }

  // Both languages landed; the mirror must have pushed after the later of the two.
  const patchAt = LOCALIZE_LANGS.map((lang) => firstToday[lang]!).sort(
    (a, b) => Date.parse(a) - Date.parse(b),
  )[LOCALIZE_LANGS.length - 1]!;
  const localizeLine = `localize ${kstStamp(patchAt)} 갱신`;
  if (!facts.mirrorUpdatedAt || Date.parse(facts.mirrorUpdatedAt) < Date.parse(patchAt)) {
    return out('waiting-mirror', `${localizeLine} · ${mirror} — 미러가 아직 이 패치 이전`);
  }
  return out('ready', `${localizeLine} · 미러 ${kstStamp(facts.mirrorUpdatedAt)} 갱신 · ${movedLine}`);
}
