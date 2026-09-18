# data/

## 디렉터리

| 경로 | 성격 | 편집 |
|---|---|---|
| `sources.lock.json` | 원본 저장소와 커밋 sha, 받아올 파일 목록 | `npm run data:fetch -- --update`로 갱신 |
| `raw/` | vendoring된 게임 원본 JSON (커밋 대상) | **손대지 않는다.** `data:fetch`가 덮어쓴다 |
| `curated/` | 정적 데이터가 표현하지 못하는 사실 (커밋 대상) | 사람이 편집. 모든 항목에 `_source` 근거 |

생성물인 `public/data/`는 저장소 루트에 있다(앱이 fetch하는 경로라서). 시즌이 기프트 풀을 교체하므로 `meta`·`rules`·`gifts`·`packs`는 `public/data/md{n}/`에 시즌별로 들어가고, 거던을 보지 않는 `enums`·`identities`는 루트에서 공유한다. `index.json`이 어떤 시즌이 있고 어느 것을 여는지 말한다. 자세한 것은 아래 「출처와 라이선스」.

## 흐름

```
data/raw  ─┐                     ┌─ public/data/md{n}/{meta,rules,gifts,packs}.json ─┐
           ├─ scripts/build-data.ts ─┤                                               ├─→ 앱 · 플래너
data/curated ┘                     └─ public/data/{enums,identities,index}.json ─────┘
                                          │
                                  scripts/validate-data.ts
```

## 출처와 라이선스

정확한 커밋은 [`sources.lock.json`](sources.lock.json)에 고정되어 있다. `npm run data:fetch`가 그 파일만 보고 `data/raw`를 복원한다.

| 출처 | 가져오는 것 | 들어가는 곳 | 업스트림 라이선스 |
|---|---|---|---|
| [LEAGUE-OF-NINE/OpenLethe](https://github.com/LEAGUE-OF-NINE/OpenLethe) | 게임 클라이언트 StaticData (인격·기프트·거울 던전 팩·층) | `data/raw/static/` | 라이선스 파일 없음. 내용의 권리는 Project Moon |
| [x1bViolet/Limbus-Localization-Files](https://github.com/x1bViolet/Limbus-Localization-Files) | 공식 한국어·영어 현지화 JSON (이름·효과 원문) | `data/raw/localize/{KR,EN}/` | 라이선스 파일 없음. 원문의 권리는 Project Moon |
| [eldritchtools/limbus-assets](https://github.com/eldritchtools/limbus-assets) | limbus.tools가 쓰는 가공 데이터. 정적 데이터에 없는 인격을 채우고, 얼어 있는 거울 던전 데이터를 교차검증한다 | `data/raw/derived/eldritchtools/` | 라이선스 파일 없음. **제3자가 직접 가공한 편집물**이다 |

세 곳 모두 업스트림에 라이선스 파일이 없다. 그래서 이 저장소의 MIT 라이선스는 **코드에만** 적용되고, `data/`와 `public/data/`의 내용에는 적용되지 않는다 — 자세한 것은 저장소 루트의 [`NOTICE`](../NOTICE).

**게임 데이터와 텍스트의 권리는 Project Moon에 있다.** 이 저장소는 비상업 팬 프로젝트이며 Project Moon과 제휴하거나 승인받지 않았다. 데이터는 플래너 동작에 필요한 범위에서만 재배포하고, 게임 이미지는 아예 담지 않는다.

권리자가 삭제를 요청하면 따른다 — [`NOTICE`](../NOTICE)에 연락 방법이 있다.

(개발 저장소에는 각 출처가 얼마나 살아 있는지와 교체 이력을 적은 `docs/research/data-sources.md`가 더 있다.)

## 갱신

`update-game-data` 스킬의 런북(개발 저장소)을 따른다. 요약:

```bash
npm run data:fetch -- --update
npm run data:build
npm run data:validate
npm run data:diff
npm run data:changelog
```

매월 1일 `.github/workflows/data-update.yml`이 같은 절차를 돌려 변경이 있으면 드래프트 PR을 연다. 손으로 돌리려면 Actions 탭의 **Update game data → Run workflow**.
