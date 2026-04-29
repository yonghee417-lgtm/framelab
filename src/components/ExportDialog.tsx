import { useEffect, useState } from 'react';
import { useProjectStore } from '../store/projectStore';
import type { ExportProgress } from '@shared/types';
import { ConfirmDialog } from './ConfirmDialog';

function defaultExportDir(): string {
  // OS 다운로드 폴더를 추측해서 placeholder 로 표시 (실제 경로는 사용자가 폴더 선택 후 결정)
  return '';
}

function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').trim() || 'export';
}

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const project = useProjectStore((s) => s.project);
  const setLastExport = useProjectStore((s) => s.setLastExport);
  const last = project?.lastExport;
  // 마지막 내보내기 경로에서 폴더/파일명 분리
  const lastSplit = (() => {
    if (!last?.outputPath) return null;
    const norm = last.outputPath.replace(/\\/g, '/');
    const slash = norm.lastIndexOf('/');
    return {
      dir: slash >= 0 ? norm.slice(0, slash) : '',
      name: (slash >= 0 ? norm.slice(slash + 1) : norm).replace(/\.mp4$/i, ''),
    };
  })();
  const [bitrate, setBitrate] = useState(last?.videoBitrate ?? '8M');
  const [preset, setPreset] = useState<'ultrafast' | 'fast' | 'medium' | 'slow'>(
    last?.preset ?? 'medium',
  );
  const [fileName, setFileName] = useState(lastSplit?.name ?? project?.name ?? 'export');
  const [outputDir, setOutputDir] = useState<string>(lastSplit?.dir ?? defaultExportDir());
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [exporting, setExporting] = useState(false);
  const [outputPath, setOutputPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [overwriteConfirm, setOverwriteConfirm] = useState<string | null>(null);

  useEffect(() => {
    const off = window.api.onExportProgress((p) => {
      setProgress(p);
      if (p.phase === 'done') setExporting(false);
      else if (p.phase === 'error') {
        setExporting(false);
        setError(p.message ?? '내보내기 실패');
      }
    });
    return () => off();
  }, []);

  const handleChooseFolder = async () => {
    const dir = await window.api.chooseDirectory();
    if (dir) setOutputDir(dir);
  };

  const handleQuickPick = async () => {
    // 폴더+파일명을 한 번에 고르는 표준 저장 다이얼로그
    const path = await window.api.saveExportDialog(`${sanitizeFileName(fileName)}.mp4`);
    if (path) {
      // 경로에서 폴더와 파일명 분리
      const norm = path.replace(/\\/g, '/');
      const lastSlash = norm.lastIndexOf('/');
      setOutputDir(norm.slice(0, lastSlash));
      setFileName(norm.slice(lastSlash + 1).replace(/\.mp4$/i, ''));
    }
  };

  const handleExport = async () => {
    if (!project) return;
    if (!outputDir) {
      alert('저장 폴더를 먼저 선택해주세요.');
      return;
    }
    const safeName = sanitizeFileName(fileName);
    const fullPath = `${outputDir}/${safeName}.mp4`.replace(/\\/g, '/');

    // 덮어쓰기 확인 — 같은 파일이 있으면 모달로 이중 체크
    const exists = await window.api.fileExists(fullPath).catch(() => false);
    if (exists) {
      setOverwriteConfirm(fullPath);
      return;
    }
    await runExport(fullPath);
  };

  const runExport = async (fullPath: string) => {
    if (!project) return;
    setError(null);
    setExporting(true);
    setProgress({ phase: 'preparing', percent: 0 });

    const result = await window.api.startExport(project, {
      outputPath: fullPath,
      videoBitrate: bitrate,
      preset,
    });
    if (result.success) {
      const finalPath = result.outputPath ?? fullPath;
      setOutputPath(finalPath);
      // 성공한 내보내기 정보 저장 — 다음에 같은 위치/설정으로 자동 채움
      setLastExport({
        outputPath: finalPath,
        videoBitrate: bitrate,
        preset,
        exportedAt: Date.now(),
      });
    } else {
      setError(result.error ?? '내보내기 실패');
      setExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="panel rounded-lg p-6 w-[560px] max-w-[90vw]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold mb-1 text-text-primary">영상 내보내기</h2>
        <p className="text-xs text-text-muted mb-2">
          {project?.settings.width} × {project?.settings.height} · {project?.settings.fps}fps · MP4 (H.264)
        </p>
        {last && !exporting && !outputPath && !progress && (
          <div className="mb-3 px-3 py-2 bg-accent/10 border border-accent/30 rounded text-[11px] text-text-secondary">
            ✓ 이전 내보내기 정보를 불러왔습니다 ·{' '}
            <span className="text-text-muted">
              {new Date(last.exportedAt).toLocaleString('ko-KR', {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          </div>
        )}

        {!exporting && !outputPath && !progress && (
          <div className="space-y-4">
            <div>
              <label className="text-sm text-text-secondary block mb-1">파일명</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={fileName}
                  onChange={(e) => setFileName(e.target.value)}
                  className="input flex-1"
                  placeholder="파일명 입력"
                />
                <span className="text-text-muted text-sm">.mp4</span>
              </div>
            </div>

            <div>
              <label className="text-sm text-text-secondary block mb-1">저장 위치</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={outputDir}
                  onChange={(e) => setOutputDir(e.target.value)}
                  className="input flex-1 text-xs font-mono"
                  placeholder="폴더를 선택하세요"
                  readOnly
                />
                <button onClick={handleChooseFolder} className="btn-secondary whitespace-nowrap">
                  폴더 선택
                </button>
                <button onClick={handleQuickPick} className="btn-ghost text-xs whitespace-nowrap" title="파일명+위치 한번에">
                  ✏ 다른이름으로
                </button>
              </div>
              {outputDir && (
                <p className="text-[10px] text-text-muted mt-1 break-all">
                  최종 경로: {outputDir}/{sanitizeFileName(fileName)}.mp4
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm text-text-secondary block mb-1">화질</label>
                <select value={bitrate} onChange={(e) => setBitrate(e.target.value)} className="input w-full">
                  <option value="4M">표준 (4M)</option>
                  <option value="8M">높음 (8M)</option>
                  <option value="12M">매우 높음 (12M)</option>
                  <option value="20M">최고 (20M)</option>
                </select>
              </div>
              <div>
                <label className="text-sm text-text-secondary block mb-1">인코딩 속도</label>
                <select value={preset} onChange={(e) => setPreset(e.target.value as typeof preset)} className="input w-full">
                  <option value="ultrafast">매우 빠름</option>
                  <option value="fast">빠름</option>
                  <option value="medium">표준</option>
                  <option value="slow">느림 (고화질)</option>
                </select>
              </div>
            </div>
          </div>
        )}

        {progress && exporting && (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-text-secondary">
                {progress.phase === 'preparing' && '준비 중...'}
                {progress.phase === 'rendering' && '렌더링 중...'}
                {progress.phase === 'finalizing' && '마무리 중...'}
              </span>
              <span className="text-text-primary font-mono font-semibold">
                {progress.percent.toFixed(1)}%
              </span>
            </div>
            <div className="h-3 bg-bg-surface rounded-full overflow-hidden relative">
              <div
                className="h-full bg-accent transition-[width] duration-300 ease-out"
                style={{ width: `${progress.percent}%` }}
              />
              {/* 진행 중 시각적 펄스 효과 */}
              {progress.percent > 0 && progress.percent < 100 && (
                <div
                  className="absolute top-0 h-full w-8 bg-white/20 blur-sm animate-pulse"
                  style={{ left: `calc(${progress.percent}% - 32px)` }}
                />
              )}
            </div>
            <p className="text-xs text-text-muted">{progress.message}</p>
          </div>
        )}

        {outputPath && (
          <div className="text-center py-4">
            <div className="text-2xl mb-2">✅</div>
            <div className="font-semibold text-text-primary mb-1">내보내기 완료</div>
            <div className="text-xs text-text-muted break-all">{outputPath}</div>
          </div>
        )}

        {error && (
          <div className="text-red-400 text-sm bg-red-500/10 border border-red-500/30 rounded p-3 mt-2">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 mt-6">
          {!exporting && (
            <>
              <button onClick={onClose} className="btn-secondary">
                {outputPath ? '닫기' : '취소'}
              </button>
              {!outputPath && (
                <button onClick={handleExport} className="btn-primary">
                  내보내기 시작
                </button>
              )}
            </>
          )}
          {exporting && <button disabled className="btn-secondary">내보내는 중...</button>}
        </div>
      </div>

      {overwriteConfirm && (
        <ConfirmDialog
          title="파일 덮어쓰기 확인"
          danger
          message={
            <>
              같은 위치에 이미 동일한 이름의 파일이 있습니다.
              <div className="mt-2 text-yellow-400 text-xs">
                ⚠ 기존 파일을 덮어쓰면 복구할 수 없습니다.
              </div>
              <div className="mt-1 text-text-muted text-[10px] break-all">{overwriteConfirm}</div>
            </>
          }
          confirmLabel="덮어쓰기"
          cancelLabel="취소"
          onConfirm={() => {
            const path = overwriteConfirm;
            setOverwriteConfirm(null);
            runExport(path);
          }}
          onCancel={() => setOverwriteConfirm(null)}
        />
      )}
    </div>
  );
}
