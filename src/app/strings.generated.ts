// 생성 파일 — docs/copy.md의 「화면 문구」·「안내」에서 `npm run copy`가 만든다. 직접 고치지 않는다.
import type { Localized } from '../core/schema.ts';
import type { GuideCard } from './i18n.ts';

export const STRINGS = {
  // ── 공통 — 헤더·⋯ 메뉴·불러오기·푸터
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
  themeToggle: { ko: '테마 변경', en: 'Change theme' },
  giftIconSize: { ko: '기프트 아이콘 크기', en: 'Gift icon size' },
  textSize: { ko: '글자 크기', en: 'Text size' },
  sizeStep_sm: { ko: '작게', en: 'Small' },
  sizeStep_md: { ko: '보통', en: 'Medium' },
  sizeStep_lg: { ko: '크게', en: 'Large' },
  sizeStep_xl: { ko: '아주 크게', en: 'Extra large' },
  loading: { ko: '게임 데이터를 불러오는 중', en: 'Loading game data' },
  loadFailed: { ko: '게임 데이터를 불러오지 못했습니다', en: 'Could not load the game data' },
  retry: { ko: '다시 시도', en: 'Retry' },
  // DataLoadError는 문장이 아니라 원인을 실어 오므로 두 언어를 여기서 쓴다. {label}은 실패한 파일 이름.
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
  seasonProvisional: { ko: '데이터 일부 미확인', en: 'Some data not confirmed' },
  seasonProvisionalHint: {
    ko: '이 시즌은 아직 팩별 범용 드랍 풀을 확인하지 못했습니다. 전용 기프트와 조합은 계획할 수 있지만, 범용 드랍이 어느 팩에서 나오는지는 알 수 없습니다.',
    en: 'This season has no per-pack general drop pool yet. Exclusive gifts and fusions can be planned; which pack a general drop can come from is unknown.',
  },
  seasonDroppedGifts: {
    ko: '이번 시즌에 없는 기프트 {n}개를 뺐습니다',
    en: 'Dropped {n} gift(s) this season does not have',
  },
  // 푸터의 한 줄. 화면의 설명문은 이것과 데이터 버전 둘뿐이라는 규칙을 지킨다. 출처 목록은 너무 길어 NOTICE에 있고 링크로 닿는다.
  aboutData: {
    ko: '게임 데이터와 텍스트의 권리는 Project Moon에 있습니다. Project Moon과 제휴하거나 승인받지 않은 비상업 팬 프로젝트입니다.',
    en: 'Game data and text belong to Project Moon. A non-commercial fan project, not affiliated with or endorsed by Project Moon.',
  },
  aboutSource: { ko: '출처와 라이선스', en: 'Sources and licence' },
  searchClear: { ko: '검색어 지우기', en: 'Clear search' },
  // 건너뛰기 링크. 「스테이지」는 가운데 열을 어디서나 부르는 이름이다.
  skipToStage: { ko: '스테이지로 건너뛰기', en: 'Skip to the stage' },

  // ── 패널과 탭
  // 휴대폰 페이지의 제목은 그 페이지를 여는 헤더 문 이름이다.
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
  tabTracker: { ko: '추적기', en: 'Tracker' },

  // ── 덱 탭
  toDeck: { ko: '덱 탭으로', en: 'To the deck tab' },
  deckSearchAll: {
    ko: '전체 인격 검색 · 이름 · 소속 · 키워드',
    en: 'Search all identities · name · faction · keywords',
  },
  deckSearchHint: { ko: '{n}명', en: '{n} found' },
  deckSearchPicked: { ko: '덱에 {n}명', en: '{n} in the deck' },
  deckDefault: { ko: '기본 덱', en: 'Default deck' },
  deckDefaultConfirm: {
    ko: '덱을 LCB 수감자 12인으로 되돌릴까요?',
    en: 'Reset the deck to the 12 LCB sinners?',
  },
  deckDefaultConfirmBody: {
    ko: '지금 덱과 출격 설정이 바뀝니다.',
    en: 'The current deck and deployment are replaced.',
  },
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
  // 두 형태 모두 「특수 {keyword}」 한 낱말로 읽는다. 일반형도 세는지는 힌트가 말한다.
  deckKeywordSpecial: { ko: '특수 {keyword}', en: 'Unique {keyword}' },
  deckKeywordSpecialHint: {
    ko: '{keyword} 또는 특수 {keyword} 부여·획득 공격 스킬 보유',
    en: 'Has attack skills that inflict or gain {keyword} or Unique {keyword}',
  },
  deckKeywordSpecialOnly: { ko: '특수 {keyword}', en: 'Unique {keyword}' },
  // 탄환은 부여가 아니라 소모이고 늘 일반형으로 적는다 — 이 줄에는 특수 형태가 없다.
  deckKeywordUses: { ko: '{keyword} 소모 공격 스킬 보유', en: 'Has attack skills that spend {keyword}' },
  deckKeywordSpecialOnlyHint: {
    ko: '특수 {keyword}만 부여·획득 — 「또는 특수 {keyword}」 조건에만 셈',
    en: 'Only Unique {keyword} — counts only for conditions that say "or Unique {keyword}"',
  },
  deckSinnerSearch: { ko: '{sinner} 인격 검색', en: 'Search {sinner} identities' },
  deckShowing: { ko: '{total}명 중 {n}명', en: '{n} of {total}' },
  deckClose: { ko: '닫기', en: 'Close' },
  // 검색어 여러 개를 어떻게 합칠지 고르는 두 버튼의 묶음 이름.
  deckSearchMode: { ko: '검색어 조합', en: 'Match' },
  deckSearchModeOr: { ko: '하나라도', en: 'Any' },
  deckSearchModeAnd: { ko: '모두', en: 'All' },
  deckSearchModeOrHint: { ko: '검색어 중 하나라도 맞는 인격 (OR)', en: 'Identities matching any word (OR)' },
  deckSearchModeAndHint: {
    ko: '검색어가 모두 맞는 인격 (AND) — 예: 화상 파우스트',
    en: 'Identities matching every word (AND) — e.g. Burn Faust',
  },
  // 지금 덱의 그 수감자 칸에 들어 있는 인격의 검색 결과 행에 붙는 배지.
  deckInDeck: { ko: '편성 중', en: 'In deck' },
  // 그 수감자 칸에 LCB 수감자가 아닌 인격이 있을 때, 다른 인격 행 아래에 적는다(고르면 그것을 바꾼다).
  deckCurrent: { ko: '현재 편성: {identity}', en: 'In deck: {identity}' },
  deckPickerTitle: { ko: '{sinner} 인격 선택', en: 'Choose a {sinner} identity' },
  deckAttackTypes: { ko: '공격 유형', en: 'Attack types' },
  deckSins: { ko: '죄악 속성', en: 'Sin affinities' },

  // ── 기프트 탭
  giftsSearch: { ko: '기프트 검색', en: 'Search gifts' },
  giftsResults: { ko: '검색 결과', en: 'Search results' },
  giftsDeckEmpty: { ko: '덱이 비어 있습니다', en: 'The deck is empty' },
  giftsNoMatch: { ko: '일치하는 기프트 없음', en: 'No gift matches' },
  giftsSelected: { ko: '목표 {n}', en: 'Goals {n}' },
  giftsClear: { ko: '목표 비우기', en: 'Clear goals' },
  giftsClearConfirm: {
    ko: '목표 {n}개와 조합 설정·관측 지정을 모두 뺍니다.',
    en: 'Removes all {n} goals with their fusion settings and observation pins.',
  },
  giftsSort: { ko: '정렬', en: 'Sort' },
  giftsSortPicked: { ko: '추가한 순서', en: 'As added' },
  giftsSortName: { ko: '이름', en: 'Name' },
  giftsPack: { ko: '팩', en: 'Pack' },
  // 기프트 탭이 검색 중이 아닐 때 탭 아래에 서는 문. 「모두 보기」 브라우저를 「추천 기프트」 탭으로 연다.
  giftsRecommendOpen: { ko: '추천 기프트 보기', en: 'See recommended gifts' },
  removeFromSelection: { ko: '{name} 목표에서 빼기', en: 'Remove {name} from goals' },

  // ── 모두 보기 (전체 기프트 격자)
  // 「모두 보기」 브라우저(탭 검색줄 끝의 >>): 「추천 기프트」·「모든 기프트」 두 탭. 데스크톱은 스테이지 자리, 휴대폰은 페이지. 브라우저의 제목이기도 하다.
  giftsBrowseAll: { ko: '모두 보기', en: 'Browse all' },
  // 「모두 보기」의 둘째 탭 — 전체 기프트와 필터.
  giftsBrowseTitle: { ko: '모든 기프트', en: 'All gifts' },
  // 「모두 보기」의 첫 탭(열 때마다 이 탭으로 열린다) — 지금 덱으로 발동할 수 있는 기프트(M121).
  giftsBrowseRecommended: { ko: '추천 기프트', en: 'Recommended' },
  giftsBrowseClose: { ko: '닫기', en: 'Close' },
  giftsBrowseHide: { ko: '모두 보기 닫기', en: 'Close browse all' },

  // ── 추천 기프트 (모두 보기의 첫 탭)
  // 효과 중 하나라도 출격 인격으로 쓸 수 있고, 그 효과가 덱에 무언가(그 키워드를 부여·소모하는 스킬, 스킬 슬롯, 소속, 인격 전용 버프, 죄악·공격 유형, 코인·가중치, 방어 스킬)를 요구하는 기프트(M129). 「N인 이상」 머리 조건은 그 수치를 채워야 한다. 대기 인원은 세지 않는다.
  recDeckTitle: { ko: '덱 조건 충족', en: 'Deck conditions met' },
  // 덱에 요구가 없는 효과만 쓸 수 있는 기프트 중 팩 전용(테마팩 한정·클리어 보상)인 것. 적·자신의 상태나 전투 상황을 묻는 효과는 요구가 없는 것으로 본다. 범용은 덱과 상관없어 추천하지 않는다.
  recFreeTitle: { ko: '조건 없이 발동 · 팩 전용', en: 'No condition · pack-only' },
  // 효과를 막는 조건이 E.G.O 스킬 조건뿐인 기프트(M129, 소유자 결정). 인격의 E.G.O 데이터가 없어 늘 충족으로 보되 추천 맨 아래에 따로 둔다. 획득 종류와 상관없이 넣는다.
  recEgoTitle: { ko: 'E.G.O 스킬 조건', en: 'E.G.O skill condition' },
  recAcquisition: { ko: '획득', en: 'Source' },
  // 테마팩 한정·클리어 보상(isPackBound).
  recAcqPack: { ko: '팩 전용', en: 'Pack-only' },
  // 팩 전용이 아닌 것 전부 — 범용 드랍, 조합, 시작 기프트 등.
  recAcqGeneral: { ko: '범용', en: 'General' },
  recFusion: { ko: '조합 기프트 포함', en: 'Include fusions' },
  recSortKeyword: { ko: '키워드별', en: 'By keyword' },
  // 팩 전용 먼저, 그다음 조건 진행률, id(compareEntries).
  recSortPack: { ko: '팩 전용 먼저', en: 'Pack-only first' },
  recDeckNone: {
    ko: '지금 덱으로 조건을 채우는 기프트가 없습니다',
    en: 'The deck meets no gift condition right now',
  },
  // 덱 조건 충족이 비었고 출격한 인격이 0명일 때. 조건 대부분이 출격 인원을 센다.
  recNoDeployed: {
    ko: '출격한 인격이 없습니다. 조건 대부분은 출격 인원으로 셉니다.',
    en: 'No identity is deployed. Most conditions count deployed identities.',
  },

  // ── 기프트 필터·획득 분류·죄악
  filterReset: { ko: '필터 초기화', en: 'Reset filters' },
  filterKeyword: { ko: '키워드', en: 'Keyword' },
  // 덱이 기프트를 판정하는지(hasDeckCondition): 임계값 있는 키워드 수나 소속 수. 효과 강화·완전 공명은 덱 조건이 아니다.
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
  condResonance: { ko: '공명', en: 'Resonance' },
  condMet: { ko: '충족', en: 'Met' },
  condUnmet: { ko: '미충족', en: 'Not met' },

  // ── 관측 지정
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
  // 관측 토글은 어디서나 같게 읽힌다(팩 시트·시작 줄·기프트 시트·슬롯): 꺼짐 「관측 지정」, 켜짐 「지정됨」, 해제 「{name} 지정 해제」.
  observePinned: { ko: '지정됨', en: 'Pinned' },
  observeSlotClear: { ko: '{name} 지정 해제', en: 'Unpin {name}' },
  // M120: 관측 칸 목록의 맨 위. 누르면 그 칸을 쓰지 않는다(계획이 관측을 하나 덜 쓴다).
  observeSlotSkip: { ko: '관측하지 않기', en: "Don't observe" },
  observeSlotOff: { ko: '관측 안 함', en: 'Not observing' },
  observeSlotOn: { ko: '관측 안 함 해제', en: 'Use this slot again' },
  observeSlotNone: { ko: '관측할 수 있는 목표 기프트가 없습니다', en: 'No goal gift can be observed' },
  settingsObserved: { ko: '관측 지정', en: 'Observe' },

  // ── 기프트 상세 시트
  // 효과(줄) 하나가 지금 출격 인격으로 발동한다(M129). 시트의 효과 줄 막대와 함께 화면 낭독기에 읽힌다.
  effActive: { ko: '발동', en: 'Active' },
  // 효과가 지금 출격 인격으로는 발동하지 않는다(M129). 점선 막대·흐린 글자와 함께 읽힌다.
  effInactive: { ko: '발동하지 않음', en: 'Not active' },
  // 덱에 아무것도 요구하지 않는 효과의 팝오버 한 줄.
  effNoCondition: { ko: '조건 없음', en: 'No condition' },
  // 요구를 채우는 출격 인격이 없다.
  effNone: { ko: '없음', en: 'None' },
  // 팝오버의 한 줄: 요구 이름 — 그것을 채우는 인격(슬롯). 예: 「파열 스킬 — LCB 수감자 이상 S1·S3」.
  effWho: { ko: '{req} — {who}', en: '{req} — {who}' },
  // 「N인 이상」 요구의 개수(채운 수/필요 수).
  effCount: { ko: '{have}/{need}명', en: '{have}/{need}' },
  // 인격 이름 뒤의 스킬 슬롯 목록. 예: 「S1·S3」.
  effSlot: { ko: 'S{slots}', en: 'S{slots}' },
  // 그 키워드를 부여·획득·소모하는 기본 스킬.
  effReqKeyword: { ko: '{keywords} 스킬', en: '{keywords} skill' },
  // 「스킬 N」을 지정한 키워드 스킬.
  effReqKeywordSlot: { ko: '{keywords} 스킬 {slot}', en: '{keywords} Skill {slot}' },
  // 자신에게 그 키워드를 부여하는 스킬.
  effReqSelfGain: { ko: '자신에게 {keywords} 부여 스킬', en: 'Skill giving self {keywords}' },
  // 자신의 그 키워드를 소모하는 스킬.
  effReqSelfConsume: { ko: '자신의 {keywords} 소모 스킬', en: 'Skill spending own {keywords}' },
  // 기프트가 주지 않아 인격만 가져오는 버프(진동 - 작열·각력【묘】·버림 등).
  effReqIdentityBuff: { ko: '인격 전용 효과', en: 'Identity-only effect' },
  // 소속 요구.
  effReqFaction: { ko: '{factions} 소속', en: '{factions}' },
  // 특정 인격 편성 요구.
  effReqIdentity: { ko: '{names} 편성', en: '{names} in the team' },
  // 죄악·공격 유형 스킬 요구. 예: 「오만 관통 스킬」.
  effReqSkill: { ko: '{what} 스킬', en: '{what} skill' },
  // 죄악 공명 요구.
  effReqResonance: { ko: '{sins} 공명', en: '{sins} resonance' },
  // 스킬 구조: 코인 하나.
  effReqSingleCoin: { ko: '단일 코인 스킬', en: 'Single-coin skill' },
  // 스킬 구조: 코인 수 N 이하.
  effReqCoinsAtMost: { ko: '코인 {n}개 이하 스킬', en: 'Skill with {n} or fewer coins' },
  // 스킬 구조: 코인 수 N 이상.
  effReqCoinsAtLeast: { ko: '코인 {n}개 이상 스킬', en: 'Skill with {n}+ coins' },
  // 스킬 구조: 더하기 코인.
  effReqPlusCoin: { ko: '더하기 코인 스킬', en: 'Plus-coin skill' },
  // 스킬 구조: 빼기 코인.
  effReqMinusCoin: { ko: '빼기 코인 스킬', en: 'Minus-coin skill' },
  // 스킬 구조: 파괴 불가 코인.
  effReqUnbreakable: { ko: '파괴 불가 코인 스킬', en: 'Unbreakable-coin skill' },
  // 스킬 구조: 공격 가중치 N 이상.
  effReqWeightAtLeast: { ko: '공격 가중치 {n} 이상 스킬', en: 'Attack weight {n}+ skill' },
  // 스킬 구조: 공격 가중치 N.
  effReqWeightExactly: { ko: '공격 가중치 {n} 스킬', en: 'Attack weight {n} skill' },
  // 방어 스킬 유형 요구.
  effReqDefense: { ko: '{kinds} 스킬', en: '{kinds} skill' },
  // E.G.O 스킬 조건 — 판정하지 않고 늘 충족으로 본다.
  effReqEgo: { ko: 'E.G.O 스킬 (판정하지 않음)', en: 'E.G.O skill (not judged)' },
  // 방어 스킬 유형: 수비.
  effDefGuard: { ko: '수비', en: 'Guard' },
  // 방어 스킬 유형: 회피.
  effDefEvade: { ko: '회피', en: 'Evade' },
  // 방어 스킬 유형: 반격.
  effDefCounter: { ko: '반격', en: 'Counter' },
  giftSubOf: { ko: '{parent} 재료', en: 'Ingredient of {parent}' },
  giftMaterials: { ko: '조합식', en: 'Recipe' },
  giftSubRecipe: { ko: '{name}도 조합이다 — 그 재료', en: '{name} is a fusion too — its ingredients' },
  giftMixedRecipe: {
    ko: '키워드 상위 {aOf}종 중 {a}개 + 공격 유형 {bOf}종 중 {b}개',
    en: '{a} of {aOf} keyword capstones + {b} of {bOf} attack-type ones',
  },
  giftPackOnly: { ko: '{name} 전용', en: 'only from {name}' },
  // 전용 팩이 셋 이상이면(53개 기프트, 인연 얽힘은 일곱) 첫 팩만 이름을 적고 나머지는 센다 — 한 줄을 유지한다.
  giftPackOnlyMany: { ko: '{name} 외 {n}개 팩 전용', en: 'only from {name} and {n} other packs' },
  // {source}는 routeSourceText — 이 루트가 그 기프트를 어디서 얻는지.
  giftRouteSource: { ko: '이 루트에서는 {source}', en: 'In this route: {source}' },
  giftBlockedIncluded: { ko: '{name} 조합에 이미 포함됨', en: 'Already part of {name}' },
  giftEntangled: { ko: '얽힘', en: 'Entangled' },
  // {name}은 기프트 이름이라 조사는 호출하는 곳에서 josa로 붙인다.
  giftEntangledWith: { ko: '{name} 재료가 겹칩니다: {list}', en: 'shares ingredients with {name}: {list}' },
  giftDetail: { ko: '{name} 자세히', en: '{name} details' },
  giftDetailBack: { ko: '{name} 설명으로 돌아가기', en: 'Back to {name}' },
  // 강화(M130) — 목표 타일과 기프트 시트의 `+`·`++` 버튼 묶음의 이름. 버튼 글자는 `+`·`++` 그대로다.
  giftUpgradeGroup: { ko: '{name} 강화 단계', en: '{name} enhancement' },
  // {step}은 `+` 또는 `++`. 누른 단계를 다시 누르면 강화 전으로 돌아간다.
  giftUpgradeStep: { ko: '{name} 강화 {step}', en: '{name} enhanced {step}' },
  giftExclusive: { ko: '전용', en: 'Exclusive' },
  giftWanted: { ko: '목표', en: 'Goal' },
  giftUnjudgeable: { ko: '판정 불가', en: 'Cannot judge' },
  // 기프트가 목표가 되거나 빠지는 모든 곳(기프트 시트, 팩 시트의 줄)이 이 둘을 쓴다. 트레이 타일의 ✕와 결정 카드는 이름을 붙여 같은 말을 한다.
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

  // ── 시작 키워드 (기프트 탭 맨 아래)
  optionStartKeyword: { ko: '시작 키워드', en: 'Start keyword' },
  optionAuto: { ko: '자동', en: 'Auto' },
  optionAutoResolved: { ko: '자동 ({keyword})', en: 'Auto ({keyword})' },
  // 기프트 이름에 조사가 붙어서 오므로(withJosa) 문장에는 조사가 없다.
  startKeywordGives: { ko: '{keyword}: {gift} 시작 기프트로 받습니다', en: '{keyword}: starts with {gift}' },
  startKeywordAutoWould: {
    ko: '자동으로 두면 {gift} 시작 기프트로 받습니다',
    en: 'On auto, the run would start with {gift}',
  },
  startKeywordFree: {
    ko: '목표에 영향이 없으니 원하는 키워드를 골라도 됩니다',
    en: 'No goal depends on it, so pick any keyword',
  },

  // ── 전체 루트 패널
  routeRequiredPacks: { ko: '필요 팩', en: 'Packs' },
  routeCovered: { ko: '획득', en: 'Got' },
  routeApprox: { ko: '근사 결과', en: 'Near-best' },
  routeStart: { ko: '시작', en: 'Start' },
  routeStartGift: { ko: '시작 기프트', en: 'Starting gift' },
  routeObserved: { ko: '관측', en: 'Observed' },
  routeObservedEmpty: { ko: '관측 빈 칸', en: 'Free observation slot' },
  // 예전엔 「관측」이 aria-label에만 있어 빈 점선 눈 셋이 터치·키보드 사용자에게 아무 말도 하지 않았다. 보이는 라벨과 비었을 때의 이유를 단다.
  routeObservedNone: { ko: '추천할 관측이 없습니다', en: 'Nothing worth observing' },
  // 런 중에는 관측 결정이 지났으므로 이 줄은 추천이 아니라 실제로 무엇으로 시작했는지의 기록이다(1층을 떠나면 core가 start.observed를 비운다).
  routeStartHeld: { ko: '시작 시 획득', en: 'Got at start' },
  routeStartHeldNone: { ko: '관측 없이 시작했습니다', en: 'Started with no observations' },
  routeObservedPinned: { ko: '지정', en: 'Pinned' },
  routeObservedRecommended: { ko: '추천', en: 'Suggested' },
  routeObservedFrees: { ko: '{pack} 안 가도 됨', en: 'No need to enter {pack}' },
  routeObservedRescue: { ko: '루트로는 얻을 수 없어 관측', en: 'Unreachable by route, so observe it' },
  routeVariantWithout: { ko: '{name} 빼면', en: 'Without {name}' },
  // 결정 카드: 한 런에 다 들어가지 않을 때 무엇을 목표에서 뺄지 묻는 한 곳. {names}는 충돌하는 기프트 이름 목록.
  routeDecisionTitle: {
    ko: '전부 얻을 수 없습니다 · {names} 중 하나를 목표에서 빼야 합니다',
    en: 'They do not all fit one run · remove one of {names} from the goals',
  },
  // 하나로는 해결되지 않을 때: {n}은 빼야 하는 수(core의 minDrops).
  routeDecisionTitleMany: {
    ko: '전부 얻을 수 없습니다 · {names} 중 {n}개를 목표에서 빼야 합니다',
    en: 'They do not all fit one run · remove {n} of {names} from the goals',
  },
  // M80: 목표마다 「혼자 뺐을 때 줄어드는 충돌」 막대를 그리고, 막대를 더하지 않고 고른 집합을 플래너로 실제 계산한다.
  routeDecisionEffects: { ko: '뺐을 때 줄어드는 충돌', en: 'Conflicts cleared when left out' },
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
  routeDecisionDropConfirm: { ko: '{n}개를 목표에서 뺄까요?', en: 'Remove {n} from the goals?' },
  routeDecisionPreview: { ko: '루트 미리 보기', en: 'Preview route' },
  routeDecisionDropSelected: { ko: '선택한 {n}개 목표에서 빼기', en: 'Remove {n} from goals' },
  routeDecisionPending: { ko: '대안 계산 중…', en: 'Computing alternatives…' },
  // M115: 맞바꿈(`tradeoffs`)을 구했으면 머리는 이것이고, 그 아래 줄들이 양쪽 이름을 말한다.
  routeDecisionTitleShort: { ko: '전부 얻을 수 없습니다', en: 'They do not all fit one run' },
  routeDecisionTitleShortMany: {
    ko: '전부 얻을 수 없습니다 · {n}개를 목표에서 빼야 합니다',
    en: 'They do not all fit one run · remove {n} from the goals',
  },
  // 막대가 오기 전: 놓친 목표 하나를 반드시로 둔 계획이 대신 잃는 목표. 「빼야 한다」고 단정하지 않는다 — 같은 자리를 다투는 목표가 여럿이면 탐색이 그중 하나를 고른 것이다.
  routeDecisionTradeoff: {
    ko: '{lost}을(를) 얻는 루트에서는 {causes}이(가) 빠집니다',
    en: 'A route that gets {lost} leaves out {causes}',
  },
  // 계산한 막대 중 혼자 빼면 그 목표가 사는 것(`rivals`)이 둘 이상일 때. 각 막대가 실제로 계산한 사실이다.
  routeDecisionTradeoffAny: {
    ko: '{lost}을(를) 얻으려면 {names} 중 하나를 빼면 됩니다',
    en: 'To get {lost}, remove any one of {names}',
  },
  routeDecisionTradeoffOne: {
    ko: '{lost}을(를) 얻으려면 {name}을(를) 빼면 됩니다',
    en: 'To get {lost}, remove {name}',
  },
  // 막대의 역할 표식. 원인 = 맞바꿈 상대.
  routeDecisionRoleCause: { ko: '원인', en: 'Cause' },
  routeDecisionRoleLost: { ko: '놓친 목표', en: 'Left out' },
  routeDecisionRoleStart: { ko: '시작 기프트', en: 'Start gift' },
  // `wanted`의 마지막 — 고른 순서대로 쌓이므로 마지막에 고른 목표다.
  routeDecisionLastAdded: { ko: '마지막에 추가', en: 'Added last' },
  // −0 막대 아래: 같은 팩을 쓰는 다른 목표가 남아 그 팩에 여전히 들어간다.
  routeDecisionSharesPack: {
    ko: '혼자 빼면 자리가 나지 않습니다 · 같은 팩: {names}',
    en: 'Frees nothing alone · same pack: {names}',
  },
  // 후보가 상한(10개)이나 계산 예산에 잘렸을 때.
  routeDecisionMeasured: {
    ko: '후보 {total}개 중 {done}개 계산',
    en: '{done} of {total} candidates measured',
  },
  routeDecisionMore: { ko: '더 계산', en: 'Measure the rest' },
  routeDecisionCandidates: { ko: '뺄 후보', en: 'Candidates to remove' },
  routeClose: { ko: '닫기', en: 'Close' },
  packGifts: { ko: '이 팩의 기프트', en: 'Gifts from this pack' },
  packFloorRange: { ko: '{floors}층', en: 'Floors {floors}' },
  routeFree: { ko: '자유', en: 'Free' },
  routeFloorRange: { ko: '{from}~{to}층', en: 'Floors {from}–{to}' },
  routeConditions: { ko: '조건 판정', en: 'Conditions' },
  routeConditionsBasis: { ko: '출격 {n} 기준', en: 'for {n} deployed' },
  routeWarnings: { ko: '참고', en: 'Notes' },
  // 새 루트를 계산하는 동안 이전 루트 위에 뜬다. 「계산 중」이 아닌 것은 보이는 것이 빈 패널이 아니라 한 박자 늦은, 여전히 쓸 수 있는 루트이기 때문이다.
  routeRecomputing: { ko: '갱신 중…', en: 'updating…' },
  // 이 루트가 기프트를 얻는 곳(routeSourceText): 층과 팩 / 관측 / 시작 기프트 / 범용 드랍 / 몇 층 이후 조합.
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
  // 런의 미획득이 조합을 죽였을 때 전체 루트 탭 맨 위(FusionLostNotice).
  fusionLostTitle: { ko: '조합 불가로 루트 변경', en: 'Route changed: fusion lost' },
  fusionLostText: {
    ko: '{missing} 얻지 못해 {result} 조합할 수 없습니다. 루트를 다시 계산했습니다.',
    en: '{missing} was not got, so {result} cannot be fused. The route was re-planned.',
  },
  // 죽은 조합 아래의 토글 하나: 남은 재료를 위해 계속 팩에 들어간다.
  fusionLostCollect: { ko: '{name} 남은 재료 모으기', en: 'Keep collecting the rest of {name}' },
  // 남은 재료 아래의 상태 막대: 지금 루트가 그것들을 어떻게 하는지.
  fusionLostCollecting: { ko: '모으기', en: 'Collect' },
  fusionLostNotCollecting: { ko: '모으지 않기', en: "Don't collect" },
  fusionLostKept: {
    ko: '남은 재료({names})는 계속 모으러 갑니다.',
    en: 'The route still goes after the remaining ingredients ({names}).',
  },
  unresolvedDropped: {
    ko: '나머지 재료({names})만을 위한 입장은 취소했습니다.',
    en: 'Pack entries for the remaining ingredients ({names}) alone were dropped.',
  },

  // ── 스테이지 (가운데 런 화면)
  floorStrip: { ko: '층', en: 'Floors' },
  runActive: { ko: '진행 중', en: 'In progress' },
  runCurrentFloor: { ko: '현재 층', en: 'Current floor' },
  runVisited: { ko: '{floor}층 입장', en: 'Entered on floor {floor}' },
  runVisitedShort: { ko: '입장 · {floor}층', en: 'Entered · F{floor}' },
  runPassed: { ko: '지남', en: 'Passed' },
  giftStatusGot: { ko: '획득', en: 'Got' },
  giftStatusFailed: { ko: '미획득', en: 'Not got' },
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
  // 헤더의 초기화는 덱과 목표까지 지운다. 거울 던전은 반복 컨텐츠라 흔한 다음 행동은 둘 다 남기는 것이다.
  stageNewRun: { ko: '같은 목표로 새 런', en: 'New run, same goals' },
  giftTileToggle: { ko: '{name} 획득 표시', en: 'Mark {name} as got' },

  // ── 화면 인식 (헤더 버튼과 팝오버)
  captureTitle: { ko: '화면 인식', en: 'Screen reader' },
  captureStart: { ko: '화면 인식 시작', en: 'Start reading the screen' },
  captureStop: { ko: '중지', en: 'Stop' },
  captureIdle: {
    ko: '게임 창을 공유하면 팩 입장과 기프트 획득을 자동으로 기록합니다',
    en: 'Share the game window to record pack entries and gifts automatically',
  },
  captureStarting: { ko: '게임 창 연결 중', en: 'Connecting to the game window' },
  captureRunning: { ko: '인식 중', en: 'Reading' },
  captureErrShort: { ko: '오류', en: 'Error' },
  captureAsking: { ko: '확인할 것 {n}개', en: '{n} to confirm' },
  capturePrivacy: {
    ko: '화면은 이 브라우저 안에서만 읽고 어디로도 보내지 않습니다',
    en: 'The screen is read in this browser only and sent nowhere',
  },
  captureErr_unsupported: {
    ko: '이 브라우저는 화면 공유를 지원하지 않습니다',
    en: 'This browser cannot share a screen',
  },
  captureErr_denied: {
    ko: '화면 공유를 허용하지 않았습니다. 다시 시작하면 다시 묻습니다',
    en: 'Screen sharing was not allowed. Starting again asks again',
  },
  captureErr_ended: { ko: '화면 공유가 끝났습니다', en: 'Screen sharing ended' },
  captureErr_engine: {
    ko: '글자 인식 엔진을 불러오지 못했습니다',
    en: 'Could not load the text recognition engine',
  },
  captureErr_layout: { ko: '화면 배치 정보를 불러오지 못했습니다', en: 'Could not load the screen layout' },
  captureInterval: { ko: '판독 간격', en: 'Read interval' },
  captureInterval_economy: { ko: '최고 성능 · 1초', en: 'Lightest · 1 s' },
  captureInterval_performance: { ko: '성능 · 0.5초', en: 'Light · 0.5 s' },
  captureInterval_balanced: { ko: '밸런스 · 0.25초', en: 'Balanced · 0.25 s' },
  captureInterval_quality: { ko: '품질 · 0.125초', en: 'Quality · 0.125 s' },
  captureLang: { ko: '게임 언어', en: 'Game language' },
  captureLang_ko: { ko: '한국어', en: 'Korean' },
  captureLang_en: { ko: 'English (화면 제목 미확인)', en: 'English (screen titles not known yet)' },
  captureLog: { ko: '기록', en: 'Log' },
  captureLogEmpty: { ko: '아직 기록한 것이 없습니다', en: 'Nothing recorded yet' },
  captureLogEnter: { ko: '{floor}층 입장 · {name}', en: 'Floor {floor} entered · {name}' },
  captureLogGot: { ko: '획득 · {name}', en: 'Got · {name}' },
  captureLogSold: { ko: '판매 · {name}', en: 'Sold · {name}' },
  captureLogFused: { ko: '합성 · {name}', en: 'Fused · {name}' },
  captureLogAnswer: { ko: '직접 고름 · {name}', en: 'Picked · {name}' },
  captureUndo: { ko: '되돌리기', en: 'Undo' },
  captureUndone: { ko: '되돌림', en: 'Undone' },
  captureAskGift: { ko: '어느 기프트를 얻었나요?', en: 'Which gift did you get?' },
  captureAskPack: {
    ko: '{floor}층에서 어느 팩에 입장했나요?',
    en: 'Which pack did you enter on floor {floor}?',
  },
  captureAskConsumed: {
    ko: '{name} 합성에 쓴 기프트를 골라 주세요',
    en: 'Pick the gifts the {name} fusion used',
  },
  captureAskApply: { ko: '적용', en: 'Apply' },
  captureAskDismiss: { ko: '무시', en: 'Ignore' },

  // ── 진단 기록 (소유자 전용 — 주소에 #diag를 붙여 열 때만)
  diagTitle: { ko: '진단 기록 (소유자용)', en: 'Diagnostics (owner only)' },
  diagHide: { ko: '숨기기', en: 'Hide' },
  diagRecord: { ko: '진단 기록', en: 'Record diagnostics' },
  diagImages: { ko: '화면 이미지 포함', en: 'Include screen images' },
  diagImagesWarn: {
    ko: '이미지에는 게임 화면이 들어 있습니다. 공개된 곳에 올리지 마세요.',
    en: 'Images contain game screens. Do not post them anywhere public.',
  },
  diagEmpty: { ko: '아직 기록이 없습니다', en: 'Nothing recorded yet' },
  diagStats: {
    ko: '기록 {records}건 · 이미지 {frames}장 · 약 {mb}MB',
    en: '{records} records · {frames} images · about {mb} MB',
  },
  diagLastExport: { ko: '마지막 내보내기 {time}', en: 'last exported {time}' },
  diagFull: {
    ko: '기록이 가득 찼습니다(2만 건). 내보내고 지워야 다시 기록합니다.',
    en: 'The record is full (20,000). Export and clear it to record again.',
  },
  diagTrimmed: {
    ko: '이미지 상한을 넘어 오래된 {n}장을 지웠습니다.',
    en: 'Over the image cap: the oldest {n} were dropped.',
  },
  diagSavedTitle: { ko: '내보낸 뒤 정리', en: 'After exporting' },
  diagSavedPrompt: {
    ko: '{name}을(를) 저장했으면 기기의 기록을 지우세요. 그 파일 하나만 전달하면 됩니다.',
    en: 'Once {name} is saved, clear the record on this device. That one file is all you hand over.',
  },
  diagClearExported: { ko: '기록 지우기', en: 'Clear the record' },
  diagLater: { ko: '나중에', en: 'Later' },
  diagExportedLeft: {
    ko: '내보낸 기록 {n}건이 아직 기기에 남아 있습니다',
    en: '{n} exported records are still on this device',
  },
  diagCleared: {
    ko: '기록 {records}건과 이미지 {frames}장을 지웠습니다.',
    en: 'Cleared {records} records and {frames} images.',
  },
  diagExport: { ko: '내보내기', en: 'Export' },
  diagExportFailed: {
    ko: '내보내지 못했습니다. 기록은 그대로 남아 있으니 다시 내보내 보세요.',
    en: 'The export failed. Everything is still on this device; try exporting again.',
  },
  diagClearAll: { ko: '모두 지우기', en: 'Clear all' },
  diagClearAllConfirm: {
    ko: '내보내지 않은 것까지 기록 {records}건과 이미지 {frames}장을 모두 지웁니다. 되돌릴 수 없습니다.',
    en: 'This clears all {records} records and {frames} images, exported or not. It cannot be undone.',
  },
  diagWhere: {
    ko: '보낼 곳: 내보낸 zip을 Claude Code 개발 세션에 첨부하고 「진단 기록 분석해 줘」라고 보내세요. 직접 돌릴 때는 개발 저장소의 local-fixtures/sessions/에 넣고 npm run capture:feedback을 실행합니다. 게임 화면이 들어 있으니 이슈·채팅방 같은 공개된 곳에는 올리지 마세요.',
    en: 'Where it goes: attach the exported zip to a Claude Code development session and say “analyse the diagnostics”. To run it yourself, put it in local-fixtures/sessions/ of the development repository and run npm run capture:feedback. It contains game screens, so keep it out of public places such as issues and chat rooms.',
  },

  // ── 피드백 보내기 (⋯ 메뉴와 그 창)
  feedback: { ko: '피드백 보내기', en: 'Send feedback' },
  feedbackIntro: {
    ko: '버그·제안·데이터 오류를 GitHub 이슈로 보냅니다. 내용만 쓰면 앱 상태와 기록은 자동으로 붙습니다.',
    en: 'Report a bug, an idea or a data error as a GitHub issue. Write what happened; the app attaches its state and logs.',
  },
  feedbackKindLabel: { ko: '종류', en: 'Type' },
  feedbackKind_bug: { ko: '버그', en: 'Bug' },
  feedbackKind_idea: { ko: '제안', en: 'Suggestion' },
  feedbackKind_data: { ko: '데이터 오류', en: 'Data error' },
  feedbackKind_other: { ko: '기타', en: 'Other' },
  feedbackTitleLabel: { ko: '제목 (선택)', en: 'Title (optional)' },
  feedbackTitlePlaceholder: {
    ko: '비워 두면 내용의 첫 줄을 씁니다',
    en: 'Left empty, the first line of the message is used',
  },
  feedbackMessageLabel: { ko: '내용', en: 'Message' },
  feedbackMessagePlaceholder: {
    ko: '무엇을 했고, 무엇이 일어났고, 무엇을 기대했는지 적어 주세요.',
    en: 'What you did, what happened, and what you expected.',
  },
  feedbackMessageRequired: { ko: '내용을 적어 주세요.', en: 'Please write a message.' },
  feedbackAttach: { ko: '함께 보낼 것', en: 'Attach' },
  feedbackAttachState: {
    ko: '앱 상태 첨부 (덱·목표·설정·런·루트 요약)',
    en: 'App state (deck, goals, settings, run, route summary)',
  },
  feedbackAttachLog: { ko: '오류·조작 기록 첨부', en: 'Error and action log' },
  feedbackAttachDiag: { ko: '피드백용 진단 기록 첨부 ({n}건)', en: 'Feedback diagnostics ({n} records)' },
  feedbackDiagTitle: { ko: '피드백용 진단 기록', en: 'Feedback diagnostics' },
  feedbackDiagRecord: { ko: '기록하기', en: 'Record' },
  feedbackDiagHint: {
    ko: '켜 두면 오류·런 변경·층별 루트 결과와 화면 인식이 읽은 내용(글자만, 게임 화면 제외)을 이 기기에만 남깁니다. 피드백을 보낼 때만 함께 갑니다.',
    en: "While on, errors, run changes, each floor's route outcome and what the screen reader read (text only, no game screens) stay on this device. They leave it only with feedback you send.",
  },
  feedbackDiagCount: { ko: '기록 {n}건', en: '{n} records' },
  feedbackDiagEmpty: { ko: '아직 기록이 없습니다', en: 'Nothing recorded yet' },
  feedbackDiagClear: { ko: '지우기', en: 'Clear' },
  feedbackShot: { ko: '앱 화면을 클립보드에 복사', en: 'Copy the app screen to the clipboard' },
  feedbackShotHint: {
    ko: '이 앱의 화면만 찍습니다(게임 화면은 찍지 않습니다). 이슈 본문에 Ctrl+V(붙여넣기)로 붙일 수 있습니다.',
    en: "Takes only this app's screen, never the game's. Paste it into the issue body with Ctrl+V.",
  },
  feedbackShotCopied: {
    ko: '앱 화면을 복사했습니다 · 이슈 본문에 Ctrl+V로 붙여 넣으세요',
    en: 'App screen copied · paste it into the issue body with Ctrl+V',
  },
  feedbackShotDownloaded: {
    ko: '이 브라우저는 그림을 복사하지 못해 PNG로 내려받았습니다 · 이슈 본문에 끌어다 놓으세요',
    en: 'This browser cannot copy pictures, so it was downloaded as a PNG · drag it into the issue body',
  },
  feedbackShotFailed: { ko: '앱 화면을 찍지 못했습니다', en: 'Could not take the app screen' },
  feedbackPrivacy: {
    ko: '이슈는 공개됩니다. 덱·목표·설정과 체크한 기록이 함께 올라가고, 게임 화면은 보내지 않습니다.',
    en: 'Issues are public. Your deck, goals, settings and the ticked logs go with it; no game screens are sent.',
  },
  feedbackOpen: { ko: 'GitHub에서 이슈 열기', en: 'Open the issue on GitHub' },
  feedbackCopy: { ko: '내용 복사', en: 'Copy text' },
  feedbackCopied: {
    ko: '내용을 복사했습니다 · GitHub 이슈 본문에 붙여 넣으세요',
    en: 'Text copied · paste it into the GitHub issue body',
  },
  feedbackCopyHint: {
    ko: 'GitHub 계정이 필요합니다. 이슈 창이 열리지 않거나 본문이 비어 있으면 「내용 복사」 뒤 본문에 붙여 넣으세요.',
    en: 'You need a GitHub account. If the issue page does not open or its body is empty, use 「Copy text」 and paste it in.',
  },
  feedbackTrimmed: {
    ko: '기록이 길어 주소에는 일부만 담았습니다. 전체는 「내용 복사」에 있습니다.',
    en: 'The logs are long, so the link carries part of them. 「Copy text」 has everything.',
  },
  feedbackTooLong: {
    ko: '내용이 길어 주소에 담지 못합니다. 「GitHub에서 이슈 열기」를 누르면 전체를 클립보드에 복사하니 본문에 붙여 넣으세요.',
    en: 'The message is too long for the link. 「Open the issue on GitHub」 copies everything to the clipboard; paste it into the body.',
  },

  // ── 피드백 이슈 본문 (GitHub에 미리 채워지는 글)
  // {kind}는 종류(버그·제안…), {text}는 방문자가 쓴 제목이나 내용의 첫 줄.
  feedbackIssueTitle: { ko: '[{kind}] {text}', en: '[{kind}] {text}' },
  feedbackBodyMessage: { ko: '내용', en: 'Message' },
  feedbackBodyEnv: { ko: '환경', en: 'Environment' },
  feedbackBodyEnvData: { ko: '데이터 {dataVersion} · {season}', en: 'Data {dataVersion} · {season}' },
  feedbackBodyEnvDevice: {
    ko: '{browser} · 화면 {viewport} · {input} · 언어 {lang} · {theme}',
    en: '{browser} · viewport {viewport} · {input} · language {lang} · {theme}',
  },
  feedbackBodyTouch: { ko: '터치', en: 'touch' },
  feedbackBodyMouse: { ko: '마우스', en: 'mouse' },
  feedbackBodyDark: { ko: '다크', en: 'dark' },
  feedbackBodyLight: { ko: '라이트', en: 'light' },
  feedbackBodyState: { ko: '상태', en: 'State' },
  // 마크다운 링크. {url}은 덱·목표·설정을 담은 공유 링크.
  feedbackBodyPlanLink: {
    ko: '[이 계획 열기]({url}) — 덱·목표·설정',
    en: '[Open this plan]({url}) — deck, goals, settings',
  },
  feedbackBodyRun: {
    ko: '런: 진행 {current}층 · 보는 층 {stage}층 · 입장 {visits} · 획득 {got} · 미획득 {failed}',
    en: 'Run: frontier floor {current} · viewing floor {stage} · entries {visits} · got {got} · not got {failed}',
  },
  feedbackBodyRunNone: { ko: '런: 시작 전', en: 'Run: not started' },
  feedbackBodyRoute: {
    ko: '루트: 획득 {covered}/{total} · 미해결 {unresolved} · 참고 {warnings}',
    en: 'Route: got {covered}/{total} · unresolved {unresolved} · notes {warnings}',
  },
  feedbackBodyRouteNone: { ko: '루트: 목표 없음', en: 'Route: no goals' },
  feedbackBodyNone: { ko: '없음', en: 'none' },
  feedbackBodyNotAttached: { ko: '첨부하지 않음', en: 'Not attached' },
  feedbackBodyScreen: { ko: '화면', en: 'Screen' },
  feedbackBodyScreenPaste: {
    ko: '(앱 화면을 클립보드에 복사했습니다. 이 줄 아래에 Ctrl+V로 붙여 넣어 주세요.)',
    en: '(The app screen was copied to the clipboard. Paste it below this line with Ctrl+V.)',
  },
  feedbackBodyLog: { ko: '기록', en: 'Logs' },
  feedbackBodyErrors: { ko: '최근 오류', en: 'Recent errors' },
  feedbackBodyActions: { ko: '최근 조작', en: 'Recent actions' },
  feedbackBodyNoLog: { ko: '기록된 오류·조작이 없습니다.', en: 'No errors or actions recorded.' },
  feedbackBodyDiag: {
    ko: '피드백용 진단 기록 {n}건 ({detail})',
    en: 'Feedback diagnostics: {n} records ({detail})',
  },
  feedbackBodyTrimmed: {
    ko: '기록 일부 생략 — 주소 길이 제한',
    en: 'Some logs left out — link length limit',
  },
  feedbackBodyPayload: {
    ko: '자동 첨부 데이터 (소유자가 해독합니다)',
    en: 'Attached data (for the owner to decode)',
  },
  feedbackBodyPasteHere: {
    ko: '내용이 길어 주소에 담지 못했습니다. 앱이 클립보드에 복사한 전체 내용을 여기에 붙여 넣어 주세요(Ctrl+V).',
    en: 'The report was too long for the link. Paste the full text the app copied to your clipboard here (Ctrl+V).',
  },
  feedbackBodyFooter: {
    ko: '이 이슈는 앱의 「피드백 보내기」로 만들었습니다.',
    en: 'This issue was made with 「Send feedback」 in the app.',
  },

  // ── 추적기 탭
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

  // ── 확인창
  // 런을 버리고 되돌릴 수 없는 두 동작(링크 열기·시즌 바꾸기)이라 먼저 묻는다 — 런이 진행 중일 때만.
  confirmSharedTitle: {
    ko: '진행 중인 런을 버리고 링크를 열까요?',
    en: 'Discard the run in progress and open the link?',
  },
  confirmSharedMessage: {
    ko: '보낸 사람의 덱·목표·설정으로 덮어씁니다. 지금 런의 기록은 되돌릴 수 없습니다.',
    en: "Replaces your deck, goals and settings with the sender's. The current run record cannot be recovered.",
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

  // ── 설명서 창
  guide: { ko: '설명서', en: 'Guide' },
  guidePrev: { ko: '이전 카드', en: 'Previous card' },
  guideNext: { ko: '다음 카드', en: 'Next card' },
  guideDone: { ko: '닫기', en: 'Close' },
  guideCard: { ko: '{n} / {total} · {title}', en: '{n} / {total} · {title}' },
  guideNotice: { ko: '출처와 라이선스 (NOTICE)', en: 'Sources and licences (NOTICE)' },
} as const satisfies Record<string, Localized>;

export const GUIDE_CARDS = [
  {
    title: { ko: '무엇을 해 주나', en: 'What it does' },
    lines: [
      {
        src: 'guide/desktop-light.webp',
        kind: 'image',
        alt: {
          ko: '왼쪽에 목표 기프트, 가운데에 6층에서 들어갈 수 있는 팩, 오른쪽에 층별 루트 노선도가 있는 화면',
          en: 'Goal gifts on the left, the packs to enter on floor 6 in the middle, the floor-by-floor route map on the right',
        },
        width: 1440,
        height: 900,
      },
      {
        ko: '덱과 목표 E.G.O 기프트를 고르면, 몇 층에서 어느 테마팩에 들어가야 하는지 루트를 계산합니다.',
        en: 'Pick a deck and the E.G.O gifts you want, and it plans the route: which theme pack to enter on which floor.',
      },
      {
        ko: '계산 순서: 조합 기프트를 재료로 펼치고 → 팩이 필요 없는 범용 드랍을 빼고 → 관측·시작 기프트를 정한 뒤 → 기프트마다 그것을 주는 팩을 골라 층에 앉힙니다.',
        en: 'In order: fusions are unfolded into ingredients → general drops, which need no pack, are set aside → observation and the starting gift are chosen → each gift gets a pack that gives it, seated on a floor.',
      },
      {
        ko: '전부 얻을 수 없으면 무엇을 목표에서 빼야 하는지 알려 줍니다.',
        en: 'When not everything fits, it says which goal to drop.',
      },
      {
        ko: '덱과 목표는 메뉴의 「링크 복사」로 공유할 수 있습니다.',
        en: 'Share the deck and goals with 「Copy link」 in the menu.',
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
        ko: '인격 검색은 이름·소속·키워드·공격 유형·죄악으로 찾습니다. 낱말을 여럿 넣고 「모두」를 고르면 전부 맞는 인격만 남습니다(`화상 파우스트`).',
        en: 'The identity search reads names, factions, keywords, attack types and sins. With several words, 「All」 keeps only identities matching every one (`Burn Faust`).',
      },
      {
        ko: '조건부 기프트는 「출격」으로 선택된 인격을 기준으로 셉니다.',
        en: 'Conditional gifts count the identities set to 「Deployed」.',
      },
    ],
  },
  {
    title: { ko: '기프트', en: 'Gifts' },
    lines: [
      {
        ko: '기프트 탭에서 아이콘을 눌러 목표에 추가합니다.',
        en: 'In the Gifts tab, press an icon to add it as a goal.',
      },
      {
        ko: '검색창 끝의 >>를 누르면 「추천 기프트」가 먼저 열립니다. 지금 덱으로 발동할 수 있는 기프트만 모았고, 「모든 기프트」 탭에 전체가 있습니다.',
        en: 'The >> at the end of the search box opens 「Recommended」 first: the gifts your deck can set off now. The 「All gifts」 tab has every gift.',
      },
      {
        ko: '아이콘의 바깥 링은 조건 판정을 표시합니다. (초록 충족 · 빨강 미충족)',
        en: 'The ring around an icon shows the condition (green met · red not met).',
      },
      {
        ko: '관측 칸에 관측 가능한 기프트를 넣으면 기프트 관측으로 받습니다. 1층을 떠나면 바꿀 수 없습니다.',
        en: 'Put an observable gift in an observation cell to take it through Gift Observation. It locks once you leave floor 1.',
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
        ko: '전부 얻을 수 없으면 놓친 목표마다 무엇과 자리를 다투는지 알려 주고, 기프트마다 뺐을 때 줄어드는 충돌을 보여 줍니다. 뺄 목표를 체크하면 실제 결과를 계산하고, 「루트 미리 보기」로 확인한 뒤 「선택한 n개 목표에서 빼기」로 뺍니다.',
        en: 'When not everything fits, it says what each missed goal competes with and shows how many conflicts leaving out each gift clears. Tick goals to see the real result, check it with 「Preview route」, then 「Remove n from goals」.',
      },
    ],
  },
  {
    title: { ko: '런', en: 'Run' },
    lines: [
      {
        ko: '가운데 스테이지에서 팩 카드의 「입장」을 누르거나 카드를 아래로 당겨 들어갑니다.',
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
      {
        ko: '데스크톱에서는 헤더의 「화면 인식」에서 게임 창을 공유하면 입장·획득·판매·합성을 대신 기록합니다. 기록마다 되돌릴 수 있습니다.',
        en: 'On desktop, 「Screen reader」 in the header shares the game window and records entries, gifts got, sales and fusions for you. Every record can be undone.',
      },
      {
        ko: '재료를 미획득해서 조합할 수 없게 되면 「전체 루트」 맨 위에 알리고 루트를 다시 계산합니다. 기본은 그 조합을 버리는 것(「모으지 않기」)이고, 남은 재료 묶음을 누르면 「모으기」로 바뀌어 계속 모으러 갑니다.',
        en: "When a missed ingredient makes a fusion impossible, the top of 「Full route」 says so and the route is re-planned. By default the fusion is given up (「Don't collect」); press the remaining ingredients to switch to 「Collect」.",
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
      {
        ko: '버그나 데이터 오류는 ⋯ 메뉴의 「피드백 보내기」로 알려 주세요. 공개 GitHub 이슈로 열리고, 덱·목표·설정과 체크한 기록이 함께 붙습니다(게임 화면은 보내지 않습니다).',
        en: 'Report a bug or a data error with 「Send feedback」 in the ⋯ menu. It opens a public GitHub issue with your deck, goals, settings and the logs you tick (no game screens).',
      },
    ],
    notice: true,
  },
] as const satisfies readonly GuideCard[];
