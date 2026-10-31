import {
  egressFailure,
  initialLiveState,
  isOnAir,
  liveReducer,
  RECONNECT_TIMEOUT_MS,
  tokenErrorCode,
  type LiveEvent,
  type LiveState,
} from '@/lib/liveState';

const run = (events: LiveEvent[], from: LiveState = initialLiveState(0)) => events.reduce(liveReducer, from);

describe('liveReducer (PRO-LIVE L13)', () => {
  it('normál út: idle → connecting → live → stopping → ended', () => {
    const s = run([{ type: 'CONNECT', at: 1 }, { type: 'CONNECTED', at: 2 }]);
    expect(s.phase).toBe('live');
    expect(isOnAir(s)).toBe(true);
    expect(s.liveSince).toBe(2);
    const end = run([{ type: 'STOP', at: 5 }, { type: 'DISCONNECTED', at: 6 }], s);
    expect(end.phase).toBe('ended');
  });

  it('kapcsolatvesztés: NEM ragad élőben → reconnecting, visszajön → live (az óra nem nullázódik)', () => {
    const live = run([{ type: 'CONNECT', at: 0 }, { type: 'CONNECTED', at: 10 }]);
    const lost = liveReducer(live, { type: 'DISCONNECTED', at: 100 });
    expect(lost.phase).toBe('reconnecting');
    expect(isOnAir(lost)).toBe(false);
    expect(lost.drops).toBe(1);
    const back = liveReducer(lost, { type: 'CONNECTED', at: 200 });
    expect(back).toMatchObject({ phase: 'live', liveSince: 10 });
  });

  it('az újracsatlakozás időkorlát után hiba; újrapróba lehetséges', () => {
    const lost = run([{ type: 'CONNECT', at: 0 }, { type: 'CONNECTED', at: 1 }, { type: 'DISCONNECTED', at: 1000 }]);
    expect(liveReducer(lost, { type: 'TICK', at: 1000 + RECONNECT_TIMEOUT_MS - 1 }).phase).toBe('reconnecting');
    const err = liveReducer(lost, { type: 'TICK', at: 1000 + RECONNECT_TIMEOUT_MS });
    expect(err).toMatchObject({ phase: 'error', error: 'reconnectTimeout' });
    expect(liveReducer(err, { type: 'RETRY', at: 99999 }).phase).toBe('reconnecting');
  });

  it('az ended végleges; a FAIL leállítás közben ended', () => {
    const ended = run([{ type: 'STOP', at: 1 }]);
    expect(liveReducer(ended, { type: 'CONNECTED', at: 2 }).phase).toBe('ended');
    const stopping = run([{ type: 'CONNECT', at: 0 }, { type: 'CONNECTED', at: 1 }, { type: 'STOP', at: 2 }]);
    expect(liveReducer(stopping, { type: 'FAIL', at: 3, error: 'unknown' }).phase).toBe('ended');
  });

  it('token-hibák és egress-hibák érthető okra képeződnek', () => {
    expect(tokenErrorCode('Az adás már véget ért.')).toBe('ended');
    expect(tokenErrorCode('LiveKit token-hiba (404)')).toBe('notFound');
    expect(tokenErrorCode('hálózat')).toBeNull();
    expect(egressFailure('Egress-hiba (402)')).toBe('needsPro');
    expect(egressFailure('Már fut 1 élő multistream (max 1).')).toBe('busy');
    expect(egressFailure('LiveKit Egress nincs konfigurálva.')).toBe('unavailable');
  });
});
