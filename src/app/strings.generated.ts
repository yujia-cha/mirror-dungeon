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
  deckSearchModeAndHint: { ko: '검색어가 모두 맞는 인격 (AND)', en: 'Identities matching every word (AND)' },
  // 지금 덱의 그 수감자 칸에 들어 있는 인격의 검색 결과 행에 붙는 배지.
  deckInDeck: { ko: '편성 중', en: 'In deck' },
  // 그 수감자 칸에 LCB 수감자가 아닌 인격이 있을 때, 다른 인격 행 아래에 적는다(고르면 그것을 바꾼다).
  deckCurrent: { ko: '현재 편성: {identity}', en: 'In deck: {identity}' },
  deckPickerTitle: { ko: '{sinner} 인격 선택', en: 'Choose a {sinner} identity' },
  deckAttackTypes: { ko: '공격 유형', en: 'Attack types' },
  // 덱 칸과 인격 검색 행의 공격 유형 아이콘에 마우스를 올리면 뜨는 설명(M131). 아이콘의 대체 글자는 공격 유형 이름 자체다.
  deckAttackTypeHint: { ko: '공격 유형: {type}', en: 'Attack type: {type}' },
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
  // 추천 기프트의 첫 절(M137에 두 절을 하나로 합쳤다, 소유자 결정). 효과 중 하나라도 출격 인격으로 쓸 수 있고 그 효과가 덱에 무언가(그 키워드를 부여·소모하는 스킬, 스킬 슬롯, 소속, 인격 전용 버프, 죄악·공격 유형, 코인·가중치, 방어 스킬)를 요구하는 기프트(M129)와, 덱에 요구가 없는 효과만 쓸 수 있는 팩 전용(테마팩 한정·클리어 보상, M156부터 팩 전용 재료가 든 조합도) 기프트를 함께 담는다. 「N인 이상」 머리 조건은 그 수치를 채워야 한다. 대기 인원은 세지 않는다. 적·자신의 상태나 전투 상황을 묻는 효과는 요구가 없는 것으로 보고, 범용은 덱과 상관없어 추천하지 않는다.
  recDeckTitle: { ko: '지금 덱으로 발동', en: 'Active with this deck' },
  // 효과를 막는 조건이 E.G.O 스킬 조건뿐인 기프트(M129, 소유자 결정). 인격의 E.G.O 데이터가 없어 늘 충족으로 보되 추천 맨 아래에 따로 둔다. 획득 종류와 상관없이 넣는다.
  recEgoTitle: { ko: 'E.G.O 스킬 조건', en: 'E.G.O skill condition' },
  recAcquisition: { ko: '획득', en: 'Source' },
  // 테마팩 한정·클리어 보상, 그리고 모든 레시피에 팩 전용 재료가 하나라도 든 조합(재료의 재료까지, M156 소유자 결정 — isPackBound). 탭이 열릴 때의 기본값이다(M156).
  recAcqPack: { ko: '팩 전용', en: 'Pack-only' },
  // 팩 전용이 아닌 것 전부 — 범용 드랍, 시작 기프트, 범용 재료만으로 만드는 조합 등.
  recAcqGeneral: { ko: '범용', en: 'General' },
  recFusion: { ko: '조합 기프트 포함', en: 'Include fusions' },
  // 기본 정렬. 「지금 덱으로 발동」 절 안을 키워드 묶음으로 나누고(묶음 순서는 덱이 가진 키워드(출격 인격이 많은 순) → 키워드 없음 → 덱에 없는 키워드 → 참격·관통·타격, 같으면 원래 순서, M133), 묶음 안은 효과가 적용되는 인격 수가 많은 순(M131, `lib/recommend-rank.ts` — 같으면 팩 전용 먼저·조건 진행률·id). 「E.G.O 스킬 조건」 절은 묶지 않고 같은 순서로 한 격자에 늘어놓는다(소유자 결정).
  recSortKeyword: { ko: '키워드별', en: 'By keyword' },
  // 팩 전용 먼저, 그 안에서 효과가 적용되는 인격 수가 많은 순(M131, `lib/recommend-rank.ts`), 같으면 조건 진행률·id(compareEntries).
  recSortPack: { ko: '팩 전용 먼저', en: 'Pack-only first' },
  recDeckNone: {
    ko: '지금 덱으로 조건을 채우는 기프트가 없습니다',
    en: 'The deck meets no gift condition right now',
  },
  // 「지금 덱으로 발동」이 비었고 출격한 인격이 0명일 때. 조건 대부분이 출격 인원을 센다.
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
  // 효과 줄 아래 칩 줄(M131): 덱에 아무것도 요구하지 않는 효과, 또는 E.G.O 스킬 요구 뒤(늘 충족).
  effNoCondition: { ko: '조건 없음', en: 'No condition' },
  // 효과 줄 아래 칩(M131): 요구를 채우는 출격 인격이 없다. 점선 테두리 칩.
  effNone: { ko: '없음', en: 'None' },
  // 효과 줄 아래 칩 묶음 끝(M131): 「N인 이상」 요구의 개수(채운 수/필요 수).
  effCount: { ko: '{have}/{need}명', en: '{have}/{need}' },
  // 효과 줄 아래 인격 칩의 `title`·`aria-label`에서 인격 이름 뒤의 스킬 번호(M131). 칩 글자는 「파우스트 1.2.3」처럼 번호만 점으로 잇고(M133, 소유자 결정), 화면 낭독·마우스 올림은 이 문장으로 읽는다. 예: 「스킬 1, 3」.
  effSlot: { ko: '스킬 {slots}', en: 'skill {slots}' },
  // 그 키워드를 부여·획득·소모하는 기본 스킬.
  effReqKeyword: { ko: '{keywords} 스킬', en: '{keywords} skill' },
  // 「스킬 N」을 지정한 키워드 스킬.
  effReqKeywordSlot: { ko: '{keywords} 스킬 {slot}', en: '{keywords} Skill {slot}' },
  // 자신에게 그 키워드를 부여하는 스킬.
  effReqSelfGain: { ko: '자신에게 {keywords} 부여 스킬', en: 'Skill giving self {keywords}' },
  // 자신의 그 키워드를 소모하는 스킬.
  effReqSelfConsume: { ko: '자신의 {keywords} 소모 스킬', en: 'Skill spending own {keywords}' },
  // 진동 폭발·진폭 변환·진폭 얽힘을 일으키는 기본 스킬(M150). 진동 폭발은 원문이 스킬이나 아군을 주어로 밝힌 조건만, 진폭 변환·얽힘은 기프트가 직접 변환하는 것이 아니면 요구다.
  effReqMechanic: { ko: '{mechanics} 스킬', en: '{mechanics} skill' },
  // 효과의 참고(M150) — 요구는 아니지만 그 스킬이 있으면 돕는 것(「[진동 폭발]이 적용된 적에게」). 그 스킬을 가진 출격 인격이 있을 때만 칩과 함께 보인다.
  effReqHint: { ko: '참고: {name}', en: 'Helps: {name}' },
  effMechanicVibrationExplosion: { ko: '진동 폭발', en: 'Tremor Burst' },
  effMechanicSwitch_Vibration: { ko: '진폭 변환', en: 'Amplitude Conversion' },
  effMechanicFusionVibration: { ko: '진폭 얽힘', en: 'Amplitude Entanglement' },
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
  // 클리어 보상의 획득 줄과 EXTREME 팩 시트의 층 줄에 붙는다(M173, 소유자 확인). 마지막 층(15층)의 보스를 잡으면 런이 끝나 그 팩의 클리어 보상은 받지 못한다 — 플래너도 그 팩을 15층에 앉히지 않고, 15층 입장은 클리어 보상을 기대하지 않는다.
  giftClearRewardFinalFloor: {
    ko: '{floor}층에서는 클리어 보상을 얻지 못함',
    en: 'no clear reward on floor {floor}',
  },
  // {source}는 routeSourceText — 이 루트가 그 기프트를 어디서 얻는지.
  giftRouteSource: { ko: '이 루트에서는 {source}', en: 'In this route: {source}' },
  giftBlockedIncluded: { ko: '{name} 조합에 이미 포함됨', en: 'Already part of {name}' },
  giftEntangled: { ko: '얽힘', en: 'Entangled' },
  // {name}은 기프트 이름이라 조사는 호출하는 곳에서 josa로 붙인다.
  giftEntangledWith: { ko: '{name} 재료가 겹칩니다: {list}', en: 'shares ingredients with {name}: {list}' },
  giftDetail: { ko: '{name} 자세히', en: '{name} details' },
  giftDetailBack: { ko: '{name} 설명으로 돌아가기', en: 'Back to {name}' },
  // 강화(M130) — 기프트 시트의 `+`·`++` 버튼 묶음의 이름. 버튼 글자는 `+`·`++` 그대로다. 목표 타일은 아이콘 좌하의 배지 하나다(M131, giftUpgradeBadgeOn·giftUpgradeBadgeOff).
  giftUpgradeGroup: { ko: '{name} 강화 단계', en: '{name} enhancement' },
  // {step}은 `+` 또는 `++`. 누른 단계를 다시 누르면 강화 전으로 돌아간다.
  giftUpgradeStep: { ko: '{name} 강화 {step}', en: '{name} enhanced {step}' },
  // 목표 타일 아이콘 좌하의 강화 배지(M131)가 강화 전일 때의 접근 이름. 누를 때마다 강화 전 → + → ++ → 강화 전으로 돈다(원문이 있는 단계만). {next}는 `+` 또는 giftUpgradeNone.
  giftUpgradeBadgeOff: { ko: '{name} 강화 전 · 누르면 {next}', en: '{name} not enhanced · press for {next}' },
  // 같은 배지가 단계를 고른 때의 접근 이름. {step}은 지금 단계(`+`·`++`), {next}는 누르면 갈 단계 또는 giftUpgradeNone.
  giftUpgradeBadgeOn: {
    ko: '{name} 강화: {step} · 누르면 {next}',
    en: '{name} enhanced {step} · press for {next}',
  },
  // 강화 배지의 접근 이름 속 「누르면 …」의 값 — 강화하지 않은 기프트.
  giftUpgradeNone: { ko: '강화 전', en: 'not enhanced' },
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
  // 하나로는 해결되지 않을 때: {n}은 빼야 하는 수(해결 방법의 최소 빼기 수, 없으면 빼기 분석의 `resolving` 크기).
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
  // M144: 충돌을 푸는 방법 목록. 계획은 관측 지정을 그대로 둘 때 잃는 목표 수(k)를 이미 최소로 한다 — 그래서 k개보다 적게 빼서는 들어가지 않고, 계획이 잃은 k개를 빼면 늘 들어간다. 그 k개짜리 방법을 모두 찾고, 관측 지정 해제가 k를 줄이는지(목표를 하나도 빼지 않아도 되는지) 본다. 순위는 뺄 목표 수 → 해제할 관측 지정 수 → 획득 → 팩 수.
  routeMethods: { ko: '해결 방법', en: 'Ways to fit' },
  // 그 방법이 해제하는 플레이어 자신의 관측 지정. 이미 획득한 지정(쓴 관측)은 해제할 수 없어 나오지 않는다.
  routeMethodRelease: { ko: '관측 지정 해제: {names}', en: 'Release pin: {names}' },
  routeMethodKeep: { ko: '목표 유지', en: 'Every goal kept' },
  routeMethodRemove: { ko: '목표에서 빼기: {names}', en: 'Remove from goals: {names}' },
  // 찾은 최소 방법 전부가 빼는 목표. 그 방법들을 끝까지 다 찾았을 때만 말한다.
  routeMethodMust: { ko: '꼭 빼야 함: {names}', en: 'Must go: {names}' },
  // 아래 목표 중 아무거나 {n}개를 빼면 들어간다 — 그 조합을 전부 계산해 확인했을 때만 이렇게 묶는다.
  routeMethodAny: { ko: '이 중 아무거나 {n}개', en: 'Any {n} of these' },
  routeMethodPick: { ko: '이 방법 고르기', en: 'Pick this way' },
  // 고른 방법의 행 안에 서는 적용 버튼(M169) — 바닥의 「선택한 n개 목표에서 빼기」와 같은 확인창을 연다. 빼는 목표가 없는 방법(관측 지정 해제뿐)은 「{name} 지정 해제」(observeSlotClear)다.
  routeMethodApply: { ko: '{names} 목표에서 빼기', en: 'Remove {names} from goals' },
  // 꼭 필요한 수보다 많이 빼지만, 한 팩이 주는 목표를 함께 빼서 들어가는 방법.
  routeMethodOther: { ko: '다른 방법', en: 'Other ways' },
  routeMethodSamePack: { ko: '같은 팩', en: 'Same pack' },
  routeMethodShowAll: { ko: '방법 {n}개 더 보기', en: 'Show {n} more' },
  // 방법을 찾는 계산이 예산이나 상한에서 멈췄을 때. 「더 계산」이 막대와 함께 이어서 계산한다.
  routeMethodMore: { ko: '다른 방법이 더 있을 수 있습니다', en: 'There may be more ways' },
  // M144: 목표마다 혼자 뺐을 때의 막대(M80)는 이 접기 안에 있다.
  routeDecisionDetails: { ko: '자세히', en: 'Details' },
  routeDecisionReleased: { ko: '관측 지정 해제 {n}', en: '{n} pins released' },
  routeDecisionApplyBoth: {
    ko: '목표 {n}개 빼기 · 관측 지정 {m}개 해제',
    en: 'Remove {n} goals · release {m} pins',
  },
  routeDecisionReleaseOnly: { ko: '관측 지정 {n}개 해제', en: 'Release {n} pins' },
  routeDecisionApplyConfirm: {
    ko: '목표 {n}개를 빼고 관측 지정 {m}개를 해제할까요?',
    en: 'Remove {n} goals and release {m} pins?',
  },
  routeDecisionReleaseConfirm: { ko: '관측 지정 {n}개를 해제할까요?', en: 'Release {n} pins?' },
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
  // 합성이 루트가 모으는 기프트(목표나 목표의 재료)를 만들며 먹은 재료(M149). 손에는 없지만 잃은 것이 아니라서 「미획득」으로 적지 않고, 층을 떠날 때도 미획득으로 정산하지 않는다. 루트가 모으지 않는 기프트를 만든 합성의 재료는 그냥 획득이 풀린다.
  giftStatusUsed: { ko: '조합에 씀', en: 'Used in a fusion' },
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
  // 화면 인식을 시작하는 것이 곧 런 시작이다(M143). 지난 런의 기록(입장·획득·시작 확정)이 남아 있으면 먼저 묻는다 — 남은 기록으로 새 런을 읽으면 시작 화면을 찾지 않는다.
  captureRunAskTitle: { ko: '지난 런의 기록이 남아 있습니다', en: "The last run's record is still here" },
  captureRunAskMessage: {
    ko: '새 런으로 시작하면 입장·획득·시작 기록을 비우고 인식을 시작합니다. 새로고침한 뒤 같은 런을 계속하려면 「이어서」를 고르세요.',
    en: '「Start a new run」 clears the entries, gifts and start record and starts reading. To keep reading the same run after a reload, choose 「Continue」.',
  },
  captureRunNew: { ko: '새 런으로 시작', en: 'Start a new run' },
  captureRunContinue: { ko: '이어서', en: 'Continue' },
  // 화면 인식으로 시작한 런의 시작 단계가 열려 있는 동안만 팝오버에 보인다(M143). 관측은 1층을 떠나거나 화면 인식이 시작 단계를 닫을 때 잠긴다 — 런 시작에 잠그지 않는다.
  captureRunNoteTitle: { ko: '런 시작', en: 'Run start' },
  captureRunNoteFree: {
    ko: '바꿀 수 있는 것: 목표 기프트와 그에 따른 루트',
    en: 'You can still change: the goal gifts and the route they make',
  },
  captureRunNoteFixed: {
    ko: '정해지는 것: 시작 기프트·관측. 게임의 관측이 끝나면(1층 테마팩 선택) 화면 인식이 확정하고, 그 뒤에는 바꿀 수 없습니다',
    en: "Being decided: the start gifts and observations. Once the game's observation is over (floor 1's theme pack select) the screen reader settles them, and they cannot be changed after that",
  },
  // 화면 인식이 런을 시작할 때 남긴 「시작 전」 상태가 있거나(M143), 런에 기록이 하나라도 있으면 보인다(M158 — 화면 인식으로 시작하지 않은 런은 처음 상태로 돌아간다).
  captureRollback: { ko: '런 중단 · 시작 전으로 되돌리기', en: 'Stop the run · back to before it started' },
  captureRollbackTitle: {
    ko: '런을 중단하고 시작 전으로 되돌릴까요?',
    en: 'Stop the run and go back to before it started?',
  },
  captureRollbackMessage: {
    ko: '이 런에서 기록한 것을 되돌립니다. 화면 인식 중이면 멈춥니다.',
    en: 'What this run recorded is undone, and the screen reader stops if it is on.',
  },
  captureRollbackGifts: { ko: '획득·미획득 기록 {n}개', en: '{n} gift records (got and not got)' },
  captureRollbackVisits: { ko: '입장 기록 {n}개', en: '{n} pack entries' },
  captureRollbackStart: {
    ko: '시작 기록(시작 기프트·관측)',
    en: 'The start record (start gifts and observations)',
  },
  captureRollbackPins: {
    ko: '관측 지정은 시작 전 값으로 돌아갑니다',
    en: 'Observation picks go back to what they were before the start',
  },
  captureRollbackKeep: { ko: '목표와 덱은 그대로입니다.', en: 'Goals and deck stay as they are.' },
  // 화면 인식으로 시작하지 않은 런 — 「시작 전」 관측 지정을 모르므로 지금 값을 둔다(M158).
  captureRollbackKeepPins: {
    ko: '목표·덱·관측 지정은 그대로입니다.',
    en: 'Goals, deck and observation picks stay as they are.',
  },
  captureRollbackConfirm: { ko: '시작 전으로 되돌리기', en: 'Go back to before the start' },
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
  captureInterval_economy: { ko: '최고 성능 · 0.25~1초', en: 'Lightest · 0.25–1 s' },
  captureInterval_performance: { ko: '성능 · 0.15~0.5초', en: 'Light · 0.15–0.5 s' },
  captureInterval_balanced: { ko: '밸런스 · 0.1~0.25초', en: 'Balanced · 0.1–0.25 s' },
  captureInterval_quality: { ko: '품질 · 0.08~0.15초', en: 'Quality · 0.08–0.15 s' },
  captureStrained: {
    ko: '이 환경에서는 판독이 밀려 간격을 늘렸습니다 · 팝업은 그대로 읽습니다',
    en: 'Reads fall behind on this machine, so the reader waits longer between them · Popups are still read at once',
  },
  captureLang: { ko: '게임 언어', en: 'Game language' },
  captureLang_ko: { ko: '한국어', en: 'Korean' },
  captureLang_en: { ko: 'English (화면 제목 미확인)', en: 'English (screen titles not known yet)' },
  captureLog: { ko: '기록', en: 'Log' },
  captureLogEmpty: { ko: '아직 기록한 것이 없습니다', en: 'Nothing recorded yet' },
  captureLogEnter: { ko: '{floor}층 입장 · {name}', en: 'Floor {floor} entered · {name}' },
  captureLogGot: { ko: '획득 · {name}', en: 'Got · {name}' },
  captureLogGotStart: { ko: '시작 기프트 획득 · {name}', en: 'Got as a start gift · {name}' },
  captureLogGotObserved: { ko: '관측으로 획득 · {name}', en: 'Got by observation · {name}' },
  captureLogStartDone: { ko: '시작 단계 끝', en: 'Run start over' },
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

  // ── 오버레이 창 (화면 인식 팝오버에서 여는 게임 위의 작은 창)
  overlayOpen: { ko: '오버레이 창 열기', en: 'Open overlay window' },
  overlayClose: { ko: '오버레이 창 닫기', en: 'Close overlay window' },
  overlayHint: {
    ko: '게임 위에 늘 떠 있는 작은 창입니다(Chrome·Edge·Firefox). 테두리 없는 창 모드에서는 보이고, 전체 화면에서는 가려집니다',
    en: 'A small window that stays above the game (Chrome, Edge, Firefox). It shows over a borderless window, not over fullscreen',
  },
  // 오버레이 창의 제목 표시줄(`document.title`).
  overlayTitle: { ko: '거울 던전 오버레이', en: 'Mirror Dungeon overlay' },
  overlayCaptureOff: { ko: '화면 인식 꺼짐', en: 'Screen reader off' },
  // 오버레이 「다음 팩」 격자(M151)는 3열 2줄까지 보이고 나머지는 아래로 스크롤한다. 그 아래 줄이 가려진 팩 수를 말한다.
  overlayPacksMore: { ko: '팩 {n}개 더 · 아래로 스크롤', en: '{n} more packs · scroll down' },
  // 오버레이 「이 팩에서 챙길 기프트」 격자(M157)는 4열 2줄까지 보이고 나머지는 아래로 스크롤한다. 그 아래 줄이 가려진 기프트 수를 말한다.
  overlayGiftsMore: { ko: '기프트 {n}개 더 · 아래로 스크롤', en: '{n} more gifts · scroll down' },
  // 오버레이 창의 상점 절(M148). 화면 인식이 상점(「상점」·「특별한 상점」 첫 화면이나 구매·판매·강화·합성)을 보면 「다음 팩」·「남은 기프트」 대신 두 절이 서고, 지도나 팩 선택을 보면 돌아간다. 이 절은 마지막으로 입장한 팩만 주는 기프트 전부이고, 줄마다 「획득」·「조합에 씀」·「미획득」을 붙인다(M151 — 옛 「아직 못 얻은 목표」 절은 없앴다). 루트가 모으는 목표는 두 절 모두에서 앞에 서고 아이콘 틀과 「목표」 배지로 표시한다(M170).
  overlayShopExclusive: { ko: '이 층의 전용 기프트', en: "This floor's pack-only gifts" },
  // 추적기의 4등급 이상 기프트에서 조각 묶음을 뺀 것(키워드·기억·공격 유형·그 밖).
  overlayShopT4: { ko: 'T4 기프트', en: 'Tier 4 gifts' },
  overlayShopNone: { ko: '없습니다', en: 'None' },
  // 오버레이 창의 런 시작 절(M138). 1층을 떠나기 전, 시작 단계가 열려 있는 동안만 보인다. 계획이 기대하는 관측(지정·추천)과 1층에서 이미 얻은 것을 늘어놓는다(앱은 시작 기프트를 계획하지 않으므로(M145) 시작 기프트는 1층에서 얻은 것으로만 선다). 화면 인식이 돌고 있으면 누를 것이 없다(M141): 인식이 기록한 것은 ✓, 아직 못 본 것은 점선으로 보여 줄 뿐이고, 1층 테마팩 선택 화면을 보면 인식이 스스로 확정한다(일찍 손으로 확정하면 인식이 관측 화면을 그만 찾아 관측 팝업을 놓쳤다). 화면 인식이 꺼져 있으면 전부 켜진 토글로 서고, 게임에서 실제로 얻은 것만 켜 둔 채 확인하면 그대로 기록하며, 얻지 못한 관측은 관측하지 않은 것으로 보아 지정을 풀고 루트가 다시 찾는다.
  overlayStartTitle: { ko: '시작 시 획득', en: 'Collected at start' },
  overlayStartHint: {
    ko: '게임에서 실제로 얻은 것만 켜 두고 확인하세요. 얻지 못한 관측은 관측하지 않은 것으로 보고 루트가 다시 찾습니다',
    en: 'Keep on only what the game actually gave, then confirm. An observation not received counts as not made, and the route looks for it again',
  },
  // 화면 인식이 돌고 있을 때 런 시작 절의 안내(M141). 토글·확인 버튼 대신 이 한 줄이 선다.
  overlayStartLiveHint: {
    ko: '화면 인식이 기록합니다 · 1층 테마팩 선택에서 자동으로 확정됩니다',
    en: "The screen reader records this · it is confirmed by itself on floor 1's theme pack select",
  },
  overlayStartConfirm: { ko: '확인하고 진행', en: 'Confirm and continue' },
  // 시작을 확인한 뒤 1층을 떠나기 전까지 남는 한 줄. {n}은 기록한 기프트 수.
  overlayStartDone: { ko: '시작 확인 · 획득 {n}', en: 'Start confirmed · {n} collected' },
  overlayStartReopen: { ko: '다시 고르기', en: 'Choose again' },
  overlayNext: { ko: '{floor}층에 들어갈 수 있는 팩', en: 'Packs for floor {floor}' },
  // M157부터 획득한 기프트도 자리에 남아 표시만 바뀐다(테두리·✓). 그래서 「남은」이 아니라 스테이지와 같은 「챙길」이다.
  overlayRemaining: { ko: '이 팩에서 챙길 기프트', en: 'Gifts to collect in this pack' },
  overlayEntered: { ko: '{floor}층 · {name}', en: 'Floor {floor} · {name}' },
  overlayRemainingNone: { ko: '챙길 기프트 없음', en: 'Nothing to collect here' },
  overlayNotEntered: { ko: '아직 입장한 팩이 없습니다', en: 'No pack entered yet' },
  // 오버레이 창의 최근 기록 5줄(M151부터 사람이 읽는 문장). 런의 변화(`overlay/overlay-log.ts`의 사실)와 화면 인식 기록을 시각순으로 섞고, 화면 인식이 이미 말한 변화는 한 번만 적는다. 이름은 「」로 감싸므로 조사는 낱말(기프트·팩)에 붙인다.
  overlayRecent: { ko: '방금 한 행동', en: 'Recent actions' },
  overlayRecentEmpty: { ko: '아직 없습니다', en: 'Nothing yet' },
  overlayLogError: { ko: '오류가 났습니다: {text}', en: 'Something went wrong: {text}' },
  // 오버레이 기록에서 화면 인식이 적은 줄 앞의 작은 표식(M151).
  overlayLogReader: { ko: '인식', en: 'Reader' },
  // 오버레이 기록의 이름 목록이 세 개를 넘을 때 나머지 수(M151). 층을 떠나며 여러 기프트가 한꺼번에 미획득이 되는 경우.
  overlayLogMore: { ko: '외 {n}개', en: 'and {n} more' },
  overlayLogGoalAdd: { ko: '{names} 기프트를 목표에 추가했습니다', en: 'Added {names} to the goals' },
  overlayLogGoalRemove: { ko: '{names} 기프트를 목표에서 뺐습니다', en: 'Removed {names} from the goals' },
  overlayLogEnter: { ko: '{floor}층 {name}에 입장했습니다', en: 'Entered {name} on floor {floor}' },
  overlayLogLeave: {
    ko: '{floor}층 {name} 입장을 취소했습니다',
    en: 'Took back entering {name} on floor {floor}',
  },
  overlayLogSkip: { ko: '{floor}층을 건너뛰었습니다', en: 'Skipped floor {floor}' },
  overlayLogGot: { ko: '{names} 기프트를 획득했습니다', en: 'Got {names}' },
  overlayLogGotStart: { ko: '{names} 기프트를 시작 기프트로 받았습니다', en: 'Got {names} as a start gift' },
  overlayLogGotObserved: { ko: '{names} 기프트를 관측으로 획득했습니다', en: 'Got {names} by observation' },
  overlayLogUsed: { ko: '{names} 기프트를 조합에 썼습니다', en: 'Used {names} in a fusion' },
  overlayLogFailed: { ko: '{names} 기프트를 얻지 못했습니다', en: 'Did not get {names}' },
  overlayLogClearedGot: {
    ko: '{names} 기프트의 획득 표시를 지웠습니다',
    en: 'Cleared the got mark on {names}',
  },
  overlayLogClearedFailed: {
    ko: '{names} 기프트의 미획득 표시를 지웠습니다',
    en: 'Cleared the not-got mark on {names}',
  },
  overlayLogClearedUsed: {
    ko: '{names} 기프트의 조합에 씀 표시를 지웠습니다',
    en: 'Cleared the used-in-a-fusion mark on {names}',
  },
  overlayLogSold: { ko: '{names} 기프트를 판매했습니다', en: 'Sold {names}' },
  overlayLogFused: {
    ko: '{ingredients} 기프트로 {name} 기프트를 합성했습니다',
    en: 'Fused {ingredients} into {name}',
  },
  overlayLogFusedPlain: { ko: '{name} 기프트를 합성했습니다', en: 'Fused {name}' },
  overlayLogAnswer: { ko: '직접 골랐습니다: {names}', en: 'You picked {names}' },
  overlayLogStartDone: { ko: '시작 기프트와 관측을 마쳤습니다', en: 'The run start is over' },
  overlayLogStartOpen: { ko: '시작 기프트와 관측을 다시 고릅니다', en: 'Choosing the run start again' },
  overlayLogRunNew: { ko: '새 런을 시작했습니다', en: 'Started a new run' },
  overlayLogRollback: { ko: '런을 시작 전으로 되돌렸습니다', en: 'Rolled the run back to before it started' },
  overlayLogRunCleared: { ko: '런 기록을 비웠습니다', en: 'Cleared the run' },
  overlayLogDeck: { ko: '덱을 바꿨습니다', en: 'Changed the deck' },

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
    ko: '아무것도 찾지 못한 판독이 상한(2만 건)에 닿아 이제부터는 개수만 남깁니다. 이벤트·적용·층 기록은 계속 남습니다.',
    en: 'Reads that found nothing reached their cap (20,000); from now on only their counts are kept. Events, what was applied and floors are still recorded.',
  },
  diagStopped: {
    ko: '기록이 가득 찼습니다(10만 건). 내보내고 지워야 다시 기록합니다.',
    en: 'The record is full (100,000). Export and clear it to record again.',
  },
  diagTrimmed: {
    ko: '이미지 상한을 넘어 덜 중요한 {n}장을 오래된 것부터 지웠습니다.',
    en: 'Over the image cap: {n} of the least important were dropped, oldest first.',
  },
  diagSavedTitle: { ko: '내보낸 뒤 정리', en: 'After exporting' },
  diagSavedPrompt: {
    ko: '{name}을(를) 저장했으면 기기의 기록을 지우세요. 그 파일 하나만 전달하면 됩니다.',
    en: 'Once {name} is saved, clear the record on this device. That one file is all you hand over.',
  },
  diagSavedPromptParts: {
    ko: '{n}개 파일로 나눠 받았습니다(각 {mb}MB 이하): {names}. 모두 저장했으면 기기의 기록을 지우세요. 받지 못한 파일이 있으면 지우기 전에 다시 내보내세요.',
    en: 'Exported in {n} files ({mb} MB or less each): {names}. Once all are saved, clear the record on this device. If one did not arrive, export again before clearing.',
  },
  diagSessionOver: {
    ko: '기록이 많아 1번 파일이 {mb}MB를 넘습니다. 그 파일에 기록 전부가 들어 있어 나눌 수 없습니다.',
    en: 'There is so much recorded that part 1 is over {mb} MB. It holds the whole record and cannot be split.',
  },
  diagSplitHint: {
    ko: '약 {n}개 파일로 나눠 받습니다(각 {mb}MB 이하). 브라우저가 여러 파일 다운로드를 허용할지 물으면 허용하세요.',
    en: 'This comes in about {n} files ({mb} MB or less each). If the browser asks whether to allow several downloads, allow it.',
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
    ko: '조합에 쓴 조각 {a}개·기억 {b}개를 골라 소모로 표시하세요.',
    en: 'Mark the {a} shards and {b} memories the fusion used up.',
  },
  trackerFusionHeld: { ko: '지금 획득으로 표시된 재료', en: 'Ingredients marked as got' },
  // 누르면 획득 표시가 풀린다. 달의 기억이 루트가 모으는 기프트(목표나 목표의 재료)면 「조합에 씀」이 되고(M149), 아니면 그냥 풀린다. 「미획득」은 층을 떠날 때의 자동 기록이라 이 버튼의 낱말로 쓰지 않는다.
  trackerUnmark: { ko: '소모함', en: 'Used up' },

  // ── 확인창
  // 런을 버리고 되돌릴 수 없는 동작(링크 열기)이라 먼저 묻는다 — 런이 진행 중일 때만.
  confirmSharedTitle: {
    ko: '진행 중인 런을 버리고 링크를 열까요?',
    en: 'Discard the run in progress and open the link?',
  },
  confirmSharedMessage: {
    ko: '보낸 사람의 덱·목표·설정으로 덮어씁니다. 지금 런의 기록은 되돌릴 수 없습니다.',
    en: "Replaces your deck, goals and settings with the sender's. The current run record cannot be recovered.",
  },
  confirmSharedConfirm: { ko: '링크 열기', en: 'Open the link' },

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
    title: { ko: '기능', en: 'Features' },
    lines: [
      {
        ko: '**루트 계산** : 덱과 목표 기프트를 고르면, 루트를 계산해 보여줍니다.',
        en: '**Route planning**: pick a deck and goal gifts, and it plans and shows the route.',
      },
      {
        ko: '**조건 판정** : 조건부 기프트가 지금 덱으로 발동하는지 보여줍니다.',
        en: '**Condition check**: it shows whether a conditional gift goes off with your deck now.',
      },
      {
        ko: '**충돌 처리** : 기프트를 모두 얻을 수 없으면, 무엇을 빼면 되는지 알려줍니다.',
        en: '**Conflicts**: when not every gift fits, it tells you what to leave out.',
      },
      {
        ko: '**기록 추적** : 게임을 하며 팩 입장과 기프트 획득을 기록하면, 남은 루트를 재계산합니다.',
        en: '**Run tracking**: record pack entries and gifts got as you play, and it re-plans the rest of the route.',
      },
    ],
  },
  {
    title: { ko: '빠른 시작', en: 'Quick start' },
    lines: [
      {
        src: 'guide/deck.webp',
        kind: 'image',
        alt: { ko: '덱 설정', en: 'Setting up the deck' },
        width: 381,
        height: 682,
      },
      {
        ko: '**덱 설정** : 편성 코드를 붙여 넣거나 인격을 직접 고릅니다.',
        en: '**Deck**: paste a formation code or pick the identities yourself.',
        form: 'numbered',
        n: 1,
      },
      {
        src: 'guide/gifts-browser.webp',
        kind: 'image',
        alt: { ko: '목표 설정', en: 'Setting goals' },
        width: 1559,
        height: 804,
      },
      {
        ko: '**목표 설정** : 원하는 기프트의 아이콘을 눌러 목표에 넣습니다.',
        en: '**Goals**: press the icon of a gift you want to add it as a goal.',
        form: 'numbered',
        n: 2,
      },
      {
        src: 'guide/route.webp',
        kind: 'image',
        alt: { ko: '루트 확인', en: 'Checking the route' },
        width: 331,
        height: 836,
      },
      {
        ko: '**루트 확인** : 층마다 어느 팩을 입장해야 하는지 확인합니다.',
        en: '**Route**: see which pack to enter on each floor.',
        form: 'numbered',
        n: 3,
      },
      {
        src: 'guide/stage-packs.webp',
        kind: 'image',
        alt: { ko: '팩 선택', en: 'Choosing a pack' },
        width: 474,
        height: 483,
      },
      {
        src: 'guide/stage-entered.webp',
        kind: 'image',
        alt: { ko: '기프트 선택', en: 'Marking gifts' },
        width: 1153,
        height: 441,
      },
      {
        ko: '**게임 시작** : 게임을 하며 스테이지에서 들어간 팩과 얻은 기프트를 기록합니다.',
        en: '**Play**: as you play, record on the stage the packs you entered and the gifts you got.',
        form: 'numbered',
        n: 4,
      },
    ],
  },
  {
    title: { ko: '덱', en: 'Deck' },
    lines: [
      {
        src: 'guide/deck-search.webp',
        kind: 'image',
        alt: { ko: '인격 검색', en: 'Identity search' },
        width: 368,
        height: 480,
      },
      {
        src: 'guide/deck-code.webp',
        kind: 'image',
        alt: { ko: '덱 전체 화면', en: 'The whole deck tab' },
        width: 372,
        height: 806,
      },
      {
        ko: '「코드 가져오기」에 인게임 덱의 편성 코드를 붙여넣어 덱을 빠르게 편성할 수 있습니다.',
        en: 'Paste the in-game formation code into 「Import code」 to set up the deck quickly.',
      },
      {
        ko: '수감자 칸을 눌러 인격을 고르거나, 검색해서 원하는 인격을 편성할 수 있습니다.',
        en: "Press a sinner's slot to pick an identity, or search for the one you want.",
      },
      {
        ko: '칸의 「대기」를 눌러 「출격」으로 바꿉니다.',
        en: 'Press 「Standby」 on a slot to switch it to 「Deployed」.',
      },
      {
        ko: '인격 검색은 이름/소속/키워드/죄악으로 찾을 수 있습니다.',
        en: 'The identity search finds names, factions, keywords and sins.',
      },
    ],
  },
  {
    title: { ko: '기프트', en: 'Gifts' },
    lines: [
      {
        src: 'guide/gifts-browser.webp',
        kind: 'image',
        alt: { ko: '목표 설정', en: 'Setting goals' },
        width: 1559,
        height: 804,
      },
      {
        ko: '원하는 기프트를 검색하거나, 검색창 끝의 `>>`로 찾아 목표로 설정합니다.',
        en: 'Search for a gift, or find it with `>>` at the end of the search box, and set it as a goal.',
      },
      {
        ko: '아이콘을 누르면 **목표에 추가**, 이름을 누르면 설명이 열립니다.',
        en: 'Press an icon to **add it as a goal**; press a name to open its description.',
      },
      {
        ko: '조합 기프트를 목표로 하면 재료도 목표로 포함합니다.',
        en: 'A fusion gift as a goal brings its ingredients in as goals too.',
      },
      {
        ko: '**관측 칸**에 넣은 기프트는 「기프트 관측」으로 받는 것으로 계획합니다. 1층을 떠나면 바꿀 수 없습니다.',
        en: 'A gift in an **observation cell** is planned to come from 「Gift Observation」. It locks once you leave floor 1.',
      },
    ],
  },
  {
    title: { ko: '루트', en: 'Route' },
    lines: [
      {
        src: 'guide/route.webp',
        kind: 'image',
        alt: { ko: '루트 확인', en: 'Checking the route' },
        width: 331,
        height: 836,
      },
      {
        ko: '오른쪽 「전체 루트」가 층마다 들어갈 팩을 노선도로 그립니다.',
        en: '「Full route」 on the right draws the pack to enter on each floor as a route map.',
      },
      {
        ko: '팩 이름을 누르면 그 팩에서만 얻는 기프트가 나옵니다.',
        en: "Press a pack's name to see the gifts only that pack gives.",
      },
      {
        src: 'guide/route-conflict.webp',
        kind: 'image',
        alt: { ko: '충돌', en: 'A conflict' },
        width: 332,
        height: 659,
      },
      {
        ko: '목표로 한 기프트를 전부 얻을 수 없으면, 카드가 **해결 방법**을 좋은 순서로 늘어놓습니다.',
        en: 'When not every goal fits, a card lists the **ways to fit**, best first.',
      },
      {
        ko: '「이 방법 고르기」 → 「루트 미리 보기」로 확인하고, 「선택한 n개 목표에서 빼기」로 반영합니다.',
        en: 'Check with 「Pick this way」 → 「Preview route」, then apply it with 「Remove n from goals」.',
      },
    ],
  },
  {
    title: { ko: '런', en: 'Run' },
    lines: [
      {
        src: 'guide/run-desktop.webp',
        kind: 'image',
        alt: { ko: '런 화면', en: 'The run screen' },
        width: 1919,
        height: 937,
      },
      {
        ko: '스테이지의 팩 카드를 아래로 당기거나 「입장」 버튼을 눌러 입장하면, 그 팩에서 챙길 기프트가 나옵니다. 얻은 기프트는 아이콘을 눌러 획득으로 표시할 수 있습니다.',
        en: 'Pull a pack card on the stage down or press 「Enter」 to enter, and the gifts to take from that pack appear. Mark a gift you got by pressing its icon.',
      },
      {
        ko: '표시하지 않고 층을 떠나면 「미획득」으로 기록되고, 루트가 남은 층에서 다시 찾습니다.',
        en: 'Leave a floor without marking it and it is recorded as 「Not got」; the route looks for it again on the floors left.',
      },
      {
        ko: '열린 카드를 아래로 당기거나 「다음 층」버튼을 눌러 다음 층으로 이동합니다.',
        en: 'Pull the open card down or press 「Next floor」 to move to the next floor.',
      },
      {
        ko: '열린 카드를 위로 밀거나 「입장 취소」버튼을 눌러 되돌립니다.',
        en: 'Push the open card up or press 「Undo entry」 to take it back.',
      },
      {
        ko: '계획에 없는 팩에 들어가도 됩니다. 루트는 지금 층부터 다시 계산됩니다.',
        en: 'Entering a pack the plan did not pick is fine. The route is planned again from this floor.',
      },
      { ko: '화면 인식 · 오버레이 (데스크톱)', en: 'Screen reader · overlay (desktop)', form: 'heading' },
      {
        src: 'guide/capture.webp',
        kind: 'image',
        alt: { ko: '화면 인식', en: 'The screen reader' },
        width: 623,
        height: 396,
      },
      {
        ko: '헤더의 「화면 인식」으로 게임 창을 공유하면 팩 입장, 기프트 획득/판매/합성을 자동으로 기록합니다.',
        en: 'Share the game window with 「Screen reader」 in the header, and it records pack entries and gifts got, sold and fused for you.',
      },
      {
        ko: '「오버레이 창 열기」는 다음 층의 추천 팩과 남은 기프트를 보여 주는 오버레이 창을 띄워 줍니다. (Chrome·Edge 116 이상, Firefox 151 이상, 테두리 없는 창 모드)',
        en: "「Open overlay window」 opens a window over the game with the next floor's packs and the gifts left. (Chrome·Edge 116+, Firefox 151+, borderless window mode)",
      },
      {
        ko: '화면은 브라우저 안에서만 읽고 어디로도 보내지 않습니다. 지금은 한국어 클라이언트만 지원합니다.',
        en: 'The screen is read inside the browser only and sent nowhere. Only the Korean client is supported for now.',
      },
    ],
  },
  {
    title: { ko: '공유와 설정', en: 'Sharing and settings' },
    lines: [
      {
        ko: '⋯ 메뉴의 「링크 복사」는 덱, 목표 기프트, 설정을 담은 링크를 만듭니다.',
        en: '「Copy link」 in the ⋯ menu makes a link with your deck, goal gifts and settings.',
      },
      {
        ko: '「테마 변경」,「기프트 아이콘 크기」,「글자 크기」도 ⋯ 메뉴에 있습니다.',
        en: '「Change theme」, 「Gift icon size」 and 「Text size」 are in the ⋯ menu too.',
      },
      {
        ko: '모든 기록은 이 브라우저에만 저장되고 서버로 가지 않습니다.',
        en: 'Everything is saved in this browser only and never goes to a server.',
      },
    ],
  },
  {
    title: { ko: '피드백', en: 'Feedback' },
    lines: [
      {
        ko: '버그나 데이터 오류는 ⋯ 메뉴의 「피드백 보내기」로 알려 주세요. 공개 GitHub 이슈로 열리고, 덱, 목표 기프트, 설정과 체크한 기록이 함께 붙습니다(게임 화면은 보내지 않습니다).',
        en: 'Report a bug or a data error with 「Send feedback」 in the ⋯ menu. It opens a public GitHub issue with your deck, goal gifts, settings and the logs you tick (no game screens).',
        form: 'paragraph',
      },
    ],
  },
  {
    title: { ko: '데이터와 권리', en: 'Data and rights' },
    lines: [
      {
        ko: '게임 데이터·텍스트·이미지의 권리는 **Project Moon**에 있습니다. 이 저장소는 비상업 팬 프로젝트이며 Project Moon과 제휴하거나 승인받지 않았습니다.',
        en: 'Game data, text and images belong to **Project Moon**. This is a non-commercial fan project, not affiliated with or endorsed by Project Moon.',
        form: 'paragraph',
      },
      {
        ko: '게임 데이터는 플래너가 동작하는 데 필요한 범위에서 [LEAGUE-OF-NINE/OpenLethe](https://github.com/LEAGUE-OF-NINE/OpenLethe)(클라이언트 정적 데이터), [x1bViolet/Limbus-Localization-Files](https://github.com/x1bViolet/Limbus-Localization-Files)(공식 한국어·영어 현지화 원문), [eldritchtools/limbus-assets](https://github.com/eldritchtools/limbus-assets)(정적 데이터에 없는 인격을 채우는 가공 데이터)에서 가져옵니다. 자세한 것은 [`data/README.md`](data/README.md)와 [`data/sources.lock.json`](data/sources.lock.json)에 있습니다.',
        en: 'Game data is taken, only as far as the planner needs it, from [LEAGUE-OF-NINE/OpenLethe](https://github.com/LEAGUE-OF-NINE/OpenLethe) (client static data), [x1bViolet/Limbus-Localization-Files](https://github.com/x1bViolet/Limbus-Localization-Files) (the official Korean and English text) and [eldritchtools/limbus-assets](https://github.com/eldritchtools/limbus-assets) (processed data for identities the static data lacks). The details are in [`data/README.md`](data/README.md) and [`data/sources.lock.json`](data/sources.lock.json).',
      },
      {
        ko: '게임 이미지는 **기프트 아이콘·키워드 아이콘·테마팩 그림**만 담습니다(eldritchtools/limbus-assets 사본). 그 밖의 게임 이미지는 담지 않습니다.',
        en: 'The only game images included are **gift icons, keyword icons and theme pack art** (copies from eldritchtools/limbus-assets). No other game images are included.',
      },
      {
        ko: '**코드는 MIT 라이선스입니다. 게임 데이터·텍스트·이미지에는 적용되지 않습니다** — [`NOTICE`](NOTICE)를 보세요.',
        en: '**The code is MIT-licensed. That does not cover the game data, text or images** — see [`NOTICE`](NOTICE).',
      },
    ],
  },
] as const satisfies readonly GuideCard[];
