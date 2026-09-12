import { create } from 'zustand';

import {
  listNotifications,
  markAllRead,
  markRead,
  subscribeNotifications,
  type AppNotification,
} from '@/lib/notifications';

/**
 * 🔔 Értesítés-store — a lista + olvasatlan-szám EGYETLEN forrása, REALTIME
 * frissítéssel. Az auth-életciklus hívja a `syncForUser`-t (login → betölt +
 * feliratkozik; logout → ürít + leiratkozik). A UI (csengő, lista) ezt olvassa.
 */

interface NotificationState {
  items: AppNotification[];
  unread: number;
  hydrated: boolean;
  /** login → betöltés + realtime feliratkozás; null userId (logout) → ürítés */
  syncForUser: (userId: string | null) => Promise<void>;
  markOneRead: (id: string) => void;
  markAll: () => void;
}

let unsub: (() => void) | null = null;

const countUnread = (items: AppNotification[]) => items.filter((n) => !n.read).length;

export const useNotifications = create<NotificationState>((set, get) => ({
  items: [],
  unread: 0,
  hydrated: false,

  syncForUser: async (userId) => {
    // előző feliratkozás bontása (fiókváltás/kilépés)
    if (unsub) {
      unsub();
      unsub = null;
    }
    if (!userId) {
      set({ items: [], unread: 0, hydrated: true });
      return;
    }
    try {
      const items = await listNotifications();
      set({ items, unread: countUnread(items), hydrated: true });
    } catch {
      set({ hydrated: true });
    }
    // realtime: új értesítés → a lista elejére, olvasatlan-szám nő
    unsub = subscribeNotifications(userId, (n) => {
      set((s) => {
        if (s.items.some((x) => x.id === n.id)) {
          return s; // duplikátum-védelem
        }
        const items = [n, ...s.items];
        return { items, unread: countUnread(items) };
      });
    });
  },

  markOneRead: (id) => {
    set((s) => {
      const items = s.items.map((n) => (n.id === id ? { ...n, read: true } : n));
      return { items, unread: countUnread(items) };
    });
    markRead(id).catch(() => {});
  },

  markAll: () => {
    set((s) => ({ items: s.items.map((n) => ({ ...n, read: true })), unread: 0 }));
    markAllRead().catch(() => {});
  },
}));
