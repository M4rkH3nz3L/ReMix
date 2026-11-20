/**
 * 🖼️ A Kép Stúdió vászna (ImageCanvas) mögötti expo-mentes számítások: a vászon illesztése a
 * munkaterületre, a réteg-mozgatás pattintása (segédvonal → rács | okos segédvonalak), a
 * csoport-opacity, a varázspálca célrétege, a toll-pont rácsra pattintása és a node-szerkesztő
 * célformája.
 */
import { effectiveCanvas } from '@/lib/canvasPresets';
import { snapBoxToGrid, snapPointToGrid } from '@/lib/imageGrid';
import { effectiveLayerOpacity, visibleLayers } from '@/lib/imageDoc';
import { type LivePatch } from '@/lib/imageLayerClip';
import { canvasToLayerBox } from '@/lib/imageLayerGeometry';
import type { CanvasPoint } from '@/lib/penPath';
import { snapPointToGuides } from '@/lib/rulers';
import { snapToLayers, type LayerBox, type SnapLine } from '@/lib/smartGuides';
import { pathEditView } from '@/lib/vectorPath';
import type { ImageDoc, ImageLayer, PhotoLayer, ShapeLayer } from '@/types/project';

export const pointOf = (p: { x: number; y: number }): [number, number] => [p.x, p.y];

/** a vászon ennyit tölt ki a munkaterületből — körülötte látszik, ami kilóg */
export const CANVAS_FILL = 0.84;
/** a vásznon túl ennyi vászonnyira húzható egy réteg közepe */
export const MOVE_RANGE: [number, number] = [-1.5, 2.5];

export function withLive(layer: ImageLayer, patch: LivePatch): ImageLayer {
  return { ...layer, ...patch } as ImageLayer;
}

/** a vászon mérete a munkaterületen (px) a vászon-arány (`av`) szerint; mérés előtt 0×0 */
export function stageFit(container: { w: number; h: number }, av: number): { w: number; h: number } {
  return container.w > 0 && container.h > 0
    ? container.w / container.h > av
      ? { w: container.h * CANVAS_FILL * av, h: container.h * CANVAS_FILL }
      : { w: container.w * CANVAS_FILL, h: (container.w * CANVAS_FILL) / av }
    : { w: 0, h: 0 };
}

// 🧲 egy réteg igazodó-doboza (közép-pozíció + méret; a méret nélkülieké — pl. szöveg — 0)
export const layerBox = (l: ImageLayer, posOverride?: { x: number; y: number }): LayerBox => {
  const pos = posOverride ?? ('position' in l ? l.position : { x: 0.5, y: 0.5 });
  const w = 'w' in l && typeof l.w === 'number' ? l.w : 0;
  const h = 'h' in l && typeof l.h === 'number' ? l.h : 0;
  return { x: pos.x, y: pos.y, w, h };
};

/**
 * 📐 réteg-mozgatás pattintása: kézi vonalzó-guide-ok (ha vannak), MAJD rács vagy 🧲 smart-guides
 * (a többi réteghez + vászonhoz). `lines`: a smart-guide jelző-vonalak, ha az az ág futott —
 * különben null (nincs felvillanás).
 */
export function snapLayerMove(
  doc: ImageDoc,
  id: string,
  position: { x: number; y: number }
): { pos: { x: number; y: number }; lines: SnapLine[] | null } {
  let pos = position;
  let lines: SnapLine[] | null = null;
  const g = doc.guides?.length ? snapPointToGuides(pos, doc.guides) : null;
  if (g) {
    pos = { x: g.x, y: g.y };
  }
  const dragged = doc.layers.find((l) => l.id === id);
  // a bekapcsolt rács erősebb az okos segédvonalaknál: pontos, ismétlődő elhelyezéshez van
  if (doc.grid?.snap && dragged && dragged.kind !== 'fill' && dragged.kind !== 'adjust') {
    const { w, h } = layerBox(dragged, pos);
    pos = snapBoxToGrid(pos, { w, h }, doc.grid, effectiveCanvas(doc));
  } else if (dragged && dragged.kind !== 'fill' && dragged.kind !== 'adjust') {
    const others = visibleLayers(doc)
      .filter((l) => l.id !== id && l.kind !== 'fill' && l.kind !== 'adjust')
      .map((l) => layerBox(l));
    const snap = snapToLayers(layerBox(dragged, pos), others);
    pos = { x: snap.x, y: snap.y };
    lines = snap.lines;
  }
  return { pos, lines };
}

// 🗂️ csoport-opacity: a réteg saját opacity-jére rászorozva (a worker-renderrel paritásban)
export function withGroupOpacity(doc: ImageDoc, raw0: ImageLayer): ImageLayer {
  return raw0.groupId && effectiveLayerOpacity(doc, raw0) !== (raw0.opacity ?? 1)
    ? ({ ...raw0, opacity: effectiveLayerOpacity(doc, raw0) } as ImageLayer)
    : raw0;
}

// 🪄 varázspálca: a koppintás alatti LEGFELSŐ fotó-réteg + a dobozon belüli lokális (0–1) pont
export function wandHit(doc: ImageDoc, nx: number, ny: number): { layer: PhotoLayer; u: number; v: number } | null {
  const canvas = effectiveCanvas(doc);
  for (let i = doc.layers.length - 1; i >= 0; i--) {
    const l = doc.layers[i];
    if (l.kind !== 'photo' || l.hidden) continue;
    // I33: a réteg forgatása/tükrözése is számít
    const local = canvasToLayerBox({ x: nx, y: ny }, l, canvas);
    if (local.x >= 0 && local.x <= 1 && local.y >= 0 && local.y <= 1) {
      return { layer: l, u: local.x, v: local.y };
    }
  }
  return null;
}

/** ✏️ toll-pont a rácsra pattintva; a bezier-fogók a ponttal együtt tolódnak */
export function snapPenPoint(p: CanvasPoint, doc: ImageDoc) {
  const at = snapPointToGrid(p, doc.grid, effectiveCanvas(doc));
  const shift = (h: { x: number; y: number }) => ({ x: h.x + at.x - p.x, y: h.y + at.y - p.y });
  return { ...at, ...(p.h1 ? { h1: shift(p.h1) } : {}), ...(p.h2 ? { h2: shift(p.h2) } : {}) };
}

/** 🔲 S18: a 4-sarkos perspektíva mód célrétege — csak fotó */
export function cornerPinTarget(doc: ImageDoc, cornerPinId: string | null | undefined): PhotoLayer | null {
  const cornerPinFound = cornerPinId ? doc.layers.find((l) => l.id === cornerPinId) : undefined;
  return cornerPinFound?.kind === 'photo' ? cornerPinFound : null;
}

/**
 * ✏️ node-szerkesztő: a kijelölt path-forma (committed = a moveAnchor stabil alapja), a szerkesztett
 * gyűrű nézete és az élő-patchelt változat.
 */
export function resolvePathEdit(
  doc: ImageDoc,
  pathEditId: string | null | undefined,
  pathEditRing: number,
  live: { id: string; patch: LivePatch } | null
): { rawPathShape: ShapeLayer | null; pathEditShape: ShapeLayer | null; pathEditLive: ShapeLayer | null } {
  const rawPathEdit = pathEditId ? doc.layers.find((l) => l.id === pathEditId) ?? null : null;
  const rawPathShape = rawPathEdit && rawPathEdit.kind === 'shape' && rawPathEdit.shape === 'path' ? rawPathEdit : null;
  const pathEditShape = rawPathShape ? pathEditView(rawPathShape, pathEditRing) : null;
  // a dot-követéshez a vászon-rajzolással AZONOS élő-patchelt változat
  const pathEditLive =
    rawPathShape && live?.id === rawPathShape.id
      ? pathEditView(withLive(rawPathShape, live.patch) as ShapeLayer, pathEditRing)
      : pathEditShape;
  return { rawPathShape, pathEditShape, pathEditLive };
}
