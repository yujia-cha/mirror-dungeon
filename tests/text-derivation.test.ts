// @vitest-environment node
//
// The pipeline readers resolve the repo root from `import.meta.url`, which is not a file URL under
// jsdom; this suite reads data/raw straight off disk like the scripts do.
/**
 * Calibration for `scripts/lib/derive-text.ts`.
 *
 * The keywords of 10116 「LCE E.G.O:: 차원찢개」 cannot be derived the normal way — upstream ships no
 * static record for it — so they are read out of the official localized skill text instead. That is
 * only trustworthy if the same reading reproduces what the static data says for the identities that
 * have both, so this runs it over all of them and pins the result.
 *
 * Coverage is partial and stated as such: the localization mirror ships skill text for 121 of the
 * 183 identities that have static data (the oldest few per sinner have none anywhere), so this is a
 * calibration, not a proof over the whole roster.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { identitiesFileSchema, type IdentityKeywordId } from '../src/core/schema.ts';
import { deriveIdentityKeywords, type IdentityKeywordCounts } from '../scripts/lib/derive.ts';
import {
  deriveIdentityKeywordsFromText,
  identityIdOfSkill,
  skillsOfIdentity,
} from '../scripts/lib/derive-text.ts';
import {
  readLocalizedPersonalitySkills,
  readPersonalities,
  readPersonalitySkills,
  readSpecialVariants,
  STATIC_DIR,
} from '../scripts/lib/raw.ts';
import {
  derivedAttackSkillIds,
  derivedKeywords,
  readDerivedIdentities,
} from '../scripts/lib/derived-source.ts';

const identities = identitiesFileSchema.parse(
  JSON.parse(readFileSync(resolve(process.cwd(), 'public/data/identities.json'), 'utf8')),
);

const hasRaw = existsSync(STATIC_DIR) && existsSync(resolve(process.cwd(), 'data/raw/localize/KR'));

/**
 * What actually reaches the planner. `deck.ts` counts one identity per keyword however many of its
 * skills inflict it, and only looks at whether each half is above zero, so the exact per-skill
 * counts are noise: calibrating on them would chase differences no route can see.
 */
type Projection = Record<string, [base: boolean, special: boolean]>;
const project = (counts: IdentityKeywordCounts): Projection =>
  Object.fromEntries(
    Object.entries(counts).map(([keyword, value]) => [keyword, [value.skills > 0, value.specialSkills > 0]]),
  );

/**
 * Identities whose text says less than their static data does, with the reason.
 *
 * Every one of these is the text missing something, never inventing it — the keyword is inflicted
 * by a named buff that the sentence never spells out in Korean. Chasing them would cost the
 * precision that makes the 10116 reading worth trusting, so they are pinned instead.
 */
const KNOWN_DIVERGENCES: Record<number, string> = {
  10110: '진동: 버프 id로만 부여하고 문장에 이름이 없다',
  10115: '화상: 같은 이유',
  10212: '호흡: 같은 이유',
  10312: '충전: 같은 이유',
  10412: '호흡: 같은 이유',
  10406: '탄환: 탄환 버프 id가 대괄호 토큰으로 적히지 않는다',
  11207: '탄환: 같은 이유',
  10215: '충전: 생체 재료(특수 충전)만 읽고 기본 충전을 놓친다 — 스크립트 이름 경로에 대응하는 문장이 없다',
  10614: '충전: 같은 이유',
};

describe.skipIf(!hasRaw)('text derivation, calibrated against the static data', () => {
  const variants = readSpecialVariants();
  const statics = readPersonalities();
  const staticSkills = readPersonalitySkills();
  const localized = readLocalizedPersonalitySkills('KR');
  const derivedSource = readDerivedIdentities();
  const covered = new Set([...localized.keys()].map(identityIdOfSkill));
  const calibratable = statics.filter((p) => covered.has(p.id));

  const fromText = (id: number): IdentityKeywordCounts =>
    deriveIdentityKeywordsFromText(skillsOfIdentity(id, localized), variants);

  it('covers most of the roster, and says so rather than pretending to cover all of it', () => {
    expect(calibratable.length).toBeGreaterThanOrEqual(115);
    expect(calibratable.length).toBeLessThanOrEqual(statics.length);
  });

  it('never claims a keyword the static data does not have', () => {
    const invented = calibratable
      .map((p) => {
        const truth = deriveIdentityKeywords(p, staticSkills, variants);
        const extra = Object.keys(fromText(p.id)).filter((keyword) => !(keyword in truth));
        return extra.length > 0 ? `${p.id}: ${extra.join(', ')}` : null;
      })
      .filter((entry): entry is string => entry !== null);
    // The one-sided property is what earns the right to publish 10116's keywords from text alone.
    expect(invented).toEqual([]);
  });

  it('reproduces what the planner reads, except for a pinned list of text that says less', () => {
    const diverging = calibratable
      .filter((p) => {
        const truth = project(deriveIdentityKeywords(p, staticSkills, variants));
        return JSON.stringify(truth) !== JSON.stringify(project(fromText(p.id)));
      })
      .map((p) => p.id)
      .sort((a, b) => a - b);
    // Set equality both ways: a new identity drifting fails, and so does a pinned one that starts
    // agreeing, so the list cannot rot.
    expect(diverging).toEqual(
      Object.keys(KNOWN_DIVERGENCES)
        .map(Number)
        .sort((a, b) => a - b),
    );
  });

  // The audit trail for every identity the static data does not ship: what the app serves has to be
  // what the official Korean text says, not what anyone typed. The build reads the attack-skill list
  // off the derived mirror rather than guessing, so this passes the same list in.
  it.each([
    [10116, { Burst: { skills: 4, specialSkills: 0 }, Charge: { skills: 4, specialSkills: 0 } }],
    [10616, { Combustion: { skills: 3, specialSkills: 0 }, Breath: { skills: 3, specialSkills: 0 } }],
  ])('derives %i from the skill text, exactly as it ships', (id, expected) => {
    const entry = derivedSource.get(id as number);
    const derived = deriveIdentityKeywordsFromText(
      skillsOfIdentity(id as number, localized),
      variants,
      entry ? derivedAttackSkillIds(entry) : undefined,
    );
    expect(derived).toEqual(expected);
    const shipped = identities.find((identity) => identity.id === id);
    expect(shipped?.keywords).toEqual(
      derived as Record<IdentityKeywordId, { skills: number; specialSkills: number }>,
    );
    expect(shipped?.keywordSource).toBe('backfilled');
  });

  it('agrees with the derived mirror on what the backfilled identities inflict', () => {
    for (const id of [10116, 10616]) {
      const entry = derivedSource.get(id)!;
      const theirs = derivedKeywords(entry);
      const ours = new Set(Object.keys(identities.find((i) => i.id === id)!.keywords));
      // Two independent readings of the same patch: the Korean sentence and an English data dump.
      expect([...ours].sort()).toEqual([...theirs].sort());
    }
  });
});
