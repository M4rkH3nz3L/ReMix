import { Blur, Canvas, ColorMatrix, Image, useImage } from '@shopify/react-native-skia';
import { StyleSheet } from 'react-native';

import { clipColorMatrix, effectImageFilters } from '@/lib/skiaEffects';
import type { ClipAdjust, VideoEffect } from '@/types/project';

/**
 * 🎨 KÉP-klip valódi effekt/grade-előnézete Skiával (VIDEO 01.2 / 03.1).
 *
 * A sima expo-`Image` csak a nyers képet mutatta, a grade (`ClipAdjust`) és a
 * szín-effektek (`VideoEffect[]`) a vásznon NEM látszottak — a `skiaEffects.ts`
 * pure magja ezeket egy 4×5 ColorMatrixba (`number[20]`) és blur-leíróba fordítja,
 * ezt a réteg itt Skia-objektumokká alakítva a klip-kockára teszi.
 *
 * CSAK OLVAS (nincs store-mutáció) — ugyanabba a transzform/opacity-wrapperbe
 * kerül, mint a sima expo-`Image`, ezért `StyleSheet.absoluteFill` a vásznon.
 *
 * ⚠️ A Skia `<Image fit>` natívan illeszt (contain/cover) — a sima expo-image
 * `contentFit`-jével paritásban; a `number[20]` pont a Skia `ColorMatrix` 4×5
 * formátuma, a blur-leíró `amount`-ja Gauss-sigma px. A sharpen-t a preview
 * EGYELŐRE kihagyja (a blur a fő — a sharpen a renderben pontos).
 */
export function SkiaFilteredImage({
  uri,
  box,
  contentFit,
  adjust,
  effects,
}: {
  uri: string;
  box: { w: number; h: number };
  contentFit: 'contain' | 'cover';
  adjust?: ClipAdjust;
  effects?: VideoEffect[];
}) {
  // Skia-kép betöltése (async dekód); amíg null, nem rajzolunk semmit.
  const image = useImage(uri);

  // a pure magból: összetett szín-mátrix + blur-leírók (a box-mérethez skálázva)
  const matrix = clipColorMatrix(adjust, effects);
  const filters = effectImageFilters(effects, box);
  const blur = filters.find((f) => f.kind === 'blur');

  // a natív kép még dekódol → ne rajzoljunk üres/hibás kockát (a sima image addig látszik)
  if (!image) {
    return null;
  }

  return (
    <Canvas style={StyleSheet.absoluteFill}>
      <Image image={image} x={0} y={0} width={box.w} height={box.h} fit={contentFit}>
        {/* a grade + szín-effektek összetett ColorMatrixa (identitásnál a hívó nem is renderel ide) */}
        <ColorMatrix matrix={matrix} />
        {/* blur-effekt: a leghangsúlyosabb blur Gauss-sigmája px-ben (a sharpen a renderben pontos) */}
        {blur ? <Blur blur={blur.amount} /> : null}
      </Image>
    </Canvas>
  );
}
