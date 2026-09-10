import { Image } from 'expo-image';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useEffect, useRef } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import { activeTransition, type ActiveTransition } from '@/lib/projectUtils';
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
  const { to, type, progress } = trans;
  const toVideo = to.kind === 'video' ? to : null;
  const toImage = to.kind === 'image' ? to : null;

  const player = useVideoPlayer(null);
  const loadedUri = useRef<string | null>(null);

  useEffect(() => {
    const uri = toVideo?.uri ?? null;
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
  }, [player, toVideo]);

  const style = transitionStyle(type, progress, box);
  // fadeBlack/fadeWhite: a szín a transition KÖZEPÉN a legerősebb (fade-through)
  const fadeColor = type === 'fadeBlack' ? '#000' : type === 'fadeWhite' ? '#fff' : null;

  return (
    <>
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, style]}>
        {toVideo ? (
          <VideoView
            player={player}
            style={StyleSheet.absoluteFill}
            contentFit="contain"
            nativeControls={false}
          />
        ) : toImage ? (
          <Image
            source={{ uri: toImage.uri }}
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
 * A bejövő klip stílusa a típus + haladás szerint — per-típus közelítés:
 * irányos slide/wipe = csúszás, zoom = beúszó nagyítás, spin = beforgás,
 * flip = perspektivikus billenés, a többi (dissolve/cube/circle/pixelize/blur/
 * radial/fade) kereszttűnés. A pontos xfade a renderben ég be.
 */
function transitionStyle(
  type: ActiveTransition['type'],
  p: number,
  box: { w: number; h: number }
): ViewStyle {
  switch (type) {
    case 'slideLeft':
    case 'wipeLeft':
      return { transform: [{ translateX: (1 - p) * box.w }] }; // jobbról be
    case 'slideRight':
    case 'wipeRight':
      return { transform: [{ translateX: -(1 - p) * box.w }] }; // balról be
    case 'wipeUp':
      return { transform: [{ translateY: (1 - p) * box.h }] }; // alulról be
    case 'wipeDown':
      return { transform: [{ translateY: -(1 - p) * box.h }] }; // felülről be
    case 'zoom':
      return { opacity: p, transform: [{ scale: 1.35 - 0.35 * p }] }; // beúszik zoomolva
    case 'spin':
      return {
        opacity: p,
        transform: [{ rotate: `${(1 - p) * 90}deg` }, { scale: 0.6 + 0.4 * p }],
      };
    case 'flip':
      return {
        opacity: Math.min(1, p * 1.6),
        transform: [{ perspective: box.h * 1.2 }, { rotateY: `${(1 - p) * 90}deg` }],
      };
    default:
      return { opacity: p }; // kereszttűnés (dissolve/cube/circle/pixelize/blur/radial/fade…)
  }
}
