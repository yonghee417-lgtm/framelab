import { app, BrowserWindow, ipcMain, dialog, protocol, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promises as fs, createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { probeMedia, generateThumbnail, generateWaveform, generateProxy, exportProject } from './ffmpeg';
import type { Project, ExportOptions } from '../shared/types';

// 미디어 프로토콜은 app.whenReady 전에 privileged로 등록해야
// HTML5 <video>/<audio>가 신뢰하고 byte-range 스트리밍을 사용함
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'framelab-media',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      bypassCSP: true,
      stream: true,
      corsEnabled: true,
    },
  },
]);

const MIME_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
  '.avi': 'video/x-msvideo',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));

process.env.APP_ROOT = path.join(__dirname, '..');
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist');

let mainWindow: BrowserWindow | null = null;

function getUserDataDir() {
  const dir = path.join(app.getPath('userData'), 'projects');
  return dir;
}

async function ensureUserDataDir() {
  const dir = getUserDataDir();
  await fs.mkdir(dir, { recursive: true });
  await fs.mkdir(path.join(dir, 'thumbnails'), { recursive: true });
  return dir;
}

let splashWindow: BrowserWindow | null = null;

function getLogoPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'assets', 'Logo.png')
    : path.join(process.env.APP_ROOT!, 'assets', 'Logo.png');
}

function createSplash() {
  splashWindow = new BrowserWindow({
    width: 420,
    height: 360,
    frame: false,
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    show: false,
    backgroundColor: '#0e0e10',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const logoUrl = `file:///${getLogoPath().replace(/\\/g, '/')}`;
  const splashHtml = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<style>
  html, body { margin: 0; padding: 0; height: 100%; overflow: hidden; user-select: none; -webkit-user-select: none; -webkit-app-region: drag; }
  body { background: #0e0e10; color: #f5f5f7; font-family: 'Segoe UI', 'Apple SD Gothic Neo', system-ui, sans-serif; display: flex; align-items: center; justify-content: center; }
  .wrap { display: flex; flex-direction: column; align-items: center; gap: 18px; }
  .logo { width: 180px; height: 180px; object-fit: contain; animation: pulse 1.8s ease-in-out infinite; filter: drop-shadow(0 4px 24px rgba(124, 92, 255, 0.35)); }
  .title { font-size: 22px; font-weight: 700; letter-spacing: 0.5px; }
  .title .accent { color: #7c5cff; }
  .sub { font-size: 11px; color: #9ca3af; opacity: 0.85; }
  .spinner { width: 28px; height: 28px; border: 2px solid rgba(255,255,255,0.12); border-top-color: #7c5cff; border-radius: 50%; animation: spin 0.9s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes pulse { 0%, 100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.04); opacity: 0.92; } }
</style>
</head>
<body>
  <div class="wrap">
    <img class="logo" src="${logoUrl}" onerror="this.style.display='none'" alt="FrameLab" />
    <div class="title"><span class="accent">Frame</span>Lab</div>
    <div class="spinner"></div>
    <div class="sub">로딩 중...</div>
  </div>
</body>
</html>`;

  splashWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(splashHtml));
  splashWindow.once('ready-to-show', () => splashWindow?.show());
  splashWindow.on('closed', () => {
    splashWindow = null;
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    title: 'FrameLab',
    width: 1480,
    height: 920,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#0e0e10',
    autoHideMenuBar: true,
    show: false, // ready-to-show 후에 표시 (splash 닫는 타이밍 동기화)
    icon: getLogoPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });

  if (VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(RENDERER_DIST, 'index.html'));
  }

  // 메인 윈도우가 그릴 준비 끝나면 → 메인 표시 + splash 닫기
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.close();
    }
  });
}

// 로컬 파일을 안전하게 미디어로 로드하기 위한 커스텀 프로토콜
// HTML5 video를 위해 Range 요청 + MIME type + 스트리밍 지원
function registerMediaProtocol() {
  protocol.handle('framelab-media', async (request) => {
    const url = new URL(request.url);
    // 각 세그먼트가 encodeURIComponent로 인코딩되어 있으므로 세그먼트 단위로 디코딩
    const filePath = url.pathname
      .replace(/^\//, '')
      .split('/')
      .map((seg) => decodeURIComponent(seg))
      .join('/');
    try {
      const stat = await fs.stat(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const mime = MIME_TYPES[ext] ?? 'application/octet-stream';
      const range = request.headers.get('range');

      if (range) {
        const match = /bytes=(\d+)-(\d*)/.exec(range);
        if (match) {
          const start = parseInt(match[1], 10);
          const end = match[2] ? parseInt(match[2], 10) : stat.size - 1;
          const stream = createReadStream(filePath, { start, end });
          return new Response(Readable.toWeb(stream) as ReadableStream, {
            status: 206,
            headers: {
              'Content-Range': `bytes ${start}-${end}/${stat.size}`,
              'Accept-Ranges': 'bytes',
              'Content-Length': String(end - start + 1),
              'Content-Type': mime,
            },
          });
        }
      }

      const stream = createReadStream(filePath);
      return new Response(Readable.toWeb(stream) as ReadableStream, {
        headers: {
          'Content-Length': String(stat.size),
          'Accept-Ranges': 'bytes',
          'Content-Type': mime,
        },
      });
    } catch (err) {
      console.error('[framelab-media] 로드 실패:', filePath, err);
      return new Response('Not found', { status: 404 });
    }
  });
}

app.whenReady().then(async () => {
  // 스플래시 먼저 띄워 사용자에게 즉시 피드백
  createSplash();
  registerMediaProtocol();
  await ensureUserDataDir();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ───────────────────────────────────────────────
// IPC: 외부 URL 열기 (배너 광고 클릭 등)
// ───────────────────────────────────────────────
ipcMain.handle('shell:openExternal', async (_e, url: string) => {
  // 안전 가드 — http(s)만 허용
  if (typeof url !== 'string') return false;
  if (!/^https?:\/\//i.test(url)) return false;
  await shell.openExternal(url);
  return true;
});

// ───────────────────────────────────────────────
// IPC: 파일 다이얼로그
// ───────────────────────────────────────────────
ipcMain.handle('dialog:openMedia', async () => {
  if (!mainWindow) return [];
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '미디어 가져오기',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: '모든 미디어', extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'jpg', 'jpeg', 'png', 'webp', 'mp3', 'wav', 'm4a', 'aac', 'flac'] },
      { name: '영상', extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi'] },
      { name: '이미지', extensions: ['jpg', 'jpeg', 'png', 'webp'] },
      { name: '오디오', extensions: ['mp3', 'wav', 'm4a', 'aac', 'flac'] },
    ],
  });
  return result.canceled ? [] : result.filePaths;
});

ipcMain.handle('dialog:saveExport', async (_e, defaultName: string) => {
  if (!mainWindow) return null;
  const result = await dialog.showSaveDialog(mainWindow, {
    title: '영상 내보내기',
    defaultPath: defaultName,
    filters: [{ name: 'MP4 영상', extensions: ['mp4'] }],
  });
  return result.canceled ? null : result.filePath;
});

ipcMain.handle('dialog:chooseDirectory', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '저장 폴더 선택',
    properties: ['openDirectory', 'createDirectory'],
  });
  return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
});

ipcMain.handle('project:delete', async (_e, projectId: string) => {
  const dir = getUserDataDir();
  const filePath = path.join(dir, `${projectId}.framelab.json`);
  try {
    await fs.unlink(filePath);
    return true;
  } catch {
    return false;
  }
});

// 다른 이름으로 저장 — 사용자가 위치+파일명을 직접 선택해서 .framelab.json 저장
ipcMain.handle('project:saveAs', async (_e, project: Project, defaultName?: string) => {
  if (!mainWindow) return null;
  const safeName = (defaultName ?? project.name ?? 'project').replace(/[\\/:*?"<>|]/g, '_');
  const result = await dialog.showSaveDialog(mainWindow, {
    title: '프로젝트를 다른 이름으로 저장',
    defaultPath: `${safeName}.framelab.json`,
    filters: [{ name: '프레임랩 프로젝트', extensions: ['framelab.json', 'json'] }],
  });
  if (result.canceled || !result.filePath) return null;
  await fs.writeFile(result.filePath, JSON.stringify(project, null, 2), 'utf-8');
  return result.filePath;
});

// 알려진 경로의 .framelab.json을 직접 읽기 (다이얼로그 없이)
ipcMain.handle('project:openFromPath', async (_e, filePath: string) => {
  try {
    const data = await fs.readFile(filePath, 'utf-8');
    const project = JSON.parse(data) as Project;
    return { project, filePath };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
});

// 외부 .framelab.json 파일 열기
ipcMain.handle('project:openFile', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '프로젝트 파일 열기',
    properties: ['openFile'],
    filters: [
      { name: '프레임랩 프로젝트', extensions: ['framelab.json', 'json'] },
      { name: '모든 파일', extensions: ['*'] },
    ],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const filePath = result.filePaths[0];
  try {
    const data = await fs.readFile(filePath, 'utf-8');
    const project = JSON.parse(data) as Project;
    return { project, filePath };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
});

// 라이브러리 폴더 (저장된 프로젝트들이 있는 곳) 경로 노출
ipcMain.handle('project:libraryPath', async () => getUserDataDir());

// ───────────────────────────────────────────────
// IPC: 미디어 분석 / 썸네일
// ───────────────────────────────────────────────
ipcMain.handle('media:probe', async (_e, filePath: string) => {
  return probeMedia(filePath);
});

ipcMain.handle('media:thumbnail', async (_e, filePath: string, kind: string) => {
  const dir = path.join(getUserDataDir(), 'thumbnails');
  return generateThumbnail(filePath, kind as 'video' | 'image', dir);
});

ipcMain.handle('media:waveform', async (_e, filePath: string) => {
  const dir = path.join(getUserDataDir(), 'thumbnails');
  return generateWaveform(filePath, dir);
});

ipcMain.handle('media:proxy', async (_e, filePath: string) => {
  const dir = path.join(getUserDataDir(), 'proxies');
  await fs.mkdir(dir, { recursive: true });
  return generateProxy(filePath, dir);
});

// ───────────────────────────────────────────────
// IPC: 프로젝트 저장/로드
// ───────────────────────────────────────────────
ipcMain.handle('project:save', async (_e, project: Project) => {
  const dir = getUserDataDir();
  const filePath = path.join(dir, `${project.id}.framelab.json`);
  await fs.writeFile(filePath, JSON.stringify(project, null, 2), 'utf-8');
  return filePath;
});

// 임의 경로에 덮어쓰기 저장 — 외부 파일 작업 시 사용
ipcMain.handle('project:saveToPath', async (_e, project: Project, filePath: string) => {
  await fs.writeFile(filePath, JSON.stringify(project, null, 2), 'utf-8');
  return filePath;
});

ipcMain.handle('project:list', async () => {
  const dir = getUserDataDir();
  const entries = await fs.readdir(dir);
  const projects: Project[] = [];
  for (const name of entries) {
    if (!name.endsWith('.framelab.json')) continue;
    try {
      const data = await fs.readFile(path.join(dir, name), 'utf-8');
      const p = JSON.parse(data) as Project;
      // 파일 mtime fallback — JSON에 updatedAt 없거나 0인 경우
      try {
        const stat = await fs.stat(path.join(dir, name));
        if (!p.updatedAt || p.updatedAt === 0) {
          p.updatedAt = stat.mtimeMs;
        }
      } catch {}
      projects.push(p);
    } catch {
      // skip invalid
    }
  }
  const sorted = projects.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  console.log(`[project:list] ${sorted.length}개 프로젝트, 라이브러리: ${dir}`);
  for (const p of sorted) {
    console.log(`  - ${p.name} (${new Date(p.updatedAt ?? 0).toLocaleString('ko-KR')})`);
  }
  return sorted;
});

ipcMain.handle('project:load', async (_e, projectId: string) => {
  const dir = getUserDataDir();
  const filePath = path.join(dir, `${projectId}.framelab.json`);
  const data = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(data) as Project;
});

// ───────────────────────────────────────────────
// IPC: 폰트 목록 (번들된 폰트)
// ───────────────────────────────────────────────
ipcMain.handle('fonts:list', async () => {
  const fontDir = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'assets', 'fonts')
    : path.join(process.env.APP_ROOT!, 'assets', 'fonts');
  try {
    const entries = await fs.readdir(fontDir);
    return entries
      .filter((f) => /\.(ttf|otf|woff|woff2)$/i.test(f))
      .map((f) => ({
        family: path.basename(f, path.extname(f)),
        path: path.join(fontDir, f),
        fileName: f,
      }));
  } catch {
    return [];
  }
});

ipcMain.handle('fonts:dir', async () => {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'assets', 'fonts')
    : path.join(process.env.APP_ROOT!, 'assets', 'fonts');
});

// ───────────────────────────────────────────────
// IPC: 영상 내보내기
// ───────────────────────────────────────────────
// 파일 존재 검사
ipcMain.handle('file:exists', async (_e, filePath: string) => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
});

// 정지화면 추출 — 현재 화면(Preview에서 캡처한 dataURL)을 파일로 저장
ipcMain.handle('export:snapshot', async (_e, dataUrl: string, defaultName: string) => {
  if (!mainWindow) return null;
  const safeName = defaultName.replace(/[\\/:*?"<>|]/g, '_');
  const isPng = dataUrl.startsWith('data:image/png');
  const ext = isPng ? 'png' : 'jpg';
  const result = await dialog.showSaveDialog(mainWindow, {
    title: '정지화면 저장',
    defaultPath: `${safeName}.${ext}`,
    filters: [
      { name: '이미지', extensions: ['png', 'jpg', 'jpeg'] },
    ],
  });
  if (result.canceled || !result.filePath) return null;
  // dataURL → buffer
  const base64 = dataUrl.split(',')[1] ?? '';
  const buffer = Buffer.from(base64, 'base64');
  await fs.writeFile(result.filePath, buffer);
  return result.filePath;
});

ipcMain.handle('export:start', async (e, project: Project, options: ExportOptions) => {
  const fontDir = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'assets', 'fonts')
    : path.join(process.env.APP_ROOT!, 'assets', 'fonts');
  return exportProject(project, options, fontDir, (progress) => {
    e.sender.send('export:progress', progress);
  });
});
