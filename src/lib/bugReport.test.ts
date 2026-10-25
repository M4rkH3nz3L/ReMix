import {
  BUG_QUEUE_MAX,
  BUG_SESSION_CAP,
  BUG_THROTTLE_MS,
  BREADCRUMB_MAX,
  buildBugPayload,
  deliveryOutcome,
  emptyThrottle,
  enqueueBug,
  makeQid,
  MAX_PAYLOAD_BYTES,
  normalizeError,
  parseBugQueue,
  pushBreadcrumb,
  throttleDecision,
  throttleKey,
  utf8Length,
} from '@/lib/bugReport';

/**
 * 🐞 Kliens-oldali hibajelentés-mag: bármilyen dobott érték kezelhető, a
 * hiba-vihar nem árasztja el a szervert (de a számláló pontos marad), a payload
 * SOSEM lépi túl a szerver-limitet, a sor korlátos és sérülés-tűrő.
 */

describe('normalizeError', () => {
  it('Error, string, objektum, null — mind egységes alak', () => {
    const e = new TypeError('rossz típus');
    expect(normalizeError(e)).toMatchObject({ name: 'TypeError', message: 'rossz típus' });
    expect(normalizeError('csak szöveg')).toEqual({ name: 'Error', message: 'csak szöveg', stack: '' });
    expect(normalizeError({ code: 42 }).message).toBe('{"code":42}');
    expect(normalizeError({ name: 'NetErr', message: 'offline' })).toMatchObject({ name: 'NetErr', message: 'offline' });
    expect(normalizeError(null).message).toBe('null');
    expect(normalizeError(undefined).message).toBe('undefined');
  });

  it('a natív (Expo) reject-objektum üzenete is átjön; körkörös objektum nem dob', () => {
    expect(normalizeError({ code: 'ERR_RENDER', message: 'encoder hiba' }).message).toBe('encoder hiba');
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => normalizeError(circular)).not.toThrow();
  });
});

describe('throttleKey', () => {
  it('a változó azonosítók/számok nem bontják szét a kulcsot', () => {
    const a = normalizeError(new Error('Nincs ilyen klip (clip_a8f3e1) 12 ms'));
    const b = normalizeError(new Error('Nincs ilyen klip (clip_77b1c9) 4500 ms'));
    a.stack = 'Error\n    at foo (bundle:1:100)';
    b.stack = 'Error\n    at foo (bundle:1:999)';
    expect(throttleKey(a)).toBe(throttleKey(b));
  });

  it('más üzenet más kulcs', () => {
    expect(throttleKey(normalizeError(new Error('a')))).not.toBe(throttleKey(normalizeError(new Error('b'))));
  });
});

describe('throttleDecision', () => {
  const key = 'k';

  it('ugyanaz a hiba percenként egyszer — az elnyelt ismétlések a következővel mennek', () => {
    let st = emptyThrottle();
    const first = throttleDecision(st, key, 1000);
    expect(first).toMatchObject({ send: true, repeat: 1 });
    st = first.next;
    for (let i = 0; i < 4; i += 1) {
      const d = throttleDecision(st, key, 1000 + i);
      expect(d.send).toBe(false);
      st = d.next;
    }
    const later = throttleDecision(st, key, 1000 + BUG_THROTTLE_MS);
    expect(later).toMatchObject({ send: true, repeat: 5 }); // 1 + 4 elnyelt
    // a számláló nullázódott
    expect(throttleDecision(later.next, key, 1000 + 2 * BUG_THROTTLE_MS).repeat).toBe(1);
  });

  it('eltérő hibák egymástól függetlenek; a munkamenet-plafon megfog (de számol)', () => {
    let st = emptyThrottle();
    for (let i = 0; i < BUG_SESSION_CAP; i += 1) {
      const d = throttleDecision(st, `k${i}`, 0);
      expect(d.send).toBe(true);
      st = d.next;
    }
    const over = throttleDecision(st, 'uj-hiba', 0);
    expect(over.send).toBe(false);
    expect(over.next.suppressed['uj-hiba']).toBe(1);
  });
});

describe('buildBugPayload', () => {
  const base = {
    qid: 'q1',
    kind: 'handled' as const,
    repeat: 1,
    platform: 'android',
    osVersion: '14',
    appVersion: '1.0.0',
    model: 'SM-A336B',
    route: '/editor/prj_1',
    projectId: 'prj_1',
    breadcrumbs: ['10:00:00 → /editor/prj_1'],
  };

  it('a mezők a szerver-limitekre vágva; a kontextus átmegy', () => {
    const p = buildBugPayload({
      ...base,
      error: { name: 'E', message: 'm'.repeat(5000), stack: 's'.repeat(20000) },
      extra: { where: 'renderLocal', clips: 3, ok: true, obj: { a: 1 } },
    });
    expect((p.message as string).length).toBeLessThanOrEqual(2001);
    expect((p.stack as string).length).toBeLessThanOrEqual(8001);
    expect(p.extra).toEqual({ where: 'renderLocal', clips: 3, ok: true, obj: '{"a":1}' });
    expect(p).toMatchObject({ qid: 'q1', route: '/editor/prj_1', projectId: 'prj_1', repeat: 1 });
  });

  it('a payload SOSEM lépi túl a bájt-plafont (több-bájtos karakterekkel sem)', () => {
    const huge = '🐞árvíz'.repeat(4000);
    const p = buildBugPayload({
      ...base,
      error: { name: 'E', message: huge, stack: huge },
      componentStack: huge,
      breadcrumbs: Array.from({ length: 30 }, () => huge.slice(0, 200)),
    });
    expect(utf8Length(JSON.stringify(p))).toBeLessThanOrEqual(MAX_PAYLOAD_BYTES);
    // a hiba lényege (üzenet + stack eleje) megmarad
    expect((p.message as string).length).toBeGreaterThan(100);
    expect((p.stack as string).length).toBeGreaterThan(100);
  });

  it('a repeat 1–1000 közé vágva', () => {
    expect(buildBugPayload({ ...base, repeat: 0, error: normalizeError('x') }).repeat).toBe(1);
    expect(buildBugPayload({ ...base, repeat: 5000, error: normalizeError('x') }).repeat).toBe(1000);
  });
});

describe('utf8Length', () => {
  it('ASCII 1, ékezet 2, euró 3, emoji 4 bájt', () => {
    expect(utf8Length('a')).toBe(1);
    expect(utf8Length('é')).toBe(2);
    expect(utf8Length('€')).toBe(3);
    expect(utf8Length('🐞')).toBe(4);
  });
});

describe('deliveryOutcome', () => {
  it('siker/végleges elutasítás = done; hálózat/5xx/429 = retry', () => {
    expect(deliveryOutcome(200)).toBe('done');
    expect(deliveryOutcome(400)).toBe('done');
    expect(deliveryOutcome(413)).toBe('done');
    expect(deliveryOutcome(507)).toBe('done');
    expect(deliveryOutcome(429)).toBe('retry');
    expect(deliveryOutcome(500)).toBe('retry');
    expect(deliveryOutcome(503)).toBe('retry');
    expect(deliveryOutcome(null)).toBe('retry');
  });
});

describe('breadcrumb + offline-sor + qid', () => {
  it('a breadcrumb-gyűrű a legfrissebbeket tartja, időbélyeggel', () => {
    let list: string[] = [];
    for (let i = 0; i < BREADCRUMB_MAX + 5; i += 1) {
      list = pushBreadcrumb(list, `lépés ${i}`, '2026-10-25T12:34:56.000Z');
    }
    expect(list).toHaveLength(BREADCRUMB_MAX);
    expect(list[list.length - 1]).toBe(`12:34:56 lépés ${BREADCRUMB_MAX + 4}`);
  });

  it('a sor korlátos; sérült/idegen tárolt tartalom → üres vagy szűrt', () => {
    let q: number[] = [];
    for (let i = 0; i < BUG_QUEUE_MAX + 3; i += 1) {
      q = enqueueBug(q, i);
    }
    expect(q).toHaveLength(BUG_QUEUE_MAX);
    expect(q[0]).toBe(3);
    expect(parseBugQueue('nem json')).toEqual([]);
    expect(parseBugQueue('{"a":1}')).toEqual([]);
    expect(parseBugQueue(null)).toEqual([]);
    expect(parseBugQueue('[1,"x",null,{"qid":"a"},[2]]')).toEqual([{ qid: 'a' }]);
  });

  it('a qid szerver-kompatibilis ([0-9a-z]) és egyedi', () => {
    const a = makeQid(1761400000000, 0.123456);
    const b = makeQid(1761400000000, 0.654321);
    expect(a).toMatch(/^[0-9a-z]{4,40}$/);
    expect(a).not.toBe(b);
  });
});
