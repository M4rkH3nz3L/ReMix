import { useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { palette } from '@/constants/editor';
import type { LivePatch } from '@/lib/imageLayerClip';
import type { ImageLayer } from '@/types/project';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * 🎯 Kijelölő-keret a vászon aktív rétegén — közvetlen KÉZI méretezés (sarok-fogó,
 * minden réteg-fajta) és FORGATÁS (fej-fogó) a fotó/forma/szöveg rétegeken (a
 * háttér-fill nem forog). A `rotation`-t az előnézet (wrap-transform) és a kép-doc
 * render (PNG-forgatás) egyformán érvényesíti. A gesztus alatt `onLive` élőben
 * rajzol; a végén `onCommit` egyetlen undo-lépésként rögzít.
 *
 * Gesztus: modern react-native-gesture-handler (Touch/03) — a fogók inline
 * `Gesture.Pan`-je MINDEN renderben friss closure-t kap (a committed réteg a drag
 * alatt állandó, mert az `onLive` csak előnézetet rajzol), így nem kell a korábbi
 * `dataRef`-minta. A callbackek `.runOnJS(true)`-val a JS-szálon futnak (setState).
 */
export function SelectionFrame({
  layer,
  box,
  onLive,
  onCommit,
}: {
  layer: ImageLayer;
  box: { w: number; h: number };
  onLive: (patch: LivePatch) => void;
  onCommit: (patch: LivePatch) => void;
}) {
  // — MINDEN hook a korai visszatérés ELŐTT (rules-of-hooks) —
  const pending = useRef<LivePatch>({});
  const frameRef = useRef<View>(null);
  const rotState = useRef<{ center?: { x: number; y: number }; startAngle?: number; startRot: number }>({
    startRot: 0,
  });

  // — geometria a réteg-fajtából —
  let cx: number;
  let cy: number;
  let halfW: number;
  let halfH: number;
  let rot = 0;
  // 🔄 forgatható minden réteg a háttér (fill) KIVÉTELÉVEL — a shape/text már
  // ugyanúgy honorálja a `rotation`-t az előnézetben és a render-ben, mint a fotó
  const canRotate = layer.kind !== 'fill';
  if (layer.kind === 'photo' || layer.kind === 'shape') {
    cx = layer.position.x * box.w;
    cy = layer.position.y * box.h;
    halfW = (layer.w * box.w) / 2;
    halfH = (layer.h * box.h) / 2;
    rot = layer.rotation ?? 0;
  } else if (layer.kind === 'text') {
    cx = layer.position.x * box.w;
    cy = layer.position.y * box.h;
    const fontPx = (layer.fontSize / 100) * box.h;
    halfH = Math.max(16, fontPx * 0.8);
    halfW = Math.max(48, box.w * 0.34);
    rot = layer.rotation ?? 0;
  } else {
    return null; // fill: háttér, nincs kerete
  }

  // ── Méretezés (sarok-fogó): a teljes elmozdulásból abszolút skála-faktor ──
  const scaleGesture = Gesture.Pan()
    .runOnJS(true)
    .hitSlop(12)
    .onStart(() => {
      pending.current = {};
    })
    .onUpdate((e) => {
      const rad = (rot * Math.PI) / 180;
      const sx = halfW * Math.cos(rad) - halfH * Math.sin(rad);
      const sy = halfW * Math.sin(rad) + halfH * Math.cos(rad);
      const diag = Math.max(1, Math.hypot(halfW, halfH));
      const factor = clamp(Math.hypot(sx + e.translationX, sy + e.translationY) / diag, 0.12, 8);
      if (layer.kind === 'text') {
        const fontSize = clamp(Math.round(layer.fontSize * factor * 10) / 10, 2, 40);
        pending.current = { fontSize };
        onLive({ fontSize });
      } else if (layer.kind === 'photo' || layer.kind === 'shape') {
        const w = clamp(Math.round(layer.w * factor * 1000) / 1000, 0.02, 2);
        const h = clamp(Math.round(layer.h * factor * 1000) / 1000, 0.02, 2);
        pending.current = { w, h };
        onLive({ w, h });
      }
    })
    .onEnd(() => {
      if (Object.keys(pending.current).length > 0) {
        onCommit(pending.current);
      }
      pending.current = {};
    })
    .onFinalize((_e, success) => {
      if (!success) {
        pending.current = {};
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
      {canRotate ? (
        <>
          <View pointerEvents="none" style={styles.rotStem} />
          <GestureDetector gesture={rotateGesture}>
            <View style={styles.rotHandle}>
              <View style={styles.rotDot} />
            </View>
          </GestureDetector>
        </>
      ) : null}
      <GestureDetector gesture={scaleGesture}>
        <View style={styles.scaleHandle}>
          <View style={styles.scaleDot} />
        </View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    position: 'absolute',
    borderWidth: 1,
    borderColor: palette.accent,
    borderStyle: 'dashed',
  },
  scaleHandle: {
    position: 'absolute',
    right: -14,
    bottom: -14,
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scaleDot: { width: 16, height: 16, borderRadius: 8, backgroundColor: palette.accent, borderWidth: 2, borderColor: '#fff' },
  rotStem: { position: 'absolute', top: -26, left: '50%', marginLeft: -1, width: 2, height: 26, backgroundColor: palette.accent },
  rotHandle: {
    position: 'absolute',
    top: -40,
    left: '50%',
    marginLeft: -14,
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rotDot: { width: 16, height: 16, borderRadius: 8, backgroundColor: '#fff', borderWidth: 2, borderColor: palette.accent },
});
