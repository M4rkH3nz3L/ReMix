/**
 * 🔗 KÖZÖS átmenet-spec (VIDEO 01.1 — előnézet⇄render paritás).
 *
 * Az átmenetek (klip `transitionOut`) a RENDERBEN valódi FFmpeg xfade-ek; az
 * ELŐNÉZET korábban a legtöbb típust csak opacity-fade-del közelítette. Ez a
 * modul az EGYETLEN forrás a típus→xfade-mód leképezéshez ÉS a preview-geometria
 * közelítéshez — a `server/render.js` ugyanezt az XFADE-mapet exportálja, és a
 * `contract.test.ts` zárolja, hogy a kettő nem driftel.
 *
 * PURE / expo-mentes: csak szám-matek, semmi RN/Expo import → önmagában tesztelhető.
 */
import type { TransitionOut } from '@/types/project';

/** a 17 kanonikus átmenet-típus (a `TransitionOut.type` union-ból vezetve, nem duplikálva) */
export type TransitionType = TransitionOut['type'];

/** 🧭 irány (az irányos xfade-variánst választja) — a `TransitionOut.direction`-ből */
export type TransitionDirection = NonNullable<TransitionOut['direction']>;

/**
 * Kanonikus típus→FFmpeg-xfade-alapmód leképezés. PONTOSAN a `server/render.js`
 * `XFADE_MODES` értékeivel egyezik (a contract-teszt `toEqual`-lal zárolja).
 */
export const TRANSITION_XFADE: Record<TransitionType, string> = {
  zoom: 'zoomin',
  spin: 'squeezeh',
  flip: 'squeezev',
  cube: 'smoothleft',
  circle: 'circleopen',
  dissolve: 'dissolve',
  // 2D átmenetek — közvetlen ffmpeg xfade-nevek
  wipeLeft: 'wipeleft',
  wipeRight: 'wiperight',
  wipeUp: 'wipeup',
  wipeDown: 'wipedown',
  slideLeft: 'slideleft',
  slideRight: 'slideright',
  pixelize: 'pixelize',
  blur: 'hblur',
  fadeBlack: 'fadeblack',
  fadeWhite: 'fadewhite',
  radial: 'radial',
};

/**
 * Az effektív xfade-mód a típus + opcionális irány szerint — UGYANAZ a logika,
 * mint a szerveren (`server/render.js` `xfadeMode()`): az irányos családoknál
 * (wipe/slide/cube) az irány az xfade-variánst váltja, különben az alapmód.
 */
export function xfadeMode(type: TransitionType, direction?: TransitionDirection): string {
  const base = TRANSITION_XFADE[type];
  if (direction) {
    if (type.startsWith('wipe')) return `wipe${direction}`;
    if (type.startsWith('slide')) return `slide${direction}`;
    if (type === 'cube') return `smooth${direction}`;
  }
  return base;
}

/** A bejövő (B) klipre alkalmazandó előnézet-geometria (RN-transformra képezve). */
export interface TransitionGeometry {
  /** 0…1 — a B réteg átlátszósága (hiányzó = teljesen látszik) */
  opacity?: number;
  /** px — vízszintes eltolás (box.w-hez mérten) */
  translateX?: number;
  /** px — függőleges eltolás (box.h-hoz mérten) */
  translateY?: number;
  /** méret-szorzó (1 = natív) */
  scale?: number;
  /** z-tengely körüli forgás fokban */
  rotateDeg?: number;
  /** y-tengely körüli forgás fokban (flip) */
  rotateYDeg?: number;
  /** perspektíva-mélység px (rotateY-hoz) */
  perspective?: number;
}

/** irány-szuffixból (wipeLeft/slideUp/…) kiolvasott alapirány, vagy null */
function suffixDirection(type: TransitionType): TransitionDirection | null {
  if (type.endsWith('Left')) return 'left';
  if (type.endsWith('Right')) return 'right';
  if (type.endsWith('Up')) return 'up';
  if (type.endsWith('Down')) return 'down';
  return null;
}

/**
 * PURE előnézet-geometria a bejövő (B) klipre az átmenet-ablak 0…1 haladásánál.
 * `progress=0` → B még kint/rejtve, `progress=1` → B teljesen bent/látható.
 *
 * Fedi mind a 17 típust: az irányosak (wipe/slide/cube) csúsznak, a zoom/spin/
 * flip/circle/radial valódi 3D-szerű mozgást kap; a pixelize/blur/dissolve és a
 * fadeBlack/fadeWhite kereszttűnés — ezeknél a PONTOS hatás a renderben ég be
 * (az xfade-mód a `TRANSITION_XFADE`-ben), a preview csak jelzi az átmenetet.
 */
export function transitionPreviewGeometry(
  type: TransitionType,
  direction: TransitionDirection | undefined,
  progress: number,
  box: { w: number; h: number }
): TransitionGeometry {
  const p = Math.max(0, Math.min(1, progress));
  // az effektív irány: explicit `direction`, különben a típus-szuffix (wipeLeft…)
  const dir = direction ?? suffixDirection(type);

  switch (type) {
    // 🧭 irányos csúszás: a B klip az irányból úszik be (a renderben wipe/slide xfade).
    // A régi preview-viselkedés alapja: wipeLeft/slideLeft → jobbról be, stb.
    case 'wipeLeft':
    case 'wipeRight':
    case 'wipeUp':
    case 'wipeDown':
    case 'slideLeft':
    case 'slideRight':
      return directionalSlide(dir, p, box);

    // 🧊 cube: irányos csúszás-közelítés (a renderben smooth{dir} xfade)
    case 'cube':
      return directionalSlide(dir ?? 'left', p, box);

    // 🔍 zoom: beúszó nagyítás (nagyból a natívra) + kereszttűnés
    case 'zoom':
      return { opacity: p, scale: 1.35 - 0.35 * p };

    // 🔄 spin: beforgás + beúszó méret + kereszttűnés
    case 'spin':
      return { opacity: p, rotateDeg: (1 - p) * 90, scale: 0.6 + 0.4 * p };

    // 🔃 flip: perspektivikus y-billenés
    case 'flip':
      return {
        opacity: Math.min(1, p * 1.6),
        perspective: box.h * 1.2,
        rotateYDeg: (1 - p) * 90,
      };

    // ⭕ circle / radial: középről nyíló közelítés (kis méretből teljesre) + kereszttűnés
    case 'circle':
    case 'radial':
      return { opacity: p, scale: 0.5 + 0.5 * p };

    // 🟫 pixelize / 🌫️ blur: kereszttűnés — a PONTOS pixel/blur-hatás a renderben ég
    // be (pixelize / hblur xfade); a preview csak az átmenetet jelzi.
    case 'pixelize':
    case 'blur':
      return { opacity: p };

    // ✨ dissolve: tiszta kereszttűnés (a render is dissolve/custom-expr)
    case 'dissolve':
      return { opacity: p };

    // ⚫⚪ fadeBlack / fadeWhite: a B klip beúszik; a szín-áttűnő overlay-t a
    // komponens kezeli (a fade-through a transition közepén a legerősebb).
    case 'fadeBlack':
    case 'fadeWhite':
      return { opacity: p };

    default:
      return { opacity: p };
  }
}

/**
 * Irányos csúszás: a B klip az adott irányból úszik be. `progress=0` → teljesen
 * kint, `progress=1` → helyén (eltolás 0). Az eltolás előjele az iránnyal fordul.
 */
function directionalSlide(
  dir: TransitionDirection | null,
  p: number,
  box: { w: number; h: number }
): TransitionGeometry {
  const off = 1 - p;
  switch (dir) {
    case 'left':
      // a kimenet balra tart → a B jobbról (pozitív X) úszik be
      return { translateX: off * box.w };
    case 'right':
      return { translateX: -off * box.w };
    case 'up':
      return { translateY: off * box.h };
    case 'down':
      return { translateY: -off * box.h };
    default:
      return { translateX: off * box.w };
  }
}

/** Kis easing-helper (pure) — a preview-ban igény szerint eased progresshez. */
export function easeProgress(
  easing: NonNullable<TransitionOut['easing']> | undefined,
  p: number
): number {
  const t = Math.max(0, Math.min(1, p));
  switch (easing) {
    case 'easeIn':
      return t * t;
    case 'easeOut':
      return 1 - (1 - t) * (1 - t);
    case 'easeInOut':
      return t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);
    default:
      return t;
  }
}
