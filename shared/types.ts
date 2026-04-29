// FrameLab 공통 타입 정의 - Electron 메인 ↔ 렌더러에서 모두 사용

export type AspectRatioPreset =
  | 'shorts'
  | 'youtube'
  | 'youtubeQHD'
  | 'youtube4k'
  | 'square'
  | 'cinemaWide'
  | 'cinema4k';

export interface ProjectSettings {
  preset: AspectRatioPreset;
  width: number;
  height: number;
  fps: number;          // 30 | 60
  sampleRate: number;   // 48000
}

export const PRESETS: Record<
  AspectRatioPreset,
  { width: number; height: number; label: string; description: string; group: 'mobile' | 'youtube' | 'cinema' }
> = {
  shorts: {
    width: 1080,
    height: 1920,
    label: '쇼츠/릴스',
    description: '9:16 세로 (YouTube Shorts, Instagram Reels)',
    group: 'mobile',
  },
  square: {
    width: 1080,
    height: 1080,
    label: '정사각',
    description: '1:1 (Instagram 피드)',
    group: 'mobile',
  },
  youtube: {
    width: 1920,
    height: 1080,
    label: '유튜브 FHD',
    description: '16:9 1080p (YouTube 일반 영상)',
    group: 'youtube',
  },
  youtubeQHD: {
    width: 2560,
    height: 1440,
    label: '유튜브 QHD',
    description: '16:9 1440p QHD (고화질 영상)',
    group: 'youtube',
  },
  youtube4k: {
    width: 3840,
    height: 2160,
    label: '유튜브 4K',
    description: '16:9 2160p UHD (YouTube 고해상도)',
    group: 'youtube',
  },
  cinemaWide: {
    width: 2560,
    height: 1080,
    label: '시네마 와이드',
    description: '21:9 시네마틱 (울트라와이드)',
    group: 'cinema',
  },
  cinema4k: {
    width: 4096,
    height: 2160,
    label: '시네마 4K',
    description: 'DCI 4K 17:9 (영화 표준)',
    group: 'cinema',
  },
};

export type MediaKind = 'video' | 'image' | 'audio';

export interface MediaAsset {
  id: string;
  filePath: string;     // 원본 절대경로
  fileName: string;
  kind: MediaKind;
  durationSec: number;  // 이미지는 기본 5초
  width?: number;
  height?: number;
  hasAudio?: boolean;
  thumbnailPath?: string;
  waveformPath?: string; // 오디오 파형 PNG (audio + audio가 있는 video에 생성)
  proxyPath?: string;    // 프록시(저해상도 사본) — 편집 미리보기용. export는 항상 원본 사용
  importedAt: number;
  folderId?: string;    // 가상 폴더 ID (없으면 루트)
}

// 가상 폴더 — OS 파일시스템과 무관하며 순수히 미디어 라이브러리 관리용
export interface MediaFolder {
  id: string;
  name: string;
  expanded: boolean;
  createdAt: number;
}

export type ClipKind = 'video' | 'image' | 'audio' | 'text';

export interface BaseClip {
  id: string;
  trackId: string;
  startSec: number;       // 타임라인 상 시작 위치
  durationSec: number;    // 타임라인 상 길이
  inSec: number;          // 소스 내 시작점 (트림)
  outSec: number;         // 소스 내 끝점
}

export type TransitionKind =
  | 'none'
  | 'fade'
  | 'slide-left'
  | 'slide-right'
  | 'slide-up'
  | 'slide-down'
  | 'zoom-in'
  | 'zoom-out'
  | 'wipe-left'
  | 'wipe-right';

export interface MediaClip extends BaseClip {
  kind: 'video' | 'image' | 'audio';
  assetId: string;
  volume: number;         // 0.0 ~ 2.0 (기본 1.0)
  brightness: number;     // -1.0 ~ 1.0
  fadeInSec: number;
  fadeOutSec: number;
  // 색 보정 (0이 기본)
  saturation?: number;    // -1 (회색) ~ 1 (강렬), 0 = 변화없음
  contrast?: number;      // -1 ~ 1
  temperature?: number;   // -1 (차가움/푸른색) ~ 1 (따뜻함/주황)
  tint?: number;          // -1 (녹색) ~ 1 (마젠타)
  gamma?: number;         // 0.5 ~ 2.0 (1 기본)
  // 오디오
  audioBass?: number;     // -12 ~ 12 dB
  audioMid?: number;      // -12 ~ 12 dB
  audioTreble?: number;   // -12 ~ 12 dB
  audioDenoise?: boolean; // 노이즈 제거 (FFmpeg afftdn)
  // 변환
  hflip: boolean;         // 좌우반전
  vflip: boolean;         // 상하반전
  speed: number;          // 재생 속도 (0.25~4.0, 1.0 기본)
  // 화면상 위치/크기 (영상/이미지에만 사용, 오디오는 무시)
  x: number;              // 중심 x, 0~1 정규화 (0.5 = 가운데)
  y: number;              // 중심 y, 0~1 정규화
  scale: number;          // 1.0 = 화면에 맞춤(letterbox), 2.0 = 200%
  rotation: number;       // 도(°), 0 기본
  // 트랜지션 (페이드 외 효과)
  transitionIn: TransitionKind;
  transitionOut: TransitionKind;
  transitionInSec: number;   // 0 = transitionIn 비활성
  transitionOutSec: number;
  // 키프레임 — 있으면 정적 x/y/scale/... 대신 시간별 보간 사용
  keyframes?: KeyframeMap;
  opacity?: number;          // 1 기본
}

// 키프레임: 시간(클립 내 상대시간)별 속성 값. 두 키프레임 사이는 선형 보간
export interface Keyframe {
  timeSec: number;  // 클립 시작점 기준 0~durationSec
  value: number;
}

// 키프레임이 적용 가능한 속성 (영상/이미지 클립 기준)
export type AnimatableProperty = 'x' | 'y' | 'scale' | 'rotation' | 'opacity' | 'volume';

export interface KeyframeMap {
  x?: Keyframe[];
  y?: Keyframe[];
  scale?: Keyframe[];
  rotation?: Keyframe[];
  opacity?: Keyframe[];
  volume?: Keyframe[];
}

export const DEFAULT_MEDIA_CLIP_TRANSFORM = {
  hflip: false,
  vflip: false,
  speed: 1,
  x: 0.5,
  y: 0.5,
  scale: 1,
  rotation: 0,
  transitionIn: 'none' as TransitionKind,
  transitionOut: 'none' as TransitionKind,
  transitionInSec: 0,
  transitionOutSec: 0,
} as const;

export type TextAnimation =
  | 'none'
  | 'fade'
  | 'typewriter'
  | 'slide-up'
  | 'slide-down'
  | 'slide-left'
  | 'slide-right'
  | 'pop'
  | 'bounce';

export interface TextClip extends BaseClip {
  kind: 'text';
  text: string;
  fontFamily: string;
  fontSize: number;
  color: string;
  bgColor?: string;
  align: 'left' | 'center' | 'right';
  x: number;              // 0~1 정규화
  y: number;              // 0~1 정규화
  bold: boolean;
  italic: boolean;
  shadow: boolean;
  outline: boolean;
  outlineColor: string;
  animationIn?: TextAnimation;
  animationOut?: TextAnimation;
  animationInSec?: number;
  animationOutSec?: number;
  // 박스 너비 (정규화 0~1, stage 너비 기준). 없으면 텍스트 길이에 맞춰 자동
  // 설정 시 텍스트는 이 너비를 넘으면 자동 줄바꿈
  width?: number;
}

export type AnyClip = MediaClip | TextClip;

export type TrackKind = 'video' | 'audio' | 'text';

export interface Track {
  id: string;
  kind: TrackKind;
  index: number;          // 0이 가장 위 (z-order 최상위)
  name?: string;
  muted: boolean;
  hidden: boolean;
  locked?: boolean;       // true 면 클립 편집/이동/삭제 차단
}

// 기존 프로젝트 호환을 위한 마이그레이션 헬퍼
export function migrateClip(c: any): AnyClip {
  if (c.kind === 'text') return c as TextClip;
  return {
    ...DEFAULT_MEDIA_CLIP_TRANSFORM,
    ...c,
  } as MediaClip;
}

export interface ProjectViewState {
  playheadSec?: number;
  pixelsPerSecond?: number;
}

export interface ProjectLastExport {
  outputPath: string;          // 마지막으로 내보낸 전체 경로 (폴더+파일명+.mp4)
  videoBitrate: string;        // '4M' | '8M' | '12M' | '20M'
  preset: 'ultrafast' | 'fast' | 'medium' | 'slow';
  exportedAt: number;
}

export interface Project {
  id: string;
  name: string;
  settings: ProjectSettings;
  assets: MediaAsset[];
  folders: MediaFolder[];
  tracks: Track[];
  clips: AnyClip[];
  createdAt: number;
  updatedAt: number;
  viewState?: ProjectViewState;  // 저장 시점의 재생 위치/줌 — 불러올 때 그대로 복원
  lastExport?: ProjectLastExport; // 마지막 내보내기 정보 — 다음에 동일 위치로 빠르게 내보내기
}

export interface ExportOptions {
  outputPath: string;
  videoBitrate: string;   // '8M' 등
  preset: 'ultrafast' | 'fast' | 'medium' | 'slow';
}

export interface ExportProgress {
  phase: 'preparing' | 'rendering' | 'finalizing' | 'done' | 'error';
  percent: number;
  message?: string;
}
