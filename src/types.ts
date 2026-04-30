// preload.ts 의 contextBridge.exposeInMainWorld('api', ...) 와 매칭

import type { Project, ExportOptions, ExportProgress } from '@shared/types';

// vite.config.ts에서 define으로 주입되는 빌드 시 상수
declare global {
  const __APP_VERSION__: string;
}

export interface FrameLabApi {
  openMediaDialog: () => Promise<string[]>;
  saveExportDialog: (defaultName: string) => Promise<string | null>;
  chooseDirectory: () => Promise<string | null>;
  probeMedia: (filePath: string) => Promise<{
    durationSec: number;
    width?: number;
    height?: number;
    hasAudio: boolean;
  }>;
  generateThumbnail: (filePath: string, kind: string) => Promise<string>;
  generateWaveform: (filePath: string) => Promise<string>;
  generateProxy: (filePath: string) => Promise<string>;
  saveProject: (project: Project) => Promise<string>;
  saveProjectToPath: (project: Project, filePath: string) => Promise<string>;
  saveProjectAs: (project: Project, defaultName?: string) => Promise<string | null>;
  openProjectFile: () => Promise<
    { project: Project; filePath: string } | { error: string } | null
  >;
  openProjectFromPath: (
    filePath: string,
  ) => Promise<{ project: Project; filePath: string } | { error: string }>;
  libraryPath: () => Promise<string>;
  listProjects: () => Promise<Project[]>;
  loadProject: (projectId: string) => Promise<Project>;
  deleteProject: (projectId: string) => Promise<boolean>;
  listFonts: () => Promise<{ family: string; path: string; fileName: string }[]>;
  fontsDir: () => Promise<string>;
  startExport: (project: Project, options: ExportOptions) => Promise<{
    success: boolean;
    outputPath?: string;
    error?: string;
  }>;
  exportSnapshot: (dataUrl: string, defaultName: string) => Promise<string | null>;
  fileExists: (filePath: string) => Promise<boolean>;
  onExportProgress: (cb: (p: ExportProgress) => void) => () => void;
  toMediaUrl: (filePath: string) => string;
  openExternalUrl: (url: string) => Promise<boolean>;
}

declare global {
  interface Window {
    api: FrameLabApi;
  }
}

export {};
