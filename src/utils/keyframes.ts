import type { Keyframe, KeyframeMap, AnimatableProperty } from '@shared/types';

// 시간 기준으로 정렬된 키프레임 배열에서 t 시점의 보간 값 계산
export function interpolate(keyframes: Keyframe[], t: number): number | undefined {
  if (!keyframes || keyframes.length === 0) return undefined;
  if (keyframes.length === 1) return keyframes[0].value;
  // 정렬되어 있다고 가정 (timeSec 오름차순)
  if (t <= keyframes[0].timeSec) return keyframes[0].value;
  if (t >= keyframes[keyframes.length - 1].timeSec) return keyframes[keyframes.length - 1].value;
  for (let i = 0; i < keyframes.length - 1; i++) {
    const a = keyframes[i];
    const b = keyframes[i + 1];
    if (t >= a.timeSec && t <= b.timeSec) {
      const span = b.timeSec - a.timeSec;
      if (span <= 0) return b.value;
      const r = (t - a.timeSec) / span;
      return a.value + (b.value - a.value) * r;
    }
  }
  return keyframes[keyframes.length - 1].value;
}

// 키프레임 배열에서 특정 시점에 가까운 키프레임 찾기 (epsilon 이내)
export function findKeyframeAt(keyframes: Keyframe[] | undefined, t: number, eps = 0.05): number {
  if (!keyframes) return -1;
  return keyframes.findIndex((k) => Math.abs(k.timeSec - t) <= eps);
}

// 새 키프레임 추가/갱신 (같은 시점이 있으면 덮어쓰기), 시간순 정렬 유지
export function setKeyframe(keyframes: Keyframe[] | undefined, kf: Keyframe): Keyframe[] {
  const list = [...(keyframes ?? [])];
  const idx = list.findIndex((k) => Math.abs(k.timeSec - kf.timeSec) <= 0.001);
  if (idx >= 0) list[idx] = kf;
  else list.push(kf);
  list.sort((a, b) => a.timeSec - b.timeSec);
  return list;
}

export function removeKeyframeAt(
  keyframes: Keyframe[] | undefined,
  t: number,
  eps = 0.05,
): Keyframe[] {
  if (!keyframes) return [];
  return keyframes.filter((k) => Math.abs(k.timeSec - t) > eps);
}

// 클립의 현재 시각(클립 상대시간)에서 속성값 가져오기
// keyframe 있으면 보간값, 없으면 fallback (현재 정적 속성)
export function resolveAnimatedValue(
  keyframes: KeyframeMap | undefined,
  prop: AnimatableProperty,
  localTime: number,
  fallback: number,
): number {
  const arr = keyframes?.[prop];
  if (!arr || arr.length === 0) return fallback;
  const v = interpolate(arr, localTime);
  return v ?? fallback;
}
