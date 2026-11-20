import { sampleChannel } from '@/lib/keyframes';

import type { OfflineMixClip } from './model';

/** A klip-helyi `t` időpont erősítése (hangerő-automáció × fade be × fade ki × sáv). */
export function clipGainAt(clip: OfflineMixClip, t: number): number {
  return sampleChannel(clip.volumeKf, t, clip.volume) * clip.gain * fadeAt(clip, t);
}

export function fadeAt(clip: OfflineMixClip, t: number): number {
  let g = 1;
  if (clip.fadeIn > 0) {
    g *= Math.min(1, Math.max(0, t / clip.fadeIn));
  }
  if (clip.fadeOut > 0) {
    g *= Math.min(1, Math.max(0, (clip.duration - t) / clip.fadeOut));
  }
  return g;
}

/** Lineáris balansz (a szerver `panFilter`/`panChain` törvénye). */
export function panGains(pan: number): [number, number] {
  const p = Math.max(-1, Math.min(1, pan));
  return [1 - Math.max(0, p), 1 - Math.max(0, -p)];
}
