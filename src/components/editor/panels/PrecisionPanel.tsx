import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import { KeyframeGraphEditor } from '@/components/editor/KeyframeGraphEditor';
import { Chip, PanelSection, Stepper } from '@/components/ui/controls';
import { EDIT_FPS, FRAME, MIN_CLIP_DURATION, palette } from '@/constants/editor';
import type { KeyframeChannel } from '@/lib/keyframes';
import { maxVideoDuration } from '@/lib/projectUtils';
import { clamp, formatTime } from '@/lib/time';
import { useEditorStore } from '@/store/editorStore';
import type { Clip, ImageClip, VideoClip } from '@/types/project';

const STEP = 0.1;

/**
 * 🎞️ A Graph Editorban szerkeszthető transzform-csatornák (videó/kép): érték-
 * tartomány + a kulcskocka nélküli szél-érték + megjelenítés.
 */
type ChannelCfg = {
  id: Extract<KeyframeChannel, 'scale' | 'x' | 'y' | 'rotation' | 'opacity'>;
  label: string;
  min: number;
  max: number;
  fallback: (clip: VideoClip | ImageClip) => number;
  fmt: (v: number) => string;
};
const TRANSFORM_CHANNELS: ChannelCfg[] = [
  { id: 'scale', label: 'panels.precision.chScale', min: 0.2, max: 4, fallback: (c) => c.transform?.scale ?? 1, fmt: (v) => `${v.toFixed(2)}×` },
  { id: 'x', label: 'panels.precision.chX', min: -0.75, max: 0.75, fallback: (c) => c.transform?.x ?? 0, fmt: (v) => `${Math.round(v * 100)}%` },
  { id: 'y', label: 'panels.precision.chY', min: -0.75, max: 0.75, fallback: (c) => c.transform?.y ?? 0, fmt: (v) => `${Math.round(v * 100)}%` },
  { id: 'rotation', label: 'panels.precision.chRotation', min: -180, max: 180, fallback: (c) => c.transform?.rotation ?? 0, fmt: (v) => `${Math.round(v)}°` },
  { id: 'opacity', label: 'panels.precision.chOpacity', min: 0, max: 1, fallback: (c) => c.opacity ?? 1, fmt: (v) => `${Math.round(v * 100)}%` },
];

/**
 * A léptetés finomsága. Kockára állítva az érték a render KÉPKOCKA-RÁCSÁRA
 * kerekedik (nem tizedmásodpercre) — SFX-, felirat- és vágás-igazításnál ez
 * kell, mert fél kocka csúszás már látszik/hallatszik.
 */
type StepMode = 'sec' | 'frame';

/** kerekítés a lépés-mód szerint */
function snap(value: number, mode: StepMode): number {
  return mode === 'frame'
    ? Math.round(value * EDIT_FPS) / EDIT_FPS
    : Math.round(value * 100) / 100;
}

/** Pro eszköz: kezdet/hossz tizedmásodperces igazítása + lejátszófej-műveletek. */
export function PrecisionPanel({ clip }: { clip: Clip }) {
  const { t } = useTranslation();
  const updateClip = useEditorStore((s) => s.updateClip);
  const setPlayhead = useEditorStore((s) => s.setPlayhead);
  const playhead = useEditorStore((s) => s.playhead);
  const [kfChannel, setKfChannel] = useState<ChannelCfg['id']>('scale');
  const [stepMode, setStepMode] = useState<StepMode>('sec');
  const step = stepMode === 'frame' ? FRAME : STEP;

  const maxDuration =
    clip.kind === 'video' ? maxVideoDuration(clip) : Number.POSITIVE_INFINITY;

  const setStart = (start: number) => {
    updateClip(clip.id, { start: Math.max(0, snap(start, stepMode)) });
  };

  const setDuration = (duration: number) => {
    updateClip(clip.id, {
      duration: snap(clamp(duration, MIN_CLIP_DURATION, maxDuration), stepMode),
    });
  };

  /** a lejátszófej léptetése ugyanazzal a finomsággal */
  const nudgePlayhead = (dir: 1 | -1) => {
    setPlayhead(snap(playhead + dir * step, stepMode));
  };

  const alignToPlayhead = () => {
    const { playhead } = useEditorStore.getState();
    setStart(playhead);
  };

  return (
    <View>
      <PanelSection title={t('panels.precision.timingTitle')}>
        <View style={styles.row}>
          <Chip
            label={t('panels.precision.stepSec')}
            active={stepMode === 'sec'}
            onPress={() => setStepMode('sec')}
          />
          <Chip
            label={t('panels.precision.stepFrame', { fps: EDIT_FPS })}
            active={stepMode === 'frame'}
            onPress={() => setStepMode('frame')}
          />
        </View>
        <Stepper
          label={t('panels.precision.start')}
          value={formatTime(clip.start)}
          onDec={() => setStart(clip.start - step)}
          onInc={() => setStart(clip.start + step)}
        />
        <Stepper
          label={t('panels.precision.length')}
          value={formatTime(clip.duration)}
          onDec={() => setDuration(clip.duration - step)}
          onInc={() => setDuration(clip.duration + step)}
        />
        <Text style={styles.range}>
          {formatTime(clip.start)} → {formatTime(clip.start + clip.duration)}
          {stepMode === 'frame'
            ? t('panels.precision.frameInfo', {
                startFrame: Math.round(clip.start * EDIT_FPS),
                frameCount: Math.round(clip.duration * EDIT_FPS),
              })
            : ''}
        </Text>
      </PanelSection>

      <PanelSection title={t('panels.precision.alignTitle')}>
        <View style={styles.row}>
          <Chip
            label={
              stepMode === 'frame'
                ? t('panels.precision.nudgeBackFrame')
                : t('panels.precision.nudgeBackSec')
            }
            active={false}
            onPress={() => nudgePlayhead(-1)}
          />
          <Chip
            label={
              stepMode === 'frame'
                ? t('panels.precision.nudgeFwdFrame')
                : t('panels.precision.nudgeFwdSec')
            }
            active={false}
            onPress={() => nudgePlayhead(1)}
          />
          <Chip label={t('panels.precision.startToPlayhead')} active={false} onPress={alignToPlayhead} />
          <Chip
            label={t('panels.precision.playheadToClipStart')}
            active={false}
            onPress={() => setPlayhead(clip.start)}
          />
          <Chip
            label={t('panels.precision.playheadToClipEnd')}
            active={false}
            onPress={() => setPlayhead(clip.start + clip.duration)}
          />
        </View>
      </PanelSection>

      {clip.kind === 'video' || clip.kind === 'image' ? (
        <PanelSection title={t('panels.precision.keyframesTitle')}>
          <View style={styles.row}>
            {TRANSFORM_CHANNELS.map((c) => (
              <Chip
                key={c.id}
                label={t(c.label)}
                active={kfChannel === c.id}
                onPress={() => setKfChannel(c.id)}
              />
            ))}
          </View>
          {(() => {
            const cfg = TRANSFORM_CHANNELS.find((c) => c.id === kfChannel) ?? TRANSFORM_CHANNELS[0];
            const media = clip as VideoClip | ImageClip;
            return (
              <KeyframeGraphEditor
                keyframes={media.keyframes?.[cfg.id] ?? []}
                duration={clip.duration}
                min={cfg.min}
                max={cfg.max}
                fallback={cfg.fallback(media)}
                playhead={clamp(playhead - clip.start, 0, clip.duration)}
                onChange={(next) =>
                  updateClip(clip.id, {
                    keyframes: { ...media.keyframes, [cfg.id]: next.length > 0 ? next : undefined },
                  })
                }
                onSeek={(tt) => setPlayhead(clip.start + tt)}
                formatValue={cfg.fmt}
              />
            );
          })()}
          <Text style={styles.range}>{t('panels.precision.keyframeHint')}</Text>
        </PanelSection>
      ) : null}

      {clip.kind === 'video' || clip.kind === 'image' ? (
        <PanelSection title={t('panels.precision.appearanceTitle')}>
          <Stepper
            label={t('panels.precision.rotation')}
            value={`${clip.transform?.rotation ?? 0}°`}
            onDec={() =>
              updateClip(clip.id, {
                transform: {
                  ...(clip.transform ?? { scale: 1, x: 0, y: 0 }),
                  rotation: ((clip.transform?.rotation ?? 0) - 5 + 360) % 360,
                },
              })
            }
            onInc={() =>
              updateClip(clip.id, {
                transform: {
                  ...(clip.transform ?? { scale: 1, x: 0, y: 0 }),
                  rotation: ((clip.transform?.rotation ?? 0) + 5) % 360,
                },
              })
            }
          />
          <Stepper
            label={t('panels.precision.opacity')}
            value={`${Math.round((clip.opacity ?? 1) * 100)}%`}
            onDec={() =>
              updateClip(clip.id, { opacity: clamp((clip.opacity ?? 1) - 0.1, 0.1, 1) })
            }
            onInc={() =>
              updateClip(clip.id, { opacity: clamp((clip.opacity ?? 1) + 0.1, 0.1, 1) })
            }
          />
        </PanelSection>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  range: {
    color: palette.textDim,
    fontSize: 11,
    fontVariant: ['tabular-nums'],
  },
});
