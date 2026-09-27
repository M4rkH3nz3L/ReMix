import type { ShapeClip, ShapeLayer, TextClip, TextLayer } from '@/types/project';

/**
 * 🎯 Élő transzformáció-patch a kijelölő-keretről (méret/forgatás/betűméret). A
 * gesztus ALATT a vászon ezzel a réteggel FELÜLÍROTT változatot rajzol (nem
 * szemeteli a history-t), és csak a gesztus VÉGÉN kerül be egyetlen undo-lépésként.
 */
export interface LivePatch {
  w?: number;
  h?: number;
  rotation?: number;
  fontSize?: number;
}

/**
 * 🎨 Kép-réteg → klip adapter.
 *
 * A forma- és szöveg-RÉTEGEK szerkezetileg AZONOSAK a ShapeClip/TextClip
 * megjelenés-mezőivel (csak az idő-mezők nélkül). Ez az adapter egy „idő nélküli"
 * klipet ad vissza, hogy a Kép Stúdió vászna PONTOSAN ugyanazzal a
 * `ShapeOverlay` / `TextOverlay` komponenssel rajzolja a rétegeket, mint az
 * idővonal előnézete — így amit a vásznon látsz, azt látod a beégetett képben is
 * (render-paritás), és nem kell külön rajzoló-motor.
 *
 * A `start`/`duration` fix 0/1: a statikus kép-rétegnek nincs ideje. Az
 * animációt/kulcskockát szándékosan elhagyjuk (a kép nem animált).
 */
export function layerToShapeClip(layer: ShapeLayer): ShapeClip {
  return { ...layer, kind: 'shape', start: 0, duration: 1 } as ShapeClip;
}

export function layerToTextClip(layer: TextLayer): TextClip {
  return { ...layer, kind: 'text', start: 0, duration: 1, animation: 'none' } as TextClip;
}
