import { describe, expect, it } from 'vitest';
import { parseConditions, resolveFaction, stripMarkup, type ParseContext } from './parse-conditions.ts';

const factions = new Map<string, string>([
  ['검계', 'BLADE_LINEAGE'],
  ['흑운회', 'BLACK_CLOUD'],
  ['중지', 'MIDDLE_FINGER'],
  ['약지', 'RING_FINGER'],
  ['엄지', 'THUMB_FINGER'],
  ['피쿼드호', 'PEQUOD_CREW'],
  ['새벽 사무소', 'DAWN'],
  ['림버스 컴퍼니', 'LIMBUS_COMPANY'],
  ['세븐 협회', 'SEVEN'],
]);

const ctx: ParseContext = { factionIdByName: factions };

/** All Korean strings below are verbatim from the game's own gift text. */
function parse(ko: string, en = '') {
  return parseConditions({ ko, en }, ctx).conditions;
}

describe('stripMarkup', () => {
  it('removes the Unity rich-text tags the game ships inside effect text', () => {
    expect(stripMarkup('<noparse>새벽 사무소</noparse> 소속')).toBe('새벽 사무소 소속');
    expect(stripMarkup('합 위력 <style="upgradeHighlight">+1</style>')).toBe('합 위력 +1');
    expect(stripMarkup('<color=#f8c200>중지 소속</color>')).toBe('중지 소속');
  });
});

describe('keyword conditions', () => {
  it('counts identities whose attack skills inflict the keyword', () => {
    const [c] = parse(
      '턴 시작 시, [Combustion] 횟수 또는 특수 화상을 부여하는 공격 스킬을 보유한 인격이 5인 이상이면, ' +
        '이번 전투 동안 발동 (E.G.O 스킬 제외. 대기 인원 제외)',
    );
    expect(c).toMatchObject({
      type: 'keywordSkillCount',
      keywords: ['Combustion'],
      min: 5,
      scope: 'deployed',
      includesSpecial: true,
    });
  });

  it('handles the "위력, 횟수" wording and a tiered second threshold', () => {
    const [c] = parse(
      '턴 시작시, [Sinking] 위력, 횟수를 부여하는 공격 스킬을 보유한 인격이 6인 이상이면 아래 효과 적용\n' +
        '[Sinking]을 부여하는 공격 스킬을 보유한 인격이 10인 이상이면 효과가 강화됨',
    );
    expect(c).toMatchObject({ type: 'keywordSkillCount', keywords: ['Sinking'], min: 6 });
    expect(c && 'tiers' in c ? c.tiers : []).toEqual([{ min: 10, label: '10인 이상' }]);
  });

  it('recognises the "획득하는" form used by Breath and Charge', () => {
    expect(
      parse('[Charge] 횟수 또는 특수 충전을 획득하는 공격 스킬을 보유한 인격이 5인 이상')[0],
    ).toMatchObject({
      type: 'keywordSkillCount',
      keywords: ['Charge'],
      min: 5,
    });
    expect(parse('[Breath] 횟수를 부여하거나 획득하는 공격 스킬을 보유한 인격이 5인 이상')[0]).toMatchObject({
      type: 'keywordSkillCount',
      keywords: ['Breath'],
      min: 5,
    });
  });

  it('marks includesSpecial false when the clause does not mention the 특수 variant', () => {
    const [c] = parse('[Vibration] 횟수를 부여하는 공격 스킬을 보유한 인격이 5인 이상');
    expect(c).toMatchObject({ includesSpecial: false });
  });

  it('ignores bracketed ids that are no identity keyword', () => {
    // An identity-specific buff nobody's deck can be counted for.
    expect(
      parse('[BloodArmorCasting]을 소모하는 스킬을 보유한 인격이 3인 이상이면').every(
        (c) => c.type !== 'keywordSkillCount',
      ),
    ).toBe(true);
  });

  it('reads the 소모 form, with no 「공격」 in the sentence', () => {
    // 9795 떨어진 한 방울. 혈찬 is spent by a skill, not inflicted on anyone.
    const [c] = parse('턴 시작 시, [BloodDinner]을 소모하는 스킬을 보유한 인격이 3인 이상이면, 이번 전투 동안 발동 (E.G.O 스킬 제외. 대기 인원 제외)');
    expect(c).toMatchObject({ type: 'keywordSkillCount', keywords: ['BloodDinner'], verb: 'consume', min: 3, scope: 'deployed' });
  });

  it('reads a two-keyword gate, either of them counting', () => {
    // 9802 전격부, whose steps sit on their own lines under the gate.
    const [c] = parse(
      '[Burst], [Charge]을 부여하거나 획득하는 공격 스킬을 보유한 인격이 편성된 수에 따라 기프트 효과 강화 (E.G.O 스킬 제외, 편성 인원 포함).\n\n- 6인 이상\n\n- 8인 이상',
    );
    expect(c).toMatchObject({ type: 'keywordSkillCount', keywords: ['Burst', 'Charge'], verb: 'inflict', min: 6, scope: 'formation' });
    expect((c as { tiers: { min: number }[] }).tiers.map((t) => t.min)).toEqual([8]);
  });

  it('reads 「얻거나 소모하는 인격이」, which names no skill at all', () => {
    // 9235 데스페라도. The smallest step is the bar the gift needs to do anything.
    const [c] = parse(
      '[Bullet]을 얻거나 소모하는 인격이 편성된 수에 따라 기프트 효과 강화 (E.G.O 스킬 제외, 편성 인원 포함)\n\n- 2인 이상\n\n- 5인 이상\n\n- 8인 이상',
    );
    expect(c).toMatchObject({ type: 'keywordSkillCount', keywords: ['Bullet'], verb: 'consume', min: 2, scope: 'formation' });
    expect((c as { tiers: { min: number }[] }).tiers.map((t) => t.min)).toEqual([5, 8]);
  });

  it('leaves min null when 「편성된 수에 따라」 lists no step', () => {
    // 9842. The gift is always on and only scales, so there is no bar — a count, not a gate.
    const [c] = parse('[BloodDinner]을 소모하는 공격 스킬을 보유한 인격이 편성된 수에 따라 기프트 효과 강화 (E.G.O 스킬 제외. 편성 인원 포함)');
    expect(c).toMatchObject({ type: 'keywordSkillCount', keywords: ['BloodDinner'], verb: 'consume', min: null, scope: 'formation', tiers: [] });
  });
});

describe('faction conditions', () => {
  it('reads a single faction with the deployed-only scope', () => {
    const [c] = parse('턴 시작 시, 검계 소속 인격이 3인 이상일 때 발동 (출격 인원을 기준으로 함)');
    expect(c).toMatchObject({ type: 'factionCount', factions: ['BLADE_LINEAGE'], min: 3, scope: 'deployed' });
  });

  it('treats 편성된 / 대기 인원 포함 as the whole 12-slot formation', () => {
    const [c] = parse('편성된 피쿼드호 소속 인격이 3인 이상일 때 발동 (대기 인원 포함)');
    expect(c).toMatchObject({ type: 'factionCount', factions: ['PEQUOD_CREW'], min: 3, scope: 'formation' });
  });

  it('treats 대기 인원에 as a reserve-only count', () => {
    const [c] = parse(
      '대기 인원에 림버스 컴퍼니 소속 인격이 4명 이상이면, 턴 시작 시 무작위 아군 둘이 강화됨',
    );
    expect(c).toMatchObject({ type: 'factionCount', factions: ['LIMBUS_COMPANY'], min: 4, scope: 'reserve' });
  });

  it('accepts an "A 또는 B" pair as one condition over both factions', () => {
    const [c] = parse(
      '전투에 참여한 인격 중 검계 또는 흑운회 소속이 4인 이상일 경우 (출격 인원을 기준으로 함)',
    );
    expect(c).toMatchObject({ type: 'factionCount', min: 4 });
    expect(c && 'factions' in c ? [...c.factions].sort() : []).toEqual(['BLACK_CLOUD', 'BLADE_LINEAGE']);
  });

  it('strips noparse tags around a faction name', () => {
    const [c] = parse('턴 시작시, <noparse>새벽 사무소</noparse> 소속 인격이 3인 이상일 때 발동');
    expect(c).toMatchObject({ type: 'factionCount', factions: ['DAWN'], min: 3 });
  });

  it('drops leading words the greedy capture swallows', () => {
    const [c] = parse('턴 시작 시 중지 소속 인격이 3인 이상이면 효과가 강화됨');
    expect(c).toMatchObject({ type: 'factionCount', factions: ['MIDDLE_FINGER'], min: 3 });
  });

  it('records a stepped faction threshold as a tier', () => {
    const [c] = parse(
      '중지 소속 인격이 사용하는 기본 스킬의 기본 위력 +1\n- 턴 시작 시 중지 소속 인격이 3인 이상이면, 대신 피해량 증가\n- 5인 이상이면, 대신 기본 위력 +2',
    );
    expect(c).toMatchObject({ type: 'factionCount', factions: ['MIDDLE_FINGER'], min: 3 });
    expect(c && 'tiers' in c ? c.tiers : []).toEqual([{ min: 5, label: '5인 이상' }]);
  });

  it('reports an unrecognised faction name instead of inventing an id', () => {
    const conditions = parse('없는협회 소속 인격이 3인 이상일 때 발동');
    expect(conditions).toHaveLength(1);
    expect(conditions[0]!.type).toBe('unparsed');
  });
});

describe('other clauses', () => {
  it('reads a full-resonance requirement', () => {
    expect(parse('전투 시작 시 완전 공명이 7 이상이면, 모든 아군이 최종 위력 +5')[0]).toMatchObject({
      type: 'fullResonance',
      min: 7,
    });
  });

  it('keeps a threshold sentence it cannot model as unparsed', () => {
    const conditions = parse('키가 3인 이상인 인격이 있으면, 이번 전투 동안 발동');
    expect(conditions).toHaveLength(1);
    expect(conditions[0]).toMatchObject({ type: 'unparsed' });
  });

  it('returns nothing for text without a threshold', () => {
    expect(parse('턴 종료 시, 모든 아군이 체력을 10 회복한다.')).toEqual([]);
  });

  it('does not duplicate the same condition stated twice', () => {
    const conditions = parse(
      '검계 소속 인격이 3인 이상일 때 발동 (출격 인원을 기준으로 함)\n검계 소속 인격이 3인 이상일 때 발동 (출격 인원을 기준으로 함)',
    );
    expect(conditions).toHaveLength(1);
  });
});

describe('resolveFaction', () => {
  it('prefers the longest matching suffix', () => {
    const byName = new Map([
      ['세븐 협회', 'SEVEN'],
      ['협회', 'GENERIC'],
    ]);
    expect(resolveFaction('남부 세븐 협회', byName)).toBe('SEVEN');
  });

  it('matches a name written without the localization spacing', () => {
    expect(resolveFaction('새벽사무소', factions)).toBe('DAWN');
  });

  it('returns null for an unknown name', () => {
    expect(resolveFaction('없는협회', factions)).toBeNull();
  });
});
