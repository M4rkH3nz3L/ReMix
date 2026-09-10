import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Image as RNImage, Pressable, StyleSheet, Text, View } from 'react-native';

import { Chip, PanelSection, Stepper } from '@/components/ui/controls';
import { aspectValue, palette } from '@/constants/editor';
import { BRUSH_COLORS, BRUSH_STYLES } from '@/lib/draw';
import { makeId } from '@/lib/id';
import { pickImage } from '@/lib/media';
import { fetchFaces, pickPrimaryFace } from '@/lib/faceClient';
import { activeVisualClip, sourceTimeAt } from '@/lib/projectUtils';
import { renderServerUrl } from '@/lib/render';
import {
  STICKER_ENVIRONMENTS,
  STICKER_MATERIALS,
  downloadSticker3d,
  listStickers3d,
} from '@/lib/stickers3d';
import type { Sticker3DEntry } from '@/lib/stickers3d';
import { useEditorStore } from '@/store/editorStore';
import type { ParticlesPreset } from '@/types/project';

const PARTICLE_PRESETS: { id: ParticlesPreset }[] = [
  { id: 'confetti' },
  { id: 'sparkle' },
  { id: 'snow' },
  { id: 'embers' },
];

const STICKERS = [
  '🔥', '😂', '😍', '🤯', '👀', '💯', '✨', '🎉',
  '👇', '➡️', '✅', '❌', '💡', '🎵', '🍿', '🔖',
  '💬', '⚡', '🏆', '💰', '🫶', '😭', '🙌', '🚀',
];

/** Matrica = nagy emoji-szövegklip; húzással pozicionálható, animálható. */
export function StickerPanel() {
  const { t } = useTranslation();
  const addClip = useEditorStore((s) => s.addClip);
  const setPanel = useEditorStore((s) => s.setPanel);
  const dispatch = useEditorStore((s) => s.dispatch);
  const particles = useEditorStore((s) => s.project?.particles);
  // 🧊 3D objektumok a workerről (CC0 glTF-csomag) — worker nélkül a szekció rejtve
  const [stickers3d, setStickers3d] = useState<Sticker3DEntry[] | null>(null);
  const [busy3d, setBusy3d] = useState<string | null>(null);
  const [material, setMaterial] = useState<string>('original');
  const [environment, setEnvironment] = useState<string>('studio');
  const [faceBusy, setFaceBusy] = useState<string | null>(null);
  const drawBrush = useEditorStore((s) => s.drawBrush);
  const setDrawBrush = useEditorStore((s) => s.setDrawBrush);

  useEffect(() => {
    let alive = true;
    listStickers3d().then((entries) => {
      if (alive) {
        setStickers3d(entries);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  const addSticker3d = async (entry: Sticker3DEntry) => {
    if (busy3d) {
      return;
    }
    setBusy3d(entry.id);
    const uri = await downloadSticker3d(entry, { material, environment });
    setBusy3d(null);
    if (!uri) {
      Alert.alert(t('panels.sticker.object3dTitle'), t('panels.sticker.object3dDownloadFailed'));
      return;
    }
    const { playhead, selectClip } = useEditorStore.getState();
    const id = makeId('clip');
    const w = 0.34;
    addClip(
      'overlay',
      {
        kind: 'shape',
        id,
        start: playhead,
        duration: 4,
        shape: 'rectangle',
        position: { x: 0.5, y: 0.4 },
        w,
        // négyzetes PNG a 9:16 vásznon: a magasság-arányt a vászon-arány korrigálja
        h: w * 0.5625,
        fill: 'transparent',
        imageUri: uri,
        // 🌒 a 3D objektum alapból vet árnyékot a videóra: ettől „ül" a
        // jelenetben ahelyett, hogy rá lenne ragasztva. A sziluettet követi
        // (a render drop-shadow-ja), a Forma panelen kikapcsolható.
        shadow: true,
      },
      {
        id: makeId('ast'),
        kind: 'image',
        uri,
        provider: 'local',
        name: entry.label,
      }
    );
    selectClip(id);
    setPanel('shape');
  };

  /** 🙂 arc-matrica: az emoji az arcra kerül, és a követés rá is fut */
  const addFaceSticker = async (emoji: string) => {
    const state = useEditorStore.getState();
    if (!state.project || faceBusy) {
      return;
    }
    const video = activeVisualClip(state.project, state.playhead);
    if (!video || video.kind !== 'video') {
      Alert.alert(t('panels.sticker.faceStickerTitle'), t('panels.sticker.faceStickerNeedVideo'));
      return;
    }
    setFaceBusy(emoji);
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
          t('panels.sticker.faceStickerTitle'),
          faces === null
            ? t('panels.sticker.faceDetectorUnavailable')
            : t('panels.sticker.faceNotFound')
        );
        return;
      }
      const id = makeId('clip');
      const duration = Math.min(4, video.start + video.duration - state.playhead);
      // az arc fölé kerül (a homlok/haj vonalába), az arc méretéhez igazítva
      state.addClip('overlay', {
        kind: 'text',
        id,
        start: state.playhead,
        duration: Math.max(1, duration),
        text: emoji,
        color: '#ffffff',
        backgroundColor: null,
        fontSize: Math.round(Math.max(8, Math.min(30, face.h * 90))),
        fontWeight: 'normal',
        position: { x: face.x, y: Math.max(0.05, face.y - face.h * 0.75) },
        animation: 'pop',
        stylePreset: 'plain',
      });
      state.selectClip(id);
      Alert.alert(
        t('panels.sticker.faceStickerDoneTitle'),
        t('panels.sticker.faceStickerDoneBody')
      );
    } finally {
      setFaceBusy(null);
    }
  };

  const addSticker = (emoji: string) => {
    const { playhead } = useEditorStore.getState();
    addClip('overlay', {
      kind: 'text',
      id: makeId('clip'),
      start: playhead,
      duration: 3,
      text: emoji,
      color: '#ffffff',
      backgroundColor: null,
      fontSize: 12,
      fontWeight: 'normal',
      position: { x: 0.5, y: 0.35 },
      animation: 'pop',
      stylePreset: 'plain',
    });
    setPanel(null);
  };

  const addShape = (shape: 'rectangle' | 'ellipse' | 'line' | 'arrow' | 'star') => {
    const { playhead, selectClip } = useEditorStore.getState();
    const id = makeId('clip');
    addClip('overlay', {
      kind: 'shape',
      id,
      start: playhead,
      duration: 3,
      shape,
      position: { x: 0.5, y: 0.5 },
      w: shape === 'line' ? 0.6 : shape === 'star' ? 0.3 : 0.42,
      h:
        shape === 'line'
          ? 0.006
          : shape === 'ellipse'
            ? 0.24
            : shape === 'arrow'
              ? 0.12
              : shape === 'star'
                ? 0.17
                : 0.2,
      fill: shape === 'line' ? '#ffffff' : shape === 'star' ? '#ffd166' : palette.accent,
      cornerRadius: shape === 'rectangle' ? 0.15 : 0,
    });
    selectClip(id);
    setPanel('shape');
  };

  /** logó/kép beszúrása overlay-rétegként — aspect-helyes kezdőmérettel */
  const addLogo = async () => {
    const picked = await pickImage();
    if (!picked) {
      return;
    }
    const { playhead, selectClip } = useEditorStore.getState();
    // a kép arányához igazított kezdőméret (0.3 vászon-szélesség)
    const aspect = await new Promise<number>((resolve) => {
      RNImage.getSize(
        picked.uri,
        (w, h) => resolve(w > 0 && h > 0 ? w / h : 1),
        () => resolve(1)
      );
    });
    const w = 0.3;
    // vászon 9:16 → a magasság-arányt a vászon-arány korrigálja közelítőleg
    const h = Math.min(0.6, (w / aspect) * 0.5625);
    const id = makeId('clip');
    addClip(
      'overlay',
      {
        kind: 'shape',
        id,
        start: playhead,
        duration: 4,
        shape: 'rectangle',
        position: { x: 0.5, y: 0.35 },
        w,
        h,
        fill: 'transparent',
        imageUri: picked.uri,
      },
      {
        id: makeId('ast'),
        kind: 'image',
        uri: picked.uri,
        provider: 'local',
        name: t('panels.sticker.logoName'),
      }
    );
    selectClip(id);
    setPanel('shape');
  };

  return (
    <View>
      <PanelSection title={t('panels.sticker.shapesTitle')}>
        <View style={styles.shapeRow}>
          <Pressable style={styles.shapeCell} onPress={() => addShape('rectangle')}>
            <View style={styles.shapeRect} />
            <Text style={styles.shapeLabel}>{t('panels.sticker.shapeRectangle')}</Text>
          </Pressable>
          <Pressable style={styles.shapeCell} onPress={() => addShape('ellipse')}>
            <View style={styles.shapeEllipse} />
            <Text style={styles.shapeLabel}>{t('panels.sticker.shapeEllipse')}</Text>
          </Pressable>
          <Pressable style={styles.shapeCell} onPress={() => addShape('line')}>
            <View style={styles.shapeLine} />
            <Text style={styles.shapeLabel}>{t('panels.sticker.shapeLine')}</Text>
          </Pressable>
          <Pressable style={styles.shapeCell} onPress={() => addShape('arrow')}>
            <Text style={styles.shapeGlyph}>➜</Text>
            <Text style={styles.shapeLabel}>{t('panels.sticker.shapeArrow')}</Text>
          </Pressable>
          <Pressable style={styles.shapeCell} onPress={() => addShape('star')}>
            <Text style={styles.shapeGlyph}>★</Text>
            <Text style={styles.shapeLabel}>{t('panels.sticker.shapeStar')}</Text>
          </Pressable>
          <Pressable
            style={styles.shapeCell}
            onPress={() => {
              addLogo().catch(() =>
                Alert.alert(t('panels.sticker.logoName'), t('panels.sticker.logoLoadFailed'))
              );
            }}
          >
            <Ionicons name="image-outline" size={26} color={palette.textDim} />
            <Text style={styles.shapeLabel}>{t('panels.sticker.shapeLogo')}</Text>
          </Pressable>
        </View>
        <Text style={styles.note}>
          {t('panels.sticker.shapesNote')}
        </Text>
      </PanelSection>

      <PanelSection title={t('panels.sticker.particlesTitle')}>
        <View style={styles.shapeRow3d}>
          <Chip
            label={t('common.none')}
            active={!particles}
            onPress={() => dispatch({ type: 'SET_PARTICLES', particles: null }, 'user')}
          />
          {PARTICLE_PRESETS.map((preset) => (
            <Chip
              key={preset.id}
              label={t('panels.sticker.particle_' + preset.id)}
              active={particles?.preset === preset.id}
              onPress={() =>
                dispatch(
                  {
                    type: 'SET_PARTICLES',
                    particles: {
                      preset: preset.id,
                      beatSync: particles?.beatSync ?? true,
                      intensity: particles?.intensity ?? 1,
                    },
                  },
                  'user'
                )
              }
            />
          ))}
        </View>
        {particles ? (
          <View style={styles.shapeRow3d}>
            <Chip
              label={particles.beatSync ? t('panels.sticker.beatSyncOn') : t('panels.sticker.beatSyncOff')}
              active={particles.beatSync}
              onPress={() =>
                dispatch(
                  {
                    type: 'SET_PARTICLES',
                    particles: { ...particles, beatSync: !particles.beatSync },
                  },
                  'user'
                )
              }
            />
          </View>
        ) : null}
        <Text style={styles.note}>
          {t('panels.sticker.particlesNote')}
        </Text>
      </PanelSection>

      <PanelSection title={t('panels.sticker.drawTitle')}>
        <View style={styles.chipRow}>
          {BRUSH_STYLES.map((b) => (
            <Chip
              key={b.id}
              label={b.label}
              active={drawBrush?.style === b.id}
              onPress={() =>
                setDrawBrush(
                  drawBrush?.style === b.id
                    ? null
                    : {
                        color: drawBrush?.color ?? BRUSH_COLORS[0],
                        width: b.width,
                        style: b.id,
                        glow: b.glow,
                      }
                )
              }
            />
          ))}
        </View>
        {drawBrush ? (
          <>
            <Text style={styles.subLabel}>{t('panels.sticker.color')}</Text>
            <View style={styles.chipRow}>
              {BRUSH_COLORS.map((c) => (
                <Pressable
                  key={c}
                  onPress={() => setDrawBrush({ ...drawBrush, color: c })}
                  style={[
                    styles.swatch,
                    { backgroundColor: c },
                    drawBrush.color === c ? styles.swatchActive : null,
                  ]}
                />
              ))}
            </View>
            <Stepper
              label={t('panels.sticker.thickness')}
              value={`${drawBrush.width.toFixed(1)}%`}
              onDec={() =>
                setDrawBrush({
                  ...drawBrush,
                  width: Math.max(0.2, Math.round((drawBrush.width - 0.2) * 10) / 10),
                })
              }
              onInc={() =>
                setDrawBrush({
                  ...drawBrush,
                  width: Math.min(6, Math.round((drawBrush.width + 0.2) * 10) / 10),
                })
              }
            />
            <Chip
              label={t('panels.sticker.drawEnd')}
              active={false}
              onPress={() => setDrawBrush(null)}
            />
          </>
        ) : null}
        <Text style={styles.note}>
          {t('panels.sticker.drawNote')}
        </Text>
      </PanelSection>

      {stickers3d ? (
        <PanelSection title={t('panels.sticker.objects3dTitle')}>
          <View style={styles.shapeRow3d}>
            {stickers3d.map((entry) => (
              <Pressable
                key={entry.id}
                style={styles.shapeCell}
                onPress={() => {
                  void addSticker3d(entry);
                }}
              >
                <Image
                  source={{
                    uri:
                      `${renderServerUrl()}${entry.url}?size=160` +
                      `&material=${material}&env=${environment}`,
                  }}
                  style={styles.preview3d}
                  contentFit="contain"
                />
                <Text style={styles.shapeLabel}>
                  {busy3d === entry.id ? '⏳…' : entry.label}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.subLabel}>{t('panels.sticker.material')}</Text>
          <View style={styles.chipRow}>
            {STICKER_MATERIALS.map((m) => (
              <Chip
                key={m.id}
                label={m.label}
                active={material === m.id}
                onPress={() => setMaterial(m.id)}
              />
            ))}
          </View>
          <Text style={styles.subLabel}>{t('panels.sticker.environment')}</Text>
          <View style={styles.chipRow}>
            {STICKER_ENVIRONMENTS.map((e) => (
              <Chip
                key={e.id}
                label={e.label}
                active={environment === e.id}
                onPress={() => setEnvironment(e.id)}
              />
            ))}
          </View>
          <Text style={styles.note}>
            {t('panels.sticker.objects3dNote')}
          </Text>
        </PanelSection>
      ) : null}

      <PanelSection title={t('panels.sticker.faceStickerSectionTitle')}>
        <View style={styles.shapeRow3d}>
          {['😎', '🤯', '👑', '🔥', '💀', '🥸'].map((emoji) => (
            <Pressable
              key={emoji}
              style={styles.cell}
              onPress={() => {
                void addFaceSticker(emoji);
              }}
            >
              <Text style={styles.emoji}>{faceBusy === emoji ? '⏳' : emoji}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.note}>
          {t('panels.sticker.faceStickerNote')}
        </Text>
      </PanelSection>

      <PanelSection title={t('panels.sticker.tapStickerTitle')}>
        <View style={styles.grid}>
          {STICKERS.map((emoji) => (
            <Pressable key={emoji} style={styles.cell} onPress={() => addSticker(emoji)}>
              <Text style={styles.emoji}>{emoji}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.note}>
          {t('panels.sticker.tapStickerNote')}
        </Text>
      </PanelSection>
    </View>
  );
}

const styles = StyleSheet.create({
  shapeRow: {
    flexDirection: 'row',
    gap: 14,
  },
  shapeRow3d: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  preview3d: {
    width: 52,
    height: 52,
  },
  shapeCell: {
    alignItems: 'center',
    gap: 6,
    padding: 8,
    borderRadius: 10,
    backgroundColor: palette.surfaceHigh,
    minWidth: 84,
  },
  shapeRect: {
    width: 40,
    height: 26,
    borderRadius: 6,
    backgroundColor: palette.accent,
  },
  shapeEllipse: {
    width: 40,
    height: 26,
    borderRadius: 999,
    backgroundColor: palette.accent2,
  },
  shapeLine: {
    width: 44,
    height: 3,
    borderRadius: 2,
    marginVertical: 11.5,
    backgroundColor: '#ffffff',
  },
  shapeLabel: {
    color: palette.textDim,
    fontSize: 11,
    fontWeight: '600',
  },
  shapeGlyph: {
    fontSize: 24,
    lineHeight: 26,
    color: palette.accent2,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  cell: {
    width: 42,
    height: 42,
    borderRadius: 10,
    backgroundColor: palette.surfaceHigh,
    borderWidth: 1,
    borderColor: palette.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emoji: {
    fontSize: 22,
  },
  subLabel: {
    color: palette.textDim,
    fontSize: 11,
    fontWeight: '600',
    marginTop: 10,
    marginBottom: 4,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  swatch: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 2,
    borderColor: palette.border,
  },
  swatchActive: {
    borderColor: palette.text,
    borderWidth: 3,
  },
  note: {
    color: palette.textDim,
    fontSize: 11,
    lineHeight: 16,
    marginTop: 4,
  },
});
