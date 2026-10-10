import { Canvas, ImageFormat, Path, useCanvasRef } from '@shopify/react-native-skia';
import { Directory, File, Paths } from 'expo-file-system';
import { forwardRef, useImperativeHandle, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

export interface BrushHandle {
  /** a vászon pillanatképe PNG-fájlként (uri) vagy null */
  exportPng: () => string | null;
  hasStrokes: () => boolean;
}

interface Stroke {
  d: string;
  color: string;
  width: number;
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
      .onBegin((e) => {
        setCurrent({ d: `M${e.x.toFixed(1)},${e.y.toFixed(1)}`, color, width: size });
      })
      .onUpdate((e) => {
        setCurrent((c) => (c ? { ...c, d: `${c.d} L${e.x.toFixed(1)},${e.y.toFixed(1)}` } : c));
      })
      .onEnd(() => {
        setCurrent((c) => {
          if (c) {
            setStrokes((s) => [...s, c]);
          }
          return null;
        });
      });

    useImperativeHandle(
      ref,
      () => ({
        hasStrokes: () => strokes.length > 0,
        exportPng: () => {
          try {
            const img = canvasRef.current?.makeImageSnapshot();
            if (!img) {
              return null;
            }
            const bytes = img.encodeToBytes(ImageFormat.PNG);
            const dir = new Directory(Paths.document, 'media');
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
      [strokes, canvasRef]
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
