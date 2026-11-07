import { MIN_CLIP_DURATION } from '@/constants/editor';
import { cropKeyframes } from '@/lib/keyframes';
import type { AudioClip } from '@/types/project';

/**
 * ✂️ Audio-klip trim-matematika (store-mentes, tesztelt).
 *
 * Az AudioClip `trimIn` (forráson belüli kezdet) és `sourceDuration` (teljes
 * forrás-hossz) mezői OPCIONÁLISAK — hiányzó `trimIn` = 0, hiányzó `sourceDuration`
 * = a jelenlegi `duration` (nincs tartalék → csak rövidíteni lehet). A trim ennyin
 * belül mozoghat. ⏩ A `speed` (hiányzó = 1) a gyorsított videóklip leválasztott hangjáé: egy
 * idővonal-másodperc `speed` forrás-másodperc. ⏪ `reversed`: ugyanaz a forrás-ablak, a végéről.
 */
const trimInOf = (c: AudioClip): number => c.trimIn ?? 0;
/** ⏩ a hangklip sebessége (hiányzó = 1) */
export const audioSpeedOf = (c: Pick<AudioClip, 'speed'>): number => (c.speed && c.speed > 0 ? c.speed : 1);
const sourceOf = (c: AudioClip): number => c.sourceDuration ?? c.duration * audioSpeedOf(c);

/**
 * ◀ Bal-él trim: a timeline-kezdet ÉS a forrás be-pontja (trimIn) EGYÜTT mozog.
 * `deltaSec > 0` = jobbra húzás (balról rövidül); `< 0` = balra (hosszabbodik,
 * ameddig a forrásban van tartalék). Korlátok: `trimIn ≥ 0`, `start ≥ 0`,
 * `duration ≥ MIN_CLIP_DURATION`.
 */
export function trimAudioLeft(
  clip: AudioClip,
  deltaSec: number
): { start: number; duration: number; trimIn: number; keyframes?: AudioClip['keyframes'] } {
  const trimIn = trimInOf(clip);
  const speed = audioSpeedOf(clip);
  // ⏪ visszafelé a bal él a forrás VÉGE: a trimIn marad, a nyújtás a forrás végéig mehet
  const room = clip.reversed ? sourceOf(clip) - (trimIn + clip.duration * speed) : trimIn;
  const lo = Math.max(-room / speed, -clip.start); // nem a forrás szélén túl ÉS nem 0 elé
  const hi = clip.duration - MIN_CLIP_DURATION; // maradjon legalább MIN hossz
  const d = Math.min(Math.max(deltaSec, lo), Math.max(lo, hi));
  const duration = clip.duration - d;
  return {
    start: clip.start + d,
    duration,
    trimIn: clip.reversed ? trimIn : trimIn + d * speed,
    // az automáció a hanghoz tartozik: a kulcskockák a forrás-idejükön maradnak
    ...(clip.keyframes ? { keyframes: cropKeyframes(clip.keyframes, d, duration) } : {}),
  };
}

/**
 * ▶ Jobb-él trim: a bal él (start/trimIn) FIX, az új hossz `nextDuration`
 * clampelve `[MIN_CLIP_DURATION, sourceDuration − trimIn]`-re (a forrás-hossz a
 * felső korlát — nem nyújtható a valós hang végén túl).
 */
export function trimAudioRight(clip: AudioClip, nextDuration: number): { duration: number; trimIn?: number } {
  const speed = audioSpeedOf(clip);
  const trimIn = trimInOf(clip);
  if (clip.reversed) {
    // ⏪ visszafelé a jobb él a forrás ELEJE: a hossz-változás a trimIn-t mozgatja (≥ 0)
    const max = Math.max(MIN_CLIP_DURATION, clip.duration + trimIn / speed);
    const duration = Math.min(Math.max(nextDuration, MIN_CLIP_DURATION), max);
    return { duration, trimIn: Math.max(0, Math.round((trimIn + (clip.duration - duration) * speed) * 1e9) / 1e9) };
  }
  // 🔁 loop-klip: a jobb él a forrás végén túl is húzható (a minta ismétlődik), legfeljebb 1 óra
  const max = clip.loopLength && clip.loopLength > 0 ? 3600 : Math.max(MIN_CLIP_DURATION, (sourceOf(clip) - trimIn) / speed);
  return { duration: Math.min(Math.max(nextDuration, MIN_CLIP_DURATION), max) };
}

/**
 * ✂️ Két egymás utáni hangklip a forrásban is folytatja egymást (a kettévágott klip
 * illesztése) — ott nincs mikro-fade. Visszafelé a bal darab forrása a jobb darabé UTÁN van.
 */
export function continuesInSource(
  prev: Pick<AudioClip, 'trimIn' | 'duration' | 'speed' | 'reversed'>,
  next: Pick<AudioClip, 'trimIn' | 'duration' | 'speed' | 'reversed'>,
  eps: number
): boolean {
  if (!!prev.reversed !== !!next.reversed) {
    return false;
  }
  const p = prev.trimIn ?? 0;
  const n = next.trimIn ?? 0;
  return prev.reversed
    ? Math.abs(n + next.duration * audioSpeedOf(next) - p) < eps
    : Math.abs(p + prev.duration * audioSpeedOf(prev) - n) < eps;
}

/** az előnézet (expo-audio) hangmagasság-tartó sebesség-tartománya */
export const PREVIEW_RATE_MIN = 0.5;
export const PREVIEW_RATE_MAX = 2;

/**
 * ⏩⏪ Az előnézethez előre nyújtott/megfordított szakasz kell-e: a lejátszó visszafelé nem
 * játszik, és hangmagasság-tartással csak 0,5–2× között gyorsít.
 */
export function needsStretchProxy(c: Pick<AudioClip, 'speed' | 'reversed'>): boolean {
  const speed = audioSpeedOf(c);
  return !!c.reversed || speed < PREVIEW_RATE_MIN || speed > PREVIEW_RATE_MAX;
}
