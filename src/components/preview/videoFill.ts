import type { ViewStyle } from 'react-native';

/**
 * 🌐 WEB-fix — a preview videó a szerver-renderrel EGYEZŐEN illeszkedjen.
 *
 * Az expo-video `VideoView` WEBEN egy NYERS `<video>`-t renderel, és a kapott
 * stílust változtatás nélkül ráteszi. A `StyleSheet.absoluteFill` viszont csak
 * pozíciót ad (inset:0), szélességet/magasságot NEM. Egy CSEREELEMNÉL (`<video>`,
 * `<img>`) a `width/height: auto` a CSS szerint a forrás SAJÁT (intrinsic) pixel-
 * méretét jelenti, nem a szülő kitöltését — a `right/bottom:0` túl-meghatározott,
 * ezért figyelmen kívül marad. Így a videó a saját felbontásán, bal-felülre
 * igazítva jelent meg (túllógott a vásznon → „kilóg"), a `contentFit` /
 * `object-fit` pedig hatástalan volt (nincs mihez illeszteni).
 *
 * Explicit 100%×100% kell: ekkor az `object-fit: contain/cover` a vászondobozra
 * illeszt — pontosan úgy, ahogy a szerver-render ffmpeg-je
 * (`scale=…:force_original_aspect_ratio=decrease` + pad). Az expo-image emiatt
 * NEM hibás: az `absoluteFilledPosition`-je eleve tartalmaz `width/height: 100%`-ot.
 *
 * Natívon no-op: a `VideoView` a position-absolute + 100%×100% mellett is a
 * szülőt tölti ki, ugyanúgy, mint az `absoluteFill`-lel.
 */
export const videoFill: ViewStyle = {
  position: 'absolute',
  top: 0,
  left: 0,
  width: '100%',
  height: '100%',
};
