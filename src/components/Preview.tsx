import { useEffect, useMemo, useRef, useState } from 'react';
import { useProjectStore } from '../store/projectStore';
import type { MediaClip, TextClip, Track } from '@shared/types';
import { resolveAnimatedValue } from '../utils/keyframes';

export function Preview() {
  const project = useProjectStore((s) => s.project);
  const playhead = useProjectStore((s) => s.playheadSec);
  const isPlaying = useProjectStore((s) => s.isPlaying);
  const setPlayhead = useProjectStore((s) => s.setPlayhead);
  const setPlaying = useProjectStore((s) => s.setPlaying);
  const totalDuration = useProjectStore((s) => s.totalDurationSec());
  const selectedClipId = useProjectStore((s) => s.selectedClipId);
  const selectClip = useProjectStore((s) => s.selectClip);
  const updateClip = useProjectStore((s) => s.updateClip);
  const pushHistory = useProjectStore((s) => s.pushHistory);

  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const videoRefs = useRef<Map<string, HTMLVideoElement>>(new Map());
  const audioRefs = useRef<Map<string, HTMLAudioElement>>(new Map());
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });
  const [errors, setErrors] = useState<Map<string, string>>(new Map());

  // 미리보기 viewport 줌/패닝
  const [viewZoom, setViewZoom] = useState(1);
  const [viewPan, setViewPan] = useState({ x: 0, y: 0 });

  const aspect = project ? project.settings.width / project.settings.height : 16 / 9;
  const stage = useMemo(() => {
    const { w, h } = containerSize;
    if (!w || !h) return { w: 0, h: 0 };
    if (w / h > aspect) return { w: h * aspect, h };
    return { w, h: w / aspect };
  }, [containerSize, aspect]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setContainerSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 휠 이벤트: Ctrl=줌(커서 기준), Shift=좌우 이동, 일반=위아래 이동
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const rect = el.getBoundingClientRect();
        const mx = e.clientX - rect.left - rect.width / 2;
        const my = e.clientY - rect.top - rect.height / 2;
        setViewZoom((prevZoom) => {
          const factor = e.deltaY > 0 ? 1 / 1.15 : 1.15;
          const next = Math.max(0.25, Math.min(8, prevZoom * factor));
          const ratio = next / prevZoom;
          setViewPan((p) => ({
            x: mx - (mx - p.x) * ratio,
            y: my - (my - p.y) * ratio,
          }));
          return next;
        });
      } else if (e.shiftKey) {
        setViewPan((p) => ({ x: p.x - e.deltaY, y: p.y }));
      } else {
        setViewPan((p) => ({ x: p.x - e.deltaX, y: p.y - e.deltaY }));
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const resetView = () => {
    setViewZoom(1);
    setViewPan({ x: 0, y: 0 });
  };

  // 트랙 순서 맵 (index 작을수록 z-index 큼 = 화면에서 위)
  const trackIndexMap = useMemo(() => {
    const m = new Map<string, number>();
    if (project) {
      const sorted = [...project.tracks].sort((a, b) => a.index - b.index);
      sorted.forEach((t, i) => m.set(t.id, i));
    }
    return m;
  }, [project]);

  // 숨겨진 트랙 ID 집합 — 미리보기/오디오 재생에서 제외
  const hiddenTrackIds = useMemo(() => {
    return new Set((project?.tracks ?? []).filter((t) => t.hidden).map((t) => t.id));
  }, [project]);

  // 활성 클립들 (현재 playhead 시각에 보이는 모든 클립, hidden 트랙 제외)
  const activeVisualClips = useMemo(() => {
    if (!project) return [] as MediaClip[];
    return project.clips
      .filter(
        (c): c is MediaClip =>
          (c.kind === 'video' || c.kind === 'image') &&
          !hiddenTrackIds.has(c.trackId) &&
          playhead >= c.startSec &&
          playhead < c.startSec + c.durationSec,
      )
      .sort((a, b) => (trackIndexMap.get(b.trackId) ?? 0) - (trackIndexMap.get(a.trackId) ?? 0));
  }, [project, playhead, trackIndexMap, hiddenTrackIds]);

  const activeTextClips = useMemo(() => {
    if (!project) return [] as TextClip[];
    return project.clips
      .filter(
        (c): c is TextClip =>
          c.kind === 'text' &&
          !hiddenTrackIds.has(c.trackId) &&
          playhead >= c.startSec &&
          playhead < c.startSec + c.durationSec,
      )
      .sort((a, b) => (trackIndexMap.get(b.trackId) ?? 0) - (trackIndexMap.get(a.trackId) ?? 0));
  }, [project, playhead, trackIndexMap, hiddenTrackIds]);

  const activeAudioClips = useMemo(() => {
    if (!project) return [] as MediaClip[];
    return project.clips.filter(
      (c): c is MediaClip =>
        c.kind === 'audio' &&
        !hiddenTrackIds.has(c.trackId) &&
        playhead >= c.startSec &&
        playhead < c.startSec + c.durationSec,
    );
  }, [project, playhead, hiddenTrackIds]);

  // 재생 시 playhead 진행
  useEffect(() => {
    if (!isPlaying) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const next = useProjectStore.getState().playheadSec + dt;
      const total = useProjectStore.getState().totalDurationSec();
      if (next >= total) {
        setPlayhead(total);
        setPlaying(false);
        return;
      }
      setPlayhead(next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, setPlayhead, setPlaying]);

  // 페이드 효과를 반영한 볼륨 계산 (미리보기용)
  const computeFadedVolume = (clip: MediaClip, playheadGlobal: number): number => {
    const baseVol = clip.volume ?? 1;
    const localT = playheadGlobal - clip.startSec; // 클립 시작 기준 경과 시간
    let vol = baseVol;
    if (clip.fadeInSec > 0 && localT < clip.fadeInSec) {
      vol *= Math.max(0, localT / clip.fadeInSec);
    }
    if (clip.fadeOutSec > 0) {
      const remain = clip.durationSec - localT;
      if (remain < clip.fadeOutSec) {
        vol *= Math.max(0, remain / clip.fadeOutSec);
      }
    }
    return Math.min(1, Math.max(0, vol));
  };

  // 비디오 동기화 (활성 비디오 클립별)
  useEffect(() => {
    if (!project) return;
    // 활성 아닌 비디오는 정지
    videoRefs.current.forEach((v, clipId) => {
      const stillActive = activeVisualClips.find((c) => c.id === clipId && c.kind === 'video');
      if (!stillActive && !v.paused) v.pause();
    });

    activeVisualClips.forEach((clip) => {
      if (clip.kind !== 'video') return;
      const v = videoRefs.current.get(clip.id);
      if (!v) return;
      const speed = clip.speed || 1;
      const localTime = clip.inSec + (playhead - clip.startSec) * speed;
      if (Math.abs(v.currentTime - localTime) > 0.2) v.currentTime = localTime;
      v.playbackRate = speed;
      v.volume = computeFadedVolume(clip, playhead);
      if (isPlaying && v.paused) v.play().catch((err) => console.error('[video.play]', err));
      if (!isPlaying && !v.paused) v.pause();
    });
  }, [playhead, isPlaying, activeVisualClips, project]);

  // 오디오 동기화
  useEffect(() => {
    if (!project) return;
    audioRefs.current.forEach((audio, clipId) => {
      const stillActive = activeAudioClips.find((c) => c.id === clipId);
      if (!stillActive && !audio.paused) audio.pause();
    });
    activeAudioClips.forEach((clip) => {
      const asset = project.assets.find((a) => a.id === clip.assetId);
      if (!asset) return;
      let audio = audioRefs.current.get(clip.id);
      if (!audio) {
        audio = new Audio(window.api.toMediaUrl(asset.filePath));
        audioRefs.current.set(clip.id, audio);
      }
      const speed = clip.speed || 1;
      const localTime = clip.inSec + (playhead - clip.startSec) * speed;
      if (Math.abs(audio.currentTime - localTime) > 0.2) audio.currentTime = localTime;
      audio.playbackRate = speed;
      audio.volume = computeFadedVolume(clip, playhead);
      if (isPlaying && audio.paused) audio.play().catch(() => {});
      if (!isPlaying && !audio.paused) audio.pause();
    });
  }, [playhead, isPlaying, activeAudioClips, project]);

  if (!project) return null;

  const stageScale = stage.w / project.settings.width;

  return (
    <div className="w-full h-full flex flex-col">
      <div ref={containerRef} className="flex-1 flex items-center justify-center min-h-0 relative overflow-hidden">
        <div
          ref={stageRef}
          className="bg-black relative shadow-2xl overflow-hidden"
          style={{
            width: stage.w,
            height: stage.h,
            transform: `translate(${viewPan.x}px, ${viewPan.y}px) scale(${viewZoom})`,
            transformOrigin: 'center',
          }}
          onClick={(e) => {
            // 빈 stage 영역(자식 레이어가 아닌 stage 자체)을 클릭한 경우만 선택 해제
            if (e.target === e.currentTarget) selectClip(null);
          }}
        >
          {activeVisualClips.length === 0 && activeTextClips.length === 0 && (
            <div className="w-full h-full flex items-center justify-center text-text-muted text-sm">
              미디어를 추가하면 여기에 미리보기가 표시됩니다
            </div>
          )}

          {/* 비디오/이미지 — 정렬: 아래 트랙 → 위 트랙 순서로 render
              (DOM 뒤에 그려진 게 위에 표시되므로 위 트랙이 화면에서도 위) */}
          {activeVisualClips.map((clip) => {
            const asset = project.assets.find((a) => a.id === clip.assetId);
            if (!asset) return null;
            return (
              <VisualLayer
                key={clip.id}
                clip={clip}
                asset={asset}
                stageWidth={stage.w}
                stageHeight={stage.h}
                projectWidth={project.settings.width}
                projectHeight={project.settings.height}
                isSelected={selectedClipId === clip.id}
                onSelect={() => selectClip(clip.id)}
                onUpdate={updateClip}
                onPushHistory={pushHistory}
                onError={(msg) =>
                  setErrors((prev) => {
                    const next = new Map(prev);
                    next.set(clip.id, msg);
                    return next;
                  })
                }
                onLoad={() =>
                  setErrors((prev) => {
                    if (!prev.has(clip.id)) return prev;
                    const next = new Map(prev);
                    next.delete(clip.id);
                    return next;
                  })
                }
                videoRefs={videoRefs}
              />
            );
          })}

          {/* 자막 — 트랙 z-order (위 트랙이 화면에서도 위) */}
          {activeTextClips.map((clip) => (
            <TextLayer
              key={clip.id}
              clip={clip}
              stageScale={stageScale}
              isSelected={selectedClipId === clip.id}
              onSelect={() => selectClip(clip.id)}
              onUpdate={updateClip}
              onPushHistory={pushHistory}
              projectWidth={project.settings.width}
              projectHeight={project.settings.height}
              stageWidth={stage.w}
              stageHeight={stage.h}
            />
          ))}

          {/* 에러 표시 */}
          {errors.size > 0 && (
            <div className="absolute top-2 left-2 right-2 space-y-1 pointer-events-none">
              {[...errors.entries()].map(([id, msg]) => (
                <div key={id} className="bg-red-950/90 border border-red-500/50 rounded p-2 text-xs text-red-200">
                  ⚠ {msg}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 컨트롤바 */}
      <div className="h-10 flex items-center justify-center gap-3 bg-bg-panel border-t border-border-subtle px-4">
        <button onClick={() => setPlayhead(0)} className="btn-ghost px-2" title="처음으로">⏮</button>
        <button onClick={() => setPlaying(!isPlaying)} className="btn-secondary px-4" title="재생/정지 (Space)">
          {isPlaying ? '⏸' : '▶'}
        </button>
        <span className="text-xs text-text-muted font-mono">
          {formatTime(playhead)} / {formatTime(totalDuration)}
        </span>
        <div className="flex-1" />
        <button
          onClick={resetView}
          className="btn-ghost text-xs"
          title="화면 위치/줌 초기화"
        >
          {Math.round(viewZoom * 100)}%
        </button>
        <button
          onClick={async () => {
            // 현재 프레임 캡처: project 해상도로 canvas 합성
            if (!project) return;
            const canvas = document.createElement('canvas');
            canvas.width = project.settings.width;
            canvas.height = project.settings.height;
            const ctx = canvas.getContext('2d');
            if (!ctx) return;
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            // 활성 visual clip을 그 자리에 그리기 (역순으로 = 아래 트랙 먼저)
            for (const clip of activeVisualClips) {
              const asset = project.assets.find((a) => a.id === clip.assetId);
              if (!asset) continue;
              const aw = asset.width ?? project.settings.width;
              const ah = asset.height ?? project.settings.height;
              const aspectAsset = aw / ah;
              const aspectStage = project.settings.width / project.settings.height;
              let baseW: number, baseH: number;
              if (aspectAsset > aspectStage) {
                baseW = project.settings.width;
                baseH = baseW / aspectAsset;
              } else {
                baseH = project.settings.height;
                baseW = baseH * aspectAsset;
              }
              const w = baseW * (clip.scale ?? 1);
              const h = baseH * (clip.scale ?? 1);
              const cx = (clip.x ?? 0.5) * project.settings.width;
              const cy = (clip.y ?? 0.5) * project.settings.height;

              ctx.save();
              ctx.translate(cx, cy);
              if (clip.rotation) ctx.rotate((clip.rotation * Math.PI) / 180);
              if (clip.hflip) ctx.scale(-1, 1);
              if (clip.vflip) ctx.scale(1, -1);
              try {
                if (clip.kind === 'video') {
                  const v = videoRefs.current.get(clip.id);
                  if (v && v.readyState >= 2) ctx.drawImage(v, -w / 2, -h / 2, w, h);
                } else {
                  // 이미지: 동기 로딩이 안 되니 별도 Image 객체로
                  const img = new Image();
                  img.src = window.api.toMediaUrl(asset.filePath);
                  await new Promise<void>((r) => {
                    if (img.complete) r();
                    else {
                      img.onload = () => r();
                      img.onerror = () => r();
                    }
                  });
                  ctx.drawImage(img, -w / 2, -h / 2, w, h);
                }
              } catch {}
              ctx.restore();
            }

            // 자막은 단순화: 위치/색만 반영
            for (const t of activeTextClips) {
              ctx.save();
              ctx.font = `${t.bold ? 'bold ' : ''}${t.italic ? 'italic ' : ''}${t.fontSize}px "${t.fontFamily}"`;
              ctx.textAlign = t.align as CanvasTextAlign;
              ctx.textBaseline = 'top';
              const cx = t.x * project.settings.width;
              const cy = t.y * project.settings.height;
              if (t.bgColor) {
                const m = ctx.measureText(t.text);
                const padX = t.fontSize * 0.3;
                const padY = t.fontSize * 0.15;
                let bx = cx;
                if (t.align === 'center') bx -= m.width / 2;
                if (t.align === 'right') bx -= m.width;
                ctx.fillStyle = t.bgColor + 'CC';
                ctx.fillRect(bx - padX, cy - padY, m.width + padX * 2, t.fontSize + padY * 2);
              }
              if (t.outline) {
                ctx.strokeStyle = t.outlineColor;
                ctx.lineWidth = Math.max(2, t.fontSize * 0.08);
                ctx.strokeText(t.text, cx, cy);
              }
              if (t.shadow) {
                ctx.fillStyle = 'rgba(0,0,0,0.7)';
                ctx.fillText(t.text, cx + 3, cy + 3);
              }
              ctx.fillStyle = t.color;
              ctx.fillText(t.text, cx, cy);
              ctx.restore();
            }

            const dataUrl = canvas.toDataURL('image/png');
            const defaultName = `${project.name}_${formatTime(playhead).replace(/[:.]/g, '-')}`;
            const path = await window.api.exportSnapshot(dataUrl, defaultName);
            if (path) {
              // 짧게 알림 (alert 대신 console + 다음에 토스트)
              console.log('[snapshot] saved:', path);
            }
          }}
          className="btn-ghost text-sm"
          title="현재 프레임 정지화면(PNG)으로 저장"
        >
          📸 캡처
        </button>
      </div>
    </div>
  );
}

// ───────────────── 비디오/이미지 레이어 ─────────────────

interface DragStartState {
  mouseX: number;
  mouseY: number;
  startX: number;
  startY: number;
  startScale: number;
  startFontSize?: number;
}

function VisualLayer({
  clip,
  asset,
  stageWidth,
  stageHeight,
  projectWidth,
  projectHeight,
  isSelected,
  onSelect,
  onUpdate,
  onPushHistory,
  onError,
  onLoad,
  videoRefs,
}: {
  clip: MediaClip;
  asset: { filePath: string; fileName: string; width?: number; height?: number; proxyPath?: string; hasAudio?: boolean };
  stageWidth: number;
  stageHeight: number;
  projectWidth: number;
  projectHeight: number;
  isSelected: boolean;
  onSelect: () => void;
  onUpdate: (id: string, patch: Partial<MediaClip>) => void;
  onPushHistory: () => void;
  onError: (msg: string) => void;
  onLoad: () => void;
  videoRefs: React.MutableRefObject<Map<string, HTMLVideoElement>>;
}) {
  const [dragMode, setDragMode] = useState<null | 'move' | 'corner'>(null);
  const startRef = useRef<DragStartState | null>(null);
  // 실제 네이처 크기 — onLoad 후 갱신 (asset.width/height가 EXIF 무시 등으로 부정확할 수 있음)
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);

  // 영상의 base size: scale=1일 때 화면(stage)에 fit
  // 우선순위: 실제 네이처 → asset 메타 → project 비율 fallback
  const effW = natural?.w ?? asset.width ?? projectWidth;
  const effH = natural?.h ?? asset.height ?? projectHeight;
  const aspectAsset = effW / effH;
  const aspectStage = projectWidth / projectHeight;
  let baseW: number;
  let baseH: number;
  if (aspectAsset > aspectStage) {
    baseW = stageWidth;
    baseH = stageWidth / aspectAsset;
  } else {
    baseH = stageHeight;
    baseW = stageHeight * aspectAsset;
  }
  // 키프레임 보간: 있으면 보간값, 없으면 정적 속성
  const playheadGlobal = useProjectStore((s) => s.playheadSec);
  const localT = playheadGlobal - clip.startSec;
  const animX = resolveAnimatedValue(clip.keyframes, 'x', localT, clip.x ?? 0.5);
  const animY = resolveAnimatedValue(clip.keyframes, 'y', localT, clip.y ?? 0.5);
  const animScale = resolveAnimatedValue(clip.keyframes, 'scale', localT, clip.scale ?? 1);
  const animRot = resolveAnimatedValue(clip.keyframes, 'rotation', localT, clip.rotation ?? 0);
  const animOp = resolveAnimatedValue(clip.keyframes, 'opacity', localT, clip.opacity ?? 1);

  const w = baseW * animScale;
  const h = baseH * animScale;
  const cx = animX * stageWidth;
  const cy = animY * stageHeight;

  // 트랜지션 진행도 계산 (0~1)
  const playheadInClip = useProjectStore((s) => s.playheadSec) - clip.startSec;
  const tInSec = clip.transitionInSec ?? 0;
  const tOutSec = clip.transitionOutSec ?? 0;
  const tInProgress = tInSec > 0 ? Math.max(0, Math.min(1, playheadInClip / tInSec)) : 1;
  const tOutProgress =
    tOutSec > 0
      ? Math.max(0, Math.min(1, (clip.durationSec - playheadInClip) / tOutSec))
      : 1;
  // 두 효과 중 더 강한 쪽 (작은 값) 적용
  const tProgress = Math.min(tInProgress, tOutProgress);
  const inActive = tInProgress < 1;
  const outActive = tOutProgress < 1;
  const activeKind: import('@shared/types').TransitionKind | null = inActive
    ? clip.transitionIn ?? 'none'
    : outActive
    ? clip.transitionOut ?? 'none'
    : null;

  let transitionOpacity = 1;
  let transitionTransformExtra = '';
  let clipPath: string | undefined;
  if (activeKind && activeKind !== 'none') {
    const dist = 1 - tProgress; // 1=완전히 효과 시작점, 0=완료
    switch (activeKind) {
      case 'fade':
        transitionOpacity = tProgress;
        break;
      case 'slide-left':
        transitionTransformExtra = ` translateX(${dist * 100}%)`;
        break;
      case 'slide-right':
        transitionTransformExtra = ` translateX(${-dist * 100}%)`;
        break;
      case 'slide-up':
        transitionTransformExtra = ` translateY(${dist * 100}%)`;
        break;
      case 'slide-down':
        transitionTransformExtra = ` translateY(${-dist * 100}%)`;
        break;
      case 'zoom-in':
        transitionTransformExtra = ` scale(${0.3 + 0.7 * tProgress})`;
        transitionOpacity = tProgress;
        break;
      case 'zoom-out':
        transitionTransformExtra = ` scale(${1 + 0.7 * dist})`;
        transitionOpacity = tProgress;
        break;
      case 'wipe-left':
        clipPath = `inset(0 ${dist * 100}% 0 0)`;
        break;
      case 'wipe-right':
        clipPath = `inset(0 0 0 ${dist * 100}%)`;
        break;
    }
  }

  const transforms: string[] = [];
  if (clip.hflip) transforms.push('scaleX(-1)');
  if (clip.vflip) transforms.push('scaleY(-1)');
  if (animRot) transforms.push(`rotate(${animRot}deg)`);

  const onMouseDown = (e: React.MouseEvent, mode: 'move' | 'corner') => {
    e.stopPropagation();
    onSelect();
    onPushHistory();
    setDragMode(mode);
    startRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      startX: clip.x ?? 0.5,
      startY: clip.y ?? 0.5,
      startScale: clip.scale ?? 1,
    };
  };

  useEffect(() => {
    if (!dragMode) return;
    const onMove = (e: MouseEvent) => {
      const start = startRef.current;
      if (!start) return;
      if (dragMode === 'move') {
        let dx = (e.clientX - start.mouseX) / stageWidth;
        let dy = (e.clientY - start.mouseY) / stageHeight;
        // Shift = 수평/수직 잠금 (더 큰 변화량 쪽만 적용)
        if (e.shiftKey) {
          if (Math.abs(e.clientX - start.mouseX) > Math.abs(e.clientY - start.mouseY)) {
            dy = 0;
          } else {
            dx = 0;
          }
        }
        onUpdate(clip.id, { x: start.startX + dx, y: start.startY + dy });
      } else if (dragMode === 'corner') {
        // 우하단 모서리에서 거리에 비례해 scale 조정
        const dx = e.clientX - start.mouseX;
        const dy = e.clientY - start.mouseY;
        const delta = (dx + dy) / 200;
        const newScale = Math.max(0.1, Math.min(8, start.startScale + delta));
        onUpdate(clip.id, { scale: newScale });
      }
    };
    const onUp = () => {
      setDragMode(null);
      startRef.current = null;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragMode, clip.id, stageWidth, stageHeight, onUpdate]);

  // CSS filter — brightness/saturation/contrast/hue-rotate(temperature/tint 근사)
  const cssFilters: string[] = [];
  cssFilters.push(`brightness(${(1 + (clip.brightness ?? 0)).toFixed(3)})`);
  if (clip.saturation !== undefined && clip.saturation !== 0) {
    cssFilters.push(`saturate(${(1 + clip.saturation).toFixed(3)})`);
  }
  if (clip.contrast !== undefined && clip.contrast !== 0) {
    cssFilters.push(`contrast(${(1 + clip.contrast).toFixed(3)})`);
  }
  // 색온도/틴트는 CSS hue-rotate로 근사 (정확도는 export 시 더 정밀)
  if (clip.temperature !== undefined && clip.temperature !== 0) {
    // 따뜻함(+)은 -10° 정도 hue-rotate (오렌지 쪽), 차가움(-)은 +10°
    const hue = -(clip.temperature * 10);
    cssFilters.push(`hue-rotate(${hue.toFixed(1)}deg)`);
  }
  if (clip.tint !== undefined && clip.tint !== 0) {
    const hue = clip.tint * 15;
    cssFilters.push(`hue-rotate(${hue.toFixed(1)}deg)`);
  }
  const filterStyle = cssFilters.join(' ');

  return (
    <div
      className={`absolute cursor-move ${isSelected ? 'outline outline-2 outline-accent' : ''}`}
      style={{
        left: cx - w / 2,
        top: cy - h / 2,
        width: w,
        height: h,
        transform: (transforms.join(' ') + transitionTransformExtra).trim() || undefined,
        transformOrigin: 'center',
        opacity: transitionOpacity * animOp,
        clipPath,
      }}
      onMouseDown={(e) => onMouseDown(e, 'move')}
    >
      {clip.kind === 'video' ? (
        <video
          ref={(el) => {
            if (el) videoRefs.current.set(clip.id, el);
            else videoRefs.current.delete(clip.id);
          }}
          src={window.api.toMediaUrl(asset.proxyPath ?? asset.filePath)}
          className="w-full h-full object-contain"
          style={{ filter: filterStyle }}
          muted={false}
          playsInline
          onError={(e) => {
            const err = (e.target as HTMLVideoElement).error;
            const codeMap: Record<number, string> = {
              1: '재생 중단',
              2: '네트워크 오류',
              3: '디코딩 실패 (HEVC/H.265 등 지원 안 됨)',
              4: '형식 미지원',
            };
            const msg = err ? `${asset.fileName}: ${codeMap[err.code] ?? '오류'} (code ${err.code})` : `${asset.fileName}: 알 수 없는 오류`;
            console.error('[video error]', asset.filePath, err);
            onError(msg);
          }}
          onLoadedMetadata={(e) => {
            const v = e.target as HTMLVideoElement;
            if (v.videoWidth > 0) setNatural({ w: v.videoWidth, h: v.videoHeight });
          }}
          onLoadedData={onLoad}
        />
      ) : (
        <img
          src={window.api.toMediaUrl(asset.filePath)}
          className="w-full h-full object-contain"
          style={{ filter: filterStyle }}
          alt=""
          onError={() => onError(`${asset.fileName}: 이미지 로드 실패`)}
          onLoad={(e) => {
            const img = e.target as HTMLImageElement;
            if (img.naturalWidth > 0) setNatural({ w: img.naturalWidth, h: img.naturalHeight });
            onLoad();
          }}
        />
      )}
      {/* 선택 시 우하단 리사이즈 핸들 */}
      {isSelected && (
        <div
          className="absolute -right-1.5 -bottom-1.5 w-3 h-3 bg-accent border-2 border-white rounded-sm cursor-nwse-resize"
          onMouseDown={(e) => onMouseDown(e, 'corner')}
          title="모서리 드래그로 크기 조절"
        />
      )}
    </div>
  );
}

// ───────────────── 자막 레이어 ─────────────────

function TextLayer({
  clip,
  stageScale,
  isSelected,
  onSelect,
  onUpdate,
  onPushHistory,
  projectWidth,
  projectHeight,
  stageWidth,
  stageHeight,
}: {
  clip: TextClip;
  stageScale: number;
  isSelected: boolean;
  onSelect: () => void;
  onUpdate: (id: string, patch: Partial<TextClip>) => void;
  onPushHistory: () => void;
  projectWidth: number;
  projectHeight: number;
  stageWidth: number;
  stageHeight: number;
}) {
  const [dragMode, setDragMode] = useState<null | 'move' | 'corner'>(null);
  const startRef = useRef<{
    mouseX: number;
    mouseY: number;
    startX: number;
    startY: number;
    startWidthNorm: number; // 0이면 자동 너비
  } | null>(null);

  const fontSize = clip.fontSize * stageScale;
  const cx = clip.x * stageWidth;
  const cy = clip.y * stageHeight;
  // 박스 너비 (clip.width 있으면 고정 너비로 박스 만들고 텍스트 자동 줄바꿈)
  const boxWidth = clip.width ? clip.width * stageWidth : undefined;

  // 텍스트 애니메이션 진행도
  const ph = useProjectStore((s) => s.playheadSec);
  const inClip = ph - clip.startSec;
  const aIn = clip.animationIn ?? 'none';
  const aOut = clip.animationOut ?? 'none';
  const aInDur = clip.animationInSec ?? 0.5;
  const aOutDur = clip.animationOutSec ?? 0.5;
  const inProg = aIn !== 'none' && aInDur > 0 ? Math.max(0, Math.min(1, inClip / aInDur)) : 1;
  const outProg = aOut !== 'none' && aOutDur > 0
    ? Math.max(0, Math.min(1, (clip.durationSec - inClip) / aOutDur))
    : 1;
  const animActive = inProg < 1 ? aIn : outProg < 1 ? aOut : 'none';
  const animProg = Math.min(inProg, outProg);
  const animDist = 1 - animProg;

  let textOpacity = 1;
  let textTransform = '';
  let visibleText = clip.text;
  if (animActive !== 'none') {
    switch (animActive) {
      case 'fade':
        textOpacity = animProg;
        break;
      case 'typewriter': {
        // 등장 시: 진행도에 따라 글자수 늘어남, 퇴장 시: 페이드만
        if (inProg < 1) {
          const n = Math.max(0, Math.floor(clip.text.length * inProg));
          visibleText = clip.text.slice(0, n);
        } else if (outProg < 1) {
          textOpacity = outProg;
        }
        break;
      }
      case 'slide-up':
        textTransform = `translateY(${animDist * 50}px)`;
        textOpacity = animProg;
        break;
      case 'slide-down':
        textTransform = `translateY(${-animDist * 50}px)`;
        textOpacity = animProg;
        break;
      case 'slide-left':
        textTransform = `translateX(${animDist * 100}px)`;
        textOpacity = animProg;
        break;
      case 'slide-right':
        textTransform = `translateX(${-animDist * 100}px)`;
        textOpacity = animProg;
        break;
      case 'pop':
        textTransform = `scale(${0.4 + 0.6 * animProg})`;
        textOpacity = animProg;
        break;
      case 'bounce': {
        // 등장: 0.7 → 1.1 → 1.0 (탄성), 퇴장: 1.0 → 0.6
        const eased = inProg < 1
          ? 0.7 + 0.4 * Math.sin(inProg * Math.PI)
          : 1 - 0.4 * (1 - outProg);
        textTransform = `scale(${eased})`;
        textOpacity = inProg < 1 ? inProg : outProg;
        break;
      }
    }
  }

  const xStyle: React.CSSProperties = (() => {
    if (clip.align === 'left') return { left: cx };
    if (clip.align === 'right') return { right: stageWidth - cx };
    return { left: cx };
  })();
  const centeringX = clip.align === 'center' ? 'translateX(-50%) ' : '';

  const onMouseDown = (e: React.MouseEvent, mode: 'move' | 'corner') => {
    e.stopPropagation();
    onSelect();
    onPushHistory();
    setDragMode(mode);
    startRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      startX: clip.x,
      startY: clip.y,
      startWidthNorm: clip.width ?? 0, // 0이면 자동 너비 상태에서 시작
    };
  };

  useEffect(() => {
    if (!dragMode) return;
    const onMove = (e: MouseEvent) => {
      const s = startRef.current;
      if (!s) return;
      if (dragMode === 'move') {
        let dx = (e.clientX - s.mouseX) / stageWidth;
        let dy = (e.clientY - s.mouseY) / stageHeight;
        // Shift = 수평/수직 잠금 (큰 변화량 쪽만 적용)
        if (e.shiftKey) {
          if (Math.abs(e.clientX - s.mouseX) > Math.abs(e.clientY - s.mouseY)) {
            dy = 0;
          } else {
            dx = 0;
          }
        }
        onUpdate(clip.id, {
          x: Math.max(0, Math.min(1, s.startX + dx)),
          y: Math.max(0, Math.min(1, s.startY + dy)),
        });
      } else if (dragMode === 'corner') {
        // 박스 너비만 조절 — 글자 크기는 그대로 유지
        const dx = e.clientX - s.mouseX;
        // 시작 너비가 0(자동)이면 현재 표시된 크기 추정 — 절반은 가운데 정렬, 절반은 한 변
        const startNorm = s.startWidthNorm > 0 ? s.startWidthNorm : 0.4;
        const newNorm = Math.max(0.05, Math.min(1, startNorm + (dx * 2) / stageWidth));
        onUpdate(clip.id, { width: newNorm });
      }
    };
    const onUp = () => {
      setDragMode(null);
      startRef.current = null;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragMode, clip.id, stageWidth, stageHeight, stageScale, onUpdate]);

  const shadow = clip.shadow ? '2px 2px 4px rgba(0,0,0,0.7)' : 'none';
  const textStroke = clip.outline ? `${Math.max(1, fontSize * 0.05)}px ${clip.outlineColor}` : undefined;

  return (
    <div
      className={`absolute cursor-move ${isSelected ? 'outline outline-2 outline-accent outline-offset-2' : ''}`}
      style={{
        top: cy,
        ...xStyle,
        // 박스 너비 — 설정되어 있으면 고정 너비로, 없으면 텍스트 길이에 맞춰 자동
        width: boxWidth ? `${boxWidth}px` : undefined,
        fontFamily: clip.fontFamily,
        fontSize: `${fontSize}px`,
        color: clip.color,
        backgroundColor: clip.bgColor ? clip.bgColor + 'CC' : undefined,
        padding: clip.bgColor ? `${fontSize * 0.15}px ${fontSize * 0.3}px` : undefined,
        borderRadius: clip.bgColor ? `${fontSize * 0.1}px` : undefined,
        fontWeight: clip.bold ? 700 : 400,
        fontStyle: clip.italic ? 'italic' : 'normal',
        textShadow: shadow,
        WebkitTextStroke: textStroke,
        // 박스 너비 있으면 자동 wrap, 없으면 입력된 \n만 사용
        whiteSpace: boxWidth ? 'normal' : 'pre-wrap',
        wordBreak: boxWidth ? 'break-word' : undefined,
        textAlign: clip.align,
        lineHeight: 1.2,
        userSelect: 'none',
        opacity: textOpacity,
        transform: (centeringX + textTransform).trim() || undefined,
      }}
      onMouseDown={(e) => onMouseDown(e, 'move')}
    >
      {visibleText}
      {isSelected && (
        <div
          className="absolute -right-2 -bottom-2 w-3 h-3 bg-accent border-2 border-white rounded-sm cursor-nwse-resize"
          onMouseDown={(e) => onMouseDown(e, 'corner')}
          title="드래그로 글자 크기 조절"
        />
      )}
    </div>
  );
}

function formatTime(sec: number): string {
  if (!isFinite(sec)) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.floor((sec - Math.floor(sec)) * 100);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
}
