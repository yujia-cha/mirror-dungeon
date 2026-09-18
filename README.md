# 거울 던전 루트 플래너

림버스 컴퍼니 **거울 던전**에서 쓰려는 덱과 원하는 E.G.O 기프트를 고르면, 그 기프트를 모으기 위한 **층별 테마팩 루트**를 계산해 주는 웹 도구입니다.

거울 던전의 기프트는 어느 팩에서나 나오는 범용 기프트와 특정 테마팩에서만 나오는 전용 기프트로 갈리고, 일부는 서로 다른 팩에서 얻은 재료를 조합해야 합니다. 게다가 테마팩은 정해진 층에서만 등장합니다. 그래서 "이 기프트들을 원한다"가 정해지면 **어느 층에서 어느 팩에 들어가야 하는지**가 따라 정해집니다. 이 도구가 그 계산을 합니다.

## 무엇을 해 주나

- 덱(인격 12인)을 고르거나 게임의 **편성 코드**를 붙여넣어 불러오기
- 원하는 기프트 선택 — 키워드·등급·획득 방식·팩으로 필터, 조건부 기프트는 **내 덱이 조건을 충족하는지** 바로 표시
- 층별 루트 제시 — 각 층에 들어갈 테마팩과 그 팩에서 챌 기프트, 시작 기프트, 그리고 **어떤 기프트를 관측하면 루트가 유연해지는지**(관측 추천)
- 불가능한 요구는 이유와 함께 알려줌 (그 층 범위에 팩이 없음 / 전용 기프트끼리 층이 충돌 / 덱이 조건을 못 채움). 팩이 충돌하면 기프트를 하나씩 뺀 **대안 루트**를 탭으로 보여줌
- 계산 결과를 URL로 공유

## 쓰는 법

배포된 사이트(https://yujia-cha.github.io/mirror-dungeon/)를 열면 바로 런 화면입니다. 가운데 무대에 지금 층과 들어갈 수 있는 테마팩이 있고, 왼쪽 패널에서 덱과 원하는 기프트를 고르고, 오른쪽 패널에서 전체 루트·목표·추적기를 봅니다. 로컬에서 돌리려면:

```bash
npm ci
npm run data:build   # 동봉된 원본 데이터로 게임 데이터 생성
npm run dev
```

## 개발

```bash
npm run check        # lint + typecheck + test + 데이터 검증
npm test             # 단위 테스트
npm run route -- --deck 10101,10203 --want 9088 --floors 1-5 --difficulty hard
```

루트가 어떻게 계산되는지는 [`docs/route-algorithm.md`](docs/route-algorithm.md)에 단계별로 적어 두었습니다. 게임 데이터의 출처와 가공 방식은 [`data/README.md`](data/README.md)에 있습니다. 설계 규칙과 마일스톤별 변경 기록은 개발 저장소의 `CLAUDE.md`·`docs/design/`·`docs/review/`·`docs/research/`에 있습니다.

## 데이터와 권리

게임 데이터·텍스트·이미지의 권리는 **Project Moon**에 있습니다. 이 저장소는 비상업 팬 프로젝트이며, 플래너가 동작하는 데 필요한 범위의 게임 데이터를 [OpenLethe](https://github.com/LEAGUE-OF-NINE/OpenLethe)와 [LocalizeLimbusCompany](https://github.com/LocalizeLimbusCompany/LocalizeLimbusCompany)에서 가져와 사용합니다. 자세한 내용은 [`data/README.md`](data/README.md)를 보세요.

코드는 MIT 라이선스입니다.
