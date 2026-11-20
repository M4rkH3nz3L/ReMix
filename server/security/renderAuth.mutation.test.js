// 🧪 renderAuth — mutációs rések: az üres-string tulajdonos „tulajdonos nélküli”-nek számít.
const { canAccessRenderJob } = require('./renderAuth');

describe('renderAuth — üres tulajdonos = tulajdonos nélküli job', () => {
  it("ownerId '' + insecure-dev → elérhető (mint a null)", () => {
    expect(canAccessRenderJob('', 'u1', true)).toBe(true);
    expect(canAccessRenderJob('', '', true)).toBe(true);
    expect(canAccessRenderJob('', null, true)).toBe(true);
  });

  it("ownerId '' prod-ban → elzárva, akkor is, ha a hívó is ''", () => {
    expect(canAccessRenderJob('', '', false)).toBe(false);
  });

  it('allowOwnerless csak szigorúan true-ra nyit (truthy nem elég)', () => {
    expect(canAccessRenderJob(null, 'u1', /** @type {any} */ (1))).toBe(false);
    expect(canAccessRenderJob(null, 'u1', /** @type {any} */ ('true'))).toBe(false);
  });

  it('tetszőleges nem-üres azonos azonosító egyezik (nincs „mágikus” tiltott id)', () => {
    expect(canAccessRenderJob('Stryker was here!', 'Stryker was here!')).toBe(true);
    expect(canAccessRenderJob('0', '0')).toBe(true);
  });

  it('a tulajdonolt jobnál az allowOwnerless nem ad hozzáférést idegennek', () => {
    expect(canAccessRenderJob('u1', 'u2', true)).toBe(false);
    expect(canAccessRenderJob('u1', null, true)).toBe(false);
  });
});
