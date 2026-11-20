import type { TFunction } from 'i18next';

import { maxClipFade } from '@/lib/clipGain';
import { clamp } from '@/lib/time';
import type { AudioClip, AudioFx, Project, TextClip } from '@/types/project';

/**
 * 🎛️ A videó-szerkesztő hang-paneljének expo-mentes magja: a keverő- és
 * audio-FX-léptetők szabályai, a beat-rács forrása és a dub-szöveg.
 * (REFACTOR: az AudioPanel.tsx-ből kiemelve, a számítás változatlan.)
 */

export const round1 = (n: number) => Math.round(n * 10) / 10;

/** a pásztázás felirata: középen „közép", különben oldal + százalék */
export const panLabel = (p: number, t: TFunction) =>
  Math.abs(p) < 0.05
    ? t('panels.audio.panCenter')
    : `${p < 0 ? t('panels.audio.panL') : t('panels.audio.panR')} ${Math.round(Math.abs(p) * 100)}%`;

/** pásztázás ±0,2-es lépésben, tizedre kerekítve, -1…1 között */
export function stepPan(pan: number | undefined, dir: -1 | 1): number {
  return dir < 0 ? clamp(round1((pan ?? 0) - 0.2), -1, 1) : clamp(round1((pan ?? 0) + 0.2), -1, 1);
}

/** fade ±0,5 s-es lépésben, legfeljebb a klip feléig (a Hang Stúdióval azonos szabály) */
export function stepFade(value: number, duration: number, dir: -1 | 1): number {
  return dir < 0 ? clamp(value - 0.5, 0, maxClipFade(duration)) : clamp(value + 0.5, 0, maxClipFade(duration));
}

/** felüláteresztő: ki ↔ 60 Hz, 20 Hz-es lépés, 300 Hz-ig */
export function stepHighpass(highpass: number | undefined, dir: -1 | 1): number {
  return dir < 0
    ? (highpass ?? 0) <= 60 ? 0 : (highpass ?? 0) - 20
    : (highpass ?? 0) === 0 ? 60 : Math.min(300, (highpass ?? 0) + 20);
}

/** aluláteresztő: ki ↔ 16 kHz, 2 kHz-es lépés, 2 kHz-ig */
export function stepLowpass(lowpass: number | undefined, dir: -1 | 1): number {
  return dir < 0
    ? (lowpass ?? 0) === 0 ? 16000 : Math.max(2000, (lowpass ?? 0) - 2000)
    : (lowpass ?? 0) === 0 || (lowpass ?? 0) >= 16000 ? 0 : (lowpass ?? 0) + 2000;
}

/** EQ-sáv ±3 dB-es lépésben, -12…+12 dB között */
export function stepEqBand(value: number, dir: -1 | 1): number {
  return dir < 0 ? Math.max(-12, value - 3) : Math.min(12, value + 3);
}

/** zengetés / visszhang aránya ±0,2-es lépésben, tizedre kerekítve, 0…1 között */
export function stepWet(value: number | undefined, dir: -1 | 1): number {
  return dir < 0 ? Math.max(0, round1((value ?? 0) - 0.2)) : Math.min(1, round1((value ?? 0) + 0.2));
}

/** az EQ-sáv felirata előjellel */
export const formatEqDb = (value: number) => `${value > 0 ? '+' : ''}${value} dB`;

/** a klip audio-FX-e és az EQ alapértékkel */
export function clipFxOf(clip: AudioClip | null): { fx: AudioFx; eq: NonNullable<AudioFx['eq']> } {
  const fx: AudioFx = clip?.audioFx ?? {};
  const eq = fx.eq ?? { low: 0, mid: 0, high: 0 };
  return { fx, eq };
}

/**
 * A beat-rács forrása: a zenesáv első klipje (vagy a kijelölt hangklip).
 */
export function beatSourceClip(project: Pick<Project, 'tracks'> | null | undefined, clip: AudioClip | null): AudioClip | null {
  const music = project?.tracks
    .find((x) => x.type === 'music')
    ?.clips.filter((c): c is AudioClip => c.kind === 'audio')
    .sort((a, b) => a.start - b.start)[0];
  return music ?? clip ?? null;
}

/** a felirat-sáv szöveges klipjei időrendben (a dub forrása) */
export function dubCaptions(project: Pick<Project, 'tracks'> | null | undefined): TextClip[] {
  const track = project?.tracks.find((tk) => tk.type === 'captions');
  return (track?.clips ?? [])
    .filter((c): c is TextClip => c.kind === 'text')
    .sort((a, b) => a.start - b.start);
}

/** a dub-narráció szövege: a feliratok összefűzve, legfeljebb 4000 karakter */
export const dubText = (caps: TextClip[]) => caps.map((c) => c.text).join(' ').trim().slice(0, 4000);
