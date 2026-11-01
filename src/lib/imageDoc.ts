import { t as tr } from 'i18next';

import { shiftMask } from '@/lib/imageSelectionOps';
import type { AspectRatio, ImageDoc, ImageGroup, ImageLayer, PhotoLayer } from '@/types/project';

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

/** 🎨 induló háttér: konkrét szín (hex), vagy `'transparent'` (alfa, nincs fill-réteg). */
export type ImageDocBackground = string | 'transparent';

export function createImageDoc(
  name: string,
  aspectRatio: AspectRatio,
  makeId: () => string,
  opts?: {
    width?: number;
    height?: number;
    background?: ImageDocBackground;
    format?: 'raster' | 'vector';
  }
): ImageDoc {
  const bg = opts?.background;
  return {
    id: makeId(),
    name,
    aspectRatio,
    ...(opts?.width ? { width: Math.round(opts.width) } : {}),
    ...(opts?.height ? { height: Math.round(opts.height) } : {}),
    ...(opts?.format ? { format: opts.format } : {}),
    // Háttér: a megadott szín, egyébként az alap sötét (hogy a vászon ne legyen
    // áttetsző-üres). `'transparent'` → NINCS fill-réteg → alfás (PNG) kimenet.
    layers:
      bg === 'transparent'
        ? []
        : [
            {
              kind: 'fill',
              id: makeId(),
              name: tr('lib.imageDoc.defaultBackgroundName'),
              fill: bg || '#12121a',
            },
          ],
  };
}

/** új réteg LEGFELÜLRE (a felhasználó azt várja, hogy amit hozzáad, azt látja) */
export function addLayer(doc: ImageDoc, layer: ImageLayer): ImageDoc {
  return { ...doc, layers: [...doc.layers, layer], renderedUri: undefined };
}

/**
 * 🎨 A vászon HÁTTERE = a legalsó (0.) réteg, ha az `fill`. `docBackground` ezt
 * olvassa ki (szín vagy `'transparent'`, ha nincs háttér-fill), `setBackground`
 * pedig beállítja: szín → a meglévő háttér-fillt átfesti vagy újat szúr legalulra;
 * `'transparent'` → a háttér-fillt eltávolítja (alfás kimenet). A rajz-rétegek
 * érintetlenek maradnak.
 */
export function docBackground(doc: ImageDoc): ImageDocBackground {
  const bottom = doc.layers[0];
  return bottom && bottom.kind === 'fill' ? bottom.fill : 'transparent';
}

export function setBackground(
  doc: ImageDoc,
  background: ImageDocBackground,
  makeId: () => string
): ImageDoc {
  const bottom = doc.layers[0];
  const hasBgFill = !!bottom && bottom.kind === 'fill';
  if (background === 'transparent') {
    return hasBgFill
      ? { ...doc, layers: doc.layers.slice(1), renderedUri: undefined }
      : doc;
  }
  if (hasBgFill) {
    const layers = doc.layers.map((l, i) =>
      i === 0 && l.kind === 'fill'
        ? { ...l, fill: background, fillGradient: undefined, gradient: undefined }
        : l
    );
    return { ...doc, layers, renderedUri: undefined };
  }
  const fill: ImageLayer = {
    kind: 'fill',
    id: makeId(),
    name: tr('lib.imageDoc.defaultBackgroundName'),
    fill: background,
  };
  return { ...doc, layers: [fill, ...doc.layers], renderedUri: undefined };
}

export function removeLayer(doc: ImageDoc, id: string): ImageDoc {
  // a zárolt réteg nem törölhető (előbb fel kell oldani)
  const layers = doc.layers.filter((l) => l.id !== id || l.locked);
  if (layers.length === doc.layers.length) {
    return doc;
  }
  return { ...doc, layers, renderedUri: undefined };
}

/**
 * Egy réteg mezőinek módosítása.
 *
 * ⚠️ A `patch` típusa SZÁNDÉKOSAN generikus. A naiv `Partial<ImageLayer>` a
 * unió fölött disztributál (`Partial<FillLayer> | Partial<PhotoLayer> | …`),
 * ezért egyetlen konkrét patch — pl. `{ fontSize: 12 }` — sem illeszkedett rá,
 * és a hívóknak `as never`-t kellett írniuk. A generikus paraméter viszont a
 * hívás helyén MÁR SZŰKÍTETT rétegtípusból következtethető, így a patch valódi
 * típusellenőrzést kap az assertion helyett.
 */
/** Mozgatásnál a réteg maszkjai vele mennek, ha a módosítás nem ír saját maszkot. */
function followMasks(layer: ImageLayer, patch: Partial<ImageLayer>): Partial<PhotoLayer> {
  const from = (layer as { position?: { x: number; y: number } }).position;
  const to = (patch as { position?: { x: number; y: number } }).position;
  const { mask, localAdjust } = layer as PhotoLayer;
  if (!from || !to || (from.x === to.x && from.y === to.y) || 'mask' in patch) {
    return {};
  }
  const [dx, dy] = [to.x - from.x, to.y - from.y];
  return {
    ...(mask ? { mask: shiftMask(mask, dx, dy) } : {}),
    ...(localAdjust?.mask ? { localAdjust: { ...localAdjust, mask: shiftMask(localAdjust.mask, dx, dy) } } : {}),
  };
}

export function updateLayer<L extends ImageLayer = ImageLayer>(
  doc: ImageDoc,
  id: string,
  patch: Partial<L>
): ImageDoc {
  let changed = false;
  const layers = doc.layers.map((l) => {
    if (l.id !== id) {
      return l;
    }
    changed = true;
    return { ...l, ...followMasks(l, patch), ...patch } as ImageLayer;
  });
  return changed ? { ...doc, layers, renderedUri: undefined } : doc;
}

/**
 * Réteg mozgatása a rajzolási sorrendben. `delta > 0` = előrébb (fölfelé a
 * kompozitban). A szélen álló réteg mozgatása no-op — nem hiba.
 */
export function reorderLayer(doc: ImageDoc, id: string, delta: number): ImageDoc {
  const from = doc.layers.findIndex((l) => l.id === id);
  return from < 0 ? doc : moveLayerTo(doc, id, from + delta);
}

/**
 * A réteg áthelyezése a `to` indexre úgy, hogy a csoportok egyben maradjanak: a tag a saját
 * csoportján belül mozog, a kívülálló pedig átugorja a csoportot, nem kerül a tagok közé.
 */
export function moveLayerTo(doc: ImageDoc, id: string, to: number): ImageDoc {
  const from = doc.layers.findIndex((l) => l.id === id);
  if (from < 0) {
    return doc;
  }
  const moved = doc.layers[from];
  const rest = doc.layers.filter((l) => l.id !== id);
  let at = Math.max(0, Math.min(rest.length, to));
  if (moved.groupId) {
    const idx = rest.flatMap((l, i) => (l.groupId === moved.groupId ? [i] : []));
    if (idx.length > 0) {
      at = Math.max(idx[0], Math.min(idx[idx.length - 1] + 1, at));
    }
  } else {
    const below = rest[at - 1]?.groupId;
    if (below && below === rest[at]?.groupId) {
      const idx = rest.flatMap((l, i) => (l.groupId === below ? [i] : []));
      at = to > from ? idx[idx.length - 1] + 1 : idx[0];
    }
  }
  if (at === from) {
    return doc;
  }
  const layers = [...rest];
  layers.splice(at, 0, moved);
  return { ...doc, layers, renderedUri: undefined };
}

export function toggleLayerLocked(doc: ImageDoc, id: string): ImageDoc {
  const layer = doc.layers.find((l) => l.id === id);
  return layer ? updateLayer(doc, id, { locked: !layer.locked }) : doc;
}

export function toggleLayerHidden(doc: ImageDoc, id: string): ImageDoc {
  const layer = doc.layers.find((l) => l.id === id);
  return layer ? updateLayer(doc, id, { hidden: !layer.hidden }) : doc;
}

// ── 🗂️ Réteg-csoportok (mappák) — lapos groupId-modell ──────────────────────

/** egy csoport tagjait összefüggő blokká rendezi az ELSŐ tag helyén (a relatív
 *  sorrendet megőrzi) — így a panel egymás mellett mutatja, a z-rend értelmes. */
function placeContiguous(layers: ImageLayer[], groupId: string): ImageLayer[] {
  const members = layers.filter((l) => l.groupId === groupId);
  if (members.length < 2) {
    return layers;
  }
  const rest = layers.filter((l) => l.groupId !== groupId);
  const firstIdx = layers.findIndex((l) => l.groupId === groupId);
  const before = layers.slice(0, firstIdx).filter((l) => l.groupId !== groupId).length;
  return [...rest.slice(0, before), ...members, ...rest.slice(before)];
}

/** Új csoport létrehozása a megadott rétegekből (a tagok összefüggő blokkba kerülnek). */
export function createGroup(doc: ImageDoc, layerIds: string[], id: string, name: string): ImageDoc {
  const ids = new Set(layerIds.filter((lid) => doc.layers.some((l) => l.id === lid)));
  if (ids.size === 0) {
    return doc;
  }
  const group: ImageGroup = { id, name };
  let layers = doc.layers.map((l) => (ids.has(l.id) ? ({ ...l, groupId: id } as ImageLayer) : l));
  layers = placeContiguous(layers, id);
  return { ...doc, layers, groups: [...(doc.groups ?? []), group], renderedUri: undefined };
}

/** Egy réteg csoportba tétele (vagy kivétele, ha `groupId` null/undefined). */
export function assignLayerToGroup(doc: ImageDoc, layerId: string, groupId: string | undefined): ImageDoc {
  if (!doc.layers.some((l) => l.id === layerId)) {
    return doc;
  }
  let layers = doc.layers.map((l) => (l.id === layerId ? ({ ...l, groupId } as ImageLayer) : l));
  if (groupId) {
    layers = placeContiguous(layers, groupId);
  }
  return { ...doc, layers, renderedUri: undefined };
}

/** Csoport feloldása: a tagok groupId-ja törlődik, a csoport-rekord eltűnik. */
export function ungroup(doc: ImageDoc, groupId: string): ImageDoc {
  const layers = doc.layers.map((l) =>
    l.groupId === groupId ? ({ ...l, groupId: undefined } as ImageLayer) : l
  );
  return { ...doc, layers, groups: (doc.groups ?? []).filter((g) => g.id !== groupId), renderedUri: undefined };
}

/** Csoport-mezők módosítása (név/rejtés/összecsukás/opacity). */
export function updateGroup(doc: ImageDoc, groupId: string, patch: Partial<ImageGroup>): ImageDoc {
  const groups = (doc.groups ?? []).map((g) => (g.id === groupId ? { ...g, ...patch } : g));
  return { ...doc, groups, renderedUri: undefined };
}

/** Egy csoport tag-rétegei (a lapos `layers`-ben). */
export function groupMembers(doc: ImageDoc, groupId: string): ImageLayer[] {
  return doc.layers.filter((l) => l.groupId === groupId);
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
  // 🗂️ a rejtett csoport tagjai sem látszanak (a worker `isVisible && !groupHidden`-jével paritásban)
  const hiddenGroups = new Set((doc.groups ?? []).filter((g) => g.hidden).map((g) => g.id));
  return doc.layers.filter(
    (l) => !l.hidden && (l.opacity ?? 1) > 0.001 && !(l.groupId && hiddenGroups.has(l.groupId))
  );
}

/** 🗂️ egy réteg EFFEKTÍV áttetszősége a preview-hoz = saját opacity × a csoportja opacity-je. */
export function effectiveLayerOpacity(doc: ImageDoc, layer: ImageLayer): number {
  const own = layer.opacity ?? 1;
  const g = layer.groupId ? (doc.groups ?? []).find((gr) => gr.id === layer.groupId) : undefined;
  return own * (g?.opacity ?? 1);
}

/**
 * A sorok feliratai: az azonos nevűek sorszámot kapnak alulról felfelé („Fotó", „Fotó 2"),
 * hogy a listában megkülönböztethetők legyenek. A felhasználó adta név érintetlen.
 */
export function layerRowLabels(doc: ImageDoc): Map<string, string> {
  const seen = new Map<string, number>();
  const out = new Map<string, string>();
  for (const l of doc.layers) {
    const base = layerLabel(l);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    out.set(l.id, n > 1 && !l.name ? `${base} ${n}` : base);
  }
  return out;
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
    case 'adjust':
      return tr('lib.imageDoc.layerLabelAdjust', { defaultValue: 'Korrekció' });
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
    case 'adjust':
      return '🎚️';
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
      if (l.lut) {
        out.push(l.lut); // 🎞️ saját .cube LUT — a renderhez fel kell tölteni
      }
    } else if (l.kind === 'shape' && l.imageUri) {
      out.push(l.imageUri);
    }
  }
  return [...new Set(out)];
}
