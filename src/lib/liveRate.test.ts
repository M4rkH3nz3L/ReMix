import {
  createPerSenderLimiter,
  createRateLimiter,
  createTrailingThrottle,
} from '@/lib/liveRate';

/** Determinisztikus óra + ütemező a throttle-teszthez. */
function harness() {
  let t = 0;
  const scheduled: { fn: () => void; at: number; id: number }[] = [];
  let idc = 1;
  return {
    now: () => t,
    schedule: (fn: () => void, ms: number) => {
      const id = idc++;
      scheduled.push({ fn, at: t + ms, id });
      return id;
    },
    cancel: (h: unknown) => {
      const i = scheduled.findIndex((s) => s.id === h);
      if (i >= 0) {
        scheduled.splice(i, 1);
      }
    },
    advance: (ms: number) => {
      t += ms;
      const due = scheduled.filter((s) => s.at <= t).sort((a, b) => a.at - b.at);
      for (const s of due) {
        const i = scheduled.indexOf(s);
        if (i >= 0) {
          scheduled.splice(i, 1);
        }
        s.fn();
      }
    },
    setT: (v: number) => {
      t = v;
    },
  };
}

describe('createTrailingThrottle', () => {
  test('az első push azonnal flush-öl', () => {
    const h = harness();
    const out: string[] = [];
    const th = createTrailingThrottle<string>(100, (v) => out.push(v), h);
    th.push('a');
    expect(out).toEqual(['a']);
  });

  test('gyors pushok coalesce-elnek a legfrissebbre, ablakonként 1 flush', () => {
    const h = harness();
    const out: string[] = [];
    const th = createTrailingThrottle<string>(100, (v) => out.push(v), h);
    th.push('a'); // azonnal
    h.setT(10);
    th.push('b'); // várakozik → ütemez t=100-ra
    h.setT(20);
    th.push('c'); // felülírja b-t
    expect(out).toEqual(['a']);
    h.advance(80); // t=100 → doFlush
    expect(out).toEqual(['a', 'c']); // b elveszett (coalesce), c ment
  });

  test('a következő ablak új pushja megint ütemez', () => {
    const h = harness();
    const out: string[] = [];
    const th = createTrailingThrottle<string>(100, (v) => out.push(v), h);
    th.push('a');
    h.advance(100); // nincs pending → semmi
    expect(out).toEqual(['a']);
    h.setT(150);
    th.push('d'); // elapsed=50 < 100 → ütemez t=200
    h.advance(50); // t=200
    expect(out).toEqual(['a', 'd']);
  });

  test('stop() törli a függő flush-t', () => {
    const h = harness();
    const out: string[] = [];
    const th = createTrailingThrottle<string>(100, (v) => out.push(v), h);
    th.push('a');
    h.setT(10);
    th.push('b'); // ütemezve
    th.stop();
    h.advance(200);
    expect(out).toEqual(['a']); // b nem ment ki
  });
});

describe('createRateLimiter', () => {
  test('burst a kapacitásig, utána tiltva', () => {
    const h = harness();
    const rl = createRateLimiter(3, 1, h.now);
    expect(rl.allow()).toBe(true);
    expect(rl.allow()).toBe(true);
    expect(rl.allow()).toBe(true);
    expect(rl.allow()).toBe(false);
  });

  test('idővel utántöltődik', () => {
    const h = harness();
    const rl = createRateLimiter(3, 1, h.now); // 1 token/mp
    rl.allow();
    rl.allow();
    rl.allow();
    expect(rl.allow()).toBe(false);
    h.setT(1000); // +1 token
    expect(rl.allow()).toBe(true);
    expect(rl.allow()).toBe(false);
    h.setT(3500); // +2.5 token → capacity 3-ig, de max 3
    expect(rl.allow()).toBe(true);
    expect(rl.allow()).toBe(true);
  });

  test('nem lépi túl a kapacitást utántöltéskor', () => {
    const h = harness();
    const rl = createRateLimiter(2, 5, h.now);
    rl.allow();
    rl.allow();
    h.setT(100000); // sok idő → de max 2
    expect(rl.allow()).toBe(true);
    expect(rl.allow()).toBe(true);
    expect(rl.allow()).toBe(false);
  });
});

describe('createPerSenderLimiter', () => {
  test('feladónként független vödrök', () => {
    const h = harness();
    const psl = createPerSenderLimiter(2, 1, h.now);
    expect(psl.allow('a')).toBe(true);
    expect(psl.allow('a')).toBe(true);
    expect(psl.allow('a')).toBe(false);
    expect(psl.allow('b')).toBe(true); // b külön vödör
    expect(psl.size()).toBe(2);
  });

  test('forget törli a feladó vödrét', () => {
    const h = harness();
    const psl = createPerSenderLimiter(1, 1, h.now);
    psl.allow('a');
    expect(psl.allow('a')).toBe(false);
    psl.forget('a');
    expect(psl.allow('a')).toBe(true); // új vödör, tele
  });
});
