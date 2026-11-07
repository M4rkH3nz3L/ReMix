import { create } from 'zustand';

import type { SilenceCutMode } from '@/lib/audioSilence';
import type { SrcWord } from '@/lib/speechEdit';
import type { TrackType } from '@/types/project';

/**
 * 💬 A beszédvágás állapota (Hang Stúdió): melyik sáv átirata látszik, a fájlonkénti szavak
 * (forrás-időben — a vágások után is érvényesek), a kijelölt szavak forrás-kulcsai és a kivágás
 * módja. Session-állapot; a vágás maga a command buson megy.
 */
interface State {
  trackType: TrackType | null;
  wordsByUri: Map<string, SrcWord[]>;
  selected: Set<string>;
  mode: SilenceCutMode;
  open: (trackType: TrackType, wordsByUri: Map<string, SrcWord[]>) => void;
  toggle: (key: string) => void;
  select: (keys: string[]) => void;
  setMode: (mode: SilenceCutMode) => void;
  close: () => void;
}

export const useSpeechEdit = create<State>((set) => ({
  trackType: null,
  wordsByUri: new Map(),
  selected: new Set(),
  mode: 'track',
  open: (trackType, wordsByUri) => set({ trackType, wordsByUri, selected: new Set(), mode: 'track' }),
  toggle: (key) =>
    set((s) => {
      const next = new Set(s.selected);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return { selected: next };
    }),
  select: (keys) => set((s) => ({ selected: new Set([...s.selected, ...keys]) })),
  setMode: (mode) => set({ mode }),
  close: () => set({ trackType: null, wordsByUri: new Map(), selected: new Set() }),
}));
