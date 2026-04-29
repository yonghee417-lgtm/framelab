import { useMemo, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useProjectStore } from '../store/projectStore';
import type { MediaAsset, MediaKind, MediaFolder } from '@shared/types';

// useProjectStore.setState 직접 사용을 위해 store import (proxy 콜백용)
// (위에서 이미 import 됨)

const VIDEO_EXT = ['mp4', 'mov', 'mkv', 'webm', 'avi'];
const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'webp'];
const AUDIO_EXT = ['mp3', 'wav', 'm4a', 'aac', 'flac'];

function detectKind(filePath: string): MediaKind | null {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  if (VIDEO_EXT.includes(ext)) return 'video';
  if (IMAGE_EXT.includes(ext)) return 'image';
  if (AUDIO_EXT.includes(ext)) return 'audio';
  return null;
}

function basename(p: string): string {
  return p.split(/[\\/]/).pop() ?? p;
}

const ASSET_DRAG_TYPE = 'application/x-framelab-asset';
const ASSETS_BULK_TYPE = 'application/x-framelab-assets';
const FOLDER_DRAG_TYPE = 'application/x-framelab-folder';

export function MediaLibrary() {
  const project = useProjectStore((s) => s.project);
  const addAsset = useProjectStore((s) => s.addAsset);
  const removeAsset = useProjectStore((s) => s.removeAsset);
  const moveAssetToFolder = useProjectStore((s) => s.moveAssetToFolder);
  const addClip = useProjectStore((s) => s.addClipFromAsset);
  const addClipsFromAssets = useProjectStore((s) => s.addClipsFromAssets);
  const playhead = useProjectStore((s) => s.playheadSec);
  const addFolder = useProjectStore((s) => s.addFolder);
  const renameFolder = useProjectStore((s) => s.renameFolder);
  const removeFolder = useProjectStore((s) => s.removeFolder);
  const toggleFolder = useProjectStore((s) => s.toggleFolder);
  const selectedTrackId = useProjectStore((s) => s.selectedTrackId);

  const [importing, setImporting] = useState(false);
  const [rootDragOver, setRootDragOver] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  // Shift+클릭 범위 선택을 위한 마지막 클릭 자산
  const lastClickedRef = useRef<string | null>(null);

  const handleImport = async (folderId?: string) => {
    const paths = await window.api.openMediaDialog();
    if (paths.length === 0) return;
    setImporting(true);
    for (const filePath of paths) {
      const kind = detectKind(filePath);
      if (!kind) continue;
      try {
        let probe: { durationSec: number; width?: number; height?: number; hasAudio: boolean } = {
          durationSec: 5,
          hasAudio: false,
        };
        if (kind !== 'image') {
          probe = await window.api.probeMedia(filePath);
        } else {
          // 이미지: 브라우저 Image API로 측정 — EXIF 회전 자동 적용되어 정확함
          const url = window.api.toMediaUrl(filePath);
          const sizes = await new Promise<{ w: number; h: number }>((resolve) => {
            const img = new Image();
            img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
            img.onerror = () => resolve({ w: 0, h: 0 });
            img.src = url;
          });
          if (sizes.w > 0) {
            probe.width = sizes.w;
            probe.height = sizes.h;
          } else {
            // fallback: ffprobe
            const meta = await window.api.probeMedia(filePath).catch(() => null);
            if (meta) {
              probe.width = meta.width;
              probe.height = meta.height;
            }
          }
        }
        let thumb: string | undefined;
        if (kind === 'video' || kind === 'image') {
          thumb = await window.api.generateThumbnail(filePath, kind).catch(() => undefined);
        }
        let waveform: string | undefined;
        if (kind === 'audio' || (kind === 'video' && probe.hasAudio)) {
          waveform = await window.api.generateWaveform(filePath).catch(() => undefined);
        }
        const asset: MediaAsset = {
          id: uuidv4(),
          filePath,
          fileName: basename(filePath),
          kind,
          durationSec: probe.durationSec || (kind === 'image' ? 5 : 5),
          width: probe.width,
          height: probe.height,
          hasAudio: probe.hasAudio,
          thumbnailPath: thumb,
          waveformPath: waveform,
          importedAt: Date.now(),
          folderId,
        };
        addAsset(asset);

        // 1080p 초과 영상은 백그라운드로 프록시(720p) 생성 — 편집 미리보기용
        // 사용자는 즉시 자산 사용 가능, 프록시 완료 후 자동 교체
        if (kind === 'video' && probe.height && probe.height > 1080) {
          window.api
            .generateProxy(filePath)
            .then((proxyPath) => {
              useProjectStore.setState((s) => {
                if (!s.project) return {};
                return {
                  project: {
                    ...s.project,
                    assets: s.project.assets.map((a) =>
                      a.id === asset.id ? { ...a, proxyPath } : a,
                    ),
                  },
                };
              });
            })
            .catch((err) => console.warn('[proxy] 생성 실패:', err));
        }
      } catch (err) {
        console.error('Import failed:', filePath, err);
      }
    }
    setImporting(false);
  };

  // 자산을 표시 순서대로 평탄화 (Shift 범위 선택용)
  const flatAssetIds = useMemo(() => {
    if (!project) return [] as string[];
    const folders = project.folders ?? [];
    const ids: string[] = [];
    for (const f of folders) {
      const inFolder = project.assets.filter((a) => a.folderId === f.id);
      ids.push(...inFolder.map((a) => a.id));
    }
    const root = project.assets.filter(
      (a) => !a.folderId || !folders.find((f) => f.id === a.folderId),
    );
    ids.push(...root.map((a) => a.id));
    return ids;
  }, [project]);

  const grouped = useMemo(() => {
    const folders = project?.folders ?? [];
    const allAssets = project?.assets ?? [];
    const q = search.trim().toLowerCase();
    const matches = (a: MediaAsset) => !q || a.fileName.toLowerCase().includes(q);
    const byFolder = new Map<string, MediaAsset[]>();
    const root: MediaAsset[] = [];
    for (const a of allAssets) {
      if (!matches(a)) continue;
      if (a.folderId && folders.find((f) => f.id === a.folderId)) {
        const list = byFolder.get(a.folderId) ?? [];
        list.push(a);
        byFolder.set(a.folderId, list);
      } else {
        root.push(a);
      }
    }
    // 검색 중일 때는 빈 폴더 숨김
    const visibleFolders = q
      ? folders.filter((f) => (byFolder.get(f.id)?.length ?? 0) > 0 || f.name.toLowerCase().includes(q))
      : folders;
    return { folders: visibleFolders, byFolder, root };
  }, [project, search]);

  const handleAssetClick = (asset: MediaAsset, e: React.MouseEvent) => {
    e.stopPropagation();
    const id = asset.id;
    if (e.shiftKey && lastClickedRef.current) {
      // 범위 선택
      const a = flatAssetIds.indexOf(lastClickedRef.current);
      const b = flatAssetIds.indexOf(id);
      if (a < 0 || b < 0) {
        setSelectedIds(new Set([id]));
      } else {
        const [from, to] = a < b ? [a, b] : [b, a];
        setSelectedIds(new Set(flatAssetIds.slice(from, to + 1)));
      }
    } else if (e.ctrlKey || e.metaKey) {
      // 토글
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      lastClickedRef.current = id;
    } else {
      // 단일 선택
      setSelectedIds(new Set([id]));
      lastClickedRef.current = id;
    }
  };

  const handleAddSelected = (asset: MediaAsset) => {
    // 다중 선택된 자산이 있고, 클릭한 자산이 그중 하나라면 모두 추가
    if (selectedIds.size > 1 && selectedIds.has(asset.id)) {
      const list = flatAssetIds
        .filter((id) => selectedIds.has(id))
        .map((id) => project?.assets.find((a) => a.id === id))
        .filter((a): a is MediaAsset => !!a);
      addClipsFromAssets(list, playhead, selectedTrackId);
    } else {
      addClip(asset, playhead, selectedTrackId);
    }
  };

  const handleRootDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setRootDragOver(false);
    // 다중 선택 → 모두 루트로
    const bulk = e.dataTransfer.getData(ASSETS_BULK_TYPE);
    if (bulk) {
      try {
        const ids = JSON.parse(bulk) as string[];
        ids.forEach((id) => moveAssetToFolder(id, null));
        return;
      } catch {}
    }
    const assetId = e.dataTransfer.getData(ASSET_DRAG_TYPE);
    if (assetId) moveAssetToFolder(assetId, null);
  };

  // 자산을 드래그 시작할 때 — 다중 선택이면 bulk 데이터 함께 보냄
  const onAssetDragStart = (e: React.DragEvent, asset: MediaAsset) => {
    let ids: string[];
    if (selectedIds.has(asset.id) && selectedIds.size > 1) {
      // 표시 순서 유지
      ids = flatAssetIds.filter((id) => selectedIds.has(id));
    } else {
      ids = [asset.id];
      setSelectedIds(new Set([asset.id]));
    }
    e.dataTransfer.setData(ASSET_DRAG_TYPE, asset.id); // 단일 자산도 호환
    e.dataTransfer.setData(ASSETS_BULK_TYPE, JSON.stringify(ids));
    e.dataTransfer.effectAllowed = 'copyMove';
  };

  return (
    <>
      <div className="p-3 border-b border-border-subtle space-y-2">
        <button onClick={() => handleImport()} disabled={importing} className="btn-primary w-full">
          {importing ? '가져오는 중...' : '+ 미디어 가져오기'}
        </button>
        <button onClick={() => addFolder()} className="btn-secondary w-full text-sm">
          📁 폴더 추가
        </button>
        {selectedTrackId && (
          <div className="text-[10px] text-accent text-center bg-accent/10 rounded py-1">
            ✓ 선택된 트랙으로 추가됨
          </div>
        )}
        <p className="text-[10px] text-text-muted text-center leading-snug">
          클릭=선택 · Shift/Ctrl=다중 선택<br />
          더블클릭=타임라인 추가 · 드래그=폴더/트랙으로
        </p>
        <div className="relative">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="🔍 미디어 검색..."
            className="input w-full text-sm pr-7"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-1 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary px-2"
              title="검색 지우기"
            >
              ×
            </button>
          )}
        </div>
      </div>

      <div
        className={`flex-1 overflow-y-auto p-2 ${rootDragOver ? 'bg-accent/10' : ''}`}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes(ASSET_DRAG_TYPE)) {
            e.preventDefault();
            setRootDragOver(true);
          }
        }}
        onDragLeave={() => setRootDragOver(false)}
        onDrop={handleRootDrop}
        onClick={() => setSelectedIds(new Set())}
      >
        {grouped.folders.map((folder) => (
          <FolderItem
            key={folder.id}
            folder={folder}
            assets={grouped.byFolder.get(folder.id) ?? []}
            selectedIds={selectedIds}
            onAssetClick={handleAssetClick}
            onAddSelected={handleAddSelected}
            onRemoveAsset={(asset) => {
              if (confirm(`"${asset.fileName}" 을(를) 삭제하시겠습니까?`)) removeAsset(asset.id);
            }}
            onAssetDragStart={onAssetDragStart}
            onToggle={() => toggleFolder(folder.id)}
            onRename={(name) => renameFolder(folder.id, name)}
            onRemoveFolder={() => {
              const count = grouped.byFolder.get(folder.id)?.length ?? 0;
              const msg =
                count > 0
                  ? `"${folder.name}" 폴더를 삭제하시겠습니까?\n안의 미디어 ${count}개는 루트로 이동됩니다.`
                  : `"${folder.name}" 폴더를 삭제하시겠습니까?`;
              if (confirm(msg)) removeFolder(folder.id);
            }}
            onImportToFolder={() => handleImport(folder.id)}
            onDropAssetToFolder={(assetId) => moveAssetToFolder(assetId, folder.id)}
          />
        ))}

        {grouped.root.length === 0 && grouped.folders.length === 0 ? (
          <div className="text-text-muted text-sm text-center mt-8 px-4">
            미디어 파일을 가져와 주세요
          </div>
        ) : (
          <div className="space-y-1">
            {grouped.root.map((asset) => (
              <AssetItem
                key={asset.id}
                asset={asset}
                selected={selectedIds.has(asset.id)}
                onClick={(e) => handleAssetClick(asset, e)}
                onAdd={() => handleAddSelected(asset)}
                onRemove={() => {
                  if (confirm(`"${asset.fileName}" 을(를) 삭제하시겠습니까?`)) removeAsset(asset.id);
                }}
                onDragStart={(e) => onAssetDragStart(e, asset)}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

// ───────────────── 폴더 ─────────────────

function FolderItem({
  folder,
  assets,
  selectedIds,
  onAssetClick,
  onAddSelected,
  onRemoveAsset,
  onAssetDragStart,
  onToggle,
  onRename,
  onRemoveFolder,
  onImportToFolder,
  onDropAssetToFolder,
}: {
  folder: MediaFolder;
  assets: MediaAsset[];
  selectedIds: Set<string>;
  onAssetClick: (asset: MediaAsset, e: React.MouseEvent) => void;
  onAddSelected: (asset: MediaAsset) => void;
  onRemoveAsset: (asset: MediaAsset) => void;
  onAssetDragStart: (e: React.DragEvent, asset: MediaAsset) => void;
  onToggle: () => void;
  onRename: (name: string) => void;
  onRemoveFolder: () => void;
  onImportToFolder: () => void;
  onDropAssetToFolder: (assetId: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(folder.name);
  const [dragOver, setDragOver] = useState(false);

  return (
    <div
      className={`mb-1 rounded ${dragOver ? 'bg-accent/15 ring-1 ring-accent/50' : ''}`}
      onDragOver={(e) => {
        if (
          e.dataTransfer.types.includes(ASSET_DRAG_TYPE) ||
          e.dataTransfer.types.includes(ASSETS_BULK_TYPE)
        ) {
          e.preventDefault();
          e.stopPropagation();
          setDragOver(true);
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragOver(false);
        // 다중 선택 우선 처리 — 모든 자산을 이 폴더로
        const bulk = e.dataTransfer.getData(ASSETS_BULK_TYPE);
        if (bulk) {
          try {
            const ids = JSON.parse(bulk) as string[];
            if (ids.length > 0) {
              ids.forEach((id) => onDropAssetToFolder(id));
              return;
            }
          } catch {}
        }
        const assetId = e.dataTransfer.getData(ASSET_DRAG_TYPE);
        if (assetId) onDropAssetToFolder(assetId);
      }}
    >
      <div
        draggable={!editing}
        onDragStart={(e) => {
          e.dataTransfer.setData(FOLDER_DRAG_TYPE, folder.id);
          e.dataTransfer.effectAllowed = 'copy';
        }}
        className="group flex items-center gap-1 px-1.5 py-1 rounded hover:bg-bg-hover cursor-pointer"
        onClick={(e) => {
          if (editing) return;
          e.stopPropagation();
          if (e.detail === 1) onToggle();
        }}
        title="폴더를 잡고 트랙으로 드래그하면 안의 모든 미디어가 추가됩니다"
      >
        <span className="text-text-muted text-xs w-3 select-none">
          {folder.expanded ? '▼' : '▶'}
        </span>
        <span className="text-base">{folder.expanded ? '📂' : '📁'}</span>
        {editing ? (
          <input
            autoFocus
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onBlur={() => {
              onRename(draftName);
              setEditing(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') {
                setDraftName(folder.name);
                setEditing(false);
              }
            }}
            className="input flex-1 text-sm py-0.5 px-1.5"
          />
        ) : (
          <span
            className="flex-1 text-sm text-text-primary truncate select-none"
            onDoubleClick={(e) => {
              e.stopPropagation();
              setDraftName(folder.name);
              setEditing(true);
            }}
            title="더블클릭으로 이름 변경"
          >
            {folder.name}
          </span>
        )}
        <span className="text-[10px] text-text-muted">{assets.length}</span>
        <div className="opacity-0 group-hover:opacity-100 flex gap-0.5 ml-1">
          {!editing && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setDraftName(folder.name);
                setEditing(true);
              }}
              className="px-1 text-xs text-text-muted hover:text-accent"
              title="이름 변경"
            >
              ✏
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onImportToFolder();
            }}
            className="px-1 text-xs text-text-muted hover:text-accent"
            title="이 폴더로 가져오기"
          >
            +
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRemoveFolder();
            }}
            className="px-1 text-xs text-text-muted hover:text-red-400"
            title="폴더 삭제"
          >
            ×
          </button>
        </div>
      </div>

      {folder.expanded && (
        <div className="ml-3 pl-2 border-l border-border-subtle/50 space-y-1 mt-0.5">
          {assets.length === 0 ? (
            <div className="text-text-muted text-[11px] px-2 py-1.5 italic select-none">
              비어 있음 (드래그로 추가)
            </div>
          ) : (
            assets.map((asset) => (
              <AssetItem
                key={asset.id}
                asset={asset}
                selected={selectedIds.has(asset.id)}
                onClick={(e) => onAssetClick(asset, e)}
                onAdd={() => onAddSelected(asset)}
                onRemove={() => onRemoveAsset(asset)}
                onDragStart={(e) => onAssetDragStart(e, asset)}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ───────────────── 자산 아이템 ─────────────────

function AssetItem({
  asset,
  selected,
  onClick,
  onAdd,
  onRemove,
  onDragStart,
}: {
  asset: MediaAsset;
  selected: boolean;
  onClick: (e: React.MouseEvent) => void;
  onAdd: () => void;
  onRemove: () => void;
  onDragStart: (e: React.DragEvent) => void;
}) {
  const thumbUrl = asset.thumbnailPath ? window.api.toMediaUrl(asset.thumbnailPath) : null;
  const icon = asset.kind === 'video' ? '🎬' : asset.kind === 'image' ? '🖼️' : '🎵';
  const dur = formatDuration(asset.durationSec);

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onClick={onClick}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onAdd();
      }}
      className={`group flex items-center gap-2 p-1.5 rounded-md cursor-pointer
        ${selected ? 'bg-accent/20 ring-1 ring-accent/60' : 'hover:bg-bg-hover'}
      `}
      title="클릭=선택 · 더블클릭=타임라인 추가 · 드래그=폴더/트랙으로"
    >
      <div className="w-10 h-10 rounded bg-bg-surface border border-border-subtle flex items-center justify-center overflow-hidden flex-shrink-0">
        {thumbUrl ? (
          <img src={thumbUrl} className="w-full h-full object-cover" alt="" draggable={false} />
        ) : (
          <span className="text-base">{icon}</span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-text-primary truncate">{asset.fileName}</div>
        <div className="text-xs text-text-muted">{dur}</div>
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onAdd();
        }}
        className="opacity-0 group-hover:opacity-100 px-2 py-1 text-xs rounded bg-accent text-white"
        title="타임라인에 추가 (선택된 트랙 우선)"
      >
        +
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        className="opacity-0 group-hover:opacity-100 px-1.5 py-1 text-xs rounded text-text-muted hover:text-red-400"
        title="삭제"
      >
        ×
      </button>
    </div>
  );
}

function formatDuration(sec: number): string {
  if (!isFinite(sec)) return '--:--';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
