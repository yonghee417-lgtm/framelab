import { useEffect, useRef, useState } from 'react';
import { useProjectStore } from '../store/projectStore';
import { ExportDialog } from './ExportDialog';
import { ProjectListDialog } from './ProjectListDialog';
import { PRESETS } from '@shared/types';
import { addRecentExternal } from '../utils/recents';

type CloseProjectStep = 'confirm' | 'save' | 'method' | null;

export function TopBar() {
  const project = useProjectStore((s) => s.project);
  const currentFilePath = useProjectStore((s) => s.currentFilePath);
  const updateName = useProjectStore((s) => s.updateProjectName);
  const undo = useProjectStore((s) => s.undo);
  const redo = useProjectStore((s) => s.redo);
  const splitClip = useProjectStore((s) => s.splitClipAtPlayhead);
  const addText = useProjectStore((s) => s.addTextClip);
  const loadProject = useProjectStore((s) => s.loadProject);
  const playhead = useProjectStore((s) => s.playheadSec);
  const [exportOpen, setExportOpen] = useState(false);
  const [openListOpen, setOpenListOpen] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState(project?.name ?? '');
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [savedTo, setSavedTo] = useState<string>('');
  const [saveMenuOpen, setSaveMenuOpen] = useState(false);
  const [openMenuOpen, setOpenMenuOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [closeStep, setCloseStep] = useState<CloseProjectStep>(null);
  const [closing, setClosing] = useState(false);
  const saveMenuRef = useRef<HTMLDivElement>(null);
  const openMenuRef = useRef<HTMLDivElement>(null);

  // 외부 클릭 시 메뉴 닫기
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (saveMenuRef.current && !saveMenuRef.current.contains(e.target as Node)) setSaveMenuOpen(false);
      if (openMenuRef.current && !openMenuRef.current.contains(e.target as Node)) setOpenMenuOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, []);

  if (!project) return null;

  // 저장 — currentFilePath가 있으면 그 경로에 덮어쓰기, 없으면 라이브러리에
  const handleQuickSave = async () => {
    const state = useProjectStore.getState();
    const snapshot = state.getSerializableProject();
    if (!snapshot) return;
    const filePath = state.currentFilePath;
    let path: string;
    if (filePath) {
      path = await window.api.saveProjectToPath(snapshot, filePath);
      setSavedTo(path);
    } else {
      path = await window.api.saveProject(snapshot);
      setSavedTo(`라이브러리: ${path}`);
    }
    setSavedAt(new Date());
    setSaveMenuOpen(false);
  };

  // 다른 이름으로 저장 — 위치/이름 직접 선택, 저장 후 currentFilePath 업데이트
  const handleSaveAs = async () => {
    setSaveMenuOpen(false);
    const state = useProjectStore.getState();
    const snapshot = state.getSerializableProject();
    if (!snapshot) return;
    const path = await window.api.saveProjectAs(snapshot, snapshot.name);
    if (path) {
      // 이후 "저장"은 이 경로에 덮어쓰기
      state.setCurrentFilePath(path);
      // 최근 외부 파일 목록에 추가 (시작화면에서 보이도록)
      addRecentExternal({
        filePath: path,
        name: snapshot.name,
        preset: snapshot.settings.preset,
        width: snapshot.settings.width,
        height: snapshot.settings.height,
        clipCount: snapshot.clips.length,
        lastOpened: Date.now(),
      });
      setSavedAt(new Date());
      setSavedTo(path);
    }
  };

  const finishCloseProject = () => {
    useProjectStore.setState({
      project: null,
      currentFilePath: null,
      selectedClipId: null,
      selectedClipIds: [],
      selectedTrackId: null,
      playheadSec: 0,
      isPlaying: false,
    });
  };

  const handleCloseQuickSave = async () => {
    const state = useProjectStore.getState();
    const snapshot = state.getSerializableProject();
    if (!snapshot) {
      finishCloseProject();
      return;
    }
    setClosing(true);
    try {
      if (state.currentFilePath) {
        await window.api.saveProjectToPath(snapshot, state.currentFilePath);
      } else {
        await window.api.saveProject(snapshot);
      }
      finishCloseProject();
    } finally {
      setClosing(false);
    }
  };

  const handleCloseSaveAs = async () => {
    const state = useProjectStore.getState();
    const snapshot = state.getSerializableProject();
    if (!snapshot) {
      finishCloseProject();
      return;
    }
    setClosing(true);
    try {
      const path = await window.api.saveProjectAs(snapshot, snapshot.name);
      if (!path) {
        setClosing(false);
        return;
      }
      state.setCurrentFilePath(path);
      addRecentExternal({
        filePath: path,
        name: snapshot.name,
        preset: snapshot.settings.preset,
        width: snapshot.settings.width,
        height: snapshot.settings.height,
        clipCount: snapshot.clips.length,
        lastOpened: Date.now(),
      });
      finishCloseProject();
    } finally {
      setClosing(false);
    }
  };

  const handleOpenLibrary = () => {
    setOpenMenuOpen(false);
    setOpenListOpen(true);
  };

  const handleOpenFile = async () => {
    setOpenMenuOpen(false);
    const result = await window.api.openProjectFile();
    if (!result) return;
    if ('error' in result) {
      alert(`파일 열기 실패: ${result.error}`);
      return;
    }
    loadProject(result.project);
    // 외부 파일에서 열었으니 이후 "저장"은 그 경로에 덮어쓰기
    useProjectStore.getState().setCurrentFilePath(result.filePath);
    addRecentExternal({
      filePath: result.filePath,
      name: result.project.name,
      preset: result.project.settings.preset,
      width: result.project.settings.width,
      height: result.project.settings.height,
      clipCount: result.project.clips.length,
      lastOpened: Date.now(),
    });
    setSavedTo(result.filePath);
  };

  const handleNewProject = () => {
    if (confirm('현재 프로젝트의 변경사항이 자동 저장됩니다. 새 프로젝트를 시작하시겠습니까?')) {
      const snapshot = useProjectStore.getState().getSerializableProject();
      const p = snapshot ? window.api.saveProject(snapshot) : Promise.resolve();
      p.finally(() => {
        useProjectStore.setState({ project: null });
      });
    }
  };

  // 단축키
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (e.shiftKey) handleSaveAs();
        else handleQuickSave();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [project]);

  return (
    <>
      <div className="h-12 panel border-b flex items-center px-4 gap-3">
        <div className="flex items-baseline gap-1.5">
          <div className="font-bold text-lg">
            <span className="text-accent">Frame</span>
            <span className="text-text-primary">Lab</span>
          </div>
          <span className="text-[10px] text-text-muted/70 font-mono" title="프레임랩 버전">
            v{__APP_VERSION__}
          </span>
        </div>
        <div className="w-px h-6 bg-border-subtle" />

        <button onClick={handleNewProject} className="btn-ghost text-sm" title="새 프로젝트">
          📄 새 프로젝트
        </button>

        {/* 열기 드롭다운 */}
        <button onClick={() => setCloseStep('confirm')} className="btn-ghost text-sm" title="현재 프로젝트 닫기">
          닫기
        </button>

        <div className="relative" ref={openMenuRef}>
          <button onClick={() => setOpenMenuOpen((v) => !v)} className="btn-ghost text-sm" title="프로젝트 열기">
            📂 열기 ▾
          </button>
          {openMenuOpen && (
            <div className="absolute top-full left-0 mt-1 w-56 bg-bg-elevated border border-border-subtle rounded-md shadow-xl z-50 py-1">
              <button onClick={handleOpenLibrary} className="w-full text-left px-3 py-2 text-sm hover:bg-bg-hover">
                <div>📚 라이브러리에서 열기</div>
                <div className="text-[10px] text-text-muted">자동 저장된 프로젝트 목록</div>
              </button>
              <button onClick={handleOpenFile} className="w-full text-left px-3 py-2 text-sm hover:bg-bg-hover">
                <div>📁 파일에서 열기...</div>
                <div className="text-[10px] text-text-muted">.framelab.json 직접 선택</div>
              </button>
            </div>
          )}
        </div>

        {/* 저장 드롭다운 */}
        <div className="relative" ref={saveMenuRef}>
          <button onClick={() => setSaveMenuOpen((v) => !v)} className="btn-ghost text-sm" title="저장">
            💾 저장 ▾
          </button>
          {saveMenuOpen && (
            <div className="absolute top-full left-0 mt-1 w-72 bg-bg-elevated border border-border-subtle rounded-md shadow-xl z-50 py-1">
              <button onClick={handleQuickSave} className="w-full text-left px-3 py-2 text-sm hover:bg-bg-hover">
                <div className="flex justify-between">
                  <span>💾 {currentFilePath ? '저장 (덮어쓰기)' : '라이브러리에 저장'}</span>
                  <span className="text-[10px] text-text-muted">Ctrl+S</span>
                </div>
                <div className="text-[10px] text-text-muted truncate">
                  {currentFilePath ? currentFilePath : '자동 위치, 빠른 저장'}
                </div>
              </button>
              <button onClick={handleSaveAs} className="w-full text-left px-3 py-2 text-sm hover:bg-bg-hover">
                <div className="flex justify-between">
                  <span>📥 다른 이름으로 저장...</span>
                  <span className="text-[10px] text-text-muted">Ctrl+Shift+S</span>
                </div>
                <div className="text-[10px] text-text-muted">위치/이름 직접 선택 (.framelab.json)</div>
              </button>
              <div className="border-t border-border-subtle my-1" />
              <button onClick={() => { setSaveMenuOpen(false); setInfoOpen(true); }} className="w-full text-left px-3 py-2 text-xs text-text-muted hover:bg-bg-hover">
                ℹ 저장 형식이란?
              </button>
            </div>
          )}
        </div>

        {savedAt && (
          <span className="text-[10px] text-text-muted truncate max-w-[200px]" title={savedTo}>
            {savedAt.toLocaleTimeString('ko-KR')} 저장됨
          </span>
        )}
        <div className="w-px h-6 bg-border-subtle" />

        {editingName ? (
          <input
            autoFocus
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={() => {
              updateName(draftName.trim() || '제목 없음');
              setEditingName(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') {
                setDraftName(project.name);
                setEditingName(false);
              }
            }}
            className="input py-1 text-sm w-48"
          />
        ) : (
          <button
            onClick={() => {
              setDraftName(project.name);
              setEditingName(true);
            }}
            className="text-text-primary hover:text-accent transition-colors"
          >
            {project.name}
          </button>
        )}
        <span className="text-xs text-text-muted">
          {PRESETS[project.settings.preset].label} · {project.settings.width}×{project.settings.height}
        </span>

        <div className="flex-1" />

        <button onClick={undo} className="btn-ghost" title="실행취소 (Ctrl+Z)">↶</button>
        <button onClick={redo} className="btn-ghost" title="다시실행 (Ctrl+Y)">↷</button>
        <div className="w-px h-6 bg-border-subtle" />
        <button onClick={splitClip} className="btn-secondary" title="컷 (Ctrl+B)">✂ 컷</button>
        <button onClick={() => addText(playhead)} className="btn-secondary">T 자막 추가</button>
        <button onClick={() => setExportOpen(true)} className="btn-primary">내보내기</button>
      </div>
      {exportOpen && <ExportDialog onClose={() => setExportOpen(false)} />}
      {openListOpen && <ProjectListDialog onClose={() => setOpenListOpen(false)} />}
      {infoOpen && <SaveFormatInfoDialog onClose={() => setInfoOpen(false)} />}
      {closeStep && (
        <CloseProjectDialog
          step={closeStep}
          hasFilePath={!!currentFilePath}
          busy={closing}
          onCancel={() => !closing && setCloseStep(null)}
          onConfirmClose={() => setCloseStep('save')}
          onSkipSave={() => finishCloseProject()}
          onChooseSave={() => setCloseStep('method')}
          onQuickSave={handleCloseQuickSave}
          onSaveAs={handleCloseSaveAs}
        />
      )}
    </>
  );
}

function CloseProjectDialog({
  step,
  hasFilePath,
  busy,
  onCancel,
  onConfirmClose,
  onSkipSave,
  onChooseSave,
  onQuickSave,
  onSaveAs,
}: {
  step: Exclude<CloseProjectStep, null>;
  hasFilePath: boolean;
  busy: boolean;
  onCancel: () => void;
  onConfirmClose: () => void;
  onSkipSave: () => void;
  onChooseSave: () => void;
  onQuickSave: () => void;
  onSaveAs: () => void;
}) {
  let title = '프로젝트 닫기';
  let message = '현재 작업을 닫고 메인화면으로 돌아갈까요?';

  if (step === 'save') {
    title = '저장 여부';
    message = '닫기 전에 현재 작업 내용을 저장할까요?';
  } else if (step === 'method') {
    title = '저장 방식';
    message = hasFilePath
      ? '기존 파일에 그대로 저장하거나, 다른 이름으로 저장할 수 있습니다.'
      : '라이브러리에 저장하거나, 다른 이름으로 저장할 수 있습니다.';
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[100]" onClick={onCancel}>
      <div
        className="panel rounded-lg p-6 w-[420px] max-w-[90vw]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold mb-2 text-text-primary">{title}</h2>
        <div className="text-sm text-text-secondary mb-5 whitespace-pre-line">{message}</div>

        {step === 'confirm' && (
          <div className="flex justify-end gap-2">
            <button onClick={onCancel} className="btn-secondary" disabled={busy}>
              취소
            </button>
            <button onClick={onConfirmClose} className="btn-primary" disabled={busy} autoFocus>
              메인화면으로
            </button>
          </div>
        )}

        {step === 'save' && (
          <div className="flex justify-end gap-2">
            <button onClick={onCancel} className="btn-secondary" disabled={busy}>
              취소
            </button>
            <button onClick={onSkipSave} className="btn bg-red-500 hover:bg-red-600 text-white" disabled={busy}>
              저장 안 함
            </button>
            <button onClick={onChooseSave} className="btn-primary" disabled={busy} autoFocus>
              저장
            </button>
          </div>
        )}

        {step === 'method' && (
          <div className="flex justify-end gap-2">
            <button onClick={onCancel} className="btn-secondary" disabled={busy}>
              취소
            </button>
            <button onClick={onSaveAs} className="btn-secondary" disabled={busy}>
              다른 이름으로
            </button>
            <button onClick={onQuickSave} className="btn-primary" disabled={busy} autoFocus>
              {busy ? '저장 중...' : hasFilePath ? '그대로 저장' : '라이브러리에 저장'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function SaveFormatInfoDialog({ onClose }: { onClose: () => void }) {
  const [libPath, setLibPath] = useState('');
  useEffect(() => {
    window.api.libraryPath().then(setLibPath).catch(() => {});
  }, []);
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="panel rounded-lg p-6 w-[560px] max-w-[90vw]" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold mb-3 text-text-primary">프레임랩 저장 형식 안내</h2>
        <div className="space-y-3 text-sm text-text-secondary">
          <div>
            <div className="text-text-primary font-medium mb-1">파일 형식: <code className="bg-bg-surface px-1.5 py-0.5 rounded text-accent">.framelab.json</code></div>
            <p className="text-xs">사람이 읽을 수 있는 JSON 형식. 메모장으로도 열 수 있습니다.</p>
          </div>
          <div>
            <div className="text-text-primary font-medium mb-1">무엇이 저장되나요?</div>
            <ul className="list-disc list-inside text-xs space-y-0.5">
              <li>프로젝트 설정 (해상도, 비율, fps)</li>
              <li>가져온 미디어 파일의 <strong>경로</strong>와 메타데이터</li>
              <li>타임라인 클립 정보 (위치, 길이, 효과, 자막 등)</li>
              <li>트랙/폴더 구성</li>
            </ul>
          </div>
          <div>
            <div className="text-text-primary font-medium mb-1">⚠ 주의</div>
            <p className="text-xs">
              영상/음악 같은 <strong>미디어 파일은 포함되지 않고 경로로만 참조</strong>됩니다.
              원본 미디어 파일을 옮기거나 삭제하면 프로젝트를 다시 열 때 미디어가 안 보일 수 있어요.
            </p>
          </div>
          <div>
            <div className="text-text-primary font-medium mb-1">💾 두 가지 저장 방식</div>
            <ul className="list-disc list-inside text-xs space-y-0.5">
              <li><strong>라이브러리에 저장</strong>: 자동 위치(아래 경로)에 저장. 빠르고 편함</li>
              <li><strong>다른 이름으로 저장</strong>: 위치/이름을 직접 선택해 백업/공유 가능</li>
            </ul>
          </div>
          <div>
            <div className="text-text-primary font-medium mb-1">📚 라이브러리 위치</div>
            <code className="block bg-bg-surface px-2 py-1.5 rounded text-[10px] text-text-muted break-all">
              {libPath || '...'}
            </code>
          </div>
        </div>
        <div className="flex justify-end mt-5">
          <button onClick={onClose} className="btn-primary">알겠습니다</button>
        </div>
      </div>
    </div>
  );
}
