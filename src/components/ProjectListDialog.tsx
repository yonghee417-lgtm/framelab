import { useEffect, useState } from 'react';
import type { Project } from '@shared/types';
import { PRESETS } from '@shared/types';
import { useProjectStore } from '../store/projectStore';

export function ProjectListDialog({ onClose }: { onClose: () => void }) {
  const loadProject = useProjectStore((s) => s.loadProject);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    setLoading(true);
    const list = await window.api.listProjects().catch(() => []);
    setProjects(list);
    setLoading(false);
  };

  useEffect(() => {
    refresh();
  }, []);

  const handleOpen = async (id: string) => {
    const p = await window.api.loadProject(id);
    loadProject(p);
    onClose();
  };

  const handleDelete = async (e: React.MouseEvent, p: Project) => {
    e.stopPropagation();
    if (!confirm(`"${p.name}" 프로젝트를 삭제하시겠습니까? 되돌릴 수 없습니다.`)) return;
    await window.api.deleteProject(p.id);
    await refresh();
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="panel rounded-lg p-6 w-[640px] max-w-[90vw] max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-text-primary">프로젝트 열기</h2>
          <button onClick={onClose} className="btn-ghost">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto -mx-2">
          {loading ? (
            <div className="text-center text-text-muted py-12">불러오는 중...</div>
          ) : projects.length === 0 ? (
            <div className="text-center text-text-muted py-12">저장된 프로젝트가 없습니다</div>
          ) : (
            projects.map((p) => (
              <div
                key={p.id}
                onClick={() => handleOpen(p.id)}
                className="group flex items-center gap-3 p-3 mx-2 rounded-md hover:bg-bg-hover cursor-pointer"
              >
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-text-primary truncate">{p.name}</div>
                  <div className="text-xs text-text-muted mt-0.5">
                    {PRESETS[p.settings.preset].label} · {p.settings.width}×{p.settings.height} ·{' '}
                    {new Date(p.updatedAt).toLocaleString('ko-KR')} ·{' '}
                    클립 {p.clips.length}개
                  </div>
                </div>
                <button
                  onClick={(e) => handleDelete(e, p)}
                  className="opacity-0 group-hover:opacity-100 px-2 py-1 text-xs rounded text-red-400 hover:bg-red-500/10"
                >
                  삭제
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
