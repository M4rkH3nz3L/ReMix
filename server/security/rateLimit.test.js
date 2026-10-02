const { keyFor, classConfig, evaluate, MemoryStore, DEFAULTS } = require('./rateLimit');

describe('rateLimit — kulcs-választás (user > device > IP)', () => {
  it('verifikált user → user-kulcs', () => {
    const req = { user: { id: 'u1' }, headers: { 'x-device-id': 'd1', 'x-forwarded-for': '1.2.3.4' } };
    expect(keyFor(req, 'ai')).toBe('rl:ai:u:u1');
  });

  it('user nélkül, eszköz-id-vel → device-kulcs', () => {
    const req = { headers: { 'x-device-id': 'dev-abc', 'x-forwarded-for': '1.2.3.4' } };
    expect(keyFor(req, 'render')).toBe('rl:render:d:dev-abc');
  });

  it('se user, se device → IP-kulcs (X-Forwarded-For első eleme)', () => {
    const req = { headers: { 'x-forwarded-for': '9.9.9.9, 10.0.0.1' } };
    expect(keyFor(req, 'public')).toBe('rl:public:ip:9.9.9.9');
  });

  it('XFF nélkül → socket.remoteAddress', () => {
    const req = { headers: {}, socket: { remoteAddress: '5.6.7.8' } };
    expect(keyFor(req, 'ai')).toBe('rl:ai:ip:5.6.7.8');
  });
});

describe('rateLimit — osztály-konfiguráció', () => {
  it('ismert osztály alap-értéke', () => {
    expect(classConfig('ai')).toEqual(DEFAULTS.ai);
  });

  it('ismeretlen osztály → default', () => {
    expect(classConfig('nincs-ilyen')).toEqual(DEFAULTS.default);
  });

  it('env-felülírás (RL_AI_MAX / RL_AI_WINDOW)', () => {
    const prevMax = process.env.RL_AI_MAX;
    const prevWin = process.env.RL_AI_WINDOW;
    process.env.RL_AI_MAX = '5';
    process.env.RL_AI_WINDOW = '10000';
    try {
      expect(classConfig('ai')).toEqual({ max: 5, windowMs: 10000 });
    } finally {
      if (prevMax === undefined) delete process.env.RL_AI_MAX;
      else process.env.RL_AI_MAX = prevMax;
      if (prevWin === undefined) delete process.env.RL_AI_WINDOW;
      else process.env.RL_AI_WINDOW = prevWin;
    }
  });
});

describe('rateLimit — evaluate + MemoryStore (küszöb + ablak-reset)', () => {
  it('a max-ig enged, utána blokkol (429), helyes remaining', async () => {
    const st = new MemoryStore();
    const cfg = { max: 3, windowMs: 60_000 };
    const r1 = await evaluate(st, 'rl:t:ip:x', cfg);
    const r2 = await evaluate(st, 'rl:t:ip:x', cfg);
    const r3 = await evaluate(st, 'rl:t:ip:x', cfg);
    const r4 = await evaluate(st, 'rl:t:ip:x', cfg);
    expect(r1.allowed).toBe(true);
    expect(r1.remaining).toBe(2);
    expect(r3.allowed).toBe(true);
    expect(r3.remaining).toBe(0);
    expect(r4.allowed).toBe(false); // 4. hit > max(3)
    expect(r4.retryAfterSec).toBeGreaterThan(0);
  });

  it('külön kulcsok külön számolnak', async () => {
    const st = new MemoryStore();
    const cfg = { max: 1, windowMs: 60_000 };
    expect((await evaluate(st, 'rl:t:ip:a', cfg)).allowed).toBe(true);
    expect((await evaluate(st, 'rl:t:ip:b', cfg)).allowed).toBe(true); // más kulcs
    expect((await evaluate(st, 'rl:t:ip:a', cfg)).allowed).toBe(false); // a kimerült
  });

  it('az ablak lejárta után újra enged', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
    try {
      const st = new MemoryStore();
      const cfg = { max: 1, windowMs: 1000 };
      expect((await evaluate(st, 'rl:t:ip:win', cfg)).allowed).toBe(true);
      expect((await evaluate(st, 'rl:t:ip:win', cfg)).allowed).toBe(false);
      jest.setSystemTime(1500); // az 1000 ms ablak lejárt
      expect((await evaluate(st, 'rl:t:ip:win', cfg)).allowed).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });
});
