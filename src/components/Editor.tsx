import { useEffect, useState } from 'react';
import { useProjectStore } from '../store/projectStore';
import { TopBar } from './TopBar';
import { MediaLibrary } from './MediaLibrary';
import { Preview } from './Preview';
import { Inspector } from './Inspector';
import { Timeline } from './Timeline';

// 사이드바 너비 (드래그 조절 + localStorage 저장)
const LEFT_DEFAULT = 256;
const RIGHT_DEFAULT = 320;
const SIDE_MIN = 180;
const SIDE_MAX = 600;
const LEFT_KEY = 'framelab.leftWidth';
const RIGHT_KEY = 'framelab.rightWidth';

function loadWidth(key: string, fallback: number): number {
  const v = parseInt(localStorage.getItem(key) ?? '', 10);
  return Number.isFinite(v) && v >= SIDE_MIN && v <= SIDE_MAX ? v : fallback;
}

export function Editor() {
  const undo = useProjectStore((s) => s.undo);
  const redo = useProjectStore((s) => s.redo);
  const split = useProjectStore((s) => s.splitClipAtPlayhead);
  const removeClip = useProjectStore((s) => s.removeClip);
  const removeClips = useProjectStore((s) => s.removeClips);
  const selectedClipId = useProjectStore((s) => s.selectedClipId);
  const selectedClipIds = useProjectStore((s) => s.selectedClipIds);
  const setPlaying = useProjectStore((s) => s.setPlaying);
  const isPlaying = useProjectStore((s) => s.isPlaying);
  const copyClip = useProjectStore((s) => s.copySelectedClip);
  const pasteClip = useProjectStore((s) => s.pasteClip);
  const duplicateClip = useProjectStore((s) => s.duplicateSelectedClip);
  const setPlayhead = useProjectStore((s) => s.setPlayhead);
  const updateClip = useProjectStore((s) => s.updateClip);

  // 사이드바 너비
  const [leftWidth, setLeftWidth] = useState(() => loadWidth(LEFT_KEY, LEFT_DEFAULT));
  const [rightWidth, setRightWidth] = useState(() => loadWidth(RIGHT_KEY, RIGHT_DEFAULT));
  const [resizing, setResizing] = useState<null | 'left' | 'right'>(null);
  useEffect(() => {
    localStorage.setItem(LEFT_KEY, String(leftWidth));
  }, [leftWidth]);
  useEffect(() => {
    localStorage.setItem(RIGHT_KEY, String(rightWidth));
  }, [rightWidth]);
  useEffect(() => {
    if (!resizing) return;
    const onMove = (e: MouseEvent) => {
      if (resizing === 'left') {
        setLeftWidth(Math.max(SIDE_MIN, Math.min(SIDE_MAX, e.clientX)));
      } else {
        // 우측: 화면 우측 끝에서 mouseX까지의 거리
        const w = Math.max(SIDE_MIN, Math.min(SIDE_MAX, window.innerWidth - e.clientX));
        setRightWidth(w);
      }
    };
    const onUp = () => setResizing(null);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [resizing]);

  // 단축키
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isEditingText =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable;
      if (isEditingText) return;

      const ctrl = e.ctrlKey || e.metaKey;
      const project = useProjectStore.getState().project;
      const playhead = useProjectStore.getState().playheadSec;
      const fps = project?.settings.fps ?? 30;
      const frameStep = 1 / fps;

      if (ctrl && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (ctrl && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) {
        e.preventDefault();
        redo();
      } else if (ctrl && e.key === 'b') {
        e.preventDefault();
        split();
      } else if (ctrl && e.key === 'c') {
        e.preventDefault();
        copyClip();
      } else if (ctrl && e.key === 'v') {
        e.preventDefault();
        pasteClip();
      } else if (ctrl && e.key === 'd') {
        e.preventDefault();
        duplicateClip();
      } else if (!ctrl && (e.key === 'c' || e.key === 'C')) {
        // C = 면도날(Razor) 컷 — Premiere/FCP 표준
        e.preventDefault();
        split();
      } else if (e.key === ' ') {
        e.preventDefault();
        setPlaying(!isPlaying);
      } else if (
        (e.key === 'Delete' || e.key === 'Backspace') &&
        useProjectStore.getState().selectedClipIds.length > 0
      ) {
        e.preventDefault();
        const ids = useProjectStore.getState().selectedClipIds;
        if (ids.length === 1) {
          removeClip(ids[0]);
        } else {
          removeClips(ids); // 한 번에 삭제 + Undo 시 한 번에 복원
        }
      } else if (e.key === ',' || e.key === '<') {
        // 1프레임 뒤로 (Shift = 1초)
        e.preventDefault();
        const step = e.shiftKey ? 1 : frameStep;
        setPlayhead(Math.max(0, playhead - step));
      } else if (e.key === '.' || e.key === '>') {
        // 1프레임 앞으로
        e.preventDefault();
        const step = e.shiftKey ? 1 : frameStep;
        setPlayhead(playhead + step);
      } else if (
        e.key === 'ArrowLeft' ||
        e.key === 'ArrowRight' ||
        e.key === 'ArrowUp' ||
        e.key === 'ArrowDown'
      ) {
        // 선택된 클립이 있으면 화면 내 위치 이동, 없으면 좌우 화살표는 프레임 점프
        const clip = project?.clips.find((c) => c.id === selectedClipId);
        if (clip) {
          e.preventDefault();
          const stepNorm = e.shiftKey ? 0.05 : 0.005; // 미세이동 / 큰이동
          let dx = 0;
          let dy = 0;
          if (e.key === 'ArrowLeft') dx = -stepNorm;
          if (e.key === 'ArrowRight') dx = stepNorm;
          if (e.key === 'ArrowUp') dy = -stepNorm;
          if (e.key === 'ArrowDown') dy = stepNorm;
          if (clip.kind === 'text') {
            updateClip(clip.id, {
              x: Math.max(0, Math.min(1, (clip as any).x + dx)),
              y: Math.max(0, Math.min(1, (clip as any).y + dy)),
            });
          } else if (clip.kind !== 'audio') {
            updateClip(clip.id, {
              x: ((clip as any).x ?? 0.5) + dx,
              y: ((clip as any).y ?? 0.5) + dy,
            });
          }
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          // 선택된 클립이 없으면 좌우 화살표 = 프레임 점프
          e.preventDefault();
          const step = e.shiftKey ? 1 : frameStep;
          const dir = e.key === 'ArrowLeft' ? -1 : 1;
          setPlayhead(Math.max(0, playhead + dir * step));
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, split, removeClip, removeClips, selectedClipId, selectedClipIds, setPlaying, isPlaying, copyClip, pasteClip, duplicateClip, setPlayhead, updateClip]);

  return (
    <div className="h-full w-full flex flex-col bg-bg-base">
      <TopBar />
      <div className="flex-1 flex min-h-0">
        <div
          className="panel border-r flex flex-col min-h-0 flex-shrink-0"
          style={{ width: leftWidth }}
        >
          <MediaLibrary />
        </div>
        {/* 좌측 리사이저 */}
        <div
          onMouseDown={(e) => {
            e.preventDefault();
            setResizing('left');
          }}
          onDoubleClick={() => setLeftWidth(LEFT_DEFAULT)}
          className={`w-1 cursor-col-resize flex-shrink-0 group relative ${
            resizing === 'left' ? 'bg-accent' : 'bg-transparent hover:bg-accent/50'
          }`}
          title="드래그로 너비 조절 · 더블클릭으로 기본값"
        >
          {/* 잡기 쉬운 넓은 hit area */}
          <div className="absolute inset-y-0 -left-1 -right-1" />
        </div>
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex-1 min-h-0 bg-bg-base flex items-center justify-center p-4">
            <Preview />
          </div>
        </div>
        {/* 우측 리사이저 */}
        <div
          onMouseDown={(e) => {
            e.preventDefault();
            setResizing('right');
          }}
          onDoubleClick={() => setRightWidth(RIGHT_DEFAULT)}
          className={`w-1 cursor-col-resize flex-shrink-0 group relative ${
            resizing === 'right' ? 'bg-accent' : 'bg-transparent hover:bg-accent/50'
          }`}
          title="드래그로 너비 조절 · 더블클릭으로 기본값"
        >
          <div className="absolute inset-y-0 -left-1 -right-1" />
        </div>
        <div
          className="panel border-l flex flex-col min-h-0 flex-shrink-0"
          style={{ width: rightWidth }}
        >
          <Inspector />
        </div>
      </div>
      <div className="h-80 panel border-t flex flex-col">
        <Timeline />
      </div>
    </div>
  );
}
