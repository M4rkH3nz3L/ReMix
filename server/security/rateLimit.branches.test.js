// 🧱 rateLimit — a kulcs-választás tartalékai, a vészkapcsoló, a tár-választás (Redis / memória)
// és a limiter-hiba ága. A modul a betöltéskor olvassa az envet → minden eset friss regiszterből.

const ENV_KEYS = ['ALLOW_INSECURE_DEV', 'RL_DISABLED', 'RL_AI_MAX', 'RL_AI_WINDOW'];
let savedEnv;
beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  jest.dontMock('../queue');
  jest.dontMock('./auditLog');
  jest.restoreAllMocks();
});

/** friss rateLimit-modul; a queue (Redis) és az audit hamisítva */
function load(queueFactory) {
  jest.resetModules();
  jest.doMock('./auditLog', () => ({ securityEvent: jest.fn(), audit: jest.fn() }));
  if (queueFactory) jest.doMock('../queue', queueFactory);
  return require('./rateLimit');
}

/** egy middleware-hívás → 'next' vagy a státusz-kód; a fejlécek gyűjtve */
function hit(mw, req = { headers: { 'x-forwarded-for': '7.7.7.7' }, method: 'GET', path: '/x' }) {
  return new Promise((resolve) => {
    const headers = {};
    const res = {
      setHeader(k, v) {
        headers[k] = v;
      },
      status(c) {
        this.code = c;
        return this;
      },
      json(body) {
        resolve({ out: this.code, headers, body });
      },
    };
    mw(req, res, () => resolve({ out: 'next', headers }));
  });
}

/** in-memory hamis Redis (incr + pexpire) */
function fakeRedis() {
  const counts = new Map();
  return {
    incr: jest.fn(async (k) => {
      counts.set(k, (counts.get(k) || 0) + 1);
      return counts.get(k);
    }),
    pexpire: jest.fn(async () => 1),
  };
}

describe('rateLimit — keyFor tartalékok', () => {
  it('login-osztályban az eszköz-fejléc NEM számít (hamisítható), csak az IP', () => {
    const { keyFor } = load();
    const req = { headers: { 'x-device-id': 'd1', 'x-forwarded-for': '1.1.1.1' } };
    expect(keyFor(req, 'login')).toBe('rl:login:ip:1.1.1.1');
  });

  it('nem-szöveges (tömb) eszköz-fejléc → IP-re esik vissza', () => {
    const { keyFor } = load();
    const req = { headers: { 'x-device-id': ['a', 'b'] }, ip: '2.2.2.2' };
    expect(keyFor(req, 'ai')).toBe('rl:ai:ip:2.2.2.2');
  });

  it('a hosszú eszköz-id 64 karakterre vágva', () => {
    const { keyFor } = load();
    expect(keyFor({ headers: { 'x-device-id': 'd'.repeat(100) } }, 'ai')).toBe(`rl:ai:d:${'d'.repeat(64)}`);
  });

  it('se XFF, se req.ip, se socket → "unknown" (egy közös vödör)', () => {
    const { keyFor } = load();
    expect(keyFor({ headers: {} }, 'public')).toBe('rl:public:ip:unknown');
    expect(keyFor({ headers: { 'x-forwarded-for': ' , 9.9.9.9' }, socket: {} }, 'public')).toBe('rl:public:ip:unknown');
  });

  // KÉRDÉS: token és eszköz-id nélkül a kulcs a kliens által küldött X-Forwarded-For ELSŐ eleme, így
  // proxy nélkül (vagy ha a proxy hozzáfűz, nem felülír) a hívó kérésenként új „IP”-t mondhat és
  // megkerüli a limitet; ugyanez igaz a szabadon választható x-device-id-re. Döntés: csak megbízható
  // proxytól (trust proxy / req.ip) kellene venni az IP-t.
  it('a hamisított X-Forwarded-For kérésenként új vödröt ad', () => {
    const { keyFor } = load();
    const a = keyFor({ headers: { 'x-forwarded-for': '1.0.0.1' }, ip: '5.5.5.5' }, 'ai');
    const b = keyFor({ headers: { 'x-forwarded-for': '1.0.0.2' }, ip: '5.5.5.5' }, 'ai');
    expect(a).toBe('rl:ai:ip:1.0.0.1');
    expect(b).toBe('rl:ai:ip:1.0.0.2');
  });

  it('a req.ip megelőzi a socket-címet', () => {
    const { keyFor } = load();
    expect(keyFor({ headers: {}, ip: '3.3.3.3', socket: { remoteAddress: '4.4.4.4' } }, 'ai')).toBe('rl:ai:ip:3.3.3.3');
  });
});

describe('rateLimit — classConfig érvénytelen env', () => {
  it('nem-szám / nulla / negatív felülírás → az alap-érték marad', () => {
    const { classConfig, DEFAULTS } = load();
    for (const [max, win] of [['abc', 'xyz'], ['0', '0'], ['-3', '-100']]) {
      process.env.RL_AI_MAX = max;
      process.env.RL_AI_WINDOW = win;
      expect(classConfig('ai')).toEqual(DEFAULTS.ai);
    }
  });
});

describe('rateLimit — vészkapcsoló és dev-kapu', () => {
  it.each(['RL_DISABLED', 'ALLOW_INSECURE_DEV'])('%s=1 → no-op middleware, fejléc és tár nélkül', async (k) => {
    process.env[k] = '1';
    const queueEnabled = jest.fn(() => true);
    const { rateLimit } = load(() => ({ queueEnabled, connection: jest.fn() }));
    const r = await hit(rateLimit('ai'));
    expect(r).toEqual({ out: 'next', headers: {} });
    expect(queueEnabled).not.toHaveBeenCalled();
  });
});

describe('rateLimit — tár-választás', () => {
  it('REDIS elérhető → RedisStore: incr + egyszeri pexpire, a tár újrahasznosítva', async () => {
    process.env.RL_AI_MAX = '2';
    process.env.RL_AI_WINDOW = '60000';
    // rögzített idő: a három hit biztosan ugyanabba a Redis-vödörbe esik
    jest.spyOn(Date, 'now').mockReturnValue(1_700_000_030_000);
    const redis = fakeRedis();
    const connection = jest.fn(() => redis);
    const { rateLimit } = load(() => ({ queueEnabled: () => true, connection }));
    const mw = rateLimit('ai');
    const req = { user: { id: 'u1' }, headers: {}, method: 'POST', path: '/ai/x' };
    expect((await hit(mw, req)).out).toBe('next');
    const second = await hit(mw, req);
    expect(second.out).toBe('next');
    expect(second.headers['X-RateLimit-Remaining']).toBe('0');
    const third = await hit(mw, req);
    expect(third.out).toBe(429);
    expect(third.headers['Retry-After']).toMatch(/^\d+$/);
    expect(redis.incr).toHaveBeenCalledTimes(3);
    expect(redis.incr.mock.calls[0][0]).toMatch(/^rl:ai:u:u1:\d+$/);
    expect(redis.pexpire).toHaveBeenCalledTimes(1);
    expect(redis.pexpire).toHaveBeenCalledWith(redis.incr.mock.calls[0][0], 60000);
    expect(connection).toHaveBeenCalledTimes(1);
  });

  it('a queue nincs bekapcsolva → memória-tár (a connection nem hívódik)', async () => {
    process.env.RL_AI_MAX = '1';
    const connection = jest.fn();
    const { rateLimit } = load(() => ({ queueEnabled: () => false, connection }));
    const mw = rateLimit('ai');
    expect((await hit(mw)).out).toBe('next');
    expect((await hit(mw)).out).toBe(429);
    expect(connection).not.toHaveBeenCalled();
  });

  it('a queue-modul betöltési hibája → memória-tár fallback, a kérés átmegy', async () => {
    const { rateLimit } = load(() => {
      throw new Error('ioredis hiányzik');
    });
    const r = await hit(rateLimit('ai'));
    expect(r.out).toBe('next');
    expect(r.headers['X-RateLimit-Limit']).toBe('30');
    expect(r.headers['X-RateLimit-Remaining']).toBe('29');
  });

  // KÉRDÉS: a limiter-tár hibájánál (pl. Redis-kiesés) a middleware fail-OPEN: next()-et hív, így
  // a DoS/költség-védelem csendben megszűnik a kiesés idejére. Ez tudatos döntésnek látszik (a legitim
  // kérés ne essen el), de a drága osztályoknál (ai/render/login) érdemes lehet fail-closed / memória-tartalék.
  it('a tár hibája → fail-open: next(), limit-fejléc nélkül', async () => {
    const redis = { incr: jest.fn(async () => { throw new Error('ECONNREFUSED'); }), pexpire: jest.fn() };
    const { rateLimit } = load(() => ({ queueEnabled: () => true, connection: () => redis }));
    const r = await hit(rateLimit('login'));
    expect(r).toEqual({ out: 'next', headers: {} });
    expect(redis.incr).toHaveBeenCalledTimes(1);
  });
});

describe('rateLimit — MemoryStore.reset', () => {
  it('a reset után a számláló elölről indul', async () => {
    const { MemoryStore, evaluate } = load();
    const st = new MemoryStore();
    const cfg = { max: 1, windowMs: 60_000 };
    expect((await evaluate(st, 'k', cfg)).allowed).toBe(true);
    expect((await evaluate(st, 'k', cfg)).allowed).toBe(false);
    st.reset();
    expect((await evaluate(st, 'k', cfg)).allowed).toBe(true);
  });
});
