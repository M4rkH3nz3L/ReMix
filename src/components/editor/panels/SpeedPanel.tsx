import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { Chip, PanelSection, Stepper } from '@/components/ui/controls';
import { palette, speedPresets } from '@/constants/editor';
import { makeId } from '@/lib/id';
import { setChannelKeyframe } from '@/lib/keyframes';
import { maxVideoDuration } from '@/lib/projectUtils';
import { CurveEditor } from '@/components/editor/CurveEditor';
import { SPEED_RAMP_PRESETS, buildSpeedRampPlan } from '@/lib/speedRamp';
import { clamp } from '@/lib/time';
import { useEditorStore } from '@/store/editorStore';
import type { VideoClip } from '@/types/project';

export function SpeedPanel({ clip }: { clip: VideoClip }) {
  const { t } = useTranslation();
  const updateClip = useEditorStore((s) => s.updateClip);
  // 🌀 mozgás-elmosás erő a rampnál (0 = ki); a darabok ezt öröklik
  const [rampBlur, setRampBlur] = useState(0.6);
  // 🚀 egyéni görbe: null = preset-mód, tömb = a szerkesztőben állított görbe
  const [customCurve, setCustomCurve] = useState<number[] | null>(null);

  // 🚀 speed ramp: preset VAGY egyéni görbe → lépcsős sebességű darabok,
  // egy undo-lépésben
  const applyRamp = (
    source: (typeof SPEED_RAMP_PRESETS)[number] | { label: string; curve: number[] }
  ) => {
    const state = useEditorStore.getState();
    if (!state.project) {
      return;
    }
    const plan = buildSpeedRampPlan(
      state.project,
      clip.id,
      'id' in source ? source.id : source.curve,
      () => makeId('clip'),
      rampBlur
    );
    if (!plan) {
      Alert.alert('Speed ramp', t('panels.speed.rampNotApplicable'));
      return;
    }
    const kfWarning = clip.keyframes
      ? '\n\n' + t('panels.speed.rampKeyframeWarning')
      : '';
    Alert.alert(
      t('panels.speed.rampTitle', { label: source.label }),
      t('panels.speed.rampBody', { pieces: plan.pieces }) +
        (rampBlur > 0
          ? '\n\n' + t('panels.speed.rampBlurNote')
          : '') +
        kfWarning,
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.apply'),
          onPress: () => {
            state.dispatch(
              { type: 'REPLACE_TRACK_CLIPS', trackType: 'video', clips: plan.clips },
              'user'
            );
          },
        },
      ]
    );
  };

  const setSpeed = (speed: number) => {
    const next = clamp(speed, 0.1, 10);
    // a sebesség változásával a klip idővonal-hossza is változik
    const scaled = { ...clip, speed: next };
    const duration = Math.min(
      (clip.duration * clip.speed) / next,
      maxVideoDuration(scaled)
    );
    updateClip(clip.id, { speed: next, duration });
  };

  return (
    <View>
      <PanelSection title={t('panels.speed.speedTitle')}>
        <View style={styles.row}>
          {speedPresets.map((preset) => (
            <Chip
              key={preset}
              label={`${preset}×`}
              active={clip.speed === preset}
              onPress={() => setSpeed(preset)}
            />
          ))}
        </View>
        <Stepper
          label={t('panels.speed.fineTune')}
          value={`${clip.speed.toFixed(2)}×`}
          onDec={() => setSpeed(Math.round((clip.speed - 0.1) * 100) / 100)}
          onInc={() => setSpeed(Math.round((clip.speed + 0.1) * 100) / 100)}
        />
      </PanelSection>

      <PanelSection title={t('panels.speed.rampSectionTitle')}>
        <View style={styles.row}>
          {SPEED_RAMP_PRESETS.map((preset) => (
            <Chip
              key={preset.id}
              label={t('panels.speed.rampPreset_' + preset.id)}
              active={false}
              onPress={() => applyRamp(preset)}
            />
          ))}
        </View>
        <Text style={styles.subLabel}>{t('panels.speed.customCurve')}</Text>
        <View style={styles.row}>
          <Chip
            label={customCurve ? t('panels.speed.editorOn') : t('panels.speed.drawOwnCurve')}
            active={Boolean(customCurve)}
            onPress={() =>
              setCustomCurve(customCurve ? null : [1.6, 1.2, 0.5, 0.5, 1.2, 1.6])
            }
          />
        </View>
        {customCurve ? (
          <>
            <CurveEditor curve={customCurve} onChange={setCustomCurve} />
            <Chip
              label={t('panels.speed.applyCustomCurve')}
              active={false}
              onPress={() => applyRamp({ label: t('panels.speed.customCurveLabel'), curve: customCurve })}
            />
            <Text style={styles.note}>
              {t('panels.speed.curveNote')}
            </Text>
          </>
        ) : null}

        <Text style={styles.subLabel}>{t('panels.speed.motionBlur')}</Text>
        <View style={styles.row}>
          {[
            { v: 0, id: 'off' },
            { v: 0.35, id: 'subtle' },
            { v: 0.6, id: 'medium' },
            { v: 1, id: 'strong' },
          ].map((opt) => (
            <Chip
              key={opt.id}
              label={t('panels.speed.blur_' + opt.id)}
              active={rampBlur === opt.v}
              onPress={() => setRampBlur(opt.v)}
            />
          ))}
        </View>
        <Text style={styles.note}>
          {t('panels.speed.rampNote')}
        </Text>
      </PanelSection>

      <PanelSection title={t('panels.speed.clipMotionBlurTitle')}>
        <View style={styles.row}>
          {[
            { v: 0, id: 'off' },
            { v: 0.35, id: 'subtle' },
            { v: 0.6, id: 'medium' },
            { v: 1, id: 'strong' },
          ].map((opt) => (
            <Chip
              key={opt.id}
              label={t('panels.speed.blur_' + opt.id)}
              active={(clip.motionBlur ?? 0) === opt.v}
              onPress={() => updateClip(clip.id, { motionBlur: opt.v || undefined })}
            />
          ))}
        </View>
        <Text style={styles.note}>
          {clip.speed > 1.05
            ? t('panels.speed.clipMotionBlurSpeedUp')
            : clip.speed < 0.95
              ? t('panels.speed.clipMotionBlurSlowDown')
              : t('panels.speed.clipMotionBlurNeutral')}
        </Text>
      </PanelSection>

      <PanelSection title={t('panels.speed.interpTitle')}>
        <View style={styles.row}>
          {(['none', 'blend', 'flow'] as const).map((mode) => (
            <Chip
              key={mode}
              label={t('panels.speed.interp_' + mode)}
              active={(clip.timeInterp ?? 'none') === mode}
              onPress={() =>
                updateClip(clip.id, { timeInterp: mode === 'none' ? undefined : mode })
              }
            />
          ))}
        </View>
        <Text style={styles.note}>{t('panels.speed.interpNote')}</Text>
      </PanelSection>

      <PanelSection title={t('panels.speed.volumeTitle')}>
        <Stepper
          label={t('panels.speed.clipAudio')}
          value={`${Math.round(clip.volume * 100)}%`}
          onDec={() => updateClip(clip.id, { volume: clamp(clip.volume - 0.1, 0, 1) })}
          onInc={() => updateClip(clip.id, { volume: clamp(clip.volume + 0.1, 0, 1) })}
        />
        {clip.volume > 0 ? (
          <View style={styles.row}>
            <Chip
              label={t('panels.speed.enhanceVoice')}
              active={clip.voiceEnhance === true}
              onPress={() => updateClip(clip.id, { voiceEnhance: !clip.voiceEnhance })}
            />
            <Chip
              label={t('panels.speed.deReverb')}
              active={clip.deReverb === true}
              onPress={() => updateClip(clip.id, { deReverb: !clip.deReverb })}
            />
          </View>
        ) : null}
        <View style={styles.row}>
          <Chip
            label={t('panels.speed.volumeKeyframe')}
            active={false}
            onPress={() => {
              const state = useEditorStore.getState();
              const localTime = clamp(state.playhead - clip.start, 0, clip.duration);
              const k = clip.keyframes ?? {};
              updateClip(clip.id, {
                keyframes: {
                  ...k,
                  volume: setChannelKeyframe(k.volume, localTime, clip.volume, 'linear'),
                },
              });
            }}
          />
          {clip.keyframes?.volume?.length ? (
            <Chip
              label={t('panels.speed.clearAutomation', { count: clip.keyframes.volume.length })}
              active={false}
              onPress={() =>
                updateClip(clip.id, {
                  keyframes: { ...clip.keyframes, volume: undefined },
                })
              }
            />
          ) : null}
        </View>
        {clip.voiceEnhance || clip.deReverb ? (
          <Text style={styles.note}>
            {t('panels.speed.enhancedAudioNote')}
          </Text>
        ) : null}
        <Text style={styles.note}>
          {t('panels.speed.volumeAutomationNote')}
        </Text>
      </PanelSection>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  subLabel: {
    color: palette.textDim,
    fontSize: 11,
    fontWeight: '600',
    marginTop: 10,
    marginBottom: 4,
  },
  note: {
    color: palette.textDim,
    fontSize: 11,
    lineHeight: 16,
    marginTop: 4,
  },
});
