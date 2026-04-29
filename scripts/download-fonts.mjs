// 상업 사용 가능한 한글/영문 폰트를 다운로드해 assets/fonts/ 에 저장합니다.
// 모두 SIL OFL 또는 자체 무료 라이선스(상업용 OK)인 폰트만 포함.
//
// 실행: node scripts/download-fonts.mjs

import { promises as fs } from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FONT_DIR = path.join(__dirname, '..', 'assets', 'fonts');

// family 이름은 Inspector에서 폰트로 선택할 때 보이는 이름.
// 파일명은 family.ttf 로 저장됨 (FFmpeg drawtext 에서 fontfile 경로로 사용)
const FONTS = [
  // ───────── 한글 (모두 상업 사용 가능, 눈누 등록 폰트 또는 SIL OFL) ─────────
  {
    family: 'Pretendard-Regular',
    ext: 'otf',
    url: 'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@1.3.9/packages/pretendard/dist/public/static/Pretendard-Regular.otf',
  },
  {
    family: 'Pretendard-Bold',
    ext: 'otf',
    url: 'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@1.3.9/packages/pretendard/dist/public/static/Pretendard-Bold.otf',
  },
  {
    family: 'Pretendard-Black',
    ext: 'otf',
    url: 'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@1.3.9/packages/pretendard/dist/public/static/Pretendard-Black.otf',
  },
  {
    family: 'NanumGothic',
    url: 'https://github.com/google/fonts/raw/main/ofl/nanumgothic/NanumGothic-Regular.ttf',
  },
  {
    family: 'NanumGothic-Bold',
    url: 'https://github.com/google/fonts/raw/main/ofl/nanumgothic/NanumGothic-Bold.ttf',
  },
  {
    family: 'NanumMyeongjo',
    url: 'https://github.com/google/fonts/raw/main/ofl/nanummyeongjo/NanumMyeongjo-Regular.ttf',
  },
  {
    family: 'NanumPenScript',
    url: 'https://github.com/google/fonts/raw/main/ofl/nanumpenscript/NanumPenScript-Regular.ttf',
  },
  {
    family: 'BlackHanSans',
    url: 'https://github.com/google/fonts/raw/main/ofl/blackhansans/BlackHanSans-Regular.ttf',
  },
  {
    family: 'DoHyeon',
    url: 'https://github.com/google/fonts/raw/main/ofl/dohyeon/DoHyeon-Regular.ttf',
  },
  {
    family: 'Jua',
    url: 'https://github.com/google/fonts/raw/main/ofl/jua/Jua-Regular.ttf',
  },
  {
    family: 'GamjaFlower',
    url: 'https://github.com/google/fonts/raw/main/ofl/gamjaflower/GamjaFlower-Regular.ttf',
  },
  {
    family: 'SingleDay',
    url: 'https://github.com/google/fonts/raw/main/ofl/singleday/SingleDay-Regular.ttf',
  },
  {
    family: 'GowunDodum',
    url: 'https://github.com/google/fonts/raw/main/ofl/gowundodum/GowunDodum-Regular.ttf',
  },
  {
    family: 'GowunBatang',
    url: 'https://github.com/google/fonts/raw/main/ofl/gowunbatang/GowunBatang-Regular.ttf',
  },

  // ───────── 영문 (Google Fonts, SIL OFL — 상업 사용 가능) ─────────
  {
    family: 'Inter-Regular',
    url: 'https://github.com/google/fonts/raw/main/ofl/inter/Inter%5Bopsz%2Cwght%5D.ttf',
  },
  // Roboto는 안정적인 TTF 직접 다운로드 경로가 없어 제외 (Inter / Lato / OpenSans 로 대체 가능)
  {
    family: 'Montserrat-Regular',
    url: 'https://github.com/google/fonts/raw/main/ofl/montserrat/Montserrat%5Bwght%5D.ttf',
  },
  {
    family: 'Poppins-Regular',
    url: 'https://github.com/google/fonts/raw/main/ofl/poppins/Poppins-Regular.ttf',
  },
  {
    family: 'Poppins-Bold',
    url: 'https://github.com/google/fonts/raw/main/ofl/poppins/Poppins-Bold.ttf',
  },
  {
    family: 'BebasNeue',
    url: 'https://github.com/google/fonts/raw/main/ofl/bebasneue/BebasNeue-Regular.ttf',
  },
  {
    family: 'Oswald',
    url: 'https://github.com/google/fonts/raw/main/ofl/oswald/Oswald%5Bwght%5D.ttf',
  },
  {
    family: 'PlayfairDisplay',
    url: 'https://github.com/google/fonts/raw/main/ofl/playfairdisplay/PlayfairDisplay%5Bwght%5D.ttf',
  },
  {
    family: 'Anton',
    url: 'https://github.com/google/fonts/raw/main/ofl/anton/Anton-Regular.ttf',
  },
  {
    family: 'Lato-Regular',
    url: 'https://github.com/google/fonts/raw/main/ofl/lato/Lato-Regular.ttf',
  },
  {
    family: 'Lato-Bold',
    url: 'https://github.com/google/fonts/raw/main/ofl/lato/Lato-Bold.ttf',
  },
  {
    family: 'OpenSans',
    url: 'https://github.com/googlefonts/opensans/raw/main/fonts/ttf/OpenSans-Regular.ttf',
  },
  {
    family: 'OpenSans-Bold',
    url: 'https://github.com/googlefonts/opensans/raw/main/fonts/ttf/OpenSans-Bold.ttf',
  },
  {
    family: 'Raleway',
    url: 'https://github.com/google/fonts/raw/main/ofl/raleway/Raleway%5Bwght%5D.ttf',
  },
];

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const get = (u, redirects = 0) => {
      if (redirects > 5) return reject(new Error(`Too many redirects: ${url}`));
      https
        .get(u, (res) => {
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            get(new URL(res.headers.location, u).toString(), redirects + 1);
            return;
          }
          if (res.statusCode !== 200) {
            res.resume();
            reject(new Error(`HTTP ${res.statusCode} for ${u}`));
            return;
          }
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            fs.writeFile(dest, Buffer.concat(chunks)).then(resolve, reject);
          });
        })
        .on('error', reject);
    };
    get(url);
  });
}

async function main() {
  await fs.mkdir(FONT_DIR, { recursive: true });
  console.log(`폰트 저장 위치: ${FONT_DIR}\n`);

  let success = 0;
  let failed = 0;

  for (const font of FONTS) {
    const ext = font.ext ?? 'ttf';
    const out = path.join(FONT_DIR, `${font.family}.${ext}`);
    try {
      await fs.access(out);
      console.log(`  ⏭  ${font.family} (이미 존재)`);
      success++;
      continue;
    } catch {}
    try {
      await download(font.url, out);
      console.log(`  ✓ ${font.family}`);
      success++;
    } catch (e) {
      console.log(`  ✗ ${font.family}: ${e.message}`);
      failed++;
    }
  }

  console.log(`\n완료: ${success}개 성공, ${failed}개 실패`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
