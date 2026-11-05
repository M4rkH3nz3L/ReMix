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
 * idővonal-másodperc `speed` forrás-másodperc. `reversed` nincs.
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
  const lo = Math.max(-trimIn / speed, -clip.start); // nem a forrás elé ÉS nem 0 elé
  const hi = clip.duration - MIN_CLIP_DURATION; // maradjon legalább MIN hossz
  const d = Math.min(Math.max(deltaSec, lo), Math.max(lo, hi));
  const duration = clip.duration - d;
  return {
    start: clip.start + d,
    duration,
    trimIn: trimIn + d * speed,
    // az automáció a hanghoz tartozik: a kulcskockák a forrás-idejükön maradnak
    ...(clip.keyframes ? { keyframes: cropKeyframes(clip.keyframes, d, duration) } : {}),
  };
}

/**
 * ▶ Jobb-él trim: a bal él (start/trimIn) FIX, az új hossz `nextDuration`
 * clampelve `[MIN_CLIP_DURATION, sourceDuration − trimIn]`-re (a forrás-hossz a
 * felső korlát — nem nyújtható a valós hang végén túl).
 */
export function trimAudioRight(clip: AudioClip, nextDuration: number): { duration: number } {
  const max = Math.max(MIN_CLIP_DURATION, (sourceOf(clip) - trimInOf(clip)) / audioSpeedOf(clip));
  return { duration: Math.min(Math.max(nextDuration, MIN_CLIP_DURATION), max) };
}
