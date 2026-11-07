import { gccPhatLag, syncedPlacement, syncTarget, type SyncResult } from '@/lib/audioSync';
import { cropKeyframes } from '@/lib/keyframes';
import { windowPcm16k } from '@/lib/speechEditClient';
import type { AudioClip } from '@/types/project';

/**
 * 🔗 A külső hang szinkronja az eszközön: a ref-klip ±30 s-os környezete és a külső klip első
 * ~12 s-a 16 kHz-en dekódolva; durva keresés 8 kHz-en (GCC-PHAT), majd finomítás 16 kHz-en a
 * talált hely körül. Az eredmény a klip új helye (frame-rácson, a maradék a trimIn-ben).
 */

/** a keresés ±tartománya a klip jelenlegi helyéhez képest (mp) */
export const SYNC_SEARCH_SEC = 30;
const EXT_SEC = 12;

const half = (x: Float32Array) => {
  const out = new Float32Array(Math.floor(x.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = 0.5 * (x[2 * i] + x[2 * i + 1]);
  return out;
};

/** szinkronizálható-e (sebesség, irány, hurok nélkül) */
export const syncable = (c: AudioClip) => (c.speed ?? 1) === 1 && !c.reversed && !(c.loopLength && c.loopLength > 0);

export interface ClipSync extends SyncResult {
  /** a hang szerinti pontos kezdet (mp, idővonal) */
  target: number;
  /** az ext-klip új mezői (`null`: nem maradna belőle semmi) */
  patch: Partial<AudioClip> | null;
}

export async function syncClipTo(ref: AudioClip, ext: AudioClip, fps: number): Promise<ClipSync | null> {
  const SR = 16000;
  const extFrom = ext.trimIn ?? 0;
  const extLen = Math.min(EXT_SEC, ext.duration);
  // a ref ablaka: ahol a külső klip most van, ±30 s — a ref-klipen belül
  const refTrim = ref.trimIn ?? 0;
  const t0 = Math.max(ref.start, ext.start - SYNC_SEARCH_SEC);
  const t1 = Math.min(ref.start + ref.duration, ext.start + extLen + SYNC_SEARCH_SEC);
  if (t1 - t0 < 1) return null;
  const refFrom = refTrim + (t0 - ref.start);
  const [refPcm, extPcm] = [
    await windowPcm16k(ref.uri, refFrom, refTrim + (t1 - ref.start), ref.sourceDuration),
    await windowPcm16k(ext.uri, extFrom, extFrom + extLen, ext.sourceDuration),
  ];
  if (!refPcm || !extPcm || refPcm.length < SR || extPcm.length < SR / 2) return null;
  await new Promise((resolve) => setTimeout(resolve, 0));
  const coarse = gccPhatLag(half(refPcm), half(extPcm), SR / 2);
  await new Promise((resolve) => setTimeout(resolve, 0));
  // finomítás 16 kHz-en: a ref a talált hely körül (±0,25 s)
  const a = Math.max(0, Math.floor((coarse.lag - 0.25) * SR));
  const b = Math.min(refPcm.length, Math.ceil((coarse.lag + extLen + 0.25) * SR));
  let lag = coarse.lag;
  if (b - a > extPcm.length / 2) {
    const fine = gccPhatLag(refPcm.subarray(a, b), extPcm, SR, 0.3);
    if (Math.abs(a / SR + fine.lag - coarse.lag) < 0.002) lag = a / SR + fine.lag;
  }
  const target = syncTarget(ref, refFrom, ext, extFrom, lag);
  const place = syncedPlacement(ext, target, fps);
  if (!place) return { ...coarse, lag, target, patch: null };
  const skip = place.trimIn - (ext.trimIn ?? 0);
  const patch: Partial<AudioClip> = { ...place };
  if (ext.keyframes && skip > 0) patch.keyframes = cropKeyframes(ext.keyframes, skip, place.duration);
  return { ...coarse, lag, target, patch };
}
