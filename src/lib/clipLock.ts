/**
 * 🔒 Klip-zárolás (audit §3.1) — tiszta, expo-mentes mag.
 *
 * Kollaboratív szerkesztésnél egyszerre csak EGY szerkesztheti ugyanazt a klipet.
 * A zár tulajdonos + életjel (heartbeat) alapú: ha a tulajdonos kiesik (nincs több
 * életjel a TTL-en belül), a zár „elavul" és más megszerezheti (stale-recovery).
 * A realtime-szinkron (a zárak broadcastja) + a UI a bekötés — ez a determinisztikus,
 * tesztelt állapot-logika, amit mindkettő használ. Az idő injektált (`now` ms) → tesztelhető.
 */

export interface ClipLock {
  clipId: string;
  ownerId: string;
  ownerName?: string;
  /** ms epoch — a zár megszerzése */
  acquiredAt: number;
  /** ms epoch — a legutóbbi életjel (ehhez mérjük a TTL-t) */
  heartbeatAt: number;
}

/** Ennyi ideig él egy zár új életjel nélkül (utána elavul, más megszerezheti). */
export const LOCK_TTL_MS = 30_000;

/** Elavult-e a zár (nincs életjel a TTL-en belül → a tulajdonos valószínűleg kiesett). */
export function isStale(lock: ClipLock, now: number, ttl = LOCK_TTL_MS): boolean {
  return now - lock.heartbeatAt > ttl;
}

/** Zárolt-e MÁS által: él a zár (nem elavult) ÉS nem a miénk. */
export function isLockedByOther(
  lock: ClipLock | undefined,
  userId: string,
  now: number,
  ttl = LOCK_TTL_MS,
): boolean {
  return !!lock && lock.ownerId !== userId && !isStale(lock, now, ttl);
}

/** Szerkeszthetem-e a klipet: nincs zár / a sajátom / elavult. */
export function canEdit(
  lock: ClipLock | undefined,
  userId: string,
  now: number,
  ttl = LOCK_TTL_MS,
): boolean {
  return !isLockedByOther(lock, userId, now, ttl);
}

/**
 * Zár megszerzése, ha szabad / elavult / már a miénk → az új zár; ha MÁS tartja
 * (élő), `null` (nem szerezhető meg). A saját zár újraszerzésekor az `acquiredAt`
 * megmarad (csak az életjel frissül).
 */
export function acquireLock(
  lock: ClipLock | undefined,
  clipId: string,
  userId: string,
  now: number,
  ownerName?: string,
  ttl = LOCK_TTL_MS,
): ClipLock | null {
  if (isLockedByOther(lock, userId, now, ttl)) {
    return null;
  }
  const mine = lock && lock.ownerId === userId ? lock : null;
  return {
    clipId,
    ownerId: userId,
    ownerName: ownerName ?? mine?.ownerName,
    acquiredAt: mine ? mine.acquiredAt : now,
    heartbeatAt: now,
  };
}

/** Életjel: a SAJÁT zár frissítése (más zárát nem érinti). */
export function heartbeat(lock: ClipLock, userId: string, now: number): ClipLock {
  return lock.ownerId === userId ? { ...lock, heartbeatAt: now } : lock;
}

// ── zár-térkép (klipId → zár) kezelés a teljes projektre ────────────────────

export type LockMap = Record<string, ClipLock>;

export function lockOf(map: LockMap, clipId: string): ClipLock | undefined {
  return map[clipId];
}

/** Új/frissített zár beírása (immutábilis). */
export function withLock(map: LockMap, lock: ClipLock): LockMap {
  return { ...map, [lock.clipId]: lock };
}

/** Egy klip zárának feloldása (csak a tulajdonos oldhatja fel). */
export function releaseLock(map: LockMap, clipId: string, userId: string): LockMap {
  const lock = map[clipId];
  if (!lock || lock.ownerId !== userId) {
    return map;
  }
  const next = { ...map };
  delete next[clipId];
  return next;
}

/** Az elavult zárak eltávolítása (periodikus takarítás). */
export function pruneStale(map: LockMap, now: number, ttl = LOCK_TTL_MS): LockMap {
  const next: LockMap = {};
  for (const [clipId, lock] of Object.entries(map)) {
    if (!isStale(lock, now, ttl)) {
      next[clipId] = lock;
    }
  }
  return next;
}

// ── realtime-session: a zárak broadcast-összefésülése ───────────────────────

/** Egy zár-esemény a collab-csatornán: beírás (acquire/heartbeat) vagy feloldás. */
export interface LockBroadcast {
  type: 'set' | 'release';
  clipId: string;
  ownerId: string;
  /** `set` esetén a teljes zár */
  lock?: ClipLock;
}

/**
 * Egy BEJÖVŐ zár-esemény alkalmazása a térképre — determinisztikus, ütközés-feloldással.
 * Előbb a stale-eket takarítja. `release`: a tulaj feloldja. `set`: beírja a távoli zárat,
 * KIVÉVE ha ütközik egy ÉLŐ, MÁS tulajú, KORÁBBAN (vagy egyszerre) szerzett zárral
 * (first-come-wins) → két egyidejű szerzésnél MINDEN kliens ugyanazt a győztest látja.
 */
export function applyLockBroadcast(
  map: LockMap,
  msg: LockBroadcast,
  now: number,
  ttl = LOCK_TTL_MS,
): LockMap {
  const pruned = pruneStale(map, now, ttl);
  if (msg.type === 'release') {
    return releaseLock(pruned, msg.clipId, msg.ownerId);
  }
  const incoming = msg.lock;
  if (!incoming) {
    return pruned;
  }
  const existing = pruned[incoming.clipId];
  if (
    existing &&
    existing.ownerId !== incoming.ownerId &&
    !isStale(existing, now, ttl) &&
    existing.acquiredAt <= incoming.acquiredAt
  ) {
    return pruned; // a korábbi, élő, más tulajú zár nyer (determinisztikus, echo-biztos)
  }
  return withLock(pruned, incoming);
}

/** Szerkeszthetem-e a klipet a térkép szerint (nincs zár / sajátom / elavult). */
export function editableByMe(
  map: LockMap,
  clipId: string,
  userId: string,
  now: number,
  ttl = LOCK_TTL_MS,
): boolean {
  return canEdit(map[clipId], userId, now, ttl);
}

/** A MÁSOK által tartott ÉLŐ zárak (UI: „ki szerkeszti most"). */
export function locksByOthers(
  map: LockMap,
  userId: string,
  now: number,
  ttl = LOCK_TTL_MS,
): ClipLock[] {
  return Object.values(map).filter((l) => l.ownerId !== userId && !isStale(l, now, ttl));
}
