import { useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { palette } from '@/constants/editor';
import { type CropCorner, type CropRect, moveCropRect, resizeCropCorner } from '@/lib/imageCrop';

/**
 * ✂️ Kivágás-overlay a vásznon — a kivágás-téglalap húzással mozgatható, a 4
 * sarokkal méretezhető (a szemközti sarok fix); kívül sötétítő maszk + harmadoló
 * segédvonalak. A `rect` vezérelt (a szülő tartja), a gesztus `onChange`-dzsel
 * frissít; az „Alkalmaz" a szülőben hívja a `cropImageDoc`-ot (egy undo-lépés).
 *
 * Gesztus: modern react-native-gesture-handler (Touch/03). A body + 4 sarok
 * `Gesture.Pan`-je EGYSZER jön létre (stabil handler), a friss `rect/box/onChange`-t
 * a `dataRef`-ből olvassa, a gesztus kezdetén a `startRef`-be rögzíti a rect-et, és
 * `e.translationX/Y`-ból számol (= a korábbi `g.dx/dy`). A sarok-fogók a keret FÖLÖTT
 * renderelődnek → az átfedésben a sarok-húzás győz a mozgatás ellen. A crop-on kívüli
 * érintést a gyökér-View nyeli el (a dim-sávok `pointerEvents="none"`, a rétegek
 * testvérek → nem mozdulnak). `runOnJS(true)`: a callbackek a JS-szálon (setState).
 */
export function CropOverlay({
  box,
  rect,
  onChange,
}: {
  box: { w: number; h: number };
  rect: CropRect;
  onChange: (rect: CropRect) => void;
}) {
  const dataRef = useRef({ rect, box, onChange });
  dataRef.current = { rect, box, onChange };
  const startRef = useRef<CropRect>(rect);

  const g = useRef<{
    body: ReturnType<typeof Gesture.Pan>;
    corners: Record<CropCorner, ReturnType<typeof Gesture.Pan>>;
  } | null>(null);
  if (!g.current) {
    const makeCorner = (corner: CropCorner) =>
      Gesture.Pan()
        .runOnJS(true)
        .onStart(() => {
          startRef.current = dataRef.current.rect;
        })
        .onUpdate((e) => {
          const d = dataRef.current;
          d.onChange(resizeCropCorner(startRef.current, corner, e.translationX / d.box.w, e.translationY / d.box.h));
        });
    g.current = {
      body: Gesture.Pan()
        .runOnJS(true)
        .onStart(() => {
          startRef.current = dataRef.current.rect;
        })
        .onUpdate((e) => {
          const d = dataRef.current;
          d.onChange(moveCropRect(startRef.current, e.translationX / d.box.w, e.translationY / d.box.h));
        }),
      corners: { tl: makeCorner('tl'), tr: makeCorner('tr'), bl: makeCorner('bl'), br: makeCorner('br') },
    };
  }
  const { body, corners } = g.current;

  const cx = rect.x * box.w;
  const cy = rect.y * box.h;
  const cw = rect.w * box.w;
  const ch = rect.h * box.h;

  return (
    <View style={StyleSheet.absoluteFill}>
      {/* sötétítő maszk a kivágáson kívül (4 sáv) */}
      <View pointerEvents="none" style={[styles.dim, { left: 0, top: 0, width: box.w, height: cy }]} />
      <View
        pointerEvents="none"
        style={[styles.dim, { left: 0, top: cy + ch, width: box.w, height: Math.max(0, box.h - (cy + ch)) }]}
      />
      <View pointerEvents="none" style={[styles.dim, { left: 0, top: cy, width: cx, height: ch }]} />
      <View
        pointerEvents="none"
        style={[styles.dim, { left: cx + cw, top: cy, width: Math.max(0, box.w - (cx + cw)), height: ch }]}
      />

      {/* a kivágás-keret + mozgató-terület + harmadoló vonalak */}
      <GestureDetector gesture={body}>
        <View style={[styles.cropBox, { left: cx, top: cy, width: cw, height: ch }]}>
          <View pointerEvents="none" style={[styles.thirdV, { left: cw / 3 }]} />
          <View pointerEvents="none" style={[styles.thirdV, { left: (2 * cw) / 3 }]} />
          <View pointerEvents="none" style={[styles.thirdH, { top: ch / 3 }]} />
          <View pointerEvents="none" style={[styles.thirdH, { top: (2 * ch) / 3 }]} />
        </View>
      </GestureDetector>

      {/* 4 sarok-fogó (a keret fölött, hogy a sarok-húzás győzzön a mozgatás ellen) */}
      <GestureDetector gesture={corners.tl}>
        <View style={[styles.handle, { left: cx - 18, top: cy - 18 }]}>
          <View style={[styles.mark, styles.mTL]} />
        </View>
      </GestureDetector>
      <GestureDetector gesture={corners.tr}>
        <View style={[styles.handle, { left: cx + cw - 18, top: cy - 18 }]}>
          <View style={[styles.mark, styles.mTR]} />
        </View>
      </GestureDetector>
      <GestureDetector gesture={corners.bl}>
        <View style={[styles.handle, { left: cx - 18, top: cy + ch - 18 }]}>
          <View style={[styles.mark, styles.mBL]} />
        </View>
      </GestureDetector>
      <GestureDetector gesture={corners.br}>
        <View style={[styles.handle, { left: cx + cw - 18, top: cy + ch - 18 }]}>
          <View style={[styles.mark, styles.mBR]} />
        </View>
      </GestureDetector>
    </View>
  );
}

const EDGE = 22;
const styles = StyleSheet.create({
  dim: { position: 'absolute', backgroundColor: 'rgba(0,0,0,0.6)' },
  cropBox: {
    position: 'absolute',
    borderWidth: 1.5,
    borderColor: '#ffffff',
  },
  thirdV: { position: 'absolute', top: 0, bottom: 0, width: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.35)' },
  thirdH: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.35)' },
  handle: { position: 'absolute', width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  mark: { position: 'absolute', width: EDGE, height: EDGE, borderColor: palette.accent },
  mTL: { borderTopWidth: 4, borderLeftWidth: 4, top: 7, left: 7 },
  mTR: { borderTopWidth: 4, borderRightWidth: 4, top: 7, right: 7 },
  mBL: { borderBottomWidth: 4, borderLeftWidth: 4, bottom: 7, left: 7 },
  mBR: { borderBottomWidth: 4, borderRightWidth: 4, bottom: 7, right: 7 },
});
