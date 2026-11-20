import { CornerPinOverlay } from '@/components/studio/image/CornerPinOverlay';
import { CropOverlay } from '@/components/studio/image/CropOverlay';
import { PathEditOverlay } from '@/components/studio/image/PathEditOverlay';
import { PenOverlay } from '@/components/studio/image/PenOverlay';
import { SelectionFrame } from '@/components/studio/image/SelectionFrame';
import { type PathEditActions } from '@/components/studio/image/canvas/pathEditActions';
import { snapPenPoint, withLive } from '@/lib/imageCanvasStage';
import type { CropRect } from '@/lib/imageCrop';
import { updateLayer } from '@/lib/imageDoc';
import { type LivePatch } from '@/lib/imageLayerClip';
import type { CanvasPoint } from '@/lib/penPath';
import type { ImageDoc, ImageLayer, PhotoLayer, ShapeLayer } from '@/types/project';

/**
 * ✍️ A geometria-szerkesztő overlay-ek a vásznon, rajzolási sorrendben: kijelölő-keret
 * (méret/forgatás), kivágás, toll, 4-sarkos perspektíva, node-szerkesztő. Az élő húzás a
 * `setLive`-on, a rögzítés a commit-on (command bus, undo) megy.
 */
export function EditOverlays({
  capturing,
  doc,
  fit,
  zoom,
  docCanvas,
  live,
  setLive,
  commit,
  selectedLayer,
  cropRect,
  onCropRectChange,
  cropAspect,
  penPoints,
  onPenAddPoint,
  onPenClose,
  pathEditId,
  cornerPinId,
  marquee,
  lassoActive,
  wandActive,
  brushActive,
  cornerPinLayer,
  pathEditLive,
  selectedNode,
  onSelectNode,
  pathEdit,
}: {
  capturing?: boolean;
  doc: ImageDoc;
  fit: { w: number; h: number };
  zoom: number;
  docCanvas: { width: number; height: number };
  live: { id: string; patch: LivePatch } | null;
  setLive: (live: { id: string; patch: LivePatch } | null) => void;
  commit: (next: ImageDoc, label?: string) => void;
  selectedLayer: ImageLayer | null;
  cropRect?: CropRect | null;
  onCropRectChange?: (rect: CropRect) => void;
  cropAspect?: number | null;
  penPoints?: CanvasPoint[] | null;
  onPenAddPoint?: (p: CanvasPoint) => void;
  onPenClose?: () => void;
  pathEditId?: string | null;
  cornerPinId?: string | null;
  marquee?: 'rect' | 'ellipse' | null;
  lassoActive?: boolean;
  wandActive?: boolean;
  brushActive?: boolean;
  cornerPinLayer: PhotoLayer | null;
  pathEditLive: ShapeLayer | null;
  selectedNode?: number | null;
  onSelectNode?: (index: number) => void;
  pathEdit: PathEditActions;
}) {
  const { onNodeLive, onNodeCommit, onHandleLive, onHandleCommit, onInsertNode } = pathEdit;
  return (
    <>
      {!capturing && !cropRect && !penPoints && !pathEditId && !cornerPinId && !marquee && !lassoActive && !wandActive && !brushActive && selectedLayer && selectedLayer.kind !== 'fill' && selectedLayer.kind !== 'adjust' && !selectedLayer.hidden && !selectedLayer.locked ? (
        <SelectionFrame
          layer={live?.id === selectedLayer.id ? withLive(selectedLayer, live.patch) : selectedLayer}
          box={fit}
          zoom={zoom}
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
        <CropOverlay box={fit} zoom={zoom} aspect={cropAspect} rect={cropRect} onChange={onCropRectChange} />
      ) : null}

      {/* ✏️ toll-overlay (a kijelölés helyett) */}
      {!capturing && penPoints && onPenAddPoint && onPenClose ? (
        <PenOverlay
          box={fit}
          points={penPoints}
          onAddPoint={(p) => {
            onPenAddPoint(snapPenPoint(p, doc));
          }}
          onClosePath={onPenClose}
        />
      ) : null}

      {/* 🔲 S18: 4-sarkos perspektíva fogói */}
      {!capturing && cornerPinLayer ? (
        <CornerPinOverlay
          layer={live?.id === cornerPinLayer.id ? (withLive(cornerPinLayer, live.patch) as PhotoLayer) : cornerPinLayer}
          box={fit}
          canvas={docCanvas}
          zoom={zoom}
          onLive={(corners) => setLive({ id: cornerPinLayer.id, patch: { corners } })}
          onCommit={(corners) => {
            setLive(null);
            commit(updateLayer<PhotoLayer>(doc, cornerPinLayer.id, { corners }), 'corner-pin');
          }}
        />
      ) : null}

      {/* ✏️ node-szerkesztő overlay (toll v2 + v3 bezier) */}
      {!capturing && pathEditLive ? (
        <PathEditOverlay
          box={fit}
          zoom={zoom}
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
    </>
  );
}
