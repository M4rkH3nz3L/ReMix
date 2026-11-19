// 🔑 authorization — a middleware-ek (proGate, system) ágai és a decide() alapértelmezései.
// Minden eset friss modul-regiszterből tölt (jest.resetModules), mert az INSECURE_DEV és a
// WORKER_SYSTEM_SECRET a betöltéskor rögzül; a billing-réteg jest.doMock-kal hamisított.

const ENV_KEYS = ['ALLOW_INSECURE_DEV', 'WORKER_SYSTEM_SECRET'];
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
  jest.dontMock('../billing');
});

/** friss authorization-modul az aktuális env-vel; opcionális billing-gyártóval */
function loadAuthz(billingFactory) {
  // a proGate a billinget HÍVÁSKOR require-eli → a mocknak a fő regiszterben kell lennie
  jest.resetModules();
  if (billingFactory) jest.doMock('../billing', billingFactory);
  return require('./authorization');
}

function mockRes() {
  return {
    statusCode: null,
    body: null,
    status(c) {
      this.statusCode = c;
      return this;
    },
    json(b) {
      this.body = b;
      return this;
    },
  };
}

/** a proGate aszinkron ágainak bevárása (a then/catch láncon) */
const flush = () => new Promise((r) => setImmediate(r));

describe('authorization — decide() alapértelmezések', () => {
  it('caps nélkül: PUBLIC enged, a hitelesítést kérő szintek 401-et adnak', () => {
    const { decide } = loadAuthz();
    expect(decide('PUBLIC')).toEqual({ allow: true });
    expect(decide('AUTHENTICATED')).toEqual({ allow: false, status: 401, error: 'Hitelesítés szükséges.' });
    expect(decide('SYSTEM')).toEqual({ allow: false, status: 403, error: 'Rendszer-szintű hívás szükséges.' });
  });

  it('hitelesítés nélkül minden szerep-szint 401 (a szerep önmagában nem elég)', () => {
    const { decide } = loadAuthz();
    for (const level of ['EDITOR', 'MODERATOR', 'ADMIN']) {
      expect(decide(level, { authed: false, owner: true, editor: true, role: 'admin' })).toMatchObject({
        allow: false,
        status: 401,
      });
    }
  });

  it('a megtagadás pontos hibaüzenetet ad szintenként', () => {
    const { decide } = loadAuthz();
    expect(decide('PRO', { authed: true }).error).toBe('Ehhez a funkcióhoz Pro-előfizetés szükséges.');
    expect(decide('OWNER', { authed: true }).error).toBe('Nincs jogosultság (tulajdonos szükséges).');
    expect(decide('EDITOR', { authed: true }).error).toBe('Nincs jogosultság (szerkesztő szükséges).');
    expect(decide('MODERATOR', { authed: true }).error).toBe('Moderátor jogosultság szükséges.');
    expect(decide('ADMIN', { authed: true }).error).toBe('Admin jogosultság szükséges.');
    expect(decide('XYZ').error).toBe('Ismeretlen policy-szint: XYZ');
  });
});

describe('authorization — registerRoute meta nélkül', () => {
  it('a hiányzó meta-mezők null-ként kerülnek a leltárba', () => {
    const { registerRoute, routeInventory, clearInventory } = loadAuthz();
    clearInventory();
    registerRoute('PUBLIC');
    expect(routeInventory()).toEqual([{ level: 'PUBLIC', method: null, path: null, rateClass: null }]);
  });

  it('a leltár másolat: a visszaadott sor módosítása nem írja át a belsőt', () => {
    const { registerRoute, routeInventory, clearInventory } = loadAuthz();
    clearInventory();
    registerRoute('PRO', { path: '/render' });
    routeInventory()[0].level = 'PUBLIC';
    expect(routeInventory()[0].level).toBe('PRO');
  });
});

describe('authorization — proGate (szerver-hiteles Pro-kapu)', () => {
  it('hívó-azonosító nélkül 401, a billing meg sem hívódik', () => {
    const isPro = jest.fn();
    const { proGate } = loadAuthz(() => ({ isPro }));
    const res = mockRes();
    const next = jest.fn();
    proGate({}, res, next);
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'Nem azonosítható hívó.' });
    expect(isPro).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('Pro-hívó → next(), a billing a verifikált uid-del kérdez', async () => {
    const isPro = jest.fn().mockResolvedValue(true);
    const { proGate } = loadAuthz(() => ({ isPro }));
    const res = mockRes();
    const next = jest.fn();
    proGate({ user: { id: 'u-pro' } }, res, next);
    await flush();
    expect(isPro).toHaveBeenCalledWith('u-pro');
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBeNull();
  });

  it('nem-Pro hívó → 402 pro:true jelzéssel', async () => {
    const { proGate } = loadAuthz(() => ({ isPro: jest.fn().mockResolvedValue(false) }));
    const res = mockRes();
    const next = jest.fn();
    proGate({ user: { id: 'u-free' } }, res, next);
    await flush();
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(402);
    expect(res.body).toEqual({ error: 'Ehhez a funkcióhoz Pro-előfizetés szükséges.', pro: true });
  });

  it('a billing-lekérdezés hibája → 402 (fail-closed), nem enged át', async () => {
    const { proGate } = loadAuthz(() => ({ isPro: jest.fn().mockRejectedValue(new Error('db le')) }));
    const res = mockRes();
    const next = jest.fn();
    proGate({ user: { id: 'u1' } }, res, next);
    await flush();
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(402);
    expect(res.body).toEqual({ error: 'Az előfizetés nem ellenőrizhető.', pro: true });
  });

  it('a billing-modul betöltési hibája → 503', () => {
    const { proGate } = loadAuthz(() => {
      throw new Error('billing betöltés bukott');
    });
    const res = mockRes();
    const next = jest.fn();
    proGate({ user: { id: 'u1' } }, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({ error: 'A billing-réteg nem elérhető.' });
  });

  it('ALLOW_INSECURE_DEV=1 → azonosítás és billing nélkül is átenged', () => {
    process.env.ALLOW_INSECURE_DEV = '1';
    const isPro = jest.fn();
    const { proGate } = loadAuthz(() => ({ isPro }));
    const next = jest.fn();
    const res = mockRes();
    proGate({}, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(isPro).not.toHaveBeenCalled();
    expect(res.statusCode).toBeNull();
  });

  it('a pro() factory a requireAuth után a proGate-et fűzi', () => {
    const { pro, proGate, clearInventory } = loadAuthz();
    clearInventory();
    const mws = pro({ path: '/x' });
    expect(mws).toHaveLength(2);
    expect(mws[1]).toBe(proGate);
  });
});

describe('authorization — system() (service-secret kapu)', () => {
  const run = (mw, headers) => {
    const res = mockRes();
    const next = jest.fn();
    mw({ headers }, res, next);
    return { res, next };
  };

  it('egyező x-system-secret → next()', () => {
    process.env.WORKER_SYSTEM_SECRET = '  titok-123  ';
    const { system } = loadAuthz();
    const [mw] = system({ path: '/health/routes' });
    const { res, next } = run(mw, { 'x-system-secret': 'titok-123' });
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBeNull();
  });

  it('eltérő vagy hiányzó secret → 403', () => {
    process.env.WORKER_SYSTEM_SECRET = 'titok-123';
    const { system } = loadAuthz();
    const [mw] = system({});
    for (const headers of [{ 'x-system-secret': 'rossz' }, {}]) {
      const { res, next } = run(mw, headers);
      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(403);
      expect(res.body).toEqual({ error: 'Rendszer-szintű hívás szükséges.' });
    }
  });

  it('beállítatlan szerver-secret mellett az üres fejléc sem nyit (nincs "" === "")', () => {
    const { system } = loadAuthz();
    const [mw] = system({});
    const { res, next } = run(mw, { 'x-system-secret': '' });
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it('ALLOW_INSECURE_DEV=1 → secret nélkül is átenged', () => {
    process.env.ALLOW_INSECURE_DEV = '1';
    const { system } = loadAuthz();
    const [mw] = system({});
    const { res, next } = run(mw, {});
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBeNull();
  });
});
