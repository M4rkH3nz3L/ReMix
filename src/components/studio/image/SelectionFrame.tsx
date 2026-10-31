import { useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { palette } from '@/constants/editor';
import type { LivePatch } from '@/lib/imageLayerClip';
import { textSize } from '@/lib/imageLayerLayout';
import { resizeFromCorner, type ResizeCorner, type ResizeStart } from '@/lib/layerResize';
import type { ImageLayer } from '@/types/project';

const round4 = (v: number) => Math.round(v * 1e4) / 1e4;

/** a réteg rövidebb oldala ennél kisebb nem lehet a képernyőn — különben nem fogható meg */
const MIN_SIDE_PX = 24;
/** a réteg legfeljebb a vászon ennyiszerese */
const MAX_CANVAS_MULTIPLE = 6;
const MIN_FONT = 2;
const MAX_FONT = 200;
/** a forgató fogó nyele (px) */
const STEM = 26;

const CORNERS: ResizeCorner[] = ['tl', 'tr', 'bl', 'br'];
const CORNER_STYLE: Record<ResizeCorner, object> = {
  tl: { left: -18, top: -18 },
  tr: { right: -18, top: -18 },
  bl: { left: -18, bottom: -18 },
  br: { right: -18, bottom: -18 },
};

/**
 * 🎯 Kijelölő-keret a vászon aktív rétegén — közvetlen KÉZI méretezés (négy sarokfogó,
 * a szemközti sarok áll) és FORGATÁS (fej-fogó) a fotó/forma/szöveg rétegeken (a
 * háttér-fill nem forog). A `rotation`-t az előnézet (wrap-transform) és a kép-doc
 * render (PNG-forgatás) egyformán érvényesíti. A gesztus alatt `onLive` élőben
 * rajzol; a végén `onCommit` egyetlen undo-lépésként rögzít.
 *
 * Gesztus: react-native-gesture-handler; a fogók inline `Gesture.Pan`-je minden renderben
 * friss, ezért a húzás KEZDŐ állapota ref-ben él. `.runOnJS(true)`: a callbackek a JS-szálon.
 */
export function SelectionFrame({
  layer,
  box,
  zoom = 1,
  onLive,
  onCommit,
}: {
  layer: ImageLayer;
  box: { w: number; h: number };
  zoom?: number;
  onLive: (patch: LivePatch) => void;
  onCommit: (patch: LivePatch) => void;
}) {
  // — MINDEN hook a korai visszatérés ELŐTT (rules-of-hooks) —
  const pending = useRef<LivePatch>({});
  // a húzás KEZDETI állapota: a `layer` prop húzás közben az élő előnézet, abból számolni
  // önmagára halmozná a skálát (ettől szállt el vagy esett össze a méret)
  const resizeStart = useRef<{ layer: ImageLayer; geom: ResizeStart } | null>(null);
  const frameRef = useRef<View>(null);
  const rotState = useRef<{ center?: { x: number; y: number }; startAngle?: number; startRot: number }>({
    startRot: 0,
  });

  // — geometria a réteg-fajtából —
  if (layer.kind === 'fill' || layer.kind === 'adjust') {
    return null; // háttér / korrekció: nincs kerete
  }
  const cx = layer.position.x * box.w;
  const cy = layer.position.y * box.h;
  const rot = layer.rotation ?? 0;
  const size = layer.kind === 'text' ? textSize(layer, box.w / box.h) : { w: layer.w, h: layer.h };
  const halfW = Math.max(12, (size.w * box.w) / 2);
  const halfH = Math.max(12, (size.h * box.h) / 2);
  // a fogók mérete a képernyőn állandó, bármekkora a nagyítás
  const s = 1 / zoom;

  // ── Méretezés (bármelyik sarok): a szemközti sarok áll, a húzás KEZDETI állapotából számol ──
  const startResize = () => {
    resizeStart.current = { layer, geom: { cx, cy, halfW, halfH, rotation: rot } };
    pending.current = {};
  };
  const updateResize = (corner: ResizeCorner, tx: number, ty: number) => {
    const start = resizeStart.current;
    if (!start || start.layer.kind === 'fill' || start.layer.kind === 'adjust') {
      return;
    }
    const { geom, layer: from } = start;
    const shortSide = 2 * Math.min(geom.halfW, geom.halfH);
    const longSide = 2 * Math.max(geom.halfW, geom.halfH);
    const limits =
      from.kind === 'text'
        ? { minSide: shortSide * (MIN_FONT / from.fontSize), maxSide: longSide * (MAX_FONT / from.fontSize) }
        : { minSide: MIN_SIDE_PX * s, maxSide: MAX_CANVAS_MULTIPLE * Math.max(box.w, box.h) };
    const r = resizeFromCorner(geom, corner, tx * s, ty * s, limits);
    const position = { x: r.cx / box.w, y: r.cy / box.h };
    const patch: LivePatch =
      from.kind === 'text'
        ? { fontSize: Math.round(from.fontSize * r.factor * 10) / 10, position }
        : { w: round4(from.w * r.factor), h: round4(from.h * r.factor), position };
    pending.current = patch;
    onLive(patch);
  };
  const scaleGesture = (corner: ResizeCorner) =>
    Gesture.Pan()
      .withTestId(`scale-${corner}`)
      .runOnJS(true)
      .maxPointers(1)
      .minDistance(0)
      .hitSlop(10)
      .onStart(startResize)
      .onUpdate((e) => updateResize(corner, e.translationX, e.translationY))
      .onEnd(() => {
        if (Object.keys(pending.current).length > 0) {
          onCommit(pending.current);
        }
        pending.current = {};
        resizeStart.current = null;
      })
      .onFinalize((_e, success) => {
        if (!success) {
          pending.current = {};
          resizeStart.current = null;
          onLive({});
        }
      });

  // ── Forgatás (fej-fogó): a keret középpontja köré, abszolút képernyő-koordinátából ──
  const rotateGesture = Gesture.Pan()
    .runOnJS(true)
    .hitSlop(12)
    .onStart(() => {
      pending.current = {};
      rotState.current = { startRot: rot };
      frameRef.current?.measureInWindow?.((x, y, w, h) => {
        rotState.current.center = { x: x + w / 2, y: y + h / 2 };
      });
    })
    .onUpdate((e) => {
      const c = rotState.current.center;
      if (!c) {
        return;
      }
      const ang = Math.atan2(e.absoluteY - c.y, e.absoluteX - c.x);
      if (rotState.current.startAngle === undefined) {
        rotState.current.startAngle = ang;
      }
      const deg = Math.round(
        rotState.current.startRot + ((ang - rotState.current.startAngle) * 180) / Math.PI
      );
      pending.current = { rotation: deg };
      onLive({ rotation: deg });
    })
    .onEnd(() => {
      if (pending.current.rotation !== undefined) {
        onCommit({ rotation: pending.current.rotation });
      }
      pending.current = {};
    })
    .onFinalize((_e, success) => {
      if (!success) {
        pending.current = {};
        onLive({});
      }
    });

  return (
    <View
      ref={frameRef}
      pointerEvents="box-none"
      style={[
        styles.frame,
        {
          left: cx - halfW,
          top: cy - halfH,
          width: halfW * 2,
          height: halfH * 2,
          transform: [{ rotate: `${rot}deg` }],
        },
      ]}
    >
      {/* a keret-vonal a nagyítástól függetlenül vékony */}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.outline, { borderWidth: s }]} />
      <View pointerEvents="none" style={[styles.rotStem, { top: -STEM * s, height: STEM * s, width: 2 * s, marginLeft: -s }]} />
      <GestureDetector gesture={rotateGesture}>
        <View style={[styles.rotHandle, { top: -STEM * s - 14, transform: [{ scale: s }] }]}>
          <View style={styles.rotDot} />
        </View>
      </GestureDetector>
      {CORNERS.map((corner) => (
        <GestureDetector key={corner} gesture={scaleGesture(corner)}>
          <View style={[styles.scaleHandle, CORNER_STYLE[corner], { transform: [{ scale: s }] }]}>
            <View style={styles.scaleDot} />
          </View>
        </GestureDetector>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { position: 'absolute' },
  outline: { borderColor: palette.accent },
  scaleHandle: {
    position: 'absolute',
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scaleDot: { width: 14, height: 14, borderRadius: 3, backgroundColor: '#fff', borderWidth: 2, borderColor: palette.accent },
  rotStem: { position: 'absolute', left: '50%', backgroundColor: palette.accent },
  rotHandle: {
    position: 'absolute',
    left: '50%',
    marginLeft: -14,
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rotDot: { width: 16, height: 16, borderRadius: 8, backgroundColor: '#fff', borderWidth: 2, borderColor: palette.accent },
});
