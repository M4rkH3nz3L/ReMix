import { useAnimatedStyle } from 'react-native-reanimated';

import { skewTransformEntries, transformOrigin } from '@/lib/canvasTransform';
import type { CanvasTransform, ImageClip, VideoClip } from '@/types/project';

import type { CanvasGestureValues } from './useCanvasGestures';

/**
 * 🧊 A vizuális klip vászon-transzformja animált stílusként: a (kulcskockából
 * mintavett) `committed` transzform + a gesztus élő deltái, 3D-döntés,
 * anchor/skew és perspektíva. A PreviewSurface-ből kiemelve — viselkedés változatlan.
 */
export function useCanvasTransformStyle(
  values: CanvasGestureValues,
  committed: CanvasTransform,
  visualForTransform: VideoClip | ImageClip | null,
  boxW: number,
  boxH: number
) {
  const { gestureScale, gestureDX, gestureDY, gestureRotation } = values;
  // a worklet minden renderben újraépül, a committed/boxW értékek frissek.
  // Térbeli döntésnél (🧊 3D V1) a sorrend a renderrel egyezik: a 2D-forgatás
  // a legbelső (arra vetül a perspektíva), a scale/translate a döntött képre hat.
  const committedRotation = committed.rotation ?? 0;
  const tiltRotX = visualForTransform?.tilt3d?.rotX ?? 0;
  const tiltRotY = visualForTransform?.tilt3d?.rotY ?? 0;
  const hasTilt = tiltRotX !== 0 || tiltRotY !== 0;
  // ⚓⬛ anchor (pivot) + skew (audit §6.6) — a worklet-en KÍVÜL számoljuk (statikus,
  // nem gesztus-függő), a worklet csak elkapja. Anchor hiányzó = közép, skew = 0 → a
  // mai klipek transformja változatlan.
  const originStr = transformOrigin(committed);
  const skewEntries = skewTransformEntries(committed);
  // 📐 perspektíva (corner-pin, VIDEOT §4) — a render perspectiveFilter-ét a preview 3D rotate-tel közelíti
  const perspX = committed.perspectiveX ?? 0;
  const perspY = committed.perspectiveY ?? 0;
  const hasPersp = perspX !== 0 || perspY !== 0;
  return useAnimatedStyle(() => ({
    transformOrigin: originStr,
    transform: [
      { translateX: committed.x * boxW + gestureDX.value },
      { translateY: committed.y * boxH + gestureDY.value },
      { scale: committed.scale * gestureScale.value },
      ...skewEntries,
      ...(hasTilt
        ? [
            { perspective: Math.max(boxH, 1) * 1.2 },
            { rotateX: `${tiltRotX}deg` },
            { rotateY: `${tiltRotY}deg` },
          ]
        : []),
      ...(hasPersp
        ? [
            { perspective: Math.max(boxH, 1) * 1.2 },
            { rotateY: `${-perspX * 22}deg` },
            { rotateX: `${perspY * 22}deg` },
          ]
        : []),
      { rotate: `${committedRotation + gestureRotation.value}deg` },
    ],
  }));
}
