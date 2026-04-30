import { useEffect, useMemo, useRef, useState } from 'react';
import type { Project, AspectRatioPreset } from '@shared/types';
import { PRESETS } from '@shared/types';
import { useProjectStore } from '../store/projectStore';
import {
  addRecentExternal,
  getRecentExternal,
  removeRecentExternal,
  type RecentExternalFile,
} from '../utils/recents';
import { ConfirmDialog } from './ConfirmDialog';
import { BannerSlot } from './BannerSlot';

// 통합 목록 항목 — 라이브러리 프로젝트 또는 외부 파일
type RecentItem =
  | { type: 'library'; project: Project; sortTime: number }
  | { type: 'external'; entry: RecentExternalFile; sortTime: number };

export function WelcomeScreen() {
  const createProject = useProjectStore((s) => s.createProject);
  const loadProject = useProjectStore((s) => s.loadProject);
  const [libraryProjects, setLibraryProjects] = useState<Project[]>([]);
  const [externalRecents, setExternalRecents] = useState<RecentExternalFile[]>([]);
  // uncontrolled input — React가 value를 강제하지 않아 IME 상태와 충돌하지 않음
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [preset, setPreset] = useState<AspectRatioPreset>('shorts');
  const [duplicateError, setDuplicateError] = useState<string | null>(null);
  const [pendingDeleteProject, setPendingDeleteProject] = useState<Project | null>(null);
  const [pendingRemoveExternal, setPendingRemoveExternal] = useState<RecentExternalFile | null>(null);

  const refreshRecents = () => {
    window.api?.listProjects().then(setLibraryProjects).catch(() => {});
    setExternalRecents(getRecentExternal());
  };

  useEffect(() => {
    refreshRecents();
  }, []);

  // 라이브러리 + 외부 파일 통합 목록 (시간 내림차순)
  const recentItems: RecentItem[] = useMemo(() => {
    const items: RecentItem[] = [];
    for (const p of libraryProjects) {
      items.push({ type: 'library', project: p, sortTime: p.updatedAt ?? 0 });
    }
    for (const e of externalRecents) {
      items.push({ type: 'external', entry: e, sortTime: e.lastOpened });
    }
    return items.sort((a, b) => b.sortTime - a.sortTime);
  }, [libraryProjects, externalRecents]);

  const handleStart = () => {
    const value = (nameInputRef.current?.value ?? '').trim();
    const finalName = value || '새 프로젝트';
    const dupLibrary = libraryProjects.find((p) => p.name === finalName);
    const dupExternal = externalRecents.find((e) => e.name === finalName);
    if (dupLibrary || dupExternal) {
      setDuplicateError(
        `이미 "${finalName}" 이름의 프로젝트가 있습니다. 다른 이름을 사용하거나 기존 프로젝트를 삭제해주세요.`,
      );
      return;
    }
    setDuplicateError(null);
    createProject(finalName, preset);
  };

  const handleOpenExternal = async (filePath: string) => {
    if (!window.api) return;
    const result = await window.api.openProjectFromPath(filePath);
    if ('error' in result) {
      alert(`파일 열기 실패: ${result.error}\n파일이 이동되거나 삭제됐을 수 있습니다.`);
      // 깨진 항목 정리
      removeRecentExternal(filePath);
      setExternalRecents(getRecentExternal());
      return;
    }
    loadProject(result.project);
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
  };

  return (
    <div className="h-full w-full flex bg-bg-base">
      {/* 왼쪽 - 새 프로젝트 + 하단 배너 */}
      <div className="flex-1 flex flex-col min-h-0">
        <div className="flex-1 flex items-center justify-center p-12 overflow-y-auto min-h-0">
          <div className="w-full max-w-lg">
          <h1 className="text-4xl font-bold mb-2 flex items-baseline gap-2">
            <span>
              <span className="text-accent">Frame</span>
              <span className="text-text-primary">Lab</span>
            </span>
            <span className="text-xs text-text-muted/70 font-mono font-normal" title="프레임랩 버전">
              v{__APP_VERSION__}
            </span>
          </h1>
          <p className="text-text-secondary mb-8">YouTube Shorts · Reels 영상 편집기</p>

          <div className="space-y-6">
            <div>
              <label className="block text-sm text-text-secondary mb-2">프로젝트 이름</label>
              <div className="flex gap-2">
                <input
                  ref={nameInputRef}
                  type="text"
                  defaultValue="새 프로젝트"
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleStart();
                    }
                  }}
                  onKeyUp={(e) => e.stopPropagation()}
                  onKeyPress={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                  onChange={() => duplicateError && setDuplicateError(null)}
                  spellCheck={false}
                  autoComplete="off"
                  className="input flex-1 min-w-0"
                  placeholder="프로젝트 이름"
                />
                <button onClick={handleStart} className="btn-primary px-5 whitespace-nowrap">
                  ▶ 시작
                </button>
              </div>
              {duplicateError && (
                <div className="mt-2 text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded p-2">
                  ⚠ {duplicateError}
                </div>
              )}
            </div>

            <div>
              <label className="block text-sm text-text-secondary mb-3">화면 비율</label>
              {(['mobile', 'youtube', 'cinema'] as const).map((group) => {
                const items = (Object.keys(PRESETS) as AspectRatioPreset[]).filter(
                  (k) => PRESETS[k].group === group,
                );
                if (items.length === 0) return null;
                const groupLabel =
                  group === 'mobile' ? '모바일 / 소셜' : group === 'youtube' ? '유튜브 (가로)' : '시네마 / 와이드';
                return (
                  <div key={group} className="mb-3">
                    <div className="text-[11px] text-text-muted mb-1.5 uppercase tracking-wider">{groupLabel}</div>
                    <div className="grid grid-cols-3 gap-2">
                      {items.map((key) => {
                        const p = PRESETS[key];
                        const isActive = preset === key;
                        const aspect = p.width / p.height;
                        return (
                          <button
                            key={key}
                            onClick={() => setPreset(key)}
                            className={`p-3 rounded-lg border-2 transition-all text-left ${
                              isActive
                                ? 'border-accent bg-accent-subtle'
                                : 'border-border-subtle hover:border-border-strong bg-bg-panel'
                            }`}
                          >
                            <div className="flex items-center justify-center mb-2 h-14">
                              <div
                                className={`border-2 rounded ${isActive ? 'border-accent' : 'border-text-muted'}`}
                                style={{
                                  width: aspect > 1 ? 56 : 56 * aspect,
                                  height: aspect > 1 ? 56 / aspect : 56,
                                }}
                              />
                            </div>
                            <div className="font-semibold text-sm text-text-primary truncate">{p.label}</div>
                            <div className="text-[10px] text-text-muted mt-0.5">
                              {p.width}×{p.height}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              <p className="text-xs text-text-muted mt-2">{PRESETS[preset].description}</p>
            </div>
          </div>
          </div>
        </div>

        {/* 메인화면 하단 배너 광고 (600×60 커스텀 슬림) */}
        <div className="border-t border-border-subtle p-3 flex justify-center bg-bg-base/50 flex-shrink-0">
          <BannerSlot slotId="main-bottom" width={600} height={60} label="메인화면하단배너광고" />
        </div>
      </div>

      {/* 오른쪽 - 최근 프로젝트 (라이브러리 + 외부 파일 통합) */}
      <div className="w-80 panel border-l flex flex-col">
        <div className="p-4 border-b border-border-subtle flex items-center justify-between">
          <h2 className="font-semibold text-text-primary">최근 프로젝트</h2>
          <button
            onClick={async () => {
              const result = await window.api.openProjectFile();
              if (!result) return;
              if ('error' in result) {
                alert(`파일 열기 실패: ${result.error}`);
                return;
              }
              loadProject(result.project);
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
            }}
            className="btn-ghost text-xs"
            title="외부 .framelab.json 파일 직접 찾아 열기"
          >
            📁 찾아 열기
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {recentItems.length === 0 ? (
            <div className="text-text-muted text-sm text-center mt-8 px-4">
              저장된 프로젝트가 없습니다
            </div>
          ) : (
            recentItems.map((item) => {
              if (item.type === 'library') {
                const p = item.project;
                return (
                  <div key={`lib-${p.id}`} className="group relative mb-1">
                    <button
                      onClick={() => loadProject(p)}
                      className="w-full text-left p-3 rounded-md hover:bg-bg-hover transition-colors"
                    >
                      <div className="font-medium text-text-primary truncate flex items-center gap-1.5 pr-6">
                        <span className="text-[10px] text-accent flex-shrink-0">📚</span>
                        <span className="truncate">{p.name}</span>
                      </div>
                      <div className="text-xs text-text-muted mt-0.5">
                        {PRESETS[p.settings.preset].label} ·{' '}
                        {new Date(p.updatedAt).toLocaleString('ko-KR', {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </div>
                    </button>
                    <button
                      onClick={(ev) => {
                        ev.stopPropagation();
                        setPendingDeleteProject(p);
                      }}
                      className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 px-1.5 py-0.5 text-xs rounded text-text-muted hover:text-red-400"
                      title="프로젝트 영구 삭제"
                    >
                      ×
                    </button>
                  </div>
                );
              }
              const e = item.entry;
              const presetLabel = e.preset && (PRESETS as any)[e.preset]?.label;
              return (
                <div key={`ext-${e.filePath}`} className="group relative mb-1">
                  <button
                    onClick={() => handleOpenExternal(e.filePath)}
                    className="w-full text-left p-3 rounded-md hover:bg-bg-hover transition-colors"
                    title={e.filePath}
                  >
                    <div className="font-medium text-text-primary truncate flex items-center gap-1.5">
                      <span className="text-[10px] text-yellow-400 flex-shrink-0">📁</span>
                      <span className="truncate">{e.name}</span>
                    </div>
                    <div className="text-xs text-text-muted mt-0.5">
                      {presetLabel ?? '외부 파일'} ·{' '}
                      {new Date(e.lastOpened).toLocaleString('ko-KR', {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </div>
                    <div className="text-[10px] text-text-muted truncate mt-0.5">{e.filePath}</div>
                  </button>
                  <button
                    onClick={(ev) => {
                      ev.stopPropagation();
                      setPendingRemoveExternal(e);
                    }}
                    className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 px-1.5 py-0.5 text-xs rounded text-text-muted hover:text-red-400"
                    title="최근 목록에서만 제거 (파일 자체는 그대로)"
                  >
                    ×
                  </button>
                </div>
              );
            })
          )}
        </div>
        <div className="p-3 border-t border-border-subtle text-[10px] text-text-muted leading-snug">
          📚 라이브러리 자동 저장 · 📁 외부 파일 (다른 이름으로 저장)<br />
          ×로 라이브러리 영구 삭제 (확인 후) 또는 외부 파일은 목록에서만 제거
        </div>
        {/* 프로젝트 패널 하단 배너 광고 (300×60 커스텀 슬림) */}
        <div className="p-3 border-t border-border-subtle flex justify-center bg-bg-base/40 flex-shrink-0">
          <BannerSlot slotId="panel-bottom" width={300} height={60} label="사이드하단배너" />
        </div>
      </div>

      {pendingRemoveExternal && (
        <ConfirmDialog
          title="최근 목록에서 제거"
          message={
            <>
              <strong className="text-text-primary">"{pendingRemoveExternal.name}"</strong> 을(를) 최근 목록에서 제거하시겠습니까?
              <div className="mt-2 text-text-muted text-xs">
                ✓ 실제 파일은 그대로 유지됩니다 (목록에서만 빠짐)
              </div>
              <div className="mt-1 text-text-muted text-[10px] break-all">{pendingRemoveExternal.filePath}</div>
            </>
          }
          confirmLabel="목록에서 제거"
          cancelLabel="취소"
          onConfirm={() => {
            removeRecentExternal(pendingRemoveExternal.filePath);
            setExternalRecents(getRecentExternal());
            setPendingRemoveExternal(null);
          }}
          onCancel={() => setPendingRemoveExternal(null)}
        />
      )}
      {pendingDeleteProject && (
        <ConfirmDialog
          title="프로젝트 삭제 확인"
          danger
          message={
            <>
              <strong className="text-text-primary">"{pendingDeleteProject.name}"</strong> 프로젝트를 영구 삭제하시겠습니까?
              <div className="mt-2 text-yellow-400 text-xs">
                ⚠ 라이브러리에서 완전히 제거되며 복구할 수 없습니다.
              </div>
              <div className="mt-1 text-text-muted text-xs">
                포함된 클립 {pendingDeleteProject.clips.length}개 · 마지막 작업{' '}
                {new Date(pendingDeleteProject.updatedAt).toLocaleString('ko-KR')}
              </div>
            </>
          }
          confirmLabel="영구 삭제"
          cancelLabel="취소"
          onConfirm={async () => {
            const id = pendingDeleteProject.id;
            setPendingDeleteProject(null);
            await window.api.deleteProject(id);
            refreshRecents();
          }}
          onCancel={() => setPendingDeleteProject(null)}
        />
      )}
    </div>
  );
}
