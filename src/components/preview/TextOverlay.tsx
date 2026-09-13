import { useEffect } from 'react';
import { StyleSheet, Text } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { palette } from '@/constants/editor';
import { sampleChannel } from '@/lib/keyframes';
import { clamp } from '@/lib/time';
import { activeWordIndex } from '@/lib/wordTiming';
import type { Text3D, TextClip } from '@/types/project';

/** a 3D anyag közelítő felület-színe az előnézetben */
function text3dFaceColor(t3: Text3D, base: string): string {
  switch (t3.material) {
    case 'chrome':
      return '#d5d8e2';
    case 'gold':
      return '#f2c14e';
    default:
      return base;
  }
}

interface Props {
  clip: TextClip;
  /** klipen belüli idő (mp) */
  t: number;
  box: { w: number; h: number };
  editable: boolean;
  selected: boolean;
  onSelect?: (id: string) => void;
  onMove?: (id: string, position: { x: number; y: number }) => void;
  /** húzás közbeni pozíció-jelentés a segédvonalakhoz (null = húzás vége) */
  onDragLive?: (position: { x: number; y: number } | null) => void;
  /** dupla koppintás — szerkesztő megnyitása */
  onEdit?: (id: string) => void;
}

function bounceOut(x: number): number {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (x < 1 / d1) return n1 * x * x;
  if (x < 2 / d1) {
    x -= 1.5 / d1;
    return n1 * x * x + 0.75;
  }
  if (x < 2.5 / d1) {
    x -= 2.25 / d1;
    return n1 * x * x + 0.9375;
  }
  x -= 2.625 / d1;
  return n1 * x * x + 0.984375;
}

/** Az animációk a playhead-ből számolódnak, így görgetésre is determinisztikusak. */
function animatedProps(clip: TextClip, t: number) {
  // 🎬 Kinetic typography — blokk-szintű KÖZELÍTÉS (a pontos per-char/word/line
  // a renderben ég be; a typeOn itt valódi karakter-szeleteléssel megy)
  const m = clip.textMotion;
  if (m) {
    const stagger = m.stagger ?? (m.by === 'char' ? 0.03 : m.by === 'word' ? 0.08 : 0.14);
    const dur = m.dur ?? 0.4;
    const nUnits =
      m.by === 'char'
        ? clip.text.length
        : m.by === 'line'
          ? clip.text.split('\n').length
          : clip.text.split(/\s+/).filter(Boolean).length;
    const eff = Math.min(stagger, 2.4 / Math.max(1, nUnits - 1));
    const total = (Math.max(1, nUnits) - 1) * eff + dur;
    const p = clamp(t / Math.max(0.15, total), 0, 1);
    const e = 1 - Math.pow(1 - p, 3);
    const len = clip.text.length;
    switch (m.preset) {
      case 'reveal':
        return { opacity: e, translateY: (1 - e) * 24, scale: 1, chars: len };
      case 'slideIn':
        return { opacity: e, translateY: 0, scale: 1, chars: len };
      case 'popIn': {
        const o = p < 1 ? 1.25 * p * (2 - p) : 1;
        return { opacity: clamp(p * 2, 0, 1), translateY: 0, scale: o, chars: len };
      }
      case 'bounce':
        return { opacity: clamp(p * 3, 0, 1), translateY: (1 - bounceOut(p)) * 26, scale: 1, chars: len };
      case 'typeOn':
        return { opacity: 1, translateY: 0, scale: 1, chars: Math.floor(t / Math.max(0.01, eff)) };
      case 'wave':
        return { opacity: 1, translateY: Math.sin((t * Math.PI * 2) / 1.6) * 6, scale: 1, chars: len };
    }
  }
  const enter = clamp(t / 0.4, 0, 1);
  switch (clip.animation) {
    case 'fade':
      return { opacity: enter, translateY: 0, scale: 1, chars: clip.text.length };
    case 'slide':
      return { opacity: enter, translateY: (1 - enter) * 30, scale: 1, chars: clip.text.length };
    case 'pulse':
      return {
        opacity: 1,
        translateY: 0,
        scale: 1 + 0.05 * Math.sin(t * Math.PI * 3),
        chars: clip.text.length,
      };
    case 'typewriter':
      return { opacity: 1, translateY: 0, scale: 1, chars: Math.floor(t / 0.06) };
    case 'pop': {
      // gyors belépés enyhe túllövéssel
      const p = clamp(t / 0.3, 0, 1);
      const overshoot = p < 1 ? 1.2 * p * (2 - p) : 1;
      return { opacity: clamp(p * 2, 0, 1), translateY: 0, scale: overshoot, chars: clip.text.length };
    }
    case 'shake':
      return {
        opacity: 1,
        translateY: Math.sin(t * Math.PI * 14) * 2,
        scale: 1,
        chars: clip.text.length,
      };
    default:
      return { opacity: 1, translateY: 0, scale: 1, chars: clip.text.length };
  }
}

/** A preset vizuális tulajdonságai — a szöveg- és a doboz-stílust is adja. */
function presetStyles(clip: TextClip, fontSize: number) {
  const preset = clip.stylePreset ?? 'plain';
  switch (preset) {
    case 'bubble':
      return {
        box: {
          backgroundColor: clip.backgroundColor ?? '#000000b3',
          borderRadius: Math.max(8, fontSize * 0.4),
          paddingHorizontal: fontSize * 0.5,
          paddingVertical: fontSize * 0.25,
        },
        text: {
          textShadowColor: 'transparent',
          textShadowRadius: 0,
          textShadowOffset: { width: 0, height: 0 },
        },
      };
    case 'outline':
      return {
        box: { backgroundColor: clip.backgroundColor ?? 'transparent' },
        text: {
          textShadowColor: '#000000',
          textShadowRadius: Math.max(3, fontSize * 0.12),
          textShadowOffset: { width: 0, height: 0 },
          fontWeight: '900' as const,
        },
      };
    case 'neon':
      return {
        box: { backgroundColor: clip.backgroundColor ?? 'transparent' },
        text: {
          textShadowColor: clip.color,
          textShadowRadius: Math.max(8, fontSize * 0.45),
          textShadowOffset: { width: 0, height: 0 },
        },
      };
    default:
      return {
        box: { backgroundColor: clip.backgroundColor ?? 'transparent' },
        text: {
          textShadowColor: '#000000aa',
          textShadowRadius: 4,
          textShadowOffset: { width: 0, height: 1 },
        },
      };
  }
}

export function TextOverlay({
  clip,
  t,
  box,
  editable,
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
      x: clamp(clip.position.x + dx / box.w, 0.02, 0.98),
      y: clamp(clip.position.y + dy / box.h, 0.02, 0.98),
    });
  };

  const pan = Gesture.Pan()
    .enabled(editable)
    .onEnd((e) => {
      runOnJS(commitMove)(e.translationX, e.translationY);
    })
    .onUpdate((e) => {
      dragX.value = e.translationX;
      dragY.value = e.translationY;
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
  const shown =
    clip.animation === 'typewriter' || clip.textMotion?.preset === 'typeOn'
      ? clip.text.slice(0, Math.max(0, anim.chars))
      : clip.text;

  // karaoke: a szavak az idő arányában "gyulladnak fel"; ✨ kiemelt szavaknál
  // (Caption Studio) sima feliraton is szavankénti render megy
  const empSet = new Set(clip.emphasis ?? []);
  let karaokeWords:
    | { word: string; state: 'past' | 'active' | 'next'; emp: boolean }[]
    | null = null;
  if (clip.animation === 'karaoke' || empSet.size > 0) {
    const words = clip.text.split(/\s+/).filter(Boolean);
    if (words.length > 0) {
      // 🎤 szó-szintű időzítés, ha van; enélkül egyenletes elosztás
      const activeIdx =
        clip.animation === 'karaoke'
          ? activeWordIndex(t, words.length, clip.duration, clip.wordTimings)
          : -1;
      karaokeWords = words.map((word, i) => ({
        word,
        state:
          activeIdx < 0
            ? 'past'
            : i < activeIdx
              ? 'past'
              : i === activeIdx
                ? 'active'
                : 'next',
        emp: empSet.has(i),
      }));
    }
  }

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
              maxWidth: '92%',
              transform: [
                { translateY: '-50%' },
                { translateY: anim.translateY },
                // ↕️ alapvonal-eltolás (baseline shift): + = felfelé
                ...(clip.baselineShift
                  ? ([{ translateY: -clip.baselineShift * fontSize }] as const)
                  : []),
                { scale: anim.scale },
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
          {clip.text3d ? (
            // extrúzió-közelítés: sötét mélység-másolat a szöveg mögött
            <Text
              style={{
                position: 'absolute',
                left: fontSize * clip.text3d.depth * 0.12,
                top: fontSize * clip.text3d.depth * 0.12,
                color: '#1c1c24',
                fontSize,
                fontWeight: '800',
                fontFamily: clip.fontFamily,
                textAlign: 'center',
              }}
            >
              {shown}
            </Text>
          ) : null}
          <Text
            style={[
              {
                color: clip.text3d ? text3dFaceColor(clip.text3d, clip.color) : clip.color,
                fontSize,
                fontWeight: clip.text3d ? '800' : clip.fontWeight,
                fontFamily: clip.fontFamily,
                textAlign: 'center',
              },
              clip.text3d ? null : preset.text,
              // 🔡 tipográfia (tracking/leading) + 🎨 stílus-közelítés (a pontos
              // gradient/kontúr a renderben ég be; itt a gradient a from-színnel,
              // a glow/shadow textShadow-val közelít)
              !clip.text3d
                ? {
                    ...(clip.letterSpacing
                      ? { letterSpacing: clip.letterSpacing * fontSize }
                      : null),
                    ...(clip.lineHeight ? { lineHeight: clip.lineHeight * fontSize * 1.2 } : null),
                    ...(clip.textStyle?.gradient ? { color: clip.textStyle.gradient.from } : null),
                    ...(clip.textStyle?.glow
                      ? {
                          textShadowColor: clip.textStyle.glow.color,
                          textShadowRadius: Math.max(4, clip.textStyle.glow.size * fontSize),
                          textShadowOffset: { width: 0, height: 0 },
                        }
                      : clip.textStyle?.shadow
                        ? {
                            textShadowColor: clip.textStyle.shadow.color,
                            textShadowRadius: Math.max(0, clip.textStyle.shadow.blur * fontSize),
                            textShadowOffset: {
                              width: clip.textStyle.shadow.dx * fontSize,
                              height: clip.textStyle.shadow.dy * fontSize,
                            },
                          }
                        : null),
                  }
                : null,
            ]}
          >
            {karaokeWords
              ? karaokeWords.map((w, i) => (
                  <Text
                    key={i}
                    style={[
                      w.state === 'active'
                        ? { color: palette.accent }
                        : w.state === 'next'
                          ? { opacity: 0.45 }
                          : null,
                      // 🧊 3D caption-közelítés: pink + nagyobb + mélység-árnyék
                      // (a valódi extrúzió+perspektíva a renderben ég be)
                      w.emp
                        ? {
                            color: '#ff2ea6',
                            fontWeight: '900',
                            fontSize:
                              fontSize * (w.state === 'active' ? 1.26 : 1.14),
                            opacity: w.state === 'next' ? 0.6 : 1,
                            textShadowColor: '#8f0f5c',
                            textShadowOffset: {
                              width: fontSize * 0.06,
                              height: fontSize * 0.06,
                            },
                            textShadowRadius: 1,
                          }
                        : null,
                    ]}
                  >
                    {w.word}
                    {i < karaokeWords!.length - 1 ? ' ' : ''}
                  </Text>
                ))
              : shown}
          </Text>
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    alignItems: 'center',
  },
  inner: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  selected: {
    borderWidth: 1,
    borderColor: palette.accent,
    borderStyle: 'dashed',
  },
});
