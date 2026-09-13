import { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Chip, ColorDot, PanelSection, Stepper } from '@/components/ui/controls';
import { aspectValue, BLEND_MODES, palette, textColors } from '@/constants/editor';
import { activeVisualClip, sourceTimeAt } from '@/lib/projectUtils';
import { clamp } from '@/lib/time';
import { pointsToPositionKeyframes, trackSubject } from '@/lib/track';
import { useEditorStore } from '@/store/editorStore';
import type { ShapeClip } from '@/types/project';

const GRADIENTS: { id: string; from: string; to: string }[] = [
  { id: 'purplePink', from: '#7c5cff', to: '#ff5ca8' },
  { id: 'blueTurquoise', from: '#4d9dff', to: '#5cffd0' },
  { id: 'sunset', from: '#ff6b4a', to: '#ffb85c' },
];

/** Forma-szerkesztő (Creative Canvas): kitöltés, gradiens, keret, lekerekítés. */
const GLOW_PRESETS = [
  { id: 'cyan', emoji: '🩵', color: '#00e5ff' },
  { id: 'pink', emoji: '💗', color: '#ff2d95' },
  { id: 'white', emoji: '🤍', color: '#ffffff' },
  { id: 'gold', emoji: '💛', color: '#ffd166' },
];

const OUTLINE_PRESETS = [
  { id: 'white', emoji: '🤍', color: '#ffffff' },
  { id: 'black', emoji: '🖤', color: '#0b0b18' },
  { id: 'pink', emoji: '💗', color: '#ff2d95' },
];

export function ShapePanel({ clip }: { clip: ShapeClip }) {
  const { t } = useTranslation();
  const updateClip = useEditorStore((s) => s.updateClip);
  const snapGrid = useEditorStore((s) => s.snapGrid);
  const setSnapGrid = useEditorStore((s) => s.setSnapGrid);
  const setPickTarget = useEditorStore((s) => s.setPickTarget);
  const [trackBusy, setTrackBusy] = useState(false);

  /**
   * 🎯 Objektum-követés: a vásznon rákoppintasz a követendő objektumra, a worker
   * (a videón) végigköveti, és a FORMA (vagy shape-alapú 3D-matrica) a
   * pozíció-kulcskockákkal utána mozog. Pro (objectTrack).
   */
  const runTrack = (point: { x: number; y: number }) => {
    const state = useEditorStore.getState();
    const project = state.project;
    if (!project || trackBusy) {
      return;
    }
    const video = activeVisualClip(project, state.playhead);
    if (!video || video.kind !== 'video') {
      Alert.alert(t('panels.shape.trackTitle'), t('panels.shape.trackNeedVideo'));
      return;
    }
    if (state.playhead < clip.start || state.playhead >= clip.start + clip.duration) {
      Alert.alert(t('panels.shape.trackTitle'), t('panels.shape.trackPlayheadOnClip'));
      return;
    }
    const endTl = Math.min(clip.start + clip.duration, video.start + video.duration, state.playhead + 15);
    const durTl = endTl - state.playhead;
    if (durTl < 0.5) {
      Alert.alert(t('panels.shape.trackTitle'), t('panels.shape.trackTooShort'));
      return;
    }
    setTrackBusy(true);
    trackSubject(video.uri, {
      startSec: sourceTimeAt(video, state.playhead),
      durationSec: durTl * video.speed,
      cx: point.x,
      cy: point.y,
      aspectW: aspectValue(project.aspectRatio),
      aspectH: 1,
    })
      .then((points) => {
        if (!points) {
          Alert.alert(t('panels.shape.trackTitle'), t('panels.shape.trackFailed'));
          return;
        }
        const kf = pointsToPositionKeyframes(points, clip.position, state.playhead - clip.start, 1 / video.speed);
        state.updateClip(clip.id, { keyframes: { ...clip.keyframes, ...kf } });
        Alert.alert(t('panels.shape.trackDone'), t('panels.shape.trackDoneBody', { count: kf.x.length }));
      })
      .catch((err: Error) => Alert.alert(t('panels.shape.trackTitle'), err.message))
      .finally(() => setTrackBusy(false));
  };
  const startTrackPick = () => {
    Alert.alert(t('panels.shape.trackTitle'), t('panels.shape.trackPickHint'));
    setPickTarget((p) => runTrack(p));
  };

  return (
    <View>
      <PanelSection title={t('panels.shape.shapeTitle')}>
        <View style={styles.row}>
          {(
            [
              { id: 'rectangle', label: t('panels.shape.shapeRectangle') },
              { id: 'ellipse', label: t('panels.shape.shapeEllipse') },
              { id: 'line', label: t('panels.shape.shapeLine') },
            ] as const
          ).map((s) => (
            <Chip
              key={s.id}
              label={s.label}
              active={clip.shape === s.id}
              onPress={() => updateClip(clip.id, { shape: s.id })}
            />
          ))}
        </View>
      </PanelSection>

      {clip.imageUri ? (
        <PanelSection title={t('panels.shape.imageTitle')}>
          <Text style={styles.note}>
            {t('panels.shape.imageNote')}
          </Text>
        </PanelSection>
      ) : (
        <PanelSection title={t('panels.shape.fillTitle')}>
          <View style={styles.row}>
            {textColors.map((color) => (
              <ColorDot
                key={color}
                color={color}
                active={!clip.fillGradient && clip.fill === color}
                onPress={() =>
                  updateClip(clip.id, { fill: color, fillGradient: undefined })
                }
              />
            ))}
          </View>
          <View style={styles.row}>
            {GRADIENTS.map((g) => (
              <Chip
                key={g.id}
                label={t('panels.shape.gradient_' + g.id)}
                active={clip.fillGradient?.from === g.from}
                onPress={() =>
                  updateClip(clip.id, { fillGradient: { from: g.from, to: g.to } })
                }
              />
            ))}
            {clip.fillGradient ? (
              <Chip
                label={t('panels.shape.plainColor')}
                active={false}
                onPress={() => updateClip(clip.id, { fillGradient: undefined })}
              />
            ) : null}
          </View>
        </PanelSection>
      )}

      <PanelSection title={t('panels.shape.blendTitle')}>
        <View style={styles.row}>
          <Chip
            label={t('panels.shape.blendNormal')}
            active={!clip.blendMode}
            onPress={() => updateClip(clip.id, { blendMode: undefined })}
          />
          {BLEND_MODES.map((m) => (
            <Chip
              key={m.value}
              label={t(m.label)}
              active={clip.blendMode === m.value}
              onPress={() => updateClip(clip.id, { blendMode: m.value })}
            />
          ))}
        </View>
        <Text style={styles.note}>
          {t('panels.shape.blendNote')}
        </Text>
      </PanelSection>

      <PanelSection title={t('panels.shape.sizeStyleTitle')}>
        <Stepper
          label={t('panels.shape.width')}
          value={`${Math.round(clip.w * 100)}%`}
          onDec={() => updateClip(clip.id, { w: clamp(clip.w - 0.05, 0.05, 1) })}
          onInc={() => updateClip(clip.id, { w: clamp(clip.w + 0.05, 0.05, 1) })}
        />
        <Stepper
          label={t('panels.shape.height')}
          value={`${Math.round(clip.h * 100)}%`}
          onDec={() =>
            updateClip(clip.id, { h: clamp(clip.h - 0.05, 0.004, 1) })
          }
          onInc={() => updateClip(clip.id, { h: clamp(clip.h + 0.05, 0.004, 1) })}
        />
        {clip.shape === 'rectangle' ? (
          <Stepper
            label={t('panels.shape.cornerRadius')}
            value={`${Math.round((clip.cornerRadius ?? 0) * 100)}%`}
            onDec={() =>
              updateClip(clip.id, {
                cornerRadius: clamp((clip.cornerRadius ?? 0) - 0.05, 0, 0.5),
              })
            }
            onInc={() =>
              updateClip(clip.id, {
                cornerRadius: clamp((clip.cornerRadius ?? 0) + 0.05, 0, 0.5),
              })
            }
          />
        ) : null}
        <Stepper
          label={t('panels.shape.border')}
          value={`${(clip.borderWidth ?? 0).toFixed(1)}`}
          onDec={() =>
            updateClip(clip.id, {
              borderWidth: clamp((clip.borderWidth ?? 0) - 0.2, 0, 2),
              borderColor: clip.borderColor ?? '#ffffff',
            })
          }
          onInc={() =>
            updateClip(clip.id, {
              borderWidth: clamp((clip.borderWidth ?? 0) + 0.2, 0, 2),
              borderColor: clip.borderColor ?? '#ffffff',
            })
          }
        />
        <Stepper
          label={t('panels.shape.opacity')}
          value={`${Math.round((clip.opacity ?? 1) * 100)}%`}
          onDec={() =>
            updateClip(clip.id, { opacity: clamp((clip.opacity ?? 1) - 0.1, 0.1, 1) })
          }
          onInc={() =>
            updateClip(clip.id, { opacity: clamp((clip.opacity ?? 1) + 0.1, 0.1, 1) })
          }
        />
        <View style={styles.row}>
          <Chip
            label={clip.shadow ? t('panels.shape.shadowOn') : t('panels.shape.shadow')}
            active={clip.shadow === true}
            onPress={() => updateClip(clip.id, { shadow: !clip.shadow })}
          />
        </View>
        <Text style={styles.note}>
          {t('panels.shape.sizeStyleNote')}
        </Text>
      </PanelSection>
      <PanelSection title={t('panels.shape.alignTitle')}>
        <View style={styles.row}>
          {[
            { v: 0, label: t('panels.shape.gridOff') },
            { v: 6, label: '6×6' },
            { v: 12, label: '12×12' },
          ].map((g) => (
            <Chip
              key={g.v}
              label={g.label}
              active={snapGrid === g.v}
              onPress={() => setSnapGrid(g.v)}
            />
          ))}
        </View>
        <Text style={styles.note}>
          {t('panels.shape.alignNote')}
        </Text>
      </PanelSection>

      <PanelSection title={t('panels.shape.glowOutlineTitle')}>
        <Text style={styles.subLabel}>{t('panels.shape.glowLabel')}</Text>
        <View style={styles.row}>
          <Chip
            label={t('panels.shape.glowNone')}
            active={!clip.glow}
            onPress={() => updateClip(clip.id, { glow: undefined })}
          />
          {GLOW_PRESETS.map((g) => (
            <Chip
              key={g.id}
              label={g.emoji + ' ' + t('panels.shape.glowColor_' + g.id)}
              active={clip.glow?.color === g.color}
              onPress={() => updateClip(clip.id, { glow: { color: g.color, size: 2 } })}
            />
          ))}
        </View>
        {clip.glow ? (
          <Stepper
            label={t('panels.shape.glowSize')}
            value={`${clip.glow.size.toFixed(1)}%`}
            onDec={() =>
              updateClip(clip.id, {
                glow: { ...clip.glow!, size: clamp(clip.glow!.size - 0.4, 0.4, 6) },
              })
            }
            onInc={() =>
              updateClip(clip.id, {
                glow: { ...clip.glow!, size: clamp(clip.glow!.size + 0.4, 0.4, 6) },
              })
            }
          />
        ) : null}
        <Text style={styles.subLabel}>{t('panels.shape.outlineLabel')}</Text>
        <View style={styles.row}>
          <Chip
            label={t('panels.shape.outlineNone')}
            active={!clip.outline}
            onPress={() => updateClip(clip.id, { outline: undefined })}
          />
          {OUTLINE_PRESETS.map((o) => (
            <Chip
              key={o.id}
              label={o.emoji + ' ' + t('panels.shape.outlineColor_' + o.id)}
              active={clip.outline?.color === o.color}
              onPress={() => updateClip(clip.id, { outline: { color: o.color, width: 0.4 } })}
            />
          ))}
        </View>
        {clip.outline ? (
          <Stepper
            label={t('panels.shape.outlineWidth')}
            value={`${clip.outline.width.toFixed(2)}%`}
            onDec={() =>
              updateClip(clip.id, {
                outline: { ...clip.outline!, width: clamp(clip.outline!.width - 0.1, 0.1, 2) },
              })
            }
            onInc={() =>
              updateClip(clip.id, {
                outline: { ...clip.outline!, width: clamp(clip.outline!.width + 0.1, 0.1, 2) },
              })
            }
          />
        ) : null}
        <Text style={styles.note}>
          {t('panels.shape.glowOutlineNote')}
        </Text>
      </PanelSection>

      {/* 🎯 Objektum-követés: a forma / 3D-matrica követi a videó egy objektumát */}
      <PanelSection title={t('panels.shape.trackSectionTitle')}>
        <View style={styles.row}>
          <Chip
            label={trackBusy ? t('panels.shape.tracking') : t('panels.shape.trackObject')}
            active={trackBusy}
            onPress={startTrackPick}
          />
          {clip.keyframes?.x?.length ? (
            <Chip
              label={t('panels.shape.trackClear')}
              active={false}
              onPress={() => updateClip(clip.id, { keyframes: undefined })}
            />
          ) : null}
        </View>
        <Text style={styles.note}>{t('panels.shape.trackNote')}</Text>
      </PanelSection>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    alignItems: 'center',
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
  },
});
