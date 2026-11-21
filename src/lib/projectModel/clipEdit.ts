import { MIN_CLIP_DURATION } from '@/constants/editor';
import { makeId } from '@/lib/id';
import { cropKeyframes } from '@/lib/keyframes';
import type { Clip, ClipKeyframes, VideoClip } from '@/types/project';

/**
 * ✂️ A klip egy idővonal-szakasza `[from, to]` (abszolút idő, a klipen belül) — ÚJ
 * klip ugyanazzal az id-val (a hívó dönt az új id-ról). A forrás-be-pont (`trimIn`)
 * minden fajtán a szakasz elejére ugrik (videó: sebesség- és ⏪ reversed-tudatosan,
 * hang: 1:1), a kulcskockák a szakaszhoz igazodnak (`cropKeyframes`). A vágás, a
 * range-törlés és a hasonló műveletek EZT használják — korábban csak a videó
 * `trimIn`-je és csak a videó/kép kulcskockái követték a vágást (B1/B3/B4).
 */
export function cropClip(clip: Clip, from: number, to: number): Clip {
  const a = from - clip.start;
  const b = to - clip.start;
  const out = { ...clip, start: from, duration: b - a } as Clip;
  if (out.kind === 'video' && clip.kind === 'video') {
    out.trimIn = clip.reversed
      ? clip.trimIn + (clip.duration - b) * clip.speed
      : clip.trimIn + a * clip.speed;
  } else if (out.kind === 'audio' && clip.kind === 'audio' && (a !== 0 || clip.trimIn !== undefined)) {
    const speed = clip.speed && clip.speed > 0 ? clip.speed : 1;
    // ⏪ visszafelé a darab forrása a klip végéről számol (mint a videónál)
    if (clip.loopLength && clip.loopLength > 0) {
      // 🔁 loop-klip: a hurok-ablak marad, csak a fázisa lép előre
      out.trimIn = clip.trimIn ?? 0;
      out.loopOffset = loopPhase(clip.loopLength, (clip.loopOffset ?? 0) + a);
    } else {
      out.trimIn = (clip.trimIn ?? 0) + (clip.reversed ? clip.duration - b : a) * speed;
    }
  }
  if ('keyframes' in clip && clip.keyframes) {
    (out as { keyframes?: ClipKeyframes }).keyframes = cropKeyframes(clip.keyframes, a, b - a);
  }
  // 🎙️ a take-ek az egész felvételi helyre vonatkoznak: a darab a mostani take hangja marad, választó nélkül
  if (out.kind === 'audio' && (a > 0 || b < clip.duration) && out.takes) {
    delete out.takes;
    delete out.activeTake;
  }
  // 🎚️ a fade a klip széléhez tartozik: a vágásnál nem halkulhat el a hang
  if (out.kind === 'audio') {
    if (a > 0) {
      out.fadeIn = 0;
    }
    if (b < clip.duration) {
      out.fadeOut = 0;
    }
  }
  return out;
}

/** 🔁 a hurok fázisa [0, loopLength) között, µs-ra kerekítve (0 közelében 0) */
export function loopPhase(loopLength: number, sec: number): number {
  const v = Math.round((((sec % loopLength) + loopLength) % loopLength) * 1e6) / 1e6;
  return v >= loopLength - 1e-6 ? 0 : v;
}

/** Klip kettévágása a t időpontban; null, ha t nem esik szigorúan a klip belsejébe. */
export function splitClip(clip: Clip, t: number): [Clip, Clip] | null {
  const offset = t - clip.start;
  if (offset < MIN_CLIP_DURATION || clip.duration - offset < MIN_CLIP_DURATION) {
    return null;
  }
  const first = cropClip(clip, clip.start, t);
  const second = { ...cropClip(clip, t, clip.start + clip.duration), id: makeId('clip') } as Clip;
  return [first, second];
}

/** A videóklip jobb széle meddig húzható a forrásanyag alapján (mp, idővonal-időben). */
export function maxVideoDuration(clip: VideoClip): number {
  return (clip.sourceDuration - clip.trimIn) / clip.speed;
}

/**
 * ◀️ Bal-él trim forrás-ablaka: a JOBB él tartalma fix, a bal él `deltaSec`-kel
 * mozdul (>0 rövidít, <0 nyújt). A `deltaSec` már idővonal-clampelt; itt a
 * FORRÁS-korlát + a reversed-tudatos `trimIn`. Előre a `trimIn` nő a kihagyott
 * fronttal; ⏪ reversednél a jobb él a `trimIn`-t tartja (változatlan), a bal-trim
 * csak a felső forrás-boundot (`trimIn + duration*speed`) mozgatja.
 */
export function trimClipLeft(
  clip: VideoClip,
  deltaSec: number
): { start: number; duration: number; trimIn: number } {
  if (clip.reversed) {
    // nyújtáskor (deltaSec<0) nő a duration → a felső bound ≤ sourceDuration korlát
    const minDelta = clip.duration - maxVideoDuration(clip);
    const d = Math.max(deltaSec, minDelta);
    return { start: clip.start + d, duration: clip.duration - d, trimIn: clip.trimIn };
  }
  const d = Math.max(deltaSec, -clip.trimIn / clip.speed);
  return { start: clip.start + d, duration: clip.duration - d, trimIn: clip.trimIn + d * clip.speed };
}

/**
 * ▶️ Jobb-él trim forrás-ablaka: a BAL él tartalma fix, az új hossz `nextDuration`
 * (clampelve). Előre a `trimIn` fix, a hossz ≤ `maxVideoDuration`. ⏪ reversednél a
 * bal él a felső forrás-boundot tartja → a `trimIn` együtt mozog:
 * `newTrimIn = trimIn + (duration - d')*speed` (clamp: `newTrimIn ≥ 0`).
 */
export function trimClipRight(
  clip: VideoClip,
  nextDuration: number
): { duration: number; trimIn: number } {
  if (clip.reversed) {
    const maxD = clip.duration + clip.trimIn / clip.speed; // newTrimIn = 0 határ
    const d = Math.min(Math.max(nextDuration, MIN_CLIP_DURATION), maxD);
    return { duration: d, trimIn: clip.trimIn + (clip.duration - d) * clip.speed };
  }
  const d = Math.min(Math.max(nextDuration, MIN_CLIP_DURATION), maxVideoDuration(clip));
  return { duration: d, trimIn: clip.trimIn };
}
