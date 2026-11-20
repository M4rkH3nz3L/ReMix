import { effectiveCanvas } from '@/lib/canvasPresets';
import { updateLayer } from '@/lib/imageDoc';
import { snapPointToGrid } from '@/lib/imageGrid';
import { type LivePatch } from '@/lib/imageLayerClip';
import { canvasToLayerBox, layerBoxToCanvas, renormalizePathLayer } from '@/lib/imageLayerGeometry';
import { dragHandle, type HandleId, insertAnchor, moveAnchor, nearestOnPath, nodeType, pathEditPatch } from '@/lib/vectorPath';
import type { ImageDoc, PathPoint, ShapeLayer } from '@/types/project';

/**
 * ✏️ A node-szerkesztő (toll v2–v4) műveletei — hook nélküli gyár: a horgonypont / bezier-fogó
 * élő húzása (setLive) és rögzítése, új node az élre koppintva. Minden rögzítés a commit-on
 * (command bus, undo) megy, a címkék: 'node', 'handle', 'node-insert'.
 */
export function createPathEditActions({
  doc,
  commit,
  setLive,
  rawPathShape,
  pathEditShape,
  pathEditRing,
}: {
  doc: ImageDoc;
  commit: (next: ImageDoc, label?: string) => void;
  setLive: (live: { id: string; patch: LivePatch } | null) => void;
  rawPathShape: ShapeLayer | null;
  pathEditShape: ShapeLayer | null;
  pathEditRing: number;
}) {
  const livePath = (points: PathPoint[]) => setLive({ id: rawPathShape!.id, patch: pathEditPatch(rawPathShape!, pathEditRing, points) });
  const onNodeLive = (index: number, x: number, y: number) => {
    if (!pathEditShape?.points) return;
    livePath(moveAnchor(pathEditShape.points, index, x, y));
  };
  // I28: a dobozon kívülre húzott pont után a réteg doboza a formához igazodik
  const commitPath = (points: PathPoint[], label: string) => {
    if (!pathEditShape || !rawPathShape) return;
    if (rawPathShape.subpaths?.length) {
      commit(updateLayer(doc, rawPathShape.id, pathEditPatch(rawPathShape, pathEditRing, points)), label);
      return;
    }
    const next = renormalizePathLayer({ ...pathEditShape, points }, effectiveCanvas(doc));
    const { points: pts, position, w, h } = next;
    commit(updateLayer(doc, pathEditShape.id, { points: pts, position, w, h }), label);
  };
  const onNodeCommit = (index: number, x: number, y: number) => {
    if (!pathEditShape?.points) return;
    setLive(null);
    const size = effectiveCanvas(doc);
    const snapped = canvasToLayerBox(snapPointToGrid(layerBoxToCanvas({ x, y }, pathEditShape, size), doc.grid, size), pathEditShape, size);
    commitPath(moveAnchor(pathEditShape.points, index, snapped.x, snapped.y), 'node');
  };
  // ✏️ v3: bezier-fogó húzása — I27: a node SAJÁT típusa szerint (a smooth/broken megmarad)
  const onHandleLive = (index: number, handle: HandleId, x: number, y: number) => {
    if (!pathEditShape?.points) return;
    const mode = nodeType(pathEditShape.points[index]);
    livePath(dragHandle(pathEditShape.points, index, handle, x, y, mode));
  };
  const onHandleCommit = (index: number, handle: HandleId, x: number, y: number) => {
    if (!pathEditShape?.points) return;
    setLive(null);
    commitPath(dragHandle(pathEditShape.points, index, handle, x, y, nodeType(pathEditShape.points[index])), 'handle');
  };
  // ✏️ v4: koppintás a path-ÉLRE → új node (csak ha elég közel a vonalhoz)
  const onInsertNode = (x: number, y: number) => {
    if (!pathEditShape?.points) return;
    const hit = nearestOnPath(pathEditShape.points, !!pathEditShape.closed, x, y);
    if (!hit || hit.dist > 0.05) return;
    commit(updateLayer(doc, pathEditShape.id, pathEditPatch(rawPathShape ?? {}, pathEditRing, insertAnchor(pathEditShape.points, x, y, !!pathEditShape.closed))), 'node-insert');
  };
  return { onNodeLive, onNodeCommit, onHandleLive, onHandleCommit, onInsertNode };
}

export type PathEditActions = ReturnType<typeof createPathEditActions>;
