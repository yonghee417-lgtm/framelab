import { contextBridge, ipcRenderer } from 'electron';
import type { Project, ExportOptions, ExportProgress } from '../shared/types';

const api = {
  // 다이얼로그
  openMediaDialog: (): Promise<string[]> => ipcRenderer.invoke('dialog:openMedia'),
  saveExportDialog: (defaultName: string): Promise<string | null> =>
    ipcRenderer.invoke('dialog:saveExport', defaultName),
  chooseDirectory: (): Promise<string | null> => ipcRenderer.invoke('dialog:chooseDirectory'),

  // 미디어
  probeMedia: (filePath: string) => ipcRenderer.invoke('media:probe', filePath),
  generateThumbnail: (filePath: string, kind: string) =>
    ipcRenderer.invoke('media:thumbnail', filePath, kind),
  generateWaveform: (filePath: string): Promise<string> =>
    ipcRenderer.invoke('media:waveform', filePath),
  generateProxy: (filePath: string): Promise<string> =>
    ipcRenderer.invoke('media:proxy', filePath),

  // 프로젝트
  saveProject: (project: Project) => ipcRenderer.invoke('project:save', project),
  saveProjectToPath: (project: Project, filePath: string): Promise<string> =>
    ipcRenderer.invoke('project:saveToPath', project, filePath),
  saveProjectAs: (project: Project, defaultName?: string): Promise<string | null> =>
    ipcRenderer.invoke('project:saveAs', project, defaultName),
  openProjectFile: (): Promise<
    { project: Project; filePath: string } | { error: string } | null
  > => ipcRenderer.invoke('project:openFile'),
  openProjectFromPath: (
    filePath: string,
  ): Promise<{ project: Project; filePath: string } | { error: string }> =>
    ipcRenderer.invoke('project:openFromPath', filePath),
  libraryPath: (): Promise<string> => ipcRenderer.invoke('project:libraryPath'),
  listProjects: (): Promise<Project[]> => ipcRenderer.invoke('project:list'),
  loadProject: (projectId: string): Promise<Project> => ipcRenderer.invoke('project:load', projectId),
  deleteProject: (projectId: string): Promise<boolean> => ipcRenderer.invoke('project:delete', projectId),

  // 폰트
  listFonts: (): Promise<{ family: string; path: string; fileName: string }[]> =>
    ipcRenderer.invoke('fonts:list'),
  fontsDir: (): Promise<string> => ipcRenderer.invoke('fonts:dir'),

  // 내보내기
  startExport: (project: Project, options: ExportOptions) =>
    ipcRenderer.invoke('export:start', project, options),
  exportSnapshot: (dataUrl: string, defaultName: string): Promise<string | null> =>
    ipcRenderer.invoke('export:snapshot', dataUrl, defaultName),
  fileExists: (filePath: string): Promise<boolean> => ipcRenderer.invoke('file:exists', filePath),
  onExportProgress: (callback: (progress: ExportProgress) => void) => {
    const listener = (_e: unknown, progress: ExportProgress) => callback(progress);
    ipcRenderer.on('export:progress', listener);
    return () => ipcRenderer.off('export:progress', listener);
  },

  // 미디어 URL 변환 (file:// → framelab-media://)
  // 한글, 공백, 특수문자가 포함된 경로도 안전하게 처리
  toMediaUrl: (filePath: string) => {
    const normalized = filePath.replace(/\\/g, '/');
    // 슬래시는 보존하고 각 세그먼트만 인코딩 (콜론 등 윈도우 드라이브 문자 보호)
    const encoded = normalized
      .split('/')
      .map((seg) => encodeURIComponent(seg))
      .join('/');
    return `framelab-media://local/${encoded}`;
  },
};

contextBridge.exposeInMainWorld('api', api);

export type FrameLabApi = typeof api;
