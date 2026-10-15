const { HttpError, httpError, errorHandler } = require('./httpError');

function mockRes() {
  return {
    statusCode: null,
    body: null,
    headersSent: false,
    ended: false,
    status(c) {
      this.statusCode = c;
      return this;
    },
    json(b) {
      this.body = b;
      return this;
    },
    end() {
      this.ended = true;
      return this;
    },
  };
}

describe('httpError', () => {
  test('a gyártó státuszt + üzenetet + code/issues hordoz', () => {
    const e = httpError(400, 'rossz', { code: 'validation', issues: [{ path: 'a', message: 'kell' }] });
    expect(e).toBeInstanceOf(HttpError);
    expect(e.status).toBe(400);
    expect(e.message).toBe('rossz');
    expect(e.code).toBe('validation');
    expect(e.issues).toHaveLength(1);
    expect(e.expose).toBe(true);
  });

  test('errorHandler: HttpError → saját státusz + { error, code }', () => {
    const res = mockRes();
    errorHandler(httpError(402, 'Pro kell', { code: 'pro' }), {}, res, () => {});
    expect(res.statusCode).toBe(402);
    expect(res.body).toEqual({ error: 'Pro kell', code: 'pro' });
  });

  test('errorHandler: validációs HttpError → 400 + issues', () => {
    const res = mockRes();
    errorHandler(httpError(400, 'Érvénytelen kérés.', { code: 'validation', issues: [{ path: 'notes', message: 'kell' }] }), {}, res, () => {});
    expect(res.statusCode).toBe(400);
    expect(res.body.issues).toHaveLength(1);
  });

  test('errorHandler: ismeretlen hiba → 500, a belső üzenet NEM szivárog', () => {
    const res = mockRes();
    errorHandler(new Error('belső db stacktrace titok'), {}, res, () => {});
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Szerverhiba.' });
  });

  test('errorHandler: nem-egész status → 500', () => {
    const res = mockRes();
    const e = new Error('x');
    e.status = 'nope';
    errorHandler(e, {}, res, () => {});
    expect(res.statusCode).toBe(500);
  });

  test('errorHandler: headersSent → end(), nem ír újra státuszt', () => {
    const res = mockRes();
    res.headersSent = true;
    errorHandler(httpError(400, 'x'), {}, res, () => {});
    expect(res.ended).toBe(true);
    expect(res.statusCode).toBeNull();
  });
});
