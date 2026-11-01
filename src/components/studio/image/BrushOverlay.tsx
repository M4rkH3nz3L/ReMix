import {
  BlendMode,
  Canvas,
  ClipOp,
  FilterMode,
  MipmapMode,
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
  needsSource,
  pressureOf,
  pushStroke,
  redoStroke,
  sourceOffset,
  stabilize,
  type Stroke,
  strokeSegments,
  toneMatrix,
  undoStroke,
} from '@/lib/brushEngine';
import { selectionSkPath } from '@/components/studio/image/selectionPath';
import { projectMediaDir } from '@/lib/projectFolderClient';
import { ellipseRing, rectRing, type Selection } from '@/lib/selection';
import type { ClipMask } from '@/types/project';
import { logCaught } from '@/lib/logCaught';

export type { Stroke } from '@/lib/brushEngine';

/** rejtett (fekete) → 60%-os piros, látható (fehér) → átlátszó */
const RUBY_MATRIX = [0, 0, 0, 0, 1, 0, 0, 0, 0, 0.12, 0, 0, 0, 0, 0.12, -0.18, -0.35, -0.07, 0, 0.6];

export interface BrushHandle {
  /** a festés PNG-fájlként (uri) DOKUMENTUM-felbontáson, vagy null */
  exportPng: (docWidth: number, docHeight: number) => string | null;
  hasStrokes: () => boolean;
  undo: () => void;
  redo: () => void;
  /** kész vonás hozzáadása gesztus nélkül (eszköz-füstteszt) */
  addStroke: (stroke: Stroke) => void;
  /** a klón forráspontjának újraválasztása */
  pickSource: () => void;
}

/**
 * A vonások rajza: egy rétegbe kerül a teljes vonás, így az átlátszóság és a lágy szél egyszer
 * hat (önmagát keresztezve sem sötétedik), a radír pedig a réteget lyukasztja az alatta lévőbe.
 * Az előnézet és az export is ezt hívja, ezért nem térhetnek el.
 */
export function drawStrokes(canvas: SkCanvas, strokes: Stroke[], w: number, h: number, clip?: Selection | null, source?: SkImage | null) {
  canvas.save();
  if (clip) {
    canvas.clipPath(selectionSkPath(clip.ops, w, h, clip.invert), ClipOp.Intersect, true);
  }
  for (const s of strokes) {
    // retus forrás nélkül: semmi, különben a vonás feketén maradna a képen
    if (s.tool && !source) {
      continue;
    }
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
    paint.setColor(Skia.Color(s.eraser || s.tool ? '#000000' : s.color));
    paint.setStyle(PaintStyle.Stroke);
    paint.setStrokeCap(StrokeCap.Round);
    paint.setStrokeJoin(StrokeJoin.Round);
    paint.setAntiAlias(true);
    for (const seg of strokeSegments(s)) {
      paint.setStrokeWidth(seg.width * w);
      canvas.drawLine(seg.x1 * w, seg.y1 * h, seg.x2 * w, seg.y2 * h, paint);
    }
    if (s.tool && source) {
      drawRetouch(canvas, s, w, h, source);
    }
    canvas.restore();
  }
  canvas.restore();
}

const SHARPEN_SHADER = `
uniform shader img;
uniform float r;
half4 main(float2 xy) {
  half4 c = img.eval(xy);
  half4 sum = img.eval(xy + float2(r, 0.0)) + img.eval(xy - float2(r, 0.0)) + img.eval(xy + float2(0.0, r)) + img.eval(xy - float2(0.0, r));
  return half4(clamp(c.rgb + (c.rgb - sum.rgb * 0.25) * 1.5, 0.0, 1.0), c.a);
}`;

// a forrás mintázata a cél fénye és színe alá kerül: a nagy léptékű tónus a célé marad
const HEAL_SHADER = `
uniform shader img;
uniform float2 off;
uniform float r;
half3 low(float2 p) {
  half3 sum = half3(0.0);
  for (int j = -2; j <= 2; j++) {
    for (int i = -2; i <= 2; i++) {
      sum += img.eval(p + float2(float(i), float(j)) * r).rgb;
    }
  }
  return sum / 25.0;
}
half4 main(float2 xy) {
  float2 src = xy + off;
  return half4(clamp(img.eval(src).rgb - low(src) + low(xy), 0.0, 1.0), 1.0);
}`;

let sharpenEffect: ReturnType<typeof Skia.RuntimeEffect.Make> | undefined;
let healEffect: ReturnType<typeof Skia.RuntimeEffect.Make> | undefined;

/** A retus a vonás alakját kitöltő, átalakított forráskép: `SrcIn`, így a vonáson kívül semmi nem változik. */
function drawRetouch(canvas: SkCanvas, s: Stroke, w: number, h: number, source: SkImage) {
  const into = Skia.Paint();
  into.setBlendMode(BlendMode.SrcIn);
  canvas.saveLayer(into);
  const full = Skia.XYWHRect(0, 0, w, h);
  const from = Skia.XYWHRect(0, 0, source.width(), source.height());
  const paint = Skia.Paint();
  const off = { x: (s.offset?.x ?? 0) * w, y: (s.offset?.y ?? 0) * h };
  const radius = Math.max(1, s.width * w * 0.5);
  if (s.tool === 'sharpen' || s.tool === 'heal') {
    const scale = Skia.Matrix();
    scale.scale(w / source.width(), h / source.height());
    const image = source.makeShaderOptions(TileMode.Clamp, TileMode.Clamp, FilterMode.Linear, MipmapMode.None, scale);
    if (s.tool === 'sharpen') {
      sharpenEffect ??= Skia.RuntimeEffect.Make(SHARPEN_SHADER);
      paint.setShader(sharpenEffect!.makeShaderWithChildren([Math.max(1, w / 400)], [image]));
    } else {
      healEffect ??= Skia.RuntimeEffect.Make(HEAL_SHADER);
      paint.setShader(healEffect!.makeShaderWithChildren([off.x, off.y, radius * 0.5], [image]));
    }
    canvas.drawRect(full, paint);
  } else {
    if (s.tool === 'dodge' || s.tool === 'burn') {
      paint.setColorFilter(Skia.ColorFilter.MakeMatrix(toneMatrix(s.tool)));
    } else if (s.tool === 'blur') {
      const sigma = Math.max(1, radius * 0.5);
      paint.setImageFilter(Skia.ImageFilter.MakeBlur(sigma, sigma, TileMode.Clamp, null));
    }
    const shift = s.tool === 'clone' ? off : { x: 0, y: 0 };
    canvas.drawImageRect(source, from, Skia.XYWHRect(-shift.x, -shift.y, w, h), paint);
  }
  canvas.restore();
}

/** A festett maszk kiinduló képe: maszk nélkül minden látszik, a meglévő maszk formája átjön. */
function drawMaskBase(canvas: SkCanvas, seed: ClipMask | null, base: SkImage | null | undefined, w: number, h: number) {
  const paint = Skia.Paint();
  paint.setColor(Skia.Color(seed ? '#000000' : '#ffffff'));
  canvas.drawRect(Skia.XYWHRect(0, 0, w, h), paint);
  if (!seed) {
    return;
  }
  paint.setColor(Skia.Color('#ffffff'));
  if (seed.image) {
    if (base) {
      const rect = Skia.XYWHRect((seed.x - seed.w / 2) * w, (seed.y - seed.h / 2) * h, seed.w * w, seed.h * h);
      canvas.drawImageRect(base, Skia.XYWHRect(0, 0, base.width(), base.height()), rect, Skia.Paint());
    }
    return;
  }
  const [a, b] = [{ x: seed.x - seed.w / 2, y: seed.y - seed.h / 2 }, { x: seed.x + seed.w / 2, y: seed.y + seed.h / 2 }];
  const ops = seed.ops?.length
    ? seed.ops
    : [{ op: 'add' as const, points: seed.shape === 'polygon' && seed.points?.length ? seed.points : seed.shape === 'ellipse' ? ellipseRing(a, b) : rectRing(a, b) }];
  canvas.drawPath(selectionSkPath(ops, w, h, !!seed.invert), paint);
}

/** A vonások offscreen raszterizálása adott felbontáson, opcionálisan egy meglévő festésre (null = nincs GPU-felület). */
export function renderStrokes(
  strokes: Stroke[],
  width: number,
  height: number,
  base?: SkImage | null,
  clip?: Selection | null,
  maskSeed?: ClipMask | true | null,
  source?: SkImage | null
) {
  const surface = Skia.Surface.MakeOffscreen(Math.round(width), Math.round(height));
  if (!surface) {
    return null;
  }
  const canvas = surface.getCanvas();
  if (maskSeed) {
    drawMaskBase(canvas, maskSeed === true ? null : maskSeed, base, width, height);
  } else if (base) {
    canvas.drawImageRect(base, Skia.XYWHRect(0, 0, base.width(), base.height()), Skia.XYWHRect(0, 0, width, height), Skia.Paint());
  }
  drawStrokes(canvas, strokes, width, height, clip, source);
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
  { box: { w: number; h: number }; settings: BrushSettings; baseUri?: string | null; onHistory?: (canUndo: boolean, canRedo: boolean) => void; gestureTestId?: string; clip?: Selection | null;
    /** festett maszk: a vonás fehér vagy fekete, a nézet a rejtett részt pirossal jelöli */
    maskMode?: boolean;
    maskSeed?: ClipMask | null;
    /** retus: a vászon pillanatképe */
    source?: SkImage | null;
    onNeedSource?: (needed: boolean) => void }
>(function BrushOverlay({ box, settings, baseUri, onHistory, gestureTestId = 'brush-pan', clip, maskMode, maskSeed, source, onNeedSource }, ref) {
  const base = useImage(baseUri ?? null);
  const seed = maskMode ? (maskSeed ?? true) : null;
  const [history, setHistory] = useState(EMPTY_HISTORY);
  const [current, setCurrent] = useState<Stroke | null>(null);
  const last = useRef<BrushPoint | null>(null);
  const [origin, setOrigin] = useState<{ x: number; y: number } | null>(null);
  // ref is: a gyors második érintés már a friss forrást lássa, ne a régi kezelő zárványát
  const originRef = useRef<{ x: number; y: number } | null>(null);
  const offset = useRef<{ x: number; y: number } | null>(null);
  const waiting = needsSource(settings.tool) && !origin;

  useEffect(() => {
    onNeedSource?.(waiting);
  }, [waiting, onNeedSource]);

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
      if (needsSource(settings.tool) && !originRef.current) {
        originRef.current = { x: p.x, y: p.y };
        setOrigin(originRef.current);
        offset.current = null;
        return;
      }
      if (originRef.current && !offset.current) {
        offset.current = sourceOffset(originRef.current, p);
      }
      last.current = p;
      setCurrent({
        points: [p],
        color: maskMode ? (settings.eraser ? '#000000' : '#ffffff') : settings.color,
        width: settings.size / box.w,
        hardness: settings.hardness,
        opacity: settings.opacity,
        eraser: !maskMode && !settings.tool && settings.eraser,
        tool: settings.tool,
        offset: needsSource(settings.tool) ? offset.current ?? undefined : undefined,
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
      pickSource: () => {
        originRef.current = null;
        setOrigin(null);
        offset.current = null;
      },
      exportPng: (docWidth, docHeight) => {
        try {
          // 🖼️ I19: a vonásokat a dokumentum méretén rajzoljuk újra (adatból) — a
          // képernyő-pillanatkép a nagy exportban elmosódna
          const img = renderStrokes(history.done, docWidth, docHeight, base, clip, seed, source);
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
    [history, base, baseUri, clip, seed, source]
  );

  const baked = useMemo(() => {
    const ratio = PixelRatio.get();
    // a GPU-textúrás kép a JS-szálhoz kötött, a vászon másik szálon rajzol: e nélkül üres lenne
    return renderStrokes(history.done, box.w * ratio, box.h * ratio, base, clip, seed, source)?.makeNonTextureImage() ?? null;
  }, [history, box.w, box.h, base, clip, seed, source]);

  const picture = useMemo(
    () =>
      createPicture((canvas) => {
        if (maskMode) {
          // a rejtett rész pirosan látszik: a szín a fényességből lesz átlátszóság
          const ruby = Skia.Paint();
          ruby.setColorFilter(Skia.ColorFilter.MakeMatrix(RUBY_MATRIX));
          canvas.saveLayer(ruby);
        }
        if (baked) {
          canvas.drawImageRect(baked, Skia.XYWHRect(0, 0, baked.width(), baked.height()), Skia.XYWHRect(0, 0, box.w, box.h), Skia.Paint());
        }
        if (current) {
          drawStrokes(canvas, [current], box.w, box.h, clip, source);
        }
        if (maskMode) {
          canvas.restore();
        }
      }, Skia.XYWHRect(0, 0, box.w, box.h)),
    [baked, current, box.w, box.h, clip, maskMode, source]
  );

  return (
    <GestureDetector gesture={pan}>
      <View style={StyleSheet.absoluteFill}>
        <Canvas colorSpace="srgb" style={{ width: box.w, height: box.h }}>
          <Picture picture={picture} />
        </Canvas>
        {origin ? (
          <View pointerEvents="none" style={[styles.origin, { left: origin.x * box.w - 12, top: origin.y * box.h - 12 }]} />
        ) : null}
      </View>
    </GestureDetector>
  );
});

const styles = StyleSheet.create({
  origin: { position: 'absolute', width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: '#ffffff', backgroundColor: 'rgba(0,0,0,0.25)' },
});
