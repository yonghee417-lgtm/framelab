import { useEffect, useMemo, useRef, useState } from 'react';
import { useProjectStore } from '../store/projectStore';
import type { AnyClip, MediaClip, TextClip, Track } from '@shared/types';
import { ConfirmDialog } from './ConfirmDialog';

const TRACK_HEIGHT = 52;
const RULER_HEIGHT = 28;
const HEADER_WIDTH_DEFAULT = 160;
const HEADER_WIDTH_MIN = 80;
const HEADER_WIDTH_MAX = 480;
const HEADER_WIDTH_STORAGE_KEY = 'framelab.headerWidth';

// 자석 효과: 8픽셀 이내면 스냅
const SNAP_PIXELS = 8;

// 드래그 종류 식별자
const TRACK_DRAG_TYPE = 'application/x-framelab-track';
const ASSET_DRAG_TYPE = 'application/x-framelab-asset';
const ASSETS_BULK_TYPE = 'application/x-framelab-assets';
const FOLDER_DRAG_TYPE = 'application/x-framelab-folder';

function snap(targetSec: number, candidates: number[], pps: number): { value: number; snapped: boolean } {
  const threshold = SNAP_PIXELS / pps;
  let best = targetSec;
  let bestDist = threshold;
  for (const c of candidates) {
    const d = Math.abs(c - targetSec);
    if (d <= bestDist) {
      best = c;
      bestDist = d;
    }
  }
  return { value: best, snapped: best !== targetSec };
}

export function Timeline() {
  const project = useProjectStore((s) => s.project);
  const playhead = useProjectStore((s) => s.playheadSec);
  const setPlayhead = useProjectStore((s) => s.setPlayhead);
  const pps = useProjectStore((s) => s.pixelsPerSecond);
  const setZoom = useProjectStore((s) => s.setZoom);
  const totalDuration = useProjectStore((s) => s.totalDurationSec());
  const selectedClipId = useProjectStore((s) => s.selectedClipId);
  const selectedClipIds = useProjectStore((s) => s.selectedClipIds);
  const selectClip = useProjectStore((s) => s.selectClip);
  const selectClips = useProjectStore((s) => s.selectClips);
  const updateClip = useProjectStore((s) => s.updateClip);
  const splitClip = useProjectStore((s) => s.splitClipAtPlayhead);
  const removeClip = useProjectStore((s) => s.removeClip);
  const pushHistory = useProjectStore((s) => s.pushHistory);
  const addTrack = useProjectStore((s) => s.addTrack);
  const removeTrack = useProjectStore((s) => s.removeTrack);
  const reorderTrack = useProjectStore((s) => s.reorderTrack);
  const renameTrack = useProjectStore((s) => s.renameTrack);
  const toggleTrackHidden = useProjectStore((s) => s.toggleTrackHidden);
  const toggleTrackLocked = useProjectStore((s) => s.toggleTrackLocked);
  const selectedTrackId = useProjectStore((s) => s.selectedTrackId);
  const selectTrack = useProjectStore((s) => s.selectTrack);
  const moveClipToTrack = useProjectStore((s) => s.moveClipToTrack);
  const addClipsFromAssets = useProjectStore((s) => s.addClipsFromAssets);
  const [pendingDeleteTrackId, setPendingDeleteTrackId] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);

  // 트랙 헤더 컬럼 너비 (드래그로 조절 + localStorage 저장)
  const [headerWidth, setHeaderWidth] = useState<number>(() => {
    const saved = parseInt(localStorage.getItem(HEADER_WIDTH_STORAGE_KEY) ?? '', 10);
    return Number.isFinite(saved) && saved >= HEADER_WIDTH_MIN && saved <= HEADER_WIDTH_MAX
      ? saved
      : HEADER_WIDTH_DEFAULT;
  });
  const [resizing, setResizing] = useState(false);
  useEffect(() => {
    localStorage.setItem(HEADER_WIDTH_STORAGE_KEY, String(headerWidth));
  }, [headerWidth]);
  useEffect(() => {
    if (!resizing) return;
    const onMove = (e: MouseEvent) => {
      const el = scrollRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      setHeaderWidth(Math.max(HEADER_WIDTH_MIN, Math.min(HEADER_WIDTH_MAX, x)));
    };
    const onUp = () => setResizing(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [resizing]);

  const tracksOrdered = useMemo(() => {
    if (!project) return [];
    return [...project.tracks].sort((a, b) => a.index - b.index);
  }, [project]);

  // ───── 박스(영역) 선택 ─────
  const [selBox, setSelBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const selStartRef = useRef<{ clientX: number; clientY: number } | null>(null);

  const handleScrollMouseDown = (e: React.MouseEvent) => {
    // 자식 (클립, 트랙 헤더, 룰러)의 onMouseDown은 stopPropagation 되어 있음
    // 여기 도달했다는 건 빈 영역에서 mousedown
    if (e.button !== 0) return;
    const sc = scrollRef.current;
    if (!sc) return;
    const rect = sc.getBoundingClientRect();
    const localX = e.clientX - rect.left + sc.scrollLeft;
    const localY = e.clientY - rect.top + sc.scrollTop;
    if (localX < headerWidth) return; // 트랙 헤더 영역 무시
    if (localY < RULER_HEIGHT) return; // 룰러 영역은 시간 점프 전용
    selStartRef.current = { clientX: e.clientX, clientY: e.clientY };
    setSelBox({ x: e.clientX, y: e.clientY, w: 0, h: 0 });
    e.preventDefault();
  };

  useEffect(() => {
    if (!selBox) return;
    const onMove = (e: MouseEvent) => {
      const start = selStartRef.current;
      if (!start) return;
      setSelBox({
        x: Math.min(start.clientX, e.clientX),
        y: Math.min(start.clientY, e.clientY),
        w: Math.abs(e.clientX - start.clientX),
        h: Math.abs(e.clientY - start.clientY),
      });
    };
    const onUp = (e: MouseEvent) => {
      const start = selStartRef.current;
      const sc = scrollRef.current;
      if (!start || !sc || !project) {
        setSelBox(null);
        selStartRef.current = null;
        return;
      }
      const moveDist = Math.abs(e.clientX - start.clientX) + Math.abs(e.clientY - start.clientY);
      if (moveDist < 5) {
        // 작은 이동 = 클릭으로 간주, 선택 해제
        selectClip(null);
      } else {
        // 박스를 컨텐츠 좌표(스크롤 포함)로 변환
        const rect = sc.getBoundingClientRect();
        const x1c = Math.min(start.clientX, e.clientX) - rect.left + sc.scrollLeft;
        const x2c = Math.max(start.clientX, e.clientX) - rect.left + sc.scrollLeft;
        const y1c = Math.min(start.clientY, e.clientY) - rect.top + sc.scrollTop;
        const y2c = Math.max(start.clientY, e.clientY) - rect.top + sc.scrollTop;

        // 시간 범위 (헤더 너비 빼기)
        const timeStart = Math.max(0, (x1c - headerWidth) / pps);
        const timeEnd = (x2c - headerWidth) / pps;

        // 트랙 인덱스 범위 (룰러 다음 TRACK_HEIGHT씩)
        const idxFrom = Math.max(0, Math.floor((y1c - RULER_HEIGHT) / TRACK_HEIGHT));
        const idxTo = Math.min(
          tracksOrdered.length - 1,
          Math.floor((y2c - RULER_HEIGHT) / TRACK_HEIGHT),
        );
        const trackIdsInBox = new Set(
          tracksOrdered.slice(idxFrom, idxTo + 1).map((t) => t.id),
        );

        const ids = project.clips
          .filter(
            (c) =>
              trackIdsInBox.has(c.trackId) &&
              c.startSec < timeEnd &&
              c.startSec + c.durationSec > timeStart,
          )
          .map((c) => c.id);

        selectClips(ids);
      }
      setSelBox(null);
      selStartRef.current = null;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selBox !== null, project, pps, headerWidth, tracksOrdered]);

  const timelineDuration = Math.max(30, totalDuration + 10);
  const timelineWidth = timelineDuration * pps;

  // 휠 동작: 기본 = 세로, Shift = 가로, Ctrl = 줌
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const factor = e.deltaY > 0 ? 1 / 1.2 : 1.2;
        const currentPPS = useProjectStore.getState().pixelsPerSecond;
        useProjectStore.getState().setZoom(currentPPS * factor);
      } else if (e.shiftKey) {
        e.preventDefault();
        el.scrollLeft += e.deltaY;
      } else {
        // 기본 휠 = 세로 스크롤 (브라우저 기본 동작이 이미 그러함)
        // 다만 트랙패드 등에서 deltaX가 있으면 가로도 처리
        if (Math.abs(e.deltaX) > 0) {
          el.scrollLeft += e.deltaX;
        }
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const handleRulerClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left + (scrollRef.current?.scrollLeft ?? 0);
    setPlayhead(Math.max(0, x / pps));
  };

  if (!project) return null;

  // 트랙 종류별 그룹 (UI 표시용)
  const textTracks = tracksOrdered.filter((t) => t.kind === 'text');
  const videoTracks = tracksOrdered.filter((t) => t.kind === 'video');
  const audioTracks = tracksOrdered.filter((t) => t.kind === 'audio');

  return (
    <>
      {/* 타임라인 헤더 */}
      <div className="h-9 flex items-center px-3 gap-2 border-b border-border-subtle bg-bg-panel flex-shrink-0">
        <span className="text-xs text-text-muted">타임라인</span>
        <span className="text-[10px] text-text-muted">휠=세로 · Shift+휠=가로 · Ctrl+휠=줌</span>
        <div className="flex-1" />
        <button onClick={splitClip} className="btn-ghost text-xs" title="컷 (Ctrl+B)">✂ 컷</button>
        {selectedClipId && (
          <button onClick={() => removeClip(selectedClipId)} className="btn-ghost text-xs text-red-400">
            삭제
          </button>
        )}
        <div className="w-px h-5 bg-border-subtle mx-1" />
        <button onClick={() => setZoom(pps / 1.5)} className="btn-ghost text-xs" title="축소">−</button>
        <span className="text-xs text-text-muted w-16 text-center">{Math.round(pps)}px/s</span>
        <button onClick={() => setZoom(pps * 1.5)} className="btn-ghost text-xs" title="확대">+</button>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 overflow-auto relative"
        onMouseDown={handleScrollMouseDown}
      >
        <div className="flex" style={{ width: headerWidth + timelineWidth }}>
          {/* 왼쪽 트랙 헤더 */}
          <div
            className="sticky left-0 z-20 bg-bg-panel border-r border-border-subtle flex-shrink-0 relative"
            style={{ width: headerWidth }}
          >
            <div style={{ height: RULER_HEIGHT }} className="border-b border-border-subtle bg-bg-surface flex items-center px-2">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  // 종류별 + 버튼 메뉴를 ruler 헤더에 둠
                }}
                className="text-[10px] text-text-muted"
              >
                트랙
              </button>
            </div>
            {tracksOrdered.map((track) => (
              <TrackHeader
                key={track.id}
                track={track}
                selected={selectedTrackId === track.id}
                onSelect={() => selectTrack(track.id)}
                onRename={(name) => renameTrack(track.id, name)}
                onToggleHidden={() => toggleTrackHidden(track.id)}
                onToggleLocked={() => toggleTrackLocked(track.id)}
                onRequestRemove={() => setPendingDeleteTrackId(track.id)}
                onReorderBefore={(draggedId) => reorderTrack(draggedId, track.id)}
                canRemove={
                  track.kind === 'text'
                    ? textTracks.length > 1
                    : track.kind === 'video'
                    ? videoTracks.length > 1
                    : audioTracks.length > 1
                }
              />
            ))}
            <div className="p-2 flex flex-col gap-1 border-t border-border-subtle">
              <button onClick={() => addTrack('text')} className="btn-ghost text-xs justify-start">+ 자막 트랙</button>
              <button onClick={() => addTrack('video')} className="btn-ghost text-xs justify-start">+ 영상 트랙</button>
              <button onClick={() => addTrack('audio')} className="btn-ghost text-xs justify-start">+ 오디오 트랙</button>
            </div>
            {/* 헤더 너비 조절 핸들 */}
            <div
              className={`absolute top-0 -right-1 w-2 h-full cursor-col-resize z-30 group ${resizing ? '' : 'hover:bg-accent/30'}`}
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setResizing(true);
              }}
              onDoubleClick={() => setHeaderWidth(HEADER_WIDTH_DEFAULT)}
              title="드래그로 너비 조절 · 더블클릭으로 기본값"
            >
              <div
                className={`absolute top-0 right-0 bottom-0 w-px ${resizing ? 'bg-accent' : 'bg-transparent group-hover:bg-accent'}`}
              />
            </div>
          </div>

          {/* 오른쪽 타임라인 본체 */}
          <div className="flex-1 relative" style={{ width: timelineWidth }}>
            {/* 룰러 */}
            <Ruler
              durationSec={timelineDuration}
              pps={pps}
              onClick={handleRulerClick}
              height={RULER_HEIGHT}
            />

            {/* 트랙들 */}
            {tracksOrdered.map((track) => (
              <TrackLane
                key={track.id}
                track={track}
                clips={project.clips.filter((c) => c.trackId === track.id)}
                allTracks={tracksOrdered}
                allAssets={project.assets}
                pps={pps}
                durationSec={timelineDuration}
                selectedClipIds={selectedClipIds}
                onSelectClip={selectClip}
                onUpdateClip={updateClip}
                onPushHistory={pushHistory}
                onMoveClipToTrack={moveClipToTrack}
                onDropAssets={(assets, atSec) =>
                  addClipsFromAssets(assets, atSec, track.id)
                }
              />
            ))}

            {/* 플레이헤드 */}
            <div
              className="absolute top-0 bottom-0 w-px bg-accent pointer-events-none z-10"
              style={{ left: playhead * pps }}
            >
              <div className="absolute -top-0.5 -left-1.5 w-3 h-3 bg-accent rotate-45" />
            </div>
          </div>
        </div>
      </div>

      {/* 박스 선택 시각화 (viewport 기준 fixed) */}
      {selBox && (selBox.w > 2 || selBox.h > 2) && (
        <div
          className="fixed border border-accent bg-accent/15 pointer-events-none z-[60]"
          style={{
            left: selBox.x,
            top: selBox.y,
            width: selBox.w,
            height: selBox.h,
          }}
        />
      )}

      {pendingDeleteTrackId && (() => {
        const target = project.tracks.find((t) => t.id === pendingDeleteTrackId);
        if (!target) return null;
        const clipCount = project.clips.filter((c) => c.trackId === pendingDeleteTrackId).length;
        const kindLabel = target.kind === 'video' ? '영상' : target.kind === 'audio' ? '오디오' : '자막';
        const name = target.name || kindLabel;
        return (
          <ConfirmDialog
            title="트랙 삭제 확인"
            danger
            message={
              <>
                선택한 트랙 <strong className="text-text-primary">"{name}"</strong> 을(를) 삭제하시겠습니까?
                {clipCount > 0 && (
                  <div className="mt-2 text-yellow-400">
                    ⚠ 이 트랙에 있는 클립 <strong>{clipCount}개</strong>가 함께 삭제됩니다.
                  </div>
                )}
                <div className="mt-2 text-text-muted text-xs">실수했더라도 Ctrl+Z 로 되돌릴 수 있습니다.</div>
              </>
            }
            confirmLabel="삭제"
            cancelLabel="취소"
            onConfirm={() => {
              removeTrack(pendingDeleteTrackId);
              setPendingDeleteTrackId(null);
            }}
            onCancel={() => setPendingDeleteTrackId(null)}
          />
        );
      })()}
    </>
  );
}

function TrackHeader({
  track,
  selected,
  onSelect,
  onRename,
  onToggleHidden,
  onToggleLocked,
  onRequestRemove,
  onReorderBefore,
  canRemove,
}: {
  track: Track;
  selected: boolean;
  onSelect: () => void;
  onRename: (name: string) => void;
  onToggleHidden: () => void;
  onToggleLocked: () => void;
  onRequestRemove: () => void;
  onReorderBefore: (draggedTrackId: string) => void;
  canRemove: boolean;
}) {
  const defaultLabel =
    track.kind === 'video' ? '영상' : track.kind === 'audio' ? '오디오' : '자막';
  const icon = track.kind === 'video' ? '🎬' : track.kind === 'audio' ? '🎵' : 'T';
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(track.name ?? '');
  const [dragOver, setDragOver] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const startEdit = () => {
    setDraft(track.name ?? '');
    setEditing(true);
  };

  const isAcceptableTrackDrag = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(TRACK_DRAG_TYPE)) return false;
    // dataTransfer.getData는 onDrop에서만 동작 — types 만으로 일단 허용
    return true;
  };

  return (
    <div
      draggable={!editing}
      onDragStart={(e) => {
        e.dataTransfer.setData(TRACK_DRAG_TYPE, track.id);
        e.dataTransfer.setData('framelab-track-kind', track.kind);
        e.dataTransfer.effectAllowed = 'move';
        setIsDragging(true);
      }}
      onDragEnd={() => setIsDragging(false)}
      onDragOver={(e) => {
        if (isAcceptableTrackDrag(e)) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          setDragOver(true);
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        const draggedId = e.dataTransfer.getData(TRACK_DRAG_TYPE);
        const draggedKind = e.dataTransfer.getData('framelab-track-kind');
        setDragOver(false);
        if (!draggedId || draggedId === track.id) return;
        if (draggedKind && draggedKind !== track.kind) return;
        e.preventDefault();
        onReorderBefore(draggedId);
      }}
      onClick={(e) => {
        if (editing) return;
        // 빈 영역(라벨/아이콘) 클릭 시 선택 토글, 버튼 클릭은 자체 stopPropagation
        const target = e.target as HTMLElement;
        if (target.closest('button')) return;
        onSelect();
      }}
      className={`group flex items-center px-2 gap-1 border-b border-border-subtle cursor-pointer
        ${selected ? 'bg-accent/15 ring-1 ring-accent ring-inset' : 'bg-bg-panel hover:bg-bg-hover'}
        ${isDragging ? 'opacity-50' : ''}
        ${dragOver ? 'border-t-2 border-t-accent' : ''}
      `}
      style={{ height: TRACK_HEIGHT }}
      title={selected ? '클릭하여 선택 해제' : '클릭하여 이 트랙 선택 (소스 추가 시 사용됨) · 헤더를 잡고 드래그하면 순서 변경'}
    >
      <span className="flex-shrink-0 text-text-muted text-xs select-none" title="드래그로 순서 변경">⋮⋮</span>
      <span className="flex-shrink-0 text-sm">{icon}</span>
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onBlur={() => {
            onRename(draft);
            setEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') {
              setDraft(track.name ?? '');
              setEditing(false);
            }
          }}
          placeholder={defaultLabel}
          className="input flex-1 text-xs py-0.5 px-1.5 min-w-0"
        />
      ) : (
        <span
          className={`text-xs font-medium flex-1 truncate select-none ${selected ? 'text-text-primary' : 'text-text-secondary'}`}
          onDoubleClick={(e) => {
            e.stopPropagation();
            startEdit();
          }}
          title="더블클릭으로 이름 변경"
        >
          {track.name || defaultLabel}
        </span>
      )}
      {/* 항상 표시: 숨기기 / 잠금 (활성 시 강조) */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onToggleHidden();
        }}
        className={`px-1 text-sm ${track.hidden ? 'text-yellow-400' : 'text-text-muted hover:text-text-primary'}`}
        title={track.hidden ? '숨김 해제' : '트랙 숨기기 (미리보기/내보내기에서 제외)'}
      >
        {track.hidden ? '🙈' : '👁'}
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onToggleLocked();
        }}
        className={`px-1 text-sm ${track.locked ? 'text-yellow-400' : 'text-text-muted hover:text-text-primary'}`}
        title={track.locked ? '잠금 해제' : '트랙 잠금 (편집 차단)'}
      >
        {track.locked ? '🔒' : '🔓'}
      </button>
      {/* 호버 시 표시: 이름변경 / 삭제 */}
      <div className="opacity-0 group-hover:opacity-100 flex gap-0.5 transition-opacity">
        {!editing && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              startEdit();
            }}
            className="text-text-muted hover:text-accent px-1"
            title="이름 변경"
          >
            ✏
          </button>
        )}
        {canRemove && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRequestRemove();
            }}
            className="text-text-muted hover:text-red-400 px-1"
            title="삭제"
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}

function Ruler({
  durationSec,
  pps,
  onClick,
  height,
}: {
  durationSec: number;
  pps: number;
  onClick: (e: React.MouseEvent<HTMLDivElement>) => void;
  height: number;
}) {
  // 줌 레벨에 따라 적절한 시간 단위를 자동 선택
  // 라벨 사이 최소 80px 확보
  const minSpacingPx = 80;
  const candidates = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  let step = candidates[candidates.length - 1];
  for (const c of candidates) {
    if (c * pps >= minSpacingPx) {
      step = c;
      break;
    }
  }

  const ticks: number[] = [];
  for (let t = 0; t <= durationSec + step; t += step) ticks.push(t);

  return (
    <div
      className="sticky top-0 z-10 bg-bg-surface border-b border-border-subtle cursor-pointer"
      style={{ height }}
      onClick={onClick}
    >
      {ticks.map((t) => (
        <div key={t} className="absolute top-0 bottom-0 flex items-end pb-1" style={{ left: t * pps }}>
          <div className="absolute top-0 left-0 w-px h-2 bg-border-strong" />
          <span className="text-[10px] text-text-muted ml-1 select-none">{formatRulerTime(t, step)}</span>
        </div>
      ))}
    </div>
  );
}

function formatRulerTime(sec: number, step: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (step < 1) {
    return `${m}:${s.toFixed(1).padStart(4, '0')}`;
  }
  return `${m}:${Math.floor(s).toString().padStart(2, '0')}`;
}

function TrackLane({
  track,
  clips,
  allTracks,
  allAssets,
  pps,
  durationSec,
  selectedClipIds,
  onSelectClip,
  onUpdateClip,
  onPushHistory,
  onMoveClipToTrack,
  onDropAssets,
}: {
  track: Track;
  clips: AnyClip[];
  allTracks: Track[];
  allAssets: import('@shared/types').MediaAsset[];
  pps: number;
  durationSec: number;
  selectedClipIds: string[];
  onSelectClip: (id: string | null, mode?: 'replace' | 'toggle' | 'range') => void;
  onUpdateClip: (id: string, patch: Partial<AnyClip>) => void;
  onPushHistory: () => void;
  onMoveClipToTrack: (clipId: string, trackId: string) => void;
  onDropAssets: (assets: import('@shared/types').MediaAsset[], atSec?: number) => void;
}) {
  const [dragOver, setDragOver] = useState(false);

  const expectedTrackKind = (kind: import('@shared/types').MediaKind): Track['kind'] =>
    kind === 'audio' ? 'audio' : 'video';

  // 드롭 가능한지 확인 — track.kind와 자산 종류가 맞아야
  const canAcceptAssets = (assetIds: string[]): boolean => {
    if (track.kind === 'text') return false;
    return assetIds.every((id) => {
      const a = allAssets.find((x) => x.id === id);
      return a && expectedTrackKind(a.kind) === track.kind;
    });
  };

  const onDragOver = (e: React.DragEvent) => {
    if (track.locked) return; // 잠긴 트랙엔 드롭 불가
    if (
      e.dataTransfer.types.includes(ASSET_DRAG_TYPE) ||
      e.dataTransfer.types.includes(ASSETS_BULK_TYPE) ||
      e.dataTransfer.types.includes(FOLDER_DRAG_TYPE)
    ) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setDragOver(true);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const atSec = Math.max(0, x / pps);

    // 단일 자산
    const single = e.dataTransfer.getData(ASSET_DRAG_TYPE);
    let assetIds: string[] = [];
    if (single) assetIds = [single];

    // 다중 자산
    const bulk = e.dataTransfer.getData(ASSETS_BULK_TYPE);
    if (bulk) {
      try {
        assetIds = JSON.parse(bulk);
      } catch {}
    }

    // 폴더
    const folderId = e.dataTransfer.getData(FOLDER_DRAG_TYPE);
    if (folderId) {
      assetIds = allAssets.filter((a) => a.folderId === folderId).map((a) => a.id);
    }

    if (assetIds.length === 0) return;
    if (!canAcceptAssets(assetIds)) {
      // 종류 안 맞으면 알림 없이 무시 (또는 향후 토스트)
      return;
    }
    const assetsToAdd = assetIds
      .map((id) => allAssets.find((a) => a.id === id))
      .filter((a): a is import('@shared/types').MediaAsset => !!a);
    onDropAssets(assetsToAdd, atSec);
  };

  return (
    <div
      className={`relative border-b border-border-subtle ${dragOver ? 'bg-accent/15 ring-1 ring-accent ring-inset' : 'bg-bg-base/30'}`}
      style={{ height: TRACK_HEIGHT, width: durationSec * pps }}
      onDragOver={onDragOver}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      {clips.map((clip) => (
        <ClipBlock
          key={clip.id}
          clip={clip}
          pps={pps}
          selected={selectedClipIds.includes(clip.id)}
          onSelect={(mode) => onSelectClip(clip.id, mode)}
          onUpdate={onUpdateClip}
          onPushHistory={onPushHistory}
          trackKind={track.kind}
          trackLocked={!!track.locked}
          allTracks={allTracks}
          onMoveTrack={onMoveClipToTrack}
        />
      ))}
    </div>
  );
}

function ClipBlock({
  clip,
  pps,
  selected,
  onSelect,
  onUpdate,
  onPushHistory,
  trackKind,
  trackLocked,
  allTracks,
  onMoveTrack,
}: {
  clip: AnyClip;
  pps: number;
  selected: boolean;
  onSelect: (mode?: 'replace' | 'toggle' | 'range') => void;
  onUpdate: (id: string, patch: Partial<AnyClip>) => void;
  onPushHistory: () => void;
  trackKind: Track['kind'];
  trackLocked: boolean;
  allTracks: Track[];
  onMoveTrack: (clipId: string, trackId: string) => void;
}) {
  const [dragging, setDragging] = useState<null | 'move' | 'left' | 'right'>(null);
  const [snapIndicator, setSnapIndicator] = useState<'left' | 'right' | null>(null);
  const startState = useRef<{
    mouseX: number;
    mouseY: number;
    startSec: number;
    durationSec: number;
    inSec: number;
    outSec: number;
    startTrackId: string; // 시작 트랙 ID — 절대 위치 기반 트랙 인덱싱용
  } | null>(null);

  const color = trackKind === 'video' ? 'bg-track-video' : trackKind === 'audio' ? 'bg-track-audio' : 'bg-track-text';

  const onMouseDown = (e: React.MouseEvent, mode: 'move' | 'left' | 'right') => {
    e.stopPropagation();
    // Shift = 범위 선택 (앵커~현재까지 모두), Ctrl = 토글, 일반 = 교체
    const selectMode: 'replace' | 'toggle' | 'range' = e.shiftKey
      ? 'range'
      : e.ctrlKey || e.metaKey
      ? 'toggle'
      : 'replace';
    onSelect(selectMode);
    if (trackLocked) return; // 잠긴 트랙은 드래그 불가, 선택은 가능
    onPushHistory();
    setDragging(mode);
    startState.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      startSec: clip.startSec,
      durationSec: clip.durationSec,
      inSec: clip.inSec,
      outSec: clip.outSec,
      startTrackId: clip.trackId,
    };
  };

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const start = startState.current;
      if (!start) return;
      const deltaSec = (e.clientX - start.mouseX) / pps;

      const state = useProjectStore.getState();
      const project = state.project;
      const candidates: number[] = [0, state.playheadSec];
      if (project) {
        for (const c of project.clips) {
          if (c.id === clip.id) continue;
          candidates.push(c.startSec);
          candidates.push(c.startSec + c.durationSec);
        }
      }

      const useSnap = !e.shiftKey;
      let leftSnapped = false;
      let rightSnapped = false;

      if (dragging === 'move') {
        const rawStart = Math.max(0, start.startSec + deltaSec);
        const rawEnd = rawStart + start.durationSec;
        let finalStart = rawStart;
        if (useSnap) {
          const snapStart = snap(rawStart, candidates, pps);
          const snapEnd = snap(rawEnd, candidates, pps);
          const startDist = Math.abs(snapStart.value - rawStart);
          const endDist = Math.abs(snapEnd.value - rawEnd);
          if (snapStart.snapped && (!snapEnd.snapped || startDist <= endDist)) {
            finalStart = snapStart.value;
            leftSnapped = true;
          } else if (snapEnd.snapped) {
            finalStart = snapEnd.value - start.durationSec;
            rightSnapped = true;
          }
        }
        onUpdate(clip.id, { startSec: Math.max(0, finalStart) });

        // 트랙 변경 — 시작 위치(start.mouseY) 기준 절대 거리로 계산
        // mouseY를 갱신하지 않으므로 마우스가 멀리 가도 끊김 없이 따라감
        const deltaY = e.clientY - start.mouseY;
        const trackDelta = Math.round(deltaY / TRACK_HEIGHT);
        const sameKind = allTracks.filter((t) => t.kind === trackKind).sort((a, b) => a.index - b.index);
        const startTrackIdx = sameKind.findIndex((t) => t.id === start.startTrackId);
        if (startTrackIdx >= 0) {
          const desiredIdx = Math.max(0, Math.min(sameKind.length - 1, startTrackIdx + trackDelta));
          const targetTrack = sameKind[desiredIdx];
          if (targetTrack && targetTrack.id !== clip.trackId) {
            onMoveTrack(clip.id, targetTrack.id);
          }
        }
      } else if (dragging === 'left') {
        let newStart = Math.max(0, start.startSec + deltaSec);
        if (useSnap) {
          const snapped = snap(newStart, candidates, pps);
          if (snapped.snapped) {
            leftSnapped = true;
            newStart = snapped.value;
          }
        }
        const realDelta = newStart - start.startSec;
        const newDuration = Math.max(0.1, start.durationSec - realDelta);
        const newIn = Math.max(0, start.inSec + realDelta);
        onUpdate(clip.id, { startSec: newStart, durationSec: newDuration, inSec: newIn });
      } else if (dragging === 'right') {
        let newEnd = start.startSec + start.durationSec + deltaSec;
        if (useSnap) {
          const snapped = snap(newEnd, candidates, pps);
          if (snapped.snapped) {
            rightSnapped = true;
            newEnd = snapped.value;
          }
        }
        const newDuration = Math.max(0.1, newEnd - start.startSec);
        const realDelta = newDuration - start.durationSec;
        const newOut = start.outSec + realDelta;
        onUpdate(clip.id, { durationSec: newDuration, outSec: newOut });
      }

      setSnapIndicator(leftSnapped ? 'left' : rightSnapped ? 'right' : null);
    };
    const onUp = () => {
      // 드래그 종료 시 충돌 해결 — 다른 클립과 겹치면 가까운 빈 자리로 자동 이동
      useProjectStore.getState().resolveClipCollision(clip.id);
      setDragging(null);
      setSnapIndicator(null);
      startState.current = null;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragging, clip.id, clip.trackId, pps, onUpdate, allTracks, trackKind, onMoveTrack]);

  // 라벨: 자막은 텍스트, 미디어는 자산 파일명 표시
  const project = useProjectStore((s) => s.project);
  const asset = useMemo(() => {
    if (clip.kind === 'text') return null;
    return project?.assets.find((a) => a.id === (clip as MediaClip).assetId) ?? null;
  }, [project, clip]);
  const fileName = asset?.fileName ?? null;
  // 오디오 클립이거나 오디오 있는 비디오 클립이면 waveform 배경
  const waveformUrl =
    asset?.waveformPath && (clip.kind === 'audio' || (clip.kind === 'video' && asset.hasAudio))
      ? window.api.toMediaUrl(asset.waveformPath)
      : null;

  const icon =
    clip.kind === 'text'
      ? 'T'
      : clip.kind === 'video'
      ? '🎬'
      : clip.kind === 'image'
      ? '🖼'
      : '🎵';
  const labelText =
    clip.kind === 'text'
      ? (clip as TextClip).text || '자막'
      : fileName ?? clip.kind;

  return (
    <div
      className={`absolute top-1 bottom-1 ${color}/80 hover:${color} rounded
        ${trackLocked ? 'cursor-not-allowed opacity-70' : 'cursor-grab active:cursor-grabbing'}
        ${selected ? 'ring-2 ring-white' : 'ring-1 ring-black/30'}
        flex items-center px-2 overflow-hidden group transition-shadow`}
      style={{
        left: clip.startSec * pps,
        width: clip.durationSec * pps,
      }}
      onMouseDown={(e) => onMouseDown(e, 'move')}
      onClick={(e) => e.stopPropagation()}
      title={trackLocked ? '잠긴 트랙 — 잠금을 해제해야 편집할 수 있습니다' : undefined}
    >
      {waveformUrl && (
        <img
          src={waveformUrl}
          className="absolute inset-0 w-full h-full object-fill opacity-40 pointer-events-none"
          alt=""
          draggable={false}
        />
      )}
      {!trackLocked && (
        <div
          className="absolute left-0 top-0 bottom-0 w-1.5 cursor-ew-resize bg-black/40 hover:bg-white/60 z-10"
          onMouseDown={(e) => onMouseDown(e, 'left')}
        />
      )}
      <span className="text-xs text-white font-medium truncate select-none pl-2 pr-2 flex items-center gap-1">
        <span className="flex-shrink-0">{icon}</span>
        <span className="truncate">{labelText}</span>
      </span>
      {!trackLocked && (
        <div
          className="absolute right-0 top-0 bottom-0 w-1.5 cursor-ew-resize bg-black/40 hover:bg-white/60 z-10"
          onMouseDown={(e) => onMouseDown(e, 'right')}
        />
      )}
      {snapIndicator === 'left' && (
        <div className="absolute -left-px top-0 bottom-0 w-0.5 bg-yellow-300 shadow-[0_0_8px_2px_rgba(253,224,71,0.9)] pointer-events-none z-20" />
      )}
      {snapIndicator === 'right' && (
        <div className="absolute -right-px top-0 bottom-0 w-0.5 bg-yellow-300 shadow-[0_0_8px_2px_rgba(253,224,71,0.9)] pointer-events-none z-20" />
      )}
      {clip.kind !== 'text' && (clip as MediaClip).fadeInSec > 0 && (
        <div
          className="absolute left-0 top-0 bottom-0 bg-gradient-to-r from-black/60 to-transparent pointer-events-none"
          style={{ width: (clip as MediaClip).fadeInSec * pps }}
        />
      )}
      {clip.kind !== 'text' && (clip as MediaClip).fadeOutSec > 0 && (
        <div
          className="absolute right-0 top-0 bottom-0 bg-gradient-to-l from-black/60 to-transparent pointer-events-none"
          style={{ width: (clip as MediaClip).fadeOutSec * pps }}
        />
      )}
    </div>
  );
}
