import { describe, expect, it } from 'vitest';
import type { SkillTrigger } from '../../src/core/schema.ts';
import { parseSkillTriggers } from './parse-skill-triggers.ts';

/** All Korean strings below are verbatim from the game's own gift text. */
function parse(ko: string) {
  return parseSkillTriggers({ ko, en: '' });
}

function triggers(ko: string) {
  return parse(ko).triggers;
}

/** The expected trigger, spelling out only the axes the case is about. */
function t(partial: Partial<SkillTrigger>): SkillTrigger {
  return {
    sin: null,
    attackType: null,
    keywords: [],
    verb: 'inflict',
    includesSpecial: false,
    factions: [],
    subject: 'skill',
    slots: [],
    effect: 'gate',
    ...partial,
  };
}

describe('parseSkillTriggers — one subject', () => {
  it('reads an attack type and calls a 「효과가 강화되어」 sentence a boost (9013 부적 묶음)', () => {
    expect(triggers('참격 스킬을 사용할 경우, 효과가 강화되어 [파열] 위력 4 부여')).toEqual([
      t({ sin: null, attackType: 'Slash', slots: [], effect: 'boost' }),
    ]);
  });

  it('reads a sin and calls a plain sentence a gate (9031 닉시 다이버전스)', () => {
    expect(triggers('질투 속성 스킬을 사용하여 적에게 적중 시, 대상에게 [진동] 위력 2 부여')).toEqual([
      t({ sin: 'ENVY', attackType: null, slots: [], effect: 'gate' }),
    ]);
  });

  it('accepts 「속성의」 and 「기본 공격」 wordings', () => {
    expect(triggers('탐식 속성의 스킬을 사용하여')).toEqual([
      t({ sin: 'GLUTTONY', attackType: null, slots: [], effect: 'gate' }),
    ]);
    expect(triggers('참격 기본 공격 스킬로 합 승리 시')).toEqual([
      t({ sin: null, attackType: 'Slash', slots: [], effect: 'gate' }),
    ]);
  });
});

describe('parseSkillTriggers — several subjects', () => {
  it('splits a 「또는」 list into one trigger each (9041 적색 지령)', () => {
    expect(triggers('우울 또는 분노 속성 공격 스킬을 보유한 아군의 경우, 효과가 강화되어')).toEqual([
      t({ sin: 'WRATH', attackType: null, slots: [], effect: 'boost' }),
      t({ sin: 'GLOOM', attackType: null, slots: [], effect: 'boost' }),
    ]);
  });

  it('splits a comma list into one trigger each (9194 짧은 케인 소드)', () => {
    expect(triggers('- 세븐 협회 소속 인격은 관통, 타격 기본 공격 스킬에도 효과 적용')).toEqual([
      t({ sin: null, attackType: 'Penetrate', slots: [], effect: 'boost' }),
      t({ sin: null, attackType: 'Hit', slots: [], effect: 'boost' }),
    ]);
  });

  it('keeps two clauses of one sentence apart (9019 끈적거리는 진액)', () => {
    expect(triggers('관통 스킬 또는 탐식 속성의 스킬을 사용하여 적에게 적중 시')).toEqual([
      t({ sin: 'GLUTTONY', attackType: null, slots: [], effect: 'gate' }),
      t({ sin: null, attackType: 'Penetrate', slots: [], effect: 'gate' }),
    ]);
  });

  it('narrows rather than lists when two words touch (9767 흑염 파이프)', () => {
    expect(triggers('오만 관통 스킬의 피해량 +(50/코인 수)%. (E.G.O 포함)')).toEqual([
      t({ sin: 'PRIDE', attackType: 'Penetrate', slots: [], effect: 'gate' }),
    ]);
  });
});

describe('parseSkillTriggers — slots', () => {
  it('reads a single slot (9195 구름무늬 호리병)', () => {
    expect(triggers('참격 유형인 스킬 1의 합 위력 +1, 적중 시 공격 레벨 감소 2 부여.')).toEqual([
      t({ sin: null, attackType: 'Slash', slots: [1], effect: 'gate' }),
    ]);
  });

  it('reads a slot run (9203 차원지각변환체, first paragraph alone)', () => {
    expect(triggers('타격 유형인 스킬 1, 스킬 2의 공격 레벨 +(코인 수-1) (최대 2)')).toEqual([
      t({ sin: null, attackType: 'Hit', slots: [1, 2], effect: 'gate' }),
    ]);
  });

  it('lets a later unrestricted mention swallow the slot limit (9203, whole text)', () => {
    const ko = [
      '타격 유형인 스킬 1, 스킬 2의 공격 레벨 +(코인 수-1) (최대 2)',
      '버림 스킬을 사용하여 자신의 스킬을 버렸다면, 다음 턴 시작 시 피해량 증가 1 얻음',
      '- 타격 유형 스킬을 버렸다면 효과가 강화되어, 타격 피해량 증가 1 추가로 얻음',
    ].join('\n');
    expect(triggers(ko)).toEqual([t({ sin: null, attackType: 'Hit', slots: [], effect: 'gate' })]);
  });
});

describe('parseSkillTriggers — what must not match', () => {
  it('ignores a sin or type that is not about a skill (9280 본국검보, 9001 지옥나비의 꿈)', () => {
    expect(triggers('적의 참격 내성이 1.5 이하인 경우, 참격 내성 +0.3')).toEqual([]);
    expect(triggers('분노 완전 공명을 발동하였다면 전투 시작 시')).toEqual([]);
    expect(triggers('타격 피해량 +10%')).toEqual([]);
  });

  it('keeps an ally clause that merely mentions the enemy (9016 초록빛 결실)', () => {
    expect(triggers('흐트러짐 상태가 아닌 적에게 탐식 속성 스킬을 사용하여 적중하였거나')).toEqual([
      t({ sin: 'GLUTTONY', attackType: null, slots: [], effect: 'gate' }),
    ]);
  });
});

describe('parseSkillTriggers — 편성 restrictions', () => {
  it.each([
    ['[편성 3번 인격 전용 효과]', [3]],
    ['[편성 1번, 2번 인격 전용 효과]', [1, 2]],
    ['[편성  5번, 6번 인격 전용 효과]', [5, 6]],
    ['[편성 1, 2, 7, 8번 인격 전용 효과]', [1, 2, 7, 8]],
    ['[편성 순서 2, 4번 인격 전용 효과]', [2, 4]],
    ['[편성 1번 전용 효과]', [1]],
    ['[1번 편성 전용 효과]', [1]],
  ])('reads %s', (ko, expected) => {
    expect(parse(ko).formationSlots).toEqual(expected);
  });

  it.each([
    '[라만차랜드 인격 전용 효과]',
    '[새벽 사무소 소속 인격 전용 효과]',
    '[검계 우두머리 뫼르소 전용 효과]',
    '[검지 소속 인격 전용 효과]',
  ])('leaves the identity/faction bracket %s alone', (ko) => {
    expect(parse(ko).formationSlots).toEqual([]);
  });
});

describe('parseSkillTriggers — shape', () => {
  it('reads the same thing through the game markup as without it', () => {
    const plain = '참격 스킬을 사용할 경우';
    expect(triggers(`<style="upgradeHighlight">${plain}</style>`)).toEqual(triggers(plain));
  });

  it('is deterministic', () => {
    const ko = '우울 또는 분노 속성 공격 스킬. 타격 유형인 스킬 1, 스킬 2. [편성 3번 인격 전용 효과]';
    expect(parse(ko)).toEqual(parse(ko));
  });
});

describe('parseSkillTriggers — keyword clauses', () => {
  it('reads the keyword, its slot and its 특수 flag (9734 E식 차원 단검)', () => {
    // Verbatim raw text: the buff id is still English here, because this parser runs BEFORE
    // `localizeBuffTokens`. Only the 특수 variant is spelled in Korean.
    expect(triggers('[Charge] 횟수 또는 특수 충전을 증가시키는 스킬 1의 합 위력 +1')).toEqual([
      t({ keywords: ['Charge'], includesSpecial: true, slots: [1] }),
    ]);
  });

  it('reads the same clause once the buff id has been localized', () => {
    expect(triggers('[충전] 횟수 또는 특수 충전을 증가시키는 스킬 1의 합 위력 +1')).toEqual([
      t({ keywords: ['Charge'], includesSpecial: true, slots: [1] }),
    ]);
  });

  it('tells 스킬 단위 from 인격 단위 (9215 붉은색 넥타이 vs 9728 회중시계)', () => {
    expect(triggers('[Combustion] 위력 또는 특수 화상을 부여하는 스킬 3의 합 위력 +2')).toEqual([
      t({ keywords: ['Combustion'], includesSpecial: true, slots: [3], subject: 'skill' }),
    ]);
    expect(triggers('[Vibration] 위력 또는 특수 진동을 부여하는 아군이 사용하는 스킬 3의 피해량 +25%')).toEqual([
      t({ keywords: ['Vibration'], includesSpecial: true, slots: [3], subject: 'identity' }),
    ]);
  });

  it('reads the verb, including the 「획득하거나 소모」 pair (9743, 9841)', () => {
    expect(triggers('[Charge] 횟수를 소모하는 스킬 3을 사용할 경우')).toEqual([
      t({ keywords: ['Charge'], verb: 'consume', slots: [3] }),
    ]);
    expect(triggers('[Charge] 횟수를 획득하거나 소모하는 스킬 1의 합 위력 +3')).toEqual([
      t({ keywords: ['Charge'], verb: 'any', slots: [1] }),
    ]);
    expect(triggers('자신의 [Charge] 횟수를 소모하거나 얻는 스킬 3 공격 종료 시')).toEqual([
      t({ keywords: ['Charge'], verb: 'any', slots: [3] }),
    ]);
  });

  it('leaves 특수 off when the sentence never says 또는 특수 X (9098 복주머니)', () => {
    // 부여 and 획득 are both ways of gaining, so the verb stays `inflict`; only a 소모 alongside
    // a gain makes it `any`.
    expect(
      triggers('[Breath] 위력 또는 [Breath] 횟수를 부여하거나 획득하는 인격이 사용하는 스킬 3의 최종 위력 +3'),
    ).toEqual([t({ keywords: ['Breath'], slots: [3], subject: 'identity' })]);
  });

  it('refuses a negated slot and keeps the positive one (9216 제식 복장 - 리우 협회)', () => {
    // Reading the first line would claim the gift buffs everything EXCEPT skill 3 — the opposite
    // of the second line. Only the second may produce a trigger.
    expect(
      triggers(
        '[Combustion] 위력 또는 특수 화상을 부여하는 스킬 3이 아닌 스킬의 피해량 +20%.\n' +
          '[Combustion] 위력 또는 특수 화상을 부여하는 스킬 3의 더하기 코인 위력 +1',
      ),
    ).toEqual([t({ keywords: ['Combustion'], includesSpecial: true, slots: [3] })]);
  });

  it('will not read a keyword that is a separate event from the slot (9771 근접 전술 교본)', () => {
    // 「[탄환]을 얻으면」 is when the gift fires; 「스킬 3」 is only what it lands on. Reading this as
    // 「탄환을 얻는 스킬 3」 would describe the gift backwards.
    expect(triggers('[Bullet]을 얻으면, 이번 턴과 다음 턴에 사용하는 스킬 3의 피해량 +50%')).toEqual([]);
  });

  it('keeps a keyword clause apart from a sin clause in the same gift (9734, whole text)', () => {
    expect(
      triggers(
        '[Charge] 횟수 또는 특수 충전을 증가시키는 스킬 1의 합 위력 +1, 피해량 +5%.\n' +
          'W사 소속 인격이 질투 속성 스킬로 적에게 피해를 입혔다면, 체력 회복 감소 2 부여',
      ),
    ).toEqual([
      t({ sin: 'ENVY' }),
      t({ keywords: ['Charge'], includesSpecial: true, slots: [1] }),
    ]);
  });
});

describe('parseSkillTriggers — 소속', () => {
  /** The real name→id map the build hands the parser. */
  const factions = new Map([
    ['약지', 'RING_FINGER'],
    ['신체파', 'RING_FINGER_PHYSICAL'],
    ['검계', 'BLADE_LINEAGE'],
    ['중지', 'MIDDLE_FINGER'],
    ['W사', 'W_CORP'],
    ['디에치 협회', 'DIECI'],
    ['흑운회', 'BLACK_CLOUD'],
    ['림버스 컴퍼니', 'LIMBUS_COMPANY'],
  ]);
  const withFactions = (ko: string) => parseSkillTriggers({ ko, en: '' }, { factionIdByName: factions }).triggers;

  it('gates both halves of an OR list on the 소속 (9223 범작)', () => {
    expect(
      withFactions('[영감]을 보유한 약지 소속 인격의 색욕 속성 또는 참격 속성 스킬이 적중한 적에게'),
    ).toEqual([
      t({ sin: 'LUST', factions: ['RING_FINGER'] }),
      t({ attackType: 'Slash', factions: ['RING_FINGER'] }),
    ]);
  });

  it('finds the 소속 when it follows the skill instead of leading it (9785 떼구름)', () => {
    expect(withFactions('참격 기본 공격 스킬을 보유한 흑운회 소속 인격이 턴 시작 시')).toEqual([
      t({ attackType: 'Slash', factions: ['BLACK_CLOUD'] }),
    ]);
  });

  it('reads 「이나」 as an OR list too (9258 앙갚음 장부)', () => {
    // The only place the game joins with 이나; a bare 「나」 is not a separator because it would
    // split 나태 in half.
    expect(withFactions('중지 소속 아군이 질투 속성이나 타격 속성 기본 스킬 공격 종료 시')).toEqual([
      t({ sin: 'ENVY', factions: ['MIDDLE_FINGER'] }),
      t({ attackType: 'Hit', factions: ['MIDDLE_FINGER'] }),
    ]);
  });

  it('reads a slot the 소속 alone qualifies (9720 낡은 도포)', () => {
    expect(withFactions('검계 소속일 경우 스킬 1의 코인 위력 +1')).toEqual([
      t({ slots: [1], factions: ['BLADE_LINEAGE'] }),
    ]);
  });

  it('keeps every slot of one 소속 clause together (9778 통상 작전용 장비)', () => {
    // One clause, two slots — reading only the first would tell a 림버스 컴퍼니 deck that its
    // 3스킬 does nothing.
    expect(
      withFactions('림버스 컴퍼니 소속 인격이 사용하는 스킬 2의 공격 레벨 +1, 피해량 +15%, 스킬 3의 공격 레벨 +2'),
    ).toEqual([t({ slots: [2, 3], factions: ['LIMBUS_COMPANY'] })]);
  });

  it('gives the extra types to the 소속 and leaves the base type alone (9202 포켓 암기 노트)', () => {
    expect(
      withFactions(
        '타격 기본 공격 스킬로 합 승리 시, 대상 적에게 다음 턴에 방어 레벨 감소 2 부여\n' +
          '- 디에치 협회 소속 인격은 참격, 관통 기본 공격 스킬에도 효과가 적용되고',
      ),
    ).toEqual([
      t({ attackType: 'Slash', factions: ['DIECI'] }),
      t({ attackType: 'Penetrate', factions: ['DIECI'] }),
      t({ attackType: 'Hit' }),
    ]);
  });

  it('will not read a 소속 that is only being counted (9841 C형 정리 요원 장비 세트)', () => {
    // 「W사 소속 인격 수 x 6.25」 scales the effect; it does not say whose skill 3 fires.
    expect(withFactions('- 턴 시작 시, 이번 턴 동안 스킬 3의 피해량 +(전투에 참여한 W사 소속 인격 수 x 6.25)%')).toEqual([]);
  });

  it('will not read a 소속 that is a threshold or a re-assignment', () => {
    // A threshold is a `Condition`; a re-assignment is prose about who counts as what.
    expect(withFactions('턴 시작 시, 검계 소속 인격이 3인 이상일 때 발동, 참격 스킬 공격 레벨 +2')).toEqual([
      t({ attackType: 'Slash' }),
    ]);
    expect(
      withFactions('검계 소속 인격을 제외한 편성 순서가 가장 빠른 S사 소속 인격 1인을 검계 소속으로 취급하고'),
    ).toEqual([]);
  });

  it('prefers the longer 소속 name when one contains another', () => {
    expect(withFactions('약지 신체파 소속 인격의 참격 스킬')).toEqual([
      t({ attackType: 'Slash', factions: ['RING_FINGER_PHYSICAL'] }),
    ]);
  });

  it('claims nothing when the 소속 name is unknown, rather than claiming it of everyone', () => {
    expect(withFactions('없는협회 소속일 경우 스킬 1의 코인 위력 +1')).toEqual([]);
  });
});
