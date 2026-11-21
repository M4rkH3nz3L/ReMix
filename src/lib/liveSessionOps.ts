import type { LiveChat } from '@/lib/live';
import { activeScene, sortedSources } from '@/lib/liveDoc';
import type { LiveState } from '@/lib/liveState';
import type { LiveDoc, LiveSource } from '@/types/live';

/**
 * Az élő adás képernyőjének (src/app/live/[id].tsx) expo-mentes számításai (REFACTOR:
 * a képernyőből kiemelve, változatlan kifejezésekkel).
 */

/** Felúszó reakció-emoji (a képernyő `floats` állapotának eleme). */
export interface LiveFloat {
  id: string;
  emoji: string;
  x: number;
}

/** 🔴 live-timer: az eltelt egész másodpercek (negatív sosem). */
export function liveElapsedSeconds(startMs: number, now: number): number {
  return Math.max(0, Math.floor((now - startMs) / 1000));
}

/** 🔴 live-timer szövege: `m:ss`, egy óra fölött `h:mm:ss`. */
export function formatLiveElapsed(elapsed: number): string {
  const h = Math.floor(elapsed / 3600);
  const m = Math.floor((elapsed % 3600) / 60);
  const s = elapsed % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  const text = h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  return text;
}

/** A chat-lista: legfeljebb az utolsó 80 korábbi üzenet + az új. */
export function appendLiveChat(prev: LiveChat[], m: LiveChat): LiveChat[] {
  return [...prev.slice(-80), m];
}

/** A felúszó reakciók: legfeljebb az utolsó 24 korábbi + az új. */
export function appendLiveFloat(prev: LiveFloat[], f: LiveFloat): LiveFloat[] {
  return [...prev.slice(-24), f];
}

/** 📷 kamera-váltás: elöl ↔ hátul. */
export function flipFacing(f: 'front' | 'back'): 'front' | 'back' {
  return f === 'front' ? 'back' : 'front';
}

/** 🎛️ a gombrács forrásai: az aktív jelenet rendezett forrásai (nincs jelenet → üres). */
export function quickGridSources(doc: LiveDoc): LiveSource[] {
  const current = activeScene(doc);
  return current ? sortedSources(current) : [];
}

/** A „véget ért" nézet: nem létező adás, vagy a néző befejezett / nem létező adáson. */
export function showsEndedView(notFound: boolean, isHost: boolean, ls: LiveState): boolean {
  return notFound || (!isHost && ls.phase === 'error' && (ls.error === 'ended' || ls.error === 'notFound'));
}
