// 💸 PayPal-kifizetés (payouts.js): a kulcs-kapu, a cél-ellenőrzés, a token → payout hívássorrend és a
// küldött összeg alakja — hamis fetch-csel, hálózat nélkül. A hibaágak dobnak (a runner ebből failed-et
// csinál, a DB visszaírja a Coint).
const ENV = { ...process.env };

function loadPayouts(env = {}) {
  jest.resetModules();
  process.env = { ...ENV, ...env };
  return require('./payouts');
}

/** hamis fetch: az URL szerint válaszol, és rögzíti a kéréseket */
function fakeFetch(routes) {
  const calls = [];
  const impl = jest.fn(async (url, init) => {
    calls.push({ url, init, body: init && init.body });
    const r = routes[Object.keys(routes).find((k) => url.endsWith(k))];
    return { ok: r.ok !== false, status: r.status || 200, json: r.json || (async () => r.body) };
  });
  return { calls, impl };
}

const KEYS = { PAYPAL_CLIENT_ID: 'cid', PAYPAL_SECRET: 'sec' };

afterEach(() => {
  process.env = { ...ENV };
  delete global.fetch;
});

describe('payoutsConfigured', () => {
  test('csak mindkét kulccsal van bekötve', () => {
    expect(loadPayouts({ PAYPAL_CLIENT_ID: '', PAYPAL_SECRET: '' }).payoutsConfigured()).toBe(false);
    expect(loadPayouts({ PAYPAL_CLIENT_ID: 'a', PAYPAL_SECRET: '' }).payoutsConfigured()).toBe(false);
    expect(loadPayouts({ PAYPAL_CLIENT_ID: '', PAYPAL_SECRET: 'b' }).payoutsConfigured()).toBe(false);
    expect(loadPayouts(KEYS).payoutsConfigured()).toBe(true);
  });
});

describe('sendPayout', () => {
  test('nem-PayPal cél vagy hiányzó e-mail → dob, hálózati hívás nélkül', async () => {
    const { sendPayout } = loadPayouts(KEYS);
    global.fetch = jest.fn();
    await expect(sendPayout(null, 100)).rejects.toThrow('Jelenleg csak PayPal');
    await expect(sendPayout({ provider: 'stripe', email: 'a@b.c' }, 100)).rejects.toThrow('Jelenleg csak PayPal');
    await expect(sendPayout({ provider: 'paypal' }, 100)).rejects.toThrow('Hiányzó PayPal e-mail');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('sandbox: token (Basic auth) → payout (Bearer), EUR két tizedessel, a batch-id-t adja vissza', async () => {
    const { sendPayout } = loadPayouts(KEYS);
    const f = fakeFetch({
      '/v1/oauth2/token': { body: { access_token: 'tok' } },
      '/v1/payments/payouts': { body: { batch_header: { payout_batch_id: 'B1' } } },
    });
    global.fetch = f.impl;
    await expect(sendPayout({ provider: 'paypal', email: 'x@y.z' }, 6050, 'jegyzet')).resolves.toBe('B1');
    expect(f.calls.map((c) => c.url)).toEqual(['https://api-m.sandbox.paypal.com/v1/oauth2/token', 'https://api-m.sandbox.paypal.com/v1/payments/payouts']);
    expect(f.calls[0].init.headers.Authorization).toBe(`Basic ${Buffer.from('cid:sec').toString('base64')}`);
    expect(f.calls[0].body).toBe('grant_type=client_credentials');
    expect(f.calls[1].init.headers.Authorization).toBe('Bearer tok');
    const body = JSON.parse(f.calls[1].body);
    expect(body.items).toEqual([{ recipient_type: 'EMAIL', amount: { value: '60.50', currency: 'EUR' }, receiver: 'x@y.z', note: 'jegyzet' }]);
    expect(body.sender_batch_header.email_message).toBe('jegyzet');
    // KÉRDÉS: a sender_batch_id minden hívásnál új véletlen UUID. A PayPal ezen szűri a dupla kérést —
    // egy időtúllépés utáni újrapróbálás így kétszer utalhat. A kérés-id-ből képzett kulcs (mint a
    // Stripe-nál a `payout-<id>` Idempotency-Key) ezt kizárná. Ma a runner nem próbálja újra (a hiba
    // failed-et ad), de a kézi újraindítás igen. Legyen determinisztikus?
    expect(body.sender_batch_header.sender_batch_id).toMatch(/^remix-[0-9a-f-]{36}$/);
  });

  test('élő környezet: az éles PayPal-címre megy; jegyzet nélkül az alapszövegek', async () => {
    const { sendPayout } = loadPayouts({ ...KEYS, PAYPAL_ENV: 'live' });
    const f = fakeFetch({ '/v1/oauth2/token': { body: { access_token: 't' } }, '/v1/payments/payouts': { body: {} } });
    global.fetch = f.impl;
    await expect(sendPayout({ provider: 'paypal', email: 'x@y.z' }, 100)).resolves.toBeNull();
    expect(f.calls[0].url).toBe('https://api-m.paypal.com/v1/oauth2/token');
    const body = JSON.parse(f.calls[1].body);
    expect(body.items[0].note).toBe('ReMix payout');
    expect(body.sender_batch_header.email_message).toBe('Coin-beváltás a ReMixből.');
  });

  test('token-hiba: a PayPal üzenete, vagy a státuszkód; hiányzó token is hiba', async () => {
    const { sendPayout } = loadPayouts(KEYS);
    global.fetch = fakeFetch({ '/v1/oauth2/token': { ok: false, status: 401, body: { error_description: 'bad client' } } }).impl;
    await expect(sendPayout({ provider: 'paypal', email: 'x' }, 1)).rejects.toThrow('bad client');
    global.fetch = fakeFetch({ '/v1/oauth2/token': { ok: false, status: 503, json: async () => { throw new Error('nem JSON'); } } }).impl;
    await expect(sendPayout({ provider: 'paypal', email: 'x' }, 1)).rejects.toThrow('PayPal token hiba (503)');
    global.fetch = fakeFetch({ '/v1/oauth2/token': { body: {} } }).impl;
    await expect(sendPayout({ provider: 'paypal', email: 'x' }, 1)).rejects.toThrow('PayPal token hiba (200)');
  });

  test('payout-hiba: a PayPal üzenete, vagy a státuszkód', async () => {
    const { sendPayout } = loadPayouts(KEYS);
    global.fetch = fakeFetch({ '/v1/oauth2/token': { body: { access_token: 't' } }, '/v1/payments/payouts': { ok: false, status: 422, body: { message: 'RECEIVER_UNREGISTERED' } } }).impl;
    await expect(sendPayout({ provider: 'paypal', email: 'x' }, 1)).rejects.toThrow('RECEIVER_UNREGISTERED');
    global.fetch = fakeFetch({ '/v1/oauth2/token': { body: { access_token: 't' } }, '/v1/payments/payouts': { ok: false, status: 500, json: async () => { throw new Error('x'); } } }).impl;
    await expect(sendPayout({ provider: 'paypal', email: 'x' }, 1)).rejects.toThrow('PayPal payout hiba (500)');
  });
});
