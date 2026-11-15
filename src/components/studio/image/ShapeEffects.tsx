import { Blur, Canvas, Group, Paint, Path, Rect, Skia } from '@shopify/react-native-skia';
import { StyleSheet, View } from 'react-native';

import { pathData } from '@/lib/draw';
import { shapeToPathPoints } from '@/lib/shapeGeometry';
import { innerEffectsOf } from '@/lib/innerEffects';
import type { ShapeLayer } from '@/types/project';

/** a forma körvonala a saját közepéhez mérve (képernyő-pontban) */
function silhouette(layer: ShapeLayer, w: number, h: number) {
  const parts = layer.subpaths?.length
    ? layer.subpaths.map((sp) => pathData(sp, w, h, true))
    : [pathData(layer.points?.length ? layer.points : shapeToPathPoints(layer) ?? [], w, h, layer.shape === 'path' ? !!layer.closed : true)];
  const path = Skia.Path.MakeFromSVGString(parts.join(' '));
  path?.offset(-w / 2, -h / 2);
  return path;
}

/**
 * ✨ A forma réteg-effektjei a vásznon: ragyogás, vetett árnyék, körvonal a forma MÖGÖTT, a
 * render sorrendjében. Az export a már elforgatott sziluettből dolgozik, ezért az eltolás a
 * vászon irányában értendő, a körvonal pedig a forgatott befoglaló arányában nő.
 */
export function ShapeEffects({ layer, box, canvas }: { layer: ShapeLayer; box: { w: number; h: number }; canvas: { width: number; height: number } }) {
  if (!layer.dropShadow && !layer.outerGlow && !layer.stroke) {
    return null;
  }
  const w = layer.w * box.w;
  const h = layer.h * box.h;
  const path = silhouette(layer, w, h);
  if (!path) {
    return null;
  }
  const s = box.w / canvas.width;
  const px = canvas.width * s; // képernyő-szélesség
  const cx = layer.position.x * box.w;
  const cy = layer.position.y * box.h;
  const rad = ((layer.rotation ?? 0) * Math.PI) / 180;
  const base = [{ rotate: rad }, { scaleX: layer.flipH ? -1 : 1 }, { scaleY: layer.flipV ? -1 : 1 }];
  const opacity = layer.opacity ?? 1;
  const shadow = typeof layer.dropShadow === 'object' ? layer.dropShadow : {};
  const glow = typeof layer.outerGlow === 'object' ? layer.outerGlow : {};
  const n = layer.stroke ? Math.max(1, (layer.stroke.width ?? 0) * px) : 0;
  const bw = Math.abs(w * Math.cos(rad)) + Math.abs(h * Math.sin(rad));
  const bh = Math.abs(w * Math.sin(rad)) + Math.abs(h * Math.cos(rad));
  return (
    <View pointerEvents="none" style={[styles.wrap, { left: -box.w, top: -box.h, width: box.w * 3, height: box.h * 3 }]}>
      <Canvas colorSpace="srgb" style={StyleSheet.absoluteFill}>
        <Group transform={[{ translateX: box.w + cx }, { translateY: box.h + cy }]}>
          {layer.outerGlow ? (
            <Group opacity={opacity * (glow.opacity ?? 0.85)} layer={<Paint><Blur blur={Math.max(2 * s, (glow.size ?? 0.02) * px)} /></Paint>}>
              <Group transform={base}>
                <Path path={path} color={glow.color ?? '#7c5cff'} />
              </Group>
            </Group>
          ) : null}
          {layer.dropShadow ? (
            <Group
              opacity={opacity * (shadow.opacity ?? 0.5)}
              transform={[{ translateX: (shadow.dx ?? 0.02) * px }, { translateY: (shadow.dy ?? 0.02) * box.h }]}
              layer={<Paint><Blur blur={Math.max(1 * s, (shadow.blur ?? 0.012) * px)} /></Paint>}
            >
              <Group transform={base}>
                <Path path={path} color={shadow.color ?? '#000000'} />
              </Group>
            </Group>
          ) : null}
          {layer.stroke ? (
            <Group opacity={opacity} transform={[{ scaleX: (bw + 2 * n) / Math.max(1, bw) }, { scaleY: (bh + 2 * n) / Math.max(1, bh) }]}>
              <Group transform={base}>
                <Path path={path} color={layer.stroke.color} />
              </Group>
            </Group>
          ) : null}
        </Group>
      </Canvas>
    </View>
  );
}

/**
 * 🎨 S13: a forma belső stílusai a forma FÖLÖTT, a körvonalára vágva (a forma saját kitöltését — szín,
 * színátmenet, minta — nem írja felül): átfedés → belső ragyogás → belső árnyék, a forma saját terében
 * (a forgatás előtt eltolva, mint a szerveren).
 */
export function ShapeInnerEffects({ layer, box, canvas }: { layer: ShapeLayer; box: { w: number; h: number }; canvas: { width: number; height: number } }) {
  const inner = innerEffectsOf(layer);
  if (!inner) {
    return null;
  }
  const w = layer.w * box.w;
  const h = layer.h * box.h;
  const path = silhouette(layer, w, h);
  if (!path) {
    return null;
  }
  const s = box.w / canvas.width;
  const px = canvas.width * s;
  const py = canvas.height * s;
  const cx = layer.position.x * box.w;
  const cy = layer.position.y * box.h;
  const rad = ((layer.rotation ?? 0) * Math.PI) / 180;
  const base = [{ rotate: rad }, { scaleX: layer.flipH ? -1 : 1 }, { scaleY: layer.flipV ? -1 : 1 }];
  const opacity = layer.opacity ?? 1;
  const big = { x: -w, y: -h, width: 3 * w, height: 3 * h };
  const ring = (key: string, dx: number, dy: number, sigma: number, color: string, op: number) => (
    <Group key={key} layer={<Paint opacity={op}><Blur blur={sigma} /></Paint>}>
      <Group transform={[{ translateX: dx }, { translateY: dy }]}>
        <Rect {...big} color={color} />
        <Path path={path} color="black" blendMode="dstOut" />
      </Group>
    </Group>
  );
  return (
    <View pointerEvents="none" style={[styles.wrap, { left: -box.w, top: -box.h, width: box.w * 3, height: box.h * 3 }]}>
      <Canvas colorSpace="srgb" style={StyleSheet.absoluteFill}>
        <Group transform={[{ translateX: box.w + cx }, { translateY: box.h + cy }]} opacity={opacity}>
          <Group transform={base}>
            <Group clip={path}>
              {inner.overlay ? <Rect {...big} color={inner.overlay.color} opacity={inner.overlay.opacity} /> : null}
              {inner.glow ? ring('glow', 0, 0, inner.glow.size * px, inner.glow.color, inner.glow.opacity) : null}
              {inner.shadow ? ring('shadow', inner.shadow.dx * px, inner.shadow.dy * py, inner.shadow.blur * px, inner.shadow.color, inner.shadow.opacity) : null}
            </Group>
          </Group>
        </Group>
      </Canvas>
    </View>
  );
}

const styles = StyleSheet.create({ wrap: { position: 'absolute' } });
