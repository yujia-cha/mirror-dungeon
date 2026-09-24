import { describe, expect, it } from 'vitest';
import {
  isLastChance,
  judgeUpstream,
  kstDate,
  patchDayOf,
  type PinnedShas,
  type UpstreamFacts,
} from './upstream-status.ts';

const OLD: PinnedShas = { localize: { KR: 'kr0', EN: 'en0' }, eldritchtools: 'el0', openLethe: 'ol0' };
const NEW: PinnedShas = { localize: { KR: 'kr1', EN: 'en1' }, eldritchtools: 'el1', openLethe: 'ol0' };

/** The 2026-09-24 patch as it actually landed: localize 13:09 KST, the mirror 15:45 KST. */
function sept24(nowKst: string, overrides: Partial<UpstreamFacts> = {}): UpstreamFacts {
  return {
    now: new Date(`${nowKst}+09:00`),
    heads: NEW,
    localizeCommits: {
      KR: ['2026-09-24T04:09:00Z', '2026-09-18T15:52:00Z'],
      EN: ['2026-09-24T04:10:00Z', '2026-09-18T15:53:00Z'],
    },
    mirrorUpdatedAt: '2026-09-22T19:02:00Z',
    lock: OLD,
    todayBranchLock: null,
    ...overrides,
  };
}

describe('judgeUpstream', () => {
  it('waits for the mirror at 14:02, where the old fixed-hour routine imported 10917 as a stub', () => {
    const status = judgeUpstream(sept24('2026-09-24T14:02:00'));
    expect(status.verdict).toBe('waiting-mirror');
    expect(status.branch).toBe('data/weekly-2026-09-24');
    expect(status.summary).toContain('09-24 13:10');
  });

  it('is ready once the mirror pushed after the patch', () => {
    const status = judgeUpstream(sept24('2026-09-24T16:00:00', { mirrorUpdatedAt: '2026-09-24T06:46:08Z' }));
    expect(status.verdict).toBe('ready');
    expect(status.moved).toEqual(['localize KR', 'localize EN', 'eldritchtools']);
  });

  it('does not let a later hotfix make a finished mirror look stale', () => {
    const status = judgeUpstream(
      sept24('2026-09-24T21:00:00', {
        mirrorUpdatedAt: '2026-09-24T06:46:08Z',
        localizeCommits: {
          KR: ['2026-09-24T11:35:00Z', '2026-09-24T04:09:00Z'],
          EN: ['2026-09-24T11:35:00Z', '2026-09-24T04:10:00Z'],
        },
      }),
    );
    expect(status.verdict).toBe('ready');
  });

  it('keeps waiting on Thursday when the mirror is a day late, as it was for the 9/10 patch', () => {
    const status = judgeUpstream(
      sept24('2026-09-10T17:00:00', {
        localizeCommits: { KR: ['2026-09-10T03:04:00Z'], EN: ['2026-09-10T03:05:00Z'] },
        mirrorUpdatedAt: '2026-09-07T16:42:00Z',
      }),
    );
    expect(status.verdict).toBe('waiting-mirror');
    // Thursday 17:00 is not the last run any more: Friday repeats the same hours.
    expect(status.lastChance).toBe(false);
  });

  it('picks the 9/10 patch up on Friday, on the same branch as Thursday', () => {
    const status = judgeUpstream(
      sept24('2026-09-11T16:00:00', {
        localizeCommits: { KR: ['2026-09-10T03:04:00Z'], EN: ['2026-09-10T03:05:00Z'] },
        mirrorUpdatedAt: '2026-09-11T06:34:00Z',
      }),
    );
    expect(status.verdict).toBe('ready');
    expect(status.patchDay).toBe('2026-09-10');
    expect(status.branch).toBe('data/weekly-2026-09-10');
  });

  it('is done on Friday when Thursday already imported the patch', () => {
    const status = judgeUpstream(sept24('2026-09-25T12:00:00', { todayBranchLock: NEW }));
    expect(status.verdict).toBe('done');
    expect(status.branch).toBe('data/weekly-2026-09-24');
  });

  it('waits when only one localize language has landed', () => {
    const status = judgeUpstream(
      sept24('2026-09-24T12:03:00', {
        localizeCommits: { KR: ['2026-09-24T03:02:00Z'], EN: ['2026-09-18T15:53:00Z'] },
      }),
    );
    expect(status.verdict).toBe('waiting-localize');
  });

  it('says there is no patch when localize has not committed today', () => {
    const status = judgeUpstream(sept24('2026-10-01T12:00:00'));
    expect(status.verdict).toBe('no-patch');
  });

  it('is up to date when the lock already has every head', () => {
    expect(judgeUpstream(sept24('2026-09-24T16:00:00', { lock: NEW })).verdict).toBe('up-to-date');
  });

  it('is done when today’s branch already carries the heads, even before it is merged', () => {
    const status = judgeUpstream(sept24('2026-09-24T17:00:00', { todayBranchLock: NEW }));
    expect(status.verdict).toBe('done');
  });

  it('re-imports when the heads moved past today’s branch (a follow-up push)', () => {
    const status = judgeUpstream(
      sept24('2026-09-24T17:00:00', {
        todayBranchLock: { ...NEW, eldritchtools: 'el-earlier' },
        mirrorUpdatedAt: '2026-09-24T07:30:00Z',
      }),
    );
    expect(status.verdict).toBe('ready');
  });

  it('refuses to judge when a living source is unreachable', () => {
    const status = judgeUpstream(sept24('2026-09-24T16:00:00', { heads: { ...NEW, eldritchtools: null } }));
    expect(status.verdict).toBe('unreachable');
  });
});

describe('patchDayOf / isLastChance', () => {
  it('counts the week from Thursday in KST', () => {
    expect(patchDayOf('2026-09-24T03:00:00Z')).toBe('2026-09-24'); // Thu 12:00
    expect(patchDayOf('2026-09-25T08:00:00Z')).toBe('2026-09-24'); // Fri 17:00
    expect(patchDayOf('2026-09-30T14:00:00Z')).toBe('2026-09-24'); // Wed 23:00
    expect(patchDayOf('2026-09-23T15:30:00Z')).toBe('2026-09-24'); // Thu 00:30 KST, Wed in UTC
  });

  it('keeps waiting until the last Friday run', () => {
    expect(isLastChance('2026-09-24T08:00:00Z')).toBe(false); // Thu 17:00
    expect(isLastChance('2026-09-25T07:00:00Z')).toBe(false); // Fri 16:00
    expect(isLastChance('2026-09-25T08:00:00Z')).toBe(true); // Fri 17:00
    expect(isLastChance('2026-09-28T01:00:00Z')).toBe(true); // Mon — a manual run
  });
});

describe('kstDate', () => {
  it('turns the day over at midnight KST, not UTC', () => {
    expect(kstDate('2026-09-23T14:59:59Z')).toBe('2026-09-23');
    expect(kstDate('2026-09-23T15:00:00Z')).toBe('2026-09-24');
  });
});
