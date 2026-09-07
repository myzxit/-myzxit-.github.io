# ScreenSolver

**화면 속 문제를 실시간으로 인식해 풀이와 정답을 알려주는** 웹앱입니다.
PC에서는 화면 공유로, 폰에서는 카메라나 사진으로 사용합니다.
빌드 도구 없이 동작하는 정적 사이트라 GitHub Pages에 그대로 올라갑니다.

👉 https://myzxit.github.io/

## 입력 소스

| 소스 | 설명 | 지원 |
| --- | --- | --- |
| 🖥️ **화면 공유** | 탭·창·전체 화면을 공유해 그 안의 문제를 풉니다 | 데스크톱 브라우저 |
| 📷 **카메라** | 문제(교재·시험지·다른 화면)를 카메라로 비추면 실시간으로 풉니다 | 폰·태블릿·웹캠 |
| 🖼️ **사진** | 사진을 찍거나 갤러리에서 고르면 바로 풉니다 | 모든 기기 |

폰에서 처음 열면 바로 쓸 수 있는 **카메라 탭이 자동 선택**됩니다. 이후에는 마지막으로 고른 탭을 기억합니다.

### 폰 화면 실시간 공유 → Android 앱

**웹 브라우저로는 폰 화면을 캡처할 수 없습니다.** `getDisplayMedia` 는 Android Chrome·iOS Safari 모두 미지원입니다([MDN 호환성 데이터](https://developer.mozilla.org/docs/Web/API/MediaDevices/getDisplayMedia#browser_compatibility)). 그래서 폰 전체 화면 실시간 분석은 **Android 앱(`android/`)** 이 담당하며, Android **MediaProjection API** 를 사용합니다.

```
ScreenSolver 앱 → 📱 내 화면 공유 → Android 시스템 권한창 → 허용
   → 포그라운드 서비스 + VirtualDisplay + ImageReader (다른 앱으로 이동해도 계속)
   → 네이티브 변화 감지 · 안정화 대기 · 중복(해시) 판정
   → 통과한 프레임만 WebView 로 전달
   → 기존 ScreenSolver AI 엔진(ChatGPT / Claude / Gemini Vision) → 풀이 표시
```

앱 설치 방법과 빌드는 아래 [Android 앱](#android-앱) 절을 보세요.

### 스크린샷 공유 (앱 없이, 웹만으로)

앱을 설치하지 않아도 스크린샷을 공유하면 곧바로 풀이합니다 (**PWA 공유 대상**).

1. **앱 설치** — 상단 `📲 앱 설치` 버튼, 또는 브라우저 메뉴 → *홈 화면에 추가*
2. 문제 화면에서 **스크린샷** 촬영
3. 공유 메뉴에서 **ScreenSolver** 선택 → 앱이 열리면서 **자동으로 풀이**

스크린샷을 찍고 공유하는 두 번의 동작이면 되고, 화면 공유 탭에서 `스크린샷 불러오기`로 직접 고르거나 **클립보드에서 붙여넣기**(<kbd>Ctrl/⌘+V</kbd>)로도 넣을 수 있습니다.

스크린샷이 들어오면 **풀고 싶은 문제 영역을 드래그해서 고르는 화면**이 먼저 뜹니다. 화면 전체에는 앱 UI·광고·다른 문제까지 섞여 있어 영역을 좁히면 정확도가 크게 올라갑니다. 그냥 전체를 풀려면 `화면 전체 풀기`를 누르면 되고, 이 단계가 번거로우면 설정에서 끌 수 있습니다.

| 방법 | Android Chrome | iOS Safari | 데스크톱 |
| --- | :-: | :-: | :-: |
| 공유 메뉴 → 앱으로 전송 | ✅ | ❌ (공유 대상 미지원) | ✅ Chrome/Edge |
| 스크린샷 직접 불러오기 | ✅ | ✅ | ✅ |
| 클립보드 붙여넣기 | ✅ | ⚠️ 일부 | ✅ |

## 기능

- **실시간 자동 감지** — 화면이 바뀌고 다시 멈추면(스크롤·페이지 이동이 끝나면, 또는 카메라를 문제 위에 고정하면) 자동으로 새 문제를 분석합니다. 같은 화면을 반복해서 보내지 않습니다. 카메라는 손떨림을 고려해 감지 임계값이 따로 보정됩니다.
- **AI 프로바이더 선택** — **Claude(Anthropic) · ChatGPT(OpenAI) · Gemini(Google)** 중 선택. API 키는 **프로바이더별로 각각 저장**되어, 프로바이더를 바꿔도 이전 키가 그대로 남습니다.
- **스트리밍 풀이** — 답이 생성되는 대로 바로 표시되고, `정답: …` 줄은 강조 박스로 분리됩니다.
- **상세도 조절** — 정답만 / 정답 + 핵심 풀이 / 자세한 풀이.
- **영역 지정** — 화면 일부만 드래그(모바일은 터치)로 지정해 그 영역만 분석합니다.
- **이어서 질문** — 방금 푼 문제에 대해 후속 질문을 이어갈 수 있습니다.
- **기록** — 분석한 캡처와 정답이 썸네일로 쌓이고, 클릭하면 그 시점 대화로 돌아갑니다.
- **모바일 대응** — 한 컬럼 레이아웃, 큰 터치 버튼, 아래에서 올라오는 설정 시트, 안전영역(노치) 여백, 결과 자동 스크롤, 카메라 전면/후면 전환.
- **홈 화면 설치(PWA)** — 설치하면 공유 메뉴에 앱이 등록되고, 오프라인에서도 앱 화면이 열립니다(풀이는 네트워크 필요).
- 단축키(데스크톱): <kbd>Enter</kbd> 지금 풀기, <kbd>Esc</kbd> 영역 지정 취소.

## 사용법

1. 사이트를 엽니다. (또는 로컬에서 `python3 -m http.server` 후 `http://localhost:8000`)
2. ⚙️ **설정**에서 프로바이더를 고르고 API 키를 넣은 뒤 **저장**을 누릅니다.
   - Claude: https://console.anthropic.com/settings/keys
   - ChatGPT: https://platform.openai.com/api-keys
   - Gemini: https://aistudio.google.com/apikey
3. 입력 소스를 고릅니다.
   - PC — **화면 공유 시작** → 문제가 보이는 탭·창·화면 선택
   - 폰 — **카메라 켜기** 후 문제를 비추거나, **사진** 탭에서 촬영/선택
4. **지금 풀기**를 누르거나, **자동 감지**를 켜 둔 채로 두면 화면이 바뀔 때마다 알아서 풀어 줍니다. (사진은 고른 즉시 풀이합니다.)

> `file://` 로 직접 열면 ES 모듈과 화면 공유·카메라가 차단됩니다. 반드시 HTTP(S)로 서빙하세요. 카메라는 HTTPS(또는 localhost)에서만 동작합니다.

## Android 앱

`android/` 에 있는 네이티브 앱이 폰 전체 화면 실시간 분석을 담당합니다. 웹 UI 를 그대로 WebView 에 담고(빌드 시 저장소 루트에서 자동 복사), 화면 캡처만 네이티브가 처리합니다. 따라서 AI 엔진·설정·기록은 웹과 완전히 같은 코드입니다.

### 설치 (APK 내려받기)

빌드 없이 바로 설치하려면 **[dist/screensolver-debug.apk](dist/screensolver-debug.apk)** 를 폰에서 내려받으세요. 사이트 하단의 `📱 Android 앱 (APK) 내려받기` 링크도 같은 파일입니다.

- 디버그 서명 APK 입니다. 설치할 때 **"알 수 없는 출처의 앱 설치"** 를 허용해야 합니다.
- Play 스토어를 거치지 않으므로 자동 업데이트가 없습니다. 새 버전은 다시 내려받아 덮어쓰면 됩니다.
- 소스에서 직접 빌드하는 편이 안전합니다. 아래 방법을 쓰세요.

### 설치 (직접 빌드)

```bash
cd android
./gradlew assembleDebug
# → app/build/outputs/apk/debug/app-debug.apk
```

APK 를 폰으로 옮겨 설치합니다. 폰이 USB 로 연결돼 있으면:

```bash
./gradlew installDebug        # 또는  adb install -r app-debug.apk
```

필요 조건: **JDK 17 이상**, Android SDK (compileSdk 35 / build-tools 35). Android Studio 를 쓰면 `android/` 폴더를 열기만 하면 됩니다. `minSdk 29` (Android 10 이상).

> 배포용 서명 APK 가 필요하면 `assembleRelease` 후 직접 서명하세요. 저장소에는 서명 키를 포함하지 않습니다.

### 사용법

1. 앱 실행 → ⚙️ 설정에서 AI 프로바이더 선택 + API 키 저장
2. **화면 공유** 탭 → `📱 내 화면 공유`
3. Android 시스템 권한창에서 **허용** (반드시 사용자가 직접 허용해야 합니다)
4. 홈으로 나가 **문제가 있는 앱**(브라우저·PDF·문제집 앱 등)으로 이동
5. 화면이 바뀌고 멈추면 자동으로 읽어서 풀이합니다
6. 앱으로 돌아오면 풀이 결과가 보입니다. `⚡ 지금 풀기` 로 현재 화면을 즉시 분석할 수도 있습니다
7. 중지: 앱의 `공유 중지` 버튼 또는 **알림의 [중지]**

공유 중에는 상시 알림(`ScreenSolver · 화면 분석 중`)이 표시되고, 홈 화면 밖으로 나가도 캡처가 이어집니다.

### 앱이 API 호출을 아끼는 방법

모든 프레임을 AI 로 보내지 않습니다. 네이티브에서 먼저 걸러냅니다.

| 단계 | 내용 | 기본값 |
| --- | --- | --- |
| 샘플링 | 확인 주기보다 자주 온 프레임은 버림 | 1.5초 |
| 변화 감지 | 40×40 그레이스케일 시그니처 비교 | 임계 6% |
| 안정화 | 화면이 멎어야 분석 | 1초 |
| 중복 판정 | 64bit dHash, 해밍 거리 ≤5 면 같은 문제로 보고 건너뜀 | — |
| 쿨다운 | 자동 분석 최소 간격 | 5초 |

`⚡ 지금 풀기` 는 이 판정을 모두 건너뛰고 1회 즉시 분석합니다.

### Android 권한

| 권한 | 용도 |
| --- | --- |
| `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MEDIA_PROJECTION` | 화면 공유 중 캡처를 유지하는 포그라운드 서비스 (Android 14+ 필수) |
| `POST_NOTIFICATIONS` | 공유 중임을 알리는 상시 알림 |
| `CAMERA` | 카메라 탭 |
| `INTERNET` | AI API 호출 |

화면 캡처 자체는 권한이 아니라 **MediaProjection 사용자 동의**로만 이루어집니다. 접근성 서비스 등으로 몰래 화면을 읽지 않으며, Android 보안 제한을 우회하지 않습니다(보호된 화면은 캡처에서 정상적으로 제외됩니다).

### 브리지 계약

웹 ↔ 네이티브는 버전이 붙은 계약으로 통신합니다. 앱과 웹 버전이 어긋나면 화면에 경고가 뜹니다.

```
window.ScreenSolverAndroid.startScreenCapture() / stopScreenCapture() / getStatus()
이벤트: screensolver:screen-capture-{started,stopped,frame,error,state}
```

프레임 본문(base64)은 이벤트에 싣지 않고 `takeFrame()` 으로 당겨 갑니다 — 수백 KB 문자열이 매번 JS 로 흐르지 않게 하기 위해서입니다. 구현은 `js/android.js` ↔ `android/app/src/main/java/io/github/myzxit/screensolver/ScreenSolverBridge.kt`.

## 설정 항목

| 항목 | 설명 |
| --- | --- |
| 확인 주기 | 화면을 다시 확인하는 간격 (0.5~5초) |
| 변화 민감도 | 낮을수록 작은 변화에도 반응합니다 |
| 답변 언어 | 한국어 / English / 화면과 같은 언어 |
| 추가 지시 | 프롬프트에 덧붙일 사용자 규칙 |
| API 엔드포인트 | 사내 프록시나 호환 게이트웨이를 쓸 때만 입력 (프로바이더별 저장) |
| 전송 이미지 최대 가로 | 클수록 작은 글씨를 잘 읽지만 느리고 비쌉니다 |

## 구조

```
index.html              레이아웃과 설정 모달
css/style.css           다크 테마 + 반응형/모바일 스타일
js/app.js               UI 배선, 입력 소스 전환, 자동 감지 루프, 기록
js/store.js             프로바이더 정의 및 설정/키 저장 (localStorage)
js/api.js               Claude / OpenAI / Gemini 스트리밍 어댑터
js/capture.js           화면 공유·카메라·사진 캡처, 영역 지정, 프레임 변화 감지
js/share.js             PWA 설치, 공유받은 스크린샷 수신, 붙여넣기
js/android.js           Android 네이티브 브리지 (앱 안에서만 활성)
js/prompt.js            문제 풀이용 시스템 프롬프트
js/markdown.js          답변 표시용 마크다운 렌더러 (HTML 이스케이프)
sw.js                   서비스 워커 — 공유 대상 처리 + 네트워크 우선 캐시
manifest.webmanifest    PWA 매니페스트 (share_target 선언)
icons/                  앱 아이콘 (192/512 PNG)
tools/make-icons.mjs    아이콘 생성 스크립트 (의존성 없음)

android/                        Android 앱 (폰 전체 화면 실시간 분석)
  app/src/main/java/io/github/myzxit/screensolver/
    MainActivity.kt             WebView 호스트, MediaProjection 권한 요청, 뒤로가기
    ScreenCaptureService.kt     포그라운드 서비스 + VirtualDisplay + ImageReader
    FrameProcessor.kt           변화 감지 · 안정화 · 중복(dHash) 판정
    ScreenSolverBridge.kt       Web ↔ Native 브리지 (@JavascriptInterface)
    CaptureContracts.kt         상태 머신 · 설정 · 이벤트 통로
```

앱 빌드 시 `app/build.gradle.kts` 의 `syncWebAssets` 태스크가 저장소 루트의 웹 앱을
`assets/www` 로 복사합니다. **웹과 앱의 UI·AI 엔진은 하나의 소스를 공유합니다.**

## 구현 범위

구현된 것과 아직 아닌 것을 명확히 구분합니다.

**구현됨**

- Android MediaProjection 전체 화면 캡처, 포그라운드 서비스(Android 14+ 순서 준수), 다른 앱으로 이동해도 캡처 유지
- 네이티브 변화 감지 · 안정화 · 중복 해시 · 쿨다운, 수동 즉시 풀이, 공유 중지/재시작, 알림 [중지]
- 화면 회전 시 VirtualDisplay 재생성, `MediaProjection.onStop` 처리, 리소스 해제(Image/ImageReader/VirtualDisplay/Projection)
- ChatGPT · Claude · Gemini Vision 스트리밍, 프로바이더별 키·모델·엔드포인트 저장/삭제, 요청 취소, 오류 메시지
- 화면 공유(PC) · 카메라 · 사진 · 스크린샷 공유, 영역 지정, 이어서 질문, 기록, 복사, 다크 UI, 모바일 반응형, 뒤로가기 처리

**아직 구현되지 않음** (앱에 해당 UI 가 없습니다)

- API 키 **연결 테스트** 버튼, 실패 시 자동 재시도, rate limit 백오프
- Android **Keystore** 키 보관 — 현재 앱도 웹과 같이 WebView `localStorage` 를 씁니다
- 모델의 Vision 지원 여부 자동 확인/경고
- 로컬 OCR, 문제 영역 **자동** 감지(수동 영역 지정만 있음), 문제 유형 자동 분류
- KaTeX/MathJax 수식 렌더링 (`$…$` 는 강조 표시만)
- TTS 음성 읽기, 결과 공유 시트, AI 재풀이/3개 비교
- 배터리·데이터 절약 모드 프리셋 (확인 주기·이미지 크기로 수동 조절은 가능)
- 설정 export/import, 화면 확대/축소
- **실제 Android 기기 테스트** — 아래 참고

### 테스트 현황

| 대상 | 방법 | 결과 |
| --- | --- | --- |
| 웹 (데스크톱·모바일·PWA 공유) | Playwright 자동 테스트 | 통과 |
| 웹 ↔ 네이티브 브리지 계약 | 브리지를 모킹해 전 경로 테스트 | 통과 |
| Android 빌드 | `assembleDebug` / `assembleRelease` / `lint` | 통과 |
| R8 난독화 후 브리지 메서드 보존 | 릴리스 APK dex 검사 | 통과 (7개 메서드 유지) |
| **실기기 동작** | — | **미검증 (기기 없음)** |

네이티브 캡처 경로는 컴파일·정적 검증까지만 마쳤습니다. 실제 폰에서의 권한 흐름·캡처 화질·발열·장시간 안정성은 설치 후 확인이 필요합니다.

## 개인정보 · 주의

- API 키와 설정은 **브라우저 localStorage에만** 저장되며 서버로 전송되지 않습니다.
- 캡처 이미지는 **선택한 프로바이더의 API로만** 전송됩니다. 키는 브라우저에서 직접 API로 전달되므로, 공용 PC에서는 사용 후 🗑 버튼으로 키를 지우세요.
- 모델 출력은 항상 이스케이프 후 렌더링하므로 답변에 포함된 HTML이 실행되지 않습니다.
- **Android 앱**: 화면 공유 중에는 화면에 보이는 내용이 선택한 AI 로 전송될 수 있습니다. 시작·중지는 항상 사용자가 직접 하며, 공유 중에는 알림이 상시 표시됩니다. 캡처 이미지는 앱의 서버로 저장되지 않습니다(기록은 앱 실행 중 메모리에만 남습니다).
- API 키는 앱에서도 WebView `localStorage` 에 저장됩니다. 루팅되지 않은 기기에서는 앱 전용 저장소라 다른 앱이 읽을 수 없지만, Android Keystore 수준의 보호는 아닙니다. 공용 기기에서는 사용 후 🗑 로 키를 지우세요.
- **API 비용**: 실시간 분석은 화면이 바뀔 때마다 Vision API 를 호출합니다. 위 표의 감지·쿨다운 장치가 호출을 크게 줄이지만, 장시간 켜 두면 비용이 누적됩니다. 확인 주기·민감도·이미지 크기로 조절하세요.
- **시험·평가 등 부정행위가 금지된 상황에서는 사용하지 마세요.** 학습·복습·업무 확인 용도로 만들어졌습니다.

## 브라우저 요구사항

| 기기 | 화면 공유 | 카메라 | 사진 |
| --- | :-: | :-: | :-: |
| 데스크톱 Chrome · Edge · Firefox · Safari | ✅ | ✅ (웹캠) | ✅ |
| Android Chrome · Samsung Internet | ❌ → 스크린샷 공유 | ✅ | ✅ |
| iOS Safari · Chrome (iOS 14.3+) | ❌ → 스크린샷 선택 | ✅ | ✅ |

화면 공유가 불가능한 기기에서는 해당 탭이 스크린샷 공유 안내로 바뀝니다. 카메라를 지원하지 않는 브라우저에서만 탭이 비활성화됩니다. 카메라와 PWA 설치에는 HTTPS(또는 localhost)가 필요합니다.
