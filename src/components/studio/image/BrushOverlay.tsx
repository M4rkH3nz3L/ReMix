import {
  BlendMode,
  Canvas,
  ClipOp,
  createPicture,
  ImageFormat,
  PaintStyle,
  Picture,
  Skia,
  type SkCanvas,
  type SkImage,
  StrokeCap,
  StrokeJoin,
  TileMode,
  useImage,
} from '@shopify/react-native-skia';
import { File } from 'expo-file-system';
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { PixelRatio, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import {
  type BrushPoint,
  type BrushSettings,
  EMPTY_HISTORY,
  hardnessSigma,
  pressureOf,
  pushStroke,
  redoStroke,
  stabilize,
  type Stroke,
  strokeSegments,
  undoStroke,
} from '@/lib/brushEngine';
import { selectionSkPath } from '@/components/studio/image/selectionPath';
import { projectMediaDir } from '@/lib/projectFolderClient';
import type { Selection } from '@/lib/selection';
import { logCaught } from '@/lib/logCaught';

export type { Stroke } from '@/lib/brushEngine';

export interface BrushHandle {
  /** a festés PNG-fájlként (uri) DOKUMENTUM-felbontáson, vagy null */
  exportPng: (docWidth: number, docHeight: number) => string | null;
  hasStrokes: () => boolean;
  undo: () => void;
  redo: () => void;
  /** kész vonás hozzáadása gesztus nélkül (eszköz-füstteszt) */
  addStroke: (stroke: Stroke) => void;
}

/**
 * A vonások rajza: egy rétegbe kerül a teljes vonás, így az átlátszóság és a lágy szél egyszer
 * hat (önmagát keresztezve sem sötétedik), a radír pedig a réteget lyukasztja az alatta lévőbe.
 * Az előnézet és az export is ezt hívja, ezért nem térhetnek el.
 */
export function drawStrokes(canvas: SkCanvas, strokes: Stroke[], w: number, h: number, clip?: Selection | null) {
  canvas.save();
  if (clip) {
    canvas.clipPath(selectionSkPath(clip.ops, w, h, clip.invert), ClipOp.Intersect, true);
  }
  for (const s of strokes) {
    const layer = Skia.Paint();
    layer.setAlphaf(s.opacity);
    if (s.eraser) {
      layer.setBlendMode(BlendMode.DstOut);
    }
    const sigma = hardnessSigma(s.width * w, s.hardness);
    if (sigma > 0) {
      layer.setImageFilter(Skia.ImageFilter.MakeBlur(sigma, sigma, TileMode.Decal, null));
    }
    canvas.saveLayer(layer);
    const paint = Skia.Paint();
    paint.setColor(Skia.Color(s.eraser ? '#000000' : s.color));
    paint.setStyle(PaintStyle.Stroke);
    paint.setStrokeCap(StrokeCap.Round);
    paint.setStrokeJoin(StrokeJoin.Round);
    paint.setAntiAlias(true);
    for (const seg of strokeSegments(s)) {
      paint.setStrokeWidth(seg.width * w);
      canvas.drawLine(seg.x1 * w, seg.y1 * h, seg.x2 * w, seg.y2 * h, paint);
    }
    canvas.restore();
  }
  canvas.restore();
}

/** A vonások offscreen raszterizálása adott felbontáson, opcionálisan egy meglévő festésre (null = nincs GPU-felület). */
export function renderStrokes(strokes: Stroke[], width: number, height: number, base?: SkImage | null, clip?: Selection | null) {
  const surface = Skia.Surface.MakeOffscreen(Math.round(width), Math.round(height));
  if (!surface) {
    return null;
  }
  const canvas = surface.getCanvas();
  if (base) {
    canvas.drawImageRect(base, Skia.XYWHRect(0, 0, base.width(), base.height()), Skia.XYWHRect(0, 0, width, height), Skia.Paint());
  }
  drawStrokes(canvas, strokes, width, height, clip);
  surface.flush();
  return surface.makeImageSnapshot();
}

/**
 * 🖌️ Ecset-overlay (Skia) — szabadkézi RASZTER-festés a vásznon. A kész vonások egy képbe sülnek
 * (hosszú festésnél sem lassul), csak az aktuális rajzolódik újra mozgásonként. A „Kész" a vonásokat
 * a dokumentum felbontásán rajzolja PNG-be, amit a szülő FOTÓ-rétegként tesz a dokumentumra
 * (render-paritás: a worker a PNG-t kompozitálja). Meglévő festett rétegnél `baseUri` a kiindulás,
 * így a radír azt is törli.
 */
export const BrushOverlay = forwardRef<
  BrushHandle,
  { box: { w: number; h: number }; settings: BrushSettings; baseUri?: string | null; onHistory?: (canUndo: boolean, canRedo: boolean) => void; gestureTestId?: string; clip?: Selection | null }
>(function BrushOverlay({ box, settings, baseUri, onHistory, gestureTestId = 'brush-pan', clip }, ref) {
  const base = useImage(baseUri ?? null);
  const [history, setHistory] = useState(EMPTY_HISTORY);
  const [current, setCurrent] = useState<Stroke | null>(null);
  const last = useRef<BrushPoint | null>(null);

  useEffect(() => {
    onHistory?.(history.done.length > 0, history.undone.length > 0);
  }, [history, onHistory]);

  const point = (e: { x: number; y: number; stylusData?: { pressure: number } }): BrushPoint => ({
    x: e.x / box.w,
    y: e.y / box.h,
    p: pressureOf(e.stylusData?.pressure),
  });

  const pan = Gesture.Pan()
    .withTestId(gestureTestId)
    .runOnJS(true)
    .minDistance(0)
    .maxPointers(1)
    .onBegin((e) => {
      const p = point(e);
      last.current = p;
      setCurrent({
        points: [p],
        color: settings.color,
        width: settings.size / box.w,
        hardness: settings.hardness,
        opacity: settings.opacity,
        eraser: settings.eraser,
      });
    })
    .onUpdate((e) => {
      const p = last.current ? stabilize(last.current, point(e), settings.smoothing) : point(e);
      last.current = p;
      setCurrent((c) => (c ? { ...c, points: [...c.points, p] } : c));
    })
    .onFinalize((_e, success) => {
      // a megszakított vonás (második ujj = zoom) nem marad a rajzon
      setCurrent((c) => {
        if (c && success) {
          setHistory((h) => pushStroke(h, c));
        }
        return null;
      });
      last.current = null;
    });

  useImperativeHandle(
    ref,
    () => ({
      hasStrokes: () => history.done.length > 0,
      undo: () => setHistory(undoStroke),
      redo: () => setHistory(redoStroke),
      addStroke: (stroke) => setHistory((h) => pushStroke(h, stroke)),
      exportPng: (docWidth, docHeight) => {
        try {
          // 🖼️ I19: a vonásokat a dokumentum méretén rajzoljuk újra (adatból) — a
          // képernyő-pillanatkép a nagy exportban elmosódna
          const img = renderStrokes(history.done, docWidth, docHeight, base, clip);
          if (!img || (baseUri && !base)) {
            return null;
          }
          const dir = projectMediaDir();
          if (!dir.exists) {
            dir.create();
          }
          const file = new File(dir, `brush_${Date.now().toString(36)}.png`);
          file.write(img.encodeToBytes(ImageFormat.PNG));
          return file.uri;
        } catch (caught) {
          logCaught('components/studio/image/BrushOverlay.tsx:BrushOverlay', caught);
          return null;
        }
      },
    }),
    [history, base, baseUri, clip]
  );

  const baked = useMemo(() => {
    const ratio = PixelRatio.get();
    // a GPU-textúrás kép a JS-szálhoz kötött, a vászon másik szálon rajzol: e nélkül üres lenne
    return renderStrokes(history.done, box.w * ratio, box.h * ratio, base, clip)?.makeNonTextureImage() ?? null;
  }, [history, box.w, box.h, base, clip]);

  const picture = useMemo(
    () =>
      createPicture((canvas) => {
        if (baked) {
          canvas.drawImageRect(baked, Skia.XYWHRect(0, 0, baked.width(), baked.height()), Skia.XYWHRect(0, 0, box.w, box.h), Skia.Paint());
        }
        if (current) {
          drawStrokes(canvas, [current], box.w, box.h, clip);
        }
      }, Skia.XYWHRect(0, 0, box.w, box.h)),
    [baked, current, box.w, box.h, clip]
  );

  return (
    <GestureDetector gesture={pan}>
      <View style={StyleSheet.absoluteFill}>
        <Canvas colorSpace="srgb" style={{ width: box.w, height: box.h }}>
          <Picture picture={picture} />
        </Canvas>
      </View>
    </GestureDetector>
  );
});
