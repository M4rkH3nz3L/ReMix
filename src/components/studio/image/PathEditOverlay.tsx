import { useRef } from 'react';
import { PanResponder, StyleSheet, View } from 'react-native';

import { palette } from '@/constants/editor';
import type { ShapeLayer } from '@/types/project';

/**
 * ✏️ Path node-szerkesztő overlay (toll v2) — a kijelölt path-forma horgonypontjait
 * húzható pöttyökként mutatja a vásznon. Húzás közben `onLive` élőben újraformálja
 * a path-t (ugyanaz a `live`-patch minta, mint a SelectionFrame-ben), a végén
 * `onCommit` egyetlen undo-lépésként rögzít. A node-ok a klip SAJÁT dobozához (0–1)
 * normalizáltak; itt a vászon-pixelekbe képezzük (position − w/2 + local·w).
 */
export function PathEditOverlay({
  box,
  layer,
  onLive,
  onCommit,
}: {
  box: { w: number; h: number };
  layer: ShapeLayer;
  onLive: (index: number, x: number, y: number) => void;
  onCommit: (index: number, x: number, y: number) => void;
}) {
  const pts = layer.points ?? [];
  return (
    <>
      {pts.map((_, i) => (
        <NodeDot key={i} box={box} layer={layer} index={i} onLive={onLive} onCommit={onCommit} />
      ))}
    </>
  );
}

function NodeDot({
  box,
  layer,
  index,
  onLive,
  onCommit,
}: {
  box: { w: number; h: number };
  layer: ShapeLayer;
  index: number;
  onLive: (index: number, x: number, y: number) => void;
  onCommit: (index: number, x: number, y: number) => void;
}) {
  // a gesztus-kezelő a legfrissebb bemenetet a ref-ből olvassa (a PanResponder EGYSZER jön létre)
  const dataRef = useRef({ box, layer, index, onLive, onCommit });
  dataRef.current = { box, layer, index, onLive, onCommit };
  const startRef = useRef({ x: 0, y: 0 });

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        const d = dataRef.current;
        const p = d.layer.points?.[d.index];
        startRef.current = { x: p?.x ?? 0, y: p?.y ?? 0 };
      },
      onPanResponderMove: (_e, g) => {
        const d = dataRef.current;
        const nx = startRef.current.x + g.dx / box.w / Math.max(1e-6, d.layer.w);
        const ny = startRef.current.y + g.dy / box.h / Math.max(1e-6, d.layer.h);
        d.onLive(d.index, nx, ny);
      },
      onPanResponderRelease: (_e, g) => {
        const d = dataRef.current;
        const nx = startRef.current.x + g.dx / box.w / Math.max(1e-6, d.layer.w);
        const ny = startRef.current.y + g.dy / box.h / Math.max(1e-6, d.layer.h);
        d.onCommit(d.index, nx, ny);
      },
    })
  ).current;

  const local = layer.points?.[index] ?? { x: 0, y: 0 };
  const cx = (layer.position.x - layer.w / 2 + local.x * layer.w) * box.w;
  const cy = (layer.position.y - layer.h / 2 + local.y * layer.h) * box.h;

  return (
    <View style={[styles.hit, { left: cx - 18, top: cy - 18 }]} hitSlop={10} {...pan.panHandlers}>
      <View style={styles.dot} />
    </View>
  );
}

const styles = StyleSheet.create({
  hit: { position: 'absolute', width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  dot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#ffffff',
    borderWidth: 3,
    borderColor: palette.accent,
  },
});
