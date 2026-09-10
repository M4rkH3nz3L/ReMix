import { useState } from 'react';
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
      Alert.alert('Követés', 'Állítsd a lejátszófejet egy videóklipre.');
      return;
    }
    if (state.playhead < clip.start || state.playhead >= clip.start + clip.duration) {
      Alert.alert('Követés', 'Állítsd a lejátszófejet a szövegklip alá.');
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
      Alert.alert('Követés', 'Túl rövid szakasz — húzd hosszabbra a szöveget.');
      return;
    }
    const ar = aspectValue(state.project.aspectRatio);
    setTrackStatus('Követés…');
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
          'Követés',
          'A követés nem sikerült — fut a worker? (cd server && npm start)'
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
        'Követés kész',
        `${kf.x.length} kulcskocka ${(points[points.length - 1].t / video.speed).toFixed(1)} mp-en — ` +
          'a szöveg követi a pontot' +
          (kf.scale
            ? ', és a témával együtt nő/csökken (🧊 3D követés)'
            : '') +
          '. Húzással az egész pálya áthelyezhető, ' +
          'a törléshez koppints a „Követés törlése” gombra.'
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
      Alert.alert('Arc-követés', 'Állítsd a lejátszófejet egy videóklipre.');
      return;
    }
    setTrackStatus('Arc keresése…');
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
          'Arc-követés',
          faces === null
            ? 'Az arc-detektor nem érhető el — fut a worker?'
            : 'Nem találtam arcot ezen a képkockán — próbáld másik pillanatból, ' +
              'vagy használd a „Pont követése” gombot.'
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
      <PanelSection title="Szöveg">
        <TextInput
          value={clip.text}
          onChangeText={(text) => updateClip(clip.id, { text })}
          multiline
          style={styles.input}
          placeholder="Írd ide a szöveget…"
          placeholderTextColor={palette.textDim}
        />
      </PanelSection>

      <PanelSection title="🎞️ Sablonok (egy koppintásra kész look)">
        <View style={styles.row}>
          {TEXT_TEMPLATES.map((t) => (
            <Chip key={t.id} label={t.label} active={false} onPress={() => applyTemplate(t)} />
          ))}
        </View>
      </PanelSection>

      {/* tabos elrendezés a látványterv szerint (Stílus / Animáció / Extra) */}
      <View style={styles.tabRow}>
        {(
          [
            { id: 'style', label: 'Stílus' },
            { id: 'anim', label: 'Animáció' },
            { id: 'extra', label: 'Extra' },
          ] as const
        ).map((t) => (
          <Pressable
            key={t.id}
            onPress={() => setTab(t.id)}
            style={[styles.tabItem, tab === t.id ? styles.tabItemActive : null]}
          >
            <Text style={[styles.tabText, tab === t.id ? styles.tabTextActive : null]}>
              {t.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {tab === 'style' ? (
        <>
          <PanelSection title="Stíluspreset">
            <View style={styles.row}>
              {textStylePresets.map((preset) => (
                <Chip
                  key={preset.id}
                  label={preset.label}
                  active={(clip.stylePreset ?? 'plain') === preset.id}
                  onPress={() => updateClip(clip.id, { stylePreset: preset.id })}
                />
              ))}
            </View>
          </PanelSection>

          <PanelSection title="Betűtípus">
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

          <PanelSection title="Szín">
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

          <PanelSection title="Háttér">
            <View style={styles.row}>
              <Chip
                label="Nincs"
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

          <PanelSection title="🧊 3D szöveg">
            <View style={styles.row}>
              <Chip
                label="Ki"
                active={!clip.text3d}
                onPress={() => updateClip(clip.id, { text3d: undefined })}
              />
              {(
                [
                  { id: 'chrome', label: 'Chrome' },
                  { id: 'gold', label: 'Arany' },
                  { id: 'neon', label: 'Neon 3D' },
                  { id: 'plastic', label: 'Plasztik' },
                ] as const
              ).map((m) => (
                <Chip
                  key={m.id}
                  label={m.label}
                  active={clip.text3d?.material === m.id}
                  onPress={() =>
                    updateClip(clip.id, {
                      text3d: {
                        depth: clip.text3d?.depth ?? 0.5,
                        tiltX: clip.text3d?.tiltX ?? 10,
                        tiltY: clip.text3d?.tiltY ?? -12,
                        material: m.id,
                      },
                    })
                  }
                />
              ))}
            </View>
            {clip.text3d ? (
              <>
                <Stepper
                  label="Mélység"
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
                  label="Dőlés ↕"
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
                  label="Dőlés ↔"
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
                <Text style={styles.note}>
                  Az előnézet közelítés — a valódi extrúzió és anyag (chrome/arany
                  gradiens) a renderben ég be. A Neon 3D a Szín-ből dolgozik.
                </Text>
              </>
            ) : null}
          </PanelSection>

          <PanelSection title="Méret">
            <Stepper
              label="Méret"
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
                label="Félkövér"
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
        <PanelSection title="Animáció">
          <View style={styles.row}>
            {textAnimations.map((anim) => (
              <Chip
                key={anim.id}
                label={anim.label}
                active={clip.animation === anim.id}
                onPress={() => updateClip(clip.id, { animation: anim.id })}
              />
            ))}
          </View>
        </PanelSection>
      ) : null}

      {tab === 'extra' ? (
        <>
          <PanelSection title="Igazítás">
            <View style={styles.row}>
              {(
                [
                  { label: '⇤ Bal', x: 0.22 },
                  { label: 'Közép', x: 0.5 },
                  { label: 'Jobb ⇥', x: 0.78 },
                ] as const
              ).map((a) => (
                <Chip
                  key={a.label}
                  label={a.label}
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
                  { label: '⇡ Fent', y: 0.16 },
                  { label: 'Közép', y: 0.5 },
                  { label: 'Lent ⇣', y: 0.8 },
                ] as const
              ).map((a) => (
                <Chip
                  key={a.label}
                  label={a.label}
                  active={Math.abs(clip.position.y - a.y) < 0.03}
                  onPress={() =>
                    updateClip(clip.id, { position: { ...clip.position, y: a.y } })
                  }
                />
              ))}
            </View>
          </PanelSection>

          <PanelSection title="🎯 Követés (3D)">
            <PrimaryButton
              icon="locate-outline"
              label={trackStatus ?? 'Pont követése innen (playhead)'}
              onPress={() => {
                startTracking().catch((err: Error) => Alert.alert('Követés', err.message));
              }}
            />
            <PrimaryButton
              icon="locate"
              label={pickHint ?? '🎯 Pont kijelölése a képen'}
              onPress={() => {
                setPickHint('Koppints a követendő pontra a képen…');
                useEditorStore.getState().setPanel(null);
                useEditorStore.getState().setPickTarget((point) => {
                  setPickHint(null);
                  useEditorStore.getState().setPanel('text');
                  startTracking(point).catch((err: Error) =>
                    Alert.alert('Követés', err.message)
                  );
                });
              }}
            />
            <PrimaryButton
              icon="happy-outline"
              label={trackStatus ?? '🙂 Arc követése (auto-keresés)'}
              onPress={() => {
                trackFace().catch((err: Error) => Alert.alert('Arc-követés', err.message));
              }}
            />
            {clip.keyframes ? (
              <Chip
                label="Követés törlése"
                active={false}
                onPress={() =>
                  useEditorStore.getState().updateClip(clip.id, { keyframes: undefined })
                }
              />
            ) : null}
            <Text style={styles.note}>
              🎯 Pont kijelölése: koppints a képen arra, amit követni akarsz — a
              panel visszanyílik, és a követés onnan indul. Vagy helyezd a
              szöveget a témára, állítsd a lejátszófejet a kezdőpontra, és indítsd — a szöveg átveszi
              a pont mozgását, és ha a téma közeledik/távolodik, a mérete is együtt
              változik (előnézetben és renderben is). Az 🙂 arc-követésnél nem kell
              céloznod: az AI megkeresi az arcot a képen, és onnan indítja a
              követést. 3D szöveggel kombinálva a cím „a jelenetben ül”.
            </Text>
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
