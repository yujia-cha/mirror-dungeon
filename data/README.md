# data/

## 디렉터리

| 경로 | 성격 | 편집 |
|---|---|---|
| `sources.lock.json` | 원본 저장소와 커밋 sha, 받아올 파일 목록 | `npm run data:fetch -- --update`로 갱신 |
| `raw/` | vendoring된 게임 원본 JSON (커밋 대상) | **손대지 않는다.** `data:fetch`가 덮어쓴다 |
| `curated/` | 정적 데이터가 표현하지 못하는 사실 (커밋 대상) | 사람이 편집. 모든 항목에 `_source` 근거 |
| `fixtures/` | 테스트용 축소 데이터 | `npm run data:fixtures`로 생성 |

생성물인 `public/data/`는 저장소 루트에 있다(앱이 fetch하는 경로라서). 시즌이 기프트 풀을 교체하므로 `meta`·`rules`·`gifts`·`packs`는 `public/data/md{n}/`에 시즌별로 들어가고, 거던을 보지 않는 `enums`·`identities`는 루트에서 공유한다. `index.json`이 어떤 시즌이 있고 어느 것을 여는지 말한다. 자세한 것은 `docs/research/data-sources.md`.

## 흐름

```
data/raw  ─┐                     ┌─ public/data/md{n}/{meta,rules,gifts,packs}.json ─┐
           ├─ scripts/build-data.ts ─┤                                               ├─→ 앱 · 플래너
data/curated ┘                     └─ public/data/{enums,identities,index}.json ─────┘
                                          │
                                  scripts/validate-data.ts
```

## 출처와 라이선스

- 게임 정적 데이터: [LEAGUE-OF-NINE/OpenLethe](https://github.com/LEAGUE-OF-NINE/OpenLethe)에 미러된 Limbus Company 클라이언트 데이터.
- 이름·효과 텍스트: [LocalizeLimbusCompany](https://github.com/LocalizeLimbusCompany/LocalizeLimbusCompany) (번역 팩은 CC BY-NC-SA 4.0).

**게임 데이터와 텍스트의 권리는 Project Moon에 있다.** 이 저장소는 비상업 팬 프로젝트이고, 데이터는 플래너 동작에 필요한 범위에서만 재배포한다. 자세한 내용은 `docs/research/data-sources.md`.

## 갱신

`update-game-data` 스킬의 런북을 따른다. 요약:

```bash
npm run data:fetch -- --update
npm run data:build
npm run data:validate
npm run data:diff
npm run data:changelog
```

매월 1일 `.github/workflows/data-update.yml`이 같은 절차를 돌려 변경이 있으면 드래프트 PR을 연다. 손으로 돌리려면 Actions 탭의 **Update game data → Run workflow**.
