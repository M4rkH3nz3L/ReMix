import { create } from 'zustand';

/** 🎚️🤖 a mixjavaslat / mastering-segéd lap nyitott állapota (bárhonnan megnyitható) */
export const useMixAssist = create<{ open: 'mix' | 'master' | null; show: (s: 'mix' | 'master') => void; close: () => void }>((set) => ({
  open: null,
  show: (s) => set({ open: s }),
  close: () => set({ open: null }),
}));
