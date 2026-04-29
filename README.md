# 프레임랩 (FrameLab)

YouTube Shorts · Instagram Reels 영상 편집기. Windows · macOS 지원.

## 빠른 시작

처음 한 번만:

```bash
# 1) 의존성 설치
npm install

# 2) 상업 사용 가능 폰트 다운로드 (한글/영문 27개)
npm run fonts
```

개발 모드 실행:

```bash
npm run dev
```

## 설치 파일 빌드

빌드는 **빌드를 실행하는 OS 기준**으로 만들어집니다.

### Windows에서 빌드 → `.exe` 인스톨러

```bash
npm run build
# release/FrameLab Setup x.y.z.exe (NSIS 인스톨러)
```

### macOS에서 빌드 → `.dmg` 인스톨러

```bash
npm run build
# release/FrameLab-x.y.z-arm64.dmg  (Apple Silicon)
# release/FrameLab-x.y.z.dmg         (Intel)
# release/FrameLab-x.y.z-mac.zip     (zip 포터블)
```

> **macOS 첫 실행 시**: 코드 사이닝 인증서가 없어 "확인되지 않은 개발자" 경고가 뜹니다.
> - 우회: `시스템 환경설정 → 보안 및 개인정보 보호 → "그래도 열기"` 클릭
> - 또는 터미널에서: `xattr -cr /Applications/FrameLab.app`

## 주요 기능

### 🎬 비율 프리셋
- 쇼츠/릴스 (9:16, 1080×1920) · 정사각 (1:1)
- 유튜브 FHD/QHD/4K (16:9, 1080p~2160p)
- 시네마 와이드 (21:9) · DCI 4K (17:9)

### 📂 미디어 라이브러리
- 영상/이미지/오디오 import
- **가상 폴더**로 분류 정리 + 드래그 드롭
- 다중 선택 (클릭 / Shift / Ctrl) · 검색
- 4K 영상 자동 **프록시(720p)** 생성으로 편집 가벼움

### 🎞 타임라인
- 다중 트랙 (영상/오디오/자막 각각 여러 개)
- 트랙 헤더 드래그로 순서 변경, 잠금/숨김
- 클립 드래그/트림/컷 + **자석 스냅** + 박스 영역 선택
- Premiere Pro 호환 단축키

### ✨ 효과
- 트랜지션 10종 (페이드/슬라이드/줌/와이프)
- 자막 12종 프리셋 + 등장/퇴장 애니메이션 8종
- 색 보정 (밝기/채도/대비/색온도/틴트/감마)
- 좌우/상하 반전 · 회전 · 위치/크기 조정
- 오디오 EQ (저/중/고음) + 노이즈 제거
- 재생 속도 0.25x ~ 4x

### 🔑 키프레임 애니메이션
위치 / 크기 / 회전 / 투명도 / 볼륨에 시간별 키프레임 → 자동 보간

### 💾 저장 / 불러오기
- 라이브러리 자동 저장 (1초 디바운스 + 30초 인터벌 + 창 포커스 잃을 때)
- 외부 `.framelab.json` 저장/불러오기
- 마지막 내보내기 위치 자동 기억

### 📤 내보내기
- MP4 (H.264 + AAC), 4K~5K 지원
- 비트레이트/인코딩 속도 선택
- 실시간 진행률 + fps + 남은 시간 표시
- 정지화면(PNG) 캡처

## 단축키 (Premiere Pro 호환)

| 단축키 | 동작 |
|---|---|
| `Space` | 재생 / 정지 |
| `,` `.` | 1프레임 뒤/앞 |
| `Shift + ,` `.` | 1초 점프 |
| `←` `→` | (선택 클립 없을 때) 1프레임 이동 / (있을 때) 위치 미세조정 |
| `↑` `↓` | (선택 클립) 위치 세로 이동 |
| `C` | 면도날 컷 (선택 트랙 있으면 그 트랙만) |
| `Ctrl+B` | 플레이헤드에서 컷 |
| `Ctrl+C/V/D` | 클립 복사/붙여넣기/복제 |
| `Ctrl+S` / `Ctrl+Shift+S` | 저장 / 다른 이름으로 |
| `Ctrl+Z` / `Ctrl+Y` | 실행취소 / 다시실행 |
| `Delete` | 선택 클립(다중 가능) 삭제 |
| 미리보기 휠 | 위/아래 이동 |
| 미리보기 `Shift+휠` | 좌우 이동 |
| 미리보기 `Ctrl+휠` | 줌 (커서 기준) |
| 타임라인 `Ctrl+휠` | 시간 줌 |

## 기술 스택

- Electron 32 · React 18 · TypeScript 5
- Vite · Tailwind CSS · Zustand
- FFmpeg / FFprobe (ffmpeg-static 번들)

## 폴더 구조

```
framelab/
├── electron/         # 메인 프로세스 (Node.js): 파일 IO, FFmpeg 실행
├── shared/           # 메인 ↔ 렌더러 공통 타입
├── src/              # 렌더러 (React UI)
│   ├── components/   # UI 컴포넌트
│   ├── store/        # Zustand 상태
│   ├── hooks/        # 훅
│   ├── data/         # 자막 프리셋
│   └── utils/        # 키프레임 보간, 최근 파일 등
├── scripts/          # 폰트 다운로드 스크립트
└── assets/fonts/     # 번들 폰트 (npm run fonts로 다운로드)
```

## 라이선스

- 코드: 개인 프로젝트, 별도 라이선스 미부여
- 번들 폰트: 모두 **상업 사용 가능 라이선스** (SIL OFL, 눈누 등록)
- FFmpeg: LGPL (동적 링크)
