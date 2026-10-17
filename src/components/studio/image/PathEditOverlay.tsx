import { useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Svg, { Line } from 'react-native-svg';

import { palette } from '@/constants/editor';
import type { HandleId } from '@/lib/vectorPath';
import type { ShapeLayer } from '@/types/project';

/**
 * ✏️ Path node-szerkesztő overlay (toll v2 + v3) — a kijelölt path-forma
 * horgonypontjait húzható pöttyökként mutatja; a KIJELÖLT node-nál a bezier-
 * fogók (h1/h2) is láthatók/húzhatók (v3), összekötő vonallal. Húzás közben
 * `onLive` élőben újraformálja a path-t (a SelectionFrame `live`-patch mintája),
 * a végén `onCommit` egy undo-lépés. A node-ok a klip SAJÁT dobozához (0–1)
 * normalizáltak → itt vászon-pixelekbe képezzük (position − w/2 + local·w).
 *
 * Gesztus: modern react-native-gesture-handler (Touch/03). A háttér él-beszúró
 * `Gesture.Tap` (a korábbi „kis elmozdulás = koppintás" helyett); a node/fogó-pöttyök
 * `Gesture.Pan`-je `minDistance(0)` → a koppintás is kijelöl (mint az eredeti `onGrant`).
 * Mindegyik EGYSZER jön létre (stabil), a friss propokat `dataRef`-ből olvassa, a
 * gesztus kezdetén `startRef`-be rögzíti a pont/fogó helyét, `e.translationX/Y`-ból
 * számol. `runOnJS(true)`: a callbackek a JS-szálon. A háttér-View a pöttyök ALATT
 * (azok elfogják a sajátjukat; a háttéren a drag nem mozdítja a rétegeket).
 */
export function PathEditOverlay({
  box,
  layer,
  selectedNode,
  onSelectNode,
  onLive,
  onCommit,
  onHandleLive,
  onHandleCommit,
  onInsertNode,
}: {
  box: { w: number; h: number };
  layer: ShapeLayer;
  selectedNode: number | null;
  onSelectNode: (index: number) => void;
  onLive: (index: number, x: number, y: number) => void;
  onCommit: (index: number, x: number, y: number) => void;
  onHandleLive: (index: number, handle: HandleId, x: number, y: number) => void;
  onHandleCommit: (index: number, handle: HandleId, x: number, y: number) => void;
  /** ✏️ v4: koppintás a path-ÉLRE → új node a legközelebbi ponton (lokális 0–1) */
  onInsertNode: (x: number, y: number) => void;
}) {
  const pts = layer.points ?? [];
  const toPx = (lx: number, ly: number) => ({
    x: (layer.position.x - layer.w / 2 + lx * layer.w) * box.w,
    y: (layer.position.y - layer.h / 2 + ly * layer.h) * box.h,
  });

  // 🖐️ háttér-koppintás az él-beszúráshoz (a node/fogó-pöttyök FÖLÖTTE vannak)
  const bgRef = useRef({ box, layer, onInsertNode });
  bgRef.current = { box, layer, onInsertNode };
  const bgTap = useRef(
    Gesture.Tap()
      .runOnJS(true)
      .onEnd((e) => {
        const d = bgRef.current;
        const lx = (e.x / d.box.w - (d.layer.position.x - d.layer.w / 2)) / Math.max(1e-6, d.layer.w);
        const ly = (e.y / d.box.h - (d.layer.position.y - d.layer.h / 2)) / Math.max(1e-6, d.layer.h);
        d.onInsertNode(lx, ly);
      })
  ).current;

  const sel = selectedNode != null ? pts[selectedNode] : null;
  const anchorPx = sel ? toPx(sel.x, sel.y) : null;
  const h1Px = sel?.h1 ? toPx(sel.h1.x, sel.h1.y) : null;
  const h2Px = sel?.h2 ? toPx(sel.h2.x, sel.h2.y) : null;

  return (
    <>
      {/* 🖐️ háttér (él-beszúró koppintás) — LEGALUL, a pöttyök elfogják a sajátjukat */}
      <GestureDetector gesture={bgTap}>
        <View style={StyleSheet.absoluteFill} />
      </GestureDetector>

      {/* bezier-fogó összekötő vonalak a kijelölt node-nál */}
      {anchorPx && (h1Px || h2Px) ? (
        <Svg width={box.w} height={box.h} style={StyleSheet.absoluteFill} pointerEvents="none">
          {h1Px ? (
            <Line x1={anchorPx.x} y1={anchorPx.y} x2={h1Px.x} y2={h1Px.y} stroke={palette.accent} strokeWidth={1.5} />
          ) : null}
          {h2Px ? (
            <Line x1={anchorPx.x} y1={anchorPx.y} x2={h2Px.x} y2={h2Px.y} stroke={palette.accent} strokeWidth={1.5} />
          ) : null}
        </Svg>
      ) : null}

      {/* horgony-pöttyök */}
      {pts.map((_, i) => (
        <NodeDot
          key={i}
          box={box}
          layer={layer}
          index={i}
          selected={i === selectedNode}
          onSelectNode={onSelectNode}
          onLive={onLive}
          onCommit={onCommit}
        />
      ))}

      {/* bezier-fogó pöttyök a kijelölt node-nál */}
      {selectedNode != null && h1Px ? (
        <HandleDot box={box} layer={layer} index={selectedNode} handle="h1" onLive={onHandleLive} onCommit={onHandleCommit} />
      ) : null}
      {selectedNode != null && h2Px ? (
        <HandleDot box={box} layer={layer} index={selectedNode} handle="h2" onLive={onHandleLive} onCommit={onHandleCommit} />
      ) : null}
    </>
  );
}

function NodeDot({
  box,
  layer,
  index,
  selected,
  onSelectNode,
  onLive,
  onCommit,
}: {
  box: { w: number; h: number };
  layer: ShapeLayer;
  index: number;
  selected: boolean;
  onSelectNode: (index: number) => void;
  onLive: (index: number, x: number, y: number) => void;
  onCommit: (index: number, x: number, y: number) => void;
}) {
  const dataRef = useRef({ box, layer, index, onSelectNode, onLive, onCommit });
  dataRef.current = { box, layer, index, onSelectNode, onLive, onCommit };
  const startRef = useRef({ x: 0, y: 0 });

  const pan = useRef(
    Gesture.Pan()
      .runOnJS(true)
      .minDistance(0)
      .hitSlop(10)
      .onStart(() => {
        const d = dataRef.current;
        d.onSelectNode(d.index);
        const p = d.layer.points?.[d.index];
        startRef.current = { x: p?.x ?? 0, y: p?.y ?? 0 };
      })
      .onUpdate((e) => {
        const d = dataRef.current;
        d.onLive(
          d.index,
          startRef.current.x + e.translationX / d.box.w / Math.max(1e-6, d.layer.w),
          startRef.current.y + e.translationY / d.box.h / Math.max(1e-6, d.layer.h)
        );
      })
      .onEnd((e) => {
        const d = dataRef.current;
        d.onCommit(
          d.index,
          startRef.current.x + e.translationX / d.box.w / Math.max(1e-6, d.layer.w),
          startRef.current.y + e.translationY / d.box.h / Math.max(1e-6, d.layer.h)
        );
      })
  ).current;

  const local = layer.points?.[index] ?? { x: 0, y: 0 };
  const cx = (layer.position.x - layer.w / 2 + local.x * layer.w) * box.w;
  const cy = (layer.position.y - layer.h / 2 + local.y * layer.h) * box.h;

  return (
    <GestureDetector gesture={pan}>
      <View style={[styles.hit, { left: cx - 18, top: cy - 18 }]}>
        <View style={[styles.dot, selected ? styles.dotSel : null]} />
      </View>
    </GestureDetector>
  );
}

function HandleDot({
  box,
  layer,
  index,
  handle,
  onLive,
  onCommit,
}: {
  box: { w: number; h: number };
  layer: ShapeLayer;
  index: number;
  handle: HandleId;
  onLive: (index: number, handle: HandleId, x: number, y: number) => void;
  onCommit: (index: number, handle: HandleId, x: number, y: number) => void;
}) {
  const dataRef = useRef({ box, layer, index, handle, onLive, onCommit });
  dataRef.current = { box, layer, index, handle, onLive, onCommit };
  const startRef = useRef({ x: 0, y: 0 });

  const pan = useRef(
    Gesture.Pan()
      .runOnJS(true)
      .minDistance(0)
      .hitSlop(10)
      .onStart(() => {
        const d = dataRef.current;
        const h = d.layer.points?.[d.index]?.[d.handle];
        startRef.current = { x: h?.x ?? 0, y: h?.y ?? 0 };
      })
      .onUpdate((e) => {
        const d = dataRef.current;
        d.onLive(
          d.index,
          d.handle,
          startRef.current.x + e.translationX / d.box.w / Math.max(1e-6, d.layer.w),
          startRef.current.y + e.translationY / d.box.h / Math.max(1e-6, d.layer.h)
        );
      })
      .onEnd((e) => {
        const d = dataRef.current;
        d.onCommit(
          d.index,
          d.handle,
          startRef.current.x + e.translationX / d.box.w / Math.max(1e-6, d.layer.w),
          startRef.current.y + e.translationY / d.box.h / Math.max(1e-6, d.layer.h)
        );
      })
  ).current;

  const h = layer.points?.[index]?.[handle];
  if (!h) {
    return null;
  }
  const cx = (layer.position.x - layer.w / 2 + h.x * layer.w) * box.w;
  const cy = (layer.position.y - layer.h / 2 + h.y * layer.h) * box.h;

  return (
    <GestureDetector gesture={pan}>
      <View style={[styles.hit, { left: cx - 18, top: cy - 18 }]}>
        <View style={styles.handle} />
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  hit: { position: 'absolute', width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 16, height: 16, borderRadius: 8, backgroundColor: '#ffffff', borderWidth: 3, borderColor: palette.accent },
  dotSel: { backgroundColor: palette.accent, borderColor: '#ffffff' },
  handle: { width: 13, height: 13, borderRadius: 3, backgroundColor: palette.accent, borderWidth: 2, borderColor: '#ffffff' },
});
