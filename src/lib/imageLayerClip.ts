import type { PathPoint, ShapeClip, ShapeLayer, TextClip, TextLayer } from '@/types/project';

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
  /** sarokfogós méretezésnél a szemközti sarok áll, így a közép is mozog */
  position?: { x: number; y: number };
  /** ✏️ path node-húzás élő előnézete (a toll v2 node-szerkesztője) */
  points?: PathPoint[];
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

/** A szöveg réteg-effektjei a szöveg saját stílusává alakítva (em-arányban), az előnézethez. */
export function textEffectStyle(layer: TextLayer, canvas: { width: number; height: number }): TextLayer['textStyle'] {
  const fontPx = ((layer.fontSize ?? 8) / 100) * canvas.height;
  const shadow = layer.dropShadow ? (typeof layer.dropShadow === 'object' ? layer.dropShadow : {}) : null;
  const glow = layer.outerGlow ? (typeof layer.outerGlow === 'object' ? layer.outerGlow : {}) : null;
  const stroke = layer.stroke ? { color: layer.stroke.color, width: (2 * layer.stroke.width * canvas.width) / fontPx } : null;
  if (!shadow && !glow && !stroke) {
    return layer.textStyle;
  }
  return {
    ...layer.textStyle,
    ...(stroke ? { stroke } : {}),
    ...(shadow
      ? {
          shadow: {
            color: shadow.color ?? '#00000080',
            dx: ((shadow.dx ?? 0.02) * canvas.width) / fontPx,
            dy: ((shadow.dy ?? 0.02) * canvas.height) / fontPx,
            blur: ((shadow.blur ?? 0.012) * canvas.width * 2) / fontPx,
          },
        }
      : {}),
    ...(glow ? { glow: { color: glow.color ?? '#7c5cff', size: ((glow.size ?? 0.02) * canvas.width * 2) / fontPx } } : {}),
  };
}

export function layerToTextClip(layer: TextLayer): TextClip {
  return { ...layer, kind: 'text', start: 0, duration: 1, animation: 'none' } as TextClip;
}
