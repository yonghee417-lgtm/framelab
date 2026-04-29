import { useEffect, useState } from 'react';
import { useProjectStore } from './store/projectStore';
import { WelcomeScreen } from './components/WelcomeScreen';
import { Editor } from './components/Editor';
import { useFonts } from './hooks/useFonts';

export function App() {
  const project = useProjectStore((s) => s.project);
  const [bootMsg, setBootMsg] = useState<string | null>('초기화 중...');
  useFonts();

  useEffect(() => {
    // API 연결 확인
    if (!window.api) {
      setBootMsg('Electron 환경이 감지되지 않았습니다. dev 서버에서 직접 열지 마시고 `npm run dev`로 실행하세요.');
      return;
    }
    setBootMsg(null);
  }, []);

  // 자동 저장 — 3중 안전망:
  //   (1) 변경 시 1초 디바운스 (가벼운 변경)
  //   (2) 30초마다 강제 인터벌 저장 (오래 작업해도 안전)
  //   (3) 창 포커스를 잃거나 닫기 직전에 즉시 저장
  // currentFilePath가 있으면 그 경로에 덮어쓰기, 없으면 라이브러리에 저장
  const saveNow = () => {
    const state = useProjectStore.getState();
    const snapshot = state.getSerializableProject();
    if (!snapshot) return;
    if (state.currentFilePath) {
      window.api?.saveProjectToPath(snapshot, state.currentFilePath).catch(() => {});
    } else {
      window.api?.saveProject(snapshot).catch(() => {});
    }
  };

  useEffect(() => {
    if (!project) return;
    const t = setTimeout(saveNow, 1000);
    return () => clearTimeout(t);
  }, [project]);

  useEffect(() => {
    if (!project) return;
    const interval = setInterval(saveNow, 30_000);
    window.addEventListener('blur', saveNow);
    window.addEventListener('beforeunload', saveNow);
    return () => {
      clearInterval(interval);
      window.removeEventListener('blur', saveNow);
      window.removeEventListener('beforeunload', saveNow);
    };
  }, [project?.id]);

  if (bootMsg) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-bg-base text-text-secondary">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-text-primary mb-2">FrameLab</h1>
          <p>{bootMsg}</p>
        </div>
      </div>
    );
  }

  return project ? <Editor /> : <WelcomeScreen />;
}
