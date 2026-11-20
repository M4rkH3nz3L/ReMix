import { StyleSheet, View } from 'react-native';

import { palette } from '@/constants/editor';
import { layerBounds } from '@/lib/imageMulti';
import { type SnapLine } from '@/lib/smartGuides';
import type { ImageDoc } from '@/types/project';

/** a munkaterület színe */
export const PASTEBOARD = '#14161d';
/** a vászon körüli fátyol kiterjedése (px) — legkisebb nagyításnál is takarnia kell */
const VEIL = 6000;

/** több réteg kijelölése: ezek körvonala látszik */
export function MultiSelectOutlines({
  multiIds,
  doc,
  docCanvas,
  fit,
  zoom,
}: {
  multiIds?: string[];
  doc: ImageDoc;
  docCanvas: { width: number; height: number };
  fit: { w: number; h: number };
  zoom: number;
}) {
  return (
    <>
      {multiIds?.map((id) => {
        const layer = doc.layers.find((l) => l.id === id);
        const b = layer ? layerBounds(layer, docCanvas) : null;
        return b ? (
          <View
            key={id}
            pointerEvents="none"
            style={[
              styles.multiOutline,
              { left: (b.x - b.w / 2) * fit.w, top: (b.y - b.h / 2) * fit.h, width: b.w * fit.w, height: b.h * fit.h, transform: [{ rotate: `${b.rotation}deg` }], borderWidth: 2 / zoom },
            ]}
          />
        ) : null;
      })}
    </>
  );
}

/** a vásznon kívüli rész halványan látszik; a fátyol nem fogja el az érintést */
export function PasteboardVeil({ zoom }: { zoom: number }) {
  return (
    <>
      <View pointerEvents="none" style={[styles.veil, { left: -VEIL, right: -VEIL, top: -VEIL, height: VEIL }]} />
      <View pointerEvents="none" style={[styles.veil, { left: -VEIL, right: -VEIL, bottom: -VEIL, height: VEIL }]} />
      <View pointerEvents="none" style={[styles.veil, { left: -VEIL, width: VEIL, top: 0, bottom: 0 }]} />
      <View pointerEvents="none" style={[styles.veil, { right: -VEIL, width: VEIL, top: 0, bottom: 0 }]} />
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.canvasEdge, { borderWidth: 1 / zoom }]} />
    </>
  );
}

/** 🧲 smart-guide jelző-vonalak (a pattintott tengelyeken, rövid felvillanás) */
export function SmartGuideMarks({ lines, fit }: { lines: SnapLine[]; fit: { w: number; h: number } }) {
  return (
    <>
      {lines.map((ln, i) => (
        <View
          key={`sg${i}`}
          pointerEvents="none"
          style={
            ln.axis === 'x'
              ? { position: 'absolute', left: ln.at * fit.w, top: 0, bottom: 0, width: 1, backgroundColor: '#ff2d95' }
              : { position: 'absolute', top: ln.at * fit.h, left: 0, right: 0, height: 1, backgroundColor: '#ff2d95' }
          }
        />
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  multiOutline: { position: 'absolute', borderColor: palette.accent },
  veil: { position: 'absolute', backgroundColor: `${PASTEBOARD}a6` },
  canvasEdge: { borderColor: palette.border },
});
