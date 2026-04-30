// 공감스튜디오 백엔드(API) 엔드포인트 설정
// 카페24 호스팅의 실제 도메인: https://www.gonggamstudio.co.kr
//
// 변경 시 한 곳에서만 수정하면 모든 fetch 호출이 새 도메인으로 전환됨.

export const API_BASE_URL = 'https://www.gonggamstudio.co.kr';

export const API_ENDPOINTS = {
  // 배너 광고
  bannerFetch: (app: string, slot: string, version: string) =>
    `${API_BASE_URL}/api/banners.php?app=${encodeURIComponent(app)}&slot=${encodeURIComponent(
      slot,
    )}&v=${encodeURIComponent(version)}`,
  bannerImpression: () => `${API_BASE_URL}/api/impression.php`,
  bannerClick: (id: number | string, app: string) =>
    `${API_BASE_URL}/api/click.php?id=${id}&app=${encodeURIComponent(app)}`,
} as const;

// 데스크톱 앱 식별 코드 (서버 app_banner_apps 테이블의 code 와 일치)
export const APP_CODE = 'framelab';
