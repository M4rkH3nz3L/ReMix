import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import { Chip, PanelSection, Stepper } from '@/components/ui/controls';
import { EDIT_FPS, FRAME, MIN_CLIP_DURATION, palette } from '@/constants/editor';
import {
  KF_EPS,
  keyframeTimes,
  removeKeyframesAt,
  sampleClipTransform,
  setChannelKeyframe,
} from '@/lib/keyframes';
import { maxVideoDuration } from '@/lib/projectUtils';
import { clamp, formatTime } from '@/lib/time';
import { useEditorStore } from '@/store/editorStore';
import type { Clip, KeyframeEasing } from '@/types/project';

const STEP = 0.1;

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

const EASINGS: { id: KeyframeEasing }[] = [
  { id: 'easeInOut' },
  { id: 'linear' },
  { id: 'easeIn' },
  { id: 'easeOut' },
];

/** Pro eszköz: kezdet/hossz tizedmásodperces igazítása + lejátszófej-műveletek. */
export function PrecisionPanel({ clip }: { clip: Clip }) {
  const { t } = useTranslation();
  const updateClip = useEditorStore((s) => s.updateClip);
  const setPlayhead = useEditorStore((s) => s.setPlayhead);
  const playhead = useEditorStore((s) => s.playhead);
  const [easing, setEasing] = useState<KeyframeEasing>('easeInOut');
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
          {(() => {
            const tInClip = clamp(playhead - clip.start, 0, clip.duration);
            const times = keyframeTimes(clip.keyframes);
            const onKeyframe = times.some((t) => Math.abs(t - tInClip) <= KF_EPS);
            const addAtPlayhead = () => {
              const current = sampleClipTransform(clip, tInClip);
              const k = clip.keyframes ?? {};
              updateClip(clip.id, {
                keyframes: {
                  scale: setChannelKeyframe(k.scale, tInClip, current.scale, easing),
                  x: setChannelKeyframe(k.x, tInClip, current.x, easing),
                  y: setChannelKeyframe(k.y, tInClip, current.y, easing),
                },
              });
            };
            return (
              <>
                <View style={styles.row}>
                  <Chip
                    label={
                      onKeyframe
                        ? t('panels.precision.keyframeUpdate')
                        : t('panels.precision.keyframeHere')
                    }
                    active={onKeyframe}
                    onPress={addAtPlayhead}
                  />
                  {onKeyframe ? (
                    <Chip
                      label={t('panels.precision.keyframeDeleteHere')}
                      active={false}
                      onPress={() =>
                        updateClip(clip.id, {
                          keyframes: removeKeyframesAt(clip.keyframes, tInClip),
                        })
                      }
                    />
                  ) : null}
                  {times.length > 0 ? (
                    <Chip
                      label={t('panels.precision.keyframeDeleteAll')}
                      active={false}
                      onPress={() => updateClip(clip.id, { keyframes: undefined })}
                    />
                  ) : null}
                </View>
                <View style={styles.row}>
                  {EASINGS.map((e) => (
                    <Chip
                      key={e.id}
                      label={t('panels.precision.easing_' + e.id)}
                      active={easing === e.id}
                      onPress={() => setEasing(e.id)}
                    />
                  ))}
                </View>
                {times.length > 0 ? (
                  <View style={styles.row}>
                    {times.map((t) => (
                      <Chip
                        key={t.toFixed(2)}
                        label={`◆ ${formatTime(clip.start + t)}`}
                        active={Math.abs(t - tInClip) <= KF_EPS}
                        onPress={() => setPlayhead(clip.start + t)}
                      />
                    ))}
                  </View>
                ) : null}
                <Text style={styles.range}>
                  {t('panels.precision.keyframeHint')}
                </Text>
              </>
            );
          })()}
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
