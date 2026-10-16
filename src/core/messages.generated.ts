// 생성 파일 — docs/copy.md의 「루트 경고·미해결 사유」에서 `npm run copy`가 만든다. 직접 고치지 않는다.
import type { MessageParam } from './messages.ts';

export const MESSAGES = {
  // ── 경고 (전체 루트의 「참고」 카드)
  // 화면에는 나오지 않는다(SILENT_WARNINGS) — 앱은 늘 Hard로 계획한다. CLI만 보인다.
  'warn.parallelRequiresHard': {
    ko: '평행중첩({parallelFrom}층 이상)은 1~{lastHard}층을 전부 Hard로 클리어해야 들어갈 수 있어, 1층부터 Hard로 계획했습니다.',
    en: 'Floors {parallelFrom}+ need floors 1-{lastHard} cleared on Hard, so the plan switches to Hard from floor 1.',
  },
  'warn.packOptionDropped': {
    ko: '알 수 없거나 그 층에 나오지 않거나 서로 모순되는 팩 지정은 제외했습니다.',
    en: 'Pack choices that are unknown, not offered on that floor, or contradictory were dropped.',
  },
  'warn.packOptionUnplaced': {
    ko: '포함하기로 한 팩 중 남은 층에 넣을 수 없는 것이 있습니다.',
    en: 'Some packs you chose to include have no floor left in the plan.',
  },
  'warn.observationAfterStart': {
    ko: '기프트 관측은 1층을 떠나기 전에만 할 수 있어, 그 뒤에 지정한 관측은 적용하지 않았습니다.',
    en: 'Gift observation only happens before floor 1 is left, so pins added later were not applied.',
  },
  'warn.observationTrimmed': {
    ko: '관측으로 지정한 기프트 중 관측할 수 없거나, 한도({budget}개)를 넘거나, 이번 계획의 목표가 아닌 것은 제외했습니다.',
    en: 'Some pinned observations were dropped: not observable, over the {budget}-slot limit, or not a goal of this plan.',
  },
  // {gifts}는 「·」로 이은 기프트 이름.
  'warn.sharedIngredient': {
    ko: '{gifts|은/는} 두 조합이 함께 먹습니다. 같은 기프트는 한 번에 하나만 가질 수 있으니, 먼저 조합해 소모한 뒤에야 두 번째 것이 다시 나옵니다.',
    en: 'Two fusions eat the same ingredient. A gift you hold is never offered again, so the first fusion has to happen before the second copy can drop.',
  },
  // 화면에는 나오지 않는다(SILENT_WARNINGS) — 조건은 타일의 링이 말한다. CLI만 보인다.
  'warn.conditionUnmet': {
    ko: '조건을 충족하지 못하는 기프트가 {count}개 있습니다. 효과가 발동하지 않습니다.',
    en: '{count} gift(s) will not activate with this deck.',
  },
  // 화면에는 나오지 않는다(SILENT_WARNINGS) — 범용 드랍 구분은 기프트 탭과 상세 시트가 말한다. CLI만 보인다.
  'warn.generalDropNotGuaranteed': {
    ko: '범용 드랍은 어느 팩에서나 나올 수 있을 뿐 반드시 나오지는 않습니다. 상점과 새로고침을 함께 쓰세요.',
    en: 'General drops can come from any pack but are never guaranteed; use the shop and refreshes.',
  },
  'warn.fusionSlots': {
    ko: '재료가 {max}개를 넘어 일반 상점에서는 한 번에 조합할 수 없습니다. 하위 재료부터 조합하세요.',
    en: 'Needs more than {max} fusion slots, so fuse the sub-ingredients first.',
  },
  'warn.giftObservationUnverified': {
    ko: '기프트 관측 별빛 비용표는 인게임 확인이 필요한 값입니다(구버전 기준).',
    en: 'The gift-observation starlight cost is taken from an older season and needs in-game confirmation.',
  },
  'warn.searchCapped': {
    ko: '탐색 한도에 도달해 최선에 가까운 결과만 보여 줍니다. 목표 기프트를 줄이면 더 정확해집니다.',
    en: 'The search hit its node cap, so this is a near-best plan. Fewer goal gifts will sharpen it.',
  },
  'warn.hardRequired': {
    ko: 'Hard에서만 등장하는 팩이 필요한 기프트가 있습니다. 난이도를 Hard로 올리면 루트가 넓어집니다.',
    en: 'Some wanted gifts only come from Hard-only packs; switching to Hard widens the route.',
  },

  // ── 미해결 사유
  'unresolved.notInData': { ko: '게임 데이터에 없는 기프트입니다.', en: 'Not present in the game data.' },
  'unresolved.notObtainable': {
    ko: '이번 시즌에 획득할 수 없는 기프트입니다.',
    en: 'Not obtainable in the current season.',
  },
  // 층당 확률을 모를 때. 「확정」이라는 낱말은 쓰지 않는다(테스트가 지킨다).
  'unresolved.chanceOnly': {
    ko: '{floors}층 히든 전투 보상으로만 나오는 기프트입니다. 루트로 정할 수 없습니다.',
    en: 'Only a random hidden-battle reward on floors {floors}; the route cannot plan for it.',
  },
  // 층당 확률을 알 때.
  'unresolved.chanceOnlyRate': {
    ko: '{floors}층 히든 전투 보상(층당 {pct}%)으로만 나오는 기프트입니다. 루트로 정할 수 없습니다.',
    en: 'Only a random hidden-battle reward on floors {floors} ({pct}% per floor); the route cannot plan for it.',
  },
  'unresolved.eventOnly': {
    ko: '선택지·이벤트로만 얻는 기프트라 팩 루트로 계획할 수 없습니다.',
    en: 'Only obtained through a choice event, so no pack route can plan for it.',
  },
  'unresolved.materialOnly': {
    ko: '잔영은 조합·판매용 재료라 팩 루트로 계획할 수 없습니다.',
    en: 'A fusion/sale material; no pack route can plan for it.',
  },
  'unresolved.hardOnly': {
    ko: 'Hard 난이도에서만 얻을 수 있는 기프트입니다. 난이도를 Hard로 바꾸세요.',
    en: 'Obtainable on Hard difficulty only. Switch the plan to Hard.',
  },
  // {eaters}는 그 기프트를 먹는 조합 이름들(ko 「·」, en 「 and 」로 잇는다).
  'unresolved.ingredientShared': {
    ko: '{gift|은/는} 한 런에서 한 번만 얻을 수 있는데 {eaters|이/가} 함께 먹습니다. 두 번째 몫을 줄 팩이 더 없습니다.',
    en: '{gift} can only be had once per run, and {eaters} both consume it. No further pack can supply a second copy.',
  },
  'unresolved.packConflict': {
    ko: '다른 전용 기프트와 층이 겹쳐 한 런에 같이 넣을 수 없습니다.',
    en: 'Its pack competes for the same floor as another wanted exclusive.',
  },
  'unresolved.packBanned': {
    ko: '이 기프트를 주는 팩을 모두 제외했습니다.',
    en: 'Every pack that supplies it has been excluded.',
  },
  // 런 중(1층을 떠난 뒤).
  'unresolved.noPackAhead': {
    ko: '{gift|을/를} 주는 팩이 남은 층에 없습니다.',
    en: 'No pack that supplies it appears on the floors still ahead.',
  },
  // 런 전.
  'unresolved.noPackInRange': {
    ko: '{gift|을/를} 주는 팩이 계획한 층 범위에 없습니다.',
    en: 'No pack that supplies it appears within the planned floors.',
  },
  // {missing}은 구할 수 없는 재료의 id 목록.
  'unresolved.fusionMissing': {
    ko: '재료 {missing}을(를) 구할 수 없어 조합할 수 없습니다.',
    en: 'Cannot be fused: ingredients {missing} are not obtainable in this plan.',
  },
  // 「재료는 목표가 아님」이라 남은 재료의 입장을 취소했을 때. {missing}·{dropped}는 id 목록.
  'unresolved.fusionMissingDropped': {
    ko: '재료 {missing}을(를) 구할 수 없어 조합할 수 없습니다. 나머지 재료({dropped})만을 위한 입장은 취소했습니다.',
    en: 'Cannot be fused: ingredients {missing} are not obtainable. Pack entries for the remaining ingredients ({dropped}) alone were dropped.',
  },
  'unresolved.failed': {
    ko: '미획득인 채로 층을 떠나 이 런에서는 더 얻을 수 없는 기프트입니다.',
    en: 'Its floor was left with it not got, so it cannot be had this run.',
  },
  'unresolved.fusionTooDeep': {
    ko: '조합 단계가 너무 깊어 재료를 모두 추적할 수 없습니다.',
    en: 'The fusion chain is deeper than the planner follows.',
  },
  'unresolved.noRecipe': {
    ko: '조합 레시피를 찾을 수 없습니다.',
    en: 'No fusion recipe is known for this gift.',
  },

  // ── 조건 요약
  // 임계값 없이 편성 수에 따라 강화되는 조건.
  'cond.keywordCount': {
    ko: '{keywords} {verb} 스킬 보유 인격 {have}명 ({scope})',
    en: '{have} identities {verb} {keywords} ({scope})',
  },
  'cond.keywordMin': {
    ko: '{keywords} {verb} 스킬 보유 인격 {have}/{min} ({scope})',
    en: '{have}/{min} identities {verb} {keywords} ({scope})',
  },
  'cond.faction': {
    ko: '{factions} 소속 {have}/{min}인 ({scope})',
    en: '{have}/{min} identities from {factions} ({scope})',
  },
  'cond.fullResonance': {
    ko: '완전 공명 {min} 이상 필요 (전투 중 판정이라 덱만으로는 알 수 없음)',
    en: 'needs {min}+ full resonance, which depends on in-battle play',
  },
  'cond.verbInflict': { ko: '부여', en: 'inflict' },
  'cond.verbConsume': { ko: '소모', en: 'consume' },
  'cond.scopeDeployed': { ko: '출격 인원', en: 'deployed' },
  'cond.scopeFormation': { ko: '편성 인원', en: 'formation' },
  'cond.scopeReserve': { ko: '대기 인원', en: 'reserve' },
} as const;

/** The parameters each message takes — `msg()` will not compile without them. */
export interface MessageParams {
  'warn.parallelRequiresHard': { parallelFrom: MessageParam; lastHard: MessageParam };
  'warn.packOptionDropped': Record<never, never>;
  'warn.packOptionUnplaced': Record<never, never>;
  'warn.observationAfterStart': Record<never, never>;
  'warn.observationTrimmed': { budget: MessageParam };
  'warn.sharedIngredient': { gifts: MessageParam };
  'warn.conditionUnmet': { count: MessageParam };
  'warn.generalDropNotGuaranteed': Record<never, never>;
  'warn.fusionSlots': { max: MessageParam };
  'warn.giftObservationUnverified': Record<never, never>;
  'warn.searchCapped': Record<never, never>;
  'warn.hardRequired': Record<never, never>;
  'unresolved.notInData': Record<never, never>;
  'unresolved.notObtainable': Record<never, never>;
  'unresolved.chanceOnly': { floors: MessageParam };
  'unresolved.chanceOnlyRate': { floors: MessageParam; pct: MessageParam };
  'unresolved.eventOnly': Record<never, never>;
  'unresolved.materialOnly': Record<never, never>;
  'unresolved.hardOnly': Record<never, never>;
  'unresolved.ingredientShared': { gift: MessageParam; eaters: MessageParam };
  'unresolved.packConflict': Record<never, never>;
  'unresolved.packBanned': Record<never, never>;
  'unresolved.noPackAhead': { gift: MessageParam };
  'unresolved.noPackInRange': { gift: MessageParam };
  'unresolved.fusionMissing': { missing: MessageParam };
  'unresolved.fusionMissingDropped': { missing: MessageParam; dropped: MessageParam };
  'unresolved.failed': Record<never, never>;
  'unresolved.fusionTooDeep': Record<never, never>;
  'unresolved.noRecipe': Record<never, never>;
  'cond.keywordCount': {
    keywords: MessageParam;
    verb: MessageParam;
    have: MessageParam;
    scope: MessageParam;
  };
  'cond.keywordMin': {
    keywords: MessageParam;
    verb: MessageParam;
    have: MessageParam;
    min: MessageParam;
    scope: MessageParam;
  };
  'cond.faction': { factions: MessageParam; have: MessageParam; min: MessageParam; scope: MessageParam };
  'cond.fullResonance': { min: MessageParam };
  'cond.verbInflict': Record<never, never>;
  'cond.verbConsume': Record<never, never>;
  'cond.scopeDeployed': Record<never, never>;
  'cond.scopeFormation': Record<never, never>;
  'cond.scopeReserve': Record<never, never>;
}
