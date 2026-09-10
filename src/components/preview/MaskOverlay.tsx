import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';

import { palette } from '@/constants/editor';
import { maskBox, moveMask, moveVertex, resizeMask } from '@/lib/maskEdit';
import type { ClipMask } from '@/types/project';

const HANDLE = 26;

/**
 * ✂️ Maszk-fogantyúk a vásznon.
 *
 * A maszkot eddig csak számmezőkkel lehetett állítani — ez a réteg vékony:
 * a geometria a `maskEdit.ts`-ben van (tesztelve), itt csak a gesztus és a
 * kirajzolás. Csak akkor jelenik meg, ha a Szűrők panelen bekapcsoltad a
 * maszk-szerkesztést, hogy ne fogja el a vászon többi gesztusát.
 *
 * A húzás közben nincs élő-előnézet: minden mozdulat végén commitolunk, mert
 * a maszk a KLIPRE megy (undo-lépés), és a köztes állapotokkal teleszemetelnénk
 * a history-t.
 */
export function MaskOverlay({
  mask,
  box,
  onChange,
}: {
  mask: ClipMask;
  box: { w: number; h: number };
  onChange: (next: ClipMask) => void;
}) {
  const b = maskBox(mask);
  const left = (b.x - b.w / 2) * box.w;
  const top = (b.y - b.h / 2) * box.h;
  const width = b.w * box.w;
  const height = b.h * box.h;

  const commitMove = (dx: number, dy: number) => {
    onChange(moveMask(mask, dx / Math.max(1, box.w), dy / Math.max(1, box.h)));
  };
  const commitResize = (dw: number, dh: number) => {
    // a fogantyú a jobb-alsó sarkon van, a maszk viszont a KÖZÉPPONTJA körül
    // nő — ezért a sarok-elmozdulás kétszerese a méret-változás
    onChange(
      resizeMask(mask, (dw * 2) / Math.max(1, box.w), (dh * 2) / Math.max(1, box.h))
    );
  };
  const commitVertex = (index: number, px: number, py: number) => {
    onChange(moveVertex(mask, index, px / Math.max(1, box.w), py / Math.max(1, box.h)));
  };

  const movePan = Gesture.Pan().onEnd((e) => {
    runOnJS(commitMove)(e.translationX, e.translationY);
  });
  const resizePan = Gesture.Pan().onEnd((e) => {
    runOnJS(commitResize)(e.translationX, e.translationY);
  });

  const points = mask.shape === 'polygon' ? (mask.points ?? []) : [];

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <GestureDetector gesture={movePan}>
        <View
          style={[
            styles.frame,
            {
              left,
              top,
              width,
              height,
              borderRadius: mask.shape === 'ellipse' ? Math.min(width, height) / 2 : 6,
            },
          ]}
        />
      </GestureDetector>

      {/* jobb-alsó sarok: méretezés */}
      <GestureDetector gesture={resizePan}>
        <View
          style={[
            styles.handle,
            { left: left + width - HANDLE / 2, top: top + height - HANDLE / 2 },
          ]}
        >
          <View style={styles.handleDot} />
        </View>
      </GestureDetector>

      {/* poligon-csúcsok: egyenként húzhatók */}
      {points.map((p, i) => {
        const vertexPan = Gesture.Pan().onEnd((e) => {
          runOnJS(commitVertex)(
            i,
            p.x * box.w + e.translationX,
            p.y * box.h + e.translationY
          );
        });
        return (
          <GestureDetector key={i} gesture={vertexPan}>
            <View
              style={[
                styles.handle,
                { left: p.x * box.w - HANDLE / 2, top: p.y * box.h - HANDLE / 2 },
              ]}
            >
              <View style={[styles.handleDot, styles.vertexDot]} />
            </View>
          </GestureDetector>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: palette.accent,
    borderStyle: 'dashed',
    backgroundColor: `${palette.accent}14`,
  },
  handle: {
    position: 'absolute',
    width: HANDLE,
    height: HANDLE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  handleDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: palette.accent,
    borderWidth: 2,
    borderColor: '#fff',
  },
  vertexDot: {
    backgroundColor: palette.accent2,
    width: 12,
    height: 12,
    borderRadius: 6,
  },
});
