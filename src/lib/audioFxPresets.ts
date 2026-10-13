/**
 * 🎙️✨ Hang-FX presetek (AUDIOT §5) — pure + tesztelt.
 *
 * Egy-koppintásos hangeffekt-kombinációk a MÁR renderelő `AudioFx` mezőkből (EQ/szűrők/komp/
 * gate/de-esser/limiter/normalize/reverb/pitch). A preset egy kész `AudioFx`-beállítás, amit a
 * ClipEditSheet a klipre tesz. Expo-mentes → tesztelhető; a worker `audioFxChain`-je rendereli.
 */
import type { AudioFx } from '@/types/project';

export interface AudioFxPreset {
  key: string;
  /** rövid címke-kulcs (i18n defaultValue-val) */
  label: string;
  /** ikon (Ionicons) */
  icon: string;
  /** a klipre kerülő teljes FX-beállítás */
  fx: AudioFx;
}

export const AUDIO_FX_PRESETS: AudioFxPreset[] = [
  {
    key: 'clean',
    label: 'Tiszta',
    icon: 'sparkles-outline',
    fx: {},
  },
  {
    key: 'podcast',
    label: 'Podcast',
    icon: 'mic-outline',
    fx: { highpass: 80, gate: true, deEsser: true, compressor: true, normalize: true, eq: { low: -1, mid: 1, high: 1 } },
  },
  {
    key: 'phone',
    label: 'Telefon',
    icon: 'call-outline',
    fx: { highpass: 400, lowpass: 3000, compressor: true },
  },
  {
    key: 'radio',
    label: 'Rádió',
    icon: 'radio-outline',
    fx: { highpass: 100, compressor: true, limiter: true, eq: { low: 2, mid: 0, high: 2 } },
  },
  {
    key: 'deep',
    label: 'Mély',
    icon: 'arrow-down-outline',
    fx: { pitchSemitones: -4, eq: { low: 2, mid: 0, high: -1 } },
  },
  {
    key: 'bright',
    label: 'Magas',
    icon: 'arrow-up-outline',
    fx: { pitchSemitones: 5, eq: { low: -1, mid: 0, high: 2 } },
  },
  {
    key: 'hall',
    label: 'Termi',
    icon: 'business-outline',
    fx: { reverb: 0.6 },
  },
  {
    key: 'wide',
    label: 'Széles',
    icon: 'headset-outline',
    fx: { stereoWide: true, eq: { low: 0, mid: 0, high: 1 } },
  },
];

/** Egy preset az `AudioFx` (új objektum, hogy a state-mutáció biztonságos legyen). */
export function presetFx(key: string): AudioFx {
  const p = AUDIO_FX_PRESETS.find((x) => x.key === key);
  return p ? JSON.parse(JSON.stringify(p.fx)) : {};
}
