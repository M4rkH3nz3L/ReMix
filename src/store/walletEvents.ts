import { create } from 'zustand';

/** 🔔 „A pénztárca változott” jelző: a dev-admin és a vásárlások után a kártyák újratöltenek. */
export const useWalletEvents = create<{ tick: number; bump: () => void }>((set) => ({
  tick: 0,
  bump: () => set((s) => ({ tick: s.tick + 1 })),
}));
