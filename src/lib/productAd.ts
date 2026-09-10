import { MOTION_PACKS } from '@/lib/motionPacks';
import type { Clip, TextClip, VideoClip } from '@/types/project';

/**
 * 🛍️ Product showcase (🧊 3D V2): „Készíts 10 mp-es termékvideót" — a
 * meglévő jelekre épül: a **best-shot pontszámok** választják ki a legjobban
 * kinéző pillanatokat, a **Product look** (orbit-kamera + dissolve + studio
 * fény) adja a stílust, a cím/CTA pedig felirat-klipként kerül rá.
 * Pure, tesztelhető — a hálózati rész (pontozás, AI-cím) a hívóé.
 */

export interface ProductShot {
  /** forrás-idő a klipben (mp) */
  t: number;
  score: number;
  faces: number;
}

export interface ProductAdPlan {
  /** az új videósáv (a kiválasztott szeletek, product-stílussal) */
  clips: Clip[];
  /** cím + CTA felirat-klipek */
  captions: TextClip[];
  /** hány szeletből áll */
  shots: number;
  totalSeconds: number;
}

const MIN_SHOT = 1.2;
const MAX_SHOT = 2.2;

/**
 * @param source a forrás videóklip (az első a sávon)
 * @param shots best-shot pontszámok FORRÁS-időben
 * @param opts cél-hossz + a szöveg-tartalom + id-gyártó
 */
export function buildProductAdPlan(
  source: VideoClip,
  shots: ProductShot[],
  opts: {
    targetSeconds?: number;
    headline?: string;
    cta?: string;
    makeId: () => string;
  }
): ProductAdPlan | null {
  const target = Math.max(4, Math.min(30, opts.targetSeconds ?? 10));
  const spec = MOTION_PACKS.product;
  const srcStart = source.trimIn;
  const srcEnd = source.trimIn + source.duration * source.speed;
  const usable = shots
    .filter((s) => s.t >= srcStart && s.t < srcEnd - MIN_SHOT * source.speed)
    .sort((a, b) => b.score - a.score);
  if (usable.length === 0) {
    return null;
  }

  // minőség-kapu: a legjobbhoz képest gyenge kockák kimaradnak (termékvideóba
  // ne kerüljön életlen/rossz snitt) — de legalább 3 szeletet megtartunk
  const best = usable[0].score;
  const QUALITY_FLOOR = 0.6;
  const strong = usable.filter((s) => s.score >= best * QUALITY_FLOOR);
  const pool = strong.length >= 3 ? strong : usable.slice(0, 3);

  // a legjobbak, időben legalább egy minimum-hossznyira egymástól
  const picked: ProductShot[] = [];
  const maxShots = Math.max(2, Math.ceil(target / MIN_SHOT));
  for (const shot of pool) {
    if (picked.every((p) => Math.abs(p.t - shot.t) >= MIN_SHOT * source.speed)) {
      picked.push(shot);
    }
    if (picked.length >= maxShots) {
      break;
    }
  }
  picked.sort((a, b) => a.t - b.t);
  if (picked.length === 0) {
    return null;
  }
  // a cél-hossz a KIVÁLASZTOTT szeletek közt oszlik el — kevés jelöltnél
  // hosszabb snittek, sok jelöltnél pörgősebb vágás (a határokon belül)
  const perShot = Math.min(MAX_SHOT, Math.max(MIN_SHOT, target / picked.length));

  const clips: Clip[] = [];
  let cursor = 0;
  picked.forEach((shot, i) => {
    const isLast = i === picked.length - 1;
    const duration = Math.min(
      perShot,
      (srcEnd - shot.t) / source.speed,
      Math.max(0.5, target - cursor)
    );
    if (duration < 0.4) {
      return;
    }
    clips.push({
      ...source,
      id: opts.makeId(),
      start: cursor,
      duration,
      trimIn: shot.t,
      lighting: spec.lighting,
      keyframes: undefined,
      transitionOut: isLast
        ? undefined
        : { type: spec.transitions[0], duration: spec.transitionDuration },
    } as VideoClip);
    cursor += duration;
  });
  if (clips.length === 0) {
    return null;
  }

  // az utolsó klip átmenete lekerül (a lista végén nincs mibe átmenni)
  const last = clips[clips.length - 1] as VideoClip;
  last.transitionOut = undefined;

  const captions: TextClip[] = [];
  const caption = (text: string, start: number, duration: number, y: number): TextClip => ({
    kind: 'text',
    id: opts.makeId(),
    start,
    duration,
    text,
    color: '#ffffff',
    backgroundColor: null,
    fontSize: 7,
    fontWeight: 'bold',
    position: { x: 0.5, y },
    animation: 'pop',
    stylePreset: 'outline',
  });
  if (opts.headline) {
    captions.push(caption(opts.headline, 0, Math.min(2.5, cursor * 0.35), 0.22));
  }
  if (opts.cta) {
    const ctaLen = Math.min(2.5, cursor * 0.3);
    captions.push(caption(opts.cta, Math.max(0, cursor - ctaLen), ctaLen, 0.8));
  }

  return {
    clips,
    captions,
    shots: clips.length,
    totalSeconds: Math.round(cursor * 10) / 10,
  };
}
