import { create } from 'zustand';

/**
 * 🍞 Rövid, nem-blokkoló értesítés opcionális akcióval (pl. „Klip törölve · Visszavonás").
 *
 * MIÉRT: telefonon a destruktív művelet (törlés, kivágás) után a visszavonás a
 * transport-sávon van — kis gomb, máshol, mint ahol a felhasználó épp koppintott.
 * A toast ott jelenik meg, ahol a művelet történt (az eszköztár fölött), és egy
 * koppintással visszavon. Egyszerre EGY toast él; az új felülírja a régit.
 */
export interface ToastState {
  /** monoton azonosító — a lejárat-időzítő csak a SAJÁT toastját zárja */
  id: number;
  message: string | null;
  actionLabel?: string;
  onAction?: () => void;
  show: (message: string, action?: { label: string; onPress: () => void }) => void;
  dismiss: (id?: number) => void;
}

export const TOAST_DURATION_MS = 4000;

export const useToast = create<ToastState>((set, get) => ({
  id: 0,
  message: null,
  show: (message, action) =>
    set((s) => ({
      id: s.id + 1,
      message,
      actionLabel: action?.label,
      onAction: action?.onPress,
    })),
  dismiss: (id) => {
    // egy régebbi toast lejárata ne zárja be az azóta megjelent újat
    if (id !== undefined && id !== get().id) {
      return;
    }
    set({ message: null, actionLabel: undefined, onAction: undefined });
  },
}));
