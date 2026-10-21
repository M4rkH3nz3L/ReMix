import { Blur, Canvas, ColorMatrix, Image, useVideo } from '@shopify/react-native-skia';
import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';

import { clipColorMatrix, effectImageFilters } from '@/lib/skiaEffects';
import type { ClipAdjust, VideoEffect } from '@/types/project';

/**
 * 🎬 A MOZGÓ VIDEÓ-klip valódi effekt/grade-előnézete Skiával (VIDEO 03.3).
 *
 * A `SkiaFilteredImage` kép-mintáját követi, csak a frame-forrás videó: a Skia
 * `useVideo` dekódolja a kurrens kockát (`currentFrame` SharedValue<SkImage|null>),
 * amire ugyanaz a pure-magból jövő 4×5 ColorMatrix + blur kerül rá, mint a képnél.
 *
 * ⚠️ ADDITÍV réteg: a hívó (PreviewSurface) a nyers `<VideoView>` FÖLÉ rajzolja,
 * és csak akkor, ha van tényleges grade/effekt (`videoSkiaActive`). Így a szűrő
 * nélküli videó-út érintetlen. CSAK OLVAS (nincs store-mutáció).
 *
 * 🔊 AUDIO: az expo-video `<VideoView>` adja a hangot (lásd PreviewSurface player),
 * ezért itt `volume: 0` — különben dupla hang szólna.
 *
 * ⏱️ SZINKRON:
 *  - Lejátszáskor (`playing`): `paused=false`, és NEM seekelünk kockánként — a
 *    Skia saját órája fut (a per-frame seek beakadna). A drift ellen a nyers
 *    expo-video a mesteróra igazsága; a Skia-kép vizuális közelítés.
 *  - Állókockán/scrubnál (`!playing`): `paused=true`, `seek = sourceTime * 1000`
 *    (a Skia `Video.seek` MILLISZEKUNDUMBAN vár — `JsiVideo`: `currentTime = time/1000`).
 *    A pontos szűrt kocka itt a lényeg.
 *
 * A `paused`/`seek` reanimated SharedValue-ként megy a `useVideo`-nak (a sima érték
 * 60×/mp re-rendert + effekt-újrafutást okozna) — a propsból egy effekt frissíti.
 * A `seek` SharedValue-t a Skia `useAnimatedReaction` figyeli, és felhasználás után
 * magától `null`-ra állítja → nincs ismételt seek ugyanarra az időre (seek-spam-mentes).
 */

export function SkiaFilteredVideo({
  uri,
  box,
  contentFit,
  sourceTime,
  playing,
  adjust,
  effects,
}: {
  uri: string;
  box: { w: number; h: number };
  contentFit: 'contain' | 'cover';
  /** a klipen belüli forrás-idő MÁSODPERCBEN (scrubnál ide seekelünk) */
  sourceTime: number;
  playing: boolean;
  adjust?: ClipAdjust;
  effects?: VideoEffect[];
}) {
  // a Skia videó-vezérlők SharedValue-ként (a sima érték per-frame re-rendert okozna)
  const paused = useSharedValue<boolean>(!playing);
  // seek: ms | null — a null jelzi, hogy nincs függő seek (a Skia a felhasználás után is null-ozza)
  const seek = useSharedValue<number | null>(playing ? null : sourceTime * 1000);

  // lejátszás-állapot követése: lejátszáskor fusson a Skia órája, állókockán álljon meg
  useEffect(() => {
    paused.value = !playing;
  }, [paused, playing]);

  // scrub/állókocka: a pontos forrás-időre seekelünk (ms). Lejátszáskor NEM seekelünk
  // kockánként (a Skia saját órája viszi) — csak a frissen beállt forrás-időre egyszer,
  // amikor megállunk. A `seek` SharedValue felhasználás után null-ra áll a Skia-reakcióban.
  useEffect(() => {
    if (!playing) {
      seek.value = sourceTime * 1000;
    }
  }, [seek, playing, sourceTime]);

  // volume:0 → a hangot az expo-video `<VideoView>` adja (nincs dupla audio)
  const { currentFrame } = useVideo(uri, { paused, seek, volume: 0 });

  // a pure magból: összetett szín-mátrix + blur-leírók (a box-mérethez skálázva)
  const matrix = clipColorMatrix(adjust, effects);
  const filters = effectImageFilters(effects, box);
  const blur = filters.find((f) => f.kind === 'blur');

  return (
    <Canvas style={StyleSheet.absoluteFill}>
      {/* a `currentFrame` SharedValue<SkImage|null> → a Skia `<Image image>` AnimatedProp-ja
          elfogadja; amíg null, a Skia nem rajzol kockát (a nyers VideoView látszik alatta,
          így nincs üres villanás) */}
      <Image image={currentFrame} x={0} y={0} width={box.w} height={box.h} fit={contentFit}>
        {/* a grade + szín-effektek összetett ColorMatrixa (identitásnál a hívó nem is renderel ide) */}
        <ColorMatrix matrix={matrix} />
        {/* blur-effekt: a leghangsúlyosabb blur Gauss-sigmája px-ben (a sharpen a renderben pontos) */}
        {blur ? <Blur blur={blur.amount} /> : null}
      </Image>
    </Canvas>
  );
}
