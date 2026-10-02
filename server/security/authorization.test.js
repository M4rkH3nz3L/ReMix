const {
  decide,
  routeInventory,
  clearInventory,
  publicRoute,
  authenticated,
  pro,
  system,
} = require('./authorization');

describe('authorization — decide() pure policy-döntés', () => {
  it('PUBLIC: mindig enged', () => {
    expect(decide('PUBLIC', {}).allow).toBe(true);
    expect(decide('PUBLIC', { authed: false }).allow).toBe(true);
  });

  it('AUTHENTICATED: csak hitelesítve', () => {
    expect(decide('AUTHENTICATED', { authed: true }).allow).toBe(true);
    expect(decide('AUTHENTICATED', { authed: false })).toMatchObject({ allow: false, status: 401 });
  });

  it('PRO: token kell (401), majd Pro kell (402)', () => {
    expect(decide('PRO', { authed: false })).toMatchObject({ allow: false, status: 401 });
    expect(decide('PRO', { authed: true, pro: false })).toMatchObject({ allow: false, status: 402 });
    expect(decide('PRO', { authed: true, pro: true }).allow).toBe(true);
  });

  it('OWNER: tulajdonos kell (403 ha nem az)', () => {
    expect(decide('OWNER', { authed: true, owner: true }).allow).toBe(true);
    expect(decide('OWNER', { authed: true, owner: false })).toMatchObject({ allow: false, status: 403 });
    expect(decide('OWNER', { authed: false })).toMatchObject({ allow: false, status: 401 });
  });

  it('EDITOR: owner VAGY editor', () => {
    expect(decide('EDITOR', { authed: true, editor: true }).allow).toBe(true);
    expect(decide('EDITOR', { authed: true, owner: true }).allow).toBe(true);
    expect(decide('EDITOR', { authed: true })).toMatchObject({ allow: false, status: 403 });
  });

  it('MODERATOR / ADMIN: szerep-alapú', () => {
    expect(decide('MODERATOR', { authed: true, role: 'moderator' }).allow).toBe(true);
    expect(decide('MODERATOR', { authed: true, role: 'admin' }).allow).toBe(true);
    expect(decide('MODERATOR', { authed: true, role: null })).toMatchObject({ allow: false, status: 403 });
    expect(decide('ADMIN', { authed: true, role: 'admin' }).allow).toBe(true);
    expect(decide('ADMIN', { authed: true, role: 'moderator' })).toMatchObject({ allow: false, status: 403 });
  });

  it('SYSTEM: csak rendszer-hívó', () => {
    expect(decide('SYSTEM', { system: true }).allow).toBe(true);
    expect(decide('SYSTEM', { system: false })).toMatchObject({ allow: false, status: 403 });
  });

  it('ismeretlen szint → 403', () => {
    expect(decide('NINCS_ILYEN', { authed: true })).toMatchObject({ allow: false, status: 403 });
  });
});

describe('authorization — route-inventory (API9)', () => {
  beforeEach(() => clearInventory());

  it('a factory-k regisztrálják a route-ot a helyes szinttel', () => {
    publicRoute({ method: 'GET', path: '/library' });
    authenticated({ method: 'POST', path: '/media/upload', rateClass: 'upload' });
    pro({ method: 'POST', path: '/render', rateClass: 'render' });
    system({ method: 'GET', path: '/health/routes' });

    const inv = routeInventory();
    expect(inv).toHaveLength(4);
    expect(inv).toEqual(
      expect.arrayContaining([
        { level: 'PUBLIC', method: 'GET', path: '/library', rateClass: null },
        { level: 'AUTHENTICATED', method: 'POST', path: '/media/upload', rateClass: 'upload' },
        { level: 'PRO', method: 'POST', path: '/render', rateClass: 'render' },
        { level: 'SYSTEM', method: 'GET', path: '/health/routes', rateClass: null },
      ])
    );
  });

  it('nincs UNSET: minden regisztrált szint az ismert LEVELS közül való', () => {
    publicRoute({ path: '/a' });
    pro({ path: '/b' });
    const { LEVELS } = require('./authorization');
    for (const r of routeInventory()) {
      expect(LEVELS).toContain(r.level);
    }
  });
});

describe('authorization — publicRoute middleware passthrough', () => {
  beforeEach(() => clearInventory());
  it('publicRoute átenged (next hívás)', () => {
    const mws = publicRoute({ path: '/x' });
    const next = jest.fn();
    mws[0]({}, {}, next);
    expect(next).toHaveBeenCalled();
  });
});
