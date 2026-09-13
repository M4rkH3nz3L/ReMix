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
import type { TextClip, TextStyle } from '@/types/project';

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

  // 🎨 granuláris szöveg-stílus (textStyle) segédek
  const ts = clip.textStyle ?? {};
  const setTs = (patch: Partial<TextStyle>) => {
    const next = { ...ts, ...patch };
    // az undefined mezőket kiszűrjük, hogy üresen a textStyle is eltűnjön
    (Object.keys(next) as (keyof TextStyle)[]).forEach((k) => next[k] === undefined && delete next[k]);
    updateClip(clip.id, { textStyle: Object.keys(next).length ? next : undefined });
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

          <PanelSection title={tr('panels.text.sectionTypography')}>
            <Stepper
              label={tr('panels.text.tracking')}
              value={`${(clip.letterSpacing ?? 0) > 0 ? '+' : ''}${Math.round((clip.letterSpacing ?? 0) * 100)}`}
              onDec={() => updateClip(clip.id, { letterSpacing: clamp((clip.letterSpacing ?? 0) - 0.02, -0.1, 1) })}
              onInc={() => updateClip(clip.id, { letterSpacing: clamp((clip.letterSpacing ?? 0) + 0.02, -0.1, 1) })}
            />
            <Stepper
              label={tr('panels.text.leading')}
              value={(clip.lineHeight ?? 1.25).toFixed(2)}
              onDec={() => updateClip(clip.id, { lineHeight: clamp((clip.lineHeight ?? 1.25) - 0.1, 0.8, 3) })}
              onInc={() => updateClip(clip.id, { lineHeight: clamp((clip.lineHeight ?? 1.25) + 0.1, 0.8, 3) })}
            />
            <Stepper
              label={tr('panels.text.baseline')}
              value={`${(clip.baselineShift ?? 0) > 0 ? '+' : ''}${Math.round((clip.baselineShift ?? 0) * 100)}`}
              onDec={() => updateClip(clip.id, { baselineShift: clamp((clip.baselineShift ?? 0) - 0.05, -1, 1) })}
              onInc={() => updateClip(clip.id, { baselineShift: clamp((clip.baselineShift ?? 0) + 0.05, -1, 1) })}
            />
            <View style={styles.row}>
              <Chip
                label={tr('panels.text.kerning')}
                active={clip.kerning !== false}
                onPress={() => updateClip(clip.id, { kerning: clip.kerning === false ? undefined : false })}
              />
            </View>
          </PanelSection>

          <PanelSection title={tr('panels.text.sectionTextStyle')}>
            <View style={styles.row}>
              <Chip
                label={tr('panels.text.styleGradient')}
                active={!!ts.gradient}
                onPress={() =>
                  setTs({ gradient: ts.gradient ? undefined : { from: clip.color, to: '#ffffff', angle: 135 } })
                }
              />
              <Chip
                label={tr('panels.text.styleStroke')}
                active={!!ts.stroke}
                onPress={() => setTs({ stroke: ts.stroke ? undefined : { color: '#000000', width: 0.04 } })}
              />
              <Chip
                label={tr('panels.text.styleShadow')}
                active={!!ts.shadow}
                onPress={() =>
                  setTs({ shadow: ts.shadow ? undefined : { color: '#000000', dx: 0, dy: 0.04, blur: 0.06 } })
                }
              />
              <Chip
                label={tr('panels.text.styleGlow')}
                active={!!ts.glow}
                onPress={() => setTs({ glow: ts.glow ? undefined : { color: clip.color, size: 0.4 } })}
              />
              <Chip
                label={tr('panels.text.styleBg')}
                active={!!ts.background}
                onPress={() =>
                  setTs({ background: ts.background ? undefined : { color: '#000000b3', padding: 0.4, radius: 0.3 } })
                }
              />
            </View>

            {ts.gradient ? (
              <>
                <Text style={styles.subLabel}>{tr('panels.text.styleGradientFrom')}</Text>
                <View style={styles.row}>
                  {textColors.map((c) => (
                    <ColorDot
                      key={'gf' + c}
                      color={c}
                      active={ts.gradient!.from === c}
                      onPress={() => setTs({ gradient: { ...ts.gradient!, from: c } })}
                    />
                  ))}
                </View>
                <Text style={styles.subLabel}>{tr('panels.text.styleGradientTo')}</Text>
                <View style={styles.row}>
                  {textColors.map((c) => (
                    <ColorDot
                      key={'gt' + c}
                      color={c}
                      active={ts.gradient!.to === c}
                      onPress={() => setTs({ gradient: { ...ts.gradient!, to: c } })}
                    />
                  ))}
                </View>
                <Stepper
                  label={tr('panels.text.styleGradientAngle')}
                  value={`${Math.round(ts.gradient.angle ?? 135)}°`}
                  onDec={() => setTs({ gradient: { ...ts.gradient!, angle: ((ts.gradient!.angle ?? 135) - 15 + 360) % 360 } })}
                  onInc={() => setTs({ gradient: { ...ts.gradient!, angle: ((ts.gradient!.angle ?? 135) + 15) % 360 } })}
                />
              </>
            ) : null}

            {ts.stroke ? (
              <>
                <Stepper
                  label={tr('panels.text.styleStrokeWidth')}
                  value={`${Math.round(ts.stroke.width * 100)}`}
                  onDec={() => setTs({ stroke: { ...ts.stroke!, width: clamp(ts.stroke!.width - 0.01, 0, 0.2) } })}
                  onInc={() => setTs({ stroke: { ...ts.stroke!, width: clamp(ts.stroke!.width + 0.01, 0, 0.2) } })}
                />
                <View style={styles.row}>
                  {textColors.map((c) => (
                    <ColorDot
                      key={'sk' + c}
                      color={c}
                      active={ts.stroke!.color === c}
                      onPress={() => setTs({ stroke: { ...ts.stroke!, color: c } })}
                    />
                  ))}
                </View>
              </>
            ) : null}

            {ts.glow ? (
              <>
                <Stepper
                  label={tr('panels.text.styleGlowSize')}
                  value={`${Math.round(ts.glow.size * 100)}`}
                  onDec={() => setTs({ glow: { ...ts.glow!, size: clamp(ts.glow!.size - 0.1, 0, 1) } })}
                  onInc={() => setTs({ glow: { ...ts.glow!, size: clamp(ts.glow!.size + 0.1, 0, 1) } })}
                />
                <View style={styles.row}>
                  {textColors.map((c) => (
                    <ColorDot
                      key={'gl' + c}
                      color={c}
                      active={ts.glow!.color === c}
                      onPress={() => setTs({ glow: { ...ts.glow!, color: c } })}
                    />
                  ))}
                </View>
              </>
            ) : null}

            {ts.shadow ? (
              <>
                <Stepper
                  label={tr('panels.text.styleShadowBlur')}
                  value={`${Math.round(ts.shadow.blur * 100)}`}
                  onDec={() => setTs({ shadow: { ...ts.shadow!, blur: clamp(ts.shadow!.blur - 0.02, 0, 0.4) } })}
                  onInc={() => setTs({ shadow: { ...ts.shadow!, blur: clamp(ts.shadow!.blur + 0.02, 0, 0.4) } })}
                />
                <Stepper
                  label={tr('panels.text.styleShadowY')}
                  value={`${(ts.shadow.dy ?? 0) > 0 ? '+' : ''}${Math.round((ts.shadow.dy ?? 0) * 100)}`}
                  onDec={() => setTs({ shadow: { ...ts.shadow!, dy: clamp((ts.shadow!.dy ?? 0) - 0.02, -0.3, 0.3) } })}
                  onInc={() => setTs({ shadow: { ...ts.shadow!, dy: clamp((ts.shadow!.dy ?? 0) + 0.02, -0.3, 0.3) } })}
                />
              </>
            ) : null}

            {ts.background ? (
              <>
                <Stepper
                  label={tr('panels.text.styleBgPadding')}
                  value={`${Math.round(ts.background.padding * 100)}`}
                  onDec={() => setTs({ background: { ...ts.background!, padding: clamp(ts.background!.padding - 0.1, 0, 2) } })}
                  onInc={() => setTs({ background: { ...ts.background!, padding: clamp(ts.background!.padding + 0.1, 0, 2) } })}
                />
                <Stepper
                  label={tr('panels.text.styleBgRadius')}
                  value={`${Math.round(ts.background.radius * 100)}`}
                  onDec={() => setTs({ background: { ...ts.background!, radius: clamp(ts.background!.radius - 0.1, 0, 2) } })}
                  onInc={() => setTs({ background: { ...ts.background!, radius: clamp(ts.background!.radius + 0.1, 0, 2) } })}
                />
                <View style={styles.row}>
                  {['#000000b3', '#ffffffcc', '#7c5cffcc', '#ff2ea6cc'].map((c) => (
                    <ColorDot
                      key={'bg' + c}
                      color={c}
                      active={ts.background!.color === c}
                      onPress={() => setTs({ background: { ...ts.background!, color: c } })}
                    />
                  ))}
                </View>
              </>
            ) : null}
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
        <>
          <PanelSection title={tr('panels.text.sectionAnimation')}>
            <View style={styles.row}>
              {textAnimations.map((anim) => (
                <Chip
                  key={anim.id}
                  label={tr(anim.label)}
                  active={clip.animation === anim.id && !clip.textMotion}
                  onPress={() =>
                    updateClip(clip.id, { animation: anim.id, textMotion: undefined })
                  }
                />
              ))}
            </View>
          </PanelSection>

          <PanelSection title={tr('panels.text.sectionKinetic')}>
            <Text style={styles.subLabel}>{tr('panels.text.kineticPreset')}</Text>
            <View style={styles.row}>
              <Chip
                label={tr('common.none')}
                active={!clip.textMotion}
                onPress={() => updateClip(clip.id, { textMotion: undefined })}
              />
              {(['reveal', 'popIn', 'slideIn', 'typeOn', 'wave', 'bounce'] as const).map((preset) => (
                <Chip
                  key={preset}
                  label={tr('panels.text.kinetic_' + preset)}
                  active={clip.textMotion?.preset === preset}
                  onPress={() =>
                    updateClip(clip.id, {
                      textMotion: { by: clip.textMotion?.by ?? 'word', ...clip.textMotion, preset },
                    })
                  }
                />
              ))}
            </View>
            {clip.textMotion ? (
              <>
                <Text style={styles.subLabel}>{tr('panels.text.kineticBy')}</Text>
                <View style={styles.row}>
                  {(['char', 'word', 'line'] as const).map((by) => (
                    <Chip
                      key={by}
                      label={tr('panels.text.kineticBy_' + by)}
                      active={clip.textMotion?.by === by}
                      onPress={() =>
                        updateClip(clip.id, { textMotion: { ...clip.textMotion!, by } })
                      }
                    />
                  ))}
                </View>
                {clip.textMotion.preset !== 'wave' ? (
                  <>
                    <Stepper
                      label={tr('panels.text.kineticStagger')}
                      value={`${Math.round((clip.textMotion.stagger ?? (clip.textMotion.by === 'char' ? 0.03 : clip.textMotion.by === 'word' ? 0.08 : 0.14)) * 1000)}ms`}
                      onDec={() =>
                        updateClip(clip.id, {
                          textMotion: {
                            ...clip.textMotion!,
                            stagger: clamp((clip.textMotion!.stagger ?? 0.08) - 0.02, 0, 0.5),
                          },
                        })
                      }
                      onInc={() =>
                        updateClip(clip.id, {
                          textMotion: {
                            ...clip.textMotion!,
                            stagger: clamp((clip.textMotion!.stagger ?? 0.08) + 0.02, 0, 0.5),
                          },
                        })
                      }
                    />
                    <Stepper
                      label={tr('panels.text.kineticDur')}
                      value={`${(clip.textMotion.dur ?? 0.4).toFixed(2)}s`}
                      onDec={() =>
                        updateClip(clip.id, {
                          textMotion: {
                            ...clip.textMotion!,
                            dur: clamp((clip.textMotion!.dur ?? 0.4) - 0.1, 0.1, 2),
                          },
                        })
                      }
                      onInc={() =>
                        updateClip(clip.id, {
                          textMotion: {
                            ...clip.textMotion!,
                            dur: clamp((clip.textMotion!.dur ?? 0.4) + 0.1, 0.1, 2),
                          },
                        })
                      }
                    />
                  </>
                ) : null}
                <Text style={styles.note}>{tr('panels.text.kineticNote')}</Text>
              </>
            ) : null}
          </PanelSection>
        </>
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
  subLabel: {
    color: palette.textDim,
    fontSize: 11,
    fontWeight: '700',
    marginTop: 8,
    marginBottom: 4,
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
