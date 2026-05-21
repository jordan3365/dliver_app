# 📱 Flutter 기사앱 (driver_flutter) VS Code 테스트 및 배포 가이드

이 문서는 개발자가 **VS Code** 환경에서 Flutter 기반 기사용 배송앱을 테스트 구동하고, 최종 배포용 설치 파일(Release APK)을 빌드하여 실제 안드로이드 스마트폰에 설치 및 배포하는 절차를 상세히 안내합니다.

![Flutter 개발 및 빌드 프로세스 일러스트](file:///C:/Users/hongwon/.gemini/antigravity/brain/6f834b4f-da59-4818-b9b8-9a57b8490312/flutter_dev_mockup_1779341122534.png)

---

## 🛠️ 1. 개발 및 테스트 환경 준비 (최초 1회 설정)

Flutter 앱을 VS Code에서 빌드하고 구동하려면 아래의 기본 도구들이 설치되어 있어야 합니다.

### (1) Flutter SDK 및 Java 설치
1. [Flutter 공식 홈페이지](https://docs.flutter.dev/get-started/install/windows)에서 Flutter SDK를 다운로드하여 적절한 폴더(예: `C:\flutter`)에 압축을 풉니다.
2. 시스템 환경 변수(Path)에 `C:\flutter\bin` 경로를 추가합니다.
3. 명령 프롬프트(CMD/PowerShell)에서 `flutter doctor` 명령어를 입력하여 정상 설치 여부를 확인합니다.
4. Android 빌드를 위해 Java Development Kit (JDK 17 버전 이상 권장)이 설치되어 있어야 합니다.

### (2) Android Studio & SDK 설정
1. [Android Studio](https://developer.android.com/studio)를 설치합니다.
2. Android Studio 실행 후 **SDK Manager**에서 최신 Android SDK 및 SDK Build-Tools를 설치합니다.
3. 가상 기기 테스트를 원할 경우 **Virtual Device Manager**를 통해 에뮬레이터를 1개 이상 생성합니다.

### (3) VS Code 확장 플러그인 설치
VS Code의 Extensions 마켓플레이스(`Ctrl + Shift + X`)에서 다음 필수 플러그인을 설치합니다:
* **Flutter** (Dart 확장도 자동으로 함께 설치됩니다)

---

## 💻 2. VS Code에서 로컬 테스트 실행하기

개발 환경이 완료되었다면 다음 순서에 따라 앱을 테스트 모드로 구동할 수 있습니다.

### Step 1: 디렉토리 이동 및 의존성 패키지 설치
VS Code 내장 터미널을 열고 다음 명령어를 차례로 실행합니다:
```bash
# 1. Flutter 프로젝트 폴더로 이동
cd driver_flutter

# 2. pubspec.yaml에 명시된 라이브러리 및 패키지 다운로드
flutter pub get
```

### Step 2: 기기 또는 에뮬레이터 연결
* **가상 에뮬레이터**: Android Studio에서 생성한 가상 기기(AVD)를 실행합니다.
* **실제 스마트폰**: 안드로이드 휴대폰을 컴퓨터와 USB로 연결하고, 휴대폰 설정에서 **[개발자 옵션] ➡️ [USB 디버깅]**을 활성화합니다.
* 연결이 정상적이라면 VS Code 우측 하단 상태 표시줄에 기기명이 노출됩니다. (또는 터미널에 `flutter devices` 입력 시 목록 노출)

### Step 3: 디버그 모드로 구동
1. VS Code에서 `lib/main.dart` 파일을 엽니다.
2. 키보드 단축키 **`F5`**를 누르거나, 메뉴 상단의 **[Run] ➡️ [Start Debugging]**을 클릭합니다.
3. 앱이 컴파일된 후 연결된 기기에 자동 설치되고 테스트 구동이 시작됩니다.

> [!TIP]
> 디버그 모드 작동 중 코드를 수정한 뒤 저장(`Ctrl + S`)하면 **Hot Reload**가 동작하여 앱을 재시작하지 않고도 화면 변경 사항이 즉각 실시간 반영됩니다.

---

## 📦 3. 배포용 최종 APK 파일 빌드 (Release Build)

기사님들에게 나누어줄 최종 배포용 설치 파일(.apk)을 제작하는 과정입니다. 디버그용 APK는 성능이 무겁고 속도가 느리므로, **반드시 아래의 릴리즈 빌드 명령어를 사용해야 합니다.**

### 빌드 명령어 실행
VS Code 터미널에서 `driver_flutter` 디렉토리 경로에 있는 상태로 아래 명령어를 입력합니다.

* **표준 통합 APK 빌드 (보편적인 방식)**:
  ```bash
  flutter build apk --release
  ```
* **최적화 분할 APK 빌드 (기기 CPU 아키텍처별로 용량을 줄여 빌드하는 방식)**:
  ```bash
  flutter build apk --split-per-abi
  ```

### 빌드된 APK 파일 위치
빌드가 완료되면 터미널 메시지와 함께 다음 경로에 배송용 설치 파일(`.apk`)이 생성됩니다:
* 📂 **경로**: `driver_flutter/build/app/outputs/flutter-apk/`
* 📄 **파일명**: `app-release.apk` (또는 split 빌드 시 `app-armeabi-v7a-release.apk` 등)

---

## 📲 4. 실제 스마트폰에 배포 및 설치 사용법

완성된 `app-release.apk` 파일을 배송 기사님들의 휴대폰에 배포하고 설치하는 절차입니다.

### Step 1: 기사님 기기로 APK 파일 전송
개발자 혹은 관리자가 완성된 `app-release.apk` 파일을 다음 방법으로 기사님께 전송합니다:
1. **모바일 메신저**: 카카오톡 나에게 보내기 또는 단체 대화방에 파일 업로드
2. **이메일/클라우드**: 네이버 메일 대용량 첨부 혹은 Google Drive 링크 공유
3. **USB 다이렉트**: 컴퓨터와 휴대폰을 직접 USB 케이블로 연결하여 기기의 `Download` 폴더로 직접 복사

### Step 2: 휴대폰에서 앱 설치 진행
기사님의 스마트폰에서 전달받은 `app-release.apk` 파일을 터치하여 다운로드 및 실행합니다.

1. **출처를 알 수 없는 앱 설치 허용**: 
   * 플레이스토어 정식 등록 전이므로 "출처를 알 수 없는 앱 설치" 권한 경고창이 뜹니다.
   * **[설정]** 버튼을 누른 뒤, 카카오톡 또는 크롬 브라우저의 **"이 소스에서 만든 앱 허용"** 스위치를 켜주세요.
2. **Play 프로텍트 차단 우회**:
   * "안전하지 않은 앱 차단됨" 경고가 노출될 수 있습니다. 
   * **[무시하고 설치]** 버튼을 터치하여 강제 설치를 진행합니다.

### Step 3: 앱 권한 허용 및 사용 개시
* 앱이 성공적으로 설치되어 실행되면 **"기기의 실시간 위치(GPS) 정보 권한"** 수집 팝업이 나타납니다.
* 배송 실시간 경로 추적 및 카카오맵 길안내 기능 연동을 위해 권한을 반드시 **[앱 사용 중에만 허용]**으로 선택해 주어야 합니다.
* 본인의 배송 코스를 입력하고 로그인하면 즉시 사용 가능합니다.
