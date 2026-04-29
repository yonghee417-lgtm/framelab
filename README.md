# 프레임랩 (FrameLab)

YouTube Shorts · Instagram Reels 영상 편집기 (Windows).

## 빠른 시작

처음 한 번만:

```bash
# 1) 의존성 설치
npm install

# 2) 상업 사용 가능 폰트 다운로드 (한글/영문 25+개)
npm run fonts
```

개발 모드 실행:

```bash
npm run dev
```

설치 가능한 `.exe` 만들기:

```bash
npm run build
# release/ 폴더에 FrameLab Setup x.y.z.exe 생성
```

## 주요 기능

- **프리셋**: 쇼츠/릴스 (9:16), 유튜브 (16:9), 정사각 (1:1)
- **미디어 임포트**: 영상, 이미지, 오디오 파일
- **타임라인**: 다중 트랙(영상/오디오/자막), 드래그 이동, 양 끝 트림
- **컷 편집**: Ctrl+B 로 플레이헤드 위치에서 분할
- **클립별 조정**: 볼륨, 밝기, 페이드 인/아웃
- **자막**: 폰트/크기/색/외곽선/그림자/정렬, 표시 시점 설정
- **MP4 내보내기**: H.264, 비트레이트/속도 선택

## 단축키

| 단축키 | 동작 |
|---|---|
| `Space` | 재생 / 정지 |
| `Ctrl+B` | 플레이헤드에서 컷 |
| `Ctrl+Z` / `Ctrl+Y` | 실행취소 / 다시실행 |
| `Delete` | 선택한 클립 삭제 |

## 기술 스택

- Electron 32 + React 18 + TypeScript 5
- Vite, Tailwind CSS, Zustand
- FFmpeg (ffmpeg-static로 번들)

## 폴더 구조

```
framelab/
├── electron/         # 메인 프로세스 (Node.js): 파일 IO, FFmpeg 실행
├── shared/           # 메인 ↔ 렌더러 공통 타입
├── src/              # 렌더러 (React UI)
│   ├── components/   # UI 컴포넌트
│   ├── store/        # Zustand 상태
│   └── hooks/        # 훅
├── scripts/          # 폰트 다운로드 등 빌드 스크립트
└── assets/fonts/     # 번들 폰트 (스크립트로 다운로드)
```

## 라이선스

폰트는 모두 상업 사용 가능한 라이선스(SIL OFL 등)만 포함됩니다.
