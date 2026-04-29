// FFmpeg 래퍼 — 미디어 분석, 썸네일 생성, 프로젝트 내보내기

import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import ffmpeg from 'fluent-ffmpeg';
import path from 'node:path';
import { promises as fs, existsSync } from 'node:fs';
import crypto from 'node:crypto';
import type {
  Project,
  ExportOptions,
  ExportProgress,
  AnyClip,
  MediaClip,
  TextClip,
  MediaAsset,
  Track,
} from '../shared/types';

function unpackPath(p: string): string {
  return p.replace('app.asar', 'app.asar.unpacked');
}

const FFMPEG_PATH = unpackPath(ffmpegStatic as unknown as string);
const FFPROBE_PATH = unpackPath((ffprobeStatic as unknown as { path: string }).path);

ffmpeg.setFfmpegPath(FFMPEG_PATH);
ffmpeg.setFfprobePath(FFPROBE_PATH);

export interface ProbeResult {
  durationSec: number;
  width?: number;
  height?: number;
  hasAudio: boolean;
}

export async function probeMedia(filePath: string): Promise<ProbeResult> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, data) => {
      if (err) {
        reject(err);
        return;
      }
      const videoStream = data.streams.find((s) => s.codec_type === 'video');
      const audioStream = data.streams.find((s) => s.codec_type === 'audio');
      const durationSec = data.format.duration ?? 0;
      const dims = normalizedStreamDimensions(videoStream);
      resolve({
        durationSec: typeof durationSec === 'number' ? durationSec : parseFloat(String(durationSec)) || 0,
        width: dims.width,
        height: dims.height,
        hasAudio: !!audioStream,
      });
    });
  });
}

function normalizedStreamDimensions(stream: any): { width?: number; height?: number } {
  const width = typeof stream?.width === 'number' ? stream.width : undefined;
  const height = typeof stream?.height === 'number' ? stream.height : undefined;
  if (!width || !height) return { width, height };

  const tagRotation = Number(stream?.tags?.rotate ?? stream?.tags?.Rotate ?? stream?.tags?.Orientation);
  const sideRotation = Array.isArray(stream?.side_data_list)
    ? Number(stream.side_data_list.find((d: any) => d?.rotation !== undefined)?.rotation)
    : NaN;
  const rotation = Number.isFinite(tagRotation) ? tagRotation : sideRotation;
  const normalizedRotation = ((rotation % 360) + 360) % 360;

  if (normalizedRotation === 90 || normalizedRotation === 270) {
    return { width: height, height: width };
  }
  return { width, height };
}

async function probeMediaDimensions(filePath: string): Promise<{ width?: number; height?: number }> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, data) => {
      if (err) {
        reject(err);
        return;
      }
      const videoStream = data.streams.find((s) => s.codec_type === 'video');
      resolve(normalizedStreamDimensions(videoStream));
    });
  });
}

// 프록시 미디어 생성 — 1080p 이상 영상을 720p H.264로 빠르게 인코딩
// 편집 미리보기 성능 향상이 목적. export 시엔 원본 사용.
export async function generateProxy(filePath: string, outDir: string): Promise<string> {
  const hash = crypto.createHash('md5').update(`proxy:${filePath}`).digest('hex').slice(0, 12);
  const outPath = path.join(outDir, `${hash}_proxy.mp4`);
  try {
    await fs.access(outPath);
    return outPath;
  } catch {}

  return new Promise((resolve, reject) => {
    ffmpeg(filePath)
      .outputOptions([
        '-vf', 'scale=-2:720',
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-crf', '28',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-movflags', '+faststart',
      ])
      .output(outPath)
      .on('end', () => resolve(outPath))
      .on('error', reject)
      .run();
  });
}

// 오디오 파형 PNG 생성 (음악 / 오디오가 있는 영상)
export async function generateWaveform(filePath: string, outDir: string): Promise<string> {
  const hash = crypto.createHash('md5').update(`wf:${filePath}`).digest('hex').slice(0, 12);
  const outPath = path.join(outDir, `${hash}_waveform.png`);
  try {
    await fs.access(outPath);
    return outPath;
  } catch {}

  return new Promise((resolve, reject) => {
    ffmpeg(filePath)
      .complexFilter([
        // 가로로 긴 파형, 투명 배경 + 청록색 파형
        'showwavespic=s=1200x100:colors=#10b981@0.9:split_channels=0',
      ])
      .outputOptions(['-frames:v', '1'])
      .output(outPath)
      .on('end', () => resolve(outPath))
      .on('error', reject)
      .run();
  });
}

export async function generateThumbnail(
  filePath: string,
  kind: 'video' | 'image',
  outDir: string,
): Promise<string> {
  const hash = crypto.createHash('md5').update(filePath).digest('hex').slice(0, 12);
  const outPath = path.join(outDir, `${hash}.jpg`);
  try {
    await fs.access(outPath);
    return outPath;
  } catch {}

  return new Promise((resolve, reject) => {
    if (kind === 'image') {
      ffmpeg(filePath)
        .outputOptions(['-vf', 'scale=320:-1', '-frames:v', '1'])
        .output(outPath)
        .on('end', () => resolve(outPath))
        .on('error', reject)
        .run();
    } else {
      ffmpeg(filePath)
        .seekInput('00:00:01')
        .outputOptions(['-vf', 'scale=320:-1', '-frames:v', '1'])
        .output(outPath)
        .on('end', () => resolve(outPath))
        .on('error', reject)
        .run();
    }
  });
}

// ───────────────────────────────────────────────
// Export
// ───────────────────────────────────────────────

const ESCAPE_FOR_FILTER = (s: string) =>
  s
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/:/g, '\\:')
    .replace(/,/g, '\\,');

function resolveFontFile(fontDir: string, family: string): string {
  const ttf = path.join(fontDir, `${family}.ttf`);
  if (existsSync(ttf)) return ttf;
  const otf = path.join(fontDir, `${family}.otf`);
  if (existsSync(otf)) return otf;
  return ttf;
}

function buildDrawText(clip: TextClip, fontDir: string): string {
  const fontFile = resolveFontFile(fontDir, clip.fontFamily).replace(/\\/g, '/');
  const start = clip.startSec;
  const end = start + clip.durationSec;
  const aIn = clip.animationIn ?? 'none';
  const aOut = clip.animationOut ?? 'none';
  const aInDur = clip.animationInSec ?? 0.5;
  const aOutDur = clip.animationOutSec ?? 0.5;

  // drawtext 옵션 값(콜론 구분) 안에 들어가는 expression — 콤마는 escape 필요
  // 작은따옴표로 둘러싸도 일부 ffmpeg 빌드는 expression parser에서 콤마를 옵션 구분으로 오해함
  let xExpr =
    clip.align === 'left'
      ? `${Math.round(clip.x * 100)}*(W/100)`
      : clip.align === 'right'
      ? `W-text_w-${Math.round((1 - clip.x) * 100)}*(W/100)`
      : '(W-text_w)/2';
  let yExpr = `${Math.round(clip.y * 100)}*(H/100)`;

  // 슬라이드 등장/퇴장: x 또는 y에 시간 기반 오프셋 추가
  // expression 안 콤마는 \,로 escape (옵션 구분자와 혼동 방지)
  const inP = aInDur > 0 ? `clip((t-${start.toFixed(3)})/${aInDur.toFixed(3)}\\,0\\,1)` : `1`;
  const outP = aOutDur > 0 ? `clip((${end.toFixed(3)}-t)/${aOutDur.toFixed(3)}\\,0\\,1)` : `1`;
  const inDist = `(1-${inP})`;
  const outDist = `(1-${outP})`;
  const slideOffset = (kind: string, dist: string) => {
    if (kind === 'slide-up') return { dx: 0, dy: `+${dist}*100` };
    if (kind === 'slide-down') return { dx: 0, dy: `-${dist}*100` };
    if (kind === 'slide-left') return { dx: `+${dist}*200`, dy: 0 };
    if (kind === 'slide-right') return { dx: `-${dist}*200`, dy: 0 };
    return null;
  };
  for (const [kind, dist] of [
    [aIn, inDist] as const,
    [aOut, outDist] as const,
  ]) {
    const off = slideOffset(kind, dist);
    if (off) {
      if (off.dx) xExpr = `(${xExpr})${off.dx}`;
      if (off.dy) yExpr = `(${yExpr})${off.dy}`;
    }
  }

  // alpha — fade/pop/zoom류 등장/퇴장은 알파에 진행도 곱
  // expression 옵션은 콤마를 \,로 escape해야 옵션 구분자로 오해 안 됨
  const alphaIn = aIn === 'fade' || aIn === 'pop' || aIn === 'bounce' || aIn === 'typewriter' ? inP : '1';
  const alphaOut = aOut === 'fade' || aOut === 'pop' || aOut === 'bounce' || aOut === 'typewriter' ? outP : '1';
  const alphaExpr = `min(${alphaIn}\\,${alphaOut})`;
  const enableExpr = `between(t\\,${start.toFixed(3)}\\,${end.toFixed(3)})`;

  const parts = [
    `fontfile='${ESCAPE_FOR_FILTER(fontFile)}'`,
    `text='${ESCAPE_FOR_FILTER(clip.text)}'`,
    `fontsize=${clip.fontSize}`,
    `fontcolor=${clip.color.replace('#', '0x')}`,
    `alpha=${alphaExpr}`,
    `x=${xExpr}`,
    `y=${yExpr}`,
    `enable=${enableExpr}`,
  ];
  if (clip.outline) {
    parts.push(`bordercolor=${clip.outlineColor.replace('#', '0x')}`);
    parts.push(`borderw=3`);
  }
  if (clip.shadow) {
    parts.push(`shadowcolor=0x000000@0.6`, `shadowx=2`, `shadowy=2`);
  }
  if (clip.bgColor) {
    parts.push(`box=1`, `boxcolor=${clip.bgColor.replace('#', '0x')}@0.7`, `boxborderw=10`);
  }
  return `drawtext=${parts.join(':')}`;
}

interface FilterContext {
  W: number; // 프로젝트 width
  H: number; // 프로젝트 height
  fps: number;
  fontDir: string;
}

// 비디오/이미지 클립을 가공해서 [outLabel] 라벨로 출력
// 클립의 hflip/vflip/speed/scale/x/y/rotation/fadeIn/fadeOut/brightness 모두 적용
//
// 패딩(letterbox)은 하지 않음 — 검은 배경 위에 overlay로 합성하므로 클립은 자기 비율 그대로 두면 됨
function buildVisualClipFilter(
  clip: MediaClip,
  asset: MediaAsset,
  inputIdx: number,
  outLabel: string,
  ctx: FilterContext,
): string {
  const { W, H, fps } = ctx;
  const scale = clip.scale ?? 1;
  const boxW = Math.max(2, Math.round((W * scale) / 2) * 2);
  const boxH = Math.max(2, Math.round((H * scale) / 2) * 2);
  const speed = clip.speed && clip.speed > 0 ? clip.speed : 1;
  const isImage = clip.kind === 'image';

  const filters: string[] = [];
  filters.push('setsar=1');
  if (isImage) {
    filters.push(`trim=duration=${clip.durationSec.toFixed(3)}`);
    filters.push(`setpts=PTS-STARTPTS+${clip.startSec.toFixed(6)}/TB`);
  } else if (speed !== 1) {
    filters.push(`setpts=${(1 / speed).toFixed(6)}*PTS`);
  }
  filters.push(`fps=${fps}`);
  filters.push(`scale=${boxW}:${boxH}:force_original_aspect_ratio=decrease:force_divisible_by=2`);
  filters.push('format=yuva420p');
  const padW = Math.max(W, boxW);
  const padH = Math.max(H, boxH);
  filters.push(`pad=${padW}:${padH}:(${padW}-iw)/2:(${padH}-ih)/2:color=black@0`);
  if (clip.hflip) filters.push('hflip');
  if (clip.vflip) filters.push('vflip');
  if (clip.rotation && clip.rotation !== 0) {
    const rad = (clip.rotation * Math.PI) / 180;
    filters.push(
      `rotate=${rad.toFixed(6)}:c=black@0:ow=rotw(${rad.toFixed(6)}):oh=roth(${rad.toFixed(6)})`,
    );
  }

  const eqParts: string[] = [];
  if (clip.brightness && clip.brightness !== 0) eqParts.push(`brightness=${clip.brightness.toFixed(3)}`);
  if (clip.saturation !== undefined && clip.saturation !== 0)
    eqParts.push(`saturation=${(1 + clip.saturation).toFixed(3)}`);
  if (clip.contrast !== undefined && clip.contrast !== 0)
    eqParts.push(`contrast=${(1 + clip.contrast).toFixed(3)}`);
  if (clip.gamma !== undefined && clip.gamma !== 1)
    eqParts.push(`gamma=${clip.gamma.toFixed(3)}`);
  if (eqParts.length > 0) filters.push(`eq=${eqParts.join(':')}`);
  if (clip.temperature !== undefined && clip.temperature !== 0) {
    const r = clip.temperature * 0.3;
    const b = -clip.temperature * 0.3;
    filters.push(`colorbalance=rs=${r.toFixed(3)}:bs=${b.toFixed(3)}`);
  }
  if (clip.tint !== undefined && clip.tint !== 0) {
    const g = -clip.tint * 0.3;
    filters.push(`colorbalance=gs=${g.toFixed(3)}`);
  }
  if (clip.fadeInSec > 0) {
    const fadeSt = isImage ? clip.startSec : 0;
    filters.push(`fade=t=in:st=${fadeSt.toFixed(3)}:d=${clip.fadeInSec.toFixed(3)}:alpha=1`);
  }
  if (clip.fadeOutSec > 0) {
    const fadeStart = isImage
      ? clip.startSec + clip.durationSec - clip.fadeOutSec
      : Math.max(0, clip.durationSec - clip.fadeOutSec);
    filters.push(`fade=t=out:st=${fadeStart.toFixed(3)}:d=${clip.fadeOutSec.toFixed(3)}:alpha=1`);
  }
  filters.push('format=yuva420p');

  return `[${inputIdx}:v]${filters.join(',')}[${outLabel}]`;
}

export async function exportProject(
  project: Project,
  options: ExportOptions,
  fontDir: string,
  onProgress: (p: ExportProgress) => void,
): Promise<{ success: boolean; outputPath?: string; error?: string }> {
  try {
    onProgress({ phase: 'preparing', percent: 0, message: '준비 중...' });

    const { width: W, height: H, fps } = project.settings;
    const ctx: FilterContext = { W, H, fps, fontDir };

    const assetMap = new Map<string, MediaAsset>(project.assets.map((a) => [a.id, a]));

    // 트랙 z-order: index 작을수록 위 (DOM/오버레이 순서로는 마지막에 합성)
    const trackOrder = new Map<string, number>();
    [...project.tracks].sort((a, b) => a.index - b.index).forEach((t, i) => trackOrder.set(t.id, i));

    // 숨겨진 트랙 제외
    const hiddenIds = new Set(project.tracks.filter((t) => t.hidden).map((t) => t.id));
    const visualClips = project.clips.filter(
      (c): c is MediaClip =>
        (c.kind === 'video' || c.kind === 'image') && !hiddenIds.has(c.trackId),
    );
    const audioClips = project.clips.filter(
      (c): c is MediaClip => c.kind === 'audio' && !hiddenIds.has(c.trackId),
    );
    const textClips = (project.clips.filter(
      (c): c is TextClip => c.kind === 'text' && !hiddenIds.has(c.trackId),
    )).sort((a, b) => (trackOrder.get(b.trackId) ?? 0) - (trackOrder.get(a.trackId) ?? 0));

    if (visualClips.length === 0 && textClips.length === 0 && audioClips.length === 0) {
      return { success: false, error: '내보낼 클립이 없습니다.' };
    }

    for (const clip of visualClips) {
      const asset = assetMap.get(clip.assetId);
      if (!asset || (asset.width && asset.height)) continue;

      const dims = await probeMediaDimensions(asset.filePath);
      if (dims.width && dims.height) {
        assetMap.set(asset.id, { ...asset, width: dims.width, height: dims.height });
      }
    }

    const totalDuration = Math.max(...project.clips.map((c) => c.startSec + c.durationSec), 0);
    if (totalDuration <= 0) {
      return { success: false, error: '프로젝트 길이가 0초입니다.' };
    }

    const cmd = ffmpeg();

    // ── INPUTS ─────────────────────────────────────
    // 1. 검은 배경 (lavfi color)
    cmd.input(`color=c=black:s=${W}x${H}:r=${fps}:d=${totalDuration.toFixed(3)}`).inputOptions(['-f', 'lavfi']);
    const BG_INPUT_IDX = 0;

    // 2. 비디오/이미지 클립들
    // 이미지는 main과 같은 길이(totalDuration)로 만들어서 PTS sync — tpad 불필요
    // 비디오는 자체 길이로 만들고 시간 시프트는 setpts로 (현재 사용자 케이스에 비디오 없으면 무관)
    const visualInputStartIdx = 1;
    visualClips.forEach((clip) => {
      const asset = assetMap.get(clip.assetId);
      if (!asset) return;
      const speed = clip.speed && clip.speed > 0 ? clip.speed : 1;
      if (clip.kind === 'image') {
        // 이미지는 전체 timeline 길이만큼 loop → main과 길이/PTS 일치
        cmd.input(asset.filePath).inputOptions(['-loop', '1', '-t', String(totalDuration)]);
      } else {
        const sourceLen = clip.durationSec * speed;
        cmd.input(asset.filePath).inputOptions(['-ss', String(clip.inSec), '-t', String(sourceLen)]);
      }
    });

    // 3. 오디오 클립들 (영상 클립 다음 인덱스)
    const audioInputStartIdx = visualInputStartIdx + visualClips.length;
    audioClips.forEach((clip) => {
      const asset = assetMap.get(clip.assetId);
      if (!asset) return;
      const speed = clip.speed && clip.speed > 0 ? clip.speed : 1;
      const sourceLen = clip.durationSec * speed;
      cmd.input(asset.filePath).inputOptions(['-ss', String(clip.inSec), '-t', String(sourceLen)]);
    });

    // ── FILTER GRAPH ────────────────────────────────
    const filters: string[] = [];

    // 검은 배경을 fps 보정
    filters.push(`[${BG_INPUT_IDX}:v]fps=${fps},setsar=1,format=yuv420p[bg]`);

    // 각 비주얼 클립을 [v_i] 라벨로 가공
    const visualLabels: { clipIdx: number; label: string; clip: MediaClip; trackOrderIndex: number }[] = [];
    visualClips.forEach((clip, i) => {
      const asset = assetMap.get(clip.assetId);
      if (!asset) return;
      const inputIdx = visualInputStartIdx + i;
      const label = `vp${i}`;
      filters.push(buildVisualClipFilter(clip, asset, inputIdx, label, ctx));
      visualLabels.push({
        clipIdx: i,
        label,
        clip,
        trackOrderIndex: trackOrder.get(clip.trackId) ?? 0,
      });
    });

    // z-order: 작은 index가 위 → DOM 합성 순서는 큰 index부터(아래쪽 트랙) → 작은 index(위쪽 트랙)으로
    // overlay 체인은 아래쪽부터 그려서 마지막에 위쪽이 덮음
    visualLabels.sort((a, b) => b.trackOrderIndex - a.trackOrderIndex);

    let lastVideoLabel = 'bg';
    visualLabels.forEach((vl, i) => {
      const nextLabel = i === visualLabels.length - 1 && textClips.length === 0 ? 'vfinal' : `vmix${i}`;
      const start = vl.clip.startSec;
      const end = start + vl.clip.durationSec;
      // 기본 위치
      const baseX = `(W-w)/2+(${(vl.clip.x ?? 0.5) - 0.5})*W`;
      const baseY = `(H-h)/2+(${(vl.clip.y ?? 0.5) - 0.5})*H`;
      // 트랜지션에 따라 시간 기반 x/y 식 변형
      const tIn = vl.clip.transitionIn ?? 'none';
      const tOut = vl.clip.transitionOut ?? 'none';
      const tInDur = vl.clip.transitionInSec ?? 0;
      const tOutDur = vl.clip.transitionOutSec ?? 0;

      // 진행도 식 (0~1)
      const inProg = tInDur > 0 ? `min(1,(t-${start.toFixed(3)})/${tInDur.toFixed(3)})` : `1`;
      const outProg = tOutDur > 0 ? `min(1,(${end.toFixed(3)}-t)/${tOutDur.toFixed(3)})` : `1`;
      // 활성 효과 진행도 (작은 쪽)
      const prog = `min(${inProg}\\,${outProg})`;
      const dist = `(1-${prog})`; // 1=시작점, 0=완료

      // 트랜지션 종류별 x/y 변형
      let xExpr = baseX;
      let yExpr = baseY;
      const slideFn = (kind: string, distExpr: string) => {
        if (kind === 'slide-left') return { dx: `+${distExpr}*W`, dy: '' };
        if (kind === 'slide-right') return { dx: `-${distExpr}*W`, dy: '' };
        if (kind === 'slide-up') return { dx: '', dy: `+${distExpr}*H` };
        if (kind === 'slide-down') return { dx: '', dy: `-${distExpr}*H` };
        return null;
      };
      // in 또는 out 중 활성 효과(현재 진행 중인 쪽)에 따라 수식
      // 단순화: in과 out 둘 다 적용 (자연스럽게 더 영향이 큰 쪽이 보임)
      for (const [kind, durExpr] of [
        [tIn, inProg] as const,
        [tOut, outProg] as const,
      ]) {
        if (kind === 'none' || kind === 'fade' || kind === 'zoom-in' || kind === 'zoom-out' || kind === 'wipe-left' || kind === 'wipe-right') continue;
        const d = `(1-${durExpr})`;
        const off = slideFn(kind, d);
        if (off) {
          if (off.dx) xExpr = `(${xExpr})${off.dx}`;
          if (off.dy) yExpr = `(${yExpr})${off.dy}`;
        }
      }

      // 추가: 알파 곱 (페이드/줌 + 와이프 효과는 [vp_i] 자체에 적용)
      const useFade = tIn === 'fade' || tOut === 'fade' || tIn === 'zoom-in' || tIn === 'zoom-out' || tOut === 'zoom-in' || tOut === 'zoom-out';
      const useWipe = tIn === 'wipe-left' || tIn === 'wipe-right' || tOut === 'wipe-left' || tOut === 'wipe-right';

      let processedLabel = vl.label;
      if (useFade) {
        // 알파 채널을 시간 기반으로 곱 — colorchannelmixer 또는 fade 필터 사용
        // 단순화: fade in + fade out 필터 추가
        const stages: string[] = [];
        if ((tIn === 'fade' || tIn === 'zoom-in' || tIn === 'zoom-out') && tInDur > 0) {
          const fStart = vl.clip.kind === 'image' ? vl.clip.startSec : 0;
          stages.push(`fade=t=in:st=${fStart.toFixed(3)}:d=${tInDur.toFixed(3)}:alpha=1`);
        }
        if ((tOut === 'fade' || tOut === 'zoom-in' || tOut === 'zoom-out') && tOutDur > 0) {
          const fStart = vl.clip.kind === 'image'
            ? vl.clip.startSec + Math.max(0, vl.clip.durationSec - tOutDur)
            : Math.max(0, vl.clip.durationSec - tOutDur);
          stages.push(`fade=t=out:st=${fStart.toFixed(3)}:d=${tOutDur.toFixed(3)}:alpha=1`);
        }
        if (stages.length > 0) {
          const newLabel = `${vl.label}_t`;
          filters.push(`[${vl.label}]${stages.join(',')}[${newLabel}]`);
          processedLabel = newLabel;
        }
      }
      if (useWipe) {
        // 와이프: crop을 시간 기반으로
        // wipe-left: 왼쪽에서 오른쪽으로 채워짐 (in) → crop w = w*progress
        // 단순화: in/out 분리하지 않고 in만 처리. out은 페이드로 fallback
        const wipeKind = tIn === 'wipe-left' || tIn === 'wipe-right' ? tIn : (tOut === 'wipe-left' || tOut === 'wipe-right' ? tOut : null);
        if (wipeKind && tInDur > 0) {
          // crop=w=iw*p:h=ih:x=...
          const newLabel = `${processedLabel}_w`;
          const p = vl.clip.kind === 'image'
            ? `min(1\\,(t-${vl.clip.startSec.toFixed(3)})/${tInDur.toFixed(3)})`
            : `min(1\\,t/${tInDur.toFixed(3)})`;
          if (wipeKind === 'wipe-left') {
            filters.push(`[${processedLabel}]crop=w=iw*${p}:h=ih:x=0:y=0[${newLabel}]`);
          } else {
            filters.push(`[${processedLabel}]crop=w=iw*${p}:h=ih:x=iw-iw*${p}:y=0[${newLabel}]`);
          }
          processedLabel = newLabel;
        }
      }

      // 시간 동기화:
      //  - 이미지: 입력 단계에서 -loop 1 -t totalDuration → main과 동일 길이/PTS (sync 자동)
      //  - 비디오: 자체 길이만큼만 들어오므로 setpts로 PTS 시프트 (현재 사용자 케이스 무관)
      if (vl.clip.kind === 'video' && vl.clip.startSec > 0) {
        const shiftedLabel = `${processedLabel}_shift`;
        filters.push(
          `[${processedLabel}]setpts=PTS+${vl.clip.startSec.toFixed(6)}/TB[${shiftedLabel}]`,
        );
        processedLabel = shiftedLabel;
      }

      filters.push(
        `[${lastVideoLabel}][${processedLabel}]overlay=x=${xExpr}:y=${yExpr}:enable='between(t,${start.toFixed(3)},${end.toFixed(3)})'[${nextLabel}]`,
      );
      lastVideoLabel = nextLabel;
    });

    // 자막 (drawtext) — 각 자막을 별도 chain으로 분리 (세미콜론 ; 으로 구분)
    // 콤마로 join하면 drawtext 옵션 안의 콤마와 충돌해 ffmpeg 파서가 깨짐
    // textClips는 trackOrder 내림차순 → 작은 trackOrder(위 트랙)가 마지막 = 위에 그려짐 ✓
    if (textClips.length > 0) {
      let cursor = lastVideoLabel;
      textClips.forEach((c, i) => {
        const next = i === textClips.length - 1 ? 'vfinal' : `vt${i}`;
        filters.push(`[${cursor}]${buildDrawText(c, fontDir)}[${next}]`);
        cursor = next;
      });
      lastVideoLabel = 'vfinal';
    }

    // 비주얼이 하나도 없을 때 (자막 only)
    if (visualLabels.length === 0 && textClips.length === 0) {
      filters.push(`[bg]copy[vfinal]`);
      lastVideoLabel = 'vfinal';
    } else if (visualLabels.length === 0 && textClips.length > 0) {
      // bg → drawtext 했음 → lastVideoLabel = 'vfinal'
    } else if (lastVideoLabel !== 'vfinal') {
      filters.push(`[${lastVideoLabel}]copy[vfinal]`);
      lastVideoLabel = 'vfinal';
    }

    // ── AUDIO ──────────────────────────────────────
    const audioStreamLabels: string[] = [];

    const buildAudioChain = (clip: MediaClip, inputIdx: number, label: string) => {
      const vol = clip.volume ?? 1;
      const speed = clip.speed && clip.speed > 0 ? clip.speed : 1;
      const atempoChain = buildAtempoChain(speed); // 끝에 콤마 포함
      const delayMs = Math.round(clip.startSec * 1000);
      const eqFilters: string[] = [];
      if (clip.audioDenoise) eqFilters.push('afftdn=nf=-25');
      if (clip.audioBass !== undefined && clip.audioBass !== 0)
        eqFilters.push(`equalizer=f=100:t=h:width=200:g=${clip.audioBass.toFixed(2)}`);
      if (clip.audioMid !== undefined && clip.audioMid !== 0)
        eqFilters.push(`equalizer=f=1000:t=h:width=1500:g=${clip.audioMid.toFixed(2)}`);
      if (clip.audioTreble !== undefined && clip.audioTreble !== 0)
        eqFilters.push(`equalizer=f=8000:t=h:width=4000:g=${clip.audioTreble.toFixed(2)}`);
      // 오디오 페이드 — afade 필터 (atempo로 길이 변경된 후 시간 기준으로 적용되어야 하므로 atempo 다음, volume 전)
      const fadeFilters: string[] = [];
      if (clip.fadeInSec > 0) {
        fadeFilters.push(`afade=t=in:st=0:d=${clip.fadeInSec.toFixed(3)}`);
      }
      if (clip.fadeOutSec > 0) {
        const fadeStart = Math.max(0, clip.durationSec - clip.fadeOutSec);
        fadeFilters.push(`afade=t=out:st=${fadeStart.toFixed(3)}:d=${clip.fadeOutSec.toFixed(3)}`);
      }
      const eqChain = eqFilters.length > 0 ? eqFilters.join(',') + ',' : '';
      const fadeChain = fadeFilters.length > 0 ? fadeFilters.join(',') + ',' : '';
      filters.push(
        `[${inputIdx}:a]${atempoChain}${eqChain}${fadeChain}volume=${vol.toFixed(3)},adelay=${delayMs}|${delayMs}[${label}]`,
      );
      audioStreamLabels.push(label);
    };

    visualClips.forEach((clip, i) => {
      const asset = assetMap.get(clip.assetId);
      if (!asset || clip.kind !== 'video' || !asset.hasAudio) return;
      const inputIdx = visualInputStartIdx + i;
      buildAudioChain(clip, inputIdx, `va${i}`);
    });

    audioClips.forEach((clip, i) => {
      const inputIdx = audioInputStartIdx + i;
      buildAudioChain(clip, inputIdx, `aa${i}`);
    });

    let audioOutputArgs: string[] = [];
    if (audioStreamLabels.length > 0) {
      const mixInputs = audioStreamLabels.map((l) => `[${l}]`).join('');
      filters.push(`${mixInputs}amix=inputs=${audioStreamLabels.length}:normalize=0:duration=longest[aout]`);
      audioOutputArgs = ['-map', '[aout]'];
    } else {
      filters.push(`anullsrc=channel_layout=stereo:sample_rate=48000[aout]`);
      audioOutputArgs = ['-map', '[aout]'];
    }

    // fluent-ffmpeg의 complexFilter() 헬퍼가 spawn 인자 처리에서
    // 작은따옴표/콤마 escape를 잘못 split하는 케이스가 있어 raw string으로 직접 전달
    const filterGraphStr = filters.join(';');
    cmd.outputOptions([
      '-filter_complex', filterGraphStr,
      '-map', `[${lastVideoLabel}]`,
      ...audioOutputArgs,
      '-c:v', 'libx264',
      '-preset', options.preset,
      '-b:v', options.videoBitrate,
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-r', String(fps),
      '-t', String(totalDuration),
      '-shortest',
    ]);

    cmd.output(options.outputPath);

    return new Promise((resolve) => {
      let stderrBuffer = '';
      let lastReportedPercent = -1;
      let lastReportedTime = 0;
      const reportProgress = (percent: number, currentTime: number, fpsInfo?: number) => {
        // 너무 자주 보내지 않게: 0.5% 또는 0.3초 단위로만
        if (
          Math.abs(percent - lastReportedPercent) < 0.5 &&
          Math.abs(currentTime - lastReportedTime) < 0.3
        ) {
          return;
        }
        lastReportedPercent = percent;
        lastReportedTime = currentTime;
        const fpsLabel = fpsInfo ? ` · ${fpsInfo.toFixed(0)}fps` : '';
        const remaining = totalDuration - currentTime;
        const remainLabel = remaining > 0 ? ` · 남은 ${remaining.toFixed(1)}초` : '';
        onProgress({
          phase: 'rendering',
          percent,
          message: `${percent.toFixed(1)}%${fpsLabel}${remainLabel}`,
        });
      };

      cmd
        .on('start', (cmdLine) => {
          console.log('[ffmpeg start]', cmdLine);
          onProgress({ phase: 'rendering', percent: 0, message: '렌더링 시작...' });
        })
        .on('stderr', (line) => {
          stderrBuffer += line + '\n';
          if (stderrBuffer.length > 5000) stderrBuffer = stderrBuffer.slice(-5000);
          // ffmpeg stderr에서 time=HH:MM:SS.ss와 fps 파싱 → 정확한 진행률 계산
          // 예: "frame= 360 fps= 30 q=29.0 size=    1024kB time=00:00:12.00 bitrate=..."
          const tm = /time=(\d+):(\d+):([\d.]+)/.exec(line);
          if (tm) {
            const h = parseInt(tm[1], 10);
            const m = parseInt(tm[2], 10);
            const s = parseFloat(tm[3]);
            const elapsed = h * 3600 + m * 60 + s;
            const percent = Math.min(99, Math.max(0, (elapsed / totalDuration) * 100));
            const fpsMatch = /fps=\s*([\d.]+)/.exec(line);
            const fpsVal = fpsMatch ? parseFloat(fpsMatch[1]) : undefined;
            reportProgress(percent, elapsed, fpsVal);
          }
        })
        .on('progress', (p) => {
          // fluent-ffmpeg 자체 progress는 fallback (percent 부정확할 수 있음)
          if (typeof p.percent === 'number' && p.percent > lastReportedPercent) {
            const percent = Math.min(99, Math.max(0, p.percent));
            reportProgress(percent, lastReportedTime);
          }
        })
        .on('end', () => {
          onProgress({ phase: 'done', percent: 100, message: '완료' });
          resolve({ success: true, outputPath: options.outputPath });
        })
        .on('error', (err) => {
          console.error('[ffmpeg error]', err.message, '\n', stderrBuffer);
          onProgress({ phase: 'error', percent: 0, message: err.message });
          resolve({ success: false, error: `${err.message}\n${stderrBuffer.slice(-500)}` });
        })
        .run();
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    onProgress({ phase: 'error', percent: 0, message: msg });
    return { success: false, error: msg };
  }
}

// atempo는 0.5~100 범위만 지원. 그 외는 체이닝
function buildAtempoChain(speed: number): string {
  if (speed === 1) return '';
  const filters: string[] = [];
  let remaining = speed;
  while (remaining < 0.5) {
    filters.push('atempo=0.5');
    remaining /= 0.5;
  }
  while (remaining > 100) {
    filters.push('atempo=100');
    remaining /= 100;
  }
  if (Math.abs(remaining - 1) > 0.001) {
    filters.push(`atempo=${remaining.toFixed(4)}`);
  }
  return filters.length > 0 ? filters.join(',') + ',' : '';
}
