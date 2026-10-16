// 🔎 A rate-limit 429-blokk AUDIT-eseménye (04-security §04.2/§04.7). Külön fájl:
// a jest.mock('./auditLog') + a dev-kapu-tisztítás a rateLimit require-je ELŐTT fut
// (a server-projektnek nincs babel-hoisting → kézi sorrend).

// a middleware csak akkor aktív, ha a dev-kapuk OFF-ok (más teszt-fájl szennyezhette az envet)
delete process.env.ALLOW_INSECURE_DEV;
delete process.env.RL_DISABLED;
process.env.RL_PUBLIC_MAX = '1';
process.env.RL_PUBLIC_WINDOW = '60000';

jest.mock('./auditLog', () => ({ securityEvent: jest.fn(), audit: jest.fn() }));
const { securityEvent } = require('./auditLog');
const { rateLimit } = require('./rateLimit');

/** Egy middleware-hívás → feloldódik, amikor next() VAGY res.json() lefut. */
function hit(mw) {
  return new Promise((resolve) => {
    const req = { headers: { 'x-forwarded-for': '7.7.7.7' }, method: 'POST', path: '/storage/connect' };
    const res = {
      setHeader() {},
      status(c) {
        this._code = c;
        return this;
      },
      json() {
        resolve(this._code);
      },
    };
    mw(req, res, () => resolve(200));
  });
}

describe('rateLimit middleware — 429 → ratelimit.block audit', () => {
  test('a limit (RL_PUBLIC_MAX=1) átlépése → 429 + securityEvent("ratelimit.block")', async () => {
    const mw = rateLimit('public');
    const first = await hit(mw); // 1. kérés → átmegy
    const second = await hit(mw); // 2. kérés (ugyanaz a kulcs) → blokk
    expect(first).toBe(200);
    expect(second).toBe(429);
    expect(securityEvent).toHaveBeenCalledWith(
      'ratelimit.block',
      expect.objectContaining({ result: 'blocked', meta: expect.objectContaining({ class: 'public' }) })
    );
  });
});
