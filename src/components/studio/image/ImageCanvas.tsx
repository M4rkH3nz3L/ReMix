import { Ionicons } from '@expo/vector-icons';
import { type Ref, Suspense, lazy, useEffect, useRef, useState } from 'react';
import { type LayoutChangeEvent, Pressable, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { ShapeOverlay } from '@/components/preview/ShapeOverlay';
import { TextOverlay } from '@/components/preview/TextOverlay';
// 🖌️ a BrushOverlay (Skia-függő) LUSTÁN töltődik — csak a TÍPUS statikus (erased),
// a komponens csak az ecset bekapcsolásakor rántja be a @shopify/react-native-skia
// natív modult, így annak hiánya (régi dev-kliens) nem crash-eltet betöltéskor.
import { type BrushHandle } from '@/components/studio/image/BrushOverlay';
import { CropOverlay } from '@/components/studio/image/CropOverlay';
import { FillLayerView } from '@/components/studio/image/FillLayerView';
import { LassoOverlay } from '@/components/studio/image/LassoOverlay';
import { PathEditOverlay } from '@/components/studio/image/PathEditOverlay';
import { PenOverlay } from '@/components/studio/image/PenOverlay';
import { PhotoLayerView } from '@/components/studio/image/PhotoLayerView';
import { RulersOverlay } from '@/components/studio/image/RulersOverlay';
import { SelectionFrame } from '@/components/studio/image/SelectionFrame';
import { WandOverlay } from '@/components/studio/image/WandOverlay';
import { aspectValue, palette } from '@/constants/editor';
import { gradeTint } from '@/constants/grades';
import { adjustTintLayers } from '@/lib/adjustPreview';
import { canvasTransform, clampPan, pinchZoom, zoomStep } from '@/lib/canvasZoom';
import type { CropRect } from '@/lib/imageCrop';
import { snapToLayers, type LayerBox, type SnapLine } from '@/lib/smartGuides';
import { effectiveLayerOpacity, updateLayer, visibleLayers } from '@/lib/imageDoc';
import { layerToShapeClip, layerToTextClip, type LivePatch } from '@/lib/imageLayerClip';
import type { CanvasPoint } from '@/lib/penPath';
import { addGuide, moveGuide, removeGuide, snapPointToGuides } from '@/lib/rulers';
import { dragHandle, type HandleId, insertAnchor, moveAnchor, nearestOnPath } from '@/lib/vectorPath';
import type { ImageDoc, ImageLayer, ShapeLayer } from '@/types/project';

// lusta Skia-komponens: csak ecset-módban töltődik be (lásd a fenti import-jegyzetet)
const BrushOverlay = lazy(() =>
  import('@/components/studio/image/BrushOverlay').then((m) => ({ default: m.BrushOverlay }))
);

function withLive(layer: ImageLayer, patch: LivePatch): ImageLayer {
  return { ...layer, ...patch } as ImageLayer;
}

/**
 * 🖼️ A Kép Stúdió VÁSZNA — a látható rétegeket ALULRÓL FÖLFELÉ rajzolja,
 * PONTOSAN a timeline-előnézet komponenseivel (ShapeOverlay/TextOverlay) →
 * render-paritás. A rétegek húzhatók (move), a kijelölt réteg mérete/forgatása a
 * kijelölő-kereten. Minden módosítás a command-buson megy (undo).
 */
export function ImageCanvas({
  doc,
  selectedId,
  onSelect,
  onRequestEdit,
  commit,
  canvasRef,
  capturing,
  cropRect,
  onCropRectChange,
  penPoints,
  onPenAddPoint,
  onPenClose,
  pathEditId,
  selectedNode,
  onSelectNode,
  lassoActive,
  onLassoComplete,
  onLassoCancel,
  wandActive,
  onWandSeed,
  brushActive,
  brushColor = '#ff2d95',
  brushSize = 8,
  brushRef,
  guidesActive,
}: {
  doc: ImageDoc;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onRequestEdit?: (id: string) => void;
  commit: (next: ImageDoc, label?: string) => void;
  /** a vászon View-ja — az on-device raszterizáláshoz (captureRef fallback) */
  canvasRef?: Ref<View>;
  /** raszterizálás alatt: a kijelölés-krómot (keret/kijelölő-szegély) elrejtjük */
  capturing?: boolean;
  /** ✂️ kivágás-mód: ha megadva, a vásznon a kivágás-overlay jelenik meg (kijelölés nélkül) */
  cropRect?: CropRect | null;
  onCropRectChange?: (rect: CropRect) => void;
  /** ✏️ toll-mód: ha megadva (nem null), a vásznon a toll-overlay jelenik meg */
  penPoints?: CanvasPoint[] | null;
  onPenAddPoint?: (p: CanvasPoint) => void;
  onPenClose?: () => void;
  /** ✏️ toll v2 node-szerkesztő mód: a megadott id-jű path-forma horgonypontjait húzhatja */
  pathEditId?: string | null;
  /** ✏️ toll v3: a kijelölt node indexe (ennél jelennek meg a bezier-fogók) */
  selectedNode?: number | null;
  onSelectNode?: (index: number) => void;
  /** 🪢 lasszó-mód: szabadkézi húzás → zárt path-forma */
  lassoActive?: boolean;
  onLassoComplete?: (points: CanvasPoint[]) => void;
  onLassoCancel?: () => void;
  /** 🪄 varázspálca-mód: fotóra koppintva szín-szelekció (Skia) */
  wandActive?: boolean;
  onWandSeed?: (
    uri: string,
    u: number,
    v: number,
    box: { position: { x: number; y: number }; w: number; h: number }
  ) => void;
  /** 🖌️ ecset-mód: Skia raszter-festés (a snapshotot a szülő fotó-rétegként menti) */
  brushActive?: boolean;
  brushColor?: string;
  brushSize?: number;
  brushRef?: Ref<BrushHandle>;
  /** 📐 vonalzók + segédvonalak megjelenítése/szerkesztése */
  guidesActive?: boolean;
}) {
  const [container, setContainer] = useState({ w: 0, h: 0 });
  const [live, setLive] = useState<{ id: string; patch: LivePatch } | null>(null);
  const [liveGuide, setLiveGuide] = useState<{ id: string; pos: number } | null>(null);
  // 🔍 nézegetős zoom/pan — a szerkesztés 1:1-nél, zoom>1-nél a pan-overlay veszi át a gesztust
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  // 🧲 smart-guides: a pattintott tengelyek jelző-vonalai (rövid felvillanás a mozgatás után)
  const [smartLines, setSmartLines] = useState<SnapLine[]>([]);
  const smartTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (smartTimer.current) {
      clearTimeout(smartTimer.current);
    }
  }, []);

  // a szabad W×H a mérvadó (kép-editor); különben a 3-arányos enum
  const av = doc.width && doc.height ? doc.width / doc.height : aspectValue(doc.aspectRatio);
  const fit =
    container.w > 0 && container.h > 0
      ? container.w / container.h > av
        ? { w: container.h * av, h: container.h }
        : { w: container.w, h: container.w / av }
      : { w: 0, h: 0 };

  // 🔍 zoom/pan gesztusok (Touch/03, RNGH): a vászon CSIPPENTÉSSEL nagyítható (2 ujj),
  // zoom>1-nél 1 ujjal tolható (pan-overlay). A gesztusok EGYSZER jönnek létre (stabil),
  // a friss zoom/pan/fit-et refből olvassák. A csippentés a KÜLSŐ vásznon ül → együtt él
  // az 1-ujjas réteg-szerkesztéssel (azt a leszármazott réteg-gesztusok viszik); a pan
  // `maxPointers(1)` → a 2-ujjas gesztus a csippentésé marad.
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const panRef = useRef(pan);
  panRef.current = pan;
  const fitRef = useRef(fit);
  fitRef.current = fit;
  const panStart = useRef({ x: 0, y: 0 });
  const zoomStart = useRef(1);
  const panGesture = useRef(
    Gesture.Pan()
      .runOnJS(true)
      .maxPointers(1)
      .onStart(() => {
        panStart.current = panRef.current;
      })
      .onUpdate((e) => {
        setPan(
          clampPan(
            { x: panStart.current.x + e.translationX, y: panStart.current.y + e.translationY },
            zoomRef.current,
            fitRef.current
          )
        );
      })
  ).current;
  const pinchGesture = useRef(
    Gesture.Pinch()
      .runOnJS(true)
      .onStart(() => {
        zoomStart.current = zoomRef.current;
      })
      .onUpdate((e) => {
        const z = pinchZoom(zoomStart.current, e.scale);
        setZoom(z);
        setPan((p) => clampPan(p, z, fitRef.current));
      })
  ).current;
  const tf = canvasTransform(zoom, pan, fit);
  const zoomStyle = !capturing && zoom !== 1
    ? { transform: [{ translateX: tf.translateX }, { translateY: tf.translateY }, { scale: tf.scale }] }
    : undefined;
  const resetZoom = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };
  const applyZoom = (dir: 1 | -1) => {
    const z = zoomStep(zoomRef.current, dir);
    setZoom(z);
    setPan((p) => clampPan(p, z, fitRef.current));
  };

  // 🧲 egy réteg igazodó-doboza (közép-pozíció + méret; a méret nélkülieké — pl. szöveg — 0)
  const layerBox = (l: ImageLayer, posOverride?: { x: number; y: number }): LayerBox => {
    const pos = posOverride ?? ('position' in l ? l.position : { x: 0.5, y: 0.5 });
    const w = 'w' in l && typeof l.w === 'number' ? l.w : 0;
    const h = 'h' in l && typeof l.h === 'number' ? l.h : 0;
    return { x: pos.x, y: pos.y, w, h };
  };

  // 📐 réteg-mozgatás: kézi vonalzó-guide-ok (ha vannak), MAJD 🧲 smart-guides (a többi réteghez + vászonhoz)
  const move = (id: string, position: { x: number; y: number }) => {
    let pos = position;
    const g = doc.guides?.length ? snapPointToGuides(pos, doc.guides) : null;
    if (g) {
      pos = { x: g.x, y: g.y };
    }
    const dragged = doc.layers.find((l) => l.id === id);
    if (dragged && dragged.kind !== 'fill' && dragged.kind !== 'adjust') {
      const others = visibleLayers(doc)
        .filter((l) => l.id !== id && l.kind !== 'fill' && l.kind !== 'adjust')
        .map((l) => layerBox(l));
      const snap = snapToLayers(layerBox(dragged, pos), others);
      pos = { x: snap.x, y: snap.y };
      // rövid jelző-vonal-felvillanás a pattintott tengely(ek)en
      if (smartTimer.current) {
        clearTimeout(smartTimer.current);
      }
      setSmartLines(snap.lines);
      if (snap.lines.length) {
        smartTimer.current = setTimeout(() => setSmartLines([]), 800);
      }
    }
    commit(updateLayer(doc, id, { position: pos }), 'move');
  };

  // 📐 segédvonal-műveletek (hozzáadás / élő-mozgatás / rögzítés|törlés)
  const guides = doc.guides ?? [];
  const displayGuides = liveGuide
    ? guides.map((g) => (g.id === liveGuide.id ? { ...g, pos: liveGuide.pos } : g))
    : guides;
  const onAddGuide = (axis: 'x' | 'y', pos: number) =>
    commit({ ...doc, guides: addGuide(guides, axis, pos) }, 'guide-add');
  const onCommitGuide = (id: string, pos: number | null) => {
    setLiveGuide(null);
    commit(
      { ...doc, guides: pos == null ? removeGuide(guides, id) : moveGuide(guides, id, pos) },
      'guide'
    );
  };

  const layers = visibleLayers(doc);
  const selectedLayer = doc.layers.find((l) => l.id === selectedId) ?? null;

  // ✏️ node-szerkesztő: a kijelölt path-forma (committed = a moveAnchor stabil alapja)
  const rawPathEdit = pathEditId ? doc.layers.find((l) => l.id === pathEditId) ?? null : null;
  const pathEditShape =
    rawPathEdit && rawPathEdit.kind === 'shape' && rawPathEdit.shape === 'path' ? rawPathEdit : null;
  // a dot-követéshez a vászon-rajzolással AZONOS élő-patchelt változat
  const pathEditLive =
    pathEditShape && live?.id === pathEditShape.id
      ? (withLive(pathEditShape, live.patch) as ShapeLayer)
      : pathEditShape;
  const onNodeLive = (index: number, x: number, y: number) => {
    if (!pathEditShape?.points) return;
    setLive({ id: pathEditShape.id, patch: { points: moveAnchor(pathEditShape.points, index, x, y) } });
  };
  const onNodeCommit = (index: number, x: number, y: number) => {
    if (!pathEditShape?.points) return;
    setLive(null);
    commit(
      updateLayer(doc, pathEditShape.id, { points: moveAnchor(pathEditShape.points, index, x, y) }),
      'node'
    );
  };
  // ✏️ v3: bezier-fogó húzása (tükrözött/szimmetrikus a szemközti fogóval)
  const onHandleLive = (index: number, handle: HandleId, x: number, y: number) => {
    if (!pathEditShape?.points) return;
    setLive({ id: pathEditShape.id, patch: { points: dragHandle(pathEditShape.points, index, handle, x, y, 'mirrored') } });
  };
  const onHandleCommit = (index: number, handle: HandleId, x: number, y: number) => {
    if (!pathEditShape?.points) return;
    setLive(null);
    commit(
      updateLayer(doc, pathEditShape.id, { points: dragHandle(pathEditShape.points, index, handle, x, y, 'mirrored') }),
      'handle'
    );
  };
  // ✏️ v4: koppintás a path-ÉLRE → új node (csak ha elég közel a vonalhoz)
  const onInsertNode = (x: number, y: number) => {
    if (!pathEditShape?.points) return;
    const hit = nearestOnPath(pathEditShape.points, !!pathEditShape.closed, x, y);
    if (!hit || hit.dist > 0.05) return;
    commit(
      updateLayer(doc, pathEditShape.id, { points: insertAnchor(pathEditShape.points, x, y, !!pathEditShape.closed) }),
      'node-insert'
    );
  };

  // 🪄 varázspálca: a koppintás alatti LEGFELSŐ fotó-réteg + a dobozon belüli lokális (0–1) pont
  const onWandTap = (nx: number, ny: number) => {
    for (let i = doc.layers.length - 1; i >= 0; i--) {
      const l = doc.layers[i];
      if (l.kind !== 'photo' || l.hidden) continue;
      const left = l.position.x - l.w / 2;
      const top = l.position.y - l.h / 2;
      if (nx >= left && nx <= left + l.w && ny >= top && ny <= top + l.h) {
        onWandSeed?.(l.uri, (nx - left) / l.w, (ny - top) / l.h, {
          position: l.position,
          w: l.w,
          h: l.h,
        });
        return;
      }
    }
  };

  return (
    <View
      style={styles.stage}
      onLayout={(e: LayoutChangeEvent) =>
        setContainer({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })
      }
    >
      {fit.w > 0 ? (
        <GestureDetector gesture={pinchGesture}>
        <View ref={canvasRef} style={[styles.canvas, { width: fit.w, height: fit.h }]}>
          {/* 🔍 zoom/pan-wrapper: a tartalom (rétegek + overlay-k) együtt skálázódik/tolódik;
              capture-kor és zoom===1-nél identitás (a raszterizálás + a szerkesztés érintetlen) */}
          <View style={[StyleSheet.absoluteFill, zoomStyle]} pointerEvents="box-none">
          {layers.map((raw0) => {
            // 🗂️ csoport-opacity: a réteg saját opacity-jére rászorozva (a worker-renderrel paritásban)
            const raw =
              raw0.groupId && doc.groups?.some((g) => g.id === raw0.groupId && (g.opacity ?? 1) < 1)
                ? ({ ...raw0, opacity: effectiveLayerOpacity(doc, raw0) } as ImageLayer)
                : raw0;
            const l = live?.id === raw.id ? withLive(raw, live.patch) : raw;
            const selected = !capturing && l.id === selectedId;
            if (l.kind === 'fill') {
              return <FillLayerView key={l.id} layer={l} box={fit} onSelect={() => onSelect(l.id)} />;
            }
            if (l.kind === 'photo') {
              return (
                <PhotoLayerView
                  key={l.id}
                  layer={l}
                  box={fit}
                  selected={selected}
                  onSelect={onSelect}
                  onMove={move}
                />
              );
            }
            if (l.kind === 'shape') {
              return (
                <ShapeOverlay
                  key={l.id}
                  clip={layerToShapeClip(l)}
                  box={fit}
                  editable
                  selected={selected}
                  onSelect={onSelect}
                  onMove={move}
                />
              );
            }
            // 🎚️ korrekció-réteg: teljes-vászon tint-közelítés a RAJZOLÁSI sorrendben (az alatta
            // lévőkre ül rá, a fölötte lévők föléje rajzolnak) — a render pontosan égeti (maszkkal is)
            if (l.kind === 'adjust') {
              const tints = [...gradeTint(l.grade), ...(l.adjust ? adjustTintLayers(l.adjust) : [])];
              if (!tints.length) {
                return null;
              }
              return (
                <View key={l.id} pointerEvents="none" style={StyleSheet.absoluteFill}>
                  {tints.map((tint, i) => (
                    <View key={i} style={[StyleSheet.absoluteFill, { backgroundColor: tint.color, opacity: tint.opacity }]} />
                  ))}
                </View>
              );
            }
            return (
              <TextOverlay
                key={l.id}
                clip={layerToTextClip(l)}
                t={0}
                box={fit}
                editable
                selected={selected}
                onSelect={onSelect}
                onMove={move}
                onEdit={onRequestEdit}
              />
            );
          })}

          {/* 🧲 smart-guide jelző-vonalak (a pattintott tengelyeken, rövid felvillanás) */}
          {!capturing && smartLines.map((ln, i) => (
            <View
              key={`sg${i}`}
              pointerEvents="none"
              style={
                ln.axis === 'x'
                  ? { position: 'absolute', left: ln.at * fit.w, top: 0, bottom: 0, width: 1, backgroundColor: '#ff2d95' }
                  : { position: 'absolute', top: ln.at * fit.h, left: 0, right: 0, height: 1, backgroundColor: '#ff2d95' }
              }
            />
          ))}

          {!capturing && zoom === 1 && !cropRect && !penPoints && !pathEditId && !lassoActive && !wandActive && !brushActive && selectedLayer && selectedLayer.kind !== 'fill' && selectedLayer.kind !== 'adjust' && !selectedLayer.hidden ? (
            <SelectionFrame
              layer={live?.id === selectedLayer.id ? withLive(selectedLayer, live.patch) : selectedLayer}
              box={fit}
              onLive={(patch) =>
                setLive(Object.keys(patch).length ? { id: selectedLayer.id, patch } : null)
              }
              onCommit={(patch) => {
                setLive(null);
                commit(updateLayer(doc, selectedLayer.id, patch), 'transform');
              }}
            />
          ) : null}

          {/* ✂️ kivágás-overlay (a kijelölés helyett) */}
          {!capturing && cropRect && onCropRectChange ? (
            <CropOverlay box={fit} rect={cropRect} onChange={onCropRectChange} />
          ) : null}

          {/* ✏️ toll-overlay (a kijelölés helyett) */}
          {!capturing && penPoints && onPenAddPoint && onPenClose ? (
            <PenOverlay box={fit} points={penPoints} onAddPoint={onPenAddPoint} onClosePath={onPenClose} />
          ) : null}

          {/* ✏️ node-szerkesztő overlay (toll v2 + v3 bezier) */}
          {!capturing && pathEditLive ? (
            <PathEditOverlay
              box={fit}
              layer={pathEditLive}
              selectedNode={selectedNode ?? null}
              onSelectNode={onSelectNode ?? (() => {})}
              onLive={onNodeLive}
              onCommit={onNodeCommit}
              onHandleLive={onHandleLive}
              onHandleCommit={onHandleCommit}
              onInsertNode={onInsertNode}
            />
          ) : null}

          {/* 🪢 lasszó-overlay (szabadkézi → zárt path) */}
          {!capturing && lassoActive && onLassoComplete && onLassoCancel ? (
            <LassoOverlay box={fit} onComplete={onLassoComplete} onCancel={onLassoCancel} />
          ) : null}

          {/* 🪄 varázspálca-overlay (fotóra koppintás → szín-szelekció) */}
          {!capturing && wandActive ? <WandOverlay box={fit} onTap={onWandTap} /> : null}

          {/* 🖌️ ecset-overlay (Skia raszter-festés) — lustán, Suspense-szel */}
          {!capturing && brushActive ? (
            <Suspense fallback={null}>
              <BrushOverlay ref={brushRef} box={fit} color={brushColor} size={brushSize} />
            </Suspense>
          ) : null}

          {/* 📐 statikus segédvonalak — mindig látszanak, ha vannak (a snap miatt) */}
          {!capturing && !guidesActive
            ? guides.map((g) => (
                <View
                  key={g.id}
                  pointerEvents="none"
                  style={
                    g.axis === 'x'
                      ? { position: 'absolute', left: g.pos * fit.w, top: 0, bottom: 0, width: 1, backgroundColor: '#00e5ff' }
                      : { position: 'absolute', top: g.pos * fit.h, left: 0, right: 0, height: 1, backgroundColor: '#00e5ff' }
                  }
                />
              ))
            : null}

          {/* 📐 vonalzók + szerkeszthető segédvonalak (guides-mód) */}
          {!capturing && guidesActive ? (
            <RulersOverlay
              box={fit}
              guides={displayGuides}
              onAddGuide={onAddGuide}
              onMoveGuide={(id, pos) => setLiveGuide({ id, pos })}
              onCommitGuide={onCommitGuide}
            />
          ) : null}
          </View>

          {/* 🔍 pan-overlay: zoom>1-nél a teljes vásznon ül → a gesztus a NÉZETET tolja (a szerkesztés
              szünetel, így a réteg-húzás koordináta-rendszere sértetlen marad) */}
          {!capturing && zoom !== 1 ? (
            <GestureDetector gesture={panGesture}>
              <View style={StyleSheet.absoluteFill} />
            </GestureDetector>
          ) : null}

          {/* 🔍 zoom-vezérlők (jobb-fönt): nagyítás / kicsinyítés / vissza 1:1-re.
              Kivágás közben rejtve: a vágókeret jobb-felső sarokfogóját takarnák (élő teszt K1) */}
          {!capturing && !cropRect ? (
            <View style={styles.zoomBar} pointerEvents="box-none">
              <Pressable style={styles.zoomBtn} onPress={() => applyZoom(1)} hitSlop={6} accessibilityLabel="zoom in">
                <Ionicons name="add" size={18} color={palette.text} />
              </Pressable>
              <Pressable style={styles.zoomBtn} onPress={() => applyZoom(-1)} hitSlop={6} accessibilityLabel="zoom out">
                <Ionicons name="remove" size={18} color={palette.text} />
              </Pressable>
              {zoom !== 1 ? (
                <Pressable style={styles.zoomBtn} onPress={resetZoom} hitSlop={6} accessibilityLabel="reset zoom">
                  <Ionicons name="scan-outline" size={15} color={palette.accent} />
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </View>
        </GestureDetector>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  canvas: {
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: '#0b0c12',
  },
  zoomBar: { position: 'absolute', top: 8, right: 8, gap: 6 },
  zoomBtn: {
    width: 34,
    height: 34,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: `${palette.surfaceHigh}ee`,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
