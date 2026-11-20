import { useIsFocused } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';

import { HotspotOverlay } from '@/components/preview/HotspotOverlay';
import { MaskOverlay } from '@/components/preview/MaskOverlay';
import { PipLayer } from '@/components/preview/PipLayer';
import { SafeZoneOverlay } from '@/components/preview/SafeZoneOverlay';
import { TransitionLayer } from '@/components/preview/TransitionLayer';
import { ShapeOverlay } from '@/components/preview/ShapeOverlay';
import { TextOverlay } from '@/components/preview/TextOverlay';
import { aspectValue, filters, palette } from '@/constants/editor';
import { sampleClipTransform, shiftPositionKeyframes } from '@/lib/keyframes';
import { addMaskKeyframe, hasMaskTrack, sampleMaskAt } from '@/lib/maskAnim';
import { clipColorMatrix, effectImageFilters, isIdentityMatrix, skiaUncoveredAdjust } from '@/lib/skiaEffects';
import { findClip } from '@/lib/projectUtils';
import { clamp } from '@/lib/time';
import { useEditorStore } from '@/store/editorStore';
import type { ImageClip, InteractiveClip, VideoClip } from '@/types/project';

import { compareSliderX, fitCanvasBox, IDENTITY } from './surface/canvasMath';
import { BlackScrim, FaceBlurMarker, MaskShade, SmartGuideLines, StrokePreview } from './surface/CanvasMarkers';
import { CompareSlider } from './surface/CompareSlider';
import {
  isVideoAudible,
  previewAdjustClips,
  previewInteractiveClips,
  previewShapeClips,
  previewTextClips,
  previewVisualClip,
  shouldDimBase,
  textOverlayTime,
  visualFadeOpacity,
  visualMediaOpacity,
} from './surface/layerSelection';
import { AdjustTintLayers, AdjustTrackTintLayers, FilterLookLayer, LightingTintLayer } from './surface/LookLayers';
import { BlurBackdrop, MediaLayer } from './surface/PreviewMedia';
import { PreviewToolbar } from './surface/PreviewToolbar';
import { useCanvasGestures, useCanvasGestureValues } from './surface/useCanvasGestures';
import { useCanvasTransformStyle } from './surface/useCanvasTransformStyle';
import { usePreviewSources } from './surface/usePreviewSources';
import { usePreviewVideoPlayer } from './surface/usePreviewVideoPlayer';
import { useSmartGuides } from './surface/useSmartGuides';

// adjustTintLayers → @/lib/adjustPreview (megosztva a Kép Stúdió Korrekcióval)

interface Props {
  mode: 'edit' | 'play';
  onHotspotPress?: (clip: InteractiveClip) => void;
}

/**
 * Az előnézet: a playhead alatti videó/kép klip + a szöveg- és hotspot-overlay-ek.
 * A videólejátszó a rAF-órához szinkronizál (forráscsere, seek, drift-korrekció).
 *
 * Kompozíciós gyökér: a lejátszó-szinkron, a gesztusok és a rétegek a
 * `surface/` modulokban élnek; a rétegek (z-)sorrendje ITT dől el.
 */
export function PreviewSurface({ mode, onHotspotPress }: Props) {
  // 🧭 A bontás után a gyökér már FORDÍTHATÓ lenne (a player- és shared-value-mutáció a
  // surface/ hookokba került), de a memoizálás bekapcsolása viselkedés-változás → külön
  // döntés (tools/reactCompiler.test.js KNOWN_BAILS). Addig szándékosan kimarad.
  'use no memo';
  const project = useEditorStore((s) => s.project);
  const masterVolume = useEditorStore((s) => s.masterVolume);
  const showSafeZones = useEditorStore((s) => s.showSafeZones);
  const toggleSafeZones = useEditorStore((s) => s.toggleSafeZones);
  const playhead = useEditorStore((s) => s.playhead);
  const isPlaying = useEditorStore((s) => s.isPlaying);
  // a takart képernyő (push-navigáció mögött) ne játsszon — lásd a play/pause effektet
  const isFocused = useIsFocused();
  const selectedClipId = useEditorStore((s) => s.selectedClipId);
  const focusMode = useEditorStore((s) => s.focusMode);
  const comparingOriginal = useEditorStore((s) => s.comparingOriginal);
  const setComparingOriginal = useEditorStore((s) => s.setComparingOriginal);
  const compareSplit = useEditorStore((s) => s.compareSplit);
  const setCompareSplit = useEditorStore((s) => s.setCompareSplit);
  const selectClip = useEditorStore((s) => s.selectClip);
  const updateClip = useEditorStore((s) => s.updateClip);
  const drawBrush = useEditorStore((s) => s.drawBrush);
  const drawMaskMode = useEditorStore((s) => s.drawMaskMode);
  const maskEdit = useEditorStore((s) => s.maskEdit);
  const rotoMask = useEditorStore((s) => s.rotoMask);
  const mutedTracks = useEditorStore((s) => s.mutedTracks);
  const soloTracks = useEditorStore((s) => s.soloTracks);
  // 👁️ elrejtett (vizuális) sávok — az előnézetből kimaradnak (monitorozás, nem render)
  const hiddenTracks = useEditorStore((s) => s.hiddenTracks);
  // 🎙️ ha a JAVÍTOTT hang szól külön lejátszóról (AudioLayer/VideoVoice), a
  // videó saját sávját némítani kell — különben a kettő egyszerre szólna
  const videoVoiceActive = useEditorStore((s) => s.videoVoiceActive);
  const videoAudible = isVideoAudible(videoVoiceActive, soloTracks, mutedTracks);

  const [container, setContainer] = useState({ w: 0, h: 0 });
  // smart guides: húzás közben aktív segédvonalak + snap (vászon-normalizált)
  const { guides, handleDragLive, snapped } = useSmartGuides();

  // 👁️ a fő videó/kép sáv elrejtve → nincs vizuális klip az előnézetben
  const visual = previewVisualClip(project, hiddenTracks, playhead);
  const videoClip = visual?.kind === 'video' ? (visual as VideoClip) : null;
  const imageClip = visual?.kind === 'image' ? (visual as ImageClip) : null;

  // 🔗 feloldott forrás-uri-k + a következő klip gapless-előtöltése
  const { videoSrcUri, imageSrcUri } = usePreviewSources(project, videoClip, imageClip, playhead);

  // vászon-transzform gesztusok élő értékei (kijelölt vizuális klipen)
  const gestureValues = useCanvasGestureValues();

  // 🎬 a rAF-órához szinkronizált expo-video lejátszó
  const { player, playbackUri } = usePreviewVideoPlayer({
    videoClip,
    videoSrcUri,
    playhead,
    isPlaying,
    isFocused,
    videoAudible,
    masterVolume,
  });

  // a vászon méretre igazítása a rendelkezésre álló területhez
  const ar = project ? aspectValue(project.aspectRatio) : 0;
  const box = fitCanvasBox(container, ar);
  const boxW = box.w;
  const boxH = box.h;
  // 🎨 Skia-előnézet a KÉP-klipen: ha a grade/szín-effektek valódi hatást adnak
  // (nem identitás a ColorMatrix VAGY van blur-leíró), a nyers expo-image HELYETT
  // a Skia-réteg rajzol — identitásnál a sima image marad (perf). CSAK a before/
  // after „eredeti” nézeten kívül (akkor a nyers forrás kell). A videó-utat NEM érinti.
  const imageSkiaActive =
    !!imageClip &&
    !comparingOriginal &&
    (!isIdentityMatrix(clipColorMatrix(imageClip.adjust, imageClip.effects)) ||
      effectImageFilters(imageClip.effects, box).length > 0);
  // 🎬 Skia-előnézet a MOZGÓ VIDEÓ-klipen (az imageSkiaActive párja): ha a grade/
  // szín-effektek valódi hatást adnak, a nyers `<VideoView>` FÖLÉ rajzolunk egy
  // szűrt Skia-réteget. ADDITÍV — szűrő nélkül (identitás ColorMatrix + nincs blur)
  // SEMMI Skia, a VideoView pontosan a mai (nulla regresszió, nulla perf-teher).
  // A before/after „eredeti" nézeten kívül (akkor a nyers forrás kell).
  const videoSkiaActive =
    !!videoClip &&
    !comparingOriginal &&
    (!isIdentityMatrix(clipColorMatrix(videoClip.adjust, videoClip.effects)) ||
      effectImageFilters(videoClip.effects, box).length > 0);
  // 🅱️ before/after slider: a look-rétegek CSAK az elválasztótól jobbra fedjenek
  // (bal fél = nyers forrás). Slider nélkül teljes vászon. Nem-vizuális módban null.
  const sliderX = compareSliderX(compareSplit, boxW);
  const lookGeom =
    compareSplit != null
      ? ({ position: 'absolute', top: 0, bottom: 0, left: sliderX, right: 0 } as const)
      : StyleSheet.absoluteFill;

  // minden szöveg-jellegű réteg: címek + feliratok + matricák
  const textClips = previewTextClips(project, hiddenTracks, playhead);
  const interactiveClips = previewInteractiveClips(project, hiddenTracks, playhead);
  const shapeClips = previewShapeClips(project, hiddenTracks, playhead);
  // 🎨 grade-réteg(ek) a playheadnél: a teljes kompozitra ható tint-közelítés
  const adjustClips = previewAdjustClips(project, hiddenTracks, playhead);

  const filterId = videoClip?.filterId ?? imageClip?.filterId ?? 'none';
  const filter = filters.find((f) => f.id === filterId);
  const filterIntensity =
    (videoClip ?? imageClip)?.filterIntensity ?? 1;

  // vászon-transzform: a kijelölt videó/kép klip csippentéssel nagyítható,
  // húzással pozicionálható; dupla koppintás visszaállítja. Kulcskockás klipen
  // a megjelenítés a playheadből interpolál, a gesztus pedig kulcskockát ír
  // a playhead időpontjára (nem a statikus transformot).
  const visualId = (videoClip ?? imageClip)?.id ?? null;
  const visualForTransform = videoClip ?? imageClip;
  const committed = visualForTransform
    ? sampleClipTransform(visualForTransform, playhead - visualForTransform.start)
    : IDENTITY;
  const canTransform =
    mode === 'edit' && visualId !== null && selectedClipId === visualId;

  // 🖐️ a vászon gesztusai (transzform, kijelölés, rajz, slider-elválasztó)
  const { canvasGesture, dividerPan, strokeLive } = useCanvasGestures({
    values: gestureValues,
    mode,
    boxW,
    boxH,
    visualId,
    canTransform,
    sliderX,
    drawBrush,
    drawMaskMode,
    selectClip,
    updateClip,
    setCompareSplit,
  });

  const transformStyle = useCanvasTransformStyle(gestureValues, committed, visualForTransform, boxW, boxH);

  // 🎞️ átlátszóság-automáció: az opacity-csatorna a playheadből (kf nélkül a statikus opacity)
  const mediaOpacity = visualMediaOpacity(visualForTransform, videoClip ?? imageClip, playhead);

  // áttűnés feketéből/feketébe a vizuális klip szélein
  const visualClip = videoClip ?? imageClip;
  const fadeOpacity = visualFadeOpacity(visualClip, playhead);

  // az onLayout az első mounttól a konténeren van — ha csak a projekt
  // betöltése után kerülne rá, a már lezajlott layoutról sosem kapnánk eseményt
  return (
    <View
      style={styles.container}
      onLayout={(e) =>
        setContainer({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })
      }
    >
      {project && boxW > 0 && boxH > 0 ? (
        <GestureDetector gesture={canvasGesture}>
          <View
            style={[
              styles.canvas,
              { width: boxW, height: boxH },
              canTransform ? styles.canvasSelected : null,
            ]}
          >
          {/* blur-háttér (a transzform nem érinti) */}
          <BlurBackdrop videoClip={videoClip} imageClip={imageClip} player={player} imageSrcUri={imageSrcUri} />

          {/* a fő média a vászon-transzformmal — vagy az üres-állapot */}
          <MediaLayer
            videoClip={videoClip}
            imageClip={imageClip}
            player={player}
            playbackUri={playbackUri}
            imageSrcUri={imageSrcUri}
            box={box}
            mediaOpacity={mediaOpacity}
            transformStyle={transformStyle}
            videoSkiaActive={videoSkiaActive}
            imageSkiaActive={imageSkiaActive}
            playhead={playhead}
            isPlaying={isPlaying}
            showEmptyHint={
              mode === 'edit' &&
              boxH >= 220 &&
              textClips.length + shapeClips.length + interactiveClips.length === 0
            }
          />

          {/* maszk-közelítés (P0‑10): körvonal + a takart terület sötétítése */}
          <MaskShade mask={(videoClip ?? imageClip)?.mask} boxW={boxW} boxH={boxH} />

          {!comparingOriginal && filter && filter.overlay ? (
            <FilterLookLayer
              lookGeom={lookGeom}
              color={filter.overlay}
              opacity={filter.opacity * filterIntensity}
            />
          ) : null}

          {/* 🙈 arc-elmosás jelölése (a valódi blur a renderben ég be) */}
          <FaceBlurMarker fb={(videoClip ?? imageClip)?.faceBlur} boxW={boxW} boxH={boxH} />

          {/* 💡 lighting-közelítés: hangulat-tint (a split-tone a renderben) */}
          <LightingTintLayer
            lookGeom={lookGeom}
            comparingOriginal={comparingOriginal}
            lighting={(videoClip ?? imageClip)?.lighting}
          />

          {/* képjavítás-közelítés. 🎨 ha a klip grade-jét már a Skia-réteg rajzolja (kép VAGY
              videó), a MÁTRIXOS mezőket nem duplázzuk — de a mátrixon kívülieket (tónus-régiók,
              balance) a közelítés továbbra is mutatja (B21: eddig a Skia mindent elnyomott) */}
          <AdjustTintLayers
            lookGeom={lookGeom}
            comparingOriginal={comparingOriginal}
            adjust={
              imageSkiaActive || videoSkiaActive
                ? skiaUncoveredAdjust((videoClip ?? imageClip)?.adjust)
                : (videoClip ?? imageClip)?.adjust
            }
          />

          {fadeOpacity > 0 ? <BlackScrim opacity={fadeOpacity} /> : null}

          {/* 🎬 átmenet-előnézet: a klip-átmenet ablakában a következő klip beúszik
              (kereszttűnés/csúszás közelítés — a pontos xfade a renderben) */}
          <TransitionLayer box={box} />

          {/* 🎯 fókusz mód (#27): diszkrét overlay szerkesztésekor a base média
              elhalványul, hogy a szerkesztett elem kiemelkedjen (a scrim a média
              fölött, de az overlay-k ALATT van) */}
          {shouldDimBase(project, selectedClipId, mode, focusMode) ? <BlackScrim opacity={0.5} /> : null}

          {textClips.map((clip) => (
            <TextOverlay
              key={clip.id}
              clip={clip}
              // szerkesztésben álló lejátszófejnél a belépő-animáció "beállt"
              // állapota látszik — különben a klip elején láthatatlan lenne a szöveg
              t={textOverlayTime(mode, isPlaying, playhead, clip.start)}
              box={box}
              editable={mode === 'edit'}
              selected={clip.id === selectedClipId}
              onSelect={selectClip}
              onDragLive={handleDragLive}
              onMove={(id, rawPosition) => {
                const position = snapped(rawPosition);
                // követett szövegnél a teljes pálya együtt mozog a húzással
                const state = useEditorStore.getState();
                const found = state.project ? findClip(state.project, id)?.clip : null;
                if (found?.kind === 'text' && found.keyframes) {
                  const dx = position.x - found.position.x;
                  const dy = position.y - found.position.y;
                  updateClip(id, {
                    position,
                    keyframes: shiftPositionKeyframes(found.keyframes, dx, dy),
                  });
                  return;
                }
                updateClip(id, { position });
              }}
              onEdit={(id) => {
                const state = useEditorStore.getState();
                state.selectClip(id);
                state.setPanel('text');
              }}
            />
          ))}

          {shapeClips.map((clip) => (
            <ShapeOverlay
              key={clip.id}
              clip={clip}
              box={box}
              editable={mode === 'edit'}
              selected={clip.id === selectedClipId}
              onSelect={selectClip}
              onDragLive={handleDragLive}
              onMove={(id, position) => updateClip(id, { position: snapped(position) })}
            />
          ))}

          {/* 🎬 PiP-réteg: a pip-sáv aktív klipje a fő videó fölé (2. szinkron videó) */}
          {hiddenTracks.includes('pip') ? null : <PipLayer box={box} editable={mode === 'edit'} />}

          {/* 🎨 grade-réteg-közelítés: az adjust-sáv aktív klipjei a TELJES
              kompozitot tintelik — előbb a filmes preset (grade), majd a kézi
              adjust (a valódi eq/colorbalance/vignette a renderben) */}
          {!comparingOriginal && (
            <AdjustTrackTintLayers lookGeom={lookGeom} clips={adjustClips} playhead={playhead} />
          )}

          {/* smart guides: aktív segédvonalak húzás közben */}
          <SmartGuideLines guides={guides} boxW={boxW} boxH={boxH} />

          {interactiveClips.map((clip) => (
            <HotspotOverlay
              key={clip.id}
              clip={clip}
              t={playhead - clip.start}
              box={box}
              mode={mode}
              selected={clip.id === selectedClipId}
              onSelect={selectClip}
              onChangeRect={(id, rect) => updateClip(id, { rect })}
              onPress={onHotspotPress}
            />
          ))}

          {/* ✂️ maszk-fogantyúk a kijelölt klip maszkján; 🎬 rotoszkóp-módban a
              lejátszófejnél interpolált maszk látszik, és a szerkesztés kulcskockát ír */}
          {maskEdit && selectedClipId && visual && 'mask' in visual && visual.mask
            ? (() => {
                const baseMask = visual.mask;
                const tInClip = clamp(playhead - visual.start, 0, visual.duration);
                const shown = hasMaskTrack(baseMask) ? sampleMaskAt(baseMask, tInClip) : baseMask;
                return (
                  <MaskOverlay
                    mask={shown}
                    box={{ w: boxW, h: boxH }}
                    onChange={(next) =>
                      updateClip(visual.id, {
                        mask: rotoMask ? addMaskKeyframe(baseMask, tInClip, next) : next,
                      })
                    }
                  />
                );
              })()
            : null}

          {/* ✏️ a húzás közben rajzolódó vonal (forma VAGY szabadkézi maszk) */}
          {(drawBrush || drawMaskMode) && strokeLive.length >= 2 ? (
            <StrokePreview
              strokeLive={strokeLive}
              boxW={boxW}
              boxH={boxH}
              drawBrush={drawBrush}
              drawMaskMode={drawMaskMode}
            />
          ) : null}

          {/* 🛡️ safe-zone overlay — csak szerkesztésben, kapcsolóra (pointerEvents none) */}
          {mode === 'edit' && showSafeZones ? (
            <SafeZoneOverlay width={boxW} height={boxH} aspect={project.aspectRatio} />
          ) : null}

          {/* 🅱️ before/after slider: elválasztó vonal + húzható fogantyú + oldal-címkék */}
          {mode === 'edit' && compareSplit != null ? (
            <CompareSlider sliderX={sliderX} dividerPan={dividerPan} />
          ) : null}
          </View>
        </GestureDetector>
      ) : null}

      {/* sarok-gombok: safe-zone kapcsoló, before/after + slider-kapcsoló, „eredeti” jelvény */}
      <PreviewToolbar
        showControls={mode === 'edit' && !!project}
        showSafeZones={showSafeZones}
        toggleSafeZones={toggleSafeZones}
        comparingOriginal={comparingOriginal}
        setComparingOriginal={setComparingOriginal}
        compareSplit={compareSplit}
        setCompareSplit={setCompareSplit}
      />

      {/* ℹ️ A lejátszás az alsó TransportBar play-gombján megy; a teljes nézetet a
          TransportBar „teljes nézet" gombja nyitja — a preview-n NINCS külön play. */}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000',
  },
  canvas: {
    backgroundColor: '#05060a',
    overflow: 'hidden',
  },
  canvasSelected: {
    borderWidth: 1,
    borderColor: palette.accent,
    borderStyle: 'dashed',
  },
});
