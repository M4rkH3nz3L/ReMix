/**
 * 👥 Laza csatolás a hálózati réteghez: a store NEM ismeri a collab-csatornát,
 * csak egy-egy opcionális broadcast-függvényt hív. A collabLive-store állítja be
 * ezeket a csatorna nyitásakor, és `null`-ra a zárásakor.
 *
 * MIÉRT külön modul: a history-slice (command-broadcast) és a collab-slice
 * (zár-broadcast) is olvassa ezeket — egy közös modul elkerüli a slice↔slice
 * körkörös importot, és megtartja a korábbi modul-szintű (store-példánytól
 * független) viselkedést.
 */
import type { LockBroadcast } from '@/lib/clipLock';
import type { EditorCommand } from '@/lib/commands';

let liveBroadcaster: ((commands: EditorCommand[]) => void) | null = null;

/**
 * 👥 Élő kollaboráció: ha aktív, a LOKÁLIS (nem 'remote') command-ok ide is mennek,
 * hogy a collab-réteg broadcastolja őket a többi szerkesztőnek. A collabLive-store
 * állítja be a csatorna nyitásakor, és `null`-ra a zárásakor.
 */
export function setLiveBroadcaster(fn: ((commands: EditorCommand[]) => void) | null): void {
  liveBroadcaster = fn;
}
export function getLiveBroadcaster(): ((commands: EditorCommand[]) => void) | null {
  return liveBroadcaster;
}

// 🔒 klip-zár broadcastja (collab) — a collab-store állítja be a csatorna nyitásakor.
// Ugyanaz a laza csatolás, mint a liveBroadcaster (a store nem ismeri a hálót).
let lockBroadcaster: ((msg: LockBroadcast) => void) | null = null;

export function setLockBroadcaster(fn: ((msg: LockBroadcast) => void) | null): void {
  lockBroadcaster = fn;
}
export function getLockBroadcaster(): ((msg: LockBroadcast) => void) | null {
  return lockBroadcaster;
}
