import {
  acquireLock,
  applyLockBroadcast,
  canEdit,
  editableByMe,
  heartbeat,
  isLockedByOther,
  isStale,
  LOCK_TTL_MS,
  locksByOthers,
  lockOf,
  pruneStale,
  releaseLock,
  withLock,
  type ClipLock,
} from '@/lib/clipLock';

const T0 = 1_000_000;
const mk = (over: Partial<ClipLock> = {}): ClipLock => ({
  clipId: 'c1',
  ownerId: 'alice',
  acquiredAt: T0,
  heartbeatAt: T0,
  ...over,
});

describe('clipLock — zár állapot (audit §3.1)', () => {
  it('isStale a TTL után', () => {
    const lock = mk();
    expect(isStale(lock, T0 + LOCK_TTL_MS)).toBe(false); // pont a határon még él
    expect(isStale(lock, T0 + LOCK_TTL_MS + 1)).toBe(true);
  });

  it('isLockedByOther: más élő zára igen, saját/elavult nem', () => {
    const lock = mk({ ownerId: 'alice' });
    expect(isLockedByOther(lock, 'bob', T0)).toBe(true);
    expect(isLockedByOther(lock, 'alice', T0)).toBe(false); // sajat
    expect(isLockedByOther(lock, 'bob', T0 + LOCK_TTL_MS + 1)).toBe(false); // elavult
    expect(isLockedByOther(undefined, 'bob', T0)).toBe(false); // nincs zár
  });

  it('canEdit: nincs zár / sajat / elavult → igen; más élő → nem', () => {
    expect(canEdit(undefined, 'bob', T0)).toBe(true);
    expect(canEdit(mk({ ownerId: 'bob' }), 'bob', T0)).toBe(true);
    expect(canEdit(mk({ ownerId: 'alice' }), 'bob', T0)).toBe(false);
    expect(canEdit(mk({ ownerId: 'alice' }), 'bob', T0 + LOCK_TTL_MS + 1)).toBe(true);
  });
});

describe('acquireLock / heartbeat', () => {
  it('szabad klipre megszerezhető', () => {
    const lock = acquireLock(undefined, 'c1', 'bob', T0, 'Bob');
    expect(lock).toMatchObject({ clipId: 'c1', ownerId: 'bob', ownerName: 'Bob', heartbeatAt: T0 });
  });

  it('más élő zárára NEM szerezhető (null)', () => {
    expect(acquireLock(mk({ ownerId: 'alice' }), 'c1', 'bob', T0)).toBeNull();
  });

  it('elavult zár átvehető', () => {
    const stale = mk({ ownerId: 'alice', heartbeatAt: T0 });
    const taken = acquireLock(stale, 'c1', 'bob', T0 + LOCK_TTL_MS + 1);
    expect(taken?.ownerId).toBe('bob');
  });

  it('saját zár újraszerzésekor az acquiredAt megmarad, az életjel frissül', () => {
    const mine = mk({ ownerId: 'bob', acquiredAt: T0, heartbeatAt: T0 });
    const again = acquireLock(mine, 'c1', 'bob', T0 + 5000);
    expect(again).toMatchObject({ acquiredAt: T0, heartbeatAt: T0 + 5000 });
  });

  it('heartbeat csak a saját zárat frissíti', () => {
    const lock = mk({ ownerId: 'alice', heartbeatAt: T0 });
    expect(heartbeat(lock, 'alice', T0 + 1000).heartbeatAt).toBe(T0 + 1000);
    expect(heartbeat(lock, 'bob', T0 + 1000).heartbeatAt).toBe(T0); // idegen → változatlan
  });
});

describe('LockMap — térkép-kezelés', () => {
  it('withLock / lockOf / releaseLock (csak a tulaj old fel)', () => {
    let map = {};
    map = withLock(map, mk({ clipId: 'c1', ownerId: 'alice' }));
    expect(lockOf(map, 'c1')?.ownerId).toBe('alice');
    // idegen nem oldja fel
    expect(releaseLock(map, 'c1', 'bob')).toBe(map);
    // a tulaj feloldja
    const after = releaseLock(map, 'c1', 'alice');
    expect(lockOf(after, 'c1')).toBeUndefined();
  });

  it('pruneStale eltávolítja az elavult zárakat', () => {
    const map = {
      c1: mk({ clipId: 'c1', heartbeatAt: T0 }), // elavul
      c2: mk({ clipId: 'c2', heartbeatAt: T0 + LOCK_TTL_MS }), // friss
    };
    const pruned = pruneStale(map, T0 + LOCK_TTL_MS + 1);
    expect(lockOf(pruned, 'c1')).toBeUndefined();
    expect(lockOf(pruned, 'c2')).toBeDefined();
  });
});

describe('clipLock — realtime session (broadcast-merge)', () => {
  it('applyLockBroadcast: set beírja a távoli zárat', () => {
    const lock = mk({ clipId: 'c1', ownerId: 'bob' });
    const map = applyLockBroadcast({}, { type: 'set', clipId: 'c1', ownerId: 'bob', lock }, T0);
    expect(lockOf(map, 'c1')?.ownerId).toBe('bob');
  });

  it('applyLockBroadcast: release a tulajtól feloldja, mástól nem', () => {
    const start = withLock({}, mk({ clipId: 'c1', ownerId: 'bob' }));
    expect(lockOf(applyLockBroadcast(start, { type: 'release', clipId: 'c1', ownerId: 'eve' }, T0), 'c1')).toBeDefined();
    expect(lockOf(applyLockBroadcast(start, { type: 'release', clipId: 'c1', ownerId: 'bob' }, T0), 'c1')).toBeUndefined();
  });

  it('ütközés: a KORÁBBAN szerzett élő zár nyer (first-come-wins, determinisztikus)', () => {
    const early = withLock({}, mk({ clipId: 'c1', ownerId: 'alice', acquiredAt: T0, heartbeatAt: T0 }));
    const late = mk({ clipId: 'c1', ownerId: 'bob', acquiredAt: T0 + 50, heartbeatAt: T0 + 50 });
    // a később érkező bob-zár NEM írja felül az élő, korábbi alice-zárat
    const merged = applyLockBroadcast(early, { type: 'set', clipId: 'c1', ownerId: 'bob', lock: late }, T0 + 60);
    expect(lockOf(merged, 'c1')?.ownerId).toBe('alice');
  });

  it('ütközés: ha a meglévő ELAVULT, a távoli zár megszerzi', () => {
    const stale = withLock({}, mk({ clipId: 'c1', ownerId: 'alice', heartbeatAt: T0 }));
    const fresh = mk({ clipId: 'c1', ownerId: 'bob', acquiredAt: T0 + 2 * LOCK_TTL_MS, heartbeatAt: T0 + 2 * LOCK_TTL_MS });
    const merged = applyLockBroadcast(stale, { type: 'set', clipId: 'c1', ownerId: 'bob', lock: fresh }, T0 + 2 * LOCK_TTL_MS);
    expect(lockOf(merged, 'c1')?.ownerId).toBe('bob');
  });

  it('editableByMe + locksByOthers', () => {
    const map = withLock({}, mk({ clipId: 'c1', ownerId: 'bob', heartbeatAt: T0 }));
    expect(editableByMe(map, 'c1', 'alice', T0)).toBe(false); // bob él → alice nem
    expect(editableByMe(map, 'c1', 'bob', T0)).toBe(true); // sajátom
    expect(editableByMe(map, 'c2', 'alice', T0)).toBe(true); // nincs zár
    expect(locksByOthers(map, 'alice', T0).map((l) => l.ownerId)).toEqual(['bob']);
    expect(locksByOthers(map, 'bob', T0)).toEqual([]); // a sajátom nem „másé"
    expect(locksByOthers(map, 'alice', T0 + LOCK_TTL_MS + 1)).toEqual([]); // elavult
  });
});
