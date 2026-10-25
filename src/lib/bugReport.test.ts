import {
  BUG_QUEUE_MAX,
  BUG_SESSION_CAP,
  BUG_THROTTLE_MS,
  BREADCRUMB_MAX,
  emptyThrottle,
  enqueueBug,
  normalizeError,
  parseBugQueue,
  pushBreadcrumb,
  throttleDecision,
  throttleKey,
} from '@/lib/bugReport';

/**
 * 🐞 Kliens-oldali hibajelentés-mag: bármilyen dobott érték kezelhető, a
 * hiba-vihar nem árasztja el a szervert, a breadcrumb/sor korlátos.
 */

describe('normalizeError', () => {
  it('Error, string, objektum, null — mind egységes alak', () => {
    const e = new TypeError('rossz típus');
    expect(normalizeError(e)).toMatchObject({ name: 'TypeError', message: 'rossz típus' });
    expect(normalizeError('csak szöveg')).toEqual({ name: 'Error', message: 'csak szöveg', stack: '' });
    expect(normalizeError({ code: 42 }).message).toBe('{"code":42}');
    expect(normalizeError({ name: 'NetErr', message: 'offline' })).toMatchObject({ name: 'NetErr', message: 'offline' });
    expect(normalizeError(null).message).toBe('null');
  });

  it('a natív (Expo) reject-objektum üzenete is átjön', () => {
    expect(normalizeError({ code: 'ERR_RENDER', message: 'encoder hiba' }).message).toBe('encoder hiba');
  });
});

describe('throttleDecision', () => {
  const key = throttleKey(normalizeError(new Error('x')));

  it('ugyanaz a hiba percenként egyszer', () => {
    let st = emptyThrottle();
    const first = throttleDecision(st, key, 1000);
    expect(first.send).toBe(true);
    st = first.next;
    expect(throttleDecision(st, key, 1000 + BUG_THROTTLE_MS - 1).send).toBe(false);
    expect(throttleDecision(st, key, 1000 + BUG_THROTTLE_MS).send).toBe(true);
  });

  it('eltérő hibák egymástól függetlenek; a munkamenet-plafon mindent megfog', () => {
    let st = emptyThrottle();
    for (let i = 0; i < BUG_SESSION_CAP; i += 1) {
      const d = throttleDecision(st, `k${i}`, 0);
      expect(d.send).toBe(true);
      st = d.next;
    }
    expect(throttleDecision(st, 'uj-hiba', 0).send).toBe(false);
  });

  it('a kulcs sor/oszlop-független (két build ugyanaz)', () => {
    const a = normalizeError(Object.assign(new Error('m'), { stack: 'Error: m\n    at foo (bundle:1:100)' }));
    const b = normalizeError(Object.assign(new Error('m'), { stack: 'Error: m\n    at foo (bundle:1:999)' }));
    expect(throttleKey(a)).toBe(throttleKey(b));
  });
});

describe('breadcrumb + offline-sor', () => {
  it('a breadcrumb-gyűrű a legfrissebbeket tartja, időbélyeggel', () => {
    let list: string[] = [];
    for (let i = 0; i < BREADCRUMB_MAX + 5; i += 1) {
      list = pushBreadcrumb(list, `lépés ${i}`, '2026-10-25T12:34:56.000Z');
    }
    expect(list).toHaveLength(BREADCRUMB_MAX);
    expect(list[list.length - 1]).toBe(`12:34:56 lépés ${BREADCRUMB_MAX + 4}`);
  });

  it('a sor korlátos; sérült tárolt tartalom → üres', () => {
    let q: number[] = [];
    for (let i = 0; i < BUG_QUEUE_MAX + 3; i += 1) {
      q = enqueueBug(q, i);
    }
    expect(q).toHaveLength(BUG_QUEUE_MAX);
    expect(q[0]).toBe(3);
    expect(parseBugQueue('nem json')).toEqual([]);
    expect(parseBugQueue('{"a":1}')).toEqual([]);
    expect(parseBugQueue(null)).toEqual([]);
  });
});
