import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import type {
  Project,
  AspectRatioPreset,
  MediaAsset,
  MediaFolder,
  AnyClip,
  MediaClip,
  TextClip,
  Track,
  AnimatableProperty,
  KeyframeMap,
  ProjectLastExport,
} from '@shared/types';
import { setKeyframe as setKf, removeKeyframeAt } from '../utils/keyframes';
import { PRESETS, DEFAULT_MEDIA_CLIP_TRANSFORM, migrateClip } from '@shared/types';

interface HistoryEntry {
  clips: AnyClip[];
  tracks: Track[];
  assets: MediaAsset[];
}

interface ProjectStore {
  project: Project | null;
  // 외부 파일에서 열었거나 "다른 이름으로 저장"한 경로 — null이면 라이브러리에 저장됨
  currentFilePath: string | null;
  setCurrentFilePath: (filePath: string | null) => void;
  selectedClipId: string | null;        // 호환용: selectedClipIds[0]
  selectedClipIds: string[];            // 다중 선택 (Shift/Ctrl 클릭으로 추가)
  selectedTrackId: string | null;
  playheadSec: number;
  pixelsPerSecond: number;
  isPlaying: boolean;
  history: HistoryEntry[];
  historyIndex: number;

  // 프로젝트 관리
  createProject: (name: string, preset: AspectRatioPreset) => void;
  loadProject: (project: Project) => void;
  updateProjectName: (name: string) => void;
  // 저장용 — 현재 view state(재생 위치/줌) 합친 project 반환
  getSerializableProject: () => Project | null;
  // 마지막 내보내기 정보 저장 (다음 export 시 자동 채움)
  setLastExport: (info: ProjectLastExport) => void;

  // 미디어
  addAsset: (asset: MediaAsset) => void;
  removeAsset: (assetId: string) => void;
  moveAssetToFolder: (assetId: string, folderId: string | null) => void;

  // 폴더 (가상 폴더)
  addFolder: (name?: string) => string;
  renameFolder: (id: string, name: string) => void;
  removeFolder: (id: string) => void;
  toggleFolder: (id: string) => void;

  // 트랙
  addTrack: (kind: Track['kind'], aboveTrackId?: string) => string;
  removeTrack: (trackId: string) => void;
  moveTrack: (trackId: string, direction: 'up' | 'down') => void;
  renameTrack: (trackId: string, name: string) => void;
  reorderTrack: (trackId: string, beforeTrackId: string | null) => void;
  selectTrack: (id: string | null) => void;
  toggleTrackHidden: (trackId: string) => void;
  toggleTrackLocked: (trackId: string) => void;

  // 클립
  addClipFromAsset: (asset: MediaAsset, atSec?: number, targetTrackId?: string | null) => string | null;
  addClipsFromAssets: (assets: MediaAsset[], atSec?: number, targetTrackId?: string | null) => void;
  addTextClip: (atSec: number, durationSec?: number) => string;
  updateClip: (id: string, patch: Partial<AnyClip>) => void;
  removeClip: (id: string) => void;
  removeClips: (ids: string[]) => void;
  splitClipAtPlayhead: () => void;
  selectClip: (id: string | null, mode?: 'replace' | 'toggle' | 'range') => void;
  selectClips: (ids: string[]) => void;
  moveClipToTrack: (clipId: string, trackId: string) => void;
  resolveClipCollision: (clipId: string) => void;  // 같은 트랙 내 다른 클립과 겹치면 가장 가까운 빈 시점으로 이동
  // 키프레임
  addKeyframeAtPlayhead: (clipId: string, prop: AnimatableProperty, value: number) => void;
  removeKeyframeAtPlayhead: (clipId: string, prop: AnimatableProperty) => void;
  clearKeyframes: (clipId: string, prop: AnimatableProperty) => void;
  // 클립보드
  clipboard: AnyClip | null;
  copySelectedClip: () => void;
  pasteClip: () => void;
  duplicateSelectedClip: () => void;

  // 재생
  setPlayhead: (sec: number) => void;
  setPlaying: (playing: boolean) => void;

  // 줌
  setZoom: (pps: number) => void;

  // 히스토리
  pushHistory: () => void;
  undo: () => void;
  redo: () => void;

  // 전체 길이
  totalDurationSec: () => number;
}

const initialPPS = 80;

// 같은 트랙에서 [start, start+duration) 시간대가 비어있는지 확인
function hasOverlap(clips: AnyClip[], trackId: string, start: number, end: number, ignoreId?: string): boolean {
  return clips.some(
    (c) => c.id !== ignoreId && c.trackId === trackId && c.startSec < end && c.startSec + c.durationSec > start,
  );
}

// 트랙 내에서 [desiredStart, desiredStart+duration)와 겹치지 않는 가장 가까운 시점 찾기
// 다른 클립과 겹치면 그 클립 직후 또는 직전 중 desired에 더 가까운 쪽으로 이동
function findFreeSlot(
  clips: AnyClip[],
  trackId: string,
  desiredStart: number,
  duration: number,
  ignoreId: string,
): number {
  const others = clips
    .filter((c) => c.id !== ignoreId && c.trackId === trackId)
    .sort((a, b) => a.startSec - b.startSec);
  let candidate = Math.max(0, desiredStart);
  // 충돌 없을 때까지 반복: 겹치는 클립 끝 이후로 밀어냄
  // 무한루프 방지용 max iter
  for (let i = 0; i < 1000; i++) {
    const overlap = others.find(
      (c) => candidate < c.startSec + c.durationSec && candidate + duration > c.startSec,
    );
    if (!overlap) return candidate;
    candidate = overlap.startSec + overlap.durationSec;
  }
  return candidate;
}

// 같은 종류 트랙 중에서 해당 시간대에 비어있는 트랙 찾기, 없으면 새로 생성
function findOrCreateTrackForClip(
  tracks: Track[],
  clips: AnyClip[],
  kind: Track['kind'],
  startSec: number,
  durationSec: number,
): { track: Track; tracksAfter: Track[] } {
  const sameKind = tracks.filter((t) => t.kind === kind).sort((a, b) => a.index - b.index);
  for (const t of sameKind) {
    if (!hasOverlap(clips, t.id, startSec, startSec + durationSec)) {
      return { track: t, tracksAfter: tracks };
    }
  }
  // 모두 겹치면 새 트랙 생성 — 같은 종류의 가장 위(가장 작은 index) 바로 위에 추가
  const newIndex = sameKind.length > 0 ? Math.min(...sameKind.map((t) => t.index)) - 1 : tracks.length;
  const newTrack: Track = {
    id: uuidv4(),
    kind,
    index: newIndex,
    muted: false,
    hidden: false,
  };
  return { track: newTrack, tracksAfter: [...tracks, newTrack] };
}

function buildInitialTracks(): Track[] {
  // 기본: 자막1 → 영상1 → 오디오1 (위→아래)
  return [
    { id: uuidv4(), kind: 'text', index: 0, muted: false, hidden: false },
    { id: uuidv4(), kind: 'video', index: 10, muted: false, hidden: false },
    { id: uuidv4(), kind: 'audio', index: 20, muted: false, hidden: false },
  ];
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  project: null,
  currentFilePath: null,
  setCurrentFilePath: (filePath) => set({ currentFilePath: filePath }),
  selectedClipId: null,
  selectedClipIds: [],
  selectedTrackId: null,
  playheadSec: 0,
  pixelsPerSecond: initialPPS,
  isPlaying: false,
  history: [],
  historyIndex: -1,

  createProject: (name, preset) => {
    const dims = PRESETS[preset];
    const now = Date.now();
    const project: Project = {
      id: uuidv4(),
      name,
      settings: {
        preset,
        width: dims.width,
        height: dims.height,
        fps: 30,
        sampleRate: 48000,
      },
      assets: [],
      folders: [],
      tracks: buildInitialTracks(),
      clips: [],
      createdAt: now,
      updatedAt: now,
    };
    set({
      project,
      currentFilePath: null, // 새 프로젝트는 라이브러리에 자동 저장
      selectedClipId: null,
      playheadSec: 0,
      isPlaying: false,
      history: [],
      historyIndex: -1,
    });
  },

  loadProject: (project) => {
    // 마이그레이션 적용 (기존 프로젝트 호환)
    const migrated: Project = {
      ...project,
      clips: project.clips.map((c) => migrateClip(c)),
      tracks: project.tracks.length > 0 ? project.tracks : buildInitialTracks(),
      folders: project.folders ?? [],
    };
    const vs = project.viewState ?? {};
    set({
      project: migrated,
      currentFilePath: null, // 호출자가 외부 파일이면 별도로 setCurrentFilePath 호출
      selectedClipId: null,
      selectedClipIds: [],
      isPlaying: false,
      // 저장 당시 위치/줌 복원
      playheadSec: vs.playheadSec ?? 0,
      pixelsPerSecond: vs.pixelsPerSecond ?? 80,
    });
  },

  getSerializableProject: () => {
    const { project, playheadSec, pixelsPerSecond } = get();
    if (!project) return null;
    return {
      ...project,
      viewState: {
        playheadSec,
        pixelsPerSecond,
      },
    };
  },

  setLastExport: (info) => {
    const project = get().project;
    if (!project) return;
    set({ project: { ...project, lastExport: info, updatedAt: Date.now() } });
  },

  updateProjectName: (name) => {
    const project = get().project;
    if (!project) return;
    set({ project: { ...project, name, updatedAt: Date.now() } });
  },

  addAsset: (asset) => {
    const project = get().project;
    if (!project) return;
    set({ project: { ...project, assets: [...project.assets, asset], updatedAt: Date.now() } });
  },

  removeAsset: (assetId) => {
    const project = get().project;
    if (!project) return;
    set({
      project: {
        ...project,
        assets: project.assets.filter((a) => a.id !== assetId),
        clips: project.clips.filter((c) => c.kind === 'text' || (c as MediaClip).assetId !== assetId),
        updatedAt: Date.now(),
      },
    });
  },

  moveAssetToFolder: (assetId, folderId) => {
    const project = get().project;
    if (!project) return;
    set({
      project: {
        ...project,
        assets: project.assets.map((a) =>
          a.id === assetId ? { ...a, folderId: folderId ?? undefined } : a,
        ),
        updatedAt: Date.now(),
      },
    });
  },

  addFolder: (name) => {
    const project = get().project;
    if (!project) return '';
    const id = uuidv4();
    // 기본 이름: "새 폴더", "새 폴더 2" 등 충돌 방지
    let folderName = name?.trim() || '새 폴더';
    if (!name) {
      const existing = new Set(project.folders.map((f) => f.name));
      let i = 1;
      while (existing.has(folderName)) {
        i += 1;
        folderName = `새 폴더 ${i}`;
      }
    }
    const folder: MediaFolder = {
      id,
      name: folderName,
      expanded: true,
      createdAt: Date.now(),
    };
    set({
      project: { ...project, folders: [...project.folders, folder], updatedAt: Date.now() },
    });
    return id;
  },

  renameFolder: (id, name) => {
    const project = get().project;
    if (!project) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    set({
      project: {
        ...project,
        folders: project.folders.map((f) => (f.id === id ? { ...f, name: trimmed } : f)),
        updatedAt: Date.now(),
      },
    });
  },

  removeFolder: (id) => {
    const project = get().project;
    if (!project) return;
    set({
      project: {
        ...project,
        folders: project.folders.filter((f) => f.id !== id),
        // 폴더 안 자산은 루트로 이동
        assets: project.assets.map((a) => (a.folderId === id ? { ...a, folderId: undefined } : a)),
        updatedAt: Date.now(),
      },
    });
  },

  toggleFolder: (id) => {
    const project = get().project;
    if (!project) return;
    set({
      project: {
        ...project,
        folders: project.folders.map((f) =>
          f.id === id ? { ...f, expanded: !f.expanded } : f,
        ),
        updatedAt: Date.now(),
      },
    });
  },

  addTrack: (kind, aboveTrackId) => {
    const project = get().project;
    if (!project) return '';
    const id = uuidv4();
    let newIndex: number;
    if (aboveTrackId) {
      const above = project.tracks.find((t) => t.id === aboveTrackId);
      newIndex = above ? above.index - 0.5 : project.tracks.length;
    } else {
      // 같은 종류 트랙 중 가장 위에 추가
      const sameKind = project.tracks.filter((t) => t.kind === kind);
      newIndex = sameKind.length > 0 ? Math.min(...sameKind.map((t) => t.index)) - 1 : project.tracks.length;
    }
    const newTrack: Track = { id, kind, index: newIndex, muted: false, hidden: false };
    // index 정수로 재정규화
    const tracks = [...project.tracks, newTrack].sort((a, b) => a.index - b.index).map((t, i) => ({ ...t, index: i }));
    set({
      project: { ...project, tracks, updatedAt: Date.now() },
    });
    return id;
  },

  removeTrack: (trackId) => {
    const project = get().project;
    if (!project) return;
    // 마지막 같은 종류 트랙은 삭제 불가
    const target = project.tracks.find((t) => t.id === trackId);
    if (!target) return;
    const sameKindCount = project.tracks.filter((t) => t.kind === target.kind).length;
    if (sameKindCount <= 1) return;
    get().pushHistory();
    set({
      project: {
        ...project,
        tracks: project.tracks.filter((t) => t.id !== trackId),
        clips: project.clips.filter((c) => c.trackId !== trackId),
        updatedAt: Date.now(),
      },
    });
  },

  reorderTrack: (trackId, beforeTrackId) => {
    const project = get().project;
    if (!project) return;
    const moving = project.tracks.find((t) => t.id === trackId);
    if (!moving) return;
    // 같은 종류 트랙끼리만 재정렬 허용
    let target: Track | undefined;
    if (beforeTrackId) {
      target = project.tracks.find((t) => t.id === beforeTrackId);
      if (!target || target.kind !== moving.kind) return;
    }
    const ordered = [...project.tracks].sort((a, b) => a.index - b.index);
    const without = ordered.filter((t) => t.id !== trackId);
    let insertAt: number;
    if (beforeTrackId) {
      insertAt = without.findIndex((t) => t.id === beforeTrackId);
      if (insertAt < 0) insertAt = without.length;
    } else {
      // null = 같은 종류 트랙 그룹의 맨 끝(가장 아래)에 둠
      const sameKindTail = without.map((t, i) => ({ t, i })).filter(({ t }) => t.kind === moving.kind).pop();
      insertAt = sameKindTail ? sameKindTail.i + 1 : without.length;
    }
    const reordered = [...without.slice(0, insertAt), moving, ...without.slice(insertAt)];
    const tracks = reordered.map((t, i) => ({ ...t, index: i }));
    set({ project: { ...project, tracks, updatedAt: Date.now() } });
  },

  selectTrack: (id) => {
    const current = get().selectedTrackId;
    set({ selectedTrackId: current === id ? null : id });
  },

  toggleTrackHidden: (trackId) => {
    const project = get().project;
    if (!project) return;
    set({
      project: {
        ...project,
        tracks: project.tracks.map((t) => (t.id === trackId ? { ...t, hidden: !t.hidden } : t)),
        updatedAt: Date.now(),
      },
    });
  },

  toggleTrackLocked: (trackId) => {
    const project = get().project;
    if (!project) return;
    set({
      project: {
        ...project,
        tracks: project.tracks.map((t) => (t.id === trackId ? { ...t, locked: !t.locked } : t)),
        updatedAt: Date.now(),
      },
    });
  },

  renameTrack: (trackId, name) => {
    const project = get().project;
    if (!project) return;
    const trimmed = name.trim();
    set({
      project: {
        ...project,
        tracks: project.tracks.map((t) =>
          t.id === trackId ? { ...t, name: trimmed || undefined } : t,
        ),
        updatedAt: Date.now(),
      },
    });
  },

  moveTrack: (trackId, direction) => {
    const project = get().project;
    if (!project) return;
    const sorted = [...project.tracks].sort((a, b) => a.index - b.index);
    const idx = sorted.findIndex((t) => t.id === trackId);
    if (idx < 0) return;
    const swapWith = direction === 'up' ? idx - 1 : idx + 1;
    if (swapWith < 0 || swapWith >= sorted.length) return;
    // 같은 종류만 교환 가능
    if (sorted[idx].kind !== sorted[swapWith].kind) return;
    [sorted[idx], sorted[swapWith]] = [sorted[swapWith], sorted[idx]];
    const tracks = sorted.map((t, i) => ({ ...t, index: i }));
    set({ project: { ...project, tracks, updatedAt: Date.now() } });
  },

  addClipFromAsset: (asset, atSec, targetTrackId) => {
    const project = get().project;
    if (!project) return null;
    const trackKind: Track['kind'] = asset.kind === 'audio' ? 'audio' : 'video';
    let start = atSec ?? get().playheadSec;

    let chosenTrack: Track | undefined;
    let nextTracks = project.tracks;

    // 1) 명시된 targetTrackId가 같은 종류면 그것 사용 — 끝에 이어붙이기
    if (targetTrackId) {
      const explicit = project.tracks.find((t) => t.id === targetTrackId);
      if (explicit && explicit.kind === trackKind) {
        chosenTrack = explicit;
        const tail = project.clips
          .filter((c) => c.trackId === explicit.id)
          .reduce((m, c) => Math.max(m, c.startSec + c.durationSec), 0);
        start = Math.max(atSec ?? 0, tail);
      }
    }

    // 2) 선택된 트랙이 있으면 그 트랙 사용
    if (!chosenTrack) {
      const selectedId = get().selectedTrackId;
      if (selectedId) {
        const sel = project.tracks.find((t) => t.id === selectedId);
        if (sel && sel.kind === trackKind) {
          chosenTrack = sel;
          const tail = project.clips
            .filter((c) => c.trackId === sel.id)
            .reduce((m, c) => Math.max(m, c.startSec + c.durationSec), 0);
          start = Math.max(atSec ?? 0, tail);
        }
      }
    }

    // 3) 빈 시간대 자동 트랙 선택, 없으면 새 트랙
    if (!chosenTrack) {
      const result = findOrCreateTrackForClip(project.tracks, project.clips, trackKind, start, asset.durationSec);
      chosenTrack = result.track;
      nextTracks = result.tracksAfter;
    }

    const id = uuidv4();
    const clip: MediaClip = {
      id,
      trackId: chosenTrack.id,
      kind: asset.kind === 'image' ? 'image' : asset.kind === 'audio' ? 'audio' : 'video',
      assetId: asset.id,
      startSec: start,
      durationSec: asset.durationSec,
      inSec: 0,
      outSec: asset.durationSec,
      volume: 1,
      brightness: 0,
      fadeInSec: 0,
      fadeOutSec: 0,
      ...DEFAULT_MEDIA_CLIP_TRANSFORM,
    };
    get().pushHistory();
    set({
      project: { ...project, tracks: nextTracks, clips: [...project.clips, clip], updatedAt: Date.now() },
      selectedClipId: id,
    });
    return id;
  },

  addClipsFromAssets: (assets, atSec, targetTrackId) => {
    if (assets.length === 0) return;
    // 같은 종류끼리 그룹화하되 입력 순서 유지
    let cursor = atSec ?? get().playheadSec;
    for (const asset of assets) {
      const id = get().addClipFromAsset(asset, cursor, targetTrackId);
      if (id) {
        // 다음 자산은 방금 추가한 클립 끝에 이어붙임
        const project = get().project;
        const last = project?.clips.find((c) => c.id === id);
        if (last) cursor = last.startSec + last.durationSec;
      }
    }
  },

  addTextClip: (atSec, durationSec = 3) => {
    const project = get().project;
    if (!project) return '';
    const { track, tracksAfter } = findOrCreateTrackForClip(
      project.tracks,
      project.clips,
      'text',
      atSec,
      durationSec,
    );
    const id = uuidv4();
    const clip: TextClip = {
      id,
      trackId: track.id,
      kind: 'text',
      startSec: atSec,
      durationSec,
      inSec: 0,
      outSec: durationSec,
      text: '자막을 입력하세요',
      fontFamily: 'Pretendard-Bold',
      fontSize: 64,
      color: '#ffffff',
      align: 'center',
      x: 0.5,
      y: 0.85,
      bold: true,
      italic: false,
      shadow: true,
      outline: true,
      outlineColor: '#000000',
    };
    get().pushHistory();
    set({
      project: { ...project, tracks: tracksAfter, clips: [...project.clips, clip], updatedAt: Date.now() },
      selectedClipId: id,
    });
    return id;
  },

  updateClip: (id, patch) => {
    const project = get().project;
    if (!project) return;
    const selectedIds = get().selectedClipIds;
    // 호출된 clipId가 다중 선택의 일부라면 같은 종류 + 잠금 안 된 모든 선택 클립에 patch 적용
    // 그렇지 않으면 단일 클립에만 적용 (호환성)
    const baseClip = project.clips.find((c) => c.id === id);
    if (!baseClip) return;
    const baseTrack = project.tracks.find((t) => t.id === baseClip.trackId);
    if (baseTrack?.locked) return;

    const targetIds = selectedIds.length > 1 && selectedIds.includes(id)
      ? selectedIds.filter((sid) => {
          const c = project.clips.find((cc) => cc.id === sid);
          if (!c) return false;
          // 같은 종류의 클립에만 일괄 적용 (자막 patch가 영상에 의미 없음 등)
          if (c.kind !== baseClip.kind) return false;
          const tr = project.tracks.find((t) => t.id === c.trackId);
          return !tr?.locked;
        })
      : [id];

    set({
      project: {
        ...project,
        clips: project.clips.map((c) =>
          targetIds.includes(c.id) ? ({ ...c, ...patch } as AnyClip) : c,
        ),
        updatedAt: Date.now(),
      },
    });
  },

  removeClip: (id) => {
    const project = get().project;
    if (!project) return;
    const clip = project.clips.find((c) => c.id === id);
    if (!clip) return;
    const track = project.tracks.find((t) => t.id === clip.trackId);
    if (track?.locked) return;
    get().pushHistory();
    set({
      project: { ...project, clips: project.clips.filter((c) => c.id !== id), updatedAt: Date.now() },
      selectedClipId: get().selectedClipId === id ? null : get().selectedClipId,
      selectedClipIds: get().selectedClipIds.filter((x) => x !== id),
    });
  },

  removeClips: (ids) => {
    const project = get().project;
    if (!project || ids.length === 0) return;
    // 잠긴 트랙의 클립 제외
    const removable = ids.filter((id) => {
      const c = project.clips.find((cc) => cc.id === id);
      if (!c) return false;
      const t = project.tracks.find((tt) => tt.id === c.trackId);
      return !t?.locked;
    });
    if (removable.length === 0) return;
    get().pushHistory(); // 한 번만 — Undo 시 한 번에 모두 복원
    const removeSet = new Set(removable);
    set({
      project: {
        ...project,
        clips: project.clips.filter((c) => !removeSet.has(c.id)),
        updatedAt: Date.now(),
      },
      selectedClipId: null,
      selectedClipIds: get().selectedClipIds.filter((x) => !removeSet.has(x)),
    });
  },

  splitClipAtPlayhead: () => {
    const { project, playheadSec, selectedTrackId } = get();
    if (!project) return;
    // 트랙이 선택돼 있으면 그 트랙 안에서만 컷, 아니면 어느 트랙이든 첫 매칭 클립
    const candidates = project.clips.filter(
      (c) => playheadSec > c.startSec && playheadSec < c.startSec + c.durationSec,
    );
    const filtered = selectedTrackId
      ? candidates.filter((c) => c.trackId === selectedTrackId)
      : candidates;
    const clip = filtered[0];
    if (!clip) return;
    // 잠긴 트랙은 컷 차단
    const track = project.tracks.find((t) => t.id === clip.trackId);
    if (track?.locked) return;

    get().pushHistory();
    const localOffset = playheadSec - clip.startSec;
    const sourceCut = clip.inSec + localOffset;

    const left: AnyClip = {
      ...clip,
      durationSec: localOffset,
      outSec: sourceCut,
    };
    const right: AnyClip = {
      ...clip,
      id: uuidv4(),
      startSec: playheadSec,
      durationSec: clip.durationSec - localOffset,
      inSec: sourceCut,
    };

    set({
      project: {
        ...project,
        clips: [...project.clips.filter((c) => c.id !== clip.id), left, right],
        updatedAt: Date.now(),
      },
    });
  },

  selectClip: (id, mode = 'replace') => {
    const cur = get().selectedClipIds;
    const project = get().project;
    if (id === null) {
      set({ selectedClipIds: [], selectedClipId: null });
      return;
    }
    if (mode === 'toggle') {
      const has = cur.includes(id);
      const next = has ? cur.filter((x) => x !== id) : [...cur, id];
      set({ selectedClipIds: next, selectedClipId: next[0] ?? null });
      return;
    }
    if (mode === 'range' && project && cur.length > 0) {
      // 마지막 앵커(가장 최근 단일 선택)에서 클릭 위치까지 시간순 모든 클립 선택
      const anchor = cur[cur.length - 1];
      const sorted = [...project.clips].sort((a, b) => a.startSec - b.startSec);
      const i1 = sorted.findIndex((c) => c.id === anchor);
      const i2 = sorted.findIndex((c) => c.id === id);
      if (i1 < 0 || i2 < 0) {
        set({ selectedClipIds: [id], selectedClipId: id });
        return;
      }
      const [from, to] = i1 <= i2 ? [i1, i2] : [i2, i1];
      const ids = sorted.slice(from, to + 1).map((c) => c.id);
      set({ selectedClipIds: ids, selectedClipId: ids[0] });
      return;
    }
    // replace (기본) — 단일 선택
    set({ selectedClipIds: [id], selectedClipId: id });
  },

  selectClips: (ids) => {
    set({ selectedClipIds: ids, selectedClipId: ids[0] ?? null });
  },

  addKeyframeAtPlayhead: (clipId, prop, value) => {
    const project = get().project;
    if (!project) return;
    const clip = project.clips.find((c) => c.id === clipId);
    if (!clip || clip.kind === 'text') return;
    const localTime = Math.max(0, get().playheadSec - clip.startSec);
    if (localTime > clip.durationSec) return;
    const m: MediaClip = clip as MediaClip;
    const newMap: KeyframeMap = { ...(m.keyframes ?? {}) };
    newMap[prop] = setKf(newMap[prop], { timeSec: localTime, value });
    get().updateClip(clipId, { keyframes: newMap } as Partial<MediaClip> as Partial<AnyClip>);
  },

  removeKeyframeAtPlayhead: (clipId, prop) => {
    const project = get().project;
    if (!project) return;
    const clip = project.clips.find((c) => c.id === clipId);
    if (!clip || clip.kind === 'text') return;
    const localTime = Math.max(0, get().playheadSec - clip.startSec);
    const m: MediaClip = clip as MediaClip;
    const cur = m.keyframes?.[prop];
    if (!cur) return;
    const newArr = removeKeyframeAt(cur, localTime);
    const newMap: KeyframeMap = { ...(m.keyframes ?? {}) };
    if (newArr.length === 0) delete newMap[prop];
    else newMap[prop] = newArr;
    get().updateClip(clipId, { keyframes: newMap } as Partial<MediaClip> as Partial<AnyClip>);
  },

  clearKeyframes: (clipId, prop) => {
    const project = get().project;
    if (!project) return;
    const clip = project.clips.find((c) => c.id === clipId);
    if (!clip || clip.kind === 'text') return;
    const m: MediaClip = clip as MediaClip;
    const newMap: KeyframeMap = { ...(m.keyframes ?? {}) };
    delete newMap[prop];
    get().updateClip(clipId, { keyframes: newMap } as Partial<MediaClip> as Partial<AnyClip>);
  },

  clipboard: null,

  copySelectedClip: () => {
    const { project, selectedClipId } = get();
    if (!project || !selectedClipId) return;
    const clip = project.clips.find((c) => c.id === selectedClipId);
    if (clip) set({ clipboard: structuredClone(clip) });
  },

  pasteClip: () => {
    const { project, clipboard } = get();
    if (!project || !clipboard) return;
    const playhead = get().playheadSec;
    const newClip: AnyClip = {
      ...structuredClone(clipboard),
      id: uuidv4(),
      startSec: playhead,
    };
    // 트랙이 없거나 잠긴 경우 같은 종류 트랙 자동 선택
    const origTrack = project.tracks.find((t) => t.id === newClip.trackId);
    const kind: Track['kind'] =
      newClip.kind === 'text' ? 'text' : newClip.kind === 'audio' ? 'audio' : 'video';
    let trackId = newClip.trackId;
    if (!origTrack || origTrack.locked || origTrack.kind !== kind) {
      const sameKind = project.tracks.find((t) => t.kind === kind && !t.locked);
      if (sameKind) trackId = sameKind.id;
      else return;
    }
    newClip.trackId = trackId;
    get().pushHistory();
    set({
      project: { ...project, clips: [...project.clips, newClip], updatedAt: Date.now() },
      selectedClipId: newClip.id,
    });
  },

  duplicateSelectedClip: () => {
    const { project, selectedClipId } = get();
    if (!project || !selectedClipId) return;
    const clip = project.clips.find((c) => c.id === selectedClipId);
    if (!clip) return;
    const track = project.tracks.find((t) => t.id === clip.trackId);
    if (track?.locked) return;
    const newClip: AnyClip = {
      ...structuredClone(clip),
      id: uuidv4(),
      startSec: clip.startSec + clip.durationSec, // 바로 뒤에 붙여넣기
    };
    get().pushHistory();
    set({
      project: { ...project, clips: [...project.clips, newClip], updatedAt: Date.now() },
      selectedClipId: newClip.id,
    });
  },

  moveClipToTrack: (clipId, trackId) => {
    const project = get().project;
    if (!project) return;
    const clip = project.clips.find((c) => c.id === clipId);
    const target = project.tracks.find((t) => t.id === trackId);
    const source = project.tracks.find((t) => t.id === clip?.trackId);
    if (!clip || !target) return;
    if (source?.locked || target.locked) return; // 잠긴 트랙 안/밖으로 이동 차단
    const clipKind: Track['kind'] = clip.kind === 'text' ? 'text' : clip.kind === 'audio' ? 'audio' : 'video';
    if (target.kind !== clipKind) return;
    if (clip.trackId === trackId) return;
    // 트랙 변경 시에는 startSec를 그대로 유지 (드래그 중 자유 배치)
    // 충돌 해결은 mouseup 시 resolveClipCollision으로 별도 처리
    set({
      project: {
        ...project,
        clips: project.clips.map((c) => (c.id === clipId ? { ...c, trackId } : c)) as AnyClip[],
        updatedAt: Date.now(),
      },
    });
  },

  resolveClipCollision: (clipId) => {
    const project = get().project;
    if (!project) return;
    const clip = project.clips.find((c) => c.id === clipId);
    if (!clip) return;
    const track = project.tracks.find((t) => t.id === clip.trackId);
    if (track?.locked) return;
    const overlaps = hasOverlap(project.clips, clip.trackId, clip.startSec, clip.startSec + clip.durationSec, clip.id);
    if (!overlaps) return;
    // 겹치는 경우: 가장 가까운 빈 시점 찾기
    // (1) 원하는 startSec 직후의 빈 자리 (밀어내기)
    const forwardSlot = findFreeSlot(project.clips, clip.trackId, clip.startSec, clip.durationSec, clip.id);
    // (2) 원하는 startSec 직전의 빈 자리 (앞으로 밀어내기) — 다른 클립의 시작점 직전
    let backwardSlot = forwardSlot;
    const others = project.clips
      .filter((c) => c.id !== clip.id && c.trackId === clip.trackId)
      .sort((a, b) => a.startSec - b.startSec);
    for (let i = others.length - 1; i >= 0; i--) {
      const c = others[i];
      const candidateEnd = c.startSec; // 이 클립 시작점 직전에 끝나도록
      const candidateStart = candidateEnd - clip.durationSec;
      if (candidateStart < 0) continue;
      // 그 시점이 충돌 없는지 확인
      if (!hasOverlap(project.clips, clip.trackId, candidateStart, candidateEnd, clip.id)) {
        backwardSlot = candidateStart;
        break;
      }
    }
    // 둘 중 desiredStart에 더 가까운 쪽 선택
    const distF = Math.abs(forwardSlot - clip.startSec);
    const distB = Math.abs(backwardSlot - clip.startSec);
    const finalStart = distF <= distB ? forwardSlot : backwardSlot;
    set({
      project: {
        ...project,
        clips: project.clips.map((c) =>
          c.id === clipId ? { ...c, startSec: Math.max(0, finalStart) } : c,
        ),
        updatedAt: Date.now(),
      },
    });
  },

  setPlayhead: (sec) => set({ playheadSec: Math.max(0, sec) }),
  setPlaying: (playing) => set({ isPlaying: playing }),
  setZoom: (pps) => set({ pixelsPerSecond: Math.max(10, Math.min(800, pps)) }),

  pushHistory: () => {
    const { project, history, historyIndex } = get();
    if (!project) return;
    const entry: HistoryEntry = {
      clips: structuredClone(project.clips),
      tracks: structuredClone(project.tracks),
      assets: structuredClone(project.assets),
    };
    const truncated = history.slice(0, historyIndex + 1);
    const next = [...truncated, entry].slice(-50);
    set({ history: next, historyIndex: next.length - 1 });
  },

  undo: () => {
    const { project, history, historyIndex } = get();
    if (!project || historyIndex <= 0) return;
    const target = history[historyIndex - 1];
    set({
      project: { ...project, ...target, updatedAt: Date.now() },
      historyIndex: historyIndex - 1,
    });
  },

  redo: () => {
    const { project, history, historyIndex } = get();
    if (!project || historyIndex >= history.length - 1) return;
    const target = history[historyIndex + 1];
    set({
      project: { ...project, ...target, updatedAt: Date.now() },
      historyIndex: historyIndex + 1,
    });
  },

  totalDurationSec: () => {
    const project = get().project;
    if (!project) return 0;
    return project.clips.reduce((m, c) => Math.max(m, c.startSec + c.durationSec), 0);
  },
}));
