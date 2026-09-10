import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { Alert, Image as RNImage, Pressable, StyleSheet, Text, View } from 'react-native';

import { Chip, PanelSection, Stepper } from '@/components/ui/controls';
import { aspectValue, filters, palette } from '@/constants/editor';
import { requestCutout } from '@/lib/bgremove';
import { CAMERA_PRESETS, buildCameraMove } from '@/lib/camera3d';
import { statsToAutoAdjust, statsToMatchAdjust } from '@/lib/colorAuto';
import { fetchColorStats } from '@/lib/colorClient';
import { requestDepthFocus, requestDepthParallax } from '@/lib/depthClient';
import { faceUnionRegion, fetchFaces } from '@/lib/faceClient';
import { makeId } from '@/lib/id';
import { PHOTO_ANIM_PRESETS, buildPhotoAnimation } from '@/lib/photoAnimate';
import { getFilmstrip, snapThumbTime } from '@/lib/thumbnails';
import { SKY_PRESETS, replaceSky } from '@/lib/skyClient';
import type { SkyPreset } from '@/lib/skyClient';
import { upscalePhoto } from '@/lib/upscaleClient';
import { clamp } from '@/lib/time';
import { useEditorStore } from '@/store/editorStore';
import type { ClipAdjust, ClipMask, ImageClip, LightingPreset, VideoClip } from '@/types/project';

const ADJUSTS: {
  key: keyof ClipAdjust;
  label: string;
  step: number;
  min: number;
  max: number;
}[] = [
  { key: 'brightness', label: 'Fényerő', step: 0.05, min: -0.3, max: 0.3 },
  { key: 'contrast', label: 'Kontraszt', step: 0.05, min: -0.4, max: 0.4 },
  { key: 'saturation', label: 'Szaturáció', step: 0.1, min: -1, max: 1 },
  { key: 'temperature', label: 'Hőmérséklet', step: 0.05, min: -0.3, max: 0.3 },
  { key: 'vignette', label: 'Vignetta', step: 0.1, min: 0, max: 1 },
];

const LIGHTING_PRESETS: { id: LightingPreset; label: string }[] = [
  { id: 'studio', label: '💡 Studio' },
  { id: 'sunset', label: '🌅 Sunset' },
  { id: 'neon', label: '🟣 Neon' },
  { id: 'cyberpunk', label: '🌃 Cyberpunk' },
];

/** freeform maszk-alakzatok: szabályos sokszögek + gyémánt (vászon-arányra igazítva) */
const POLY_SHAPES: { id: string; label: string; sides: number; rotate: number }[] = [
  { id: 'diamond', label: '◆ Gyémánt', sides: 4, rotate: 0 },
  { id: 'penta', label: '⬟ Ötszög', sides: 5, rotate: 0 },
  { id: 'hexa', label: '⬢ Hatszög', sides: 6, rotate: 0.5 },
  { id: 'octa', label: '⯃ Nyolcszög', sides: 8, rotate: 0.5 },
];

function polygonPointsFor(sides: number, rotate: number): { x: number; y: number }[] {
  return Array.from({ length: sides }, (_, i) => {
    const a = -Math.PI / 2 + (i + rotate) * ((2 * Math.PI) / sides);
    return {
      x: Math.round((0.5 + 0.36 * Math.cos(a)) * 1000) / 1000,
      y: Math.round((0.5 + 0.33 * Math.sin(a)) * 1000) / 1000,
    };
  });
}

const DEFAULT_MASK: ClipMask = {
  shape: 'ellipse',
  x: 0.5,
  y: 0.5,
  w: 0.6,
  h: 0.45,
  feather: 0.05,
};

export function FilterPanel({ clip }: { clip: VideoClip | ImageClip }) {
  const updateClip = useEditorStore((s) => s.updateClip);
  const maskEdit = useEditorStore((s) => s.maskEdit);
  const setMaskEdit = useEditorStore((s) => s.setMaskEdit);
  const intensity = clip.filterIntensity ?? 1;
  const [depthBusy, setDepthBusy] = useState(false);

  const toggleDepthParallax = async () => {
    if (clip.kind !== 'image' || depthBusy) {
      return;
    }
    if (clip.depthParallax) {
      updateClip(clip.id, { depthParallax: undefined });
      return;
    }
    setDepthBusy(true);
    const result = await requestDepthParallax(clip.uri);
    setDepthBusy(false);
    if (!result) {
      Alert.alert(
        '2.5D mélység',
        'A mélység-motor nem érhető el (worker + mélység-modell kell hozzá).'
      );
      return;
    }
    updateClip(clip.id, {
      depthParallax: { id: result.id, strength: 1 },
      // mozgás nélkül nem látszana a mélység — ha nincs, lágy push-in megy rá
      keyframes: clip.keyframes ?? buildCameraMove('pushIn', clip.duration).keyframes,
    });
  };

  const [focusBusy, setFocusBusy] = useState(false);
  const [cutoutBusy, setCutoutBusy] = useState(false);
  const [faceBusy, setFaceBusy] = useState(false);

  // 🙈 arc-elmosás: több kockán megkeresi az arcokat, és a befoglaló régiót
  // (a fejmozgást is lefedve) elmossa a renderben
  const toggleFaceBlur = async () => {
    if (faceBusy) {
      return;
    }
    if (clip.faceBlur) {
      updateClip(clip.id, { faceBlur: undefined });
      return;
    }
    setFaceBusy(true);
    try {
      const project = useEditorStore.getState().project;
      const ar = project ? aspectValue(project.aspectRatio) : 9 / 16;
      const span = clip.kind === 'video' ? clip.duration * clip.speed : 0;
      const start = clip.kind === 'video' ? clip.trimIn : 0;
      const times =
        clip.kind === 'video'
          ? [0.1, 0.3, 0.5, 0.7, 0.9].map((p) => start + span * p)
          : [0];
      const frames = await Promise.all(
        times.map((t) => fetchFaces(clip.uri, { atSec: t, aspectW: ar, aspectH: 1 }))
      );
      const found = frames.filter((f): f is NonNullable<typeof f> => Boolean(f));
      if (found.length === 0) {
        Alert.alert('Arc-elmosás', 'Az arc-detektor nem érhető el — fut a worker?');
        return;
      }
      const region = faceUnionRegion(found);
      if (!region) {
        Alert.alert(
          'Arc-elmosás',
          'Nem találtam arcot a klipben — próbáld másik klippel, vagy használd a Maszkot.'
        );
        return;
      }
      updateClip(clip.id, { faceBlur: { ...region, strength: 1 } });
    } finally {
      setFaceBusy(false);
    }
  };
  const [colorBusy, setColorBusy] = useState<'auto' | 'match' | null>(null);
  const [upscaleBusy, setUpscaleBusy] = useState(false);
  const [selectBusy, setSelectBusy] = useState(false);
  const [skyBusy, setSkyBusy] = useState<string | null>(null);

  // 🌅 égbolt-csere: a klip forrása a kompozit képre vált
  const applySky = async (preset: SkyPreset) => {
    if (clip.kind !== 'image' || skyBusy) {
      return;
    }
    setSkyBusy(preset);
    const uri = await replaceSky(clip.uri, preset);
    setSkyBusy(null);
    if (!uri) {
      Alert.alert('Égbolt-csere', 'Nem érhető el (worker + mélység-modell kell hozzá).');
      return;
    }
    updateClip(clip.id, { uri });
  };

  // 🎯 AI Select: a képjavítás csak a témára / csak a háttérre hasson
  const applySelective = async (target: 'subject' | 'background') => {
    if (clip.kind !== 'image' || selectBusy) {
      return;
    }
    if (clip.selective?.target === target) {
      updateClip(clip.id, { selective: undefined });
      return;
    }
    setSelectBusy(true);
    const result = await requestCutout(clip.uri);
    setSelectBusy(false);
    if (!result) {
      Alert.alert(
        'AI Select',
        'A kijelölés nem érhető el (worker + kivágás-modell kell hozzá).'
      );
      return;
    }
    updateClip(clip.id, { selective: { id: result.id, target } });
  };

  // 🔍 felnagyítás: a klip forrása a szuper-felbontású változatra cserélődik
  const upscaleClip = async (scale: 2 | 4) => {
    if (clip.kind !== 'image' || upscaleBusy) {
      if (clip.kind !== 'image') {
        Alert.alert('Felnagyítás', 'Ez a funkció képekre való (a videó-upscale GPU-t kér).');
      }
      return;
    }
    setUpscaleBusy(true);
    const result = await upscalePhoto(clip.uri, scale);
    setUpscaleBusy(false);
    if (!result) {
      Alert.alert(
        'Felnagyítás',
        'A felnagyítás nem érhető el (worker + szuper-felbontás modell kell hozzá).'
      );
      return;
    }
    updateClip(clip.id, { uri: result.uri });
    Alert.alert(
      'Felnagyítás kész',
      `A kép ${result.width}×${result.height} pixelre nagyítva (szuper-felbontás). ` +
        'A klip minden beállítása megmaradt — visszavonható.'
    );
  };
  // 🖼️ a szűrő-kártyák fotó-előnézete: a klip egy reprezentatív kockája,
  // kártyánként a szűrő színes tintjével — web/hiba esetén szín-minta marad
  const [videoThumb, setVideoThumb] = useState<string | null>(null);
  const midSnapped =
    clip.kind === 'video'
      ? snapThumbTime(clip.trimIn + (clip.duration * clip.speed) / 2)
      : 0;

  useEffect(() => {
    if (clip.kind !== 'video') {
      return;
    }
    let alive = true;
    getFilmstrip(clip.uri, [midSnapped]).then(([uri]) => {
      if (alive) {
        setVideoThumb(uri);
      }
    });
    return () => {
      alive = false;
    };
  }, [clip.kind, clip.uri, midSnapped]);

  const cardThumb = clip.kind === 'image' ? clip.uri : videoThumb;

  /** a klip közepének FORRÁS-ideje (a statisztika reprezentatív kockájához) */
  const sourceMidSec = (c: VideoClip | ImageClip) =>
    c.kind === 'video' ? c.trimIn + (c.duration * c.speed) / 2 : 0;

  // 🎨 Auto Color: mérés a workeren → konzervatív adjust-javaslat
  const autoColor = async () => {
    if (colorBusy) {
      return;
    }
    setColorBusy('auto');
    const stats = await fetchColorStats(clip.uri, sourceMidSec(clip));
    setColorBusy(null);
    if (!stats) {
      Alert.alert('Auto Color', 'A szín-elemzés nem érhető el — fut a worker?');
      return;
    }
    const adjust = statsToAutoAdjust(stats);
    if (Object.keys(adjust).length === 0) {
      Alert.alert('Auto Color', 'A kép már kiegyensúlyozott — nincs mit javítani.');
      return;
    }
    updateClip(clip.id, { adjust: { ...clip.adjust, ...adjust } });
  };

  // 🎯 Match Color: az idővonalon ELŐZŐ vizuális klip színvilágához igazít
  const matchColor = async () => {
    if (colorBusy) {
      return;
    }
    const project = useEditorStore.getState().project;
    const track = project?.tracks.find((t) => t.type === 'video');
    const prev = track?.clips
      .filter(
        (c) =>
          (c.kind === 'video' || c.kind === 'image') && c.start < clip.start
      )
      .sort((a, b) => b.start - a.start)[0] as VideoClip | ImageClip | undefined;
    if (!prev) {
      Alert.alert('Szín-igazítás', 'Nincs előző klip az idővonalon, amihez igazíthatnék.');
      return;
    }
    setColorBusy('match');
    const [target, reference] = await Promise.all([
      fetchColorStats(clip.uri, sourceMidSec(clip)),
      fetchColorStats(prev.uri, sourceMidSec(prev)),
    ]);
    setColorBusy(null);
    if (!target || !reference) {
      Alert.alert('Szín-igazítás', 'A szín-elemzés nem érhető el — fut a worker?');
      return;
    }
    const adjust = statsToMatchAdjust(target, reference);
    if (Object.keys(adjust).length === 0) {
      Alert.alert('Szín-igazítás', 'A két klip színvilága már összhangban van.');
      return;
    }
    updateClip(clip.id, { adjust: { ...clip.adjust, ...adjust } });
  };

  // 🪄 AI kivágás: a fotó témája átlátszó hátterű overlay-rétegként kerül a
  // vászonra — alá bármilyen új háttér tehető (szín/gradiens/kép/videó)
  const extractSubject = async () => {
    if (clip.kind !== 'image' || cutoutBusy) {
      return;
    }
    setCutoutBusy(true);
    const result = await requestCutout(clip.uri);
    setCutoutBusy(false);
    if (!result) {
      Alert.alert(
        'AI kivágás',
        'A kivágás-motor nem érhető el (worker + u2net modell kell hozzá).'
      );
      return;
    }
    const aspect = await new Promise<number>((resolve) => {
      RNImage.getSize(
        result.uri,
        (w, h) => resolve(w > 0 && h > 0 ? w / h : 1),
        () => resolve(1)
      );
    });
    const state = useEditorStore.getState();
    const w = 0.55;
    const id = makeId('clip');
    state.addClip(
      'overlay',
      {
        kind: 'shape',
        id,
        start: clip.start,
        duration: clip.duration,
        shape: 'rectangle',
        position: { x: 0.5, y: 0.5 },
        w,
        h: Math.min(0.85, (w / aspect) * 0.5625),
        fill: 'transparent',
        imageUri: result.uri,
      },
      {
        id: makeId('ast'),
        kind: 'image',
        uri: result.uri,
        provider: 'local',
        name: 'AI kivágás',
      }
    );
    state.selectClip(id);
    state.setPanel('shape');
    Alert.alert(
      'AI kivágás kész',
      'A téma külön rétegként került a vászonra — az eredeti fotót törölheted ' +
        'vagy kicserélheted, a kivágás alá bármilyen háttér tehető.'
    );
  };

  const setDepthFocus = async (mode: 'portrait' | 'toFar' | 'toNear') => {
    if (clip.kind !== 'image' || focusBusy) {
      return;
    }
    if (clip.depthFocus?.mode === mode) {
      updateClip(clip.id, { depthFocus: undefined });
      return;
    }
    setFocusBusy(true);
    const result = await requestDepthFocus(clip.uri);
    setFocusBusy(false);
    if (!result) {
      Alert.alert(
        'Mélység-fókusz',
        'A mélység-motor nem érhető el (worker + mélység-modell kell hozzá).'
      );
      return;
    }
    updateClip(clip.id, {
      depthFocus: { id: result.id, mode, previewUri: result.previewUri },
    });
  };

  return (
    <View>
      <PanelSection title="Szűrők">
        <View style={styles.grid}>
          {filters.map((filter) => (
            <Pressable
              key={filter.id}
              style={styles.filterCard}
              onPress={() => updateClip(clip.id, { filterId: filter.id })}
            >
              <View
                style={[
                  styles.filterSwatch,
                  {
                    backgroundColor:
                      filter.overlay && filter.overlay !== 'transparent'
                        ? filter.overlay
                        : palette.surfaceHigh,
                  },
                  clip.filterId === filter.id ? styles.filterSwatchActive : null,
                ]}
              >
                {cardThumb ? (
                  <>
                    <Image
                      source={{ uri: cardThumb }}
                      style={StyleSheet.absoluteFill}
                      contentFit="cover"
                    />
                    {filter.overlay ? (
                      <View
                        style={[
                          StyleSheet.absoluteFill,
                          {
                            backgroundColor: filter.overlay,
                            // a kis kártyán kissé erősített tint, hogy látsszon
                            opacity: clamp(filter.opacity * 1.5, 0.15, 0.6),
                          },
                        ]}
                      />
                    ) : null}
                  </>
                ) : null}
                {filter.id === 'none' ? (
                  <Ionicons name="ban-outline" size={18} color={palette.textDim} />
                ) : null}
              </View>
              <Text
                style={[
                  styles.filterName,
                  clip.filterId === filter.id ? styles.filterNameActive : null,
                ]}
                numberOfLines={1}
              >
                {filter.label}
              </Text>
            </Pressable>
          ))}
        </View>
        {clip.filterId !== 'none' ? (
          <Stepper
            label="Erősség"
            value={`${Math.round(intensity * 100)}%`}
            onDec={() =>
              updateClip(clip.id, { filterIntensity: clamp(intensity - 0.1, 0.1, 1) })
            }
            onInc={() =>
              updateClip(clip.id, { filterIntensity: clamp(intensity + 0.1, 0.1, 1) })
            }
          />
        ) : null}
        <Text style={styles.note}>
          Az előnézet közelítés — a végleges színkorrekció (LUT) a szerveroldali renderben
          érvényesül.
        </Text>
      </PanelSection>

      <PanelSection title="Képjavítás">
        <View style={styles.row}>
          <Chip
            label={colorBusy === 'auto' ? '🎨 Elemzés…' : '🎨 Auto Color'}
            active={false}
            onPress={() => {
              void autoColor();
            }}
          />
          <Chip
            label={colorBusy === 'match' ? '🎯 Elemzés…' : '🎯 Illesztés az előzőhöz'}
            active={false}
            onPress={() => {
              void matchColor();
            }}
          />
        </View>
        {ADJUSTS.map(({ key, label, step, min, max }) => {
          const value = clip.adjust?.[key] ?? 0;
          const set = (v: number) =>
            updateClip(clip.id, {
              adjust: { ...clip.adjust, [key]: Math.round(clamp(v, min, max) * 100) / 100 },
            });
          return (
            <Stepper
              key={key}
              label={label}
              value={`${value > 0 ? '+' : ''}${Math.round(value * 100)}`}
              onDec={() => set(value - step)}
              onInc={() => set(value + step)}
            />
          );
        })}
        {clip.adjust ? (
          <Chip
            label="Alaphelyzet"
            active={false}
            onPress={() => updateClip(clip.id, { adjust: undefined })}
          />
        ) : null}
        {clip.kind === 'image' ? (
          <View style={styles.row}>
            <Chip
              label="🎯 Mindenre"
              active={!clip.selective}
              onPress={() => updateClip(clip.id, { selective: undefined })}
            />
            <Chip
              label={selectBusy ? '🎯 Kijelölés…' : '🎯 Csak a témára'}
              active={clip.selective?.target === 'subject'}
              onPress={() => {
                void applySelective('subject');
              }}
            />
            <Chip
              label={selectBusy ? '🎯 Kijelölés…' : '🎯 Csak a háttérre'}
              active={clip.selective?.target === 'background'}
              onPress={() => {
                void applySelective('background');
              }}
            />
          </View>
        ) : null}
        <Text style={styles.note}>
          Az előnézet közelítés — a pontos fényerő/kontraszt/szaturáció/vignetta a
          renderben érvényesül (videón és képen közös motor).
        </Text>
      </PanelSection>

      <PanelSection title="Háttér-kitöltés">
        <View style={styles.row}>
          <Chip
            label="Fekete"
            active={(clip.backgroundFill ?? 'black') === 'black'}
            onPress={() => updateClip(clip.id, { backgroundFill: 'black' })}
          />
          <Chip
            label="Elmosott"
            active={clip.backgroundFill === 'blur'}
            onPress={() => updateClip(clip.id, { backgroundFill: 'blur' })}
          />
        </View>
        <Text style={styles.note}>
          Ha a klip aránya nem egyezik a vászonnal, a sávok feketék vagy a klip
          elmosott, kitöltő változatával telnek meg (a valódi blur a renderben).
        </Text>
      </PanelSection>

      <PanelSection title="Animálás (Animate Photo)">
        <View style={styles.row}>
          {PHOTO_ANIM_PRESETS.map((preset) => (
            <Chip
              key={preset.id}
              label={preset.label}
              active={false}
              onPress={() =>
                updateClip(clip.id, {
                  keyframes: buildPhotoAnimation(preset.id, clip.duration),
                })
              }
            />
          ))}
          {clip.keyframes ? (
            <Chip
              label="✕ Nincs"
              active={false}
              onPress={() => updateClip(clip.id, { keyframes: undefined })}
            />
          ) : null}
        </View>
        <Text style={styles.note}>
          Egy koppintás → kész kameramozgás (kulcskockákkal — a Pontos igazítás
          panelen tovább finomítható; előnézetben és renderben is él).
        </Text>
      </PanelSection>

      <PanelSection title="🙈 Arc-elmosás (adatvédelem)">
        <View style={styles.row}>
          <Chip
            label={
              faceBusy
                ? '🙈 Arc keresése…'
                : clip.faceBlur
                  ? '🙈 Elmosás be ✓'
                  : '🙈 Arc elmosása'
            }
            active={Boolean(clip.faceBlur)}
            onPress={() => {
              void toggleFaceBlur();
            }}
          />
          {clip.faceBlur ? (
            <Chip
              label={clip.faceBlur.pixelate ? '🔲 Mozaik' : '🌫️ Lágy'}
              active={clip.faceBlur.pixelate === true}
              onPress={() =>
                updateClip(clip.id, {
                  faceBlur: { ...clip.faceBlur!, pixelate: !clip.faceBlur!.pixelate },
                })
              }
            />
          ) : null}
        </View>
        {clip.faceBlur ? (
          <Stepper
            label="Erősség"
            value={`${Math.round((clip.faceBlur.strength ?? 1) * 100)}%`}
            onDec={() =>
              updateClip(clip.id, {
                faceBlur: {
                  ...clip.faceBlur!,
                  strength: clamp((clip.faceBlur!.strength ?? 1) - 0.2, 0.3, 2),
                },
              })
            }
            onInc={() =>
              updateClip(clip.id, {
                faceBlur: {
                  ...clip.faceBlur!,
                  strength: clamp((clip.faceBlur!.strength ?? 1) + 0.2, 0.3, 2),
                },
              })
            }
          />
        ) : null}
        <Text style={styles.note}>
          Az AI megkeresi az arcokat több képkockán, és a befoglaló területet
          elmossa (a fejmozgást is lefedve) — lágy blur vagy mozaik. A renderben
          ég be, az előnézet jelöléssel mutatja.
        </Text>
      </PanelSection>

      {clip.kind === 'image' ? (
        <PanelSection title="🌅 Égbolt-csere">
          <View style={styles.row}>
            {SKY_PRESETS.map((preset) => (
              <Chip
                key={preset.id}
                label={skyBusy === preset.id ? '⏳…' : preset.label}
                active={false}
                onPress={() => {
                  void applySky(preset.id);
                }}
              />
            ))}
          </View>
          <Text style={styles.note}>
            Az AI mélység-térképből ismeri fel az eget, és lecseréli — a téma és
            az előtér marad. Az eredmény a klip új forrása lesz (visszavonható).
          </Text>
        </PanelSection>
      ) : null}

      <PanelSection title="💡 Fény (lighting)">
        <View style={styles.row}>
          <Chip
            label="Nincs"
            active={!clip.lighting}
            onPress={() => updateClip(clip.id, { lighting: undefined })}
          />
          {LIGHTING_PRESETS.map((preset) => (
            <Chip
              key={preset.id}
              label={preset.label}
              active={clip.lighting === preset.id}
              onPress={() => updateClip(clip.id, { lighting: preset.id })}
            />
          ))}
        </View>
        <Text style={styles.note}>
          Hangulat-világítás egy koppintásra — a renderben valódi split-tone
          color grade ég be (árnyék/középtónus/csúcsfény külön színnel), az
          előnézet tinttel közelít. A képjavítással kombinálható.
        </Text>
      </PanelSection>

      <PanelSection title="🧊 3D tér (döntés + kamera)">
        <Stepper
          label="Döntés ↕"
          value={`${clip.tilt3d?.rotX ?? 0}°`}
          onDec={() =>
            updateClip(clip.id, {
              tilt3d: {
                rotX: clamp((clip.tilt3d?.rotX ?? 0) - 5, -45, 45),
                rotY: clip.tilt3d?.rotY ?? 0,
              },
            })
          }
          onInc={() =>
            updateClip(clip.id, {
              tilt3d: {
                rotX: clamp((clip.tilt3d?.rotX ?? 0) + 5, -45, 45),
                rotY: clip.tilt3d?.rotY ?? 0,
              },
            })
          }
        />
        <Stepper
          label="Döntés ↔"
          value={`${clip.tilt3d?.rotY ?? 0}°`}
          onDec={() =>
            updateClip(clip.id, {
              tilt3d: {
                rotX: clip.tilt3d?.rotX ?? 0,
                rotY: clamp((clip.tilt3d?.rotY ?? 0) - 5, -45, 45),
              },
            })
          }
          onInc={() =>
            updateClip(clip.id, {
              tilt3d: {
                rotX: clip.tilt3d?.rotX ?? 0,
                rotY: clamp((clip.tilt3d?.rotY ?? 0) + 5, -45, 45),
              },
            })
          }
        />
        <View style={styles.row}>
          {CAMERA_PRESETS.map((preset) => (
            <Chip
              key={preset.id}
              label={preset.label}
              active={false}
              onPress={() => {
                const move = buildCameraMove(preset.id, clip.duration);
                updateClip(clip.id, {
                  keyframes: move.keyframes,
                  tilt3d: move.tilt3d,
                });
              }}
            />
          ))}
          {clip.tilt3d ? (
            <Chip
              label="✕ Döntés ki"
              active={false}
              onPress={() => updateClip(clip.id, { tilt3d: undefined })}
            />
          ) : null}
        </View>
        {clip.kind === 'image' ? (
          <View style={styles.row}>
            <Chip
              label={
                depthBusy
                  ? '🏔️ Mélység számítása…'
                  : clip.depthParallax
                    ? '🏔️ 2.5D mélység ✓'
                    : '🏔️ 2.5D mélység'
              }
              active={Boolean(clip.depthParallax)}
              onPress={() => {
                void toggleDepthParallax();
              }}
            />
            <Chip
              label={focusBusy ? '⏳…' : '🌫️ Portré-blur'}
              active={clip.depthFocus?.mode === 'portrait'}
              onPress={() => {
                void setDepthFocus('portrait');
              }}
            />
            <Chip
              label="🎬 Fókusz hátra"
              active={clip.depthFocus?.mode === 'toFar'}
              onPress={() => {
                void setDepthFocus('toFar');
              }}
            />
            <Chip
              label="🎬 Fókusz előre"
              active={clip.depthFocus?.mode === 'toNear'}
              onPress={() => {
                void setDepthFocus('toNear');
              }}
            />
            <Chip
              label={cutoutBusy ? '🪄 Kivágás…' : '🪄 Téma kivágása'}
              active={false}
              onPress={() => {
                void extractSubject();
              }}
            />
            <Chip
              label={upscaleBusy ? '🔍 Nagyítás…' : '🔍 Felnagyítás 2×'}
              active={false}
              onPress={() => {
                void upscaleClip(2);
              }}
            />
            <Chip
              label={upscaleBusy ? '🔍 Nagyítás…' : '🔍 4×'}
              active={false}
              onPress={() => {
                void upscaleClip(4);
              }}
            />
          </View>
        ) : null}
        <Text style={styles.note}>
          A klip térben megdől (a renderben valódi perspektíva-warp), a
          kamera-presetek kulcskockákat írnak — a döntés és a mozgás utána
          szabadon finomítható. A maszkkal a döntés nem kombinálódik. Fotón a
          2.5D mélység AI-mélységbecsléssel rétegekre bontja a képet, és a
          kameramozgás mélység-parallaxisszal kel életre a renderelt videóban
          (az előnézet a lapos fotót mozgatja). A 🌫️ portré-blur a távoli
          tartalmat mossa el (az előnézetben is), a 🎬 fókusz-húzás pedig a
          renderben úsztatja át az élességet a téma és a háttér között. A 🪄
          téma-kivágás a fotó alanyát külön, átlátszó hátterű rétegként teszi a
          vászonra — alá bármilyen új háttér kerülhet.
        </Text>
      </PanelSection>

      <PanelSection title="Maszk">
        <View style={styles.row}>
          <Chip
            label="Nincs"
            active={!clip.mask}
            onPress={() => updateClip(clip.id, { mask: undefined })}
          />
          <Chip
            label="Ellipszis"
            active={clip.mask?.shape === 'ellipse'}
            onPress={() =>
              updateClip(clip.id, { mask: { ...DEFAULT_MASK, ...clip.mask, shape: 'ellipse' } })
            }
          />
          <Chip
            label="Téglalap"
            active={clip.mask?.shape === 'rectangle'}
            onPress={() =>
              updateClip(clip.id, { mask: { ...DEFAULT_MASK, ...clip.mask, shape: 'rectangle' } })
            }
          />
        </View>
        {/* freeform (poligon) alakzatok — a renderben pontos kivágás */}
        <View style={styles.row}>
          {POLY_SHAPES.map((poly) => (
            <Chip
              key={poly.id}
              label={poly.label}
              active={
                clip.mask?.shape === 'polygon' &&
                clip.mask.points?.length === poly.sides
              }
              onPress={() =>
                updateClip(clip.id, {
                  mask: {
                    ...DEFAULT_MASK,
                    ...clip.mask,
                    shape: 'polygon',
                    points: polygonPointsFor(poly.sides, poly.rotate),
                  },
                })
              }
            />
          ))}
          {clip.mask ? (
            <Chip
              label="Invert"
              active={clip.mask.invert === true}
              onPress={() =>
                updateClip(clip.id, { mask: { ...clip.mask!, invert: !clip.mask!.invert } })
              }
            />
          ) : null}
        </View>
        {clip.mask ? (
          <>
            <Chip
              label={maskEdit ? '✓ Fogantyúk bekapcsolva' : '✋ Igazítás a vásznon'}
              active={maskEdit}
              onPress={() => setMaskEdit(!maskEdit)}
            />
            <Text style={styles.note}>
              Bekapcsolva a maszk kerete és fogantyúi megjelennek az előnézeten:
              a keretet húzva mozgatod, a sarkát húzva méretezed. Poligonnál
              minden csúcs külön is húzható.
            </Text>
            <Stepper
              label="Szélesség"
              value={`${Math.round(clip.mask.w * 100)}%`}
              onDec={() =>
                updateClip(clip.id, { mask: { ...clip.mask!, w: clamp(clip.mask!.w - 0.05, 0.1, 1) } })
              }
              onInc={() =>
                updateClip(clip.id, { mask: { ...clip.mask!, w: clamp(clip.mask!.w + 0.05, 0.1, 1) } })
              }
            />
            <Stepper
              label="Magasság"
              value={`${Math.round(clip.mask.h * 100)}%`}
              onDec={() =>
                updateClip(clip.id, { mask: { ...clip.mask!, h: clamp(clip.mask!.h - 0.05, 0.1, 1) } })
              }
              onInc={() =>
                updateClip(clip.id, { mask: { ...clip.mask!, h: clamp(clip.mask!.h + 0.05, 0.1, 1) } })
              }
            />
            <Stepper
              label="Vízszintes pozíció"
              value={`${Math.round(clip.mask.x * 100)}%`}
              onDec={() =>
                updateClip(clip.id, { mask: { ...clip.mask!, x: clamp(clip.mask!.x - 0.05, 0, 1) } })
              }
              onInc={() =>
                updateClip(clip.id, { mask: { ...clip.mask!, x: clamp(clip.mask!.x + 0.05, 0, 1) } })
              }
            />
            <Stepper
              label="Függőleges pozíció"
              value={`${Math.round(clip.mask.y * 100)}%`}
              onDec={() =>
                updateClip(clip.id, { mask: { ...clip.mask!, y: clamp(clip.mask!.y - 0.05, 0, 1) } })
              }
              onInc={() =>
                updateClip(clip.id, { mask: { ...clip.mask!, y: clamp(clip.mask!.y + 0.05, 0, 1) } })
              }
            />
            <Stepper
              label="Lágy szél"
              value={`${Math.round((clip.mask.feather ?? 0.05) * 100)}%`}
              onDec={() =>
                updateClip(clip.id, {
                  mask: { ...clip.mask!, feather: clamp((clip.mask!.feather ?? 0.05) - 0.02, 0, 0.3) },
                })
              }
              onInc={() =>
                updateClip(clip.id, {
                  mask: { ...clip.mask!, feather: clamp((clip.mask!.feather ?? 0.05) + 0.02, 0, 0.3) },
                })
              }
            />
          </>
        ) : null}
        <Text style={styles.note}>
          Az előnézet a maszk körvonalát és a takart terület sötétítését mutatja —
          a valódi lágy szélű kivágás a renderben készül.
        </Text>
      </PanelSection>

      <PanelSection title="Green screen (chroma)">
        <View style={styles.row}>
          <Chip
            label="Nincs"
            active={!clip.chromaKey}
            onPress={() => updateClip(clip.id, { chromaKey: undefined })}
          />
          <Chip
            label="🟩 Zöld"
            active={clip.chromaKey?.color === '#00ff00'}
            onPress={() =>
              updateClip(clip.id, {
                chromaKey: { color: '#00ff00', similarity: clip.chromaKey?.similarity ?? 0.18 },
              })
            }
          />
          <Chip
            label="🟦 Kék"
            active={clip.chromaKey?.color === '#0000ff'}
            onPress={() =>
              updateClip(clip.id, {
                chromaKey: { color: '#0000ff', similarity: clip.chromaKey?.similarity ?? 0.18 },
              })
            }
          />
        </View>
        {clip.chromaKey ? (
          <Stepper
            label="Tűrés"
            value={`${Math.round(clip.chromaKey.similarity * 100)}%`}
            onDec={() =>
              updateClip(clip.id, {
                chromaKey: {
                  ...clip.chromaKey!,
                  similarity: clamp(clip.chromaKey!.similarity - 0.03, 0.05, 0.45),
                },
              })
            }
            onInc={() =>
              updateClip(clip.id, {
                chromaKey: {
                  ...clip.chromaKey!,
                  similarity: clamp(clip.chromaKey!.similarity + 0.03, 0.05, 0.45),
                },
              })
            }
          />
        ) : null}
        <Text style={styles.note}>
          A kulcs-szín a renderben válik átlátszóvá (a háttér-kitöltéssel
          kombinálható: fekete vagy elmosott háttér kerül mögé).
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
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  filterCard: {
    width: 76,
    alignItems: 'center',
    gap: 5,
  },
  filterSwatchActive: {
    borderColor: palette.accent,
  },
  filterSwatch: {
    width: 76,
    height: 56,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'transparent',
    overflow: 'hidden',
  },
  filterName: {
    color: palette.textDim,
    fontSize: 11,
    fontWeight: '600',
  },
  filterNameActive: {
    color: palette.accent,
  },
  note: {
    color: palette.textDim,
    fontSize: 11,
    lineHeight: 16,
  },
});
