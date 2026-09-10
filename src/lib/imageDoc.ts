import { t as tr } from 'i18next';

import type { AspectRatio, ImageDoc, ImageLayer } from '@/types/project';

/**
 * 🎨 Kép-dokumentum (Creative Canvas V1) — pure réteg-műveletek.
 *
 * A `layers` tömb ALULRÓL FÖLFELÉ áll: a 0. elem van leghátul, az utolsó
 * legelöl. A UI fordítva mutatja (a felső réteg legyen fölül a listában), de a
 * TÁROLÁS marad rajzolási sorrendben — így a rasterizáló egyszerűen végigmegy
 * rajta, és nem kell két helyen fejben tartani a sorrendet.
 *
 * Minden művelet ÚJ dokumentumot ad vissza; a hívó a command-rétegen keresztül
 * teszi be, tehát az undo automatikusan működik.
 */

export function createImageDoc(
  name: string,
  aspectRatio: AspectRatio,
  makeId: () => string
): ImageDoc {
  return {
    id: makeId(),
    name,
    aspectRatio,
    // induláskor egy sötét háttér, hogy a vászon ne legyen áttetsző-üres
    layers: [
      {
        kind: 'fill',
        id: makeId(),
        name: tr('lib.imageDoc.defaultBackgroundName'),
        fill: '#12121a',
      },
    ],
  };
}

/** új réteg LEGFELÜLRE (a felhasználó azt várja, hogy amit hozzáad, azt látja) */
export function addLayer(doc: ImageDoc, layer: ImageLayer): ImageDoc {
  return { ...doc, layers: [...doc.layers, layer], renderedUri: undefined };
}

export function removeLayer(doc: ImageDoc, id: string): ImageDoc {
  const layers = doc.layers.filter((l) => l.id !== id);
  if (layers.length === doc.layers.length) {
    return doc;
  }
  return { ...doc, layers, renderedUri: undefined };
}

export function updateLayer(
  doc: ImageDoc,
  id: string,
  patch: Partial<ImageLayer>
): ImageDoc {
  let changed = false;
  const layers = doc.layers.map((l) => {
    if (l.id !== id) {
      return l;
    }
    changed = true;
    return { ...l, ...patch } as ImageLayer;
  });
  return changed ? { ...doc, layers, renderedUri: undefined } : doc;
}

/**
 * Réteg mozgatása a rajzolási sorrendben. `delta > 0` = előrébb (fölfelé a
 * kompozitban). A szélen álló réteg mozgatása no-op — nem hiba.
 */
export function reorderLayer(doc: ImageDoc, id: string, delta: number): ImageDoc {
  const from = doc.layers.findIndex((l) => l.id === id);
  if (from < 0) {
    return doc;
  }
  const to = Math.min(doc.layers.length - 1, Math.max(0, from + delta));
  if (to === from) {
    return doc;
  }
  const layers = [...doc.layers];
  const [moved] = layers.splice(from, 1);
  layers.splice(to, 0, moved);
  return { ...doc, layers, renderedUri: undefined };
}

export function toggleLayerHidden(doc: ImageDoc, id: string): ImageDoc {
  const layer = doc.layers.find((l) => l.id === id);
  return layer ? updateLayer(doc, id, { hidden: !layer.hidden }) : doc;
}

/** másolat KÖZVETLENÜL az eredeti fölé, hogy látható legyen az eredmény */
export function duplicateLayer(
  doc: ImageDoc,
  id: string,
  makeId: () => string
): ImageDoc {
  const index = doc.layers.findIndex((l) => l.id === id);
  if (index < 0) {
    return doc;
  }
  const copy = { ...doc.layers[index], id: makeId() } as ImageLayer;
  const layers = [...doc.layers];
  layers.splice(index + 1, 0, copy);
  return { ...doc, layers, renderedUri: undefined };
}

/** amit a rasterizáló ténylegesen kirajzol (rejtett és teljesen átlátszó nélkül) */
export function visibleLayers(doc: ImageDoc): ImageLayer[] {
  return doc.layers.filter((l) => !l.hidden && (l.opacity ?? 1) > 0.001);
}

/** a réteglista címkéje — a felhasználó adta név, vagy a tartalomból képzett */
export function layerLabel(layer: ImageLayer): string {
  if (layer.name) {
    return layer.name;
  }
  switch (layer.kind) {
    case 'fill':
      return layer.fillGradient
        ? tr('lib.imageDoc.layerLabelGradientBackground')
        : tr('lib.imageDoc.layerLabelColorBackground');
    case 'photo':
      return tr('lib.imageDoc.layerLabelPhoto');
    case 'text':
      return layer.text.trim().slice(0, 24) || tr('lib.imageDoc.layerLabelText');
    case 'shape':
      return layer.imageUri
        ? tr('lib.imageDoc.layerLabelLogoImage')
        : layer.shape === 'path'
          ? tr('lib.imageDoc.layerLabelDrawing')
          : tr('lib.imageDoc.layerLabelShape', { shape: layer.shape });
  }
}

/** a réteg ikonja a listában */
export function layerIcon(layer: ImageLayer): string {
  switch (layer.kind) {
    case 'fill':
      return '🎨';
    case 'photo':
      return '🖼️';
    case 'text':
      return '🅰️';
    case 'shape':
      return layer.imageUri ? '🏷️' : layer.shape === 'path' ? '✏️' : '⬛';
  }
}

/**
 * A dokumentum által hivatkozott médiafájlok — a renderhez ezeket kell
 * feltölteni, és a relink is ezeken megy majd végig.
 */
export function docMediaUris(doc: ImageDoc): string[] {
  const out: string[] = [];
  for (const l of doc.layers) {
    if (l.kind === 'photo') {
      out.push(l.uri);
    } else if (l.kind === 'shape' && l.imageUri) {
      out.push(l.imageUri);
    }
  }
  return [...new Set(out)];
}
