import { describe, expect, it } from 'vitest';
import { deriveIdentityKeywordsFromText, keywordsInSkillText, looksLikeAttackSkill } from './derive-text.ts';
import type { IdentityKeywordId } from '../../src/core/schema.ts';
import type { LocalizedSkill } from './raw.ts';

/** A skill with one level; `coins` become one coin each, as the localization writes them. */
const skill = (id: number, desc: string, ...coins: string[]): LocalizedSkill => ({
  id,
  levelList: [{ level: 1, desc, coinlist: coins.map((c) => ({ coindescs: [{ desc: c }] })) }],
});

const variants = new Map<string, IdentityKeywordId>([
  ['ChargeBodyArt', 'Charge'],
  ['NailPersonality', 'Laceration'],
  ['MeursaultSporeBulletLong', 'Bullet'],
]);

const base = (s: LocalizedSkill) => [...keywordsInSkillText(s, variants).base].sort();
const special = (s: LocalizedSkill) => [...keywordsInSkillText(s, variants).special].sort();

describe('keywordsInSkillText', () => {
  it('counts a keyword the text says is inflicted, by token or by its Korean name', () => {
    expect(base(skill(1000101, '', '[OnSucceedAttack] [Burst] 1 부여'))).toEqual(['Burst']);
    // Older skills write the name with no bracket token at all.
    expect(base(skill(1000101, '[OnSucceedAttack] 진동 4 부여'))).toEqual(['Vibration']);
    // Gaining a count on oneself is how 충전 is written, and it counts too.
    expect(base(skill(1000101, '', '[OnSucceedAttack] 자신의 [Charge] 횟수 6 증가'))).toEqual(['Charge']);
  });

  it('ignores a keyword that is spent, merely named, or only one option of several', () => {
    expect(base(skill(1000101, '[WhenUse] 자신의 [Charge] 횟수를 2 소모하여, 코인 위력 +1'))).toEqual([]);
    expect(base(skill(1000101, '[BeforeUse] 자신의 [Charge] 횟수가 15 이상이면 발동'))).toEqual([]);
    // An enumeration offers a choice; naming a keyword there is not inflicting it.
    expect(base(skill(1000101, '[Combustion], [Laceration], [Sinking] 중 무작위 1개의 횟수 2 증가'))).toEqual(
      [],
    );
  });

  it('reads the markup out before matching, so a highlighted level does not hide the grant', () => {
    expect(base(skill(1000101, '', '[OnSucceedAttack] [Burst] <style="highlight">2</style> 부여'))).toEqual([
      'Burst',
    ]);
  });

  it('keeps 특수 variants apart from the base keyword', () => {
    expect(special(skill(1000101, '', '[OnSucceedAttack] [ChargeBodyArt] 1 부여'))).toEqual(['Charge']);
    expect(base(skill(1000101, '', '[OnSucceedAttack] [ChargeBodyArt] 1 부여'))).toEqual([]);
    expect(special(skill(1000101, '[OnSucceedAttack] [NailPersonality] 2 부여'))).toEqual(['Laceration']);
  });

  it('reads 탄환 from the token alone, because it is spent rather than inflicted', () => {
    expect(base(skill(1000101, '[WhenUse] [BulletLament] 1 소모'))).toEqual(['Bullet']);
    expect(special(skill(1000101, '[WhenUse] [MeursaultSporeBulletLong] 1 소모'))).toEqual(['Bullet']);
  });
});

describe('looksLikeAttackSkill', () => {
  it('leaves out the defense slot, which the game never lists as an attack', () => {
    expect(looksLikeAttackSkill(skill(1011604, '[StartBattle] …'))).toBe(false);
    expect(looksLikeAttackSkill(skill(1011601, '[OnSucceedAttack] [Burst] 1 부여'))).toBe(true);
  });

  it('leaves out a counter, a guard or an evasion follow-up wherever its slot sits', () => {
    expect(looksLikeAttackSkill(skill(1011605, '[DuelCounter] …'))).toBe(false);
    expect(looksLikeAttackSkill(skill(1011605, '[CanDuelGuard] …'))).toBe(false);
    expect(looksLikeAttackSkill(skill(1011605, '[OnSucceedEvade] …'))).toBe(false);
  });
});

describe('deriveIdentityKeywordsFromText', () => {
  it('counts the attack skills that inflict each keyword', () => {
    const skills = [
      skill(1011601, '', '[OnSucceedAttack] [Burst] 1 부여', '[OnSucceedAttack] 자신의 [Charge] 횟수 6 증가'),
      skill(1011602, '', '[OnSucceedAttack] [Burst] 2 부여'),
      skill(1011604, '[StartBattle] [Burst] 1 부여'), // the defense slot never counts
    ];
    expect(deriveIdentityKeywordsFromText(skills, variants)).toEqual({
      Burst: { skills: 2, specialSkills: 0 },
      Charge: { skills: 1, specialSkills: 0 },
    });
  });

  it('does not call a 특수 ammo identity an ordinary 탄환 user because of its reload state', () => {
    const skills = [
      skill(1051401, '[WhenUse] [MeursaultSporeBulletLong] 1 소모'),
      // The reload buff is undeclared, but it belongs to the 포자탄 family, not to plain ammo.
      skill(1051403, '[WhenUse] [MeursaultSporeBulletReloading] 1 얻음'),
    ];
    expect(deriveIdentityKeywordsFromText(skills, variants)).toEqual({
      Bullet: { skills: 0, specialSkills: 1 },
    });
  });

  it('still reads plain 탄환, whose ids carry no family prefix', () => {
    const skills = [
      skill(1061101, '[WhenUse] [Bullet] 1 소모'),
      skill(1061102, '[WhenUse] [BulletLament] 1 소모'),
    ];
    expect(deriveIdentityKeywordsFromText(skills, variants)).toEqual({
      Bullet: { skills: 2, specialSkills: 0 },
    });
  });
});
