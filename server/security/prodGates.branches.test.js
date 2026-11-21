// 🔒 prodGates — a Live-secret szabály és az alapértelmezett paraméterek ágai.
const { prodGateViolations, assertProdGates } = require('./prodGates');

describe('prodGateViolations — Live stream-kulcs secret (PRO-LIVE L5)', () => {
  test('production + LiveKit-kulcs, de nincs LIVE_STREAM_KEY_SECRET → sértés', () => {
    expect(prodGateViolations({ NODE_ENV: 'production', LIVEKIT_API_KEY: 'lk' })).toEqual([
      'LIVE_STREAM_KEY_SECRET (hiányzik)',
    ]);
  });

  test('csak szóközből álló secret is hiányzónak számít', () => {
    expect(
      prodGateViolations({ NODE_ENV: 'production', LIVEKIT_API_KEY: 'lk', LIVE_STREAM_KEY_SECRET: '   ' })
    ).toEqual(['LIVE_STREAM_KEY_SECRET (hiányzik)']);
  });

  test('LiveKit-kulcs + secret → nincs sértés', () => {
    expect(
      prodGateViolations({ NODE_ENV: 'production', LIVEKIT_API_KEY: 'lk', LIVE_STREAM_KEY_SECRET: 's' })
    ).toEqual([]);
  });

  test('csak szóközből álló LiveKit-kulcs = nincs Live → a secret nem kötelező', () => {
    expect(prodGateViolations({ NODE_ENV: 'production', LIVEKIT_API_KEY: '  ' })).toEqual([]);
  });

  test('a dev-kapu és a hiányzó Live-secret együtt is listázódik, sorrendben', () => {
    expect(
      prodGateViolations({ NODE_ENV: 'production', RL_DISABLED: '1', LIVEKIT_API_KEY: 'lk' })
    ).toEqual(['RL_DISABLED', 'LIVE_STREAM_KEY_SECRET (hiányzik)']);
  });

  test('nem-production env-ben a hiányzó Live-secret sem sértés', () => {
    expect(prodGateViolations({ NODE_ENV: 'development', LIVEKIT_API_KEY: 'lk' })).toEqual([]);
  });

  test('argumentum nélkül a process.env-et olvassa (jestben NODE_ENV=test → [])', () => {
    expect(process.env.NODE_ENV).toBe('test');
    expect(prodGateViolations()).toEqual([]);
  });
});

describe('prodGateViolations — OAuth-state / fájl-token secret', () => {
  test('production + bekötött tárhely-OAuth, de nincs OAUTH_STATE_SECRET → sértés (az indulás megtagadva)', () => {
    expect(prodGateViolations({ NODE_ENV: 'production', GOOGLE_OAUTH_CLIENT_ID: 'g' })).toEqual(['OAUTH_STATE_SECRET (hiányzik)']);
    expect(prodGateViolations({ NODE_ENV: 'production', DROPBOX_APP_KEY: 'd', OAUTH_STATE_SECRET: ' ' })).toEqual(['OAUTH_STATE_SECRET (hiányzik)']);
    expect(prodGateViolations({ NODE_ENV: 'production', MS_OAUTH_CLIENT_ID: 'm' })).toEqual(['OAUTH_STATE_SECRET (hiányzik)']);
  });
  test('secrettel, OAuth nélkül, vagy nem-production env-ben nincs sértés', () => {
    expect(prodGateViolations({ NODE_ENV: 'production', GOOGLE_OAUTH_CLIENT_ID: 'g', OAUTH_STATE_SECRET: 's' })).toEqual([]);
    expect(prodGateViolations({ NODE_ENV: 'production' })).toEqual([]);
    expect(prodGateViolations({ NODE_ENV: 'development', GOOGLE_OAUTH_CLIENT_ID: 'g' })).toEqual([]);
  });
});

describe('assertProdGates — alapértelmezett exit/log', () => {
  test('opciók nélkül, tiszta env → true, a process.exit nem hívódik', () => {
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});
    try {
      expect(assertProdGates({ NODE_ENV: 'production' })).toBe(true);
      expect(assertProdGates()).toBe(true);
      expect(exitSpy).not.toHaveBeenCalled();
    } finally {
      exitSpy.mockRestore();
    }
  });

  test('opciók nélkül, sértéssel → console.error + process.exit(1) + false', () => {
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(assertProdGates({ NODE_ENV: 'production', ALLOW_INSECURE_DEV: '1', ALLOW_DEV_BILLING: '1' })).toBe(false);
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(errSpy).toHaveBeenCalledTimes(1);
      const msg = errSpy.mock.calls[0][0];
      expect(msg).toContain('ALLOW_INSECURE_DEV, ALLOW_DEV_BILLING');
      expect(msg).toContain('(vedd ki a ALLOW_INSECURE_DEV/ALLOW_DEV_BILLING env-változó(ka)t prod-ban)');
    } finally {
      exitSpy.mockRestore();
      errSpy.mockRestore();
    }
  });

  test('csak log-ot adva az exit alapértelmezett marad', () => {
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});
    const logs = [];
    try {
      expect(assertProdGates({ NODE_ENV: 'production', RL_DISABLED: '1' }, { log: (m) => logs.push(m) })).toBe(false);
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(logs).toHaveLength(1);
    } finally {
      exitSpy.mockRestore();
    }
  });
});
