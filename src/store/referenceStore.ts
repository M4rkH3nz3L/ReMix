import { create } from 'zustand';

/**
 * 🎧🅰️🅱️ Referencia A/B (munkamenet — a projektbe nem kerül): egy referencia-dal, a mért integrált
 * hangossága, és hogy most azt halljuk-e. A „B” a keverés mért hangosságára illesztve szól (csak a
 * hangzás különbsége hallatszik, nem a hangerőé), ugyanott (a lejátszófej idejében).
 */
export interface ReferenceTrack {
  uri: string;
  name: string;
  /** a referencia integrált hangossága (LUFS) */
  lufs: number;
  duration: number;
}

export const useReference = create<{
  ref: ReferenceTrack | null;
  /** a keverés integrált hangossága (LUFS) — ehhez illesztünk */
  mixLufs: number | null;
  listening: boolean;
  setRef: (r: ReferenceTrack | null) => void;
  setMixLufs: (l: number | null) => void;
  setListening: (on: boolean) => void;
}>((set) => ({
  ref: null,
  mixLufs: null,
  listening: false,
  setRef: (ref) => set({ ref, listening: false }),
  setMixLufs: (mixLufs) => set({ mixLufs }),
  setListening: (listening) => set({ listening }),
}));
