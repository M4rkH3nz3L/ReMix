import type { OfflineMixClip } from '@/lib/offlineMix';
import { clipGainAt } from '@/lib/offlineMix';
import type { WaveformData } from '@/lib/waveform';

/**
 * 📶 Élő szintmérő (PRO-AUDIO 17/8) — pure. A sáv csúcsszintje a lejátszófejnél: a forrás
 * hullámforma-csúcsa (64 / mp, a telefon számolja) × a klip tényleges erősítése (hangerő-
 * automáció, fade, mikro-fade, sáv- és master-erősítés — UGYANAZ, mint az exportban). Az
 * átfedő klipek csúcsai összeadódnak (felső becslés: a túlvezérlés-jelzés így nem marad le).
 * Platformfüggetlen, mikrofon-engedély nélkül; az effekt-láncot (Pro, renderben) nem méri.
 */
export const CLIP_LEVEL = 0.999;

export function trackLevelAt(
  clips: OfflineMixClip[],
  waveOf: (uri: string) => WaveformData | null | undefined,
  t: number
): number {
  let level = 0;
  for (const c of clips) {
    if (t < c.start || t >= c.start + c.duration) {
      continue;
    }
    const wave = waveOf(c.uri);
    if (!wave) {
      continue;
    }
    const src = c.trimIn + (t - c.start);
    const peak = wave.peaks[Math.floor(src * wave.peaksPerSecond)] ?? 0;
    level += peak * clipGainAt(c, t - c.start);
  }
  return level;
}

/** szint → dBFS (a csend −∞ helyett −60) */
export function levelDb(level: number): number {
  return level > 0.001 ? 20 * Math.log10(level) : -60;
}

/** a mérő kitöltése 0–1: −60 … 0 dBFS lineárisan dB-ben (a 0 fölötti túlvezérlés 1) */
export function meterFill(level: number): number {
  return Math.max(0, Math.min(1, (levelDb(level) + 60) / 60));
}
