import { Canvas, ImageFormat, PaintStyle, Path, Skia, StrokeCap, StrokeJoin, useCanvasRef } from '@shopify/react-native-skia';
import { File } from 'expo-file-system';
import { forwardRef, useImperativeHandle, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { projectMediaDir } from '@/lib/projectFolderClient';

export interface BrushHandle {
  /** a vonások PNG-fájlként (uri) DOKUMENTUM-felbontáson, vagy null */
  exportPng: (docWidth: number, docHeight: number) => string | null;
  hasStrokes: () => boolean;
}

export interface Stroke {
  d: string;
  color: string;
  width: number;
}

/** A vonások offscreen raszterizálása a dokumentum felbontásán (null = nincs GPU-felület). */
export function renderStrokes(strokes: Stroke[], box: { w: number; h: number }, width: number, height: number) {
  const surface = Skia.Surface.MakeOffscreen(Math.round(width), Math.round(height));
  if (!surface) {
    return null;
  }
  const canvas = surface.getCanvas();
  canvas.scale(width / box.w, height / box.h);
  for (const s of strokes) {
    const path = Skia.Path.MakeFromSVGString(s.d);
    if (!path) {
      continue;
    }
    const paint = Skia.Paint();
    paint.setColor(Skia.Color(s.color));
    paint.setStyle(PaintStyle.Stroke);
    paint.setStrokeWidth(s.width);
    paint.setStrokeCap(StrokeCap.Round);
    paint.setStrokeJoin(StrokeJoin.Round);
    paint.setAntiAlias(true);
    canvas.drawPath(path, paint);
  }
  surface.flush();
  return surface.makeImageSnapshot();
}

/**
 * 🖌️ Ecset-overlay (Skia) — szabadkézi RASZTER-festés a vásznon: a húzás mentén
 * SVG-path ecsetvonások (szín + méret), Skia `Canvas`-ban renderelve. A „Kész"
 * a vászon pillanatképét PNG-fájlba menti (a Skia snapshot → `encodeToBytes`),
 * amit a szülő FOTÓ-rétegként tesz a dokumentumra (render-paritás: a worker a
 * PNG-t kompozitálja). Skia a meglévő dev-buildben van → JS-reload elég.
 */
export const BrushOverlay = forwardRef<BrushHandle, { box: { w: number; h: number }; color: string; size: number }>(
  function BrushOverlay({ box, color, size }, ref) {
    const canvasRef = useCanvasRef();
    const [strokes, setStrokes] = useState<Stroke[]>([]);
    const [current, setCurrent] = useState<Stroke | null>(null);

    const pan = Gesture.Pan()
      .runOnJS(true)
      .minDistance(0)
      .maxPointers(1)
      .onBegin((e) => {
        setCurrent({ d: `M${e.x.toFixed(1)},${e.y.toFixed(1)}`, color, width: size });
      })
      .onUpdate((e) => {
        setCurrent((c) => (c ? { ...c, d: `${c.d} L${e.x.toFixed(1)},${e.y.toFixed(1)}` } : c));
      })
      .onFinalize((_e, success) => {
        // a megszakított vonás (második ujj = zoom) nem marad a rajzon
        setCurrent((c) => {
          if (c && success) {
            setStrokes((s) => [...s, c]);
          }
          return null;
        });
      });

    useImperativeHandle(
      ref,
      () => ({
        hasStrokes: () => strokes.length > 0,
        exportPng: (docWidth, docHeight) => {
          try {
            // 🖼️ I19: a vonásokat a dokumentum méretén rajzoljuk újra (vektorból) — a
            // képernyő-pillanatkép a nagy exportban elmosódna
            const img = renderStrokes(strokes, box, docWidth, docHeight) ?? canvasRef.current?.makeImageSnapshot();
            if (!img) {
              return null;
            }
            const bytes = img.encodeToBytes(ImageFormat.PNG);
            const dir = projectMediaDir();
            if (!dir.exists) {
              dir.create();
            }
            const file = new File(dir, `brush_${Date.now().toString(36)}.png`);
            file.write(bytes);
            return file.uri;
          } catch {
            return null;
          }
        },
      }),
      [strokes, canvasRef, box]
    );

    const all = current ? [...strokes, current] : strokes;

    return (
      <GestureDetector gesture={pan}>
        <View style={StyleSheet.absoluteFill}>
          <Canvas ref={canvasRef} style={{ width: box.w, height: box.h }}>
            {all.map((s, i) => (
              <Path
                key={i}
                path={s.d}
                color={s.color}
                style="stroke"
                strokeWidth={s.width}
                strokeCap="round"
                strokeJoin="round"
              />
            ))}
          </Canvas>
        </View>
      </GestureDetector>
    );
  }
);
