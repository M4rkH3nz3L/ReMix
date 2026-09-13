import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Image as RNImage, Pressable, StyleSheet, Text, View } from 'react-native';

import { Chip, PanelSection, PrimaryButton, Stepper } from '@/components/ui/controls';
import { aspectValue, filters, palette } from '@/constants/editor';
import { requestCutout } from '@/lib/bgremove';
import { CAMERA_PRESETS, buildCameraMove } from '@/lib/camera3d';
import { statsToAutoAdjust, statsToMatchAdjust } from '@/lib/colorAuto';
import { fetchColorStats } from '@/lib/colorClient';
import { requestDepthFocus, requestDepthParallax } from '@/lib/depthClient';
import { faceUnionRegion, fetchFaces, pickPrimaryFace } from '@/lib/faceClient';
import { makeId } from '@/lib/id';
import { addMaskKeyframe, hasMaskTrack, maskKeyframeTimes, removeMaskKeyframeAt, sampleMaskAt, trackToPoints } from '@/lib/maskAnim';
import { smoothMask } from '@/lib/maskEdit';
import { pickImage } from '@/lib/media';
import { trackSubject } from '@/lib/track';
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
  step: number;
  min: number;
  max: number;
}[] = [
  { key: 'brightness', step: 0.05, min: -0.3, max: 0.3 },
  { key: 'contrast', step: 0.05, min: -0.4, max: 0.4 },
  { key: 'saturation', step: 0.1, min: -1, max: 1 },
  { key: 'temperature', step: 0.05, min: -0.3, max: 0.3 },
  { key: 'vignette', step: 0.1, min: 0, max: 1 },
];

const LIGHTING_PRESETS: { id: LightingPreset; label: string }[] = [
  { id: 'studio', label: '💡 Studio' },
  { id: 'sunset', label: '🌅 Sunset' },
  { id: 'neon', label: '🟣 Neon' },
  { id: 'cyberpunk', label: '🌃 Cyberpunk' },
];

/** freeform maszk-alakzatok: szabályos sokszögek + gyémánt (vászon-arányra igazítva) */
const POLY_SHAPES: { id: string; sides: number; rotate: number }[] = [
  { id: 'diamond', sides: 4, rotate: 0 },
  { id: 'penta', sides: 5, rotate: 0 },
  { id: 'hexa', sides: 6, rotate: 0.5 },
  { id: 'octa', sides: 8, rotate: 0.5 },
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
  const { t } = useTranslation();
  const updateClip = useEditorStore((s) => s.updateClip);
  const maskEdit = useEditorStore((s) => s.maskEdit);
  const setMaskEdit = useEditorStore((s) => s.setMaskEdit);
  const drawMaskMode = useEditorStore((s) => s.drawMaskMode);
  const setDrawMaskMode = useEditorStore((s) => s.setDrawMaskMode);
  const rotoMask = useEditorStore((s) => s.rotoMask);
  const setRotoMask = useEditorStore((s) => s.setRotoMask);
  const playhead = useEditorStore((s) => s.playhead);
  const setPlayhead = useEditorStore((s) => s.setPlayhead);
  const setPickTarget = useEditorStore((s) => s.setPickTarget);
  const [blurTrackBusy, setBlurTrackBusy] = useState(false);

  /** 🎯 blur követi az objektumot: a vásznon rákoppintasz, a régió végigköveti (videón) */
  const trackBlur = (point: { x: number; y: number }) => {
    if (clip.kind !== 'video' || blurTrackBusy) {
      return;
    }
    const state = useEditorStore.getState();
    const project = state.project;
    if (!project) {
      return;
    }
    if (state.playhead < clip.start || state.playhead >= clip.start + clip.duration) {
      Alert.alert(t('panels.filter.blurTrackTitle'), t('panels.filter.blurTrackPlayhead'));
      return;
    }
    const endTl = Math.min(clip.start + clip.duration, state.playhead + 15);
    const durTl = endTl - state.playhead;
    if (durTl < 0.5) {
      Alert.alert(t('panels.filter.blurTrackTitle'), t('panels.filter.trackNoSubject'));
      return;
    }
    const startInClip = state.playhead - clip.start;
    setBlurTrackBusy(true);
    trackSubject(clip.uri, {
      startSec: clip.trimIn + startInClip * clip.speed,
      durationSec: durTl * clip.speed,
      cx: point.x,
      cy: point.y,
      aspectW: aspectValue(project.aspectRatio),
      aspectH: 1,
    })
      .then((points) => {
        if (!points) {
          Alert.alert(t('panels.filter.blurTrackTitle'), t('panels.filter.trackNoSubject'));
          return;
        }
        // klip-lokális idő = a szakasz kezdete + forrás-idő/sebesség
        const track = points.map((p) => ({ t: startInClip + p.t / clip.speed, x: p.x, y: p.y }));
        const prev = clip.faceBlur;
        state.updateClip(clip.id, {
          faceBlur: {
            x: point.x,
            y: point.y,
            w: prev?.w ?? 0.25,
            h: prev?.h ?? 0.25,
            strength: prev?.strength ?? 1,
            pixelate: prev?.pixelate,
            track,
          },
        });
        Alert.alert(t('panels.filter.blurTrackDone'), t('panels.filter.blurTrackDoneBody', { count: track.length }));
      })
      .catch((err: Error) => Alert.alert(t('panels.filter.blurTrackTitle'), err.message))
      .finally(() => setBlurTrackBusy(false));
  };
  const startBlurTrackPick = () => {
    Alert.alert(t('panels.filter.blurTrackTitle'), t('panels.filter.blurTrackHint'));
    setPickTarget((point) => trackBlur(point));
  };

  /** 🎯 követés arcra: a maszkot a detektált elsődleges arc mozgásához kulcskockázza (Pro) */
  const trackMaskToFace = async () => {
    const mask = clip.mask;
    if (!mask) {
      return;
    }
    const project = useEditorStore.getState().project;
    const [aw, ah] = (project?.aspectRatio ?? '16:9').split(':').map(Number);
    const N = 6;
    const samples: { time: number; x: number; y: number }[] = [];
    try {
      for (let i = 0; i < N; i++) {
        const tl = ((i + 0.5) / N) * clip.duration;
        const atSec = clip.kind === 'video' ? clip.trimIn + tl * clip.speed : tl;
        const faces = await fetchFaces(clip.uri, { atSec, aspectW: aw || 16, aspectH: ah || 9 });
        const face = faces ? pickPrimaryFace(faces) : null;
        if (face) {
          samples.push({ time: tl, x: face.x, y: face.y });
        }
      }
    } catch (err) {
      Alert.alert(t('panels.filter.maskTrackFace'), (err as Error).message);
      return;
    }
    if (samples.length >= 2) {
      updateClip(clip.id, { mask: trackToPoints(mask, samples) });
      setRotoMask(true);
    } else {
      Alert.alert(t('panels.filter.maskTrackFace'), t('panels.filter.trackNoFace'));
    }
  };

  /** 🎯 követés a mozgó témára: a maszk középpontjából indított pont-követés (/track) */
  const trackMaskToSubject = async () => {
    const mask = clip.mask;
    if (!mask) {
      return;
    }
    const project = useEditorStore.getState().project;
    const [aw, ah] = (project?.aspectRatio ?? '16:9').split(':').map(Number);
    const speed = clip.kind === 'video' ? clip.speed : 1;
    const startSec = clip.kind === 'video' ? clip.trimIn : 0;
    const durationSec = clip.duration * speed;
    try {
      const pts = await trackSubject(clip.uri, {
        startSec,
        durationSec,
        cx: mask.x,
        cy: mask.y,
        aspectW: aw || 16,
        aspectH: ah || 9,
      });
      if (pts && pts.length >= 2) {
        // a pont-idő a startSec-től forrás-mp → klip-lokálisra a sebességgel osztunk
        updateClip(clip.id, {
          mask: trackToPoints(mask, pts.map((p) => ({ time: p.t / speed, x: p.x, y: p.y }))),
        });
        setRotoMask(true);
      } else {
        Alert.alert(t('panels.filter.maskTrackSubject'), t('panels.filter.trackNoSubject'));
      }
    } catch (err) {
      Alert.alert(t('panels.filter.maskTrackSubject'), (err as Error).message);
    }
  };
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
        t('panels.filter.depthTitle'),
        t('panels.filter.depthUnavailable')
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
        Alert.alert(t('panels.filter.faceBlurTitle'), t('panels.filter.faceDetectorUnavailable'));
        return;
      }
      const region = faceUnionRegion(found);
      if (!region) {
        Alert.alert(
          t('panels.filter.faceBlurTitle'),
          t('panels.filter.faceNotFound')
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
      Alert.alert(t('panels.filter.skyTitle'), t('panels.filter.skyUnavailable'));
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
        t('panels.filter.aiSelectTitle'),
        t('panels.filter.aiSelectUnavailable')
      );
      return;
    }
    updateClip(clip.id, { selective: { id: result.id, target } });
  };

  // 🔍 felnagyítás: a klip forrása a szuper-felbontású változatra cserélődik
  const upscaleClip = async (scale: 2 | 4) => {
    if (clip.kind !== 'image' || upscaleBusy) {
      if (clip.kind !== 'image') {
        Alert.alert(t('panels.filter.upscaleTitle'), t('panels.filter.upscaleImagesOnly'));
      }
      return;
    }
    setUpscaleBusy(true);
    const result = await upscalePhoto(clip.uri, scale);
    setUpscaleBusy(false);
    if (!result) {
      Alert.alert(
        t('panels.filter.upscaleTitle'),
        t('panels.filter.upscaleUnavailable')
      );
      return;
    }
    updateClip(clip.id, { uri: result.uri });
    Alert.alert(
      t('panels.filter.upscaleDoneTitle'),
      t('panels.filter.upscaleDoneBody', { width: result.width, height: result.height })
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
      Alert.alert(t('panels.filter.autoColorTitle'), t('panels.filter.colorAnalysisUnavailable'));
      return;
    }
    const adjust = statsToAutoAdjust(stats);
    if (Object.keys(adjust).length === 0) {
      Alert.alert(t('panels.filter.autoColorTitle'), t('panels.filter.autoColorBalanced'));
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
      Alert.alert(t('panels.filter.matchColorTitle'), t('panels.filter.matchColorNoPrev'));
      return;
    }
    setColorBusy('match');
    const [target, reference] = await Promise.all([
      fetchColorStats(clip.uri, sourceMidSec(clip)),
      fetchColorStats(prev.uri, sourceMidSec(prev)),
    ]);
    setColorBusy(null);
    if (!target || !reference) {
      Alert.alert(t('panels.filter.matchColorTitle'), t('panels.filter.colorAnalysisUnavailable'));
      return;
    }
    const adjust = statsToMatchAdjust(target, reference);
    if (Object.keys(adjust).length === 0) {
      Alert.alert(t('panels.filter.matchColorTitle'), t('panels.filter.matchColorAligned'));
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
        t('panels.filter.aiCutoutTitle'),
        t('panels.filter.aiCutoutUnavailable')
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
        name: t('panels.filter.aiCutoutTitle'),
      }
    );
    state.selectClip(id);
    state.setPanel('shape');
    Alert.alert(
      t('panels.filter.aiCutoutDoneTitle'),
      t('panels.filter.aiCutoutDoneBody')
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
        t('panels.filter.depthFocusTitle'),
        t('panels.filter.depthUnavailable')
      );
      return;
    }
    updateClip(clip.id, {
      depthFocus: { id: result.id, mode, previewUri: result.previewUri },
    });
  };

  return (
    <View>
      {clip.kind === 'image' ? (
        <PanelSection title={t('panels.filter.sectionImageStudio')}>
          <PrimaryButton
            icon="brush-outline"
            label={t('panels.filter.openImageStudio')}
            onPress={() => useEditorStore.getState().openImageStudio(clip.id)}
          />
          <Text style={{ color: palette.textDim, fontSize: 11, marginTop: 6, lineHeight: 16 }}>
            {t('panels.filter.imageStudioHint')}
          </Text>
        </PanelSection>
      ) : null}
      <PanelSection title={t('panels.filter.sectionFilters')}>
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
                {t(filter.label)}
              </Text>
            </Pressable>
          ))}
        </View>
        {clip.filterId !== 'none' ? (
          <Stepper
            label={t('panels.filter.strength')}
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
          {t('panels.filter.noteFilters')}
        </Text>
      </PanelSection>

      <PanelSection title={t('panels.filter.sectionEnhance')}>
        <View style={styles.row}>
          <Chip
            label={colorBusy === 'auto' ? t('panels.filter.chipAnalyzingColor') : t('panels.filter.chipAutoColor')}
            active={false}
            onPress={() => {
              void autoColor();
            }}
          />
          <Chip
            label={colorBusy === 'match' ? t('panels.filter.chipAnalyzingMatch') : t('panels.filter.chipMatchPrev')}
            active={false}
            onPress={() => {
              void matchColor();
            }}
          />
        </View>
        {ADJUSTS.map(({ key, step, min, max }) => {
          const value = clip.adjust?.[key] ?? 0;
          const set = (v: number) =>
            updateClip(clip.id, {
              adjust: { ...clip.adjust, [key]: Math.round(clamp(v, min, max) * 100) / 100 },
            });
          return (
            <Stepper
              key={key}
              label={t('panels.filter.adjust_' + key)}
              value={`${value > 0 ? '+' : ''}${Math.round(value * 100)}`}
              onDec={() => set(value - step)}
              onInc={() => set(value + step)}
            />
          );
        })}
        {clip.adjust ? (
          <Chip
            label={t('common.reset')}
            active={false}
            onPress={() => updateClip(clip.id, { adjust: undefined })}
          />
        ) : null}
        {clip.kind === 'image' ? (
          <View style={styles.row}>
            <Chip
              label={t('panels.filter.chipSelectAll')}
              active={!clip.selective}
              onPress={() => updateClip(clip.id, { selective: undefined })}
            />
            <Chip
              label={selectBusy ? t('panels.filter.chipSelecting') : t('panels.filter.chipSubjectOnly')}
              active={clip.selective?.target === 'subject'}
              onPress={() => {
                void applySelective('subject');
              }}
            />
            <Chip
              label={selectBusy ? t('panels.filter.chipSelecting') : t('panels.filter.chipBackgroundOnly')}
              active={clip.selective?.target === 'background'}
              onPress={() => {
                void applySelective('background');
              }}
            />
          </View>
        ) : null}
        <Text style={styles.note}>
          {t('panels.filter.noteEnhance')}
        </Text>
      </PanelSection>

      <PanelSection title={t('panels.filter.sectionBackgroundFill')}>
        <View style={styles.row}>
          <Chip
            label={t('panels.filter.chipBlack')}
            active={(clip.backgroundFill ?? 'black') === 'black'}
            onPress={() => updateClip(clip.id, { backgroundFill: 'black' })}
          />
          <Chip
            label={t('panels.filter.chipBlurred')}
            active={clip.backgroundFill === 'blur'}
            onPress={() => updateClip(clip.id, { backgroundFill: 'blur' })}
          />
        </View>
        <Text style={styles.note}>
          {t('panels.filter.noteBackgroundFill')}
        </Text>
      </PanelSection>

      <PanelSection title={t('panels.filter.sectionAnimate')}>
        <View style={styles.row}>
          {PHOTO_ANIM_PRESETS.map((preset) => (
            <Chip
              key={preset.id}
              label={t(preset.label)}
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
              label={t('panels.filter.chipNoneX')}
              active={false}
              onPress={() => updateClip(clip.id, { keyframes: undefined })}
            />
          ) : null}
        </View>
        <Text style={styles.note}>
          {t('panels.filter.noteAnimate')}
        </Text>
      </PanelSection>

      <PanelSection title={t('panels.filter.sectionFaceBlur')}>
        <View style={styles.row}>
          <Chip
            label={
              faceBusy
                ? t('panels.filter.chipFaceSearching')
                : clip.faceBlur
                  ? t('panels.filter.chipFaceBlurOn')
                  : t('panels.filter.chipFaceBlur')
            }
            active={Boolean(clip.faceBlur)}
            onPress={() => {
              void toggleFaceBlur();
            }}
          />
          {clip.faceBlur ? (
            <Chip
              label={clip.faceBlur.pixelate ? t('panels.filter.chipMosaic') : t('panels.filter.chipSoft')}
              active={clip.faceBlur.pixelate === true}
              onPress={() =>
                updateClip(clip.id, {
                  faceBlur: { ...clip.faceBlur!, pixelate: !clip.faceBlur!.pixelate },
                })
              }
            />
          ) : null}
          {/* 🎯 az elmosás követ egy kijelölt objektumot (videón) */}
          {clip.kind === 'video' ? (
            <Chip
              label={
                blurTrackBusy
                  ? t('panels.filter.tracking')
                  : clip.faceBlur?.track?.length
                    ? t('panels.filter.blurTrackOn')
                    : t('panels.filter.blurTrack')
              }
              active={Boolean(clip.faceBlur?.track?.length)}
              onPress={startBlurTrackPick}
            />
          ) : null}
        </View>
        {clip.faceBlur ? (
          <Stepper
            label={t('panels.filter.strength')}
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
          {t('panels.filter.noteFaceBlur')}
        </Text>
      </PanelSection>

      {clip.kind === 'image' ? (
        <PanelSection title={t('panels.filter.sectionSky')}>
          <View style={styles.row}>
            {SKY_PRESETS.map((preset) => (
              <Chip
                key={preset.id}
                label={skyBusy === preset.id ? '⏳…' : t(preset.label)}
                active={false}
                onPress={() => {
                  void applySky(preset.id);
                }}
              />
            ))}
          </View>
          <Text style={styles.note}>
            {t('panels.filter.noteSky')}
          </Text>
        </PanelSection>
      ) : null}

      <PanelSection title={t('panels.filter.sectionLighting')}>
        <View style={styles.row}>
          <Chip
            label={t('common.none')}
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
          {t('panels.filter.noteLighting')}
        </Text>
      </PanelSection>

      <PanelSection title={t('panels.filter.section3d')}>
        <Stepper
          label={t('panels.filter.tiltVertical')}
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
          label={t('panels.filter.tiltHorizontal')}
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
              label={t(preset.label)}
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
              label={t('panels.filter.chipTiltOff')}
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
                  ? t('panels.filter.chipDepthComputing')
                  : clip.depthParallax
                    ? t('panels.filter.chipDepthOn')
                    : t('panels.filter.chipDepth')
              }
              active={Boolean(clip.depthParallax)}
              onPress={() => {
                void toggleDepthParallax();
              }}
            />
            <Chip
              label={focusBusy ? '⏳…' : t('panels.filter.chipPortraitBlur')}
              active={clip.depthFocus?.mode === 'portrait'}
              onPress={() => {
                void setDepthFocus('portrait');
              }}
            />
            <Chip
              label={t('panels.filter.chipFocusBack')}
              active={clip.depthFocus?.mode === 'toFar'}
              onPress={() => {
                void setDepthFocus('toFar');
              }}
            />
            <Chip
              label={t('panels.filter.chipFocusFront')}
              active={clip.depthFocus?.mode === 'toNear'}
              onPress={() => {
                void setDepthFocus('toNear');
              }}
            />
            <Chip
              label={cutoutBusy ? t('panels.filter.chipCuttingOut') : t('panels.filter.chipExtractSubject')}
              active={false}
              onPress={() => {
                void extractSubject();
              }}
            />
            <Chip
              label={upscaleBusy ? t('panels.filter.chipUpscaling') : t('panels.filter.chipUpscale2x')}
              active={false}
              onPress={() => {
                void upscaleClip(2);
              }}
            />
            <Chip
              label={upscaleBusy ? t('panels.filter.chipUpscaling') : '🔍 4×'}
              active={false}
              onPress={() => {
                void upscaleClip(4);
              }}
            />
          </View>
        ) : null}
        <Text style={styles.note}>
          {t('panels.filter.note3d')}
        </Text>
      </PanelSection>

      <PanelSection title={t('panels.filter.sectionMask')}>
        <View style={styles.row}>
          <Chip
            label={t('common.none')}
            active={!clip.mask}
            onPress={() => updateClip(clip.id, { mask: undefined })}
          />
          <Chip
            label={t('panels.filter.chipEllipse')}
            active={clip.mask?.shape === 'ellipse'}
            onPress={() =>
              updateClip(clip.id, { mask: { ...DEFAULT_MASK, ...clip.mask, shape: 'ellipse' } })
            }
          />
          <Chip
            label={t('panels.filter.chipRectangle')}
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
              label={t('panels.filter.poly_' + poly.id)}
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
          {/* ✂️ szabadkézi maszk: ujjal/tollal a vászonra rajzolva (mobil-first) */}
          <Chip
            label={t('panels.filter.chipDrawMask')}
            active={drawMaskMode}
            onPress={() => setDrawMaskMode(!drawMaskMode)}
          />
          {clip.mask?.shape === 'polygon' ? (
            <Chip
              label={t('panels.filter.chipSmooth')}
              active={false}
              onPress={() => updateClip(clip.id, { mask: smoothMask(clip.mask!) })}
            />
          ) : null}
          {clip.mask ? (
            <Chip
              label={t('panels.filter.chipInvert')}
              active={clip.mask.invert === true}
              onPress={() =>
                updateClip(clip.id, { mask: { ...clip.mask!, invert: !clip.mask!.invert } })
              }
            />
          ) : null}
        </View>
        {drawMaskMode ? <Text style={styles.note}>{t('panels.filter.noteDrawMask')}</Text> : null}
        {clip.mask ? (
          <>
            <Chip
              label={maskEdit ? t('panels.filter.chipHandlesOn') : t('panels.filter.chipAdjustOnCanvas')}
              active={maskEdit}
              onPress={() => setMaskEdit(!maskEdit)}
            />
            <Text style={styles.note}>
              {t('panels.filter.noteMaskEdit')}
            </Text>
            <Stepper
              label={t('panels.filter.width')}
              value={`${Math.round(clip.mask.w * 100)}%`}
              onDec={() =>
                updateClip(clip.id, { mask: { ...clip.mask!, w: clamp(clip.mask!.w - 0.05, 0.1, 1) } })
              }
              onInc={() =>
                updateClip(clip.id, { mask: { ...clip.mask!, w: clamp(clip.mask!.w + 0.05, 0.1, 1) } })
              }
            />
            <Stepper
              label={t('panels.filter.height')}
              value={`${Math.round(clip.mask.h * 100)}%`}
              onDec={() =>
                updateClip(clip.id, { mask: { ...clip.mask!, h: clamp(clip.mask!.h - 0.05, 0.1, 1) } })
              }
              onInc={() =>
                updateClip(clip.id, { mask: { ...clip.mask!, h: clamp(clip.mask!.h + 0.05, 0.1, 1) } })
              }
            />
            <Stepper
              label={t('panels.filter.horizontalPosition')}
              value={`${Math.round(clip.mask.x * 100)}%`}
              onDec={() =>
                updateClip(clip.id, { mask: { ...clip.mask!, x: clamp(clip.mask!.x - 0.05, 0, 1) } })
              }
              onInc={() =>
                updateClip(clip.id, { mask: { ...clip.mask!, x: clamp(clip.mask!.x + 0.05, 0, 1) } })
              }
            />
            <Stepper
              label={t('panels.filter.verticalPosition')}
              value={`${Math.round(clip.mask.y * 100)}%`}
              onDec={() =>
                updateClip(clip.id, { mask: { ...clip.mask!, y: clamp(clip.mask!.y - 0.05, 0, 1) } })
              }
              onInc={() =>
                updateClip(clip.id, { mask: { ...clip.mask!, y: clamp(clip.mask!.y + 0.05, 0, 1) } })
              }
            />
            <Stepper
              label={t('panels.filter.feather')}
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
            {/* 🩹 kiterjesztés (dilate/erode): az él kifelé/befelé tolása */}
            <Stepper
              label={t('panels.filter.maskExpand')}
              value={`${(clip.mask.expand ?? 0) > 0 ? '+' : ''}${Math.round((clip.mask.expand ?? 0) * 100)}%`}
              onDec={() =>
                updateClip(clip.id, {
                  mask: { ...clip.mask!, expand: clamp((clip.mask!.expand ?? 0) - 0.02, -0.3, 0.3) },
                })
              }
              onInc={() =>
                updateClip(clip.id, {
                  mask: { ...clip.mask!, expand: clamp((clip.mask!.expand ?? 0) + 0.02, -0.3, 0.3) },
                })
              }
            />
            {/* 🌓 maszk-átlátszóság: a kimaszkolt terület megtartott láthatósága */}
            <Stepper
              label={t('panels.filter.maskOpacity')}
              value={`${Math.round((clip.mask.opacity ?? 0) * 100)}%`}
              onDec={() =>
                updateClip(clip.id, {
                  mask: { ...clip.mask!, opacity: clamp((clip.mask!.opacity ?? 0) - 0.1, 0, 1) },
                })
              }
              onInc={() =>
                updateClip(clip.id, {
                  mask: { ...clip.mask!, opacity: clamp((clip.mask!.opacity ?? 0) + 0.1, 0, 1) },
                })
              }
            />
            {/* 🎬 Rotoszkóp / követés: a maszk geometriája kulcskockákkal animálható */}
            <View style={styles.row}>
              <Chip
                label={t('panels.filter.rotoscope')}
                active={rotoMask}
                onPress={() => setRotoMask(!rotoMask)}
              />
              {rotoMask || hasMaskTrack(clip.mask) ? (
                <>
                  <Chip
                    label={t('panels.filter.maskKeyHere')}
                    active={false}
                    onPress={() => {
                      const tl = clamp(playhead - clip.start, 0, clip.duration);
                      updateClip(clip.id, {
                        mask: addMaskKeyframe(clip.mask!, tl, sampleMaskAt(clip.mask!, tl)),
                      });
                    }}
                  />
                  <Chip
                    label={t('panels.filter.maskKeyDelHere')}
                    active={false}
                    onPress={() =>
                      updateClip(clip.id, {
                        mask: removeMaskKeyframeAt(clip.mask!, clamp(playhead - clip.start, 0, clip.duration)),
                      })
                    }
                  />
                  <Chip
                    label={t('panels.filter.maskKeyClear')}
                    active={false}
                    onPress={() => updateClip(clip.id, { mask: { ...clip.mask!, track: undefined } })}
                  />
                  <Chip
                    label={t('panels.filter.maskTrackSubject')}
                    active={false}
                    onPress={() => {
                      trackMaskToSubject().catch(() => {});
                    }}
                  />
                  <Chip
                    label={t('panels.filter.maskTrackFace')}
                    active={false}
                    onPress={() => {
                      trackMaskToFace().catch(() => {});
                    }}
                  />
                </>
              ) : null}
            </View>
            {/* ◆ kulcskocka-lista: koppintásra a lejátszófej odaugrik */}
            {maskKeyframeTimes(clip.mask).length > 0 ? (
              <View style={styles.row}>
                {maskKeyframeTimes(clip.mask).map((tt) => (
                  <Chip
                    key={tt.toFixed(2)}
                    label={`◆ ${(clip.start + tt).toFixed(1)}s`}
                    active={Math.abs(playhead - clip.start - tt) < 0.05}
                    onPress={() => setPlayhead(clip.start + tt)}
                  />
                ))}
              </View>
            ) : null}
            {rotoMask ? <Text style={styles.note}>{t('panels.filter.rotoNote')}</Text> : null}
          </>
        ) : null}
        <Text style={styles.note}>
          {t('panels.filter.noteMask')}
        </Text>
      </PanelSection>

      <PanelSection title={t('panels.filter.sectionGreenScreen')}>
        <View style={styles.row}>
          <Chip
            label={t('common.none')}
            active={!clip.chromaKey}
            onPress={() => updateClip(clip.id, { chromaKey: undefined })}
          />
          <Chip
            label={t('panels.filter.chipGreen')}
            active={clip.chromaKey?.color === '#00ff00'}
            onPress={() =>
              updateClip(clip.id, {
                chromaKey: { color: '#00ff00', similarity: clip.chromaKey?.similarity ?? 0.18 },
              })
            }
          />
          <Chip
            label={t('panels.filter.chipBlue')}
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
            label={t('panels.filter.tolerance')}
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
        {/* 🟢 spill-suppression: a zöld/kék perem eltávolítása a témáról */}
        {clip.chromaKey ? (
          <Stepper
            label={t('panels.filter.spill')}
            value={`${Math.round((clip.chromaKey.spill ?? 0) * 100)}%`}
            onDec={() =>
              updateClip(clip.id, {
                chromaKey: { ...clip.chromaKey!, spill: clamp((clip.chromaKey!.spill ?? 0) - 0.2, 0, 1) },
              })
            }
            onInc={() =>
              updateClip(clip.id, {
                chromaKey: { ...clip.chromaKey!, spill: clamp((clip.chromaKey!.spill ?? 0) + 0.2, 0, 1) },
              })
            }
          />
        ) : null}
        <Text style={styles.note}>
          {t('panels.filter.noteGreenScreen')}
        </Text>
      </PanelSection>

      {/* 🎭 Track / luma / alpha matte: egy külső kép fényereje/alfája adja az átlátszóságot */}
      <PanelSection title={t('panels.filter.sectionMatte')}>
        <View style={styles.row}>
          <Chip
            label={clip.matte ? t('panels.filter.matteReplace') : t('panels.filter.mattePick')}
            active={Boolean(clip.matte)}
            onPress={() => {
              pickImage()
                .then((p) => {
                  if (p) {
                    updateClip(clip.id, {
                      matte: { uri: p.uri, type: clip.matte?.type ?? 'luma', invert: clip.matte?.invert },
                    });
                  }
                })
                .catch(() => {});
            }}
          />
          {clip.matte ? (
            <Chip label={t('common.none')} active={false} onPress={() => updateClip(clip.id, { matte: undefined })} />
          ) : null}
        </View>
        {clip.matte ? (
          <View style={styles.row}>
            <Chip
              label={t('panels.filter.matteLuma')}
              active={clip.matte.type === 'luma'}
              onPress={() => updateClip(clip.id, { matte: { ...clip.matte!, type: 'luma' } })}
            />
            <Chip
              label={t('panels.filter.matteAlpha')}
              active={clip.matte.type === 'alpha'}
              onPress={() => updateClip(clip.id, { matte: { ...clip.matte!, type: 'alpha' } })}
            />
            <Chip
              label={t('panels.filter.matteInvert')}
              active={clip.matte.invert === true}
              onPress={() => updateClip(clip.id, { matte: { ...clip.matte!, invert: !clip.matte!.invert } })}
            />
          </View>
        ) : null}
        <Text style={styles.note}>{t('panels.filter.noteMatte')}</Text>
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
