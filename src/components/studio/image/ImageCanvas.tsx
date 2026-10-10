import { type Ref, useState } from 'react';
import { type LayoutChangeEvent, StyleSheet, View } from 'react-native';

import { ShapeOverlay } from '@/components/preview/ShapeOverlay';
import { TextOverlay } from '@/components/preview/TextOverlay';
import { CropOverlay } from '@/components/studio/image/CropOverlay';
import { FillLayerView } from '@/components/studio/image/FillLayerView';
import { LassoOverlay } from '@/components/studio/image/LassoOverlay';
import { PathEditOverlay } from '@/components/studio/image/PathEditOverlay';
import { PenOverlay } from '@/components/studio/image/PenOverlay';
import { PhotoLayerView } from '@/components/studio/image/PhotoLayerView';
import { SelectionFrame } from '@/components/studio/image/SelectionFrame';
import { aspectValue, palette } from '@/constants/editor';
import type { CropRect } from '@/lib/imageCrop';
import { updateLayer, visibleLayers } from '@/lib/imageDoc';
import { layerToShapeClip, layerToTextClip, type LivePatch } from '@/lib/imageLayerClip';
import type { CanvasPoint } from '@/lib/penPath';
import { dragHandle, type HandleId, moveAnchor } from '@/lib/vectorPath';
import type { ImageDoc, ImageLayer, ShapeLayer } from '@/types/project';

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
}) {
  const [container, setContainer] = useState({ w: 0, h: 0 });
  const [live, setLive] = useState<{ id: string; patch: LivePatch } | null>(null);

  // a szabad W×H a mérvadó (kép-editor); különben a 3-arányos enum
  const av = doc.width && doc.height ? doc.width / doc.height : aspectValue(doc.aspectRatio);
  const fit =
    container.w > 0 && container.h > 0
      ? container.w / container.h > av
        ? { w: container.h * av, h: container.h }
        : { w: container.w, h: container.w / av }
      : { w: 0, h: 0 };

  const move = (id: string, position: { x: number; y: number }) =>
    commit(updateLayer(doc, id, { position }), 'move');

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

  return (
    <View
      style={styles.stage}
      onLayout={(e: LayoutChangeEvent) =>
        setContainer({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })
      }
    >
      {fit.w > 0 ? (
        <View ref={canvasRef} style={[styles.canvas, { width: fit.w, height: fit.h }]}>
          {layers.map((raw) => {
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

          {!capturing && !cropRect && !penPoints && !pathEditId && !lassoActive && selectedLayer && selectedLayer.kind !== 'fill' && !selectedLayer.hidden ? (
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
            />
          ) : null}

          {/* 🪢 lasszó-overlay (szabadkézi → zárt path) */}
          {!capturing && lassoActive && onLassoComplete && onLassoCancel ? (
            <LassoOverlay box={fit} onComplete={onLassoComplete} onCancel={onLassoCancel} />
          ) : null}
        </View>
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
});
