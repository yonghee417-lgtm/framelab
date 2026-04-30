import { useEffect, useRef, useState } from 'react';
import { API_ENDPOINTS, APP_CODE } from '../config/api';

export interface Banner {
  id: number;
  imageUrl: string;
  linkUrl: string | null;
  altText: string;
  trackingId: number;
}

const CACHE_KEY = (slotId: string) => `framelab.banner.${slotId}`;
const CACHE_TTL_MS = 1000 * 60 * 30; // 30분 — 오프라인/네트워크 느릴 때 폴백
const FETCH_TIMEOUT_MS = 4000;

interface CachedBanner {
  banner: Banner | null;
  fetchedAt: number;
}

function readCache(slotId: string): CachedBanner | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY(slotId));
    if (!raw) return null;
    return JSON.parse(raw) as CachedBanner;
  } catch {
    return null;
  }
}

function writeCache(slotId: string, banner: Banner | null) {
  try {
    const payload: CachedBanner = { banner, fetchedAt: Date.now() };
    localStorage.setItem(CACHE_KEY(slotId), JSON.stringify(payload));
  } catch {
    // 스토리지 가득 찼거나 차단된 경우 — 무시
  }
}

/**
 * 슬롯에 노출할 배너를 서버에서 가져옴
 *  - 캐시 우선 표시 → 백그라운드 갱신
 *  - 오프라인이거나 서버 다운이면 캐시 유지
 *  - 광고가 없으면 banner === null (BannerSlot이 placeholder 표시)
 */
export function useBanner(slotId: string) {
  const [banner, setBanner] = useState<Banner | null>(() => {
    const cached = readCache(slotId);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return cached.banner;
    }
    return null;
  });
  const impressionLoggedRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);

    (async () => {
      try {
        const url = API_ENDPOINTS.bannerFetch(APP_CODE, slotId, __APP_VERSION__);
        const res = await fetch(url, { signal: ctrl.signal });
        if (!res.ok) throw new Error(`status ${res.status}`);
        const data = (await res.json()) as Banner | null;
        if (cancelled) return;
        setBanner(data);
        writeCache(slotId, data);
      } catch {
        // 실패 시 캐시 유지 — 별도 처리 없음
      } finally {
        clearTimeout(timeout);
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(timeout);
      ctrl.abort();
    };
  }, [slotId]);

  // 노출 카운트(impression) — 동일 배너에 대해 한 번만 보고
  useEffect(() => {
    if (!banner) return;
    if (impressionLoggedRef.current === banner.trackingId) return;
    impressionLoggedRef.current = banner.trackingId;
    const fd = new FormData();
    fd.append('id', String(banner.trackingId));
    fd.append('app', APP_CODE); // 어느 앱에서 노출됐는지 — 통계 분리용
    fetch(API_ENDPOINTS.bannerImpression(), { method: 'POST', body: fd, keepalive: true }).catch(
      () => {},
    );
  }, [banner]);

  return banner;
}
