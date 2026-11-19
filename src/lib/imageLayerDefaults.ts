import type { CanvasPoint } from '@/lib/penPath';
import type { ClipMask, ImageLayer, PhotoLayer, ShapeLayer } from '@/types/project';

/**
 * 🧱 A Kép Stúdió új rétegeinek alapértékei (pure, expo-mentes). VISELKEDÉS-MEGŐRZŐ kiemelés az
 * `ImageStudioBody`-ból: pontosan ugyanazok a méretek, színek és mezők, mint a body-ban voltak —
 * a hívó adja az id-t (és a fordított feliratot), így a mag tesztelhető.
 */

/** új réteg a sávról (szöveg / kitöltés / korrekció; minden más egy alap-téglalap forma) */
export function defaultLayer(kind: ImageLayer['kind'], id: string, newText: string): ImageLayer {
  return kind === 'text'
    ? {
        kind: 'text',
        id,
        text: newText,
        color: '#ffffff',
        backgroundColor: null,
        fontSize: 9,
        fontWeight: 'bold',
        // saját font: a rendszer-font az előnézetben és az exportban eltérő lenne
        fontFamily: 'Poppins',
        position: { x: 0.5, y: 0.5 },
        stylePreset: 'outline',
      }
    : kind === 'fill'
      ? { kind: 'fill', id, fill: '#12121a' }
      : kind === 'adjust'
        ? { kind: 'adjust', id, adjust: {} }
        : {
            kind: 'shape',
            id,
            shape: 'rectangle',
            position: { x: 0.5, y: 0.5 },
            w: 0.4,
            h: 0.24,
            fill: '#ff2d95',
            cornerRadius: 0.12,
          };
}

// 🔷 a KIVÁLASZTOTT formatípus (nem csak téglalap) — alap-méret + fill
export function defaultShapeLayer(shape: Exclude<ShapeLayer['shape'], 'path'>, id: string): ShapeLayer {
  const base = { kind: 'shape' as const, id, position: { x: 0.5, y: 0.5 }, fill: '#ff2d95' };
  return shape === 'line'
    ? ({ ...base, shape: 'line', w: 0.6, h: 0.02, fill: '#ffffff', strokeWidth: 0.012 } as ShapeLayer)
    : shape === 'rectangle'
      ? ({ ...base, shape: 'rectangle', w: 0.4, h: 0.28, cornerRadius: 0.12 } as ShapeLayer)
      : ({ ...base, shape, w: 0.4, h: 0.4, ...(shape === 'polygon' ? { sides: 6 } : {}) } as ShapeLayer);
}

/** galériából / forrás-mappából érkező kép: középre, 0,7 × 0,5-ös dobozba, kitöltéssel */
export function centeredPhotoLayer(id: string, uri: string, assetId?: string): PhotoLayer {
  return {
    kind: 'photo',
    id,
    uri,
    ...(assetId !== undefined ? { assetId } : {}),
    position: { x: 0.5, y: 0.5 },
    w: 0.7,
    h: 0.5,
    fit: 'cover',
  };
}

/** 🖌️ az ecset-festés pillanatképe: a teljes vásznat lefedő festett fotó-réteg */
export function paintedPhotoLayer(id: string, uri: string): PhotoLayer {
  return {
    kind: 'photo',
    id,
    uri,
    paint: true,
    position: { x: 0.5, y: 0.5 },
    w: 1,
    h: 1,
    fit: 'contain',
  };
}

/** 🪄 a varázspálca körvonala ZÁRT path-formaként a fotó dobozán (féligátlátszó kiemelés) */
export function wandHighlightShape(id: string, outline: CanvasPoint[], source: PhotoLayer): ShapeLayer {
  return {
    kind: 'shape',
    id,
    shape: 'path',
    points: outline,
    closed: true,
    position: source.position,
    w: source.w,
    h: source.h,
    rotation: source.rotation,
    flipH: source.flipH,
    flipV: source.flipV,
    fill: '#7c5cff',
    opacity: 0.5,
  };
}

/** festett (kép-alapú) maszk, ami a teljes vásznat lefedi — az ecset és a háttér-eltávolítás adja */
export function fullCanvasImageMask(image: string): ClipMask {
  return { shape: 'rectangle', x: 0.5, y: 0.5, w: 1, h: 1, feather: 0, image };
}

/** 🎭 szelekció → maszk (poligon): a vászon-normalizált pontok + bbox (legalább 0,02 széles/magas) */
export function lassoPolygonMask(points: { x: number; y: number }[]): ClipMask {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    shape: 'polygon',
    points: points.map((p) => ({ x: p.x, y: p.y })),
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2,
    w: Math.max(0.02, maxX - minX),
    h: Math.max(0.02, maxY - minY),
    feather: 0.02,
  };
}
