const { securityHeaders } = require('./securityHeaders');

function mockRes() {
  const headers = {};
  return {
    headers,
    setHeader(k, v) {
      headers[k] = v;
    },
    removeHeader(k) {
      delete headers[k];
    },
  };
}

describe('securityHeaders middleware', () => {
  it('beállítja a biztonsági fejléceket és meghívja a next-et', () => {
    const res = mockRes();
    res.headers['X-Powered-By'] = 'Express'; // Express alapból beállítaná
    const next = jest.fn();

    securityHeaders()({}, res, next);

    expect(res.headers['X-Content-Type-Options']).toBe('nosniff');
    expect(res.headers['X-Frame-Options']).toBe('DENY');
    expect(res.headers['Referrer-Policy']).toBe('no-referrer');
    expect(res.headers['X-DNS-Prefetch-Control']).toBe('off');
    expect(res.headers['X-Permitted-Cross-Domain-Policies']).toBe('none');
    expect(res.headers['Strict-Transport-Security']).toContain('max-age=');
    // az Express-ujjlenyomat eltávolítva
    expect(res.headers['X-Powered-By']).toBeUndefined();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('NEM állít média-törő fejlécet (pl. CORP same-origin)', () => {
    const res = mockRes();
    securityHeaders()({}, res, () => {});
    expect(res.headers['Cross-Origin-Resource-Policy']).toBeUndefined();
    expect(res.headers['Cross-Origin-Embedder-Policy']).toBeUndefined();
  });
});
