import { create } from 'zustand';

/**
 * 🎙️ Felvételi beállítások (munkamenet): előszámlálás (0 / 1 / 2 ütem) és punch-in (az In–Out
 * tartományt veszi fel újra, ha van). A felvétel-gomb hosszú nyomására állítható.
 */
export const useRecordPrefs = create<{
  countInBars: 0 | 1 | 2;
  punch: boolean;
  setCountIn: (bars: 0 | 1 | 2) => void;
  setPunch: (on: boolean) => void;
}>((set) => ({
  countInBars: 0,
  punch: false,
  setCountIn: (countInBars) => set({ countInBars }),
  setPunch: (punch) => set({ punch }),
}));
