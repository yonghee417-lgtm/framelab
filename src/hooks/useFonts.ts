import { useEffect, useState } from 'react';

interface FontInfo {
  family: string;
  path: string;
  fileName: string;
}

let loaded = false;
let cached: FontInfo[] = [];

export function useFonts() {
  const [fonts, setFonts] = useState<FontInfo[]>(cached);

  useEffect(() => {
    if (loaded) return;
    if (!window.api) return;

    window.api.listFonts().then(async (list) => {
      cached = list;
      // 동적으로 @font-face 주입
      for (const font of list) {
        try {
          const url = window.api.toMediaUrl(font.path);
          const face = new FontFace(font.family, `url(${url})`);
          await face.load();
          document.fonts.add(face);
        } catch (e) {
          // 폰트 로드 실패는 무시
        }
      }
      loaded = true;
      setFonts(list);
    });
  }, []);

  return fonts;
}
