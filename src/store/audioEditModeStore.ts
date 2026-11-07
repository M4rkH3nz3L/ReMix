import { create } from 'zustand';

/**
 * ✋✂️↔️ A Hang Stúdió érintéses szerkesztési módja (munkamenet-állapot):
 * - `select`: koppintás = kijelölés + ugrás, húzás csak hosszú nyomás után (véletlen mozgatás ellen)
 * - `cut`: a klipre koppintva ott vág, ahol az ujj ér (a rácsra igazítva)
 * - `move`: azonnal húzható (gyors elrendezés)
 * Mellette a sávmagasság (nagyobb hullámforma).
 */
export type AudioEditMode = 'select' | 'cut' | 'move';

export const LANE_HEIGHTS = { normal: 70, large: 120 } as const;

export const useAudioEditMode = create<{ mode: AudioEditMode; large: boolean; setMode: (m: AudioEditMode) => void; toggleLarge: () => void }>((set) => ({
  mode: 'select',
  large: false,
  setMode: (mode) => set({ mode }),
  toggleLarge: () => set((s) => ({ large: !s.large })),
}));
