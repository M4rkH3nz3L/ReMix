import { Image } from 'expo-image';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import { videoFill } from '@/components/preview/videoFill';
import { resolveClipUri } from '@/lib/assetResolve';
import { activeTransition, type ActiveTransition } from '@/lib/projectUtils';
import { transitionPreviewGeometry, type TransitionGeometry } from '@/lib/transitions';
import { useEditorStore } from '@/store/editorStore';

/**
 * Átmenet-előnézet a fő preview-ban: ha a lejátszófej egy klip `transitionOut`-
 * ablakába esik, a KÖVETKEZŐ klip beúszik a kimenő fölé — kereszttűnéssel (a
 * legtöbb típus), az irányos slide/wipe típusoknál csúszással. Ez KÖZELÍTÉS: a
 * pontos xfade (zoom/spin/cube/pixelize/…) a renderben ég be — a preview csak
 * jelzi, hogy „itt átmenet van", és merre tart.
 */
export function TransitionLayer({ box }: { box: { w: number; h: number } }) {
  const project = useEditorStore((s) => s.project);
  const playhead = useEditorStore((s) => s.playhead);
  const trans = project ? activeTransition(project, playhead) : null;

  if (!trans) {
    return null;
  }
  return <IncomingClip trans={trans} box={box} />;
}

/** A bejövő (B) klip rétege — saját lejátszóval (a kezdőkockát mutatja). */
function IncomingClip({ trans, box }: { trans: ActiveTransition; box: { w: number; h: number } }) {
  const { to, type, direction, progress } = trans;
  const toVideo = to.kind === 'video' ? to : null;
  const toImage = to.kind === 'image' ? to : null;

  // 🔗 ADR-012: a bejövő klip feloldott (asseten át) forrás-uri-ja, memoizált
  const project = useEditorStore((s) => s.project);
  const toVideoUri = useMemo(
    () => (project && toVideo ? (resolveClipUri(project, toVideo) ?? toVideo.uri) : null),
    [project, toVideo]
  );
  const toImageUri = useMemo(
    () => (project && toImage ? (resolveClipUri(project, toImage) ?? toImage.uri) : null),
    [project, toImage]
  );

  const player = useVideoPlayer(null);
  const loadedUri = useRef<string | null>(null);

  useEffect(() => {
    const uri = toVideoUri;
    if (loadedUri.current === uri) {
      return;
    }
    loadedUri.current = uri;
    player
      .replaceAsync(uri)
      .then(() => {
        if (toVideo) {
          player.pause();
          player.currentTime = toVideo.trimIn;
        }
      })
      .catch(() => {});
  }, [player, toVideo, toVideoUri]);

  // 🔗 KÖZÖS átmenet-spec: a preview-geometria a render-paritásos magból jön
  // (transitions.ts), az irányt a trans adja (klip transitionOut.direction).
  const style = geometryToStyle(transitionPreviewGeometry(type, direction, progress, box));
  // fadeBlack/fadeWhite: a szín a transition KÖZEPÉN a legerősebb (fade-through)
  const fadeColor = type === 'fadeBlack' ? '#000' : type === 'fadeWhite' ? '#fff' : null;

  return (
    <>
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, style]}>
        {toVideo ? (
          <VideoView
            player={player}
            style={videoFill}
            contentFit="contain"
            nativeControls={false}
          />
        ) : toImage ? (
          <Image
            source={{ uri: toImageUri ?? toImage.uri }}
            style={StyleSheet.absoluteFill}
            contentFit="contain"
          />
        ) : null}
      </View>
      {fadeColor ? (
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: fadeColor, opacity: 1 - Math.abs(2 * progress - 1) },
          ]}
        />
      ) : null}
    </>
  );
}

/**
 * A pure előnézet-geometriát (transitions.ts) RN `ViewStyle`-ra képezi: az
 * opacity közvetlen, a translate/scale/rotate/rotateY/perspective a transform-
 * tömbbe kerül (a perspektíva mindig elöl, hogy a rotateY hatson). A geometriát
 * a render-paritásos mag adja — ez a réteg csak megjeleníti, nem közelít külön.
 */
function geometryToStyle(g: TransitionGeometry): ViewStyle {
  // a perspektíva mindig elöl, hogy a rotateY-ra hasson (RN transform-sorrend)
  const transform: TransformEntry[] = [];
  if (g.perspective !== undefined) {
    transform.push({ perspective: g.perspective });
  }
  if (g.translateX !== undefined) {
    transform.push({ translateX: g.translateX });
  }
  if (g.translateY !== undefined) {
    transform.push({ translateY: g.translateY });
  }
  if (g.rotateYDeg !== undefined) {
    transform.push({ rotateY: `${g.rotateYDeg}deg` });
  }
  if (g.rotateDeg !== undefined) {
    transform.push({ rotate: `${g.rotateDeg}deg` });
  }
  if (g.scale !== undefined) {
    transform.push({ scale: g.scale });
  }
  const style: ViewStyle = {};
  if (g.opacity !== undefined) {
    style.opacity = g.opacity;
  }
  if (transform.length > 0) {
    style.transform = transform;
  }
  return style;
}

/** egyetlen transform-bejegyzés (a ViewStyle.transform readonly-union mutálható eleme) */
type TransformEntry =
  | { perspective: number }
  | { translateX: number }
  | { translateY: number }
  | { rotateY: string }
  | { rotate: string }
  | { scale: number };
