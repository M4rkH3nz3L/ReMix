import type { AudioClip } from '@/types/project';

/**
 * 🥁↔️ Klip ütemhez nyújtása — tiszta mag. A klip forrás-tempója (`sourceBpm`) és a projekt tempója
 * aránya a lejátszási sebesség (hangmagasság-tartással — a meglévő nyújtó út: előnézet, telefonos és
 * szerveres export), a forrás-szakasz ugyanaz marad, így a klip hossza a tempó arányában változik.
 * 120 BPM-es minta 100 BPM-es projektben: sebesség 0,8333, az ütések 0,5 helyett 0,6 s-onként.
 */
export const TEMPO_SPEED_MIN = 0.5;
export const TEMPO_SPEED_MAX = 2;

export function tempoMatchPatch(clip: AudioClip, sourceBpm: number, projectBpm: number): Partial<AudioClip> | null {
  if (!(sourceBpm > 0) || !(projectBpm > 0) || clip.reversed || clip.loopLength) return null;
  const speed = projectBpm / sourceBpm;
  if (speed < TEMPO_SPEED_MIN - 1e-9 || speed > TEMPO_SPEED_MAX + 1e-9) return null;
  const span = clip.duration * (clip.speed ?? 1);
  return { sourceBpm, speed, duration: span / speed };
}

/** a nyújtás visszavonása (eredeti tempó): sebesség 1, a hossz a forrás-szakasz */
export function tempoResetPatch(clip: AudioClip): Partial<AudioClip> {
  return { speed: 1, duration: clip.duration * (clip.speed ?? 1) };
}
