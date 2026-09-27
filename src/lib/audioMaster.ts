import type { AudioMaster, AudioMasterDynamics, AudioMasterTarget } from '@/types/project';

/**
 * 🎚️ Audio-master presetek + a renderbe menő FFmpeg master-lánc (AUDIO-MASTER).
 *
 * A master a TELJES keverékre hat: `loudnorm` viszi a cél-hangosságra (LUFS) és a
 * true-peak plafonra (dBTP), egy `alimiter` a biztonsági plafon. A `dynamics` a
 * loudnorm LRA-ját hangolja (kisebb LRA = tömörebb, „punchy"). Ez a modul TISZTA
 * (expo-mentes) → tesztelhető; a szerver-render UGYANEZT a láncot építi (paritás).
 */

export const AUDIO_MASTER_TARGETS: AudioMasterTarget[] = [
  'video',
  'podcast',
  'music',
  'social',
  'custom',
];

/** target → alap LUFS / dBTP / dinamika (a 'custom' a videó-alapról indul). */
const PRESETS: Record<AudioMasterTarget, Omit<AudioMaster, 'target'>> = {
  video: { lufs: -14, truePeak: -1, dynamics: 'balanced', eq: { low: 0, mid: 0, high: 0 } },
  podcast: { lufs: -16, truePeak: -1.5, dynamics: 'natural', eq: { low: -1, mid: 1, high: 1 } },
  music: { lufs: -11, truePeak: -1, dynamics: 'punchy', eq: { low: 0, mid: 0, high: 0 }, multiband: true },
  social: { lufs: -14, truePeak: -1, dynamics: 'punchy', eq: { low: 1, mid: 0, high: 1 }, multiband: true },
  custom: { lufs: -14, truePeak: -1, dynamics: 'balanced', eq: { low: 0, mid: 0, high: 0 } },
};

/** Egy target teljes preset-objektuma (a UI innen tölti a mezőket). */
export function masterPreset(target: AudioMasterTarget): AudioMaster {
  return { target, ...PRESETS[target] };
}

/** dinamika-jelleg → loudnorm LRA (hangosság-tartomány). Kisebb = tömörebb. */
export function dynamicsLra(dynamics: AudioMasterDynamics): number {
  switch (dynamics) {
    case 'natural':
      return 11;
    case 'punchy':
      return 5;
    default:
      return 7; // balanced
  }
}

// A tényleges master-FFmpeg-láncot a SZERVER építi (server/voicechain.js
// `masterChain`), mert a hiteles mastering KÉTMENETES: előbb `loudnorm`-mérés,
// aztán a mért értékekkel `linear=true` (pontos cél-LUFS/TP). Ezt kliens-oldalon
// nem lehet előnézetben reprodukálni → a master RENDER-idejű, itt csak a
// paramétereket + preseteket kezeljük.
