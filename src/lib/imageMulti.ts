import { effectiveCanvas } from '@/lib/canvasPresets';
import { duplicateLayer, removeLayer, visibleLayers } from '@/lib/imageDoc';
import type { ImageDoc, ImageLayer } from '@/types/project';

/** 🖐️ Réteg az ujj alatt és több réteg együtt (pure). A pozíció a vászon arányában értendő. */
export interface LayerBounds {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
}

/** a szöveg szélessége a szöveg hosszából becsülhető, a pontos mérés csak a nézetben van meg */
const TEXT_WIDTH_PER_CHAR = 0.6;
const TEXT_LINE = 1.3;

export function layerBounds(layer: ImageLayer, canvas: { width: number; height: number }): LayerBounds | null {
  if (!('position' in layer)) {
    return null;
  }
  const rotation = (layer as { rotation?: number }).rotation ?? 0;
  const { x, y } = layer.position;
  if (layer.kind === 'text') {
    const fontPx = ((layer.fontSize ?? 8) / 100) * canvas.height;
    const lines = layer.text.split('\n');
    const longest = Math.max(...lines.map((l) => l.length));
    return { x, y, w: (longest * fontPx * TEXT_WIDTH_PER_CHAR) / canvas.width, h: (lines.length * fontPx * TEXT_LINE) / canvas.height, rotation };
  }
  const { w, h } = layer as { w?: number; h?: number };
  return w && h ? { x, y, w, h, rotation } : null;
}

/** A felső réteg a pont alatt; a háttér, a korrekció és a zárolt réteg nem számít. */
export function layerAtPoint(doc: ImageDoc, x: number, y: number): ImageLayer | null {
  const canvas = effectiveCanvas(doc);
  const layers = visibleLayers(doc);
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i];
    const b = layerBounds(layer, canvas);
    if (!b || layer.locked) {
      continue;
    }
    // a réteg saját, forgatatlan rendszerébe pixelben számolva: a vászon nem feltétlen négyzet
    const rad = (-b.rotation * Math.PI) / 180;
    const [dx, dy] = [(x - b.x) * canvas.width, (y - b.y) * canvas.height];
    const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
    const ly = dx * Math.sin(rad) + dy * Math.cos(rad);
    if (Math.abs(lx) <= (b.w * canvas.width) / 2 && Math.abs(ly) <= (b.h * canvas.height) / 2) {
      return layer;
    }
  }
  return null;
}

/** A munkaterület pontja a vászon arányában; a vászon középre áll, a nézet a közepe körül nagyít. */
export function stageToCanvas(
  x: number,
  y: number,
  stage: { w: number; h: number },
  box: { w: number; h: number },
  view: { translateX: number; translateY: number; scale: number }
): { x: number; y: number } {
  return {
    x: 0.5 + (x - stage.w / 2 - view.translateX) / (box.w * view.scale),
    y: 0.5 + (y - stage.h / 2 - view.translateY) / (box.h * view.scale),
  };
}

export const toggleId = (ids: string[], id: string): string[] =>
  ids.includes(id) ? ids.filter((v) => v !== id) : [...ids, id];

export const removeLayers = (doc: ImageDoc, ids: string[]): ImageDoc => ids.reduce(removeLayer, doc);

export const duplicateLayers = (doc: ImageDoc, ids: string[], makeId: () => string): ImageDoc =>
  ids.reduce((d, id) => duplicateLayer(d, id, makeId), doc);
