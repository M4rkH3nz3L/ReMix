import { useRef } from 'react';
import { PanResponder, type PanResponderInstance, StyleSheet, View } from 'react-native';

import { palette } from '@/constants/editor';
import { type CropCorner, type CropRect, moveCropRect, resizeCropCorner } from '@/lib/imageCrop';

/**
 * ✂️ Kivágás-overlay a vásznon — a kivágás-téglalap húzással mozgatható, a 4
 * sarokkal méretezhető (a szemközti sarok fix); kívül sötétítő maszk + harmadoló
 * segédvonalak. A `rect` vezérelt (a szülő tartja), a gesztus `onChange`-dzsel
 * frissít; az „Alkalmaz" a szülőben hívja a `cropImageDoc`-ot (egy undo-lépés).
 *
 * A gesztus-kezelők a `dataRef`/`startRef`-ből olvasnak (a PanResponder EGYSZER
 * jön létre) — ugyanaz a minta, mint a SelectionFrame-ben.
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

  const resp = useRef<{
    swallow: PanResponderInstance;
    body: PanResponderInstance;
    corners: Record<CropCorner, PanResponderInstance>;
  } | null>(null);

  if (!resp.current) {
    const makeCorner = (corner: CropCorner) =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          startRef.current = dataRef.current.rect;
        },
        onPanResponderMove: (_e, g) => {
          const d = dataRef.current;
          d.onChange(resizeCropCorner(startRef.current, corner, g.dx / d.box.w, g.dy / d.box.h));
        },
      });
    resp.current = {
      // a téglalapon kívüli érintést elnyeli (ne mozduljanak a rétegek crop közben).
      // CSAK start-on nyel: a move-kérés ellopná a sarok/test-gesztust (RN termination)
      swallow: PanResponder.create({
        onStartShouldSetPanResponder: () => true,
      }),
      body: PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          startRef.current = dataRef.current.rect;
        },
        onPanResponderMove: (_e, g) => {
          const d = dataRef.current;
          d.onChange(moveCropRect(startRef.current, g.dx / d.box.w, g.dy / d.box.h));
        },
      }),
      corners: { tl: makeCorner('tl'), tr: makeCorner('tr'), bl: makeCorner('bl'), br: makeCorner('br') },
    };
  }
  const { swallow, body, corners } = resp.current;

  const cx = rect.x * box.w;
  const cy = rect.y * box.h;
  const cw = rect.w * box.w;
  const ch = rect.h * box.h;

  return (
    <View style={StyleSheet.absoluteFill} {...swallow.panHandlers}>
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
      <View style={[styles.cropBox, { left: cx, top: cy, width: cw, height: ch }]} {...body.panHandlers}>
        <View pointerEvents="none" style={[styles.thirdV, { left: cw / 3 }]} />
        <View pointerEvents="none" style={[styles.thirdV, { left: (2 * cw) / 3 }]} />
        <View pointerEvents="none" style={[styles.thirdH, { top: ch / 3 }]} />
        <View pointerEvents="none" style={[styles.thirdH, { top: (2 * ch) / 3 }]} />
      </View>

      {/* 4 sarok-fogó (a keret fölött, hogy a sarok-húzás győzzön a mozgatás ellen) */}
      <View style={[styles.handle, { left: cx - 18, top: cy - 18 }]} {...corners.tl.panHandlers}>
        <View style={[styles.mark, styles.mTL]} />
      </View>
      <View style={[styles.handle, { left: cx + cw - 18, top: cy - 18 }]} {...corners.tr.panHandlers}>
        <View style={[styles.mark, styles.mTR]} />
      </View>
      <View style={[styles.handle, { left: cx - 18, top: cy + ch - 18 }]} {...corners.bl.panHandlers}>
        <View style={[styles.mark, styles.mBL]} />
      </View>
      <View style={[styles.handle, { left: cx + cw - 18, top: cy + ch - 18 }]} {...corners.br.panHandlers}>
        <View style={[styles.mark, styles.mBR]} />
      </View>
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
