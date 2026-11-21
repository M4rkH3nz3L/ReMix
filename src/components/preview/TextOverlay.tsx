import { useEffect } from 'react';
import { Platform, StyleSheet } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { TextOverlayGlyphs } from '@/components/preview/textOverlay/TextOverlayGlyphs';
import { palette } from '@/constants/editor';
import { tightLeadingShift } from '@/lib/fontMetrics';
import { sampleChannel } from '@/lib/keyframes';
import {
  animatedProps,
  glowCopyOf,
  karaokeWordsOf,
  presetStyles,
  shownText,
  textTypography,
} from '@/lib/textOverlayStyle';
import { clamp } from '@/lib/time';
import type { TextClip } from '@/types/project';

interface Props {
  clip: TextClip;
  /** klipen belüli idő (mp) */
  t: number;
  box: { w: number; h: number };
  editable: boolean;
  /** a szerkesztő-vászon nagyítása: a húzás ennyivel kisebb elmozdulás (alap 1) */
  zoom?: number;
  /** a közép mozgástere (a kép-szerkesztőben a vásznon túlra is mehet) */
  moveRange?: [number, number];
  /** zárolt réteg: kijelölhető, de nem húzható */
  locked?: boolean;
  selected: boolean;
  onSelect?: (id: string) => void;
  onMove?: (id: string, position: { x: number; y: number }) => void;
  /** húzás közbeni pozíció-jelentés a segédvonalakhoz (null = húzás vége) */
  onDragLive?: (position: { x: number; y: number } | null) => void;
  /** dupla koppintás — szerkesztő megnyitása */
  onEdit?: (id: string) => void;
}

// a vászon a kész képet mutatja: a rendszer szövegméret-beállítása az exportot sem érinti
export function TextOverlay({
  clip,
  t,
  box,
  editable,
  zoom = 1,
  moveRange = [0.02, 0.98],
  locked = false,
  selected,
  onSelect,
  onMove,
  onDragLive,
  onEdit,
}: Props) {
  const dragX = useSharedValue(0);
  const dragY = useSharedValue(0);

  useEffect(() => {
    dragX.value = 0;
    dragY.value = 0;
  }, [clip.position.x, clip.position.y, dragX, dragY]);

  // követett/kulcskockás pozíció: a playheadből interpolálva (P0‑6)
  const posX = sampleChannel(clip.keyframes?.x, t, clip.position.x);
  const posY = sampleChannel(clip.keyframes?.y, t, clip.position.y);
  // 🧊 3D követés: a téma látszó méretét a scale-csatorna hozza
  const kfScale = sampleChannel(clip.keyframes?.scale, t, 1);

  const reportLive = (dx: number, dy: number) => {
    onDragLive?.({
      x: clip.position.x + dx / box.w,
      y: clip.position.y + dy / box.h,
    });
  };

  const commitMove = (dx: number, dy: number) => {
    onDragLive?.(null);
    onMove?.(clip.id, {
      x: clamp(clip.position.x + dx / zoom / box.w, moveRange[0], moveRange[1]),
      y: clamp(clip.position.y + dy / zoom / box.h, moveRange[0], moveRange[1]),
    });
  };

  // I35: egy ujj — a kétujjas gesztus a vászon csippentéséé
  const pan = Gesture.Pan()
    .enabled(editable && !locked)
    .maxPointers(1)
    .onEnd((e, success) => {
      if (success) {
        runOnJS(commitMove)(e.translationX, e.translationY);
      }
    })
    .onUpdate((e) => {
      dragX.value = e.translationX / zoom;
      dragY.value = e.translationY / zoom;
      runOnJS(reportLive)(e.translationX, e.translationY);
    });

  const tap = Gesture.Tap()
    .enabled(editable)
    .onEnd(() => {
      if (onSelect) {
        runOnJS(onSelect)(clip.id);
      }
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .enabled(editable)
    .onEnd(() => {
      if (onEdit) {
        runOnJS(onEdit)(clip.id);
      }
    });

  const dragStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: dragX.value }, { translateY: dragY.value }],
  }));

  const anim = animatedProps(clip, t);
  const fontSize = (clip.fontSize / 100) * box.h * kfScale;
  const preset = presetStyles(clip, fontSize);
  // 🔡 a tipográfia a render CSS-ével azonos: a sorköz CSS-szorzó (alap 1,25, mint a `text-render.js`),
  // a betűköz em-arány — a körvonal-másolatok is ezt kapják, különben többsoros szövegen szétcsúsznak
  const typo = textTypography(clip, fontSize);
  // iOS a font természetes sormagasságánál szorosabb sorban a betűt a sor tetejéhez igazítja, a CSS
  // középre: a különbség felével lejjebb toljuk (a font saját hhea-értékéből, `fontMetrics.ts`)
  // a render második ragyogás-árnyéka: a textStyle-ragyogás belső (g/2) rétege, vagy a neon külső rétege
  const glowCopy = glowCopyOf(clip, fontSize);
  const tightShift =
    typo && Platform.OS === 'ios' ? tightLeadingShift(clip.fontFamily, typo.lineHeight / fontSize) * fontSize : 0;
  const shown = shownText(clip, anim.chars);

  // karaoke: a szavak az idő arányában "gyulladnak fel"; ✨ kiemelt szavaknál
  // (Caption Studio) sima feliraton is szavankénti render megy
  const karaokeWords = karaokeWordsOf(clip, t);

  return (
    <GestureDetector gesture={Gesture.Simultaneous(Gesture.Exclusive(doubleTap, tap), pan)}>
      <Animated.View
        style={[
          styles.wrap,
          {
            // a wrap a teljes vászonszélességet kapja, különben a szöveg a
            // középponttól jobbra eső sávba törne be szavanként
            left: (posX - 0.5) * box.w,
            top: posY * box.h,
            width: box.w,
            opacity: anim.opacity,
          },
          dragStyle,
        ]}
      >
        <Animated.View
          style={[
            styles.inner,
            selected && editable ? styles.selected : null,
            {
              // a szövegdoboz TARTALMA a megadott szélesség (mint a renderben, ahol nincs belső margó):
              // a belső margó (2×8, a buboréknál a sajátja) rájön, különben a határeseti sor máshol törik
              ...(clip.boxWidth
                ? { width: clip.boxWidth * box.w + ('paddingHorizontal' in preset.box ? 0 : 2 * INNER_PAD_X) }
                : { maxWidth: '92%' as const }),
              transform: [
                { translateY: '-50%' },
                { translateY: anim.translateY },
                // ↕️ alapvonal-eltolás (baseline shift): + = felfelé
                ...(clip.baselineShift
                  ? ([{ translateY: -clip.baselineShift * fontSize }] as const)
                  : []),
                { scale: anim.scale },
                // 🔄 réteg-forgatás (kép-stúdió) a szöveg-blokk közepe körül
                ...(clip.rotation ? ([{ rotate: `${clip.rotation}deg` }] as const) : []),
                // 🔁 tükrözés (a forgatás ELŐTT = a tömbben később)
                ...(clip.flipH ? ([{ scaleX: -1 }] as const) : []),
                ...(clip.flipV ? ([{ scaleY: -1 }] as const) : []),
                // 3D döntés (közelítés — a pontos anyag/extrúzió a renderben)
                ...(clip.text3d
                  ? ([
                      { perspective: fontSize * 9 },
                      { rotateX: `${clip.text3d.tiltX}deg` },
                      { rotateY: `${clip.text3d.tiltY}deg` },
                    ] as const)
                  : []),
              ],
            },
            preset.box,
            // 🎨 granuláris háttér-doboz (gradient-kitöltéssel kizáró)
            !clip.text3d && clip.textStyle?.background && !clip.textStyle?.gradient
              ? {
                  backgroundColor: clip.textStyle.background.color,
                  paddingHorizontal: clip.textStyle.background.padding * fontSize,
                  paddingVertical: clip.textStyle.background.padding * fontSize * 0.5,
                  borderRadius: clip.textStyle.background.radius * fontSize,
                }
              : null,
          ]}
        >
          <TextOverlayGlyphs
            clip={clip}
            fontSize={fontSize}
            preset={preset}
            typo={typo}
            glowCopy={glowCopy}
            tightShift={tightShift}
            shown={shown}
            karaokeWords={karaokeWords}
          />
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}

/** a szöveg-blokk belső vízszintes margója (pt) */
const INNER_PAD_X = 8;

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    alignItems: 'center',
  },
  inner: {
    paddingHorizontal: INNER_PAD_X,
    paddingVertical: 4,
    borderRadius: 6,
  },
  selected: {
    borderWidth: 1,
    borderColor: palette.accent,
    borderStyle: 'dashed',
  },
});
