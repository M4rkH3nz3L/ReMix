import { useTranslation } from 'react-i18next';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { Chip, PanelSection, Stepper } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import { fetchFaces, pickPrimaryFace } from '@/lib/faceClient';
import { addMaskKeyframe, hasMaskTrack, maskKeyframeTimes, removeMaskKeyframeAt, sampleMaskAt, trackToPoints } from '@/lib/maskAnim';
import { smoothMask } from '@/lib/maskEdit';
import { trackSubject } from '@/lib/track';
import { clamp } from '@/lib/time';
import { useEditorStore } from '@/store/editorStore';
import type { ClipMask, ImageClip, VideoClip } from '@/types/project';

import { AnimateSection } from '@/components/editor/panels/filter/AnimateSection';
import { BackgroundFillSection } from '@/components/editor/panels/filter/BackgroundFillSection';
import { EffectsSection } from '@/components/editor/panels/filter/EffectsSection';
import { EnhanceSection } from '@/components/editor/panels/filter/EnhanceSection';
import { FaceBlurSection } from '@/components/editor/panels/filter/FaceBlurSection';
import { FiltersSection } from '@/components/editor/panels/filter/FiltersSection';
import { GreenScreenSection } from '@/components/editor/panels/filter/GreenScreenSection';
import { ImageStudioSection } from '@/components/editor/panels/filter/ImageStudioSection';
import { LightingSection } from '@/components/editor/panels/filter/LightingSection';
import { MatteSection } from '@/components/editor/panels/filter/MatteSection';
import { SkySection } from '@/components/editor/panels/filter/SkySection';
import { StabilizeSection } from '@/components/editor/panels/filter/StabilizeSection';
import { ThreeDSection } from '@/components/editor/panels/filter/ThreeDSection';

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

  // 🎬 B19: a PiP-rétegen a render a szűrőt, az opacitást, a forgatást, a keretet és a
  // fordított lejátszást tudja — a többi beállítás a kész videóból CSENDBEN hiányozna,
  // ezért PiP-klipnél nem is kínáljuk fel (őszinte UI)
  const onPip = useEditorStore.getState().project?.tracks.some(
    (tk) => tk.type === 'pip' && tk.clips.some((c) => c.id === clip.id)
  );
  if (onPip) {
    return (
      <View>
        <FiltersSection clip={clip} />
        <Text style={styles.pipNote}>{t('panels.filter.pipLimited')}</Text>
      </View>
    );
  }

  return (
    <View>
      {clip.kind === 'image' ? <ImageStudioSection clip={clip} /> : null}
      <FiltersSection clip={clip} />
      <EffectsSection clip={clip} />
      <EnhanceSection clip={clip} />
      <BackgroundFillSection clip={clip} />
      {clip.kind === 'video' ? <StabilizeSection clip={clip} /> : null}
      <AnimateSection clip={clip} />
      <FaceBlurSection clip={clip} />
      {clip.kind === 'image' ? <SkySection clip={clip} /> : null}
      <LightingSection clip={clip} />
      <ThreeDSection clip={clip} />

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

      <GreenScreenSection clip={clip} />
      <MatteSection clip={clip} />
    </View>
  );
}

const styles = StyleSheet.create({
  pipNote: { color: palette.textDim, fontSize: 12, lineHeight: 17, marginTop: 8 },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  note: {
    color: palette.textDim,
    fontSize: 11,
    lineHeight: 16,
  },
});
