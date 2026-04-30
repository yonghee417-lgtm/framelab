// 배너 광고 슬롯 — 서버(공감스튜디오)에서 배너를 받아와 노출
// 광고 없거나 네트워크 실패 시 "광고주를 모십니다" placeholder 표시
// 클릭 시 사용자 기본 브라우저로 외부 URL 열기 (Electron shell.openExternal)

import { useBanner } from '../hooks/useBanner';
import { API_ENDPOINTS, APP_CODE } from '../config/api';

interface BannerSlotProps {
  slotId: string;        // 'main-bottom' | 'panel-bottom' 등
  width: number;
  height: number;
  label?: string;        // 슬롯 표시명 (관리/디버깅용)
}

export function BannerSlot({ slotId, width, height, label }: BannerSlotProps) {
  const banner = useBanner(slotId);

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!banner?.linkUrl) return;
    // 클릭 추적 URL을 외부 브라우저에서 열면 → 서버가 카운트 + 실제 광고주 페이지로 302 리디렉션
    const trackUrl = API_ENDPOINTS.bannerClick(banner.trackingId, APP_CODE);
    window.api?.openExternalUrl?.(trackUrl);
  };

  if (banner) {
    return (
      <a
        href={banner.linkUrl ?? '#'}
        onClick={handleClick}
        data-slot={slotId}
        style={{ width, height }}
        className="mx-auto block rounded-md overflow-hidden bg-bg-elevated/40 hover:opacity-90 transition-opacity cursor-pointer"
        title={banner.altText || label || slotId}
      >
        <img
          src={banner.imageUrl}
          alt={banner.altText || ''}
          style={{ width, height, objectFit: 'cover' }}
          draggable={false}
        />
      </a>
    );
  }

  return (
    <div
      data-slot={slotId}
      style={{ width, height }}
      className="mx-auto bg-bg-elevated/50 border border-dashed border-border-strong/60 rounded-md flex flex-col items-center justify-center text-center select-none overflow-hidden"
    >
      <div className="text-text-muted/80 text-sm font-medium">광고주를 모십니다</div>
      <div className="text-[10px] text-text-muted/40 mt-1 font-mono">
        {label ?? slotId} · {width}×{height}
      </div>
    </div>
  );
}
