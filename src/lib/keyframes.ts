import type {
  CanvasTransform,
  Clip,
  ClipKeyframes,
  ImageClip,
  Keyframe,
  KeyframeEasing,
  VideoClip,
} from '@/types/project';

/**
 * Kulcskocka-motor (P0‑5) — pure, expo-mentes modul. A render-oldali
 * kifejezés-építő (server/render.js) UGYANEZEKET a görbéket használja —
 * változtatásnál a kettőt együtt kell módosítani (előnézet/render paritás).
 */

/** két kulcskocka ennyin belül "ugyanaz az időpont" (csere, nem beszúrás) */
export const KF_EPS = 0.05;

export const KEYFRAME_CHANNELS = ['scale', 'x', 'y', 'rotation', 'opacity', 'volume'] as const;
export type KeyframeChannel = (typeof KEYFRAME_CHANNELS)[number];

const EASE_FNS: Record<Exclude<KeyframeEasing, 'bezier'>, (p: number) => number> = {
  linear: (p) => p,
  easeIn: (p) => p * p,
  easeOut: (p) => 1 - (1 - p) * (1 - p),
  easeInOut: (p) => p * p * (3 - 2 * p), // smoothstep
};

/**
 * A preset-easingek köbös-Bézier vezérpontjai (CSS-konvenció) — a Graph Editor
 * ezzel inicializálja a fogókat, amikor a felhasználó „egyénire" (bezier) vált.
 */
export const PRESET_BEZIER: Record<Exclude<KeyframeEasing, 'bezier'>, [number, number, number, number]> = {
  linear: [0, 0, 1, 1],
  easeIn: [0.42, 0, 1, 1],
  easeOut: [0, 0, 0.58, 1],
  easeInOut: [0.42, 0, 0.58, 1],
};

/**
 * Köbös-Bézier easing: a `p` idő-frakcióhoz (0–1) tartozó ÉRTÉK, a
 * `[x1,y1,x2,y2]` vezérpontokkal (végpontok 0,0 és 1,1). Mivel az `x(u)=p`
 * nincs zárt alakban, felezéssel keressük az `u` paramétert (robusztus, ~1e-6).
 * A render (server/render.js) UGYANEZT a görbét finom lineáris lépcsőkre süti.
 */
export function bezierEase(cp: [number, number, number, number], p: number): number {
  if (p <= 0) {
    return 0;
  }
  if (p >= 1) {
    return 1;
  }
  const [x1, y1, x2, y2] = cp;
  const bx = (u: number) => {
    const v = 1 - u;
    return 3 * v * v * u * x1 + 3 * v * u * u * x2 + u * u * u;
  };
  const by = (u: number) => {
    const v = 1 - u;
    return 3 * v * v * u * y1 + 3 * v * u * u * y2 + u * u * u;
  };
  let lo = 0;
  let hi = 1;
  let u = p;
  for (let i = 0; i < 24; i++) {
    u = (lo + hi) / 2;
    const x = bx(u);
    if (Math.abs(x - p) < 1e-5) {
      break;
    }
    if (x < p) {
      lo = u;
    } else {
      hi = u;
    }
  }
  return by(u);
}

/** A kulcskocka easingjének görbéje a `p` (0–1) idő-frakción. */
export function easeValue(kf: Keyframe, p: number): number {
  if (kf.easing === 'bezier' && kf.bezier) {
    return bezierEase(kf.bezier, p);
  }
  return EASE_FNS[kf.easing === 'bezier' ? 'easeInOut' : kf.easing](p);
}

/** Egy csatorna mintavétele t-nél; szélek előtt/után az érték tartva. */
export function sampleChannel(
  kfs: Keyframe[] | undefined,
  t: number,
  fallback: number
): number {
  if (!kfs || kfs.length === 0) {
    return fallback;
  }
  if (t <= kfs[0].time) {
    return kfs[0].value;
  }
  const last = kfs[kfs.length - 1];
  if (t >= last.time) {
    return last.value;
  }
  for (let i = 0; i < kfs.length - 1; i++) {
    const a = kfs[i];
    const b = kfs[i + 1];
    if (t < b.time) {
      const span = b.time - a.time;
      const p = span > 0 ? (t - a.time) / span : 1;
      return a.value + (b.value - a.value) * easeValue(a, p);
    }
  }
  return last.value;
}

const IDENTITY: CanvasTransform = { scale: 1, x: 0, y: 0 };

/**
 * A klip effektív transzformja a klipen belüli t időpontban: a kulcskockás
 * csatornák interpolálva, a többi (rotation) a statikus transformból.
 */
export function sampleClipTransform(
  clip: VideoClip | ImageClip,
  t: number
): CanvasTransform {
  const base = clip.transform ?? IDENTITY;
  const k = clip.keyframes;
  if (!k) {
    return base;
  }
  return {
    ...base,
    scale: sampleChannel(k.scale, t, base.scale),
    x: sampleChannel(k.x, t, base.x),
    y: sampleChannel(k.y, t, base.y),
    rotation: sampleChannel(k.rotation, t, base.rotation ?? 0),
  };
}

export function hasKeyframes(clip: Clip): boolean {
  if (clip.kind !== 'video' && clip.kind !== 'image') {
    return false;
  }
  const k = clip.keyframes;
  return Boolean(k && KEYFRAME_CHANNELS.some((c) => (k[c]?.length ?? 0) > 0));
}

/** Kulcskocka beszúrása/cseréje (KF_EPS-en belül csere) — új, rendezett tömb. */
export function setChannelKeyframe(
  kfs: Keyframe[] | undefined,
  time: number,
  value: number,
  easing: KeyframeEasing
): Keyframe[] {
  const next = (kfs ?? []).filter((kf) => Math.abs(kf.time - time) > KF_EPS);
  next.push({ time, value, easing });
  next.sort((a, b) => a.time - b.time);
  return next;
}

/** Az összes csatorna kulcskocka-időpontjai (egyedi, rendezett). */
export function keyframeTimes(k: ClipKeyframes | undefined): number[] {
  if (!k) {
    return [];
  }
  const times: number[] = [];
  for (const channel of KEYFRAME_CHANNELS) {
    for (const kf of k[channel] ?? []) {
      if (!times.some((t) => Math.abs(t - kf.time) <= KF_EPS)) {
        times.push(kf.time);
      }
    }
  }
  return times.sort((a, b) => a - b);
}

/** A time körüli (±KF_EPS) kulcskockák törlése minden csatornáról. */
export function removeKeyframesAt(
  k: ClipKeyframes | undefined,
  time: number
): ClipKeyframes | undefined {
  if (!k) {
    return undefined;
  }
  const next: ClipKeyframes = {};
  let any = false;
  for (const channel of KEYFRAME_CHANNELS) {
    const kept = (k[channel] ?? []).filter((kf) => Math.abs(kf.time - time) > KF_EPS);
    if (kept.length > 0) {
      next[channel] = kept;
      any = true;
    }
  }
  return any ? next : undefined;
}

/**
 * Pozíció-kulcskockák eltolása (P0‑6): húzáskor a teljes követett pálya
 * együtt mozog a réteggel (a track alakja megmarad).
 */
export function shiftPositionKeyframes(
  k: ClipKeyframes,
  dx: number,
  dy: number
): ClipKeyframes {
  const move = (kfs: Keyframe[] | undefined, d: number) =>
    kfs?.map((kf) => ({ ...kf, value: Math.max(0, Math.min(1, kf.value + d)) }));
  return { ...k, x: move(k.x, dx), y: move(k.y, dy) };
}

/**
 * Kulcskockák szétosztása klip-kettévágásnál: az első rész a vágás előttieket
 * tartja meg, a második a vágás utániakat a vágáshoz igazított idővel.
 */
export function splitKeyframes(
  k: ClipKeyframes | undefined,
  offset: number
): [ClipKeyframes | undefined, ClipKeyframes | undefined] {
  if (!k) {
    return [undefined, undefined];
  }
  const first: ClipKeyframes = {};
  const second: ClipKeyframes = {};
  let anyFirst = false;
  let anySecond = false;
  for (const channel of KEYFRAME_CHANNELS) {
    const kfs = k[channel] ?? [];
    const before = kfs.filter((kf) => kf.time <= offset);
    const after = kfs
      .filter((kf) => kf.time > offset)
      .map((kf) => ({ ...kf, time: kf.time - offset }));
    if (before.length > 0) {
      first[channel] = before;
      anyFirst = true;
    }
    if (after.length > 0) {
      second[channel] = after;
      anySecond = true;
    }
  }
  return [anyFirst ? first : undefined, anySecond ? second : undefined];
}
