import { useRef } from 'react';
import { PanResponder, StyleSheet, View } from 'react-native';

import { palette } from '@/constants/editor';
import type { LivePatch } from '@/lib/imageLayerClip';
import type { ImageLayer } from '@/types/project';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

interface FrameData {
  layer: ImageLayer;
  halfW: number;
  halfH: number;
  rot: number;
  onLive: (patch: LivePatch) => void;
  onCommit: (patch: LivePatch) => void;
}

/**
 * 🎯 Kijelölő-keret a vászon aktív rétegén — közvetlen KÉZI méretezés (sarok-fogó,
 * minden réteg-fajta) és FORGATÁS (fej-fogó, csak fotó; forma/szöveg statikus
 * forgatást a render nem éget be, ezért ott nincs). A gesztus alatt `onLive`
 * élőben rajzol; a végén `onCommit` egyetlen undo-lépésként rögzít.
 *
 * A gesztus-kezelők a `dataRef`-ből olvasnak (a PanResponder EGYSZER jön létre,
 * a záródó változók elavulnának) — ugyanaz a minta, mint a hang-stúdió Sliderében.
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
  const dataRef = useRef<FrameData | null>(null);
  const rotState = useRef<{ center?: { x: number; y: number }; startAngle?: number; startRot: number }>({
    startRot: 0,
  });

  const scalePan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        pending.current = {};
      },
      onPanResponderMove: (_e, g) => {
        const d = dataRef.current;
        if (!d) {
          return;
        }
        const rad = (d.rot * Math.PI) / 180;
        const sx = d.halfW * Math.cos(rad) - d.halfH * Math.sin(rad);
        const sy = d.halfW * Math.sin(rad) + d.halfH * Math.cos(rad);
        const diag = Math.max(1, Math.hypot(d.halfW, d.halfH));
        const factor = clamp(Math.hypot(sx + g.dx, sy + g.dy) / diag, 0.12, 8);
        if (d.layer.kind === 'text') {
          const fontSize = clamp(Math.round(d.layer.fontSize * factor * 10) / 10, 2, 40);
          pending.current = { fontSize };
          d.onLive({ fontSize });
        } else if (d.layer.kind === 'photo' || d.layer.kind === 'shape') {
          const w = clamp(Math.round(d.layer.w * factor * 1000) / 1000, 0.02, 2);
          const h = clamp(Math.round(d.layer.h * factor * 1000) / 1000, 0.02, 2);
          pending.current = { w, h };
          d.onLive({ w, h });
        }
      },
      onPanResponderRelease: () => {
        if (Object.keys(pending.current).length > 0) {
          dataRef.current?.onCommit(pending.current);
        }
        pending.current = {};
      },
      onPanResponderTerminate: () => {
        pending.current = {};
        dataRef.current?.onLive({});
      },
    })
  ).current;

  const rotatePan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        pending.current = {};
        const d = dataRef.current;
        rotState.current = {
          startRot: d && d.layer.kind === 'photo' ? d.layer.rotation ?? 0 : 0,
        };
        frameRef.current?.measureInWindow?.((x, y, w, h) => {
          rotState.current.center = { x: x + w / 2, y: y + h / 2 };
        });
      },
      onPanResponderMove: (_e, g) => {
        const c = rotState.current.center;
        if (!c) {
          return;
        }
        const ang = Math.atan2(g.moveY - c.y, g.moveX - c.x);
        if (rotState.current.startAngle === undefined) {
          rotState.current.startAngle = ang;
        }
        const deg = Math.round(
          rotState.current.startRot + ((ang - rotState.current.startAngle) * 180) / Math.PI
        );
        pending.current = { rotation: deg };
        dataRef.current?.onLive({ rotation: deg });
      },
      onPanResponderRelease: () => {
        if (pending.current.rotation !== undefined) {
          dataRef.current?.onCommit({ rotation: pending.current.rotation });
        }
        pending.current = {};
      },
      onPanResponderTerminate: () => {
        pending.current = {};
        dataRef.current?.onLive({});
      },
    })
  ).current;

  // — geometria a réteg-fajtából —
  let cx: number;
  let cy: number;
  let halfW: number;
  let halfH: number;
  let rot = 0;
  const canRotate = layer.kind === 'photo';
  if (layer.kind === 'photo' || layer.kind === 'shape') {
    cx = layer.position.x * box.w;
    cy = layer.position.y * box.h;
    halfW = (layer.w * box.w) / 2;
    halfH = (layer.h * box.h) / 2;
    rot = layer.kind === 'photo' ? layer.rotation ?? 0 : 0;
  } else if (layer.kind === 'text') {
    cx = layer.position.x * box.w;
    cy = layer.position.y * box.h;
    const fontPx = (layer.fontSize / 100) * box.h;
    halfH = Math.max(16, fontPx * 0.8);
    halfW = Math.max(48, box.w * 0.34);
  } else {
    return null; // fill: háttér, nincs kerete
  }

  // a gesztus-kezelők legfrissebb bemenete
  dataRef.current = { layer, halfW, halfH, rot, onLive, onCommit };

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
          <View style={styles.rotHandle} hitSlop={12} {...rotatePan.panHandlers}>
            <View style={styles.rotDot} />
          </View>
        </>
      ) : null}
      <View style={styles.scaleHandle} hitSlop={12} {...scalePan.panHandlers}>
        <View style={styles.scaleDot} />
      </View>
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
