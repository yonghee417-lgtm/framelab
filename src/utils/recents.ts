// 외부 파일(.framelab.json)의 최근 사용 목록 — localStorage 저장
// 라이브러리 프로젝트는 별도 (electron이 폴더 스캔)

const KEY = 'framelab.recentExternalFiles';
const MAX = 20;

export interface RecentExternalFile {
  filePath: string;
  name: string;
  preset?: string;
  width?: number;
  height?: number;
  clipCount?: number;
  lastOpened: number;
}

export function getRecentExternal(): RecentExternalFile[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as RecentExternalFile[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function addRecentExternal(entry: RecentExternalFile): void {
  // 같은 경로가 있으면 제거 후 맨 앞에 다시 추가 (lastOpened 갱신)
  const list = getRecentExternal().filter((r) => r.filePath !== entry.filePath);
  list.unshift(entry);
  localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
}

export function removeRecentExternal(filePath: string): void {
  const list = getRecentExternal().filter((r) => r.filePath !== filePath);
  localStorage.setItem(KEY, JSON.stringify(list));
}
