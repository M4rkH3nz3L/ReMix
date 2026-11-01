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
import { useMemo } from 'react';
import { StyleSheet } from 'react-native';

import { maskOutlineInBox } from '@/lib/imageLayerGeometry';
import { LUT_SHADER, LUT_SIZE, buildLutBytes, hasColorOps } from '@/lib/imagePreviewLut';
import type { PhotoLayer } from '@/types/project';

type Canvas2D = { width: number; height: number };

let lutEffect: ReturnType<typeof Skia.RuntimeEffect.Make> | null = null;
function effect() {
  lutEffect ??= Skia.RuntimeEffect.Make(LUT_SHADER);
  return lutEffect;
}

/** a réteg 3D LUT-ja Skia-képként */
export function makeLutImage(layer: PhotoLayer): SkImage | null {
  const n = LUT_SIZE;
  return Skia.Image.MakeImage(
    { width: n * n, height: n, alphaType: AlphaType.Opaque, colorType: ColorType.RGBA_8888 },
    Skia.Data.fromBytes(buildLutBytes(layer)),
    n * n * 4
  );
}

/** Kell-e Skia ehhez a réteghez, vagy elég a sima kép? */
export function needsSkiaPreview(layer: PhotoLayer): boolean {
  return (
    hasColorOps(layer) ||
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
  return Math.ceil(Math.max(s, g) * (w / Math.max(layer.w, 1e-4)));
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
  layer,
  w,
  h,
  scale,
  canvas,
}: {
  image: SkImage;
  lut: SkImage | null;
  layer: PhotoLayer;
  w: number;
  h: number;
  /** vászon-pixel → képernyő-pont */
  scale: number;
  canvas: Canvas2D;
}) {
  const fit = FIT[layer.fit ?? 'cover'];
  const runtime = lut ? effect() : null;
  let content =
    runtime && lut ? (
      <Rect x={0} y={0} width={w} height={h}>
        <Shader source={runtime} uniforms={{ size: LUT_SIZE }}>
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
  if (layer.mask?.shape) {
    const pts = maskOutlineInBox(layer.mask, layer, canvas);
    const path = Skia.Path.Make();
    pts.forEach((p, i) => (i === 0 ? path.moveTo(p.x * w, p.y * h) : path.lineTo(p.x * w, p.y * h)));
    path.close();
    const feather = Math.max(0, (layer.mask.feather ?? 0.05) * canvas.height * scale);
    const shape = (
      <Group layer={<Paint><Blur blur={feather} /></Paint>}>
        <Path path={path} color={layer.mask.invert ? 'black' : 'white'} />
      </Group>
    );
    content = (
      <Mask
        mode="luminance"
        mask={layer.mask.invert ? <Group><Rect x={0} y={0} width={w} height={h} color="white" />{shape}</Group> : shape}
      >
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
export function SkiaPhotoLayer({ layer, w, h, scale, canvas, fallback }: { layer: PhotoLayer; w: number; h: number; scale: number; canvas: Canvas2D; fallback: React.ReactNode }) {
  const image = useImage(layer.uri);
  const key = JSON.stringify([layer.adjust, layer.grade, layer.filterId, layer.filterIntensity, layer.gradientMap, layer.levels, layer.channelMix, layer.filters]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const lut = useMemo(() => (hasColorOps(layer) ? makeLutImage(layer) : null), [key]);
  if (!image) {
    return fallback;
  }
  const pad = effectPad(layer, w);
  return (
    <Canvas style={[styles.canvas, { left: -pad, top: -pad, width: w + 2 * pad, height: h + 2 * pad }]}>
      <Group transform={[{ translateX: pad }, { translateY: pad }]}>
        <PhotoSkiaContent image={image} lut={lut} layer={layer} w={w} h={h} scale={scale} canvas={canvas} />
      </Group>
    </Canvas>
  );
}

const styles = StyleSheet.create({ canvas: { position: 'absolute' } });
