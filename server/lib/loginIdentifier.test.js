const { loginWithIdentifier } = require('./loginIdentifier');

const session = { access_token: 'a', refresh_token: 'r' };
const deps = (over = {}) => ({
  resolveEmail: jest.fn(async () => 'titkos@x.hu'),
  signIn: jest.fn(async () => ({ data: { session }, error: null })),
  ...over,
});

describe('loginWithIdentifier', () => {
  it('sikeres belépésnél tokent ad, e-mailt nem', async () => {
    const out = await loginWithIdentifier({ identifier: 'bob', password: 'x' }, deps());
    expect(out).toEqual({ status: 200, body: { access_token: 'a', refresh_token: 'r' } });
    expect(JSON.stringify(out)).not.toContain('titkos@x.hu');
  });

  it('ismeretlen azonosító és rossz jelszó ugyanaz a válasz', async () => {
    const unknown = await loginWithIdentifier({ identifier: 'nincs', password: 'x' }, deps({ resolveEmail: async () => null }));
    const wrong = await loginWithIdentifier({ identifier: 'bob', password: 'x' }, deps({ signIn: async () => ({ data: {}, error: { code: 'invalid_credentials', message: 'titkos@x.hu' } }) }));
    expect(unknown).toEqual(wrong);
    expect(JSON.stringify(wrong)).not.toContain('titkos');
  });

  it('ismeretlen azonosítónál jelszót sem próbál', async () => {
    const d = deps({ resolveEmail: jest.fn(async () => null) });
    await loginWithIdentifier({ identifier: 'nincs', password: 'x' }, d);
    expect(d.signIn).not.toHaveBeenCalled();
  });

  it.each([[{ identifier: '', password: 'x' }], [{ identifier: 'a', password: '' }], [{ identifier: 5, password: 'x' }], [{ identifier: 'a'.repeat(201), password: 'x' }]])('hibás kérés: %j', async (body) => {
    expect((await loginWithIdentifier(body, deps())).status).toBe(400);
  });

  it('megerősítetlen fiók külön üzenet', async () => {
    const out = await loginWithIdentifier({ identifier: 'bob', password: 'x' }, deps({ signIn: async () => ({ data: {}, error: { code: 'email_not_confirmed' } }) }));
    expect(out.status).toBe(403);
  });
});
