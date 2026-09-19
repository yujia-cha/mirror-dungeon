import { describe, expect, it } from 'vitest';
import { parseSkillTriggers } from './parse-skill-triggers.ts';

/** All Korean strings below are verbatim from the game's own gift text. */
function parse(ko: string) {
  return parseSkillTriggers({ ko, en: '' });
}

function triggers(ko: string) {
  return parse(ko).triggers;
}

describe('parseSkillTriggers — one subject', () => {
  it('reads an attack type and calls a 「효과가 강화되어」 sentence a boost (9013 부적 묶음)', () => {
    expect(triggers('참격 스킬을 사용할 경우, 효과가 강화되어 [파열] 위력 4 부여')).toEqual([
      { sin: null, attackType: 'Slash', slots: [], effect: 'boost' },
    ]);
  });

  it('reads a sin and calls a plain sentence a gate (9031 닉시 다이버전스)', () => {
    expect(triggers('질투 속성 스킬을 사용하여 적에게 적중 시, 대상에게 [진동] 위력 2 부여')).toEqual([
      { sin: 'ENVY', attackType: null, slots: [], effect: 'gate' },
    ]);
  });

  it('accepts 「속성의」 and 「기본 공격」 wordings', () => {
    expect(triggers('탐식 속성의 스킬을 사용하여')).toEqual([
      { sin: 'GLUTTONY', attackType: null, slots: [], effect: 'gate' },
    ]);
    expect(triggers('참격 기본 공격 스킬로 합 승리 시')).toEqual([
      { sin: null, attackType: 'Slash', slots: [], effect: 'gate' },
    ]);
  });
});

describe('parseSkillTriggers — several subjects', () => {
  it('splits a 「또는」 list into one trigger each (9041 적색 지령)', () => {
    expect(triggers('우울 또는 분노 속성 공격 스킬을 보유한 아군의 경우, 효과가 강화되어')).toEqual([
      { sin: 'WRATH', attackType: null, slots: [], effect: 'boost' },
      { sin: 'GLOOM', attackType: null, slots: [], effect: 'boost' },
    ]);
  });

  it('splits a comma list into one trigger each (9194 짧은 케인 소드)', () => {
    expect(triggers('- 세븐 협회 소속 인격은 관통, 타격 기본 공격 스킬에도 효과 적용')).toEqual([
      { sin: null, attackType: 'Penetrate', slots: [], effect: 'boost' },
      { sin: null, attackType: 'Hit', slots: [], effect: 'boost' },
    ]);
  });

  it('keeps two clauses of one sentence apart (9019 끈적거리는 진액)', () => {
    expect(triggers('관통 스킬 또는 탐식 속성의 스킬을 사용하여 적에게 적중 시')).toEqual([
      { sin: 'GLUTTONY', attackType: null, slots: [], effect: 'gate' },
      { sin: null, attackType: 'Penetrate', slots: [], effect: 'gate' },
    ]);
  });

  it('narrows rather than lists when two words touch (9767 흑염 파이프)', () => {
    expect(triggers('오만 관통 스킬의 피해량 +(50/코인 수)%. (E.G.O 포함)')).toEqual([
      { sin: 'PRIDE', attackType: 'Penetrate', slots: [], effect: 'gate' },
    ]);
  });
});

describe('parseSkillTriggers — slots', () => {
  it('reads a single slot (9195 구름무늬 호리병)', () => {
    expect(triggers('참격 유형인 스킬 1의 합 위력 +1, 적중 시 공격 레벨 감소 2 부여.')).toEqual([
      { sin: null, attackType: 'Slash', slots: [1], effect: 'gate' },
    ]);
  });

  it('reads a slot run (9203 차원지각변환체, first paragraph alone)', () => {
    expect(triggers('타격 유형인 스킬 1, 스킬 2의 공격 레벨 +(코인 수-1) (최대 2)')).toEqual([
      { sin: null, attackType: 'Hit', slots: [1, 2], effect: 'gate' },
    ]);
  });

  it('lets a later unrestricted mention swallow the slot limit (9203, whole text)', () => {
    const ko = [
      '타격 유형인 스킬 1, 스킬 2의 공격 레벨 +(코인 수-1) (최대 2)',
      '버림 스킬을 사용하여 자신의 스킬을 버렸다면, 다음 턴 시작 시 피해량 증가 1 얻음',
      '- 타격 유형 스킬을 버렸다면 효과가 강화되어, 타격 피해량 증가 1 추가로 얻음',
    ].join('\n');
    expect(triggers(ko)).toEqual([{ sin: null, attackType: 'Hit', slots: [], effect: 'gate' }]);
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
      { sin: 'GLUTTONY', attackType: null, slots: [], effect: 'gate' },
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
