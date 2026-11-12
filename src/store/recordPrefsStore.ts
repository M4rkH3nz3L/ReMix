import { create } from 'zustand';

/**
 * 🎙️ Felvételi beállítások (munkamenet): előszámlálás (0 / 1 / 2 ütem), punch-in (az In–Out
 * tartományt veszi fel újra, ha van) és a metronóm (lejátszás és felvétel közben; csak hallható,
 * az exportba nem kerül). A felvétel-gomb hosszú nyomására és a transzport gombjával állítható.
 */
export const METRONOME_LEVELS = [0.35, 0.6, 1] as const;

export const useRecordPrefs = create<{
  countInBars: 0 | 1 | 2;
  punch: boolean;
  metronome: boolean;
  /** 0–1 (a `METRONOME_LEVELS` egyike) */
  metronomeGain: number;
  setCountIn: (bars: 0 | 1 | 2) => void;
  setPunch: (on: boolean) => void;
  setMetronome: (on: boolean) => void;
  setMetronomeGain: (gain: number) => void;
}>((set) => ({
  countInBars: 0,
  punch: false,
  metronome: false,
  metronomeGain: 0.6,
  setCountIn: (countInBars) => set({ countInBars }),
  setPunch: (punch) => set({ punch }),
  setMetronome: (metronome) => set({ metronome }),
  setMetronomeGain: (metronomeGain) => set({ metronomeGain: Math.max(0, Math.min(1, metronomeGain)) }),
}));
