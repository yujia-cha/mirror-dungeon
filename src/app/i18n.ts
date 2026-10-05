/**
 * UI strings. Korean is the product language; English exists so the page is usable by the
 * English-speaking part of the community and is never the source of truth for a label.
 *
 * `{name}` placeholders are filled by `t(key, lang, params)`.
 */
import type { Localized } from '../core/schema.ts';

export type Lang = 'ko' | 'en';

export const STRINGS = {
  appTitle: { ko: '거울 던전 루트', en: 'Mirror Dungeon Route' },
  share: { ko: '링크 복사', en: 'Copy link' },
  shared: { ko: '링크를 복사했습니다', en: 'Link copied' },
  copyFailed: {
    ko: '복사하지 못했습니다 · 화면을 한 번 누른 뒤 다시 시도하세요',
    en: 'Could not copy · tap the page once and try again',
  },
  linkBroken: { ko: '공유 링크를 읽지 못했습니다', en: 'This share link could not be read' },
  moreActions: { ko: '더 보기', en: 'More' },
  resetAll: { ko: '초기화', en: 'Reset' },
  confirmCancel: { ko: '취소', en: 'Cancel' },
  resetAllConfirm: {
    ko: '덱·기프트·루트 설정·런 기록을 모두 처음 상태로 되돌립니다.',
    en: 'Resets the deck, gifts, route settings and run record.',
  },
  langToggle: { ko: 'English', en: '한국어' },
  themeToggle: { ko: '화면 전환', en: 'Toggle theme' },
  loading: { ko: '게임 데이터를 불러오는 중', en: 'Loading game data' },
  loadFailed: { ko: '게임 데이터를 불러오지 못했습니다', en: 'Could not load the game data' },
  retry: { ko: '다시 시도', en: 'Retry' },
  // `DataLoadError` carries a cause, not a sentence, so both languages are written here instead
  // of one Korean string reaching an English reader from core. `{label}` is the file that failed.
  loadFailedHttp: {
    ko: '{label}을(를) 받지 못했습니다 ({status}).',
    en: 'Could not fetch {label} ({status}).',
  },
  loadFailedTimeout: {
    ko: '{label} 요청이 시간을 넘겼습니다. 연결을 확인해 주세요.',
    en: 'The request for {label} timed out; check your connection.',
  },
  loadFailedNetwork: { ko: '{label}에 연결할 수 없습니다.', en: 'Could not reach {label}.' },
  loadFailedMalformed: {
    ko: '{label}의 내용을 읽을 수 없습니다.',
    en: 'Could not read the contents of {label}.',
  },
  dataVersion: { ko: '데이터', en: 'Data' },
  season: { ko: '시즌', en: 'Season' },
  seasonProvisional: {
    ko: '데이터 일부 미확인',
    en: 'Some data not confirmed',
  },
  seasonProvisionalHint: {
    ko: '이 시즌은 아직 팩별 범용 드랍 풀을 확인하지 못했습니다. 전용 기프트와 조합은 계획할 수 있지만, 범용 드랍이 어느 팩에서 나오는지는 알 수 없습니다.',
    en: 'This season has no per-pack general drop pool yet. Exclusive gifts and fusions can be planned; which pack a general drop can come from is unknown.',
  },
  seasonDroppedGifts: {
    ko: '이번 시즌에 없는 기프트 {n}개를 뺐습니다',
    en: 'Dropped {n} gift(s) this season does not have',
  },
  seasonDroppedPacks: {
    ko: '이번 시즌에 없는 팩 설정 {n}개를 뺐습니다',
    en: 'Dropped {n} pack setting(s) this season does not have',
  },
  // Still one line, per the rule that the screen carries exactly two sentences of prose (this and
  // the data version). 「제휴하거나 승인받지 않았습니다」 is the part the repo's LICENSE/NOTICE said
  // and the app did not; the credits themselves are too long for a footer and live in NOTICE,
  // which the link reaches.
  aboutData: {
    ko: '게임 데이터와 텍스트의 권리는 Project Moon에 있습니다. Project Moon과 제휴하거나 승인받지 않은 비상업 팬 프로젝트입니다.',
    en: 'Game data and text belong to Project Moon. A non-commercial fan project, not affiliated with or endorsed by Project Moon.',
  },
  aboutSource: { ko: '출처와 라이선스', en: 'Sources and licence' },

  toDeck: { ko: '덱 탭으로', en: 'To the deck tab' },

  // Step 1 — deck
  deckSearchAll: {
    ko: '전체 인격 검색 · 이름 · 소속 · 키워드(여러 개 가능)',
    en: 'Search all identities · name · faction · keywords (several allowed)',
  },
  deckSearchHint: { ko: '{n}명', en: '{n} found' },
  deckSearchPicked: { ko: '덱에 {n}명', en: '{n} in the deck' },
  deckDefault: { ko: '기본 덱', en: 'Default deck' },
  deckSearchNone: { ko: '일치하는 인격 없음', en: 'No identity matches' },
  deckDeployedFull: { ko: '출격은 최대 {max}명입니다', en: 'Up to {max} can be deployed' },
  deckDeployed: { ko: '출격', en: 'Deployed' },
  deckReserve: { ko: '대기', en: 'Reserve' },
  deckEmptySlot: { ko: '인격 선택', en: 'Pick an identity' },
  deckClearSlot: { ko: '칸 비우기', en: 'Clear slot' },
  deckImport: { ko: '코드 가져오기', en: 'Import code' },
  deckImportPlaceholder: { ko: '편성 코드를 붙여넣으세요', en: 'Paste a formation code' },
  deckImportApply: { ko: '불러오기', en: 'Import' },
  deckImportFailed: { ko: '편성 코드를 읽을 수 없습니다', en: 'Could not read that formation code' },
  deckImportPartial: {
    ko: '일부 인격을 찾을 수 없어 건너뛰었습니다',
    en: 'Some identities were not found and were skipped',
  },
  deckChipBasis: { ko: '출격 {n}명 · 편성 전체 {total}명', en: '{n} deployed · {total} in the formation' },
  deckRank: { ko: '{n}성', en: '{n}★' },
  deckKeywordSkills: { ko: '{keyword} 부여 공격 스킬 보유', en: 'Has attack skills that inflict {keyword}' },
  deckKeywordSpecial: { ko: '{keyword}(특수)', en: '{keyword} (Unique)' },
  deckKeywordSpecialHint: {
    ko: '{keyword} 또는 특수 {keyword} 부여·획득 공격 스킬 보유',
    en: 'Has attack skills that inflict or gain {keyword} or Unique {keyword}',
  },
  deckKeywordSpecialOnly: { ko: '특수 {keyword}', en: 'Unique {keyword}' },
  // 탄환 is spent, not inflicted, and always reads plainly — there is no 특수 form of this line.
  deckKeywordUses: { ko: '{keyword} 소모 공격 스킬 보유', en: 'Has attack skills that spend {keyword}' },
  deckKeywordSpecialOnlyHint: {
    ko: '특수 {keyword}만 부여·획득 — 「또는 특수 {keyword}」 조건에만 셈',
    en: 'Only Unique {keyword} — counts only for conditions that say "or Unique {keyword}"',
  },
  deckSinnerSearch: { ko: '{sinner} 인격 검색', en: 'Search {sinner} identities' },
  deckShowing: { ko: '{total}명 중 {n}명', en: '{n} of {total}' },
  deckClose: { ko: '닫기', en: 'Close' },

  // Step 2 — gifts
  giftsSearch: { ko: '기프트 검색', en: 'Search gifts' },
  giftsActive: { ko: '지금 덱으로 활성', en: 'Active with this deck' },
  // 「목표가 아닌 것만 보기」 hides what is already a goal or already carried by one (`isMarked`).
  giftsUnpickedOnly: { ko: '목표가 아닌 것만 보기', en: 'Non-goals only' },
  giftsActiveAllPicked: { ko: '모두 목표입니다', en: 'All are goals' },
  giftsActiveNone: { ko: '지금 덱으로 활성인 기프트가 없습니다', en: 'Nothing is active with this deck' },
  giftsResults: { ko: '검색 결과', en: 'Search results' },
  giftSubOf: { ko: '{parent} 재료', en: 'Ingredient of {parent}' },
  giftMaterials: { ko: '조합식', en: 'Recipe' },
  giftSubRecipe: { ko: '{name}도 조합이다 — 그 재료', en: '{name} is a fusion too — its ingredients' },
  giftMixedRecipe: {
    ko: '키워드 상위 {aOf}종 중 {a}개 + 공격 유형 {bOf}종 중 {b}개',
    en: '{a} of {aOf} keyword capstones + {b} of {bOf} attack-type ones',
  },
  giftPackOnly: { ko: '{name} 전용', en: 'only from {name}' },
  // Three or more exclusive packs (53 gifts have several; 인연 얽힘 has seven): the first is named
  // and the rest counted, so the line stays one line.
  giftPackOnlyMany: { ko: '{name} 외 {n}개 팩 전용', en: 'only from {name} and {n} other packs' },
  /** `{source}` is a `routeSourceText` — where this route gets the gift. */
  giftRouteSource: { ko: '이 루트에서는 {source}', en: 'In this route: {source}' },
  giftBlockedIncluded: { ko: '{name} 조합에 이미 포함됨', en: 'Already part of {name}' },
  giftEntangled: { ko: '얽힘', en: 'Entangled' },
  // `{name}` is a gift name, so the particle is picked by `josa` at the call site.
  giftEntangledWith: { ko: '{name} 재료가 겹칩니다: {list}', en: 'shares ingredients with {name}: {list}' },
  giftDetail: { ko: '{name} 자세히', en: '{name} details' },
  giftDetailBack: { ko: '{name} 설명으로 돌아가기', en: 'Back to {name}' },
  giftsDeckEmpty: { ko: '덱이 비어 있습니다', en: 'The deck is empty' },
  giftsNoMatch: { ko: '일치하는 기프트 없음', en: 'No gift matches' },
  giftsSelected: { ko: '목표 {n}', en: 'Goals {n}' },
  giftsClear: { ko: '목표 비우기', en: 'Clear goals' },
  giftsClearConfirm: {
    ko: '목표 {n}개와 조합 설정·관측 지정을 모두 뺍니다.',
    en: 'Removes all {n} goals with their fusion settings and observation pins.',
  },
  // The 「모두 보기」 browser (the >> at the end of the tab's search row): every gift in one grid with
  // the filters, over the stage on a desktop and as its own page on a phone.
  giftsBrowseAll: { ko: '모두 보기', en: 'Browse all' },
  giftsBrowseTitle: { ko: '모든 기프트', en: 'All gifts' },
  giftsBrowseClose: { ko: '닫기', en: 'Close' },
  giftsBrowseHide: { ko: '모두 보기 닫기', en: 'Close browse all' },
  giftsSort: { ko: '정렬', en: 'Sort' },
  giftsSortPicked: { ko: '추가한 순서', en: 'As added' },
  giftsSortName: { ko: '이름', en: 'Name' },
  giftsPack: { ko: '팩', en: 'Pack' },
  giftsObserve: { ko: '{name} 관측 지정', en: 'Observe {name}' },
  giftsObserveNotAllowed: { ko: '관측할 수 없는 기프트', en: 'Cannot be observed' },
  giftsObserveFull: { ko: '관측은 최대 {max}개', en: 'Up to {max} observations' },
  giftsObserveClosed: {
    ko: '1층을 떠난 뒤에는 관측을 바꿀 수 없습니다',
    en: 'Observations cannot change after floor 1 is left',
  },
  observeSlots: { ko: '관측', en: 'Observation' },
  observeSlotAdd: { ko: '관측 지정 추가', en: 'Add an observation' },
  observeSlotAddSuggested: {
    ko: '관측 지정 추가 · 추천 {name}',
    en: 'Add an observation · suggested {name}',
  },
  observeSlotsCount: { ko: '관측 {n}/{max}', en: 'Observation {n}/{max}' },
  // The observation toggle reads the same everywhere it appears (pack sheet row, start-row detail,
  // gift sheet, slots): 「관측 지정」 off, 「지정됨」 on, and 「{name} 지정 해제」 to release it.
  observePinned: { ko: '지정됨', en: 'Pinned' },
  observeSlotClear: { ko: '{name} 지정 해제', en: 'Unpin {name}' },
  observeSlotNone: { ko: '관측할 수 있는 목표 기프트가 없습니다', en: 'No goal gift can be observed' },
  filterReset: { ko: '필터 초기화', en: 'Reset filters' },
  filterKeyword: { ko: '키워드', en: 'Keyword' },
  // 「조건」 asks whether the deck decides the gift (`hasDeckCondition`): a threshold keyword count
  // or a faction count. Effect scaling and full resonance are not deck conditions.
  filterCondition: { ko: '조건', en: 'Condition' },
  condNone: { ko: '조건 없음', en: 'No condition' },
  condGated: { ko: '덱 조건', en: 'Deck condition' },
  filterTier: { ko: '등급', en: 'Tier' },
  filterSin: { ko: '죄악', en: 'Sin' },
  filterAll: { ko: '전체', en: 'All' },
  acqSure: { ko: '팩 한정', en: 'Pack-only' },
  acqMaybe: { ko: '범용 드랍', en: 'General drop' },
  acqFuse: { ko: '조합', en: 'Fusion' },
  acqStart: { ko: '시작', en: 'Start' },
  acqEvent: { ko: '이벤트', en: 'Event' },
  acqClear: { ko: '클리어 보상', en: 'Clear reward' },
  acqChance: { ko: '확률 보상', en: 'Chance drop' },
  acqMaterial: { ko: '재료', en: 'Material' },
  acqUnknown: { ko: '경로 불명', en: 'Unknown' },
  sinWRATH: { ko: '분노', en: 'Wrath' },
  sinLUST: { ko: '색욕', en: 'Lust' },
  sinSLOTH: { ko: '나태', en: 'Sloth' },
  sinGLUTTONY: { ko: '탐식', en: 'Gluttony' },
  sinGLOOM: { ko: '우울', en: 'Gloom' },
  sinPRIDE: { ko: '오만', en: 'Pride' },
  sinENVY: { ko: '질투', en: 'Envy' },
  removeFromSelection: { ko: '{name} 목표에서 빼기', en: 'Remove {name} from goals' },

  // Step 3 — route
  optionStartKeyword: { ko: '시작 키워드', en: 'Start keyword' },
  optionAuto: { ko: '자동', en: 'Auto' },
  optionAutoResolved: { ko: '자동 ({keyword})', en: 'Auto ({keyword})' },
  // The gift name arrives with its particle attached (`withJosa`), so the sentence carries none.
  startKeywordGives: { ko: '{keyword}: {gift} 시작 기프트로 받습니다', en: '{keyword}: starts with {gift}' },
  startKeywordAutoWould: {
    ko: '자동으로 두면 {gift} 시작 기프트로 받습니다',
    en: 'On auto, the run would start with {gift}',
  },
  startKeywordFree: {
    ko: '목표에 영향이 없으니 원하는 키워드를 골라도 됩니다',
    en: 'No goal depends on it, so pick any keyword',
  },
  routeRequiredPacks: { ko: '필요 팩', en: 'Packs' },
  routeCovered: { ko: '획득', en: 'Got' },
  routeApprox: { ko: '근사 결과', en: 'Near-best' },
  routeCopy: { ko: '텍스트 복사', en: 'Copy as text' },
  routeCopied: { ko: '복사했습니다', en: 'Copied' },
  routeStart: { ko: '시작', en: 'Start' },
  routeStartGift: { ko: '시작 기프트', en: 'Starting gift' },
  routeObserved: { ko: '관측', en: 'Observed' },
  routeObservedEmpty: { ko: '관측 빈 칸', en: 'Free observation slot' },
  // The row used to carry 「관측」 only in an `aria-label`, so a row of three empty dashed eyes said
  // nothing at all to a touch or no-hover reader. It gets a visible label, and a reason when empty.
  routeObservedNone: { ko: '추천할 관측이 없습니다', en: 'Nothing worth observing' },
  // Mid-run the observation decision is past, so the row stops being a recommendation and becomes
  // the record of what the run actually started with (core clears `start.observed` once past floor 1).
  routeStartHeld: { ko: '시작 시 획득', en: 'Got at start' },
  routeStartHeldNone: { ko: '관측 없이 시작했습니다', en: 'Started with no observations' },
  routeObservedPinned: { ko: '지정', en: 'Pinned' },
  routeObservedRecommended: { ko: '추천', en: 'Suggested' },
  routeObservedFrees: { ko: '{pack} 안 가도 됨', en: 'No need to enter {pack}' },
  routeObservedRescue: { ko: '루트로는 얻을 수 없어 관측', en: 'Unreachable by route, so observe it' },
  routeVariantWithout: { ko: '{name} 빼면', en: 'Without {name}' },
  // The decision card: one place for the choice the route cannot make — which gift to take out of
  // the goals when they cannot all fit one run. `{names}` is the list of conflicting gift names.
  routeDecisionTitle: {
    ko: '전부 얻을 수 없습니다 · {names} 중 하나를 목표에서 빼야 합니다',
    en: 'They do not all fit one run · remove one of {names} from the goals',
  },
  // When no single gift clears it: `{n}` is how many have to go (`minDrops`, core).
  routeDecisionTitleMany: {
    ko: '전부 얻을 수 없습니다 · {names} 중 {n}개를 목표에서 빼야 합니다',
    en: 'They do not all fit one run · remove {n} of {names} from the goals',
  },
  // M80: the card lists drop effects — one bar per goal, the conflicts that leaving it out alone
  // clears — and checks a set against the planner instead of summing bars.
  routeDecisionEffects: { ko: '혼자 뺐을 때 줄어드는 충돌', en: 'Conflicts cleared by leaving one out' },
  routeDecisionCheck: { ko: '뺄 목표로 고르기', en: 'pick to remove' },
  routeDecisionReducesLabel: { ko: '충돌 {n}개 줄어듦', en: 'clears {n} conflicts' },
  routeDecisionBarSum: { ko: '막대 합 −{sum}', en: 'Bars add to −{sum}' },
  routeDecisionReal: { ko: '함께 뺀 실제 −{real}', en: 'together −{real}' },
  routeDecisionNotAdditive: { ko: '더해지지 않음', en: 'not additive' },
  routeDecisionResolves: { ko: '빼면 해결: {names}', en: 'Fits without: {names}' },
  routeDecisionPick: { ko: '이 조합 고르기', en: 'Pick these' },
  routeDecisionNow: { ko: '충돌 {n} · 획득 {covered}', en: '{n} conflicting · got {covered}' },
  routeDecisionComputing: { ko: '계산 중…', en: 'Computing…' },
  routeDecisionFits: { ko: '✓ 전부 들어갑니다 · 획득 {covered}', en: '✓ Everything fits · got {covered}' },
  routeDecisionLeft: { ko: '남은 충돌 {n} · 획득 {covered}', en: '{n} still conflicting · got {covered}' },
  routeDecisionSelected: { ko: '{n}개 선택', en: '{n} picked' },
  routeDecisionClear: { ko: '선택 해제', en: 'Clear' },
  routeDecisionPreview: { ko: '루트 미리 보기', en: 'Preview route' },
  routeDecisionDropSelected: { ko: '선택한 {n}개 목표에서 빼기', en: 'Remove {n} from goals' },
  routeDecisionPending: { ko: '대안 계산 중…', en: 'Computing alternatives…' },
  routeDecisionCandidates: { ko: '뺄 후보', en: 'Candidates to remove' },
  routeClose: { ko: '닫기', en: 'Close' },
  packGifts: { ko: '이 팩의 기프트', en: 'Gifts from this pack' },
  packFloorRange: { ko: '{floors}층', en: 'Floors {floors}' },
  giftExclusive: { ko: '전용', en: 'Exclusive' },
  giftWanted: { ko: '목표', en: 'Goal' },
  routeFree: { ko: '자유', en: 'Free' },
  routeFloorRange: { ko: '{from}~{to}층', en: 'Floors {from}–{to}' },
  giftUnjudgeable: { ko: '판정 불가', en: 'Cannot judge' },
  condResonance: { ko: '공명', en: 'Resonance' },
  condMet: { ko: '충족', en: 'Met' },
  condUnmet: { ko: '미충족', en: 'Not met' },
  routeConditions: { ko: '조건 판정', en: 'Conditions' },
  routeConditionsBasis: { ko: '출격 {n} 기준', en: 'for {n} deployed' },
  routeUnresolved: { ko: '미해결', en: 'Unresolved' },
  routeWarnings: { ko: '참고', en: 'Notes' },
  // 루트가 팩 입장으로 더 할 일이 없는 기프트들. 목록과 개수만 말하고 팩 한정/범용 드랍 판단은
  // 기프트 탭의 획득 분류(`acqMaybe`)와 기프트 상세 시트가 맡는다.
  routeGeneralBadge: { ko: '범용 드랍 {n}', en: '{n} general drops' },
  /**
   * Shown while a newer route is still being computed off-thread, over the previous one.
   *
   * It says 「고치는 중」 rather than 「계산 중」 because what the reader sees is a route that is one
   * toggle behind, not an empty panel — the previous answer is still on screen and still usable.
   */
  routeRecomputing: { ko: '갱신 중…', en: 'updating…' },
  /** The skip link's own text. 「무대」 is what the centre column is called everywhere else. */
  skipToStage: { ko: '무대로 건너뛰기', en: 'Skip to the stage' },
  routeGeneralTitle: { ko: '범용 드랍', en: 'General drops' },
  /** The copied plan's first line: every goal, the unresolved ones marked. */
  routeGoalsLabel: { ko: '목표', en: 'Goals' },
  // Where this route gets one gift (`routeSourceText`): a floor and pack, the observation, the
  // starting gift, the general pool no pack fetches, or a fusion after a floor.
  routeSourcePack: { ko: '{floor}층 {name}', en: 'floor {floor}, {name}' },
  routeSourceObserved: { ko: '관측', en: 'observation' },
  routeSourceStart: { ko: '시작 기프트', en: 'starting gift' },
  routeSourceGeneral: { ko: '범용 드랍', en: 'general drop' },
  routeSourceFusion: { ko: '{floor}층 이후 조합', en: 'fused after floor {floor}' },
  routeSourceFusionUnreachable: { ko: '조합 불가', en: 'cannot be fused' },
  routeApproxHint: {
    ko: '목표가 많아 탐색을 끝까지 하지 못했습니다. 최선이 아닐 수 있고, 목표를 더 넣으면 이미 획득한 것이 빠질 수 있습니다.',
    en: 'Too many goals to search exhaustively. This may not be optimal, and adding goals can drop ones already got.',
  },
  routeEmpty: { ko: '목표를 정하면 루트가 나옵니다', en: 'Set goals and the route appears' },
  unresolvedNoPack: { ko: '층 범위 밖', en: 'No pack in range' },
  unresolvedConflict: { ko: '팩 충돌', en: 'Pack conflict' },
  unresolvedHardOnly: { ko: '난이도 제한', en: 'Difficulty-locked' },
  unresolvedIngredient: { ko: '재료 미해결', en: 'Ingredient unresolved' },
  unresolvedNotObtainable: { ko: '획득 불가', en: 'Not obtainable' },
  unresolvedNoPackPath: { ko: '팩 경로 없음', en: 'No pack path' },
  unresolvedChance: { ko: '확률 보상', en: 'Chance only' },
  unresolvedBanned: { ko: '제외한 팩', en: 'Pack excluded' },
  unresolvedShared: { ko: '재료 겹침', en: 'Ingredient shared' },
  unresolvedFailed: { ko: '미획득', en: 'Not got' },
  unresolvedDropped: {
    ko: '나머지 재료({names})만을 위한 입장은 취소했습니다.',
    en: 'Pack entries for the remaining ingredients ({names}) alone were dropped.',
  },

  runActive: { ko: '진행 중', en: 'In progress' },
  runCurrentFloor: { ko: '현재 층', en: 'Current floor' },
  runVisited: { ko: '{floor}층 입장', en: 'Entered on floor {floor}' },
  runVisitedShort: { ko: '입장 · {floor}층', en: 'Entered · F{floor}' },
  runPassed: { ko: '지남', en: 'Passed' },
  runFailedCount: { ko: '미획득 {n}', en: '{n} not got' },
  giftStatusGot: { ko: '획득', en: 'Got' },
  giftStatusFailed: { ko: '미획득', en: 'Not got' },
  // Every way a gift becomes or stops being a goal — the gift sheet, the pack sheet's rows — says
  // these two; the ✕ on a tray tile and the decision card say the same with the name attached.
  giftAddGoal: { ko: '목표에 추가', en: 'Add as goal' },
  giftRemoveGoal: { ko: '목표에서 빼기', en: 'Remove from goals' },
  giftFusionDead: {
    ko: '조합 불가 — {result} 재료를 구할 수 없습니다',
    en: 'Fusion lost — {result} cannot get its ingredients',
  },
  fusionGoalIngredients: { ko: '재료도 목표', en: 'Ingredients are goals too' },
  fusionGoalHint: {
    ko: '끄면 조합이 불가능해졌을 때 남은 재료만을 위한 입장을 취소합니다.',
    en: 'Off: when the fusion becomes impossible, pack entries for the remaining ingredients alone are dropped.',
  },

  // A phone page is titled with the name of the header door that opens it.
  panelLeft: { ko: '덱', en: 'Deck' },
  panelRight: { ko: '전체 루트', en: 'Full route' },
  panelResize: { ko: '패널 너비', en: 'Panel width' },
  panelResizeHint: {
    ko: '끌어서 너비 조절 · 두 번 눌러 기본값 · 화살표 키로 조금씩',
    en: 'Drag to resize · double-click to reset · arrow keys nudge',
  },
  panelBack: { ko: '뒤로', en: 'Back' },
  tabDeck: { ko: '덱', en: 'Deck' },
  tabGifts: { ko: '기프트', en: 'Gifts' },
  tabRoutePlan: { ko: '전체 루트', en: 'Full route' },
  tabGoals: { ko: '목표', en: 'Goals' },
  tabTracker: { ko: '추적기', en: 'Tracker' },
  stageFloor: { ko: '{floor}층', en: 'Floor {floor}' },
  stageOf: { ko: '/ {last}', en: '/ {last}' },
  stageEnterable: { ko: '이 층에서 들어갈 수 있는 팩', en: 'Packs you can enter on this floor' },
  stageNoRoutePack: { ko: '계획된 팩 없음', en: 'No planned pack' },
  stageNoGoals: { ko: '아직 목표 기프트가 없습니다.', en: 'No goal gifts yet.' },
  stageOtherPacks: { ko: '다른 팩', en: 'Other packs' },
  stagePackAlternatives: { ko: '외 {n}', en: '{n} more' },
  stageSameGifts: { ko: '같은 기프트', en: 'Same gifts' },
  stageOtherSearch: { ko: '이 층의 팩 검색', en: 'Search packs on this floor' },
  stageOtherNone: { ko: '맞는 팩이 없습니다.', en: 'No matching pack.' },
  stageSkipped: { ko: '입장하지 않음 · 기록됨', en: 'Skipped · recorded' },
  stageEnter: { ko: '입장', en: 'Enter' },
  stageEnterPack: { ko: '{name} 입장', en: 'Enter {name}' },
  stageUnenter: { ko: '입장 취소', en: 'Undo entry' },
  stageReleaseEnter: { ko: '놓으면 입장', en: 'Release to enter' },
  stageOtherEntry: { ko: '다음 층', en: 'Next floor' },
  stageReleaseNext: { ko: '놓으면 다음 층', en: 'Release for the next floor' },
  stageReleaseBack: {
    ko: '놓으면 입장 취소 · 표시한 기프트 초기화',
    en: 'Release to undo entry · marked gifts reset',
  },
  stageBackPack: { ko: '{name} 입장 취소', en: 'Undo entry to {name}' },
  stageExclusiveMore: { ko: '+{n}', en: '+{n}' },
  stagePackDetail: { ko: '{name} 자세히', en: '{name} details' },
  stageEntered: { ko: '{floor}층에 입장', en: 'Entered on floor {floor}' },
  stageExclusives: { ko: '이 팩에서 챙길 기프트', en: 'Gifts to collect in this pack' },
  stageExclusivesNone: { ko: '챙길 기프트 없음', en: 'Nothing to collect here' },
  stageGoalsFirst: { ko: '목표', en: 'Goals' },
  stageNext: { ko: '다음 층', en: 'Next floor' },
  stageDone: { ko: '{last}층까지 마쳤습니다', en: 'Floor {last} is done' },
  // The header's 초기화 is the only other way to start a run, and it takes the deck and the goals
  // with it. Mirror Dungeon is repeated content, so the common next move keeps both.
  stageNewRun: { ko: '같은 목표로 새 런', en: 'New run, same goals' },
  // Both of these throw a run away and neither can be undone, so both ask first — but only while
  // a run is actually in progress.
  confirmSharedTitle: {
    ko: '진행 중인 런을 버리고 링크를 열까요?',
    en: 'Discard the run in progress and open the link?',
  },
  confirmSharedMessage: {
    ko: '공유 링크는 보낸 사람의 덱·목표·설정으로 덮어씁니다. 지금 런의 기록은 되돌릴 수 없습니다.',
    en: "The link replaces your deck, goals and settings with the sender's. The current run record cannot be recovered.",
  },
  confirmSharedConfirm: { ko: '링크 열기', en: 'Open the link' },
  confirmSeasonTitle: {
    ko: '진행 중인 런을 버리고 시즌을 바꿀까요?',
    en: 'Discard the run in progress and change season?',
  },
  confirmSeasonMessage: {
    ko: '시즌을 바꾸면 런을 버리고, 새 시즌이 모르는 기프트·팩 설정도 빠집니다.',
    en: 'Changing season discards the run and drops any gift or pack setting the new season does not know.',
  },
  confirmSeasonConfirm: { ko: '시즌 바꾸기', en: 'Change season' },
  giftTileToggle: { ko: '{name} 획득 표시', en: 'Mark {name} as got' },
  trackerTitle: { ko: 'T4 기프트 추적', en: 'T4 gift tracker' },
  trackerGroupKeyword: { ko: '키워드', en: 'Keyword' },
  trackerGroupShard: { ko: '조각', en: 'Shards' },
  trackerGroupMemory: { ko: '기억', en: 'Memories' },
  trackerGroupAttack: { ko: '공격 유형', en: 'Attack type' },
  trackerGroupPlain: { ko: '키워드 없음', en: 'Keywordless' },
  trackerFusionNotice: {
    ko: '조합으로 소모한 조각 {a}개·기억 {b}개는 미획득으로 표시하세요.',
    en: 'Mark the {a} shards and {b} memories the fusion consumed as not got.',
  },
  trackerFusionHeld: { ko: '지금 획득으로 표시된 재료', en: 'Ingredients marked as got' },
  trackerUnmark: { ko: '미획득으로', en: 'Not got' },
  routeUnresolvedCount: { ko: '미해결 {n}', en: '{n} unresolved' },
  routeGoals: { ko: '목표 기프트', en: 'Goals' },
  settingsObserved: { ko: '관측 지정', en: 'Observe' },
  // `{names}` is a list of gift names, so the particle is picked by `josa` at the call site.
  unresolvedMissing: {
    ko: '재료 {names} 구할 수 없어 조합할 수 없습니다.',
    en: 'Cannot be fused: {names} cannot be obtained in this plan.',
  },
  actionObserveGift: { ko: '{name} 관측 지정', en: 'Observe {name}' },
  actionReleaseObservations: { ko: '관측 지정 해제', en: 'Unpin observations' },
  guide: { ko: '설명서', en: 'Guide' },
  guidePrev: { ko: '이전 카드', en: 'Previous card' },
  guideNext: { ko: '다음 카드', en: 'Next card' },
  guideDone: { ko: '닫기', en: 'Close' },
  guideCard: { ko: '{n} / {total} · {title}', en: '{n} / {total} · {title}' },
  guideNotice: { ko: '출처와 라이선스 (NOTICE)', en: 'Sources and licences (NOTICE)' },
} as const satisfies Record<string, Localized>;

export type StringKey = keyof typeof STRINGS;

export function t(key: StringKey, lang: Lang, params?: Record<string, string | number>): string {
  let out: string = STRINGS[key][lang];
  if (params)
    for (const [name, value] of Object.entries(params)) out = out.split(`{${name}}`).join(String(value));
  return out;
}

export function pick(value: Localized | undefined, lang: Lang): string {
  if (!value) return '';
  return value[lang] || value.ko || value.en;
}

/**
 * The guide the header's 「?」 opens, one card per section. It follows the visitor-facing sections
 * of `README.md` — same titles, same order — so a reader who met the README on GitHub finds the
 * same map here; `src/app/__tests__/guide.test.ts` holds every Korean title to a README heading.
 * The development section is left out: it is for someone cloning the repository, not using the
 * site. Each card says the least that gets a first-time visitor through that part of the page.
 */
export interface GuideCard {
  title: Localized;
  lines: Localized[];
  /** The card ends with the link to `NOTICE`. */
  notice?: true;
}

export const GUIDE_CARDS = [
  {
    title: { ko: '무엇을 해 주나', en: 'What it does' },
    lines: [
      {
        ko: '덱과 목표 E.G.O 기프트를 고르면, 그 기프트를 모으려면 몇 층에서 어느 테마팩에 들어가야 하는지 계산합니다.',
        en: 'Pick a deck and the E.G.O gifts you want, and it works out which theme pack to enter on which floor to collect them.',
      },
      {
        ko: '계산 순서: 조합 기프트를 재료로 펼치고 → 팩이 필요 없는 범용 드랍을 빼고 → 관측·시작 기프트를 정한 뒤 → 기프트마다 그것을 주는 팩을 골라 층에 앉힙니다.',
        en: 'In order: fusions are unfolded into ingredients → general drops, which need no pack, are set aside → observation and the starting gift are chosen → each gift gets a pack that gives it, seated on a floor.',
      },
      {
        ko: '전부 얻을 수 없으면 무엇을 목표에서 빼야 하는지, 왜 얻을 수 없는지 알려 줍니다.',
        en: 'When not everything fits, it says which goal to drop and why a gift cannot be had.',
      },
      {
        ko: '덱과 목표는 ⋯ 메뉴의 「링크 복사」로 공유할 수 있습니다.',
        en: 'Share the deck and goals with 「Copy link」 in the ⋯ menu.',
      },
    ],
  },
  {
    title: { ko: '덱', en: 'Deck' },
    lines: [
      {
        ko: '왼쪽 위 「덱」 버튼이 덱과 기프트 패널을 엽니다.',
        en: 'The 「Deck」 button at the top left opens the deck and gift panel.',
      },
      {
        ko: '수감자 칸을 눌러 인격을 고르거나, 게임의 편성 코드를 「코드 가져오기」에 붙여 넣습니다.',
        en: 'Press a sinner’s slot to pick an identity, or paste the game’s formation code into 「Import code」.',
      },
      {
        ko: '조건부 기프트는 대부분 출격한 인격만 셉니다. 칸의 「대기」를 눌러 「출격」으로 바꿔야 조건 판정이 맞습니다.',
        en: 'Most conditional gifts count deployed identities only. Switch a slot from 「Reserve」 to 「Deployed」 for the conditions to read right.',
      },
    ],
  },
  {
    title: { ko: '기프트', en: 'Gifts' },
    lines: [
      {
        ko: '기프트 탭에서 아이콘을 누르면 목표에 추가, 이름을 누르면 상세입니다.',
        en: 'In the Gifts tab, press an icon to add it as a goal, its name for the details.',
      },
      {
        ko: '탭에는 지금 덱으로 활성인 기프트만 나옵니다. 나머지는 검색하거나 검색창 끝의 >>(모두 보기)로 찾습니다. 초성 검색도 됩니다.',
        en: 'The tab lists the gifts your deck activates. Find the rest by search or with >> (Browse all) at the end of the search box.',
      },
      {
        ko: '아이콘의 바깥 링은 조건 판정(초록 충족 · 빨강 미충족), 오른쪽 아래 배지는 키워드입니다.',
        en: 'The ring around an icon is the condition (green met · red not met); the bottom-right badge is the keyword.',
      },
      {
        ko: '검색창 아래 관측 칸에 기프트를 넣으면 기프트 관측으로 받습니다. 조합 결과는 관측할 수 없으니 재료를 넣습니다. 1층을 떠나면 바꿀 수 없습니다.',
        en: 'Put a gift in an observation cell below the search box to take it through Gift Observation. A fusion cannot be observed — pin its ingredients. It locks once you leave floor 1.',
      },
    ],
  },
  {
    title: { ko: '루트', en: 'Route' },
    lines: [
      {
        ko: '오른쪽 위 「전체 루트」가 층별 테마팩을 노선도로 보여 줍니다.',
        en: '「Full route」 at the top right draws the packs floor by floor as a route map.',
      },
      {
        ko: '「획득 M/T」는 목표 중 루트가 가져다주는 수이고, 「범용 드랍」은 어느 팩에서나 나올 수 있지만 반드시 나오지는 않는 것입니다.',
        en: '「Got M/T」 counts the goals the route brings; 「General drops」 can come from any pack but are never guaranteed.',
      },
      {
        ko: '전부 얻을 수 없으면 요약 아래 카드가 어떤 기프트를 빼면 무엇이 달라지는지 한 줄씩 보여 줍니다. ✕는 목표에서 빼기, 경로 아이콘은 미리 보기입니다.',
        en: 'When not everything fits, a card under the summary lists what dropping each goal changes. ✕ removes it, the route icon previews it.',
      },
    ],
  },
  {
    title: { ko: '런', en: 'Run' },
    lines: [
      {
        ko: '가운데 무대에서 팩 카드의 「입장」을 누르거나 카드를 아래로 당겨 들어갑니다.',
        en: 'On the stage in the middle, press 「Enter」 on a pack card or pull the card down.',
      },
      {
        ko: '얻은 기프트는 아이콘을 눌러 획득으로 표시하세요. 표시하지 않고 층을 떠나면 「미획득」으로 남고, 다른 팩이 주는 것은 남은 층에서 다시 찾습니다.',
        en: 'Mark what you got by pressing its icon. Leaving a floor without marking records it as 「Not got」, and what another pack gives is routed again on the floors left.',
      },
      {
        ko: '「다음 층」으로 넘어가고 「입장 취소」로 되돌립니다. 층 칸을 눌러 지난 층을 다시 볼 수 있습니다.',
        en: '「Next floor」 moves on and 「Undo entry」 takes it back. Press a floor cell to look at a past floor.',
      },
    ],
  },
  {
    title: { ko: '데이터와 권리', en: 'Data and rights' },
    lines: [
      {
        ko: '게임 데이터와 텍스트의 권리는 Project Moon에 있습니다. 비상업 팬 프로젝트이며 Project Moon과 제휴하거나 승인받지 않았습니다.',
        en: 'Game data and text belong to Project Moon. This is a non-commercial fan project, not affiliated with or endorsed by Project Moon.',
      },
      {
        ko: '코드는 MIT 라이선스이고, 게임 데이터와 텍스트에는 적용되지 않습니다.',
        en: 'The code is MIT-licensed; that does not extend to the game data and text.',
      },
    ],
    notice: true,
  },
] as const satisfies readonly GuideCard[];
