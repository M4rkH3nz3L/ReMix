/**
 * 📐 Az előnézeti vászon tiszta geometriája (React/RN/expo nélkül): a vászon
 * méretre igazítása, a koppintás/húzás normalizálása, a gesztus → transzform
 * számítás, a forgatás-snap és a maszk/arc-elmosás jelölők doboza.
 * A PreviewSurface-ből kiemelve — viselkedés változatlan.
 */
import type { pathBounds } from '@/lib/draw';
import { clamp } from '@/lib/time';
import type { EditorState } from '@/store/editorState';
import type { CanvasTransform, ClipMask, FaceBlur, ShapeClip } from '@/types/project';

export const IDENTITY: CanvasTransform = { scale: 1, x: 0, y: 0 };

/** 🔄 forgatás-snap: a legközelebbi 15°-ra pattint, ha ±5°-on belül (különben egész fok).
 *  A `snapped` csak akkor igaz, ha ténylegesen behúzta (>0,5° korrekció) — haptika-triggerhez. */
const ROT_SNAP_STEP = 15;
const ROT_SNAP_TOL = 5;
export function snapAngle(deg: number): { value: number; snapped: boolean } {
  const nearest = Math.round(deg / ROT_SNAP_STEP) * ROT_SNAP_STEP;
  if (Math.abs(deg - nearest) <= ROT_SNAP_TOL) {
    return { value: nearest, snapped: Math.abs(deg - nearest) > 0.5 };
  }
  return { value: Math.round(deg), snapped: false };
}

/** a vászon méretre igazítása a rendelkezésre álló területhez (`ar` = szélesség/magasság) */
export function fitCanvasBox(container: { w: number; h: number }, ar: number): { w: number; h: number } {
  let boxW = container.w;
  let boxH = ar > 0 ? boxW / ar : 0;
  if (boxH > container.h) {
    boxH = container.h;
    boxW = boxH * ar;
  }
  return { w: boxW, h: boxH };
}

/** vászon-pixel → 0–1 normalizált pont (a vászonra szorítva) */
export function normalizedCanvasPoint(px: number, py: number, boxW: number, boxH: number): { x: number; y: number } {
  return {
    x: clamp(px / Math.max(boxW, 1), 0, 1),
    y: clamp(py / Math.max(boxH, 1), 0, 1),
  };
}

/** 🅱️ before/after slider elválasztójának x-pozíciója (px); slider nélkül 0 */
export function compareSliderX(compareSplit: number | null, boxW: number): number {
  return compareSplit != null ? Math.round(compareSplit * boxW) : 0;
}

/** a gesztus élő deltái (shared value-k pillanatnyi értéke) */
export interface GestureDelta {
  scale: number;
  dx: number;
  dy: number;
  /** fok */
  rotation: number;
}

/** elengedéskor: a jelenlegi transzform + gesztus-delta → az új skála/pozíció/forgatás */
export function gestureTransformTarget(
  current: CanvasTransform,
  delta: GestureDelta,
  boxW: number,
  boxH: number,
  scaleMin: number,
  scaleMax: number
): { scale: number; x: number; y: number; rot: { value: number; snapped: boolean } } {
  const scale = clamp(current.scale * delta.scale, scaleMin, scaleMax);
  const x = clamp(current.x + delta.dx / Math.max(boxW, 1), -0.75, 0.75);
  const y = clamp(current.y + delta.dy / Math.max(boxH, 1), -0.75, 0.75);
  // 🔄 forgatás: a gesztus-delta (fok) a jelenlegi szöghöz adva, mágneses snap 15°-ra (±5°)
  const rot = snapAngle((current.rotation ?? 0) + delta.rotation);
  return { scale, x, y, rot };
}

/** ✏️ a rajzolt vonalból készülő forma-klip (`shape: 'path'`) a saját befoglaló dobozában */
export function pathShapeClip(
  id: string,
  start: number,
  boxPoints: { x: number; y: number }[],
  bounds: NonNullable<ReturnType<typeof pathBounds>>,
  brush: NonNullable<EditorState['drawBrush']>
): ShapeClip {
  return {
    kind: 'shape',
    id,
    start,
    duration: 3,
    shape: 'path',
    position: { x: bounds.x, y: bounds.y },
    w: bounds.w,
    h: bounds.h,
    fill: brush.color,
    points: boxPoints,
    strokeWidth: brush.width,
    opacity: brush.style === 'highlighter' ? 0.42 : 1,
    glow: brush.glow ? { color: brush.color, size: 1.6 } : undefined,
    blendMode: brush.style === 'highlighter' ? 'multiply' : undefined,
  };
}

/** maszk-közelítés doboza (px) + sarokkerekítés (ellipszisnél teljes) */
export function maskShadeGeometry(
  mask: ClipMask,
  boxW: number,
  boxH: number
): { mw: number; mh: number; left: number; top: number; radius: number } {
  const mw = mask.w * boxW;
  const mh = mask.h * boxH;
  const left = mask.x * boxW - mw / 2;
  const top = mask.y * boxH - mh / 2;
  const radius = mask.shape === 'ellipse' ? Math.max(mw, mh) : 8;
  return { mw, mh, left, top, radius };
}

/** 🙈 arc-elmosás jelölő doboza (px) */
export function faceBlurRect(
  fb: FaceBlur,
  boxW: number,
  boxH: number
): { left: number; top: number; width: number; height: number } {
  return {
    left: (fb.x - fb.w / 2) * boxW,
    top: (fb.y - fb.h / 2) * boxH,
    width: fb.w * boxW,
    height: fb.h * boxH,
  };
}
