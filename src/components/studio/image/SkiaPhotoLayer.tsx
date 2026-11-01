import {
  AlphaType,
  Blur,
  Canvas,
  ColorType,
  FilterMode,
  Group,
  Image as SkiaImage,
  ImageShader,
  LinearGradient,
  Mask,
  MipmapMode,
  Paint,
  Path,
  Rect,
  Shader,
  Shadow,
  Skia,
  type SkImage,
  useImage,
  vec,
} from '@shopify/react-native-skia';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet } from 'react-native';

import { File } from 'expo-file-system';

import { maskOutlineInBox } from '@/lib/imageLayerGeometry';
import { type CubeLut, parseCubeLut } from '@/lib/lutImport';
import type { ColorFields } from '@/lib/imagePixelPipeline';
import { LUT_DRAFT_SIZE, LUT_SHADER, LUT_SIZE, buildLutBytes, hasColorOps } from '@/lib/imagePreviewLut';
import type { ClipMask, PhotoLayer } from '@/types/project';

type Canvas2D = { width: number; height: number };

/** ennyi tétlenség után vált a pontos LUT-ra */
const LUT_IDLE_MS = 120;

let lutEffect: ReturnType<typeof Skia.RuntimeEffect.Make> | null = null;
function effect() {
  lutEffect ??= Skia.RuntimeEffect.Make(LUT_SHADER);
  return lutEffect;
}

/** a réteg saját `.cube` fájlja beolvasva (a szín-lánc része) */
export function useCubeFile(uri: string | undefined): CubeLut | null {
  const [cube, setCube] = useState<{ uri: string; lut: CubeLut } | null>(null);
  useEffect(() => {
    if (!uri || cube?.uri === uri) {
      return;
    }
    let alive = true;
    void (async () => {
      try {
        const parsed = parseCubeLut(await new File(uri).text());
        if (alive && parsed.ok && parsed.lut) {
          setCube({ uri, lut: parsed.lut });
        }
      } catch {
        /* olvashatatlan fájl: a LUT nélküli kép látszik, a hiányzó fájlt a sáv jelzi */
      }
    })();
    return () => {
      alive = false;
    };
  }, [uri, cube?.uri]);
  return cube && cube.uri === uri ? cube.lut : null;
}

/** a réteg 3D LUT-ja Skia-képként */
export function makeLutImage(layer: PhotoLayer, after: ColorFields[] = [], n = LUT_SIZE, cube?: CubeLut | null): SkImage | null {
  return Skia.Image.MakeImage(
    { width: n * n, height: n, alphaType: AlphaType.Opaque, colorType: ColorType.RGBA_8888 },
    Skia.Data.fromBytes(buildLutBytes(layer, after, n, cube)),
    n * n * 4
  );
}

/** Kell-e Skia ehhez a réteghez, vagy elég a sima kép? */
export function needsSkiaPreview(layer: PhotoLayer, after: ColorFields[] = []): boolean {
  return (
    hasColorOps(layer, after) ||
    !!layer.lut ||
    !!layer.localAdjust?.mask ||
    !!layer.stroke ||
    !!layer.mask ||
    !!layer.maskGradient ||
    !!layer.dropShadow ||
    !!layer.outerGlow ||
    !!layer.filters?.some((f) => f.type === 'blur' && (f.amount ?? 0) > 0)
  );
}

/** a vetett árnyék / ragyogás mennyivel lóg ki a dobozból (px) */
function effectPad(layer: PhotoLayer, w: number): number {
  const shadow = typeof layer.dropShadow === 'object' ? layer.dropShadow : {};
  const glow = typeof layer.outerGlow === 'object' ? layer.outerGlow : {};
  const s = layer.dropShadow ? Math.max(Math.abs(shadow.dx ?? 0.02), Math.abs(shadow.dy ?? 0.02)) + (shadow.blur ?? 0.012) * 3 : 0;
  const g = layer.outerGlow ? (glow.size ?? 0.02) * 3 : 0;
  return Math.ceil(Math.max(s, g, layer.stroke?.width ?? 0) * (w / Math.max(layer.w, 1e-4)));
}

const FIT = { cover: 'cover', contain: 'contain', stretch: 'fill' } as const;
const GRADIENT_DIR = {
  left: [vec(1, 0), vec(0, 0)],
  right: [vec(0, 0), vec(1, 0)],
  up: [vec(0, 1), vec(0, 0)],
  down: [vec(0, 0), vec(0, 1)],
} as const;

/**
 * A réteg rajza (hook nélkül, így a teszt offscreen is ki tudja rajzolni): a kép a 3D LUT-on
 * át, blur, maszk, gradiens-maszk, vetett árnyék és ragyogás.
 */
export function PhotoSkiaContent({
  image,
  lut,
  lutSize = LUT_SIZE,
  localLut,
  layer,
  w,
  h,
  scale,
  canvas,
}: {
  image: SkImage;
  lut: SkImage | null;
  lutSize?: number;
  /** a lokális korrekcióval számolt LUT (ugyanakkora rács) */
  localLut?: SkImage | null;
  layer: PhotoLayer;
  w: number;
  h: number;
  /** vászon-pixel → képernyő-pont */
  scale: number;
  canvas: Canvas2D;
}) {
  const fit = FIT[layer.fit ?? 'cover'];
  const runtime = lut || localLut ? effect() : null;
  let content =
    runtime && lut ? (
      <Rect x={0} y={0} width={w} height={h}>
        <Shader source={runtime} uniforms={{ size: lutSize }}>
          <ImageShader image={image} fit={fit} rect={{ x: 0, y: 0, width: w, height: h }} />
          <ImageShader image={lut} tx="clamp" ty="clamp" sampling={{ filter: FilterMode.Linear, mipmap: MipmapMode.None }} />
        </Shader>
      </Rect>
    ) : (
      <SkiaImage image={image} x={0} y={0} width={w} height={h} fit={fit} />
    );
  const blurAmount = layer.filters?.find((f) => f.type === 'blur')?.amount ?? 0;
  if (blurAmount > 0) {
    content = (
      <Group layer={<Paint><Blur blur={blurAmount * 20 * scale} /></Paint>}>{content}</Group>
    );
  }
  const maskElement = (mask: ClipMask) => {
    const pts = maskOutlineInBox(mask, layer, canvas);
    const path = Skia.Path.Make();
    pts.forEach((p, i) => (i === 0 ? path.moveTo(p.x * w, p.y * h) : path.lineTo(p.x * w, p.y * h)));
    path.close();
    const feather = Math.max(0, (mask.feather ?? 0.05) * canvas.height * scale);
    const shape = (
      <Group layer={<Paint><Blur blur={feather} /></Paint>}>
        <Path path={path} color={mask.invert ? 'black' : 'white'} />
      </Group>
    );
    return mask.invert ? <Group><Rect x={0} y={0} width={w} height={h} color="white" />{shape}</Group> : shape;
  };
  // 🎯 lokális korrekció: a maszkon belül a korrigált LUT-tal rajzolunk az eredeti fölé
  if (runtime && localLut && layer.localAdjust?.mask) {
    content = (
      <>
        {content}
        <Mask mode="luminance" mask={maskElement(layer.localAdjust.mask)}>
          <Rect x={0} y={0} width={w} height={h}>
            <Shader source={runtime} uniforms={{ size: lutSize }}>
              <ImageShader image={image} fit={fit} rect={{ x: 0, y: 0, width: w, height: h }} />
              <ImageShader image={localLut} tx="clamp" ty="clamp" sampling={{ filter: FilterMode.Linear, mipmap: MipmapMode.None }} />
            </Shader>
          </Rect>
        </Mask>
      </>
    );
  }
  if (layer.mask?.shape) {
    content = (
      <Mask mode="luminance" mask={maskElement(layer.mask)}>
        {content}
      </Mask>
    );
  }
  if (layer.maskGradient && GRADIENT_DIR[layer.maskGradient as keyof typeof GRADIENT_DIR]) {
    const [a, b] = GRADIENT_DIR[layer.maskGradient as keyof typeof GRADIENT_DIR];
    content = (
      <Mask
        mask={
          <Rect x={0} y={0} width={w} height={h}>
            <LinearGradient start={vec(a.x * w, a.y * h)} end={vec(b.x * w, b.y * h)} colors={['white', 'transparent']} />
          </Rect>
        }
      >
        {content}
      </Mask>
    );
  }
  if (layer.stroke) {
    // a render a réteg sziluettjét nagyítja N pixellel: átlátszatlan fotónál ez egy keret
    const n = layer.stroke.width * canvas.width * scale;
    content = (
      <>
        <Rect x={-n} y={-n} width={w + 2 * n} height={h + 2 * n} color={layer.stroke.color} />
        {content}
      </>
    );
  }
  if (layer.dropShadow || layer.outerGlow) {
    const d = typeof layer.dropShadow === 'object' ? layer.dropShadow : {};
    const g = typeof layer.outerGlow === 'object' ? layer.outerGlow : {};
    const px = canvas.width * scale;
    content = (
      <Group
        layer={
          <Paint>
            {layer.dropShadow ? (
              <Shadow dx={(d.dx ?? 0.02) * px} dy={(d.dy ?? 0.02) * canvas.height * scale} blur={(d.blur ?? 0.012) * px} color={d.color ?? `rgba(0,0,0,${d.opacity ?? 0.5})`} />
            ) : null}
            {layer.outerGlow ? <Shadow dx={0} dy={0} blur={(g.size ?? 0.02) * px} color={g.color ?? '#7c5cff'} /> : null}
          </Paint>
        }
      >
        {content}
      </Group>
    );
  }
  return content;
}

/** 🎨 A fotó-réteg előnézete: az export színével és vágásával. */
export function SkiaPhotoLayer({
  layer,
  after = [],
  w,
  h,
  scale,
  canvas,
  fallback,
}: {
  layer: PhotoLayer;
  after?: ColorFields[];
  w: number;
  h: number;
  scale: number;
  canvas: Canvas2D;
  fallback: React.ReactNode;
}) {
  const image = useImage(layer.uri);
  const cube = useCubeFile(layer.lut);
  const local = layer.localAdjust;
  const localAfter = useMemo(() => (local ? [{ adjust: local.adjust, grade: local.grade }, ...after] : null), [local, after]);
  const key = JSON.stringify([layer.adjust, layer.grade, layer.filterId, layer.filterIntensity, layer.gradientMap, layer.levels, layer.channelMix, layer.filters, layer.develop?.base, after, local?.adjust, local?.grade, !!cube, layer.lut]);
  const hasLut = hasColorOps(layer, after, cube) || !!localAfter;
  // húzás közben a gyors rács fut, megálláskor a pontos: a csúszka nem akad
  const [fine, setFine] = useState<{ key: string; lut: SkImage | null; local: SkImage | null } | null>(null);
  const draft = useMemo(
    () => (hasLut ? makeLutImage(layer, after, LUT_DRAFT_SIZE, cube) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key]
  );
  const draftLocal = useMemo(
    () => (localAfter ? makeLutImage(layer, localAfter, LUT_DRAFT_SIZE, cube) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key]
  );
  useEffect(() => {
    if (!draft) {
      return;
    }
    const timer = setTimeout(
      () => setFine({ key, lut: makeLutImage(layer, after, LUT_SIZE, cube), local: localAfter ? makeLutImage(layer, localAfter, LUT_SIZE, cube) : null }),
      LUT_IDLE_MS
    );
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const exact = fine?.key === key ? fine : null;
  if (!image) {
    return fallback;
  }
  const pad = effectPad(layer, w);
  return (
    // sRGB: az export is ez; a Skia alapból P3-as felülete másképp számolná a telített színeket
    <Canvas colorSpace="srgb" style={[styles.canvas, { left: -pad, top: -pad, width: w + 2 * pad, height: h + 2 * pad }]}>
      <Group transform={[{ translateX: pad }, { translateY: pad }]}>
        <PhotoSkiaContent image={image} lut={exact?.lut ?? draft} localLut={exact ? exact.local : draftLocal} lutSize={exact ? LUT_SIZE : LUT_DRAFT_SIZE} layer={layer} w={w} h={h} scale={scale} canvas={canvas} />
      </Group>
    </Canvas>
  );
}

const styles = StyleSheet.create({ canvas: { position: 'absolute' } });
