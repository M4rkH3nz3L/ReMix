import { clamp } from '@/lib/time';
import { activeWordIndex } from '@/lib/wordTiming';
import type { Text3D, TextClip } from '@/types/project';

/**
 * 🔤 Az előnézeti szöveg-réteg (`components/preview/TextOverlay.tsx`) expo-mentes magja:
 * a playheadből számolt animáció, a stílus-preset, a 3D felület-szín, a tipográfia, a
 * második ragyogás-réteg, a gépelt szöveg-szelet és a karaoke-szavak.
 * (REFACTOR: a TextOverlay.tsx-ből kiemelve, a számítás változatlan.)
 */

/** a 3D anyag közelítő felület-színe az előnézetben */
export const STROKE_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]] as const;

export function text3dFaceColor(t3: Text3D, base: string): string {
  switch (t3.material) {
    case 'chrome':
      return '#d5d8e2';
    case 'gold':
      return '#f2c14e';
    default:
      return base;
  }
}

export function bounceOut(x: number): number {
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
export function animatedProps(clip: TextClip, t: number) {
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
export function presetStyles(clip: TextClip, fontSize: number) {
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

/**
 * 🔡 a tipográfia a render CSS-ével azonos: a sorköz CSS-szorzó (alap 1,25, mint a `text-render.js`),
 * a betűköz em-arány — a körvonal-másolatok is ezt kapják, különben többsoros szövegen szétcsúsznak
 * (3D szövegnél nincs)
 */
export function textTypography(clip: TextClip, fontSize: number) {
  return clip.text3d
    ? null
    : {
        lineHeight: (clip.lineHeight && clip.lineHeight > 0 ? clip.lineHeight : 1.25) * fontSize,
        ...(clip.letterSpacing ? { letterSpacing: clip.letterSpacing * fontSize } : null),
      };
}

/** a render második ragyogás-árnyéka: a textStyle-ragyogás belső (g/2) rétege, vagy a neon külső rétege */
export function glowCopyOf(clip: TextClip, fontSize: number) {
  return clip.text3d
    ? null
    : clip.textStyle?.glow && clip.textStyle.glow.size > 0
      ? clip.textStyle.glow.single
        ? null
        : { color: clip.textStyle.glow.color, radius: Math.max(2, clip.textStyle.glow.size * fontSize * 0.5) }
      : (clip.stylePreset ?? 'plain') === 'neon'
        ? { color: clip.color, radius: Math.max(16, fontSize * 0.9) }
        : null;
}

/** a látszó szöveg: gépelés-animációnál az első `chars` karakter */
export function shownText(clip: TextClip, chars: number): string {
  return clip.animation === 'typewriter' || clip.textMotion?.preset === 'typeOn'
    ? clip.text.slice(0, Math.max(0, chars))
    : clip.text;
}

export type KaraokeWord = { word: string; state: 'past' | 'active' | 'next'; emp: boolean };

/**
 * karaoke: a szavak az idő arányában "gyulladnak fel"; ✨ kiemelt szavaknál
 * (Caption Studio) sima feliraton is szavankénti render megy
 */
export function karaokeWordsOf(clip: TextClip, t: number): KaraokeWord[] | null {
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
  return karaokeWords;
}
