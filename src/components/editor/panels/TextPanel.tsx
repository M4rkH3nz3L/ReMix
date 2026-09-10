import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Chip, ColorDot, PanelSection, PrimaryButton, Stepper } from '@/components/ui/controls';
import { aspectValue, palette, textAnimations, textColors, textStylePresets } from '@/constants/editor';
import { fontOptions } from '@/constants/fonts';
import { TEXT_TEMPLATES, type TextTemplate } from '@/constants/textTemplates';
import { fetchFaces, pickPrimaryFace } from '@/lib/faceClient';
import { activeVisualClip, sourceTimeAt } from '@/lib/projectUtils';
import { pointsToPositionKeyframes, trackSubject } from '@/lib/track';
import { clamp } from '@/lib/time';
import { useEditorStore } from '@/store/editorStore';
import type { TextClip } from '@/types/project';

export function TextPanel({ clip }: { clip: TextClip }) {
  const { t: tr } = useTranslation();
  const [trackStatus, setTrackStatus] = useState<string | null>(null);
  // 🎯 téma-kijelölő: a panel bezárul, a következő vászon-koppintás adja a pontot
  const [pickHint, setPickHint] = useState<string | null>(null);

  /**
   * Követés (P0‑6): a playhead alatti videón a szöveg pozíciójánál (vagy a
   * megadott pontnál — pl. detektált arcnál) lévő pontot követi a worker; az
   * elmozdulás a szöveg pozíció-kulcskockáiba kerül (delta-mozgás).
   */
  const startTracking = async (point?: { x: number; y: number }) => {
    const state = useEditorStore.getState();
    if (!state.project || trackStatus) {
      return;
    }
    const video = activeVisualClip(state.project, state.playhead);
    if (!video || video.kind !== 'video') {
      Alert.alert(tr('panels.text.trackTitle'), tr('panels.text.trackPlayheadOnVideo'));
      return;
    }
    if (state.playhead < clip.start || state.playhead >= clip.start + clip.duration) {
      Alert.alert(tr('panels.text.trackTitle'), tr('panels.text.trackPlayheadUnderText'));
      return;
    }
    // a szakasz: a playheadtől a szöveg és a videó közös végéig (max 15 mp)
    const endTimeline = Math.min(
      clip.start + clip.duration,
      video.start + video.duration,
      state.playhead + 15
    );
    const durationTimeline = endTimeline - state.playhead;
    if (durationTimeline < 0.5) {
      Alert.alert(tr('panels.text.trackTitle'), tr('panels.text.trackTooShort'));
      return;
    }
    const ar = aspectValue(state.project.aspectRatio);
    setTrackStatus(tr('panels.text.trackingStatus'));
    try {
      const points = await trackSubject(video.uri, {
        startSec: sourceTimeAt(video, state.playhead),
        durationSec: durationTimeline * video.speed,
        cx: point?.x ?? clip.position.x,
        cy: point?.y ?? clip.position.y,
        aspectW: ar,
        aspectH: 1,
      });
      if (!points) {
        Alert.alert(
          tr('panels.text.trackTitle'),
          tr('panels.text.trackFailed')
        );
        return;
      }
      const kf = pointsToPositionKeyframes(
        points,
        clip.position,
        state.playhead - clip.start,
        1 / video.speed
      );
      state.updateClip(clip.id, { keyframes: kf });
      setTrackStatus(null);
      Alert.alert(
        tr('panels.text.trackDoneTitle'),
        tr('panels.text.trackDoneIntro', {
          count: kf.x.length,
          seconds: (points[points.length - 1].t / video.speed).toFixed(1),
        }) +
          (kf.scale ? tr('panels.text.trackDoneScale') : '') +
          tr('panels.text.trackDoneOutro')
      );
    } finally {
      setTrackStatus(null);
    }
  };
  /** 🙂 arc-követés: az AI megkeresi az arcot a playhead kockáján, onnan indít */
  const trackFace = async () => {
    const state = useEditorStore.getState();
    if (!state.project || trackStatus) {
      return;
    }
    const video = activeVisualClip(state.project, state.playhead);
    if (!video || video.kind !== 'video') {
      Alert.alert(tr('panels.text.faceTrackTitle'), tr('panels.text.trackPlayheadOnVideo'));
      return;
    }
    setTrackStatus(tr('panels.text.faceSearchingStatus'));
    try {
      const ar = aspectValue(state.project.aspectRatio);
      const faces = await fetchFaces(video.uri, {
        atSec: sourceTimeAt(video, state.playhead),
        aspectW: ar,
        aspectH: 1,
      });
      const face = faces ? pickPrimaryFace(faces) : null;
      if (!face) {
        Alert.alert(
          tr('panels.text.faceTrackTitle'),
          faces === null
            ? tr('panels.text.faceDetectorUnavailable')
            : tr('panels.text.faceNotFound')
        );
        return;
      }
      await startTracking({ x: face.x, y: face.y });
    } finally {
      setTrackStatus(null);
    }
  };

  const updateClip = useEditorStore((s) => s.updateClip);
  const [tab, setTab] = useState<'style' | 'anim' | 'extra'>('style');

  /**
   * Sablon alkalmazása: MINDEN look-mezőt explicit átír (a nem használtakat is
   * nullázza — text3d/háttér —, hogy két sablon közt ne ragadjon be a régi
   * stílus). A szöveg tartalma, időzítése, kulcskockái és kiemelései maradnak.
   */
  const applyTemplate = (t: TextTemplate) => {
    const f = t.fields;
    updateClip(clip.id, {
      fontFamily: f.fontFamily,
      fontSize: f.fontSize,
      fontWeight: f.fontWeight ?? 'bold',
      color: f.color,
      backgroundColor: f.backgroundColor ?? null,
      stylePreset: f.stylePreset ?? 'plain',
      animation: f.animation ?? 'none',
      text3d: f.text3d,
      position: f.position,
    });
  };

  return (
    <View>
      <PanelSection title={tr('panels.text.sectionText')}>
        <TextInput
          value={clip.text}
          onChangeText={(text) => updateClip(clip.id, { text })}
          multiline
          style={styles.input}
          placeholder={tr('panels.text.textPlaceholder')}
          placeholderTextColor={palette.textDim}
        />
      </PanelSection>

      <PanelSection title={tr('panels.text.sectionTemplates')}>
        <View style={styles.row}>
          {TEXT_TEMPLATES.map((t) => (
            <Chip key={t.id} label={tr(t.label)} active={false} onPress={() => applyTemplate(t)} />
          ))}
        </View>
      </PanelSection>

      {/* tabos elrendezés a látványterv szerint (Stílus / Animáció / Extra) */}
      <View style={styles.tabRow}>
        {(['style', 'anim', 'extra'] as const).map((id) => (
          <Pressable
            key={id}
            onPress={() => setTab(id)}
            style={[styles.tabItem, tab === id ? styles.tabItemActive : null]}
          >
            <Text style={[styles.tabText, tab === id ? styles.tabTextActive : null]}>
              {tr('panels.text.tab_' + id)}
            </Text>
          </Pressable>
        ))}
      </View>

      {tab === 'style' ? (
        <>
          <PanelSection title={tr('panels.text.sectionStylePreset')}>
            <View style={styles.row}>
              {textStylePresets.map((preset) => (
                <Chip
                  key={preset.id}
                  label={tr(preset.label)}
                  active={(clip.stylePreset ?? 'plain') === preset.id}
                  onPress={() => updateClip(clip.id, { stylePreset: preset.id })}
                />
              ))}
            </View>
          </PanelSection>

          <PanelSection title={tr('panels.text.sectionFont')}>
            <View style={styles.row}>
              {fontOptions.map((f) => {
                const active = (clip.fontFamily ?? undefined) === f.family;
                return (
                  <Pressable
                    key={f.id}
                    onPress={() => updateClip(clip.id, { fontFamily: f.family })}
                    style={[styles.fontChip, active && styles.fontChipActive]}
                  >
                    <Text
                      style={[
                        styles.fontChipText,
                        active && styles.fontChipTextActive,
                        f.family ? { fontFamily: f.family } : null,
                      ]}
                    >
                      {f.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </PanelSection>

          <PanelSection title={tr('panels.text.sectionColor')}>
            <View style={styles.row}>
              {textColors.map((color) => (
                <ColorDot
                  key={color}
                  color={color}
                  active={clip.color === color}
                  onPress={() => updateClip(clip.id, { color })}
                />
              ))}
            </View>
          </PanelSection>

          <PanelSection title={tr('panels.text.sectionBackground')}>
            <View style={styles.row}>
              <Chip
                label={tr('common.none')}
                active={clip.backgroundColor === null}
                onPress={() => updateClip(clip.id, { backgroundColor: null })}
              />
              {['#0c0d12cc', '#ffffffcc', '#6c5ce7cc'].map((color) => (
                <ColorDot
                  key={color}
                  color={color}
                  active={clip.backgroundColor === color}
                  onPress={() => updateClip(clip.id, { backgroundColor: color })}
                />
              ))}
            </View>
          </PanelSection>

          <PanelSection title={tr('panels.text.section3d')}>
            <View style={styles.row}>
              <Chip
                label={tr('common.off')}
                active={!clip.text3d}
                onPress={() => updateClip(clip.id, { text3d: undefined })}
              />
              {(['chrome', 'gold', 'neon', 'plastic'] as const).map((material) => (
                <Chip
                  key={material}
                  label={tr('panels.text.material_' + material)}
                  active={clip.text3d?.material === material}
                  onPress={() =>
                    updateClip(clip.id, {
                      text3d: {
                        depth: clip.text3d?.depth ?? 0.5,
                        tiltX: clip.text3d?.tiltX ?? 10,
                        tiltY: clip.text3d?.tiltY ?? -12,
                        material,
                      },
                    })
                  }
                />
              ))}
            </View>
            {clip.text3d ? (
              <>
                <Stepper
                  label={tr('panels.text.depth')}
                  value={`${Math.round(clip.text3d.depth * 100)}%`}
                  onDec={() =>
                    updateClip(clip.id, {
                      text3d: { ...clip.text3d!, depth: clamp(clip.text3d!.depth - 0.1, 0, 1) },
                    })
                  }
                  onInc={() =>
                    updateClip(clip.id, {
                      text3d: { ...clip.text3d!, depth: clamp(clip.text3d!.depth + 0.1, 0, 1) },
                    })
                  }
                />
                <Stepper
                  label={tr('panels.text.tiltVertical')}
                  value={`${clip.text3d.tiltX}°`}
                  onDec={() =>
                    updateClip(clip.id, {
                      text3d: { ...clip.text3d!, tiltX: clamp(clip.text3d!.tiltX - 4, -45, 45) },
                    })
                  }
                  onInc={() =>
                    updateClip(clip.id, {
                      text3d: { ...clip.text3d!, tiltX: clamp(clip.text3d!.tiltX + 4, -45, 45) },
                    })
                  }
                />
                <Stepper
                  label={tr('panels.text.tiltHorizontal')}
                  value={`${clip.text3d.tiltY}°`}
                  onDec={() =>
                    updateClip(clip.id, {
                      text3d: { ...clip.text3d!, tiltY: clamp(clip.text3d!.tiltY - 4, -45, 45) },
                    })
                  }
                  onInc={() =>
                    updateClip(clip.id, {
                      text3d: { ...clip.text3d!, tiltY: clamp(clip.text3d!.tiltY + 4, -45, 45) },
                    })
                  }
                />
                <Text style={styles.note}>{tr('panels.text.note3d')}</Text>
              </>
            ) : null}
          </PanelSection>

          <PanelSection title={tr('panels.text.sectionSize')}>
            <Stepper
              label={tr('panels.text.sizeLabel')}
              value={`${clip.fontSize}%`}
              onDec={() =>
                updateClip(clip.id, { fontSize: clamp(clip.fontSize - 1, 3, 20) })
              }
              onInc={() =>
                updateClip(clip.id, { fontSize: clamp(clip.fontSize + 1, 3, 20) })
              }
            />
            <View style={styles.row}>
              <Chip
                label={tr('panels.text.bold')}
                active={clip.fontWeight === 'bold'}
                onPress={() =>
                  updateClip(clip.id, {
                    fontWeight: clip.fontWeight === 'bold' ? 'normal' : 'bold',
                  })
                }
              />
            </View>
          </PanelSection>
        </>
      ) : null}

      {tab === 'anim' ? (
        <PanelSection title={tr('panels.text.sectionAnimation')}>
          <View style={styles.row}>
            {textAnimations.map((anim) => (
              <Chip
                key={anim.id}
                label={tr(anim.label)}
                active={clip.animation === anim.id}
                onPress={() => updateClip(clip.id, { animation: anim.id })}
              />
            ))}
          </View>
        </PanelSection>
      ) : null}

      {tab === 'extra' ? (
        <>
          <PanelSection title={tr('panels.text.sectionAlign')}>
            <View style={styles.row}>
              {(
                [
                  { id: 'left', x: 0.22 },
                  { id: 'centerX', x: 0.5 },
                  { id: 'right', x: 0.78 },
                ] as const
              ).map((a) => (
                <Chip
                  key={a.id}
                  label={tr('panels.text.align_' + a.id)}
                  active={Math.abs(clip.position.x - a.x) < 0.03}
                  onPress={() =>
                    updateClip(clip.id, { position: { ...clip.position, x: a.x } })
                  }
                />
              ))}
            </View>
            <View style={styles.row}>
              {(
                [
                  { id: 'top', y: 0.16 },
                  { id: 'centerY', y: 0.5 },
                  { id: 'bottom', y: 0.8 },
                ] as const
              ).map((a) => (
                <Chip
                  key={a.id}
                  label={tr('panels.text.align_' + a.id)}
                  active={Math.abs(clip.position.y - a.y) < 0.03}
                  onPress={() =>
                    updateClip(clip.id, { position: { ...clip.position, y: a.y } })
                  }
                />
              ))}
            </View>
          </PanelSection>

          <PanelSection title={tr('panels.text.sectionTracking')}>
            <PrimaryButton
              icon="locate-outline"
              label={trackStatus ?? tr('panels.text.trackFromPlayhead')}
              onPress={() => {
                startTracking().catch((err: Error) =>
                  Alert.alert(tr('panels.text.trackTitle'), err.message)
                );
              }}
            />
            <PrimaryButton
              icon="locate"
              label={pickHint ?? tr('panels.text.pickPoint')}
              onPress={() => {
                setPickHint(tr('panels.text.pickPointHint'));
                useEditorStore.getState().setPanel(null);
                useEditorStore.getState().setPickTarget((point) => {
                  setPickHint(null);
                  useEditorStore.getState().setPanel('text');
                  startTracking(point).catch((err: Error) =>
                    Alert.alert(tr('panels.text.trackTitle'), err.message)
                  );
                });
              }}
            />
            <PrimaryButton
              icon="happy-outline"
              label={trackStatus ?? tr('panels.text.trackFace')}
              onPress={() => {
                trackFace().catch((err: Error) =>
                  Alert.alert(tr('panels.text.faceTrackTitle'), err.message)
                );
              }}
            />
            {clip.keyframes ? (
              <Chip
                label={tr('panels.text.clearTracking')}
                active={false}
                onPress={() =>
                  useEditorStore.getState().updateClip(clip.id, { keyframes: undefined })
                }
              />
            ) : null}
            <Text style={styles.note}>{tr('panels.text.noteTracking')}</Text>
          </PanelSection>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  tabRow: {
    flexDirection: 'row',
    gap: 4,
    marginBottom: 12,
    backgroundColor: palette.surfaceHigh,
    borderRadius: 10,
    padding: 3,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 7,
    borderRadius: 8,
  },
  tabItemActive: {
    backgroundColor: palette.accent,
  },
  tabText: {
    color: palette.textDim,
    fontSize: 12,
    fontWeight: '700',
  },
  tabTextActive: {
    color: '#fff',
  },
  note: {
    color: palette.textDim,
    fontSize: 11,
    lineHeight: 16,
  },
  input: {
    backgroundColor: palette.surfaceHigh,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.border,
    color: palette.text,
    padding: 10,
    minHeight: 60,
    fontSize: 14,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    alignItems: 'center',
  },
  fontChip: {
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: palette.surfaceHigh,
    minWidth: 64,
    alignItems: 'center',
  },
  fontChipActive: {
    backgroundColor: palette.accent,
    borderColor: palette.accent,
  },
  fontChipText: {
    color: palette.textDim,
    fontSize: 16,
  },
  fontChipTextActive: {
    color: '#fff',
  },
});
