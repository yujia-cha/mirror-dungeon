# 설명문 모음

사이트 방문자가 읽는 문장을 **전부 이 파일 하나**에 모았습니다. 여기만 고치면 앱의 화면 문구·「?」 설명서·루트 경고·README가 함께 바뀝니다.

## 고치는 법

1. 아래에서 문장을 찾아 `- ko:`·`- en:` 뒤를 고칩니다. (GitHub이나 편집기의 찾기로 화면에 보이는 글자를 검색하면 됩니다.)
2. `npm run copy`를 돌립니다. 이 파일에서 `src/app/strings.generated.ts`·`src/core/messages.generated.ts`·`README.md`를 다시 만들고, 각 문장의 `- 쓰는 곳:` 줄을 갱신합니다. (Claude가 이 파일을 고치면 훅이 대신 돌립니다.)
3. `npm run check`가 생성물이 이 파일과 맞는지도 검사합니다.

## 규칙

- `### 키`는 코드가 부르는 이름이라 **바꾸지 않습니다**. 절(`##`)은 자유롭게 옮기고 이름을 바꿔도 됩니다.
- `{이름}`은 실행 중에 채워지는 값입니다. 화면 문구는 ko와 en에 같은 이름이 있어야 합니다.
- 루트 경고는 `{이름|을/를}`처럼 쓰면 받침에 맞는 조사를 붙입니다(`을/를`·`이/가`·`은/는`·`과/와`). 영어에서는 값만 들어갑니다.
- `메모:` 줄은 화면에 나오지 않는 설명입니다. 생성 파일에 주석으로 들어갑니다.
- `- 쓰는 곳:`은 자동으로 채워지니 손대지 않습니다. 「참조 없음」이면 아무 코드도 쓰지 않는 문구, 「(동적)」이면 코드가 키 이름을 조합해 부르는 문구입니다.
- 설명서·README에서 「」로 인용한 낱말이 화면 문구에 없으면 `npm run copy`가 경고합니다(버튼 이름이 바뀌었는데 설명이 그대로인 경우).
- **설명서와 README는 「# 안내」의 카드 하나가 둘을 함께 만듭니다.** 카드 안에서 `- ko:`(+`- en:`)는 둘 다, `- 설명서:`(+`- en:`)는 설명서만, `- readme:`는 README만, `- 그림: guide/파일 | 대체 텍스트 | alt text`는 둘 다에 나옵니다. 그림 파일은 `public/guide/`에 두고(이미지 webp·png·jpg 300KB, 동영상 mp4·webm 2MB까지), README에는 「# README」의 `<!-- 카드: 제목 -->` 자리에 카드가 들어갑니다. 설명서 문장에는 `**굵게**`·`` `코드` ``·`[링크](주소)`만 쓸 수 있습니다.
- 게임 클라이언트 화면이 담긴 그림은 넣지 않습니다(권리가 Project Moon에 있습니다). 앱 화면 캡처만 씁니다.

# 화면 문구

앱의 버튼·라벨·안내·확인창 문장입니다. 코드에서는 `t('키', lang)`로 부릅니다.

## 공통 — 헤더·⋯ 메뉴·불러오기·푸터

### appTitle
- ko: 거울 던전 루트
- en: Mirror Dungeon Route
- 쓰는 곳: src/app/App.tsx, src/app/shell/AppShell.tsx

### share
- ko: 링크 복사
- en: Copy link
- 쓰는 곳: src/app/shell/AppShell.tsx

### shared
- ko: 링크를 복사했습니다
- en: Link copied
- 쓰는 곳: src/app/App.tsx

### copyFailed
- ko: 복사하지 못했습니다 · 화면을 한 번 누른 뒤 다시 시도하세요
- en: Could not copy · tap the page once and try again
- 쓰는 곳: src/app/App.tsx

### linkBroken
- ko: 공유 링크를 읽지 못했습니다
- en: This share link could not be read
- 쓰는 곳: src/app/App.tsx

### moreActions
- ko: 더 보기
- en: More
- 쓰는 곳: src/app/shell/AppShell.tsx

### resetAll
- ko: 초기화
- en: Reset
- 쓰는 곳: src/app/shell/AppShell.tsx

### confirmCancel
- ko: 취소
- en: Cancel
- 쓰는 곳: src/app/components/ConfirmDialog.tsx

### resetAllConfirm
- ko: 덱·기프트·루트 설정·런 기록을 모두 처음 상태로 되돌립니다.
- en: Resets the deck, gifts, route settings and run record.
- 쓰는 곳: src/app/shell/AppShell.tsx

### langToggle
- ko: English
- en: 한국어
- 쓰는 곳: src/app/shell/AppShell.tsx

### themeToggle
- ko: 테마 변경
- en: Change theme
- 쓰는 곳: src/app/shell/AppShell.tsx

### giftIconSize
- ko: 기프트 아이콘 크기
- en: Gift icon size
- 쓰는 곳: src/app/shell/AppShell.tsx

### textSize
- ko: 글자 크기
- en: Text size
- 쓰는 곳: src/app/shell/AppShell.tsx

### sizeStep_sm
- ko: 작게
- en: Small
- 쓰는 곳: src/app/shell/AppShell.tsx (동적)

### sizeStep_md
- ko: 보통
- en: Medium
- 쓰는 곳: src/app/shell/AppShell.tsx (동적)

### sizeStep_lg
- ko: 크게
- en: Large
- 쓰는 곳: src/app/shell/AppShell.tsx (동적)

### sizeStep_xl
- ko: 아주 크게
- en: Extra large
- 쓰는 곳: src/app/shell/AppShell.tsx (동적)

### loading
- ko: 게임 데이터를 불러오는 중
- en: Loading game data
- 쓰는 곳: src/app/App.tsx

### loadFailed
- ko: 게임 데이터를 불러오지 못했습니다
- en: Could not load the game data
- 쓰는 곳: src/app/App.tsx

### retry
- ko: 다시 시도
- en: Retry
- 쓰는 곳: src/app/App.tsx

### loadFailedHttp
메모: DataLoadError는 문장이 아니라 원인을 실어 오므로 두 언어를 여기서 쓴다. {label}은 실패한 파일 이름.
- ko: {label}을(를) 받지 못했습니다 ({status}).
- en: Could not fetch {label} ({status}).
- 쓰는 곳: src/app/App.tsx

### loadFailedTimeout
- ko: {label} 요청이 시간을 넘겼습니다. 연결을 확인해 주세요.
- en: The request for {label} timed out; check your connection.
- 쓰는 곳: src/app/App.tsx

### loadFailedNetwork
- ko: {label}에 연결할 수 없습니다.
- en: Could not reach {label}.
- 쓰는 곳: src/app/App.tsx

### loadFailedMalformed
- ko: {label}의 내용을 읽을 수 없습니다.
- en: Could not read the contents of {label}.
- 쓰는 곳: src/app/App.tsx

### dataVersion
- ko: 데이터
- en: Data
- 쓰는 곳: src/app/shell/AppShell.tsx

### season
- ko: 시즌
- en: Season
- 쓰는 곳: src/app/shell/AppShell.tsx

### seasonProvisional
- ko: 데이터 일부 미확인
- en: Some data not confirmed
- 쓰는 곳: src/app/shell/AppShell.tsx

### seasonProvisionalHint
- ko: 이 시즌은 아직 팩별 범용 드랍 풀을 확인하지 못했습니다. 전용 기프트와 조합은 계획할 수 있지만, 범용 드랍이 어느 팩에서 나오는지는 알 수 없습니다.
- en: This season has no per-pack general drop pool yet. Exclusive gifts and fusions can be planned; which pack a general drop can come from is unknown.
- 쓰는 곳: src/app/shell/AppShell.tsx

### seasonDroppedGifts
- ko: 이번 시즌에 없는 기프트 {n}개를 뺐습니다
- en: Dropped {n} gift(s) this season does not have
- 쓰는 곳: src/app/App.tsx

### aboutData
메모: 푸터의 한 줄. 화면의 설명문은 이것과 데이터 버전 둘뿐이라는 규칙을 지킨다. 출처 목록은 너무 길어 NOTICE에 있고 링크로 닿는다.
- ko: 게임 데이터와 텍스트의 권리는 Project Moon에 있습니다. Project Moon과 제휴하거나 승인받지 않은 비상업 팬 프로젝트입니다.
- en: Game data and text belong to Project Moon. A non-commercial fan project, not affiliated with or endorsed by Project Moon.
- 쓰는 곳: src/app/shell/AppShell.tsx

### aboutSource
- ko: 출처와 라이선스
- en: Sources and licence
- 쓰는 곳: src/app/shell/AppShell.tsx

### searchClear
- ko: 검색어 지우기
- en: Clear search
- 쓰는 곳: src/app/shell/GiftBrowser.tsx, src/app/stage/EnterablePacks.tsx, src/app/steps/DeckStep.tsx, src/app/steps/GiftsStep.tsx

### skipToStage
메모: 건너뛰기 링크. 「스테이지」는 가운데 열을 어디서나 부르는 이름이다.
- ko: 스테이지로 건너뛰기
- en: Skip to the stage
- 쓰는 곳: src/app/shell/AppShell.tsx

## 패널과 탭

### panelLeft
메모: 휴대폰 페이지의 제목은 그 페이지를 여는 헤더 문 이름이다.
- ko: 덱
- en: Deck
- 쓰는 곳: src/app/shell/AppShell.tsx

### panelRight
- ko: 전체 루트
- en: Full route
- 쓰는 곳: src/app/shell/AppShell.tsx

### panelResize
- ko: 패널 너비
- en: Panel width
- 쓰는 곳: src/app/shell/PanelResizer.tsx

### panelResizeHint
- ko: 끌어서 너비 조절 · 두 번 눌러 기본값 · 화살표 키로 조금씩
- en: Drag to resize · double-click to reset · arrow keys nudge
- 쓰는 곳: src/app/shell/PanelResizer.tsx

### panelBack
- ko: 뒤로
- en: Back
- 쓰는 곳: src/app/shell/GiftBrowser.tsx, src/app/shell/SidePanel.tsx

### tabDeck
- ko: 덱
- en: Deck
- 쓰는 곳: src/app/shell/AppShell.tsx, src/app/steps/DeckStep.tsx

### tabGifts
- ko: 기프트
- en: Gifts
- 쓰는 곳: src/app/shell/AppShell.tsx, src/app/shell/RoutePlanPanel.tsx, src/app/stage/RunStage.tsx

### tabRoutePlan
- ko: 전체 루트
- en: Full route
- 쓰는 곳: src/app/shell/AppShell.tsx

### tabTracker
- ko: 추적기
- en: Tracker
- 쓰는 곳: src/app/shell/AppShell.tsx

## 덱 탭

### toDeck
- ko: 덱 탭으로
- en: To the deck tab
- 쓰는 곳: src/app/steps/GiftsStep.tsx

### deckSearchAll
- ko: 전체 인격 검색 · 이름 · 소속 · 키워드
- en: Search all identities · name · faction · keywords
- 쓰는 곳: src/app/steps/DeckStep.tsx

### deckSearchHint
- ko: {n}명
- en: {n} found
- 쓰는 곳: src/app/steps/DeckStep.tsx

### deckSearchPicked
- ko: 덱에 {n}명
- en: {n} in the deck
- 쓰는 곳: src/app/steps/DeckStep.tsx

### deckDefault
- ko: 기본 덱
- en: Default deck
- 쓰는 곳: src/app/steps/DeckStep.tsx

### deckDefaultConfirm
- ko: 덱을 LCB 수감자 12인으로 되돌릴까요?
- en: Reset the deck to the 12 LCB sinners?
- 쓰는 곳: src/app/steps/DeckStep.tsx

### deckDefaultConfirmBody
- ko: 지금 덱과 출격 설정이 바뀝니다.
- en: The current deck and deployment are replaced.
- 쓰는 곳: src/app/steps/DeckStep.tsx

### deckSearchNone
- ko: 일치하는 인격 없음
- en: No identity matches
- 쓰는 곳: src/app/steps/DeckStep.tsx

### deckDeployedFull
- ko: 출격은 최대 {max}명입니다
- en: Up to {max} can be deployed
- 쓰는 곳: src/app/steps/DeckStep.tsx

### deckDeployed
- ko: 출격
- en: Deployed
- 쓰는 곳: src/app/steps/DeckStep.tsx

### deckReserve
- ko: 대기
- en: Reserve
- 쓰는 곳: src/app/steps/DeckStep.tsx

### deckEmptySlot
- ko: 인격 선택
- en: Pick an identity
- 쓰는 곳: src/app/steps/DeckStep.tsx

### deckClearSlot
- ko: 칸 비우기
- en: Clear slot
- 쓰는 곳: src/app/steps/DeckStep.tsx

### deckImport
- ko: 코드 가져오기
- en: Import code
- 쓰는 곳: src/app/steps/DeckStep.tsx

### deckImportPlaceholder
- ko: 편성 코드를 붙여넣으세요
- en: Paste a formation code
- 쓰는 곳: src/app/steps/DeckStep.tsx

### deckImportApply
- ko: 불러오기
- en: Import
- 쓰는 곳: src/app/steps/DeckStep.tsx

### deckImportFailed
- ko: 편성 코드를 읽을 수 없습니다
- en: Could not read that formation code
- 쓰는 곳: src/app/steps/DeckStep.tsx

### deckImportPartial
- ko: 일부 인격을 찾을 수 없어 건너뛰었습니다
- en: Some identities were not found and were skipped
- 쓰는 곳: src/app/steps/DeckStep.tsx

### deckChipBasis
- ko: 출격 {n}명 · 편성 전체 {total}명
- en: {n} deployed · {total} in the formation
- 쓰는 곳: src/app/steps/DeckStep.tsx

### deckRank
- ko: {n}성
- en: {n}★
- 쓰는 곳: src/app/steps/DeckStep.tsx

### deckKeywordSkills
- ko: {keyword} 부여 공격 스킬 보유
- en: Has attack skills that inflict {keyword}
- 쓰는 곳: src/app/format.ts

### deckKeywordSpecial
메모: 두 형태 모두 「특수 {keyword}」 한 낱말로 읽는다. 일반형도 세는지는 힌트가 말한다.
- ko: 특수 {keyword}
- en: Unique {keyword}
- 쓰는 곳: src/app/format.ts

### deckKeywordSpecialHint
- ko: {keyword} 또는 특수 {keyword} 부여·획득 공격 스킬 보유
- en: Has attack skills that inflict or gain {keyword} or Unique {keyword}
- 쓰는 곳: src/app/format.ts

### deckKeywordSpecialOnly
- ko: 특수 {keyword}
- en: Unique {keyword}
- 쓰는 곳: src/app/format.ts

### deckKeywordUses
메모: 탄환은 부여가 아니라 소모이고 늘 일반형으로 적는다 — 이 줄에는 특수 형태가 없다.
- ko: {keyword} 소모 공격 스킬 보유
- en: Has attack skills that spend {keyword}
- 쓰는 곳: src/app/format.ts

### deckKeywordSpecialOnlyHint
- ko: 특수 {keyword}만 부여·획득 — 「또는 특수 {keyword}」 조건에만 셈
- en: Only Unique {keyword} — counts only for conditions that say "or Unique {keyword}"
- 쓰는 곳: src/app/format.ts

### deckSinnerSearch
- ko: {sinner} 인격 검색
- en: Search {sinner} identities
- 쓰는 곳: src/app/steps/DeckStep.tsx

### deckShowing
- ko: {total}명 중 {n}명
- en: {n} of {total}
- 쓰는 곳: src/app/steps/DeckStep.tsx

### deckClose
- ko: 닫기
- en: Close
- 쓰는 곳: src/app/steps/DeckStep.tsx

### deckSearchMode
메모: 검색어 여러 개를 어떻게 합칠지 고르는 두 버튼의 묶음 이름.
- ko: 검색어 조합
- en: Match
- 쓰는 곳: src/app/steps/DeckStep.tsx

### deckSearchModeOr
- ko: 하나라도
- en: Any
- 쓰는 곳: src/app/steps/DeckStep.tsx

### deckSearchModeAnd
- ko: 모두
- en: All
- 쓰는 곳: src/app/steps/DeckStep.tsx

### deckSearchModeOrHint
- ko: 검색어 중 하나라도 맞는 인격 (OR)
- en: Identities matching any word (OR)
- 쓰는 곳: src/app/steps/DeckStep.tsx

### deckSearchModeAndHint
- ko: 검색어가 모두 맞는 인격 (AND) — 예: 화상 파우스트
- en: Identities matching every word (AND) — e.g. Burn Faust
- 쓰는 곳: src/app/steps/DeckStep.tsx

### deckInDeck
메모: 지금 덱의 그 수감자 칸에 들어 있는 인격의 검색 결과 행에 붙는 배지.
- ko: 편성 중
- en: In deck
- 쓰는 곳: src/app/steps/DeckStep.tsx

### deckCurrent
메모: 그 수감자 칸에 LCB 수감자가 아닌 인격이 있을 때, 다른 인격 행 아래에 적는다(고르면 그것을 바꾼다).
- ko: 현재 편성: {identity}
- en: In deck: {identity}
- 쓰는 곳: src/app/steps/DeckStep.tsx

### deckPickerTitle
- ko: {sinner} 인격 선택
- en: Choose a {sinner} identity
- 쓰는 곳: src/app/steps/DeckStep.tsx

### deckAttackTypes
- ko: 공격 유형
- en: Attack types
- 쓰는 곳: src/app/steps/DeckStep.tsx

### deckSins
- ko: 죄악 속성
- en: Sin affinities
- 쓰는 곳: src/app/steps/DeckStep.tsx

## 기프트 탭

### giftsSearch
- ko: 기프트 검색
- en: Search gifts
- 쓰는 곳: src/app/shell/GiftBrowser.tsx, src/app/steps/GiftsStep.tsx

### giftsResults
- ko: 검색 결과
- en: Search results
- 쓰는 곳: src/app/steps/GiftsStep.tsx

### giftsDeckEmpty
- ko: 덱이 비어 있습니다
- en: The deck is empty
- 쓰는 곳: src/app/shell/GiftBrowser.tsx, src/app/steps/GiftsStep.tsx

### giftsNoMatch
- ko: 일치하는 기프트 없음
- en: No gift matches
- 쓰는 곳: src/app/components/GiftFilterBar.tsx, src/app/shell/GiftBrowser.tsx

### giftsSelected
- ko: 목표 {n}
- en: Goals {n}
- 쓰는 곳: src/app/shell/GiftBrowser.tsx, src/app/steps/GiftsStep.tsx

### giftsClear
- ko: 목표 비우기
- en: Clear goals
- 쓰는 곳: src/app/steps/GiftsStep.tsx

### giftsClearConfirm
- ko: 목표 {n}개와 조합 설정·관측 지정을 모두 뺍니다.
- en: Removes all {n} goals with their fusion settings and observation pins.
- 쓰는 곳: src/app/steps/GiftsStep.tsx

### giftsSort
- ko: 정렬
- en: Sort
- 쓰는 곳: src/app/components/RecommendedGifts.tsx, src/app/steps/GiftsStep.tsx

### giftsSortPicked
- ko: 추가한 순서
- en: As added
- 쓰는 곳: src/app/steps/GiftsStep.tsx

### giftsSortName
- ko: 이름
- en: Name
- 쓰는 곳: src/app/steps/GiftsStep.tsx

### giftsPack
- ko: 팩
- en: Pack
- 쓰는 곳: src/app/steps/GiftsStep.tsx

### giftsRecommendOpen
메모: 기프트 탭이 검색 중이 아닐 때 탭 아래에 서는 문. 「모두 보기」 브라우저를 「추천 기프트」 탭으로 연다.
- ko: 추천 기프트 보기
- en: See recommended gifts
- 쓰는 곳: src/app/steps/GiftsStep.tsx

### removeFromSelection
- ko: {name} 목표에서 빼기
- en: Remove {name} from goals
- 쓰는 곳: src/app/components/SelectedTiles.tsx

## 모두 보기 (전체 기프트 격자)

### giftsBrowseAll
메모: 「모두 보기」 브라우저(탭 검색줄 끝의 >>): 「추천 기프트」·「모든 기프트」 두 탭. 데스크톱은 스테이지 자리, 휴대폰은 페이지. 브라우저의 제목이기도 하다.
- ko: 모두 보기
- en: Browse all
- 쓰는 곳: src/app/shell/GiftBrowser.tsx

### giftsBrowseTitle
메모: 「모두 보기」의 둘째 탭 — 전체 기프트와 필터.
- ko: 모든 기프트
- en: All gifts
- 쓰는 곳: src/app/shell/GiftBrowser.tsx

### giftsBrowseRecommended
메모: 「모두 보기」의 첫 탭(열 때마다 이 탭으로 열린다) — 지금 덱으로 발동할 수 있는 기프트(M121).
- ko: 추천 기프트
- en: Recommended
- 쓰는 곳: src/app/shell/GiftBrowser.tsx

### giftsBrowseClose
- ko: 닫기
- en: Close
- 쓰는 곳: src/app/shell/GiftBrowser.tsx

### giftsBrowseHide
- ko: 모두 보기 닫기
- en: Close browse all
- 쓰는 곳: src/app/steps/GiftsStep.tsx

## 추천 기프트 (모두 보기의 첫 탭)

### recDeckTitle
메모: 임계값 있는 조건을 모두 채우거나, 임계값 없는 조건(편성된 수에 따라 강화)에 출격한 인격이 한 명이라도 세어지는 기프트(대기 인원은 세지 않는다).
- ko: 덱 조건 충족
- en: Deck conditions met
- 쓰는 곳: src/app/components/RecommendedGifts.tsx

### recFreeTitle
메모: 조건이 없어 어느 덱에서나 발동하는 기프트 중 팩 전용(테마팩 한정·클리어 보상)인 것. 범용은 덱과 상관없어 추천하지 않는다.
- ko: 조건 없이 발동 · 팩 전용
- en: No condition · pack-only
- 쓰는 곳: src/app/components/RecommendedGifts.tsx

### recAcquisition
- ko: 획득
- en: Source
- 쓰는 곳: src/app/components/RecommendedGifts.tsx

### recAcqPack
메모: 테마팩 한정·클리어 보상(isPackBound).
- ko: 팩 전용
- en: Pack-only
- 쓰는 곳: src/app/components/RecommendedGifts.tsx

### recAcqGeneral
메모: 팩 전용이 아닌 것 전부 — 범용 드랍, 조합, 시작 기프트 등.
- ko: 범용
- en: General
- 쓰는 곳: src/app/components/RecommendedGifts.tsx

### recFusion
- ko: 조합 기프트 포함
- en: Include fusions
- 쓰는 곳: src/app/components/RecommendedGifts.tsx

### recSortKeyword
- ko: 키워드별
- en: By keyword
- 쓰는 곳: src/app/components/RecommendedGifts.tsx

### recSortPack
메모: 팩 전용 먼저, 그다음 조건 진행률, id(compareEntries).
- ko: 팩 전용 먼저
- en: Pack-only first
- 쓰는 곳: src/app/components/RecommendedGifts.tsx

### recDeckNone
- ko: 지금 덱으로 조건을 채우는 기프트가 없습니다
- en: The deck meets no gift condition right now
- 쓰는 곳: src/app/shell/GiftBrowser.tsx

### recNoDeployed
메모: 덱 조건 충족이 비었고 출격한 인격이 0명일 때. 조건 대부분이 출격 인원을 센다.
- ko: 출격한 인격이 없습니다. 조건 대부분은 출격 인원으로 셉니다.
- en: No identity is deployed. Most conditions count deployed identities.
- 쓰는 곳: src/app/shell/GiftBrowser.tsx

## 기프트 필터·획득 분류·죄악

### filterReset
- ko: 필터 초기화
- en: Reset filters
- 쓰는 곳: src/app/components/GiftFilterBar.tsx, src/app/components/RecommendedGifts.tsx

### filterKeyword
- ko: 키워드
- en: Keyword
- 쓰는 곳: src/app/components/GiftFilterBar.tsx, src/app/components/RecommendedGifts.tsx, src/app/steps/GiftsStep.tsx

### filterCondition
메모: 덱이 기프트를 판정하는지(hasDeckCondition): 임계값 있는 키워드 수나 소속 수. 효과 강화·완전 공명은 덱 조건이 아니다.
- ko: 조건
- en: Condition
- 쓰는 곳: src/app/components/GiftFilterBar.tsx

### condNone
- ko: 조건 없음
- en: No condition
- 쓰는 곳: src/app/components/GiftFilterBar.tsx

### condGated
- ko: 덱 조건
- en: Deck condition
- 쓰는 곳: src/app/components/GiftFilterBar.tsx

### filterTier
- ko: 등급
- en: Tier
- 쓰는 곳: src/app/components/GiftFilterBar.tsx

### filterSin
- ko: 죄악
- en: Sin
- 쓰는 곳: src/app/components/GiftFilterBar.tsx

### filterAll
- ko: 전체
- en: All
- 쓰는 곳: src/app/components/GiftFilterBar.tsx, src/app/components/RecommendedGifts.tsx, src/app/steps/GiftsStep.tsx

### acqSure
- ko: 팩 한정
- en: Pack-only
- 쓰는 곳: src/app/lib/labels.ts

### acqMaybe
- ko: 범용 드랍
- en: General drop
- 쓰는 곳: src/app/lib/labels.ts

### acqFuse
- ko: 조합
- en: Fusion
- 쓰는 곳: src/app/lib/labels.ts

### acqStart
- ko: 시작
- en: Start
- 쓰는 곳: src/app/lib/labels.ts

### acqEvent
- ko: 이벤트
- en: Event
- 쓰는 곳: src/app/lib/labels.ts

### acqClear
- ko: 클리어 보상
- en: Clear reward
- 쓰는 곳: src/app/lib/labels.ts

### acqChance
- ko: 확률 보상
- en: Chance drop
- 쓰는 곳: src/app/lib/labels.ts

### acqMaterial
- ko: 재료
- en: Material
- 쓰는 곳: src/app/lib/labels.ts

### acqUnknown
- ko: 경로 불명
- en: Unknown
- 쓰는 곳: src/app/lib/labels.ts

### sinWRATH
- ko: 분노
- en: Wrath
- 쓰는 곳: src/app/lib/labels.ts

### sinLUST
- ko: 색욕
- en: Lust
- 쓰는 곳: src/app/lib/labels.ts

### sinSLOTH
- ko: 나태
- en: Sloth
- 쓰는 곳: src/app/lib/labels.ts

### sinGLUTTONY
- ko: 탐식
- en: Gluttony
- 쓰는 곳: src/app/lib/labels.ts

### sinGLOOM
- ko: 우울
- en: Gloom
- 쓰는 곳: src/app/lib/labels.ts

### sinPRIDE
- ko: 오만
- en: Pride
- 쓰는 곳: src/app/lib/labels.ts

### sinENVY
- ko: 질투
- en: Envy
- 쓰는 곳: src/app/lib/labels.ts

### condResonance
- ko: 공명
- en: Resonance
- 쓰는 곳: src/app/lib/gift-condition.ts

### condMet
- ko: 충족
- en: Met
- 쓰는 곳: src/app/components/GiftIcon.tsx, src/app/components/GiftTile.tsx

### condUnmet
- ko: 미충족
- en: Not met
- 쓰는 곳: src/app/components/GiftIcon.tsx, src/app/components/GiftTile.tsx

## 관측 지정

### giftsObserve
- ko: {name} 관측 지정
- en: Observe {name}
- 쓰는 곳: src/app/components/MetroMap.tsx, src/app/components/ObserveSlots.tsx

### giftsObserveNotAllowed
- ko: 관측할 수 없는 기프트
- en: Cannot be observed
- 쓰는 곳: 참조 없음

### giftsObserveFull
- ko: 관측은 최대 {max}개
- en: Up to {max} observations
- 쓰는 곳: 참조 없음

### giftsObserveClosed
- ko: 1층을 떠난 뒤에는 관측을 바꿀 수 없습니다
- en: Observations cannot change after floor 1 is left
- 쓰는 곳: src/app/components/ObserveSlots.tsx

### observeSlots
- ko: 관측
- en: Observation
- 쓰는 곳: src/app/components/ObserveSlots.tsx

### observeSlotAdd
- ko: 관측 지정 추가
- en: Add an observation
- 쓰는 곳: src/app/components/ObserveSlots.tsx

### observeSlotAddSuggested
- ko: 관측 지정 추가 · 추천 {name}
- en: Add an observation · suggested {name}
- 쓰는 곳: src/app/components/ObserveSlots.tsx

### observeSlotsCount
- ko: 관측 {n}/{max}
- en: Observation {n}/{max}
- 쓰는 곳: src/app/components/ObserveSlots.tsx

### observePinned
메모: 관측 토글은 어디서나 같게 읽힌다(팩 시트·시작 줄·기프트 시트·슬롯): 꺼짐 「관측 지정」, 켜짐 「지정됨」, 해제 「{name} 지정 해제」.
- ko: 지정됨
- en: Pinned
- 쓰는 곳: src/app/components/BlockDetail.tsx

### observeSlotClear
- ko: {name} 지정 해제
- en: Unpin {name}
- 쓰는 곳: src/app/components/ObserveSlots.tsx

### observeSlotSkip
메모: M120: 관측 칸 목록의 맨 위. 누르면 그 칸을 쓰지 않는다(계획이 관측을 하나 덜 쓴다).
- ko: 관측하지 않기
- en: Don't observe
- 쓰는 곳: src/app/components/ObserveSlots.tsx

### observeSlotOff
- ko: 관측 안 함
- en: Not observing
- 쓰는 곳: src/app/components/ObserveSlots.tsx

### observeSlotOn
- ko: 관측 안 함 해제
- en: Use this slot again
- 쓰는 곳: src/app/components/ObserveSlots.tsx

### observeSlotNone
- ko: 관측할 수 있는 목표 기프트가 없습니다
- en: No goal gift can be observed
- 쓰는 곳: src/app/components/ObserveSlots.tsx

### settingsObserved
- ko: 관측 지정
- en: Observe
- 쓰는 곳: src/app/components/BlockDetail.tsx

## 기프트 상세 시트

### giftSubOf
- ko: {parent} 재료
- en: Ingredient of {parent}
- 쓰는 곳: src/app/components/GiftGrid.tsx

### giftMaterials
- ko: 조합식
- en: Recipe
- 쓰는 곳: src/app/components/GiftDetailSheet.tsx

### giftSubRecipe
- ko: {name}도 조합이다 — 그 재료
- en: {name} is a fusion too — its ingredients
- 쓰는 곳: src/app/components/GiftDetailSheet.tsx

### giftMixedRecipe
- ko: 키워드 상위 {aOf}종 중 {a}개 + 공격 유형 {bOf}종 중 {b}개
- en: {a} of {aOf} keyword capstones + {b} of {bOf} attack-type ones
- 쓰는 곳: src/app/components/GiftDetailSheet.tsx

### giftPackOnly
- ko: {name} 전용
- en: only from {name}
- 쓰는 곳: src/app/components/GiftDetailSheet.tsx

### giftPackOnlyMany
메모: 전용 팩이 셋 이상이면(53개 기프트, 인연 얽힘은 일곱) 첫 팩만 이름을 적고 나머지는 센다 — 한 줄을 유지한다.
- ko: {name} 외 {n}개 팩 전용
- en: only from {name} and {n} other packs
- 쓰는 곳: src/app/components/GiftDetailSheet.tsx

### giftRouteSource
메모: {source}는 routeSourceText — 이 루트가 그 기프트를 어디서 얻는지.
- ko: 이 루트에서는 {source}
- en: In this route: {source}
- 쓰는 곳: src/app/components/GiftDetailSheet.tsx

### giftBlockedIncluded
- ko: {name} 조합에 이미 포함됨
- en: Already part of {name}
- 쓰는 곳: src/app/components/GiftDetailSheet.tsx, src/app/components/GiftGrid.tsx

### giftEntangled
- ko: 얽힘
- en: Entangled
- 쓰는 곳: src/app/components/GiftDetailSheet.tsx, src/app/components/GiftGrid.tsx, src/app/components/SelectedTiles.tsx

### giftEntangledWith
메모: {name}은 기프트 이름이라 조사는 호출하는 곳에서 josa로 붙인다.
- ko: {name} 재료가 겹칩니다: {list}
- en: shares ingredients with {name}: {list}
- 쓰는 곳: src/app/components/GiftDetailSheet.tsx

### giftDetail
- ko: {name} 자세히
- en: {name} details
- 쓰는 곳: src/app/components/GiftDetailSheet.tsx, src/app/components/GiftGrid.tsx, src/app/components/GiftTile.tsx, src/app/components/PackSheet.tsx, src/app/components/SelectedTiles.tsx

### giftDetailBack
- ko: {name} 설명으로 돌아가기
- en: Back to {name}
- 쓰는 곳: src/app/components/GiftDetailSheet.tsx, src/app/components/PackSheet.tsx

### giftExclusive
- ko: 전용
- en: Exclusive
- 쓰는 곳: 참조 없음

### giftWanted
- ko: 목표
- en: Goal
- 쓰는 곳: 참조 없음

### giftUnjudgeable
- ko: 판정 불가
- en: Cannot judge
- 쓰는 곳: src/app/components/GiftIcon.tsx, src/app/components/GiftTile.tsx

### giftAddGoal
메모: 기프트가 목표가 되거나 빠지는 모든 곳(기프트 시트, 팩 시트의 줄)이 이 둘을 쓴다. 트레이 타일의 ✕와 결정 카드는 이름을 붙여 같은 말을 한다.
- ko: 목표에 추가
- en: Add as goal
- 쓰는 곳: src/app/components/GiftDetailSheet.tsx

### giftRemoveGoal
- ko: 목표에서 빼기
- en: Remove from goals
- 쓰는 곳: src/app/components/GiftDetailSheet.tsx

### giftFusionDead
- ko: 조합 불가 — {result} 재료를 구할 수 없습니다
- en: Fusion lost — {result} cannot get its ingredients
- 쓰는 곳: src/app/shell/PlanContext.tsx

### fusionGoalIngredients
- ko: 재료도 목표
- en: Ingredients are goals too
- 쓰는 곳: src/app/components/GiftDetailSheet.tsx

### fusionGoalHint
- ko: 끄면 조합이 불가능해졌을 때 남은 재료만을 위한 입장을 취소합니다.
- en: Off: when the fusion becomes impossible, pack entries for the remaining ingredients alone are dropped.
- 쓰는 곳: src/app/components/GiftDetailSheet.tsx

## 시작 키워드 (기프트 탭 맨 아래)

### optionStartKeyword
- ko: 시작 키워드
- en: Start keyword
- 쓰는 곳: src/app/components/MetroMap.tsx, src/app/shell/RouteOptions.tsx

### optionAuto
- ko: 자동
- en: Auto
- 쓰는 곳: src/app/components/MetroMap.tsx, src/app/shell/RouteOptions.tsx

### optionAutoResolved
- ko: 자동 ({keyword})
- en: Auto ({keyword})
- 쓰는 곳: src/app/components/MetroMap.tsx, src/app/shell/RouteOptions.tsx

### startKeywordGives
메모: 기프트 이름에 조사가 붙어서 오므로(withJosa) 문장에는 조사가 없다.
- ko: {keyword}: {gift} 시작 기프트로 받습니다
- en: {keyword}: starts with {gift}
- 쓰는 곳: src/app/shell/RouteOptions.tsx

### startKeywordAutoWould
- ko: 자동으로 두면 {gift} 시작 기프트로 받습니다
- en: On auto, the run would start with {gift}
- 쓰는 곳: src/app/shell/RouteOptions.tsx

### startKeywordFree
- ko: 목표에 영향이 없으니 원하는 키워드를 골라도 됩니다
- en: No goal depends on it, so pick any keyword
- 쓰는 곳: src/app/shell/RouteOptions.tsx

## 전체 루트 패널

### routeRequiredPacks
- ko: 필요 팩
- en: Packs
- 쓰는 곳: src/app/shell/RoutePlanPanel.tsx

### routeCovered
- ko: 획득
- en: Got
- 쓰는 곳: src/app/shell/RoutePlanPanel.tsx

### routeApprox
- ko: 근사 결과
- en: Near-best
- 쓰는 곳: src/app/shell/RoutePlanPanel.tsx

### routeStart
- ko: 시작
- en: Start
- 쓰는 곳: src/app/components/MetroMap.tsx

### routeStartGift
- ko: 시작 기프트
- en: Starting gift
- 쓰는 곳: src/app/components/MetroMap.tsx

### routeObserved
- ko: 관측
- en: Observed
- 쓰는 곳: src/app/components/BlockDetail.tsx, src/app/components/MetroMap.tsx

### routeObservedEmpty
- ko: 관측 빈 칸
- en: Free observation slot
- 쓰는 곳: src/app/components/MetroMap.tsx

### routeObservedNone
메모: 예전엔 「관측」이 aria-label에만 있어 빈 점선 눈 셋이 터치·키보드 사용자에게 아무 말도 하지 않았다. 보이는 라벨과 비었을 때의 이유를 단다.
- ko: 추천할 관측이 없습니다
- en: Nothing worth observing
- 쓰는 곳: src/app/components/MetroMap.tsx

### routeStartHeld
메모: 런 중에는 관측 결정이 지났으므로 이 줄은 추천이 아니라 실제로 무엇으로 시작했는지의 기록이다(1층을 떠나면 core가 start.observed를 비운다).
- ko: 시작 시 획득
- en: Got at start
- 쓰는 곳: src/app/components/MetroMap.tsx

### routeStartHeldNone
- ko: 관측 없이 시작했습니다
- en: Started with no observations
- 쓰는 곳: src/app/components/MetroMap.tsx

### routeObservedPinned
- ko: 지정
- en: Pinned
- 쓰는 곳: src/app/components/BlockDetail.tsx, src/app/components/MetroMap.tsx

### routeObservedRecommended
- ko: 추천
- en: Suggested
- 쓰는 곳: src/app/components/ObserveSlots.tsx

### routeObservedFrees
- ko: {pack} 안 가도 됨
- en: No need to enter {pack}
- 쓰는 곳: src/app/components/BlockDetail.tsx, src/app/components/MetroMap.tsx

### routeObservedRescue
- ko: 루트로는 얻을 수 없어 관측
- en: Unreachable by route, so observe it
- 쓰는 곳: src/app/components/BlockDetail.tsx, src/app/components/MetroMap.tsx

### routeVariantWithout
- ko: {name} 빼면
- en: Without {name}
- 쓰는 곳: 참조 없음

### routeDecisionTitle
메모: 결정 카드: 한 런에 다 들어가지 않을 때 무엇을 목표에서 뺄지 묻는 한 곳. {names}는 충돌하는 기프트 이름 목록.
- ko: 전부 얻을 수 없습니다 · {names} 중 하나를 목표에서 빼야 합니다
- en: They do not all fit one run · remove one of {names} from the goals
- 쓰는 곳: src/app/components/RouteDecision.tsx

### routeDecisionTitleMany
메모: 하나로는 해결되지 않을 때: {n}은 빼야 하는 수(core의 minDrops).
- ko: 전부 얻을 수 없습니다 · {names} 중 {n}개를 목표에서 빼야 합니다
- en: They do not all fit one run · remove {n} of {names} from the goals
- 쓰는 곳: src/app/components/RouteDecision.tsx

### routeDecisionEffects
메모: M80: 목표마다 「혼자 뺐을 때 줄어드는 충돌」 막대를 그리고, 막대를 더하지 않고 고른 집합을 플래너로 실제 계산한다.
- ko: 뺐을 때 줄어드는 충돌
- en: Conflicts cleared when left out
- 쓰는 곳: src/app/components/RouteDecision.tsx

### routeDecisionCheck
- ko: 뺄 목표로 고르기
- en: pick to remove
- 쓰는 곳: src/app/components/RouteDecision.tsx

### routeDecisionReducesLabel
- ko: 충돌 {n}개 줄어듦
- en: clears {n} conflicts
- 쓰는 곳: src/app/components/RouteDecision.tsx

### routeDecisionBarSum
- ko: 막대 합 −{sum}
- en: Bars add to −{sum}
- 쓰는 곳: src/app/components/RouteDecision.tsx

### routeDecisionReal
- ko: 함께 뺀 실제 −{real}
- en: together −{real}
- 쓰는 곳: src/app/components/RouteDecision.tsx

### routeDecisionNotAdditive
- ko: 더해지지 않음
- en: not additive
- 쓰는 곳: src/app/components/RouteDecision.tsx

### routeDecisionResolves
- ko: 빼면 해결: {names}
- en: Fits without: {names}
- 쓰는 곳: src/app/components/RouteDecision.tsx

### routeDecisionPick
- ko: 이 조합 고르기
- en: Pick these
- 쓰는 곳: src/app/components/RouteDecision.tsx

### routeDecisionNow
- ko: 충돌 {n} · 획득 {covered}
- en: {n} conflicting · got {covered}
- 쓰는 곳: src/app/components/RouteDecision.tsx

### routeDecisionComputing
- ko: 계산 중…
- en: Computing…
- 쓰는 곳: src/app/components/RouteDecision.tsx

### routeDecisionFits
- ko: ✓ 전부 들어갑니다 · 획득 {covered}
- en: ✓ Everything fits · got {covered}
- 쓰는 곳: src/app/components/RouteDecision.tsx

### routeDecisionLeft
- ko: 남은 충돌 {n} · 획득 {covered}
- en: {n} still conflicting · got {covered}
- 쓰는 곳: src/app/components/RouteDecision.tsx

### routeDecisionSelected
- ko: {n}개 선택
- en: {n} picked
- 쓰는 곳: src/app/components/RouteDecision.tsx

### routeDecisionClear
- ko: 선택 해제
- en: Clear
- 쓰는 곳: src/app/components/RouteDecision.tsx

### routeDecisionDropConfirm
- ko: {n}개를 목표에서 뺄까요?
- en: Remove {n} from the goals?
- 쓰는 곳: src/app/components/RouteDecision.tsx

### routeDecisionPreview
- ko: 루트 미리 보기
- en: Preview route
- 쓰는 곳: src/app/components/RouteDecision.tsx

### routeDecisionDropSelected
- ko: 선택한 {n}개 목표에서 빼기
- en: Remove {n} from goals
- 쓰는 곳: src/app/components/RouteDecision.tsx

### routeDecisionPending
- ko: 대안 계산 중…
- en: Computing alternatives…
- 쓰는 곳: src/app/components/RouteDecision.tsx

### routeDecisionTitleShort
메모: M115: 맞바꿈(`tradeoffs`)을 구했으면 머리는 이것이고, 그 아래 줄들이 양쪽 이름을 말한다.
- ko: 전부 얻을 수 없습니다
- en: They do not all fit one run
- 쓰는 곳: src/app/components/RouteDecision.tsx

### routeDecisionTitleShortMany
- ko: 전부 얻을 수 없습니다 · {n}개를 목표에서 빼야 합니다
- en: They do not all fit one run · remove {n} from the goals
- 쓰는 곳: src/app/components/RouteDecision.tsx

### routeDecisionTradeoff
메모: 막대가 오기 전: 놓친 목표 하나를 반드시로 둔 계획이 대신 잃는 목표. 「빼야 한다」고 단정하지 않는다 — 같은 자리를 다투는 목표가 여럿이면 탐색이 그중 하나를 고른 것이다.
- ko: {lost}을(를) 얻는 루트에서는 {causes}이(가) 빠집니다
- en: A route that gets {lost} leaves out {causes}
- 쓰는 곳: src/app/components/RouteDecision.tsx

### routeDecisionTradeoffAny
메모: 계산한 막대 중 혼자 빼면 그 목표가 사는 것(`rivals`)이 둘 이상일 때. 각 막대가 실제로 계산한 사실이다.
- ko: {lost}을(를) 얻으려면 {names} 중 하나를 빼면 됩니다
- en: To get {lost}, remove any one of {names}
- 쓰는 곳: src/app/components/RouteDecision.tsx

### routeDecisionTradeoffOne
- ko: {lost}을(를) 얻으려면 {name}을(를) 빼면 됩니다
- en: To get {lost}, remove {name}
- 쓰는 곳: src/app/components/RouteDecision.tsx

### routeDecisionRoleCause
메모: 막대의 역할 표식. 원인 = 맞바꿈 상대.
- ko: 원인
- en: Cause
- 쓰는 곳: src/app/components/RouteDecision.tsx

### routeDecisionRoleLost
- ko: 놓친 목표
- en: Left out
- 쓰는 곳: src/app/components/RouteDecision.tsx

### routeDecisionRoleStart
- ko: 시작 기프트
- en: Start gift
- 쓰는 곳: src/app/components/RouteDecision.tsx

### routeDecisionLastAdded
메모: `wanted`의 마지막 — 고른 순서대로 쌓이므로 마지막에 고른 목표다.
- ko: 마지막에 추가
- en: Added last
- 쓰는 곳: src/app/components/RouteDecision.tsx

### routeDecisionSharesPack
메모: −0 막대 아래: 같은 팩을 쓰는 다른 목표가 남아 그 팩에 여전히 들어간다.
- ko: 혼자 빼면 자리가 나지 않습니다 · 같은 팩: {names}
- en: Frees nothing alone · same pack: {names}
- 쓰는 곳: src/app/components/RouteDecision.tsx

### routeDecisionMeasured
메모: 후보가 상한(10개)이나 계산 예산에 잘렸을 때.
- ko: 후보 {total}개 중 {done}개 계산
- en: {done} of {total} candidates measured
- 쓰는 곳: src/app/components/RouteDecision.tsx

### routeDecisionMore
- ko: 더 계산
- en: Measure the rest
- 쓰는 곳: src/app/components/RouteDecision.tsx

### routeDecisionCandidates
- ko: 뺄 후보
- en: Candidates to remove
- 쓰는 곳: 참조 없음

### routeClose
- ko: 닫기
- en: Close
- 쓰는 곳: src/app/components/FusionNotice.tsx, src/app/components/GiftDetailSheet.tsx, src/app/components/MetroMap.tsx, src/app/components/ObserveSlots.tsx, src/app/components/PackSheet.tsx, src/app/shell/AppShell.tsx, src/app/shell/CapturePanel.tsx, src/app/shell/GuideSheet.tsx

### packGifts
- ko: 이 팩의 기프트
- en: Gifts from this pack
- 쓰는 곳: src/app/components/PackSheet.tsx

### packFloorRange
- ko: {floors}층
- en: Floors {floors}
- 쓰는 곳: src/app/components/MetroMap.tsx, src/app/components/PackSheet.tsx

### routeFree
- ko: 자유
- en: Free
- 쓰는 곳: 참조 없음

### routeFloorRange
- ko: {from}~{to}층
- en: Floors {from}–{to}
- 쓰는 곳: src/app/components/MetroMap.tsx, src/app/components/RouteDecision.tsx

### routeConditions
- ko: 조건 판정
- en: Conditions
- 쓰는 곳: 참조 없음

### routeConditionsBasis
- ko: 출격 {n} 기준
- en: for {n} deployed
- 쓰는 곳: 참조 없음

### routeWarnings
- ko: 참고
- en: Notes
- 쓰는 곳: src/app/shell/RoutePlanPanel.tsx

### routeRecomputing
메모: 새 루트를 계산하는 동안 이전 루트 위에 뜬다. 「계산 중」이 아닌 것은 보이는 것이 빈 패널이 아니라 한 박자 늦은, 여전히 쓸 수 있는 루트이기 때문이다.
- ko: 갱신 중…
- en: updating…
- 쓰는 곳: src/app/shell/RoutePlanPanel.tsx

### routeSourcePack
메모: 이 루트가 기프트를 얻는 곳(routeSourceText): 층과 팩 / 관측 / 시작 기프트 / 범용 드랍 / 몇 층 이후 조합.
- ko: {floor}층 {name}
- en: floor {floor}, {name}
- 쓰는 곳: src/app/lib/route-source.ts

### routeSourceObserved
- ko: 관측
- en: observation
- 쓰는 곳: src/app/lib/route-source.ts

### routeSourceStart
- ko: 시작 기프트
- en: starting gift
- 쓰는 곳: src/app/lib/route-source.ts

### routeSourceGeneral
- ko: 범용 드랍
- en: general drop
- 쓰는 곳: src/app/lib/route-source.ts

### routeSourceFusion
- ko: {floor}층 이후 조합
- en: fused after floor {floor}
- 쓰는 곳: src/app/lib/route-source.ts

### routeSourceFusionUnreachable
- ko: 조합 불가
- en: cannot be fused
- 쓰는 곳: src/app/lib/route-source.ts

### routeApproxHint
- ko: 목표가 많아 탐색을 끝까지 하지 못했습니다. 최선이 아닐 수 있고, 목표를 더 넣으면 이미 획득한 것이 빠질 수 있습니다.
- en: Too many goals to search exhaustively. This may not be optimal, and adding goals can drop ones already got.
- 쓰는 곳: src/app/shell/RoutePlanPanel.tsx

### routeEmpty
- ko: 목표를 정하면 루트가 나옵니다
- en: Set goals and the route appears
- 쓰는 곳: src/app/shell/RoutePlanPanel.tsx

### fusionLostTitle
메모: 런의 미획득이 조합을 죽였을 때 전체 루트 탭 맨 위(FusionLostNotice).
- ko: 조합 불가로 루트 변경
- en: Route changed: fusion lost
- 쓰는 곳: src/app/components/FusionLostNotice.tsx

### fusionLostText
- ko: {missing} 얻지 못해 {result} 조합할 수 없습니다. 루트를 다시 계산했습니다.
- en: {missing} was not got, so {result} cannot be fused. The route was re-planned.
- 쓰는 곳: src/app/components/FusionLostNotice.tsx

### fusionLostCollect
메모: 죽은 조합 아래의 토글 하나: 남은 재료를 위해 계속 팩에 들어간다.
- ko: {name} 남은 재료 모으기
- en: Keep collecting the rest of {name}
- 쓰는 곳: src/app/components/FusionLostNotice.tsx

### fusionLostCollecting
메모: 남은 재료 아래의 상태 막대: 지금 루트가 그것들을 어떻게 하는지.
- ko: 모으기
- en: Collect
- 쓰는 곳: src/app/components/FusionLostNotice.tsx

### fusionLostNotCollecting
- ko: 모으지 않기
- en: Don't collect
- 쓰는 곳: src/app/components/FusionLostNotice.tsx

### fusionLostKept
- ko: 남은 재료({names})는 계속 모으러 갑니다.
- en: The route still goes after the remaining ingredients ({names}).
- 쓰는 곳: src/app/components/FusionLostNotice.tsx

### unresolvedDropped
- ko: 나머지 재료({names})만을 위한 입장은 취소했습니다.
- en: Pack entries for the remaining ingredients ({names}) alone were dropped.
- 쓰는 곳: src/app/components/FusionLostNotice.tsx

## 스테이지 (가운데 런 화면)

### floorStrip
- ko: 층
- en: Floors
- 쓰는 곳: src/app/stage/FloorHeader.tsx

### runActive
- ko: 진행 중
- en: In progress
- 쓰는 곳: 참조 없음

### runCurrentFloor
- ko: 현재 층
- en: Current floor
- 쓰는 곳: 참조 없음

### runVisited
- ko: {floor}층 입장
- en: Entered on floor {floor}
- 쓰는 곳: 참조 없음

### runVisitedShort
- ko: 입장 · {floor}층
- en: Entered · F{floor}
- 쓰는 곳: src/app/stage/EnterablePacks.tsx

### runPassed
- ko: 지남
- en: Passed
- 쓰는 곳: 참조 없음

### giftStatusGot
- ko: 획득
- en: Got
- 쓰는 곳: src/app/components/GiftIcon.tsx

### giftStatusFailed
- ko: 미획득
- en: Not got
- 쓰는 곳: src/app/components/GiftIcon.tsx

### stageFloor
- ko: {floor}층
- en: Floor {floor}
- 쓰는 곳: src/app/components/PackSheet.tsx, src/app/components/RouteDecision.tsx, src/app/stage/FloorHeader.tsx

### stageOf
- ko: / {last}
- en: / {last}
- 쓰는 곳: src/app/stage/FloorHeader.tsx

### stageEnterable
- ko: 이 층에서 들어갈 수 있는 팩
- en: Packs you can enter on this floor
- 쓰는 곳: src/app/stage/RunStage.tsx

### stageNoRoutePack
- ko: 계획된 팩 없음
- en: No planned pack
- 쓰는 곳: src/app/stage/RunStage.tsx

### stageNoGoals
- ko: 아직 목표 기프트가 없습니다.
- en: No goal gifts yet.
- 쓰는 곳: src/app/stage/RunStage.tsx

### stageOtherPacks
- ko: 다른 팩
- en: Other packs
- 쓰는 곳: src/app/stage/EnterablePacks.tsx

### stagePackAlternatives
- ko: 외 {n}
- en: {n} more
- 쓰는 곳: src/app/stage/EnterablePacks.tsx

### stageSameGifts
- ko: 같은 기프트
- en: Same gifts
- 쓰는 곳: src/app/stage/EnterablePacks.tsx

### stageOtherSearch
- ko: 이 층의 팩 검색
- en: Search packs on this floor
- 쓰는 곳: src/app/stage/EnterablePacks.tsx

### stageOtherNone
- ko: 맞는 팩이 없습니다.
- en: No matching pack.
- 쓰는 곳: src/app/stage/EnterablePacks.tsx

### stageSkipped
- ko: 입장하지 않음 · 기록됨
- en: Skipped · recorded
- 쓰는 곳: src/app/stage/FloorHeader.tsx

### stageEnter
- ko: 입장
- en: Enter
- 쓰는 곳: src/app/components/PackSheet.tsx, src/app/stage/EnterablePacks.tsx

### stageEnterPack
- ko: {name} 입장
- en: Enter {name}
- 쓰는 곳: src/app/components/PackSheet.tsx, src/app/stage/EnterablePacks.tsx

### stageUnenter
- ko: 입장 취소
- en: Undo entry
- 쓰는 곳: src/app/components/PackSheet.tsx, src/app/stage/EnteredPack.tsx

### stageReleaseEnter
- ko: 놓으면 입장
- en: Release to enter
- 쓰는 곳: src/app/stage/EnterablePacks.tsx

### stageOtherEntry
- ko: 다음 층
- en: Next floor
- 쓰는 곳: src/app/stage/EnterablePacks.tsx

### stageReleaseNext
- ko: 놓으면 다음 층
- en: Release for the next floor
- 쓰는 곳: src/app/stage/EnterablePacks.tsx, src/app/stage/EnteredPack.tsx

### stageReleaseBack
- ko: 놓으면 입장 취소 · 표시한 기프트 초기화
- en: Release to undo entry · marked gifts reset
- 쓰는 곳: src/app/stage/EnteredPack.tsx

### stageBackPack
- ko: {name} 입장 취소
- en: Undo entry to {name}
- 쓰는 곳: src/app/stage/EnteredPack.tsx

### stageExclusiveMore
- ko: +{n}
- en: +{n}
- 쓰는 곳: src/app/stage/EnterablePacks.tsx

### stagePackDetail
- ko: {name} 자세히
- en: {name} details
- 쓰는 곳: src/app/stage/EnterablePacks.tsx, src/app/stage/EnteredPack.tsx

### stageEntered
- ko: {floor}층에 입장
- en: Entered on floor {floor}
- 쓰는 곳: src/app/components/PackSheet.tsx

### stageExclusives
- ko: 이 팩에서 챙길 기프트
- en: Gifts to collect in this pack
- 쓰는 곳: src/app/stage/EnteredPack.tsx

### stageExclusivesNone
- ko: 챙길 기프트 없음
- en: Nothing to collect here
- 쓰는 곳: src/app/stage/EnteredPack.tsx

### stageGoalsFirst
- ko: 목표
- en: Goals
- 쓰는 곳: src/app/stage/EnteredPack.tsx

### stageNext
- ko: 다음 층
- en: Next floor
- 쓰는 곳: src/app/stage/EnterablePacks.tsx, src/app/stage/EnteredPack.tsx

### stageDone
- ko: {last}층까지 마쳤습니다
- en: Floor {last} is done
- 쓰는 곳: src/app/stage/FloorHeader.tsx, src/app/stage/RunStage.tsx

### stageNewRun
메모: 헤더의 초기화는 덱과 목표까지 지운다. 거울 던전은 반복 컨텐츠라 흔한 다음 행동은 둘 다 남기는 것이다.
- ko: 같은 목표로 새 런
- en: New run, same goals
- 쓰는 곳: src/app/stage/RunStage.tsx

### giftTileToggle
- ko: {name} 획득 표시
- en: Mark {name} as got
- 쓰는 곳: src/app/components/GiftTile.tsx

## 화면 인식 (헤더 버튼과 팝오버)

### captureTitle
- ko: 화면 인식
- en: Screen reader
- 쓰는 곳: src/app/shell/CapturePanel.tsx

### captureStart
- ko: 화면 인식 시작
- en: Start reading the screen
- 쓰는 곳: src/app/shell/CapturePanel.tsx

### captureStop
- ko: 중지
- en: Stop
- 쓰는 곳: src/app/shell/CapturePanel.tsx

### captureIdle
- ko: 게임 창을 공유하면 팩 입장과 기프트 획득을 자동으로 기록합니다
- en: Share the game window to record pack entries and gifts automatically
- 쓰는 곳: src/app/shell/CapturePanel.tsx

### captureStarting
- ko: 게임 창 연결 중
- en: Connecting to the game window
- 쓰는 곳: src/app/shell/CapturePanel.tsx

### captureRunning
- ko: 인식 중
- en: Reading
- 쓰는 곳: src/app/shell/CapturePanel.tsx

### captureErrShort
- ko: 오류
- en: Error
- 쓰는 곳: src/app/shell/CapturePanel.tsx

### captureAsking
- ko: 확인할 것 {n}개
- en: {n} to confirm
- 쓰는 곳: src/app/shell/CapturePanel.tsx

### capturePrivacy
- ko: 화면은 이 브라우저 안에서만 읽고 어디로도 보내지 않습니다
- en: The screen is read in this browser only and sent nowhere
- 쓰는 곳: src/app/shell/CapturePanel.tsx

### captureErr_unsupported
- ko: 이 브라우저는 화면 공유를 지원하지 않습니다
- en: This browser cannot share a screen
- 쓰는 곳: src/app/shell/CapturePanel.tsx (동적)

### captureErr_denied
- ko: 화면 공유를 허용하지 않았습니다. 다시 시작하면 다시 묻습니다
- en: Screen sharing was not allowed. Starting again asks again
- 쓰는 곳: src/app/shell/CapturePanel.tsx (동적)

### captureErr_ended
- ko: 화면 공유가 끝났습니다
- en: Screen sharing ended
- 쓰는 곳: src/app/shell/CapturePanel.tsx (동적)

### captureErr_engine
- ko: 글자 인식 엔진을 불러오지 못했습니다
- en: Could not load the text recognition engine
- 쓰는 곳: src/app/shell/CapturePanel.tsx (동적)

### captureErr_layout
- ko: 화면 배치 정보를 불러오지 못했습니다
- en: Could not load the screen layout
- 쓰는 곳: src/app/shell/CapturePanel.tsx (동적)

### captureInterval
- ko: 판독 간격
- en: Read interval
- 쓰는 곳: src/app/shell/CapturePanel.tsx

### captureInterval_economy
- ko: 최고 성능 · 1초
- en: Lightest · 1 s
- 쓰는 곳: src/app/shell/CapturePanel.tsx (동적)

### captureInterval_performance
- ko: 성능 · 0.5초
- en: Light · 0.5 s
- 쓰는 곳: src/app/shell/CapturePanel.tsx (동적)

### captureInterval_balanced
- ko: 밸런스 · 0.25초
- en: Balanced · 0.25 s
- 쓰는 곳: src/app/shell/CapturePanel.tsx (동적)

### captureInterval_quality
- ko: 품질 · 0.125초
- en: Quality · 0.125 s
- 쓰는 곳: src/app/shell/CapturePanel.tsx (동적)

### captureLang
- ko: 게임 언어
- en: Game language
- 쓰는 곳: src/app/shell/CapturePanel.tsx

### captureLang_ko
- ko: 한국어
- en: Korean
- 쓰는 곳: src/app/shell/CapturePanel.tsx

### captureLang_en
- ko: English (화면 제목 미확인)
- en: English (screen titles not known yet)
- 쓰는 곳: src/app/shell/CapturePanel.tsx

### captureLog
- ko: 기록
- en: Log
- 쓰는 곳: src/app/shell/CapturePanel.tsx

### captureLogEmpty
- ko: 아직 기록한 것이 없습니다
- en: Nothing recorded yet
- 쓰는 곳: src/app/shell/CapturePanel.tsx

### captureLogEnter
- ko: {floor}층 입장 · {name}
- en: Floor {floor} entered · {name}
- 쓰는 곳: src/app/shell/CapturePanel.tsx

### captureLogGot
- ko: 획득 · {name}
- en: Got · {name}
- 쓰는 곳: src/app/shell/CapturePanel.tsx

### captureLogSold
- ko: 판매 · {name}
- en: Sold · {name}
- 쓰는 곳: src/app/shell/CapturePanel.tsx

### captureLogFused
- ko: 합성 · {name}
- en: Fused · {name}
- 쓰는 곳: src/app/shell/CapturePanel.tsx

### captureLogAnswer
- ko: 직접 고름 · {name}
- en: Picked · {name}
- 쓰는 곳: src/app/shell/CapturePanel.tsx

### captureUndo
- ko: 되돌리기
- en: Undo
- 쓰는 곳: src/app/shell/CapturePanel.tsx

### captureUndone
- ko: 되돌림
- en: Undone
- 쓰는 곳: src/app/shell/CapturePanel.tsx

### captureAskGift
- ko: 어느 기프트를 얻었나요?
- en: Which gift did you get?
- 쓰는 곳: src/app/shell/CapturePanel.tsx

### captureAskPack
- ko: {floor}층에서 어느 팩에 입장했나요?
- en: Which pack did you enter on floor {floor}?
- 쓰는 곳: src/app/shell/CapturePanel.tsx

### captureAskConsumed
- ko: {name} 합성에 쓴 기프트를 골라 주세요
- en: Pick the gifts the {name} fusion used
- 쓰는 곳: src/app/shell/CapturePanel.tsx

### captureAskApply
- ko: 적용
- en: Apply
- 쓰는 곳: src/app/shell/CapturePanel.tsx

### captureAskDismiss
- ko: 무시
- en: Ignore
- 쓰는 곳: src/app/shell/CapturePanel.tsx

## 진단 기록 (소유자 전용 — 주소에 #diag를 붙여 열 때만)

메모가 아닌 화면 문구지만 방문자에게는 보이지 않습니다. 화면 인식 팝오버 맨 아래에 나옵니다.

### diagTitle
- ko: 진단 기록 (소유자용)
- en: Diagnostics (owner only)
- 쓰는 곳: src/app/shell/DiagnosticsSection.tsx

### diagHide
- ko: 숨기기
- en: Hide
- 쓰는 곳: src/app/shell/DiagnosticsSection.tsx

### diagRecord
- ko: 진단 기록
- en: Record diagnostics
- 쓰는 곳: src/app/shell/DiagnosticsSection.tsx

### diagImages
- ko: 화면 이미지 포함
- en: Include screen images
- 쓰는 곳: src/app/shell/DiagnosticsSection.tsx

### diagImagesWarn
- ko: 이미지에는 게임 화면이 들어 있습니다. 공개된 곳에 올리지 마세요.
- en: Images contain game screens. Do not post them anywhere public.
- 쓰는 곳: src/app/shell/DiagnosticsSection.tsx

### diagEmpty
- ko: 아직 기록이 없습니다
- en: Nothing recorded yet
- 쓰는 곳: src/app/shell/DiagnosticsSection.tsx

### diagStats
- ko: 기록 {records}건 · 이미지 {frames}장 · 약 {mb}MB
- en: {records} records · {frames} images · about {mb} MB
- 쓰는 곳: src/app/shell/DiagnosticsSection.tsx

### diagLastExport
- ko: 마지막 내보내기 {time}
- en: last exported {time}
- 쓰는 곳: src/app/shell/DiagnosticsSection.tsx

### diagFull
- ko: 기록이 가득 찼습니다(2만 건). 내보내고 지워야 다시 기록합니다.
- en: The record is full (20,000). Export and clear it to record again.
- 쓰는 곳: src/app/shell/DiagnosticsSection.tsx

### diagTrimmed
- ko: 이미지 상한을 넘어 오래된 {n}장을 지웠습니다.
- en: Over the image cap: the oldest {n} were dropped.
- 쓰는 곳: src/app/shell/DiagnosticsSection.tsx

### diagSavedTitle
- ko: 내보낸 뒤 정리
- en: After exporting
- 쓰는 곳: src/app/shell/DiagnosticsSection.tsx

### diagSavedPrompt
- ko: {name}을(를) 저장했으면 기기의 기록을 지우세요. 그 파일 하나만 전달하면 됩니다.
- en: Once {name} is saved, clear the record on this device. That one file is all you hand over.
- 쓰는 곳: src/app/shell/DiagnosticsSection.tsx

### diagClearExported
- ko: 기록 지우기
- en: Clear the record
- 쓰는 곳: src/app/shell/DiagnosticsSection.tsx

### diagLater
- ko: 나중에
- en: Later
- 쓰는 곳: src/app/shell/DiagnosticsSection.tsx

### diagExportedLeft
- ko: 내보낸 기록 {n}건이 아직 기기에 남아 있습니다
- en: {n} exported records are still on this device
- 쓰는 곳: src/app/shell/DiagnosticsSection.tsx

### diagCleared
- ko: 기록 {records}건과 이미지 {frames}장을 지웠습니다.
- en: Cleared {records} records and {frames} images.
- 쓰는 곳: src/app/shell/DiagnosticsSection.tsx

### diagExport
- ko: 내보내기
- en: Export
- 쓰는 곳: src/app/shell/DiagnosticsSection.tsx

### diagExportFailed
- ko: 내보내지 못했습니다. 기록은 그대로 남아 있으니 다시 내보내 보세요.
- en: The export failed. Everything is still on this device; try exporting again.
- 쓰는 곳: src/app/shell/DiagnosticsSection.tsx

### diagClearAll
- ko: 모두 지우기
- en: Clear all
- 쓰는 곳: src/app/shell/DiagnosticsSection.tsx

### diagClearAllConfirm
- ko: 내보내지 않은 것까지 기록 {records}건과 이미지 {frames}장을 모두 지웁니다. 되돌릴 수 없습니다.
- en: This clears all {records} records and {frames} images, exported or not. It cannot be undone.
- 쓰는 곳: src/app/shell/DiagnosticsSection.tsx

### diagWhere
- ko: 보낼 곳: 내보낸 zip을 Claude Code 개발 세션에 첨부하고 「진단 기록 분석해 줘」라고 보내세요. 직접 돌릴 때는 개발 저장소의 local-fixtures/sessions/에 넣고 npm run capture:feedback을 실행합니다. 게임 화면이 들어 있으니 이슈·채팅방 같은 공개된 곳에는 올리지 마세요.
- en: Where it goes: attach the exported zip to a Claude Code development session and say “analyse the diagnostics”. To run it yourself, put it in local-fixtures/sessions/ of the development repository and run npm run capture:feedback. It contains game screens, so keep it out of public places such as issues and chat rooms.
- 쓰는 곳: src/app/shell/DiagnosticsSection.tsx

## 추적기 탭

### trackerTitle
- ko: T4 기프트 추적
- en: T4 gift tracker
- 쓰는 곳: src/app/tracker/Tracker.tsx

### trackerGroupKeyword
- ko: 키워드
- en: Keyword
- 쓰는 곳: src/app/tracker/Tracker.tsx

### trackerGroupShard
- ko: 조각
- en: Shards
- 쓰는 곳: src/app/tracker/Tracker.tsx

### trackerGroupMemory
- ko: 기억
- en: Memories
- 쓰는 곳: src/app/tracker/Tracker.tsx

### trackerGroupAttack
- ko: 공격 유형
- en: Attack type
- 쓰는 곳: src/app/tracker/Tracker.tsx

### trackerGroupPlain
- ko: 키워드 없음
- en: Keywordless
- 쓰는 곳: src/app/tracker/Tracker.tsx

### trackerFusionNotice
- ko: 조합으로 소모한 조각 {a}개·기억 {b}개는 미획득으로 표시하세요.
- en: Mark the {a} shards and {b} memories the fusion consumed as not got.
- 쓰는 곳: src/app/components/FusionNotice.tsx

### trackerFusionHeld
- ko: 지금 획득으로 표시된 재료
- en: Ingredients marked as got
- 쓰는 곳: src/app/components/FusionNotice.tsx

### trackerUnmark
- ko: 미획득으로
- en: Not got
- 쓰는 곳: src/app/components/FusionNotice.tsx

## 확인창

### confirmSharedTitle
메모: 런을 버리고 되돌릴 수 없는 두 동작(링크 열기·시즌 바꾸기)이라 먼저 묻는다 — 런이 진행 중일 때만.
- ko: 진행 중인 런을 버리고 링크를 열까요?
- en: Discard the run in progress and open the link?
- 쓰는 곳: src/app/App.tsx

### confirmSharedMessage
- ko: 보낸 사람의 덱·목표·설정으로 덮어씁니다. 지금 런의 기록은 되돌릴 수 없습니다.
- en: Replaces your deck, goals and settings with the sender's. The current run record cannot be recovered.
- 쓰는 곳: src/app/App.tsx

### confirmSharedConfirm
- ko: 링크 열기
- en: Open the link
- 쓰는 곳: src/app/App.tsx

### confirmSeasonTitle
- ko: 진행 중인 런을 버리고 시즌을 바꿀까요?
- en: Discard the run in progress and change season?
- 쓰는 곳: src/app/App.tsx

### confirmSeasonMessage
- ko: 시즌을 바꾸면 런을 버리고, 새 시즌이 모르는 기프트·팩 설정도 빠집니다.
- en: Changing season discards the run and drops any gift or pack setting the new season does not know.
- 쓰는 곳: src/app/App.tsx

### confirmSeasonConfirm
- ko: 시즌 바꾸기
- en: Change season
- 쓰는 곳: src/app/App.tsx

## 설명서 창

### guide
- ko: 설명서
- en: Guide
- 쓰는 곳: src/app/shell/AppShell.tsx, src/app/shell/GuideSheet.tsx

### guidePrev
- ko: 이전 카드
- en: Previous card
- 쓰는 곳: src/app/shell/GuideSheet.tsx

### guideNext
- ko: 다음 카드
- en: Next card
- 쓰는 곳: src/app/shell/GuideSheet.tsx

### guideDone
- ko: 닫기
- en: Close
- 쓰는 곳: src/app/shell/GuideSheet.tsx

### guideCard
- ko: {n} / {total} · {title}
- en: {n} / {total} · {title}
- 쓰는 곳: src/app/shell/GuideSheet.tsx

### guideNotice
- ko: 출처와 라이선스 (NOTICE)
- en: Sources and licences (NOTICE)
- 쓰는 곳: src/app/shell/GuideSheet.tsx

# 루트 경고·미해결 사유

플래너(core)가 만드는 문장입니다. 코드에서는 `msg('키', { 값 })`로 부르고, 자리표시를 빠뜨리면 타입 검사가 실패합니다.

## 경고 (전체 루트의 「참고」 카드)

이름이 붙는 경고는 화면이 문장 뒤에 「 — 기프트 이름」을 덧붙입니다.

### warn.parallelRequiresHard
메모: 화면에는 나오지 않는다(SILENT_WARNINGS) — 앱은 늘 Hard로 계획한다. CLI만 보인다.
- ko: 평행중첩({parallelFrom}층 이상)은 1~{lastHard}층을 전부 Hard로 클리어해야 들어갈 수 있어, 1층부터 Hard로 계획했습니다.
- en: Floors {parallelFrom}+ need floors 1-{lastHard} cleared on Hard, so the plan switches to Hard from floor 1.
- 쓰는 곳: src/core/index.ts

### warn.packOptionDropped
- ko: 알 수 없거나 그 층에 나오지 않거나 서로 모순되는 팩 지정은 제외했습니다.
- en: Pack choices that are unknown, not offered on that floor, or contradictory were dropped.
- 쓰는 곳: src/core/index.ts

### warn.packOptionUnplaced
- ko: 포함하기로 한 팩 중 남은 층에 넣을 수 없는 것이 있습니다.
- en: Some packs you chose to include have no floor left in the plan.
- 쓰는 곳: src/core/index.ts

### warn.observationAfterStart
- ko: 기프트 관측은 1층을 떠나기 전에만 할 수 있어, 그 뒤에 지정한 관측은 적용하지 않았습니다.
- en: Gift observation only happens before floor 1 is left, so pins added later were not applied.
- 쓰는 곳: src/core/index.ts

### warn.observationTrimmed
- ko: 관측으로 지정한 기프트 중 관측할 수 없거나, 한도({budget}개)를 넘거나, 이번 계획의 목표가 아닌 것은 제외했습니다.
- en: Some pinned observations were dropped: not observable, over the {budget}-slot limit, or not a goal of this plan.
- 쓰는 곳: src/core/index.ts

### warn.sharedIngredient
메모: {gifts}는 「·」로 이은 기프트 이름.
- ko: {gifts|은/는} 두 조합이 함께 먹습니다. 같은 기프트는 한 번에 하나만 가질 수 있으니, 먼저 조합해 소모한 뒤에야 두 번째 것이 다시 나옵니다.
- en: Two fusions eat the same ingredient. A gift you hold is never offered again, so the first fusion has to happen before the second copy can drop.
- 쓰는 곳: src/core/index.ts

### warn.conditionUnmet
메모: 화면에는 나오지 않는다(SILENT_WARNINGS) — 조건은 타일의 링이 말한다. CLI만 보인다.
- ko: 조건을 충족하지 못하는 기프트가 {count}개 있습니다. 효과가 발동하지 않습니다.
- en: {count} gift(s) will not activate with this deck.
- 쓰는 곳: src/core/index.ts

### warn.generalDropNotGuaranteed
메모: 화면에는 나오지 않는다(SILENT_WARNINGS) — 범용 드랍 구분은 기프트 탭과 상세 시트가 말한다. CLI만 보인다.
- ko: 범용 드랍은 어느 팩에서나 나올 수 있을 뿐 반드시 나오지는 않습니다. 상점과 새로고침을 함께 쓰세요.
- en: General drops can come from any pack but are never guaranteed; use the shop and refreshes.
- 쓰는 곳: src/core/index.ts

### warn.fusionSlots
- ko: 재료가 {max}개를 넘어 일반 상점에서는 한 번에 조합할 수 없습니다. 하위 재료부터 조합하세요.
- en: Needs more than {max} fusion slots, so fuse the sub-ingredients first.
- 쓰는 곳: src/core/index.ts

### warn.giftObservationUnverified
- ko: 기프트 관측 별빛 비용표는 인게임 확인이 필요한 값입니다(구버전 기준).
- en: The gift-observation starlight cost is taken from an older season and needs in-game confirmation.
- 쓰는 곳: src/core/index.ts

### warn.searchCapped
- ko: 탐색 한도에 도달해 최선에 가까운 결과만 보여 줍니다. 목표 기프트를 줄이면 더 정확해집니다.
- en: The search hit its node cap, so this is a near-best plan. Fewer goal gifts will sharpen it.
- 쓰는 곳: src/core/index.ts

### warn.hardRequired
- ko: Hard에서만 등장하는 팩이 필요한 기프트가 있습니다. 난이도를 Hard로 올리면 루트가 넓어집니다.
- en: Some wanted gifts only come from Hard-only packs; switching to Hard widens the route.
- 쓰는 곳: src/core/index.ts

## 미해결 사유

앱은 이 문장을 보여 주지 않고 사유 코드만 씁니다(결정 카드·조합 불가 알림이 자기 문장을 씁니다). `npm run route`(CLI)가 출력합니다.

### unresolved.notInData
- ko: 게임 데이터에 없는 기프트입니다.
- en: Not present in the game data.
- 쓰는 곳: src/core/requirements.ts

### unresolved.notObtainable
- ko: 이번 시즌에 획득할 수 없는 기프트입니다.
- en: Not obtainable in the current season.
- 쓰는 곳: src/core/index.ts

### unresolved.chanceOnly
메모: 층당 확률을 모를 때. 「확정」이라는 낱말은 쓰지 않는다(테스트가 지킨다).
- ko: {floors}층 히든 전투 보상으로만 나오는 기프트입니다. 루트로 정할 수 없습니다.
- en: Only a random hidden-battle reward on floors {floors}; the route cannot plan for it.
- 쓰는 곳: src/core/index.ts

### unresolved.chanceOnlyRate
메모: 층당 확률을 알 때.
- ko: {floors}층 히든 전투 보상(층당 {pct}%)으로만 나오는 기프트입니다. 루트로 정할 수 없습니다.
- en: Only a random hidden-battle reward on floors {floors} ({pct}% per floor); the route cannot plan for it.
- 쓰는 곳: src/core/index.ts

### unresolved.eventOnly
- ko: 선택지·이벤트로만 얻는 기프트라 팩 루트로 계획할 수 없습니다.
- en: Only obtained through a choice event, so no pack route can plan for it.
- 쓰는 곳: src/core/index.ts

### unresolved.materialOnly
- ko: 잔영은 조합·판매용 재료라 팩 루트로 계획할 수 없습니다.
- en: A fusion/sale material; no pack route can plan for it.
- 쓰는 곳: src/core/index.ts

### unresolved.hardOnly
- ko: Hard 난이도에서만 얻을 수 있는 기프트입니다. 난이도를 Hard로 바꾸세요.
- en: Obtainable on Hard difficulty only. Switch the plan to Hard.
- 쓰는 곳: src/core/index.ts

### unresolved.ingredientShared
메모: {eaters}는 그 기프트를 먹는 조합 이름들(ko 「·」, en 「 and 」로 잇는다).
- ko: {gift|은/는} 한 런에서 한 번만 얻을 수 있는데 {eaters|이/가} 함께 먹습니다. 두 번째 몫을 줄 팩이 더 없습니다.
- en: {gift} can only be had once per run, and {eaters} both consume it. No further pack can supply a second copy.
- 쓰는 곳: src/core/index.ts

### unresolved.packConflict
- ko: 다른 전용 기프트와 층이 겹쳐 한 런에 같이 넣을 수 없습니다.
- en: Its pack competes for the same floor as another wanted exclusive.
- 쓰는 곳: src/core/index.ts

### unresolved.packBanned
- ko: 이 기프트를 주는 팩을 모두 제외했습니다.
- en: Every pack that supplies it has been excluded.
- 쓰는 곳: src/core/index.ts

### unresolved.noPackAhead
메모: 런 중(1층을 떠난 뒤).
- ko: {gift|을/를} 주는 팩이 남은 층에 없습니다.
- en: No pack that supplies it appears on the floors still ahead.
- 쓰는 곳: src/core/index.ts

### unresolved.noPackInRange
메모: 런 전.
- ko: {gift|을/를} 주는 팩이 계획한 층 범위에 없습니다.
- en: No pack that supplies it appears within the planned floors.
- 쓰는 곳: src/core/index.ts

### unresolved.fusionMissing
메모: {missing}은 구할 수 없는 재료의 id 목록.
- ko: 재료 {missing}을(를) 구할 수 없어 조합할 수 없습니다.
- en: Cannot be fused: ingredients {missing} are not obtainable in this plan.
- 쓰는 곳: src/core/index.ts

### unresolved.fusionMissingDropped
메모: 「재료는 목표가 아님」이라 남은 재료의 입장을 취소했을 때. {missing}·{dropped}는 id 목록.
- ko: 재료 {missing}을(를) 구할 수 없어 조합할 수 없습니다. 나머지 재료({dropped})만을 위한 입장은 취소했습니다.
- en: Cannot be fused: ingredients {missing} are not obtainable. Pack entries for the remaining ingredients ({dropped}) alone were dropped.
- 쓰는 곳: src/core/index.ts

### unresolved.failed
- ko: 미획득인 채로 층을 떠나 이 런에서는 더 얻을 수 없는 기프트입니다.
- en: Its floor was left with it not got, so it cannot be had this run.
- 쓰는 곳: src/core/requirements.ts

### unresolved.fusionTooDeep
- ko: 조합 단계가 너무 깊어 재료를 모두 추적할 수 없습니다.
- en: The fusion chain is deeper than the planner follows.
- 쓰는 곳: src/core/requirements.ts

### unresolved.noRecipe
- ko: 조합 레시피를 찾을 수 없습니다.
- en: No fusion recipe is known for this gift.
- 쓰는 곳: src/core/requirements.ts

## 조건 요약

기프트 조건의 짧은 요약입니다. 앱은 자기 문장(`condition-text.ts`)으로 그리고, 이것은 CLI가 출력합니다. 키워드·소속은 id 그대로 들어갑니다.

### cond.keywordCount
메모: 임계값 없이 편성 수에 따라 강화되는 조건.
- ko: {keywords} {verb} 스킬 보유 인격 {have}명 ({scope})
- en: {have} identities {verb} {keywords} ({scope})
- 쓰는 곳: src/core/deck.ts

### cond.keywordMin
- ko: {keywords} {verb} 스킬 보유 인격 {have}/{min} ({scope})
- en: {have}/{min} identities {verb} {keywords} ({scope})
- 쓰는 곳: src/core/deck.ts

### cond.faction
- ko: {factions} 소속 {have}/{min}인 ({scope})
- en: {have}/{min} identities from {factions} ({scope})
- 쓰는 곳: src/core/deck.ts

### cond.fullResonance
- ko: 완전 공명 {min} 이상 필요 (전투 중 판정이라 덱만으로는 알 수 없음)
- en: needs {min}+ full resonance, which depends on in-battle play
- 쓰는 곳: src/core/deck.ts

### cond.verbInflict
- ko: 부여
- en: inflict
- 쓰는 곳: src/core/deck.ts

### cond.verbConsume
- ko: 소모
- en: consume
- 쓰는 곳: src/core/deck.ts

### cond.scopeDeployed
- ko: 출격 인원
- en: deployed
- 쓰는 곳: src/core/deck.ts

### cond.scopeFormation
- ko: 편성 인원
- en: formation
- 쓰는 곳: src/core/deck.ts

### cond.scopeReserve
- ko: 대기 인원
- en: reserve
- 쓰는 곳: src/core/deck.ts

# 안내

헤더 「?」의 설명서 카드이자 README의 절입니다. 카드 하나가 README 절 하나가 되어, 둘의 제목·순서·그림이 늘 같습니다. 줄은 보이는 순서대로 적습니다.

- `- ko:` + `- en:` — 설명서와 README 둘 다에 나옵니다(README는 한국어만).
- `- 설명서:` + `- en:` — 설명서에만 나옵니다.
- `- readme:` — README에만 나옵니다(마크다운 그대로).
- `- 그림: guide/파일 | 대체 텍스트 | alt text` — 둘 다에 나옵니다. 파일은 `public/guide/`에 두고, 이미지(webp·png·jpg)는 300KB, 동영상(mp4·webm)은 2MB까지입니다.
- `- notice: true` — 설명서 카드 끝에 NOTICE 링크를 붙입니다.

README에서는 아래 「# README」의 `<!-- 카드: 제목 -->` 자리에 그 카드가 `## 제목` 절로 들어갑니다. 카드마다 표식이 하나씩, 카드 순서대로 있어야 합니다.

## 무엇을 해 주나 | What it does

- readme: 덱(인격 12인)을 고르거나 게임의 **편성 코드**를 붙여넣어 불러오기
- readme: 목표 기프트 정하기 — 키워드·조건·등급·죄악으로 필터, 조건부 기프트는 **내 덱이 조건을 충족하는지** 바로 표시
- readme: 층별 루트 제시 — 각 층에 들어갈 테마팩과 그 팩에서 챌 기프트, 시작 기프트, 그리고 **어떤 기프트를 관측하면 루트가 유연해지는지**(관측 추천)
- readme: 불가능한 요구는 이유와 함께 알려줌 (그 층 범위에 팩이 없음 / 전용 기프트끼리 층이 충돌 / 덱이 조건을 못 채움). 팩이 충돌하면 결정 카드가 목표마다 혼자 뺐을 때 줄어드는 충돌을 보여 주고, 고른 목표를 함께 빼면 실제로 어떻게 되는지 계산해 줌
- readme: 계산 결과를 URL로 공유
- 그림: guide/desktop-light.webp | 왼쪽에 목표 기프트, 가운데에 6층에서 들어갈 수 있는 팩, 오른쪽에 층별 루트 노선도가 있는 화면 | Goal gifts on the left, the packs to enter on floor 6 in the middle, the floor-by-floor route map on the right
- 설명서: 덱과 목표 E.G.O 기프트를 고르면, 몇 층에서 어느 테마팩에 들어가야 하는지 루트를 계산합니다.
- en: Pick a deck and the E.G.O gifts you want, and it plans the route: which theme pack to enter on which floor.
- 설명서: 계산 순서: 조합 기프트를 재료로 펼치고 → 팩이 필요 없는 범용 드랍을 빼고 → 관측·시작 기프트를 정한 뒤 → 기프트마다 그것을 주는 팩을 골라 층에 앉힙니다.
- en: In order: fusions are unfolded into ingredients → general drops, which need no pack, are set aside → observation and the starting gift are chosen → each gift gets a pack that gives it, seated on a floor.
- 설명서: 전부 얻을 수 없으면 무엇을 목표에서 빼야 하는지 알려 줍니다.
- en: When not everything fits, it says which goal to drop.
- 설명서: 덱과 목표는 메뉴의 「링크 복사」로 공유할 수 있습니다.
- en: Share the deck and goals with 「Copy link」 in the menu.

## 덱 | Deck

- readme: **덱 탭**에서 수감자 칸을 눌러 인격을 고르거나, 게임의 **편성 코드**를 「코드 가져오기」에 붙여 넣습니다. 코드에 출격 순서가 있으면 그대로 따릅니다.
- readme: 조건부 기프트(「출격 인원 중 화상 부여 스킬 3개 이상」 같은 것)는 대부분 **출격한 인격**만 셉니다. 칸의 「대기」를 눌러 「출격」으로 바꿔 출격 인원을 정해 두어야 조건 판정이 맞습니다.
- readme: 덱 아래 칩(「화상 2/5」)은 출격 인원 / 편성 전체의 스킬 수입니다.
- readme: 인격 검색은 이름·수감자·소속·키워드·공격 유형·죄악으로 찾습니다. 낱말을 여럿 넣으면 「하나라도」는 하나라도 맞는 인격, 「모두」는 전부 맞는 인격입니다(`화상 파우스트` + 「모두」 = 화상을 쓰는 파우스트 인격). 결과에는 키워드와 공격 유형이 함께 보이고, 지금 덱에 든 인격에는 「편성 중」이 붙습니다.
- 설명서: 왼쪽 위 「덱」 버튼이 덱과 기프트 패널을 엽니다.
- en: The 「Deck」 button at the top left opens the deck and gift panel.
- 설명서: 수감자 칸을 눌러 인격을 고르거나, 게임의 편성 코드를 「코드 가져오기」에 붙여 넣습니다.
- en: Press a sinner’s slot to pick an identity, or paste the game’s formation code into 「Import code」.
- 설명서: 인격 검색은 이름·소속·키워드·공격 유형·죄악으로 찾습니다. 낱말을 여럿 넣고 「모두」를 고르면 전부 맞는 인격만 남습니다(`화상 파우스트`).
- en: The identity search reads names, factions, keywords, attack types and sins. With several words, 「All」 keeps only identities matching every one (`Burn Faust`).
- 설명서: 조건부 기프트는 「출격」으로 선택된 인격을 기준으로 셉니다.
- en: Conditional gifts count the identities set to 「Deployed」.

## 기프트 | Gifts

- readme: **기프트 탭**에서 기프트를 찾아 목표로 삼습니다(타일의 아이콘을 누르면 목표에 추가, 이름을 누르면 상세). 검색은 전체 기프트에서, 부분 문자열로 찾고, 초성만 치면 초성 검색입니다. 검색 결과는 검색창 바로 아래에 나옵니다.
- readme: 검색창 오른쪽 끝의 **`>>`(모두 보기)**나 탭 아래의 「추천 기프트 보기」는 기프트를 넓은 격자로 엽니다(데스크톱은 가운데 스테이지 자리, 휴대폰은 새 페이지). 열려 있는 동안 같은 버튼이 **`<<`**로 바뀌어 누르면 다시 스테이지로 돌아옵니다. 탭에 친 검색어를 그대로 가져가며, 탭은 둘입니다.
- readme: **「추천 기프트」**는 열 때마다 먼저 열리는 탭으로, 지금 덱으로 발동할 수 있는 기프트만 모았습니다. 「덱 조건 충족」은 덱의 스킬·소속이 조건을 모두 채우는 기프트이고(편성된 수에 따라 강화되는 기프트는 출격한 인격이 한 명이라도 세어지면 들어갑니다), 「조건 없이 발동 · 팩 전용」은 조건이 없어 어느 덱에서나 발동하는 팩 전용 기프트입니다. 「획득」(팩 전용 · 범용)·「조합 기프트 포함」·「키워드」로 거르고, 「정렬」로 「키워드별」과 「팩 전용 먼저」를 고릅니다. 이미 목표인 기프트도 테두리와 ✓를 달고 그대로 나옵니다.
- readme: **「모든 기프트」**는 전체 기프트와 필터(키워드·조건·등급·죄악)입니다. 「조건」 필터의 **「조건 없음」**은 덱이 판정할 조건이 없는 기프트만 남깁니다(편성 수에 따라 강화되는 것과 완전 공명 조건은 덱 조건이 아닙니다).
- readme: 타일의 **바깥 링**이 조건 판정입니다(초록 충족 · 빨강 미충족 · 회색 조건 없음). 우하 배지는 키워드입니다.
- readme: 조합으로만 나오는 기프트를 고르면 재료까지 루트가 모으러 갑니다. 상세 시트의 「재료도 목표」를 끄면 결과만 목표로 둡니다. 조합식의 재료를 누르면 그 기프트의 설명으로 넘어가고, 맨 위 「←」로 돌아옵니다.
- readme: **시작 키워드**는 탭 맨 아래에 있습니다. 「자동」은 고른 기프트를 따라, 시작 기프트 풀에 목표가 든 키워드를 고릅니다(그런 풀이 없으면 덱의 주 키워드). 그 아래 한 줄이 어떤 시작 기프트를 받는지, 혹은 목표와 상관이 없어 아무 키워드나 골라도 되는지 알려 줍니다.
- readme: **관측**: 검색창 아래 슬롯(최대 3칸)에 기프트를 넣으면 「관측 지정」으로 「기프트 관측」에서 받습니다. 조합 결과는 관측할 수 없으므로 조합에 관측을 쓰려면 **재료**를 넣습니다. 관측은 1층을 떠나기 전까지만 바꿀 수 있습니다.
- 설명서: 기프트 탭에서 아이콘을 눌러 목표에 추가합니다.
- en: In the Gifts tab, press an icon to add it as a goal.
- 설명서: 검색창 끝의 >>를 누르면 「추천 기프트」가 먼저 열립니다. 지금 덱으로 발동할 수 있는 기프트만 모았고, 「모든 기프트」 탭에 전체가 있습니다.
- en: The >> at the end of the search box opens 「Recommended」 first: the gifts your deck can set off now. The 「All gifts」 tab has every gift.
- 설명서: 아이콘의 바깥 링은 조건 판정을 표시합니다. (초록 충족 · 빨강 미충족)
- en: The ring around an icon shows the condition (green met · red not met).
- 설명서: 관측 칸에 관측 가능한 기프트를 넣으면 기프트 관측으로 받습니다. 1층을 떠나면 바꿀 수 없습니다.
- en: Put an observable gift in an observation cell to take it through Gift Observation. It locks once you leave floor 1.

## 루트 | Route

- readme: 오른쪽 **전체 루트**가 층별 테마팩을 노선도로 그립니다. 요약의 「획득 M/T」는 목표 기프트 중 루트가 가져다주는 수입니다. 팩이 아니라 **어느 팩에서나 나올 수 있는** 범용 드랍도 획득으로 셉니다(반드시 나오지는 않습니다 — 상점·새로고침을 함께 쓰세요. 어느 기프트가 범용 드랍인지는 기프트 탭과 상세 시트가 말합니다).
- readme: **전부 얻을 수 없으면** 요약 아래에 「…중 하나를 목표에서 빼야 합니다」 카드가 뜹니다. 충돌을 일으킨 쪽도 이름으로 부릅니다 — 놓친 목표마다 「A을(를) 얻으려면 B · C 중 하나를 빼면 됩니다」라고 쓰고, 막대에는 「원인」·「놓친 목표」·「시작 기프트」·「마지막에 추가」 표식이 붙습니다. 목표마다 **혼자 뺐을 때 줄어드는 충돌** 수가 막대로 나옵니다. 후보가 많아 다 계산하지 못했으면 「더 계산」으로 나머지를 계산합니다. 막대는 더해지지 않으니, 뺄 목표를 체크하면 그 조합으로 실제 루트를 다시 계산해 전부 들어가는지, 충돌이 몇 개 남는지 알려 줍니다. 「빼면 해결: …」 줄의 「이 조합 고르기」는 해결되는 조합을 한 번에 체크합니다. 「루트 미리 보기」는 그 루트를 노선도로 보여 주고(노선도로 스크롤합니다), 「선택한 n개 목표에서 빼기」는 확인을 거쳐 목표에서 뺍니다.
- readme: 런 중에 조합 재료를 **미획득**해서 상위 기프트를 조합할 수 없게 되면, 전체 루트 맨 위에 어떤 재료 때문에 어느 조합이 막혔는지와 루트를 다시 계산했다는 알림이 뜹니다. 기본은 그 조합을 통째로 버리는 것이라 남은 재료만을 위한 입장도 취소됩니다. 알림의 남은 재료 묶음(아래 「모으지 않기」 막대)을 누르면 「모으기」로 바뀌고 남은 재료를 계속 모으러 갑니다.
- 설명서: 오른쪽 위 「전체 루트」가 층별 테마팩을 노선도로 보여 줍니다.
- en: 「Full route」 at the top right draws the packs floor by floor as a route map.
- 설명서: 전부 얻을 수 없으면 놓친 목표마다 무엇과 자리를 다투는지 알려 주고, 기프트마다 뺐을 때 줄어드는 충돌을 보여 줍니다. 뺄 목표를 체크하면 실제 결과를 계산하고, 「루트 미리 보기」로 확인한 뒤 「선택한 n개 목표에서 빼기」로 뺍니다.
- en: When not everything fits, it says what each missed goal competes with and shows how many conflicts leaving out each gift clears. Tick goals to see the real result, check it with 「Preview route」, then 「Remove n from goals」.

## 런 | Run

- readme: 스테이지의 팩 카드에서 **입장**하면(버튼 또는 카드를 아래로 당기기) 그 팩에서 챙길 기프트 타일이 나옵니다. **얻은 것은 아이콘을 눌러 획득 표시**하세요(이름을 누르면 상세) — 표시하지 않고 층을 떠나면 「미획득」으로 기록됩니다. 미획득은 「그 팩에서 못 얻음」이라, 다른 팩이 주는 기프트는 남은 층에서 다시 루팅되고, 그 팩에서만 나오는 기프트는 이 런에서 끝입니다.
- readme: 「다음 층」(또는 아래로 당기기)으로 넘어가고, 「입장 취소」(위로 당기기)는 입장을 취소하며 그 팩에서 표시한 것을 지웁니다. 층 스트립을 눌러 지난 층을 다시 볼 수 있습니다.
- readme: 루트는 현재 층부터 다시 계산됩니다. 계획에 없는 팩에 들어가도 됩니다.
- readme: **화면 인식**(데스크톱 Chrome·Edge·Firefox): 헤더의 「화면 인식」 버튼을 눌러 「화면 인식 시작」으로 게임 창을 공유하면, 지도 머리의 「N층 탐사 중」으로 입장을, 「E.G.O 기프트를 획득했습니다」 팝업으로 획득을, 판매·합성 확인창으로 보유에서 빠진 것을 직접 기록합니다. 기록마다 「되돌리기」가 있고, 확실하지 않으면 고르라고 묻습니다(버튼에 개수가 뜹니다). 창을 닫아도 인식은 계속됩니다. 화면은 브라우저 안에서만 읽고 어디로도 보내지 않습니다. 게임은 창 모드나 테두리 없는 창으로, 지금은 한국어 클라이언트만 화면 제목을 압니다.
- readme: **⋯ 메뉴**의 「링크 복사」가 덱·목표·설정을 담은 공유 링크를 만듭니다(런 진행은 담지 않습니다). 「초기화」는 덱을 기본 LCB 수감자로, 목표·설정·런을 처음으로 되돌립니다. 「테마 변경」·「기프트 아이콘 크기」·「글자 크기」도 여기 있고, 이 기기에만 저장됩니다.
- 설명서: 가운데 스테이지에서 팩 카드의 「입장」을 누르거나 카드를 아래로 당겨 들어갑니다.
- en: On the stage in the middle, press 「Enter」 on a pack card or pull the card down.
- 설명서: 얻은 기프트는 아이콘을 눌러 획득으로 표시하세요. 표시하지 않고 층을 떠나면 「미획득」으로 남고, 다른 팩이 주는 것은 남은 층에서 다시 찾습니다.
- en: Mark what you got by pressing its icon. Leaving a floor without marking records it as 「Not got」, and what another pack gives is routed again on the floors left.
- 설명서: 「다음 층」으로 넘어가고 「입장 취소」로 되돌립니다. 층 칸을 눌러 지난 층을 다시 볼 수 있습니다.
- en: 「Next floor」 moves on and 「Undo entry」 takes it back. Press a floor cell to look at a past floor.
- 설명서: 데스크톱에서는 헤더의 「화면 인식」에서 게임 창을 공유하면 입장·획득·판매·합성을 대신 기록합니다. 기록마다 되돌릴 수 있습니다.
- en: On desktop, 「Screen reader」 in the header shares the game window and records entries, gifts got, sales and fusions for you. Every record can be undone.
- 설명서: 재료를 미획득해서 조합할 수 없게 되면 「전체 루트」 맨 위에 알리고 루트를 다시 계산합니다. 기본은 그 조합을 버리는 것(「모으지 않기」)이고, 남은 재료 묶음을 누르면 「모으기」로 바뀌어 계속 모으러 갑니다.
- en: When a missed ingredient makes a fusion impossible, the top of 「Full route」 says so and the route is re-planned. By default the fusion is given up (「Don't collect」); press the remaining ingredients to switch to 「Collect」.

## 데이터와 권리 | Data and rights

- 설명서: 게임 데이터와 텍스트의 권리는 Project Moon에 있습니다. 비상업 팬 프로젝트이며 Project Moon과 제휴하거나 승인받지 않았습니다.
- en: Game data and text belong to Project Moon. This is a non-commercial fan project, not affiliated with or endorsed by Project Moon.
- 설명서: 코드는 MIT 라이선스이고, 게임 데이터와 텍스트에는 적용되지 않습니다.
- en: The code is MIT-licensed; that does not extend to the game data and text.
- notice: true

# README

저장소 첫 화면(README.md) 전체입니다. 아래 울타리 안이 README.md가 되고, `<!-- 카드: 제목 -->` 자리에는 「# 안내」의 그 카드가 들어갑니다(한국어만).

````markdown
# 거울 던전 루트 플래너

림버스 컴퍼니 **거울 던전**에서 쓰려는 덱과 원하는 E.G.O 기프트를 고르면, 그 기프트를 모으기 위한 **층별 테마팩 루트**를 계산해 주는 웹 도구입니다.

거울 던전의 기프트는 어느 팩에서나 나오는 범용 드랍과 특정 테마팩에서만 나오는 전용 기프트로 갈리고, 일부는 서로 다른 팩에서 얻은 재료를 조합해야 합니다. 게다가 테마팩은 정해진 층에서만 등장합니다. 그래서 "이 기프트들을 원한다"가 정해지면 **어느 층에서 어느 팩에 들어가야 하는지**가 따라 정해집니다. 이 도구가 그 계산을 합니다.

<!-- 카드: 무엇을 해 주나 -->

## 쓰는 법

배포된 사이트(https://yujia-cha.github.io/mirror-dungeon/)를 열면 바로 런 화면입니다. 가운데 스테이지에 지금 층과 들어갈 수 있는 테마팩이 있고, 헤더 왼쪽의 「덱」 버튼이 여는 패널에서 덱과 원하는 기프트를 고르고, 오른쪽의 「전체 루트」 버튼이 여는 패널에서 전체 루트·추적기를 봅니다. 모바일에서는 두 패널이 각각 전체 화면 페이지로 열립니다.

<!-- 카드: 덱 -->

<!-- 카드: 기프트 -->

<!-- 카드: 루트 -->

<!-- 카드: 런 -->

로컬에서 돌리려면:

```bash
npm ci
npm run data:build   # 동봉된 원본 데이터로 게임 데이터 생성
npm run dev
```

## 개발

```bash
npm run check        # lint + typecheck + 문구 생성물 + test + 데이터 검증
npm test             # 단위 테스트
npm run route -- --deck 10101,10203 --want 9088 --floors 1-5 --difficulty hard
```

루트가 어떻게 계산되는지는 [`docs/route-algorithm.md`](docs/route-algorithm.md)에 단계별로 적어 두었습니다. 게임 데이터의 출처와 가공 방식은 [`data/README.md`](data/README.md)에 있습니다. 화면 문구·설명서·루트 경고·이 README는 [`docs/copy.md`](docs/copy.md) 한 파일에서 고치고 `npm run copy`로 반영합니다. 설계 규칙과 마일스톤별 변경 기록은 개발 저장소의 `CLAUDE.md`·`docs/design/`·`docs/review/`·`docs/research/`에 있습니다.

<!-- 카드: 데이터와 권리 -->

게임 데이터·텍스트·이미지의 권리는 **Project Moon**에 있습니다. 이 저장소는 비상업 팬 프로젝트이며 Project Moon과 제휴하거나 승인받지 않았습니다.

플래너가 동작하는 데 필요한 범위의 게임 데이터를 세 곳에서 가져옵니다 — [LEAGUE-OF-NINE/OpenLethe](https://github.com/LEAGUE-OF-NINE/OpenLethe) (클라이언트 정적 데이터), [x1bViolet/Limbus-Localization-Files](https://github.com/x1bViolet/Limbus-Localization-Files) (공식 한국어·영어 현지화 원문), [eldritchtools/limbus-assets](https://github.com/eldritchtools/limbus-assets) (정적 데이터에 없는 인격을 채우는 가공 데이터). 어떤 파일을 어디서 가져오는지는 [`data/README.md`](data/README.md)와 [`data/sources.lock.json`](data/sources.lock.json)에 있습니다.

게임 이미지는 이 저장소에 담지 않습니다.

**코드는 MIT 라이선스입니다. 게임 데이터와 텍스트에는 적용되지 않습니다** — [`NOTICE`](NOTICE)를 보세요.
````
