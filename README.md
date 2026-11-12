# 에테르 원정기 (Aether Expedition)

GitHub Pages로 바로 배포되는 **방치형(Idle) RPG 웹게임**입니다.
설치 없이 브라우저에서 실행되고, PWA로 홈 화면에 설치할 수 있으며, [Capacitor](https://capacitorjs.com/)로 감싸 **Android / iOS 앱**으로 만들 수 있도록 구성했습니다.

- 빌드 도구 없음: 순수 HTML / CSS / JavaScript(ES Modules)
- 서버 없음: 진행 상황은 브라우저 `localStorage`에 자동 저장
- 모바일 우선 세로 화면 UI, 터치 지원

## 게임 기능

| 시스템 | 설명 |
| --- | --- |
| ⚔️ 자동 전투 | 영웅이 자동으로 공격하고, 화면을 탭하면 추가 공격 |
| 🗺️ 스테이지 | 스테이지마다 몬스터 10마리 → 보스(제한시간 30초). 10스테이지마다 지역 보스 · 8개 지역 순환 |
| 🧙 영웅 강화 | 공격력 · 체력 · 공격 속도 · 치명타 확률/피해 · 골드 획득 (골드 소비, x1/x10/x100/MAX 일괄 구매) |
| 👥 동료 | 10종의 동료가 지속 피해(DPS). 25레벨마다 피해 x2 |
| 🎒 장비 | 무기/방어구/장신구, 5단계 희귀도(일반~전설), 강화 +10, 자동 장착 · 자동 판매 |
| ✨ 스킬 | 일격필살 · 광폭화 · 전투의 함성 · 황금비 (스테이지로 해금, 자동 사용 가능) |
| 🔮 환생 | 스테이지 40부터 환생해 에테르 정수 획득 → 8종 유물 영구 강화, 누적 정수당 피해 +2% |
| 🌙 오프라인 보상 | 게임을 꺼둔 동안에도 골드 획득 (기본 2시간, 유물로 확장) |
| ⛏️ 생활 스킬 | 벌목 · 채광 · 낚시 · 요리 · 대장기술 · 제작 · 연금술 · 비전술 · 신성술 · 도둑질 (10종, 최대 Lv 99). 전투와 동시에 1개 진행, 오프라인에도 진행, 환생해도 유지 · 채집 도구와 작업대 업그레이드, 신성술 기도(1개 선택), 지역별 뼈, 도둑질 3종(소매치기·노점·대규모 털이) |
| ⏩ 배속 | 상단 버튼으로 x1 · x2 · x4 · x8 · x16 전환 (오프라인 보상은 실제 시간 기준) |
| 💾 저장 | 15초마다 자동 저장, 세이브 코드 내보내기/불러오기 |

## 로컬 실행

ES 모듈을 사용하므로 `file://`이 아닌 로컬 서버로 열어야 합니다.

```bash
npm start                       # http://localhost:8080 (http-server)
# 또는
python3 -m http.server 8080 -d www
```

## GitHub Pages 배포

1. 이 저장소를 GitHub에 push 합니다 (`main` 브랜치).
2. 저장소 **Settings → Pages → Build and deployment → Source** 를 **GitHub Actions** 로 선택합니다.
3. `main`에 push할 때마다 `.github/workflows/pages.yml` 이 `www/` 폴더를 배포합니다.
   (Actions 탭에서 `Deploy to GitHub Pages` 를 수동 실행할 수도 있습니다.)
4. 배포 주소: `https://<사용자명>.github.io/<저장소명>/`

> 게임 파일을 수정한 뒤에는 `www/sw.js`의 `CACHE` 버전 문자열을 올려 주세요. 설치된 PWA가 새 파일을 받도록 합니다.

## 휴대폰에 설치 (PWA)

- **Android (Chrome)**: 배포 주소 접속 → 메뉴 → *홈 화면에 추가 / 앱 설치*
- **iOS (Safari)**: 배포 주소 접속 → 공유 버튼 → *홈 화면에 추가*

설치하면 전체 화면 앱처럼 실행되고, 한 번 연 뒤에는 오프라인에서도 실행됩니다.

## 네이티브 앱으로 만들기 (Capacitor)

웹 코드(`www/`)를 그대로 앱에 넣는 구조라 게임 코드를 바꿀 필요가 없습니다. 설정은 `capacitor.config.json`에 있습니다.

```bash
npm run cap:init        # Capacitor 패키지 설치
npm run cap:android     # android/ 프로젝트 생성 후 Android Studio 열기 (Android Studio 필요)
npm run cap:ios         # ios/ 프로젝트 생성 후 Xcode 열기 (macOS + Xcode 필요)
npm run cap:sync        # www/ 수정 후 앱 프로젝트에 반영
```

출시 전에 `capacitor.config.json`의 `appId`(예: `com.회사명.게임명`)를 본인 것으로 바꾸세요.
Play 스토어용 AAB / App Store 빌드는 Android Studio · Xcode에서 서명해 만듭니다.

## 폴더 구조

```
www/                    ← 배포/앱에 들어가는 게임 전체
  index.html
  css/style.css
  js/
    main.js             진입점, 게임 루프, 자동 저장, 서비스 워커 등록
    game.js             게임 로직 (DOM 없음 → Node에서 시뮬레이션 가능)
    data.js             밸런스 수치, 몬스터·동료·유물·스킬·장비 데이터
    state.js            세이브 구조, 저장/불러오기/내보내기
    render.js           캔버스 전투 화면
    ui.js               탭, 강화 목록, 모달, 토스트
    life.js             생활 스킬 데이터·로직 (재료, 행동, 경험치, 음식·물약)
    format.js           큰 숫자(K, M, B, T, aa…) / 시간 표시
  manifest.webmanifest  PWA 설정
  sw.js                 오프라인 캐시
  icons/                앱 아이콘
tools/
  sim.js                밸런스 시뮬레이션 (npm run sim -- 3)
  make-icons.js         icon.svg → PNG 아이콘 생성
.github/workflows/pages.yml   GitHub Pages 자동 배포
capacitor.config.json         네이티브 앱 설정
```

## 밸런스 조정

수치는 모두 `www/js/data.js`에 있습니다. 예: `monsterHp`, `goldPerKill`, 각 강화의 `base`(시작 비용)·`growth`(비용 증가율).
수정 후 `npm run sim -- 3` 으로 3시간 플레이를 시뮬레이션해 진행 속도를 확인할 수 있습니다
(현재 설정: 첫 환생 지점인 스테이지 90~100 정체 구간까지 약 30분).

## 디버그

브라우저 콘솔에서 `game` 객체로 상태를 볼 수 있습니다. 예: `game.s.gold = 1e9`
