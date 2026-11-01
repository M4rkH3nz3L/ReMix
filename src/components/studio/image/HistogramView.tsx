import { AlphaType, BlendMode, Canvas, ColorType, Path, Skia, type SkImage, useImage } from '@shopify/react-native-skia';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/editor';
import { clipping, computeHistogram, type Histogram, histogramCurve } from '@/lib/histogram';
import type { ColorFields } from '@/lib/imagePixelPipeline';
import { buildLutBytes, hasColorOps, LUT_DRAFT_SIZE, sampleLut } from '@/lib/imagePreviewLut';

const SAMPLE = 128;
const DEBOUNCE_MS = 150;

/** A réteg képe kicsinyítve, a szerkesztett színekkel: a csúszka húzása közben is friss. */
export function layerHistogram(image: SkImage, layer: ColorFields): Histogram | null {
  const surface = Skia.Surface.MakeOffscreen(SAMPLE, SAMPLE);
  if (!surface) {
    return null;
  }
  surface.getCanvas().drawImageRect(image, Skia.XYWHRect(0, 0, image.width(), image.height()), Skia.XYWHRect(0, 0, SAMPLE, SAMPLE), Skia.Paint());
  surface.flush();
  const px = surface.makeImageSnapshot().readPixels(0, 0, { width: SAMPLE, height: SAMPLE, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul });
  if (!(px instanceof Uint8Array)) {
    return null;
  }
  if (!hasColorOps(layer)) {
    return computeHistogram(px);
  }
  const lut = buildLutBytes(layer, [], LUT_DRAFT_SIZE);
  return computeHistogram(px, (c) => sampleLut(lut, c, LUT_DRAFT_SIZE));
}

function curvePath(bins: Uint32Array, w: number, h: number) {
  const path = Skia.Path.Make();
  path.moveTo(0, h);
  histogramCurve(bins).forEach((v, i) => path.lineTo((i / 255) * w, h - v * h));
  path.lineTo(w, h);
  path.close();
  return path;
}

/** 📊 Hisztogram: a három csatorna egymásra keverve, alatta a kiégett és beégett rész aránya. */
export function HistogramView({ layer, uri, height = 56 }: { layer: ColorFields; uri: string; height?: number }) {
  const { t } = useTranslation();
  const image = useImage(uri);
  const [width, setWidth] = useState(0);
  const [hist, setHist] = useState<Histogram | null>(null);
  const key = JSON.stringify([layer.adjust, layer.hsl, layer.grade, layer.filterId, layer.filterIntensity, layer.gradientMap, layer.levels, layer.channelMix, layer.filters, layer.develop]);

  useEffect(() => {
    if (!image) {
      return;
    }
    const timer = setTimeout(() => setHist(layerHistogram(image, layer)), DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image, key]);

  const paths = useMemo(
    () => (hist && width > 0 ? { r: curvePath(hist.r, width, height), g: curvePath(hist.g, width, height), b: curvePath(hist.b, width, height) } : null),
    [hist, width, height]
  );
  const clip = hist ? clipping(hist) : null;
  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} accessibilityLabel={t('studio.image.histogram.title')}>
      <View style={[styles.plot, { height }]}>
        {paths ? (
          <Canvas colorSpace="srgb" style={StyleSheet.absoluteFill}>
            <Path path={paths.r} color="#ff4040" blendMode={BlendMode.Plus as never} />
            <Path path={paths.g} color="#40e070" blendMode={BlendMode.Plus as never} />
            <Path path={paths.b} color="#4080ff" blendMode={BlendMode.Plus as never} />
          </Canvas>
        ) : null}
      </View>
      {clip && (clip.shadows > 0.005 || clip.highlights > 0.005) ? (
        <Text style={styles.clip}>
          {t('studio.image.histogram.clip', { shadows: Math.round(clip.shadows * 100), highlights: Math.round(clip.highlights * 100) })}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  plot: { borderRadius: 8, overflow: 'hidden', backgroundColor: '#000000' },
  clip: { color: palette.textDim, fontSize: 11, marginTop: 2 },
});
