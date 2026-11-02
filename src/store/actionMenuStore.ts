import { create } from 'zustand';

export interface ActionMenuItem {
  label: string;
  onPress: () => void;
  destructive?: boolean;
  icon?: string;
}

interface ActionMenuState {
  title: string;
  items: ActionMenuItem[] | null;
  open: (title: string, items: ActionMenuItem[]) => void;
  close: () => void;
}

/** 🖐️ Hosszú nyomás menüje: saját lap, mert az Androidos Alert legfeljebb három gombot mutat. */
export const useActionMenu = create<ActionMenuState>((set) => ({
  title: '',
  items: null,
  open: (title, items) => set({ title, items }),
  close: () => set({ items: null }),
}));
