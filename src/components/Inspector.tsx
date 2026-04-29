import { useState } from 'react';
import { useProjectStore } from '../store/projectStore';
import type {
  MediaClip,
  TextClip,
  TransitionKind,
  TextAnimation,
  AnimatableProperty,
} from '@shared/types';
import { useFonts } from '../hooks/useFonts';
import { SUBTITLE_PRESETS } from '../data/subtitlePresets';

// ───────────────── 상수 ─────────────────

const ALIGN_GRID: { x: number; y: number; icon: string; label: string }[][] = [
  [
    { x: 0, y: 0, icon: '↖', label: '왼쪽 위' },
    { x: 0.5, y: 0, icon: '↑', label: '가운데 위' },
    { x: 1, y: 0, icon: '↗', label: '오른쪽 위' },
  ],
  [
    { x: 0, y: 0.5, icon: '←', label: '왼쪽 가운데' },
    { x: 0.5, y: 0.5, icon: '✜', label: '정 가운데' },
    { x: 1, y: 0.5, icon: '→', label: '오른쪽 가운데' },
  ],
  [
    { x: 0, y: 1, icon: '↙', label: '왼쪽 아래' },
    { x: 0.5, y: 1, icon: '↓', label: '가운데 아래' },
    { x: 1, y: 1, icon: '↘', label: '오른쪽 아래' },
  ],
];

const TEXT_ANIMATIONS: { value: TextAnimation; label: string }[] = [
  { value: 'none', label: '없음' },
  { value: 'fade', label: '페이드' },
  { value: 'typewriter', label: '타이핑' },
  { value: 'slide-up', label: '↑슬라이드' },
  { value: 'slide-down', label: '↓슬라이드' },
  { value: 'slide-left', label: '←슬라이드' },
  { value: 'slide-right', label: '→슬라이드' },
  { value: 'pop', label: '팝(확대)' },
  { value: 'bounce', label: '바운스' },
];

const TRANSITIONS: { value: TransitionKind; label: string }[] = [
  { value: 'none', label: '없음' },
  { value: 'fade', label: '페이드' },
  { value: 'slide-left', label: '←슬라이드' },
  { value: 'slide-right', label: '→슬라이드' },
  { value: 'slide-up', label: '↑슬라이드' },
  { value: 'slide-down', label: '↓슬라이드' },
  { value: 'zoom-in', label: '줌인' },
  { value: 'zoom-out', label: '줌아웃' },
  { value: 'wipe-left', label: '←와이프' },
  { value: 'wipe-right', label: '→와이프' },
];

// ───────────────── 메인 ─────────────────

export function Inspector() {
  const project = useProjectStore((s) => s.project);
  const selectedId = useProjectStore((s) => s.selectedClipId);
  const selectedIds = useProjectStore((s) => s.selectedClipIds);
  const updateClip = useProjectStore((s) => s.updateClip);
  const fonts = useFonts();

  const clip = project?.clips.find((c) => c.id === selectedId);
  const multiCount = selectedIds.length;

  if (!clip) {
    return (
      <>
        <div className="p-3 border-b border-border-subtle">
          <h3 className="font-semibold text-text-primary">속성</h3>
        </div>
        <div className="flex-1 flex items-center justify-center text-text-muted text-sm p-6 text-center">
          타임라인의 클립을 선택하면<br />속성을 편집할 수 있습니다
        </div>
      </>
    );
  }

  const kindLabel =
    clip.kind === 'text' ? '자막' : clip.kind === 'video' ? '영상' : clip.kind === 'image' ? '이미지' : '오디오';

  return (
    <>
      <div className="p-3 border-b border-border-subtle">
        <h3 className="font-semibold text-text-primary">
          {kindLabel} 속성
          {multiCount > 1 && (
            <span className="ml-2 text-[11px] font-normal text-accent">
              · {multiCount}개 선택됨 (변경 시 모두 적용)
            </span>
          )}
        </h3>
      </div>
      {/* 타이밍은 항상 표시 (탭 바깥) */}
      <div className="px-4 pt-3 pb-2 border-b border-border-subtle bg-bg-base/40">
        <div className="grid grid-cols-2 gap-2">
          <Field label="시작">
            <input
              type="number"
              step="0.1"
              value={clip.startSec.toFixed(2)}
              onChange={(e) => updateClip(clip.id, { startSec: parseFloat(e.target.value) || 0 })}
              className="input w-full text-sm"
            />
          </Field>
          <Field label="길이">
            <input
              type="number"
              step="0.1"
              value={clip.durationSec.toFixed(2)}
              onChange={(e) => updateClip(clip.id, { durationSec: Math.max(0.1, parseFloat(e.target.value) || 0.1) })}
              className="input w-full text-sm"
            />
          </Field>
        </div>
      </div>
      {clip.kind !== 'text' ? (
        <MediaInspector clip={clip as MediaClip} updateClip={updateClip} />
      ) : (
        <TextInspector clip={clip as TextClip} updateClip={updateClip} fonts={fonts} />
      )}
    </>
  );
}

// ───────────────── 미디어 (영상/이미지/오디오) Inspector ─────────────────

type MediaTab = 'transform' | 'color' | 'audio' | 'effect';

function MediaInspector({
  clip,
  updateClip,
}: {
  clip: MediaClip;
  updateClip: (id: string, patch: Partial<MediaClip>) => void;
}) {
  // 사용 가능한 탭 동적 결정 — 오디오 클립은 transform/color 없음, 이미지는 audio 없음
  const tabs: { id: MediaTab; label: string }[] = [];
  if (clip.kind !== 'audio') tabs.push({ id: 'transform', label: '🎯 변환' });
  if (clip.kind !== 'audio') tabs.push({ id: 'color', label: '🎨 색감' });
  if (clip.kind !== 'image') tabs.push({ id: 'audio', label: '🎵 오디오' });
  tabs.push({ id: 'effect', label: '✨ 효과' });

  const [active, setActive] = useState<MediaTab>(tabs[0]?.id ?? 'effect');

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <TabBar tabs={tabs} active={active} onChange={(id) => setActive(id as MediaTab)} />
      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {active === 'transform' && <TransformTab clip={clip} updateClip={updateClip} />}
        {active === 'color' && <ColorTab clip={clip} updateClip={updateClip} />}
        {active === 'audio' && <AudioTab clip={clip} updateClip={updateClip} />}
        {active === 'effect' && <EffectTab clip={clip} updateClip={updateClip} />}
      </div>
    </div>
  );
}

function TransformTab({
  clip,
  updateClip,
}: {
  clip: MediaClip;
  updateClip: (id: string, patch: Partial<MediaClip>) => void;
}) {
  return (
    <Section title="화면 위치 / 크기">
      <Field label="정렬 (클릭으로 즉시 이동)">
        <div className="grid grid-cols-3 gap-1">
          {ALIGN_GRID.map((row, ri) =>
            row.map((cell, ci) => (
              <button
                key={`${ri}-${ci}`}
                onClick={() => updateClip(clip.id, { x: cell.x, y: cell.y })}
                className="aspect-square rounded bg-bg-elevated hover:bg-accent/30 border border-border-subtle flex items-center justify-center text-xs text-text-secondary hover:text-white transition-colors"
                title={cell.label}
              >
                {cell.icon}
              </button>
            )),
          )}
        </div>
        <div className="grid grid-cols-2 gap-1 mt-1.5">
          <button onClick={() => updateClip(clip.id, { x: 0.5 })} className="btn-secondary text-xs py-1">
            ⬌ 가로 가운데
          </button>
          <button onClick={() => updateClip(clip.id, { y: 0.5 })} className="btn-secondary text-xs py-1">
            ⬍ 세로 가운데
          </button>
        </div>
      </Field>

      <Field
        label={
          <span className="flex items-center justify-between">
            <span>크기: {((clip.scale ?? 1) * 100).toFixed(0)}%</span>
            <KeyframeButton clip={clip} prop="scale" currentValue={clip.scale ?? 1} />
          </span>
        }
      >
        <input
          type="range"
          min={0.1}
          max={4}
          step={0.05}
          value={clip.scale ?? 1}
          onChange={(e) => updateClip(clip.id, { scale: parseFloat(e.target.value) })}
          className="w-full"
        />
      </Field>
      <Field
        label={
          <span className="flex items-center justify-between">
            <span>회전: {(clip.rotation ?? 0).toFixed(0)}°</span>
            <KeyframeButton clip={clip} prop="rotation" currentValue={clip.rotation ?? 0} />
          </span>
        }
      >
        <input
          type="range"
          min={-180}
          max={180}
          step={1}
          value={clip.rotation ?? 0}
          onChange={(e) => updateClip(clip.id, { rotation: parseFloat(e.target.value) })}
          className="w-full"
        />
      </Field>
      <Field
        label={
          <span className="flex items-center justify-between">
            <span>투명도: {((clip.opacity ?? 1) * 100).toFixed(0)}%</span>
            <KeyframeButton clip={clip} prop="opacity" currentValue={clip.opacity ?? 1} />
          </span>
        }
      >
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={clip.opacity ?? 1}
          onChange={(e) => updateClip(clip.id, { opacity: parseFloat(e.target.value) })}
          className="w-full"
        />
      </Field>

      <div className="grid grid-cols-2 gap-2 mt-2 p-2 bg-bg-elevated/50 rounded">
        <div className="text-center">
          <div className="text-[10px] text-text-muted mb-1">x 위치</div>
          <KeyframeButton clip={clip} prop="x" currentValue={clip.x ?? 0.5} />
        </div>
        <div className="text-center">
          <div className="text-[10px] text-text-muted mb-1">y 위치</div>
          <KeyframeButton clip={clip} prop="y" currentValue={clip.y ?? 0.5} />
        </div>
      </div>
      <p className="text-[10px] text-text-muted mt-1 leading-snug">
        ◇ = 현재 시점에 키프레임 추가 (시점별로 다른 값을 두면 자동 보간 — 영상이 점점 움직이거나 커짐)
      </p>

      <button
        onClick={() => updateClip(clip.id, { x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1 })}
        className="btn-secondary w-full text-xs"
      >
        위치/크기 초기화
      </button>
    </Section>
  );
}

function ColorTab({
  clip,
  updateClip,
}: {
  clip: MediaClip;
  updateClip: (id: string, patch: Partial<MediaClip>) => void;
}) {
  return (
    <>
      <Section title="기본 효과">
        <Field label={`밝기: ${(clip.brightness * 100).toFixed(0)}%`}>
          <input
            type="range"
            min={-1}
            max={1}
            step={0.05}
            value={clip.brightness}
            onChange={(e) => updateClip(clip.id, { brightness: parseFloat(e.target.value) })}
            className="w-full"
          />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => updateClip(clip.id, { hflip: !clip.hflip })}
            className={`btn ${clip.hflip ? 'bg-accent text-white' : 'btn-secondary'} text-sm`}
          >
            ◀▶ 좌우반전
          </button>
          <button
            onClick={() => updateClip(clip.id, { vflip: !clip.vflip })}
            className={`btn ${clip.vflip ? 'bg-accent text-white' : 'btn-secondary'} text-sm`}
          >
            ▲▼ 상하반전
          </button>
        </div>
      </Section>

      <Section title="색 보정">
        <Field label={`채도: ${((clip.saturation ?? 0) * 100).toFixed(0)}%`}>
          <input
            type="range"
            min={-1}
            max={1}
            step={0.05}
            value={clip.saturation ?? 0}
            onChange={(e) => updateClip(clip.id, { saturation: parseFloat(e.target.value) })}
            className="w-full"
          />
        </Field>
        <Field label={`대비: ${((clip.contrast ?? 0) * 100).toFixed(0)}%`}>
          <input
            type="range"
            min={-1}
            max={1}
            step={0.05}
            value={clip.contrast ?? 0}
            onChange={(e) => updateClip(clip.id, { contrast: parseFloat(e.target.value) })}
            className="w-full"
          />
        </Field>
        <Field label={`색온도: ${(clip.temperature ?? 0) > 0 ? '+' : ''}${((clip.temperature ?? 0) * 100).toFixed(0)} (차가움 ↔ 따뜻함)`}>
          <input
            type="range"
            min={-1}
            max={1}
            step={0.05}
            value={clip.temperature ?? 0}
            onChange={(e) => updateClip(clip.id, { temperature: parseFloat(e.target.value) })}
            className="w-full"
          />
        </Field>
        <Field label={`틴트: ${(clip.tint ?? 0) > 0 ? '+' : ''}${((clip.tint ?? 0) * 100).toFixed(0)} (녹 ↔ 마젠타)`}>
          <input
            type="range"
            min={-1}
            max={1}
            step={0.05}
            value={clip.tint ?? 0}
            onChange={(e) => updateClip(clip.id, { tint: parseFloat(e.target.value) })}
            className="w-full"
          />
        </Field>
        <Field label={`감마: ${(clip.gamma ?? 1).toFixed(2)}`}>
          <input
            type="range"
            min={0.5}
            max={2}
            step={0.05}
            value={clip.gamma ?? 1}
            onChange={(e) => updateClip(clip.id, { gamma: parseFloat(e.target.value) })}
            className="w-full"
          />
        </Field>
        <button
          onClick={() =>
            updateClip(clip.id, {
              saturation: 0,
              contrast: 0,
              temperature: 0,
              tint: 0,
              gamma: 1,
              brightness: 0,
            })
          }
          className="btn-secondary w-full text-xs"
        >
          색 보정 초기화
        </button>
      </Section>
    </>
  );
}

function AudioTab({
  clip,
  updateClip,
}: {
  clip: MediaClip;
  updateClip: (id: string, patch: Partial<MediaClip>) => void;
}) {
  return (
    <>
      <Section title="볼륨 / 속도">
        <Field label={`볼륨: ${(clip.volume * 100).toFixed(0)}%`}>
          <input
            type="range"
            min={0}
            max={2}
            step={0.05}
            value={clip.volume}
            onChange={(e) => updateClip(clip.id, { volume: parseFloat(e.target.value) })}
            className="w-full"
          />
        </Field>
        <Field label={`재생 속도: ${(clip.speed ?? 1).toFixed(2)}x`}>
          <input
            type="range"
            min={0.25}
            max={4}
            step={0.05}
            value={clip.speed ?? 1}
            onChange={(e) => updateClip(clip.id, { speed: parseFloat(e.target.value) })}
            className="w-full"
          />
          <div className="flex gap-1 mt-1">
            {[0.5, 1, 1.5, 2].map((s) => (
              <button
                key={s}
                onClick={() => updateClip(clip.id, { speed: s })}
                className={`flex-1 text-xs py-1 rounded ${(clip.speed ?? 1) === s ? 'bg-accent text-white' : 'bg-bg-elevated hover:bg-bg-hover'}`}
              >
                {s}x
              </button>
            ))}
          </div>
        </Field>
      </Section>

      <Section title="이퀄라이저 / 노이즈">
        <button
          onClick={() => updateClip(clip.id, { audioDenoise: !clip.audioDenoise })}
          className={`btn w-full ${clip.audioDenoise ? 'bg-accent text-white' : 'btn-secondary'} text-sm`}
        >
          {clip.audioDenoise ? '✓ 노이즈 제거 켜짐' : '🔇 노이즈 제거'}
        </button>
        <Field label={`저음 (Bass): ${(clip.audioBass ?? 0) > 0 ? '+' : ''}${(clip.audioBass ?? 0).toFixed(0)}dB`}>
          <input
            type="range"
            min={-12}
            max={12}
            step={0.5}
            value={clip.audioBass ?? 0}
            onChange={(e) => updateClip(clip.id, { audioBass: parseFloat(e.target.value) })}
            className="w-full"
          />
        </Field>
        <Field label={`중음 (Mid): ${(clip.audioMid ?? 0) > 0 ? '+' : ''}${(clip.audioMid ?? 0).toFixed(0)}dB`}>
          <input
            type="range"
            min={-12}
            max={12}
            step={0.5}
            value={clip.audioMid ?? 0}
            onChange={(e) => updateClip(clip.id, { audioMid: parseFloat(e.target.value) })}
            className="w-full"
          />
        </Field>
        <Field label={`고음 (Treble): ${(clip.audioTreble ?? 0) > 0 ? '+' : ''}${(clip.audioTreble ?? 0).toFixed(0)}dB`}>
          <input
            type="range"
            min={-12}
            max={12}
            step={0.5}
            value={clip.audioTreble ?? 0}
            onChange={(e) => updateClip(clip.id, { audioTreble: parseFloat(e.target.value) })}
            className="w-full"
          />
        </Field>
        <button
          onClick={() => updateClip(clip.id, { audioBass: 0, audioMid: 0, audioTreble: 0, audioDenoise: false })}
          className="btn-secondary w-full text-xs"
        >
          오디오 효과 초기화
        </button>
      </Section>
    </>
  );
}

function EffectTab({
  clip,
  updateClip,
}: {
  clip: MediaClip;
  updateClip: (id: string, patch: Partial<MediaClip>) => void;
}) {
  return (
    <>
      {clip.kind === 'audio' && (
        <Section title="페이드">
          <Field label={`페이드 인: ${clip.fadeInSec.toFixed(1)}초`}>
            <input
              type="range"
              min={0}
              max={3}
              step={0.1}
              value={clip.fadeInSec}
              onChange={(e) => updateClip(clip.id, { fadeInSec: parseFloat(e.target.value) })}
              className="w-full"
            />
          </Field>
          <Field label={`페이드 아웃: ${clip.fadeOutSec.toFixed(1)}초`}>
            <input
              type="range"
              min={0}
              max={3}
              step={0.1}
              value={clip.fadeOutSec}
              onChange={(e) => updateClip(clip.id, { fadeOutSec: parseFloat(e.target.value) })}
              className="w-full"
            />
          </Field>
        </Section>
      )}

      {clip.kind !== 'audio' && (
        <Section title="트랜지션 (시작/끝 효과)">
          <Field label="시작 효과">
            <select
              value={clip.transitionIn ?? 'none'}
              onChange={(e) => updateClip(clip.id, { transitionIn: e.target.value as TransitionKind })}
              className="input w-full text-sm"
            >
              {TRANSITIONS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>
          {(clip.transitionIn ?? 'none') !== 'none' && (
            <Field label={`시작 효과 길이: ${(clip.transitionInSec ?? 0).toFixed(1)}초`}>
              <input
                type="range"
                min={0.1}
                max={3}
                step={0.1}
                value={clip.transitionInSec ?? 0.5}
                onChange={(e) => updateClip(clip.id, { transitionInSec: parseFloat(e.target.value) })}
                className="w-full"
              />
            </Field>
          )}
          <Field label="끝 효과">
            <select
              value={clip.transitionOut ?? 'none'}
              onChange={(e) => updateClip(clip.id, { transitionOut: e.target.value as TransitionKind })}
              className="input w-full text-sm"
            >
              {TRANSITIONS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>
          {(clip.transitionOut ?? 'none') !== 'none' && (
            <Field label={`끝 효과 길이: ${(clip.transitionOutSec ?? 0).toFixed(1)}초`}>
              <input
                type="range"
                min={0.1}
                max={3}
                step={0.1}
                value={clip.transitionOutSec ?? 0.5}
                onChange={(e) => updateClip(clip.id, { transitionOutSec: parseFloat(e.target.value) })}
                className="w-full"
              />
            </Field>
          )}
        </Section>
      )}
    </>
  );
}

// ───────────────── 자막 Inspector ─────────────────

type TextTab = 'content' | 'style' | 'position' | 'animation';

function TextInspector({
  clip,
  updateClip,
  fonts,
}: {
  clip: TextClip;
  updateClip: (id: string, patch: Partial<TextClip>) => void;
  fonts: { family: string; path: string; fileName: string }[];
}) {
  const [active, setActive] = useState<TextTab>('content');
  const tabs: { id: TextTab; label: string }[] = [
    { id: 'content', label: '📝 내용' },
    { id: 'style', label: '🎨 스타일' },
    { id: 'position', label: '🎯 위치' },
    { id: 'animation', label: '✨ 애니메이션' },
  ];

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <TabBar tabs={tabs} active={active} onChange={(id) => setActive(id as TextTab)} />
      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {active === 'content' && <TextContentTab clip={clip} updateClip={updateClip} />}
        {active === 'style' && <TextStyleTab clip={clip} updateClip={updateClip} fonts={fonts} />}
        {active === 'position' && <TextPositionTab clip={clip} updateClip={updateClip} />}
        {active === 'animation' && <TextAnimationTab clip={clip} updateClip={updateClip} />}
      </div>
    </div>
  );
}

function TextContentTab({
  clip,
  updateClip,
}: {
  clip: TextClip;
  updateClip: (id: string, patch: Partial<TextClip>) => void;
}) {
  return (
    <>
      <Section title="텍스트">
        <textarea
          value={clip.text}
          onChange={(e) => updateClip(clip.id, { text: e.target.value })}
          rows={4}
          className="input w-full text-sm resize-none"
        />
      </Section>

      <Section title="프리셋 스타일 (클릭 한 번으로 전체 스타일 적용)">
        <div className="grid grid-cols-2 gap-1.5">
          {SUBTITLE_PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => updateClip(clip.id, p.patch)}
              className="text-left p-1.5 rounded bg-bg-elevated hover:bg-bg-hover border border-border-subtle"
              title={p.description}
            >
              <div className="text-xs font-medium text-text-primary truncate">{p.name}</div>
              <div className="text-[9px] text-text-muted truncate">{p.description}</div>
            </button>
          ))}
        </div>
      </Section>
    </>
  );
}

function TextStyleTab({
  clip,
  updateClip,
  fonts,
}: {
  clip: TextClip;
  updateClip: (id: string, patch: Partial<TextClip>) => void;
  fonts: { family: string; path: string; fileName: string }[];
}) {
  return (
    <>
      <Section title="폰트">
        <Field label="폰트">
          <select
            value={clip.fontFamily}
            onChange={(e) => updateClip(clip.id, { fontFamily: e.target.value })}
            className="input w-full text-sm"
          >
            {fonts.map((f) => (
              <option key={f.family} value={f.family} style={{ fontFamily: f.family }}>
                {f.family}
              </option>
            ))}
          </select>
        </Field>
        <Field label={`크기: ${clip.fontSize}px`}>
          <input
            type="range"
            min={16}
            max={200}
            step={2}
            value={clip.fontSize}
            onChange={(e) => updateClip(clip.id, { fontSize: parseInt(e.target.value) })}
            className="w-full"
          />
        </Field>
      </Section>

      <Section title="색상">
        <div className="grid grid-cols-2 gap-2">
          <Field label="글자 색">
            <input
              type="color"
              value={clip.color}
              onChange={(e) => updateClip(clip.id, { color: e.target.value })}
              className="w-full h-8 rounded border border-border-subtle bg-bg-surface"
            />
          </Field>
          <Field label="배경 색">
            <div className="flex gap-1">
              <input
                type="color"
                value={clip.bgColor ?? '#000000'}
                onChange={(e) => updateClip(clip.id, { bgColor: e.target.value })}
                className="flex-1 h-8 rounded border border-border-subtle bg-bg-surface"
              />
              <button
                onClick={() => updateClip(clip.id, { bgColor: clip.bgColor ? undefined : '#000000' })}
                className="btn-ghost px-2 text-xs"
              >
                {clip.bgColor ? '제거' : '추가'}
              </button>
            </div>
          </Field>
        </div>
      </Section>

      <Section title="강조">
        <div className="grid grid-cols-2 gap-2">
          <Toggle label="굵게" value={clip.bold} onChange={(v) => updateClip(clip.id, { bold: v })} />
          <Toggle label="기울임" value={clip.italic} onChange={(v) => updateClip(clip.id, { italic: v })} />
          <Toggle label="그림자" value={clip.shadow} onChange={(v) => updateClip(clip.id, { shadow: v })} />
          <Toggle label="외곽선" value={clip.outline} onChange={(v) => updateClip(clip.id, { outline: v })} />
        </div>
        {clip.outline && (
          <Field label="외곽선 색">
            <input
              type="color"
              value={clip.outlineColor}
              onChange={(e) => updateClip(clip.id, { outlineColor: e.target.value })}
              className="w-full h-8 rounded border border-border-subtle bg-bg-surface"
            />
          </Field>
        )}
      </Section>
    </>
  );
}

function TextPositionTab({
  clip,
  updateClip,
}: {
  clip: TextClip;
  updateClip: (id: string, patch: Partial<TextClip>) => void;
}) {
  return (
    <>
      <Section title="텍스트 정렬">
        <div className="grid grid-cols-3 gap-2">
          {(['left', 'center', 'right'] as const).map((a) => (
            <button
              key={a}
              onClick={() => updateClip(clip.id, { align: a })}
              className={`btn ${clip.align === a ? 'bg-accent text-white' : 'btn-secondary'}`}
            >
              {a === 'left' ? '⬅' : a === 'center' ? '⬌' : '➡'}
            </button>
          ))}
        </div>
      </Section>

      <Section title="화면 내 위치">
        <Field label="9포인트 정렬">
          <div className="grid grid-cols-3 gap-1">
            {ALIGN_GRID.map((row, ri) =>
              row.map((cell, ci) => {
                const targetX =
                  clip.align === 'center'
                    ? cell.x
                    : cell.x === 0
                    ? 0.05
                    : cell.x === 1
                    ? 0.95
                    : 0.5;
                return (
                  <button
                    key={`${ri}-${ci}`}
                    onClick={() => updateClip(clip.id, { x: targetX, y: cell.y })}
                    className="aspect-square rounded bg-bg-elevated hover:bg-accent/30 border border-border-subtle flex items-center justify-center text-xs text-text-secondary hover:text-white transition-colors"
                    title={cell.label}
                  >
                    {cell.icon}
                  </button>
                );
              }),
            )}
          </div>
        </Field>
        <Field label={`세로 위치: ${(clip.y * 100).toFixed(0)}%`}>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={clip.y}
            onChange={(e) => updateClip(clip.id, { y: parseFloat(e.target.value) })}
            className="w-full"
          />
        </Field>
        <Field label={`가로 위치: ${(clip.x * 100).toFixed(0)}%`}>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={clip.x}
            onChange={(e) => updateClip(clip.id, { x: parseFloat(e.target.value) })}
            className="w-full"
          />
        </Field>
      </Section>

      <Section title="박스 너비 (자동 줄바꿈)">
        <Field
          label={
            clip.width !== undefined
              ? `박스 너비: ${(clip.width * 100).toFixed(0)}% — 텍스트 자동 줄바꿈`
              : '박스 너비: 자동 (텍스트 길이에 맞춤)'
          }
        >
          <input
            type="range"
            min={0.05}
            max={1}
            step={0.01}
            value={clip.width ?? 1}
            onChange={(e) => updateClip(clip.id, { width: parseFloat(e.target.value) })}
            className="w-full"
          />
        </Field>
        <button
          onClick={() => updateClip(clip.id, { width: undefined })}
          className="btn-secondary w-full text-xs"
        >
          박스 너비 자동 (텍스트에 맞춤)
        </button>
        <p className="text-[10px] text-text-muted leading-snug">
          박스 너비를 설정하면 긴 텍스트가 자동으로 여러 줄로 줄바꿈됩니다.<br />
          미리보기에서 우하단 모서리를 드래그해도 너비를 조절할 수 있어요.
        </p>
      </Section>
    </>
  );
}

function TextAnimationTab({
  clip,
  updateClip,
}: {
  clip: TextClip;
  updateClip: (id: string, patch: Partial<TextClip>) => void;
}) {
  return (
    <Section title="등장 / 퇴장 애니메이션">
      <Field label="등장 효과">
        <select
          value={clip.animationIn ?? 'none'}
          onChange={(e) => updateClip(clip.id, { animationIn: e.target.value as TextAnimation })}
          className="input w-full text-sm"
        >
          {TEXT_ANIMATIONS.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label}
            </option>
          ))}
        </select>
      </Field>
      {(clip.animationIn ?? 'none') !== 'none' && (
        <Field label={`등장 길이: ${(clip.animationInSec ?? 0.5).toFixed(1)}초`}>
          <input
            type="range"
            min={0.1}
            max={2}
            step={0.1}
            value={clip.animationInSec ?? 0.5}
            onChange={(e) => updateClip(clip.id, { animationInSec: parseFloat(e.target.value) })}
            className="w-full"
          />
        </Field>
      )}
      <Field label="퇴장 효과">
        <select
          value={clip.animationOut ?? 'none'}
          onChange={(e) => updateClip(clip.id, { animationOut: e.target.value as TextAnimation })}
          className="input w-full text-sm"
        >
          {TEXT_ANIMATIONS.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label}
            </option>
          ))}
        </select>
      </Field>
      {(clip.animationOut ?? 'none') !== 'none' && (
        <Field label={`퇴장 길이: ${(clip.animationOutSec ?? 0.5).toFixed(1)}초`}>
          <input
            type="range"
            min={0.1}
            max={2}
            step={0.1}
            value={clip.animationOutSec ?? 0.5}
            onChange={(e) => updateClip(clip.id, { animationOutSec: parseFloat(e.target.value) })}
            className="w-full"
          />
        </Field>
      )}
    </Section>
  );
}

// ───────────────── 공통 헬퍼 ─────────────────

function TabBar<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: T; label: string }[];
  active: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="flex border-b border-border-subtle bg-bg-panel flex-shrink-0 overflow-x-auto">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={`flex-1 min-w-fit px-2 py-2 text-xs font-medium whitespace-nowrap transition-colors ${
            active === t.id
              ? 'text-accent border-b-2 border-accent bg-accent/5'
              : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">{title}</h4>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs text-text-secondary block mb-1">{label}</label>
      {children}
    </div>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      className={`btn ${value ? 'bg-accent text-white' : 'btn-secondary'} text-sm`}
    >
      {label}
    </button>
  );
}

function KeyframeButton({
  clip,
  prop,
  currentValue,
}: {
  clip: MediaClip;
  prop: AnimatableProperty;
  currentValue: number;
}) {
  const addKf = useProjectStore((s) => s.addKeyframeAtPlayhead);
  const removeKf = useProjectStore((s) => s.removeKeyframeAtPlayhead);
  const clearKf = useProjectStore((s) => s.clearKeyframes);
  const playhead = useProjectStore((s) => s.playheadSec);
  const localT = playhead - clip.startSec;
  const list = clip.keyframes?.[prop];
  const hasAny = !!list && list.length > 0;
  const hasAtCurrent = list?.some((k) => Math.abs(k.timeSec - localT) < 0.05);
  return (
    <span className="inline-flex gap-1 items-center">
      <button
        onClick={(e) => {
          e.stopPropagation();
          if (hasAtCurrent) removeKf(clip.id, prop);
          else addKf(clip.id, prop, currentValue);
        }}
        className={`text-xs px-1.5 py-0.5 rounded ${
          hasAtCurrent
            ? 'bg-yellow-500 text-black'
            : hasAny
            ? 'bg-accent/30 text-accent'
            : 'text-text-muted hover:text-accent'
        }`}
        title={
          hasAtCurrent
            ? '현재 시점 키프레임 삭제'
            : hasAny
            ? '현재 시점에 키프레임 추가'
            : '키프레임 추가'
        }
      >
        ◇
      </button>
      {hasAny && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            clearKf(clip.id, prop);
          }}
          className="text-[10px] text-text-muted hover:text-red-400"
          title="모든 키프레임 제거"
        >
          ×
        </button>
      )}
      {hasAny && <span className="text-[9px] text-text-muted">{list?.length ?? 0}</span>}
    </span>
  );
}
