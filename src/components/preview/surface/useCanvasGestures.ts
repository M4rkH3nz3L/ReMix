import { useRef, useState } from 'react';
import { Gesture, type ComposedGesture, type PanGesture } from 'react-native-gesture-handler';
import { runOnJS, useSharedValue, type SharedValue } from 'react-native-reanimated';

import { gestures, haptics } from '@/design';
import { pathBounds, simplifyPath, toBoxSpace } from '@/lib/draw';
import { gestureKeyframes, hasKeyframes, sampleClipTransform } from '@/lib/keyframes';
import { maskFromStroke } from '@/lib/maskEdit';
import { makeId } from '@/lib/id';
import { findClip } from '@/lib/projectUtils';
import { clamp } from '@/lib/time';
import { useEditorStore } from '@/store/editorStore';
import type { EditorState } from '@/store/editorState';

import {
  gestureTransformTarget,
  IDENTITY,
  normalizedCanvasPoint,
  pathShapeClip,
} from './canvasMath';

/** vászon-transzform gesztusok élő deltái (kijelölt vizuális klipen) */
export interface CanvasGestureValues {
  gestureScale: SharedValue<number>;
  gestureDX: SharedValue<number>;
  gestureDY: SharedValue<number>;
  /** 🔄 élő forgatás-delta (fok) a két-ujjas gesztusból */
  gestureRotation: SharedValue<number>;
  splitStartX: SharedValue<number>;
}

// vászon-transzform gesztusok (kijelölt vizuális klipen)
export function useCanvasGestureValues(): CanvasGestureValues {
  const gestureScale = useSharedValue(1);
  const gestureDX = useSharedValue(0);
  const gestureDY = useSharedValue(0);
  const gestureRotation = useSharedValue(0); // 🔄 élő forgatás-delta (fok) a két-ujjas gesztusból
  const splitStartX = useSharedValue(0);
  return { gestureScale, gestureDX, gestureDY, gestureRotation, splitStartX };
}

export interface CanvasGesturesInput {
  values: CanvasGestureValues;
  mode: 'edit' | 'play';
  boxW: number;
  boxH: number;
  visualId: string | null;
  canTransform: boolean;
  sliderX: number;
  drawBrush: EditorState['drawBrush'];
  drawMaskMode: boolean;
  selectClip: EditorState['selectClip'];
  updateClip: EditorState['updateClip'];
  setCompareSplit: EditorState['setCompareSplit'];
}

/**
 * 🖐️ A vászon gesztusai: csippentés/forgatás/húzás → transzform (vagy
 * kulcskocka), dupla koppintás → visszaállítás, koppintás → kijelölés /
 * téma-pont, rajzoló-mód (forma vagy szabadkézi maszk), és a before/after
 * elválasztó húzása. A PreviewSurface-ből kiemelve — viselkedés változatlan.
 */
export function useCanvasGestures({
  values,
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
}: CanvasGesturesInput): {
  canvasGesture: PanGesture | ComposedGesture;
  dividerPan: PanGesture;
  strokeLive: { x: number; y: number }[];
} {
  const { gestureScale, gestureDX, gestureDY, gestureRotation, splitStartX } = values;

  const commitTransform = () => {
    const state = useEditorStore.getState();
    if (!state.project || !visualId) {
      return;
    }
    const clip = findClip(state.project, visualId)?.clip;
    if (!clip || (clip.kind !== 'video' && clip.kind !== 'image')) {
      return;
    }
    const tInClip = clamp(state.playhead - clip.start, 0, clip.duration);
    const current = sampleClipTransform(clip, tInClip);
    const { scale, x, y, rot } = gestureTransformTarget(
      current,
      {
        scale: gestureScale.value,
        dx: gestureDX.value,
        dy: gestureDY.value,
        rotation: gestureRotation.value,
      },
      boxW,
      boxH,
      gestures.pinch.previewScaleMin,
      gestures.pinch.previewScaleMax
    );
    if (rot.snapped) {
      haptics.snap();
    }
    gestureScale.value = 1;
    gestureDX.value = 0;
    gestureDY.value = 0;
    gestureRotation.value = 0;
    if (hasKeyframes(clip)) {
      // a többi csatorna (átlátszóság, hangerő, effekt) megmarad (MO-B1)
      state.updateClip(visualId, { keyframes: gestureKeyframes(clip.keyframes, tInClip, { scale, x, y, rotation: rot.value }) });
      return;
    }
    const t = clip.transform ?? IDENTITY;
    state.updateClip(visualId, { transform: { ...t, scale, x, y, rotation: rot.value } });
  };

  const resetTransform = () => {
    if (visualId) {
      updateClip(visualId, { transform: undefined, keyframes: undefined });
    }
  };

  const pinch = Gesture.Pinch()
    .enabled(canTransform)
    .onUpdate((e) => {
      gestureScale.value = e.scale;
    })
    .onEnd(() => {
      runOnJS(commitTransform)();
    });

  // 🔄 két-ujjas forgatás a kijelölt overlay-objektumon (a pinch mellé, egyszerre skála+forgat).
  // Élőben a shared value-n (fok), commit elengedéskor a `commitTransform`-ban (snap + undo-lépés).
  const rotation = Gesture.Rotation()
    .enabled(canTransform)
    .onUpdate((e) => {
      gestureRotation.value = (e.rotation * 180) / Math.PI;
    })
    .onEnd(() => {
      runOnJS(commitTransform)();
    });

  /**
   * ✏️ Rajzoló-mód: a húzás pontjait gyűjtjük, felengedéskor egyszerűsítjük és
   * forma-klippé (`shape: 'path'`) alakítjuk. A pontok a VÁSZONRA normalizáltak;
   * a klip a saját befoglaló dobozába kerül, hogy utána húzható/méretezhető legyen.
   */
  const strokeRef = useRef<{ x: number; y: number }[]>([]);
  const [strokeLive, setStrokeLive] = useState<{ x: number; y: number }[]>([]);

  const addStrokePoint = (px: number, py: number) => {
    const p = normalizedCanvasPoint(px, py, boxW, boxH);
    strokeRef.current.push(p);
    setStrokeLive([...strokeRef.current]);
  };

  const commitStroke = () => {
    const state = useEditorStore.getState();
    const brush = state.drawBrush;
    const raw = strokeRef.current;
    strokeRef.current = [];
    setStrokeLive([]);
    if (!state.project) {
      return;
    }
    // ✂️ szabadkézi maszk: a zárt pálya a kijelölt videó/kép klip poligon-maszkja
    if (state.drawMaskMode) {
      if (raw.length < 3 || !visualId) {
        return;
      }
      const mask = maskFromStroke(simplifyPath(raw));
      if (mask) {
        state.updateClip(visualId, { mask });
        state.setDrawMaskMode(false); // egy rajz → kész; a fogantyúkkal finomítható
        state.setMaskEdit(true);
      }
      return;
    }
    if (!brush || raw.length < 2) {
      return;
    }
    const simplified = simplifyPath(raw);
    const aspect = boxW / Math.max(boxH, 1);
    const bounds = pathBounds(simplified, brush.width, aspect);
    if (!bounds) {
      return;
    }
    const id = makeId('clip');
    state.addClip('overlay', pathShapeClip(id, state.playhead, toBoxSpace(simplified, bounds), bounds, brush));
  };

  // 🅱️ before/after slider elválasztójának húzása (a fogantyún, nem a vásznon)
  const dividerPan = Gesture.Pan()
    .onBegin(() => {
      splitStartX.value = sliderX;
    })
    .onUpdate((e) => {
      const frac = Math.min(1, Math.max(0, (splitStartX.value + e.translationX) / Math.max(boxW, 1)));
      runOnJS(setCompareSplit)(frac);
    });

  const drawPan = Gesture.Pan()
    .enabled(Boolean(drawBrush) || drawMaskMode)
    .minDistance(0)
    .onBegin((e) => {
      runOnJS(addStrokePoint)(e.x, e.y);
    })
    .onUpdate((e) => {
      runOnJS(addStrokePoint)(e.x, e.y);
    })
    .onEnd(() => {
      runOnJS(commitStroke)();
    });

  const panCanvas = Gesture.Pan()
    .enabled(canTransform)
    .onUpdate((e) => {
      gestureDX.value = e.translationX;
      gestureDY.value = e.translationY;
    })
    .onEnd(() => {
      runOnJS(commitTransform)();
    });

  const doubleTapReset = Gesture.Tap()
    .numberOfTaps(2)
    .enabled(canTransform)
    .onEnd(() => {
      runOnJS(resetTransform)();
    });

  /** 🎯 téma-kijelölő mód: a koppintás pontja megy vissza a kérő panelnek */
  const handleCanvasTap = (px: number, py: number) => {
    const pick = useEditorStore.getState().pickTarget;
    if (pick) {
      pick(normalizedCanvasPoint(px, py, boxW, boxH));
      useEditorStore.getState().setPickTarget(null);
      return;
    }
    if (visualId) {
      selectClip(visualId);
    }
  };

  const tapSelect = Gesture.Tap()
    .enabled(mode === 'edit')
    .onEnd((e) => {
      runOnJS(handleCanvasTap)(e.x, e.y);
    });

  // rajzoló-módban a rajzolás mindent megelőz (különben a húzás a klipet
  // mozgatná, a csippentés pedig zoomolna a vonal helyett)
  const canvasGesture =
    drawBrush || drawMaskMode
      ? drawPan
      : Gesture.Race(
          Gesture.Simultaneous(pinch, rotation, panCanvas),
          Gesture.Exclusive(doubleTapReset, tapSelect)
        );

  return { canvasGesture, dividerPan, strokeLive };
}
