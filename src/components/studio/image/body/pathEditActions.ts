import { type Dispatch, type SetStateAction } from 'react';

import { updateLayer } from '@/lib/imageDoc';
import { pathEditTarget } from '@/lib/imageStudioOps';
import { deleteAnchor, type NodeType, pathEditPatch, reversePath, setNodeType } from '@/lib/vectorPath';
import type { ImageDoc, PathPoint, ShapeLayer } from '@/types/project';

export interface PathEditDeps {
  doc: ImageDoc | null;
  commit: (next: ImageDoc, label?: string) => void;
  pathEditId: string | null;
  pathEditRing: number;
  pathEditNode: number | null;
  setPathEditNode: Dispatch<SetStateAction<number | null>>;
}

/**
 * ✏️ Vektor-toll pont-szerkesztés: a szerkesztett path (gyűrűnként), nyitás/zárás, irány-fordítás,
 * node-típus, node-törlés. VISELKEDÉS-MEGŐRZŐ kiemelés az `ImageStudioBody`-ból, hook nélküli gyárként —
 * a címkék nyers technikai azonosítók (nem `t()`), mint eddig.
 */
export function createPathEditActions({ doc, commit, pathEditId, pathEditRing, pathEditNode, setPathEditNode }: PathEditDeps) {
  // ✏️ v3: a KIJELÖLT node típusa (görbe/sarok) — bezier-fogók létrehozása/törlése
  const { rawPathShape, pathEditShape, ringCount } = pathEditTarget(doc, pathEditId, pathEditRing);
  const writePath = (points: PathPoint[]) => pathEditPatch(rawPathShape ?? {}, pathEditRing, points);
  // nyitott útvonalnak vonal kell, különben láthatatlan volna
  const togglePathClosed = () => {
    if (doc && pathEditShape) {
      const closed = !pathEditShape.closed;
      commit(updateLayer<ShapeLayer>(doc, pathEditShape.id, { closed, strokeWidth: closed ? pathEditShape.strokeWidth : pathEditShape.strokeWidth ?? 0.9 }), 'path-closed');
    }
  };
  const reverseEditedPath = () => {
    if (doc && pathEditShape?.points) {
      commit(updateLayer<ShapeLayer>(doc, pathEditShape.id, writePath(reversePath(pathEditShape.points))), 'path-reverse');
      setPathEditNode(null);
    }
  };
  const setNodeKind = (type: NodeType) => {
    if (doc && pathEditShape?.points && pathEditNode != null) {
      commit(
        updateLayer(doc, pathEditShape.id, writePath(setNodeType(pathEditShape.points, pathEditNode, type, !!pathEditShape.closed))),
        `node-${type}`
      );
    }
  };
  // ✏️ v4: a kijelölt node törlése (legalább 2 pont marad)
  const deleteNode = () => {
    if (doc && pathEditShape?.points && pathEditNode != null && pathEditShape.points.length > 2) {
      commit(
        updateLayer(doc, pathEditShape.id, writePath(deleteAnchor(pathEditShape.points, pathEditNode))),
        'node-delete'
      );
      setPathEditNode(null);
    }
  };
  return { pathEditShape, ringCount, togglePathClosed, reverseEditedPath, setNodeKind, deleteNode };
}
