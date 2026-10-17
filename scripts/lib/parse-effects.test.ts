import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  giftGrantedBuffs,
  normalizeRequirements,
  parseEffects,
  readCuratedGiftEffects,
  splitEffectBlocks,
  type EffectContext,
} from './parse-effects.ts';
import type { SingleRequirement } from '../../src/core/schema.ts';

/** All Korean strings below are verbatim from the game's own gift text (raw, buff ids unlocalized). */
const TEXT = {
  9009: '[Combustion] 위력 또는 특수 화상을 부여하는 스킬 또는 색욕 속성의 스킬을 사용하여 적에게 적중 시, 대상에게 [Combustion] 위력 3 부여.\n\n턴 시작 시 [Combustion] 위력 20 이상을 보유한 적의 경우, [Combustion] 위력이 2배로 증가.',
  9088: '턴 시작 시, [Combustion] 위력, [Combustion] 횟수 또는 특수 화상을 부여하는 공격 스킬을 보유한 인격이 5인 이상이면, 이번 전투 동안 발동 (E.G.O 스킬 제외. 대기 인원 제외)\n\n턴 시작 시, 모든 적(환상체일 경우, 모든 부위)의 [Combustion] 횟수가 6 증가하고 [Combustion] 위력 15를 무작위로 나누어 부여. (웨이브 당 최대 1회)\n\n[Combustion] 위력, [Combustion] 횟수 또는 특수 화상을 부여하는 더하기 코인 스킬의 최종 위력 +1, 코인 위력 +1, [Combustion] 위력 부여 값 +1, [Combustion] 횟수 부여 값 +1.\n- 빼기 코인 스킬일 경우, 코인 위력 대신 기본 위력 +(4/코인 수) (최소 1, 소수점 버림)\n\n[Combustion] 위력, 횟수, 특수 화상을 부여하는 스킬로 합 승리 시, (남은 코인 수 + 1)만큼 대상 적에게 [Combustion] 위력을 부여',
  9206: '전투 시작 전 체력이 가장 낮은 아군이 [Laceration] 또는 특수 출혈을 부여하는 공격 스킬 적중 시, 최대 체력 3%만큼 체력 회복 (턴당 2회)\n\n[Laceration] 또는 특수 출혈을 부여하는 스킬로 [Laceration] 또는 특수 출혈을 보유한 적과 합을 진행할 때, 합 위력 +1\n- [Laceration] 또는 특수 출혈을 부여하는 공격 스킬을 보유한 인격이 5인 이상이면, 대신 합 위력 +1, 피해량 +10% (편성 인원 포함)\n- 10인 이상이면, 대신 합 위력 +2, 피해량 +15%',
  9214: '적에게 [VibrationIgnition]이 있을 경우 다음 효과 적용\n- 기본 스킬 적중 시 [Combustion] 위력 1 부여 (스킬당 최대 3회)\n- 기본 스킬 적중 시 [VibrationIgnition]이 15 이상이면, [Combustion] 횟수 1 증가 (스킬당 최대 2회)\n- [Combustion] 3당, [VibrationExplosion]로 인한 흐트러짐 손상 +1% (최대 15%)',
  9215: '[Combustion] 위력 또는 [Combustion] 횟수 또는 특수 화상을 부여하는 스킬 3의 합 위력 +2, 피해량 +30%',
  9224: '약지 소속 인격이 [Inspire]을 얻음\n\n[Inspire]을 보유한 약지 소속 인격의 공격 스킬이 적중한 적에게 [ObjectOfExploration] 부여\n- 적이 [ObjectOfExploration]를 이미 보유했을 시, [ObjectOfExploration]이 [PaintingMaterial]로 교체됨\n\n[PaintingMaterial]가 있는 대상을 [Inspire]을 보유한 약지 소속 인격이 처치했으면,\n해당 약지 소속 인격이 [Inspire]을 잃고 [GreatAesthetics]을 얻음',
  9235: '[Bullet]을 얻거나 소모하는 인격이 편성된 수에 따라 기프트 효과 강화 (E.G.O 스킬 제외, 편성 인원 포함)\n\n- 2인 이상\n[Bullet]을 얻거나 소모하는 스킬 사용 시 다음 턴에 [Agility] 2, [AttackUp] 4 얻음 (인격별로 턴당 1회)\n\n- 5인 이상\n[Bullet]을 얻거나 소모하는 인격이 사용하는 스킬의 합 위력 +1, 피해량 +10%\n[Bullet]을 얻거나 소모하는 스킬의 피해량 +(100/코인 수)%\n[Bullet]을 전부 소모했으면, 다음 턴 시작 시 [Bullet] 4 얻음 (인격 별로 전투 당 1회)\n\n- 8인 이상\n턴 시작 시 [Bullet]을 얻거나 소모하는 인격에게 [DesperadoBuff] 1 부여\n• 이전 턴에 [Bullet]을 소모하지 않았으면, [DesperadoBuff] 1 추가 부여\n전투 종료 시 무작위 적 1명에게 (아군이 보유한 모든 [DesperadoBuff]의 합 x 3)만큼 관통 피해를 입힘 (최대 30)\n• 이후, 이 효과를 (편성된 수 - 1)만큼 반복함',
  9255: '적에게 [Vibration] 위력, [Vibration] 횟수 또는 특수 진동을 부여하는 기본 스킬로 합 승리시 아래 특수 <noparse>진동</noparse> 중 무작위 특수 <noparse>진동</noparse>으로 [FusionVibration] (턴당 최대 1회)\n- [VibrationIgnition]\n- [VibrationBleeding]\n- [VibrationEcho]\n- [VibrationCollapse]\n- [VibrationChainPersonality]',
  9256: '아군이 사용하는 스킬의 코인 위력 +(8/ 코인 수) (더하기 코인 적용), 최종 위력 +(8 / 코인 수) (빼기 코인 적용) (최소 증가 값 1, 소수점 <noparse>버림</noparse>, E.G.O 스킬 포함)\n\n[편성 1번 인격 전용 효과]\n- 합 진행 시 매 합마다 자신이 [LookingFutureMirror] 1 얻음. 대상에게 [Vibration]과 [Combustion] 2 부여 (스킬당 최대 10회)\n- 합 승리 시 메인 타겟에게 [VibrationIgnition]로 [Switch_Vibration]하고, [VibrationExplosion]. 대상의 [Vibration] 횟수 1 감소',
  9271: '흑수 - 묘 소속 인격이 스테이지에 첫 등장 시 1턴동안 속도 최솟값이 10으로 유지됨 (속도 최솟값이 10 이상이면, 이 효과는 발동하지 않음)\n\n자신에게 [LegStrength]가 있으면, 기본 스킬의 합 위력 +1, 피해량 +10%',
  9273: '사망한 아군 인격 1명당, 모든 아군의 공격 레벨 1, 방어 레벨 1 증가 (최대 10)\n\n거미집의 검 료슈가 덱에 편성되어 있으면, 거미집의 검 료슈 이외의 인격이 사망할 시 전투 종료 후 부활이 발동하지 않음 (보스층, 히든 노드 클리어)\n\n[편성 1번 인격 전용 효과]\n\n턴 시작 시 자신을 제외한 모든 아군이 사망했을 경우, [RedButterfly] 얻음\n\n[거미집의 검 료슈 전용 효과]\n\n스테이지에 첫 등장 시 사망한 거미집 소속 아군 인격 1명당, [PhantomIncisionTotalID] 5 얻음\n사망한 거미집 소속 아군 인격 2명당, 최종 위력 +1, 코인 위력 +1, 가하는 피해량 10% (각각 최대 3, 30%)\n거미집의 검 료슈 외에 생존한 아군이 없으면, 모든 선택지 보정 +12',
  9702: '스킬로 적에게 [Burst] 부여 시 [Burst] 횟수 3 증가 (턴 당 최대 3회)',
  9767: '[1번 편성 전용 효과]\n\n매 턴마다 [Enhancement] 2, [Vulnerable] 1 얻음\n\n메인 공격 대상의 방어 레벨이 감소한 상태면, 공격 전에 [Breath] 5 얻음\n\n오만 관통 스킬의 피해량 +(50/코인 수)%. (E.G.O 포함)',
  9773: '[Burst] 횟수를 부여하는 기본 공격 스킬로 적과 합 승리 시, 대상의 [Burst] 횟수 3 증가. (적 별로 턴 당 2회)\n\n적중 시 대상 적에게 [Burst]이 없으면, [Burst] 위력을 부여하는 코인 효과가 [Burst] 위력을 부여하는 대신 [Burst] 횟수를 부여 (최대 4, 적 별로 턴 당 2회, 환상체일 경우 부위 별로 계산)\n\n[Burst] 위력 또는 [Burst] 횟수를 부여하는 기본 공격 스킬이 각 스킬의 보유량만큼 공격 레벨이 증가 (최대 3).\n- 해당 스킬의 보유량이 3개 이상인 경우, 공격 레벨이 2만큼 추가로 증가.',
  9829: '타격 유형 기본 스킬의 코인 위력 +1, 중지 소속 인격은 효과가 강화되어 코인 위력 +2\n아군 피격 시 다음 턴에 모든 아군이 [AttackUp] 2 얻음 (턴 당 최대 3회)\n\n아래 효과는 전투 내 중지 소속 인격이 3인 이상일 때 추가로 발동.\n전투 시작 시 질투 공명 수 만큼 [Enhancement] 1 얻음, [Protection] 1 얻음 (최대 3)\n중지 소속 인격이 질투 속성 기본 스킬을 사용할 때 [SuperCoin]으로 변경되며, 받는 피해량이 50% 감소,\n이번 턴과 다음 턴에 [HitDamageUp] 2 얻음',
  9012: '타격 스킬 또는 나태 속성 스킬로 공격 종료시 적이 사망했으면, 해당 아군이 이번 턴을 제외한 다음 턴부터 2턴 동안 타격 스킬 위력 +2.',
  9043: '분노 완전 공명을 발동하였거나 [Charge] 횟수 또는 특수 충전을 획득하거나 부여하는 스킬을 사용할 경우, 다음 턴 시작 시 모든 아군이 [Charge] 횟수 3 증가 (턴 당 1회 발동).',
  9058: '턴 시작 시, 이전 턴에 사용한 탐식 속성 이외의 E.G.O 스킬 횟수 만큼 무작위 E.G.O 자원 +1.\n\n탐식 속성 E.G.O 스킬을 사용할 경우, 효과가 강화되어 사용한 탐식 속성 E.G.O 스킬 횟수 만큼 무작위 E.G.O 자원 +3.',
  9105: '[Combustion] 위력, [Combustion] 횟수 또는 특수 화상을 부여하는 E.G.O 스킬 사용 시 발동\n\n소모하는 (분노 E.G.O 자원 +나머지 E.G.O 자원의 합/3)만큼 최종 위력이 증가, 피해량 +50%\n\n분노 속성 E.G.O 스킬의 경우, 효과가 강화되어 공격 시작 전에 [Combustion] 횟수를 추가로 부여(E.G.O 등급에 비례하며 ZAYIN의 경우 2, 등급이 오를수록 +1)하고 피해량 +(공격 가중치/공격 대상 수x20)%',
  9164: '턴 시작 시, 자신의 [Vibration] 횟수가 8 이상이면 합 위력 +1\n\n자신의 [Vibration] 횟수를 소모하는 스킬로 적을 처치하거나 흐트러짐 상태로 만들었으면, (소모한 [Vibration] 횟수 / 4)만큼 자신의 [Vibration] 횟수 증가 (스킬당 1회)',
  9166: '턴 시작 시, [Vibration] 위력 또는 [Vibration] 횟수를 부여하는 공격 스킬을 보유한 인격이 5인 이상이면, 이번 전투 동안 발동 (E.G.O 스킬 제외. 대기 인원 제외. 인격이 스스로 [Vibration] 횟수를 얻는 경우에는 발동 x)\n\n자신의 [Vibration] 횟수를 소모한 스킬로 합 승리시, 대상에게 [Vibration] 이 없다면 대상의 [Vibration] 횟수 3 증가\n\n턴 시작 시 합 위력이 (자신의 [Vibration] 횟수/5)만큼 증가. (최대 3)\n\n자신의 [Vibration] 횟수를 소모하는 스킬을 사용했을 때, 적 처치 혹은 흐트러짐 상태로 만들경우 (소모한 [Vibration] 횟수 / 2)만큼 자신의 [Vibration] 횟수 증가  (스킬당 1회)',
  9167: '턴 시작 시, [Vibration] 위력, [Vibration] 횟수 또는 특수 진동을 부여하는 공격 스킬을 보유한 인격이 5인 이상이면, 이번 전투 동안 발동 (E.G.O 스킬 제외. 대기 인원 제외. 인격이 스스로 [Vibration] 횟수를 얻는 경우에는 발동 x)\n\n[Vibration] 위력 또는 [Vibration] 횟수를 부여하거나 자신의 [Vibration] 횟수를 소모하는 스킬로 합 승리 시 남은 코인만큼 대상에게 [Vibration] 위력 부여. 자신의 진동 횟수 증가 (스킬당 자신의 진동 횟수 최대 3 증가). 대상에게 [Vibration]이 없으면, 대상의 [Vibration] 횟수 3 증가.\n\n턴 시작 시 [ParryingResultUp]를 1 + (자신의 [Vibration] 횟수/5)만큼 얻음. (최대 3)\n\n자신의 [Vibration] 횟수를 소모하는 스킬을 사용했을 때, 적 처치 혹은 흐트러짐 상태로 만들경우 (소모한 [Vibration] 횟수 / 2)만큼 자신의 [Vibration] 횟수 증가 (스킬당 1회)\n\n스킬의 피해량 +(자신이 소모한 [Vibration] 횟수 + 적이 보유한 [Vibration] 위력 + 5)% (E.G.O 스킬 제외, 최대 50%)\n대상에게 [VibrationNesting]이 있을 때, 그 대상에게 중첩되지 않은 유형의 [Vibration]으로 [Switch_Vibration], [FusionVibration]을 사용하면, 턴 종료 시 대상이 보유한 [VibrationNesting]을 다음 턴까지 연장함',
  9201: '[편성 3번 인격 전용 효과]\n\n타격 스킬 공격 레벨 +(보유한 타격 기본 공격 스킬 수) (동일한 스킬은 하나로 계산, 최대 3).\n\n스킬을 사용하여 적 공격 시 다른 스킬을 [Discard]하였다면, 타격 피해량 +(10+버린 스킬의 등급 x5)% (가장 높은 등급으로 계산, 최대 25%).',
  9202: '타격 기본 공격 스킬로 합 승리 시, 대상 적에게 다음 턴에 방어 레벨 감소 2 부여 (인격 별로 턴 당 1회, 동일한 적에게 중첩 불가).\n- 디에치 협회 소속 인격은 참격, 관통 기본 공격 스킬에도 효과가 적용되고 방어 레벨 감소 1 추가로 부여\n\n디에치 협회 소속 인격이 버림 스킬을 사용하여 자신의 스킬을 버렸다면, 다음 턴 시작 시 버린 스킬의 등급만큼 공격 레벨 증가 얻음 (가장 높은 등급으로 계산, 최대 3).',
  9203: '타격 유형인 스킬 1, 스킬 2의 공격 레벨 +(코인 수-1) (최대 2)\n- 버림 효과가 있는 스킬일 경우 효과가 강화되어, 공격 레벨 +(코인 수) (최대 4)\n\n버림 스킬을 사용하여 자신의 스킬을 버렸다면, 다음 턴 시작 시 피해량 증가 1, 버린 스킬의 등급만큼 공격 레벨 증가 얻음 (인격 별로 턴 당 1회 적용되며 가장 높은 등급으로 계산, 최대 3).\n- 타격 유형 스킬을 버렸다면 효과가 강화되어, 타격 피해량 증가 1 추가로 얻음',
  9221: '질투 속성 스킬 또는 반격 스킬 적중 시 [Laceration] 횟수 또는 [Combustion] 횟수 1 증가 (턴당 3회)\n\n전투 중 적의 [Laceration] 횟수가 1 아래로 떨어질 때, 해당 적이 보유한 [Combustion] 횟수가 2 이상이면, [Laceration] 횟수 대신 [Combustion] 횟수 감소 (턴당 3회)',
  9223: '약지 소속 인격이 [Inspire]을 얻음\n\n[Inspire]을 보유한 약지 소속 인격의 색욕 속성 또는 참격 속성 스킬이 적중한 적에게 다음 턴에 [ObjectOfExploration] 부여\n- 적이 [ObjectOfExploration]를 이미 보유했을 시, [ObjectOfExploration]이 [PaintingMaterial]로 교체됨\n\n[PaintingMaterial]가 있는 대상을 [Inspire]을 보유한 약지 소속 인격이 처치했으면, 다음 턴에 [PlusCoinValueUp] 1 얻음 (턴당 1회)',
  9258: '아군이 사용하는 스킬의 코인 위력 +(8/ 코인 수) (더하기 코인 적용), 최종 위력 +(8 / 코인 수) (빼기 코인 적용) (최소 증가 값 1, 소수점 <noparse>버림</noparse>, E.G.O 스킬 포함)\n\n스테이지 시작시 전장에 있는 중지 소속 아군 1명당 모든 아군이 보호막 50씩 얻음 (대기 인원 미포함, 이 효과로 획득한 보호막은 턴 종료시에도 사라지지 않음)\n\n 중지 소속 아군이 질투 속성이나 타격 속성 기본 스킬 공격 종료 시 입힌 스킬 피해량의 10%만큼 체력 회복\n- 반격 스킬로 발동했을 경우, 대신 입힌 스킬 피해량의 20%만큼 체력 회복\n- 초과된 체력 회복량은 보호막으로 획득함 (이 효과로 획득한 보호막은 턴 종료시에도 사라지지 않음)\n\n전투 시작시, 장착한 수비 스킬 수만큼 해당 턴 동안 중지 소속 아군의 공격 레벨이 증가 (최대 12)\n- 장착한 수비 스킬 수가 6 이상이면, 질투 속성 기본 스킬 피해량 +30%, 초과한 수비 스킬 수만큼 추가로 +10% (최대 추가 증가량 60%)',
  9291: '[편성 순서 1번 인격 전용 효과]\n\n시지프 소속 인격 또는 [PersonalityCharge]의 기본 스킬의 마지막 코인 적중 시 메인 타겟에게 해당 코인 최종 피해량의 5%만큼 참격 피해를 줌 (스킬당 1회)',
  9733: '아군이 자신의 공격 스킬 효과로 체력을 잃었다면, 다음 턴 시작 시 해당 스킬 효과로 잃은 체력 수치의 절반만큼 회복 (버림하여 처리).\n\n아군이 E.G.O 스킬 효과로 체력을 회복할 때, 체력 회복 효과가 12.5%만큼 증가 (버림하여 처리).',
  9819: '스테이지 첫 턴 시작 시, 자신에게 [Combustion]을 부여하는 기본 공격 스킬을 보유한 인격이 [Combustion] 5를 얻고, 정신력 8 회복\n\n흑수-유 소속 인격이 유지 또는 회복 가능한 최대 체력의 상한선이 49%로 고정되는 대신 받는 피해량과 자신이 받는 회복량이 50% 감소 (E.G.O 기프트로 인한 회복 제외)',
  9117: '[편성 1번, 2번 인격 전용 효과]\n\n턴 종료 시 이번 턴에 [Burst] 위력 또는 [Burst] 횟수를 부여하는 공격 스킬을 한 번이라도 사용하였다면, 다음 턴에 [Agility] 1 얻음.\n\n자신의 속도가 6 이상이면, [Burst] 위력 또는 [Burst] 횟수를 부여하는 공격 스킬의 피해량 +12.5%',
} as const;

const ctx: EffectContext = {
  factionIdByName: new Map([
    ['흑수 - 묘', 'BLACK_BEAST_RABBIT'],
    ['중지', 'MIDDLE_FINGER'],
    ['약지', 'RING_FINGER'],
    ['거미집', 'SPIDER_HOUSE'],
    ['검계', 'BLADE_LINEAGE'],
    ['흑운회', 'BLACK_CLOUD'],
    ['디에치 협회', 'DIECI'],
    ['시지프', 'SISYPHE'],
    ['흑수 - 유', 'BLACK_BEAST_CHICKEN'],
  ]),
  grantedBuffs: giftGrantedBuffs(Object.values(TEXT)),
  identities: [
    { id: 10415, title: '거미집의 검', sinner: '료슈' },
    { id: 10310, title: '라만차랜드 실장', sinner: '돈키호테' },
  ],
};

const parse = (text: string) => parseEffects(text, ctx);
const BURN_S3 = { type: 'skillKeyword', keywords: ['Combustion'], includesSpecial: true, slot: 3 } as const;

describe('splitEffectBlocks', () => {
  it('starts an effect at every non-bullet line and keeps bullets with the line above', () => {
    const blocks = splitEffectBlocks('가\n- 나\n다\n\n- 라\n· 마');
    expect(blocks.map((b) => [b.head, b.bullets])).toEqual([
      ['가', ['- 나']],
      ['다', []],
      ['- 라', ['· 마']],
    ]);
  });

  it('lists each 「- 」 line under a bare exclusive heading as an effect of its own', () => {
    const blocks = splitEffectBlocks(TEXT[9256]);
    const starts = ['아군이 사용하는', '[편성 1번 인격 전용 효과]', '- 합 진행 시', '- 합 승리 시'];
    expect(blocks).toHaveLength(starts.length);
    blocks.forEach((b, n) => expect(b.head.startsWith(starts[n]!), b.head).toBe(true));
    expect(blocks.every((b) => b.bullets.length === 0)).toBe(true);
  });
});

describe('giftGrantedBuffs', () => {
  it('counts a numbered or bare grant and a replacement, not a trigger or a conversion', () => {
    const granted = giftGrantedBuffs(Object.values(TEXT));
    expect(granted.has('DesperadoBuff')).toBe(true); // 「[DesperadoBuff] 1 부여」
    expect(granted.has('Inspire')).toBe(true); // 「[Inspire]을 얻음」
    expect(granted.has('PaintingMaterial')).toBe(true); // 「…이 [PaintingMaterial]로 교체됨」
    // 「무작위 특수 진동으로 [FusionVibration]」, 「[VibrationIgnition]로 [Switch_Vibration]」: conversions.
    expect(granted.has('VibrationIgnition')).toBe(false);
    expect(granted.has('LegStrength')).toBe(false);
    // Status keywords are never in the set.
    expect(granted.has('Combustion')).toBe(false);
  });
});

describe('parseEffects — the examples the owner checked', () => {
  it('9215 붉은색 넥타이: a burn skill in slot 3, 특수 included', () => {
    expect(parse(TEXT[9215]).effects).toEqual([{ kind: 'effect', requires: [BURN_S3] }]);
  });

  it('9271 흑수환 - 묘: the faction, then the identity buff 각력【묘】', () => {
    expect(parse(TEXT[9271]).effects).toEqual([
      { kind: 'effect', requires: [{ type: 'faction', factions: ['BLACK_BEAST_RABBIT'] }] },
      { kind: 'effect', requires: [{ type: 'identityBuff', buffs: ['LegStrength'] }] },
    ]);
  });

  it('9702 목이 뻑뻑 가슴살: a skill that inflicts 파열', () => {
    expect(parse(TEXT[9702]).effects).toEqual([
      { kind: 'effect', requires: [{ type: 'skillKeyword', keywords: ['Burst'], includesSpecial: false }] },
    ]);
  });

  it('9773 가시 전투화: every effect names a 파열 skill; the enemy having no 파열 is a state', () => {
    const burst = { type: 'skillKeyword', keywords: ['Burst'], includesSpecial: false };
    expect(parse(TEXT[9773]).effects).toEqual([
      { kind: 'effect', requires: [burst] },
      { kind: 'effect', requires: [burst] },
      { kind: 'effect', requires: [burst] },
    ]);
    expect(parse('적중 시 대상 적에게 [Burst]이 없으면, 피해량 +10%').effects[0]!.requires).toEqual([]);
  });

  it('9214 달궈진 망치: one effect, bullets included, asking for 진동 - 작열', () => {
    expect(parse(TEXT[9214]).effects).toEqual([
      { kind: 'effect', requires: [{ type: 'identityBuff', buffs: ['VibrationIgnition'] }] },
    ]);
  });

  it('9767 흑염 파이프: the slot heading is a note, two unconditional effects, a 오만 관통 skill', () => {
    expect(parse(TEXT[9767]).effects).toEqual([
      { kind: 'note', requires: [] },
      { kind: 'effect', requires: [] },
      { kind: 'effect', requires: [] },
      { kind: 'effect', requires: [{ type: 'skill', sins: ['PRIDE'], attackTypes: ['Penetrate'] }] },
    ]);
  });

  it('9088 진혼: the 5-identity condition is a gate', () => {
    const { effects } = parse(TEXT[9088]);
    expect(effects[0]).toEqual({
      kind: 'gate',
      requires: [
        { type: 'skillKeyword', keywords: ['Combustion'], includesSpecial: true, min: 5, scope: 'deployed' },
      ],
    });
    expect(effects.slice(1).map((e) => e.kind)).toEqual(['effect', 'effect', 'effect']);
    expect(effects[1]!.requires).toEqual([]);
    // 「더하기 코인 스킬 … - 빼기 코인 스킬일 경우, 대신 …」: any skill of the keyword qualifies.
    expect(effects[2]!.requires).toEqual([
      { type: 'skillKeyword', keywords: ['Combustion'], includesSpecial: true },
    ]);
  });
});

describe('parseEffects — structure', () => {
  it('reads 「편성된 수에 따라」 steps as thresholds on the effects under each step', () => {
    const { effects } = parse(TEXT[9235]);
    const mins = effects.map((e) =>
      e.kind === 'effect'
        ? e.requires.find((r) => r.type === 'skillKeyword' && r.keywords[0] === 'Bullet')
        : e.kind,
    );
    expect(mins).toEqual([
      'note',
      'note',
      { type: 'skillKeyword', keywords: ['Bullet'], includesSpecial: false, min: 2, scope: 'formation' },
      'note',
      { type: 'skillKeyword', keywords: ['Bullet'], includesSpecial: false, min: 5, scope: 'formation' },
      { type: 'skillKeyword', keywords: ['Bullet'], includesSpecial: false, min: 5, scope: 'formation' },
      { type: 'skillKeyword', keywords: ['Bullet'], includesSpecial: false, min: 5, scope: 'formation' },
      'note',
      { type: 'skillKeyword', keywords: ['Bullet'], includesSpecial: false, min: 8, scope: 'formation' },
      { type: 'skillKeyword', keywords: ['Bullet'], includesSpecial: false, min: 8, scope: 'formation' },
    ]);
  });

  it('reads only the line, not the bullets that strengthen it', () => {
    const { effects } = parse(TEXT[9206]);
    expect(effects[1]).toEqual({
      kind: 'effect',
      requires: [{ type: 'skillKeyword', keywords: ['Laceration'], includesSpecial: true }],
    });
  });

  it('binds what follows a mid-text gate, and cuts a strengthening clause off the line', () => {
    const { effects } = parse(TEXT[9829]);
    const middle3 = { type: 'faction', factions: ['MIDDLE_FINGER'], min: 3, scope: 'deployed' };
    expect(effects[0]).toEqual({ kind: 'effect', requires: [{ type: 'skill', attackTypes: ['Hit'] }] });
    expect(effects[1]).toEqual({ kind: 'effect', requires: [] });
    expect(effects[2]).toEqual({ kind: 'note', requires: [] });
    expect(effects[3]).toEqual({
      kind: 'effect',
      requires: [middle3, { type: 'resonance', sins: ['ENVY'] }],
    });
    expect(effects[4]!.requires).toContainEqual(middle3);
  });

  it('names an identity and scopes an exclusive heading over the lines under it', () => {
    const { effects } = parse(TEXT[9273]);
    const ryoshu = { type: 'identity', ids: [10415] };
    expect(effects[1]!.requires).toEqual([ryoshu]);
    expect(effects[2]).toEqual({ kind: 'note', requires: [] });
    expect(effects[3]!.requires).toEqual([]);
    expect(effects[4]).toEqual({ kind: 'note', requires: [] });
    expect(effects[5]!.requires).toEqual([{ type: 'faction', factions: ['SPIDER_HOUSE'] }, ryoshu]);
    expect(effects[7]!.requires).toEqual([ryoshu]);
  });

  it('treats a buff a gift hands out as a state, and a 「해당 …」 line as part of the line above', () => {
    const { effects } = parse(TEXT[9224]);
    const ring = { type: 'faction', factions: ['RING_FINGER'] };
    expect(effects[2]!.requires).toEqual([ring]); // [PaintingMaterial] is handed out by this very gift
    expect(effects[3]!.requires).toEqual([ring]);
  });
});

const EGO = { type: 'egoSkill' } as const;
const DISCARD = { type: 'identityBuff', buffs: ['Discard'] } as const;
const skillOf = (r: Record<string, unknown>) => ({ type: 'skill', ...r });

describe('parseEffects — E.G.O skills (egoSkill, M129)', () => {
  it('9105 업화 조각: the E.G.O gate and the 분노 E.G.O line ask for an E.G.O skill and nothing more', () => {
    // Arrange
    const text = TEXT[9105];
    // Act
    const { effects } = parse(text);
    // Assert — the keyword and the sin inside an E.G.O clause are the E.G.O's, always met.
    expect(effects).toEqual([
      { kind: 'gate', requires: [EGO] },
      { kind: 'effect', requires: [] },
      { kind: 'effect', requires: [EGO] },
    ]);
  });

  it('9058 디스크 파편 and 9733 아이스크림 통조림: 「탐식 속성 E.G.O 스킬을 사용할 경우」, 「E.G.O 스킬 효과로」', () => {
    expect(parse(TEXT[9058]).effects[1]).toEqual({ kind: 'effect', requires: [EGO] });
    const icecream = parse(TEXT[9733]).effects;
    expect(icecream[1]).toEqual({ kind: 'effect', requires: [EGO] });
    // 「(버림하여 처리)」 is rounding, not a discarding skill.
    expect(icecream[0]).toEqual({ kind: 'effect', requires: [] });
  });

  it('an excluded E.G.O skill (「(E.G.O 스킬 제외 …)」) and an E.G.O resource are no E.G.O requirement', () => {
    expect(parse(TEXT[9088]).effects[0]!.requires).not.toContainEqual(EGO);
    expect(parse(TEXT[9105]).effects[1]!.requires).toEqual([]); // 「분노 E.G.O 자원」
  });
});

describe('parseEffects — 버림 (identityBuff Discard, M129)', () => {
  it('9201 차원분리수거함: 「다른 스킬을 [Discard]하였다면」 asks for a discarding identity', () => {
    // Act
    const { effects } = parse(TEXT[9201]);
    // Assert
    expect(effects[2]).toEqual({ kind: 'effect', requires: [DISCARD, skillOf({ attackTypes: ['Hit'] })] });
  });

  it('9202 포켓 암기 노트: a 디에치 협회 identity that uses a 버림 skill — both requirements', () => {
    expect(parse(TEXT[9202]).effects[1]).toEqual({
      kind: 'effect',
      requires: [DISCARD, { type: 'faction', factions: ['DIECI'] }],
    });
  });

  it('9203 차원지각변환체: 「버림 스킬을 사용하여 자신의 스킬을 버렸다면」', () => {
    expect(parse(TEXT[9203]).effects[1]).toEqual({ kind: 'effect', requires: [DISCARD] });
  });
});

describe('parseEffects — 「A 또는 B」 across kinds (anyOf, M129)', () => {
  it('9009 작열우모: a 화상 skill or a 색욕 skill is one anyOf', () => {
    // Act
    const { effects } = parse(TEXT[9009]);
    // Assert
    expect(effects[0]).toEqual({
      kind: 'effect',
      requires: [
        {
          type: 'anyOf',
          options: [
            { type: 'skillKeyword', keywords: ['Combustion'], includesSpecial: true },
            skillOf({ sins: ['LUST'] }),
          ],
        },
      ],
    });
    expect(effects[1]).toEqual({ kind: 'effect', requires: [] });
  });

  it('9223 범작: the 약지 faction AND (a 색욕 skill or a 참격 skill) — not one skill of both', () => {
    expect(parse(TEXT[9223]).effects[1]!.requires).toEqual([
      { type: 'faction', factions: ['RING_FINGER'] },
      { type: 'anyOf', options: [skillOf({ attackTypes: ['Slash'] }), skillOf({ sins: ['LUST'] })] },
    ]);
  });

  it('9258 앙갚음 장부 : 번외: the 중지 faction AND (a 질투 skill or a 타격 skill)', () => {
    expect(parse(TEXT[9258]).effects[2]!.requires).toEqual([
      { type: 'faction', factions: ['MIDDLE_FINGER'] },
      { type: 'anyOf', options: [skillOf({ attackTypes: ['Hit'] }), skillOf({ sins: ['ENVY'] })] },
    ]);
  });

  it('9291 꽃가위, 9043 사원증, 9221 열선 무기: faction or buff, resonance or keyword, sin or counter', () => {
    expect(parse(TEXT[9291]).effects[1]!.requires).toEqual([
      {
        type: 'anyOf',
        options: [
          { type: 'identityBuff', buffs: ['PersonalityCharge'] },
          { type: 'faction', factions: ['SISYPHE'] },
        ],
      },
    ]);
    expect(parse(TEXT[9043]).effects[0]!.requires).toEqual([
      {
        type: 'anyOf',
        options: [
          { type: 'skillKeyword', keywords: ['Charge'], includesSpecial: true },
          { type: 'resonance', sins: ['WRATH'] },
        ],
      },
    ]);
    expect(parse(TEXT[9221]).effects[0]!.requires).toEqual([
      { type: 'anyOf', options: [skillOf({ sins: ['ENVY'] }), { type: 'defense', kinds: ['counter'] }] },
    ]);
  });

  it('9012 오늘의 표정: keeps the anyOf even though the line also asks for the 타격 skill it buffs', () => {
    expect(parse(TEXT[9012]).effects[0]!.requires).toEqual([
      skillOf({ attackTypes: ['Hit'] }),
      { type: 'anyOf', options: [skillOf({ attackTypes: ['Hit'] }), skillOf({ sins: ['SLOTH'] })] },
    ]);
  });
});

describe('parseEffects — 자기 키워드 (selfKeyword, M129)', () => {
  const consumeVibration = { type: 'selfKeyword', keywords: ['Vibration'], verb: 'consume' } as const;

  it('9164 흔들리는 술통 and 9166 진원점: 「자신의 [진동] 횟수를 소모하는/소모한 스킬」', () => {
    expect(parse(TEXT[9164]).effects.map((e) => e.requires)).toEqual([[], [consumeVibration]]);
    const effects = parse(TEXT[9166]).effects;
    expect(effects[1]!.requires).toEqual([consumeVibration]);
    expect(effects[2]!.requires).toEqual([]); // 「(자신의 [진동] 횟수/5)만큼」 is a scale, not a skill
    expect(effects[3]!.requires).toEqual([consumeVibration]);
  });

  it('9167 무진팔방종: 「[진동] 부여하거나 자신의 [진동] 횟수를 소모하는 스킬」 is either skill', () => {
    const effects = parse(TEXT[9167]).effects;
    expect(effects[1]!.requires).toEqual([
      {
        type: 'anyOf',
        options: [
          { type: 'skillKeyword', keywords: ['Vibration'], includesSpecial: false },
          consumeVibration,
        ],
      },
    ]);
    expect(effects[3]!.requires).toEqual([consumeVibration]);
  });

  it('9819 혈염도: 「자신에게 [화상]을 부여하는 기본 공격 스킬」 is a self gain, not an inflicting skill', () => {
    expect(parse(TEXT[9819]).effects[0]!.requires).toEqual([
      { type: 'selfKeyword', keywords: ['Combustion'], verb: 'gain' },
    ]);
  });

  it('9117 유연 화약: 「자신의 속도가 6 이상이면」 is a state, so only the 파열 skill is asked for', () => {
    expect(parse(TEXT[9117]).effects[2]!.requires).toEqual([
      { type: 'skillKeyword', keywords: ['Burst'], includesSpecial: false },
    ]);
  });
});

describe('normalizeRequirements', () => {
  it('sorts and deduplicates anyOf options, and collapses an anyOf left with one option', () => {
    // Arrange
    const sloth: SingleRequirement = { type: 'skill', sins: ['SLOTH'] };
    const hit: SingleRequirement = { type: 'skill', attackTypes: ['Hit'] };
    // Act
    const out = normalizeRequirements([
      { type: 'anyOf', options: [sloth, hit, sloth] },
      { type: 'anyOf', options: [hit, sloth] },
      { type: 'anyOf', options: [sloth, sloth] },
    ]);
    // Assert
    expect(out).toEqual([sloth, { type: 'anyOf', options: [hit, sloth] }]);
  });

  it('keeps the thresholded copy of a keyword requirement and orders by kind', () => {
    expect(
      normalizeRequirements([
        { type: 'shape', kind: 'singleCoin' },
        { type: 'skillKeyword', keywords: ['Burst'], includesSpecial: false },
        { type: 'skillKeyword', keywords: ['Burst'], includesSpecial: true, min: 5, scope: 'deployed' },
      ]),
    ).toEqual([
      { type: 'skillKeyword', keywords: ['Burst'], includesSpecial: true, min: 5, scope: 'deployed' },
      { type: 'shape', kind: 'singleCoin' },
    ]);
  });
});

describe('readCuratedGiftEffects', () => {
  it('reads entries by gift id, skips comments, and reports a malformed entry', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gift-effects-'));
    const path = join(dir, 'gift-effects.json');
    writeFileSync(
      path,
      JSON.stringify({
        _note: 'comment',
        '9213': { _source: 'x', effects: [{ kind: 'effect', requires: [] }] },
        '9440': { effects: [] },
        abc: { _source: 'x', effects: [] },
      }),
    );
    const curated = readCuratedGiftEffects(path);
    expect([...curated.byId.keys()]).toEqual([9213]);
    expect(curated.errors).toHaveLength(2);
  });
});
