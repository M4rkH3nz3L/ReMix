const { prodGateViolations, assertProdGates, DEV_GATES } = require('./prodGates');

describe('prodGateViolations — dev-kapu tiltás production-ben (04-security §04.1)', () => {
  test('nem-production env → mindig [] (dev/teszt szabadon)', () => {
    expect(prodGateViolations({ NODE_ENV: 'development', ALLOW_INSECURE_DEV: '1' })).toEqual([]);
    expect(prodGateViolations({ NODE_ENV: 'test', RL_DISABLED: '1' })).toEqual([]);
    expect(prodGateViolations({ ALLOW_DEV_BILLING: '1' })).toEqual([]); // NODE_ENV hiányzik
  });

  test('production + bekapcsolt kapu(k) → a sértők listája', () => {
    expect(prodGateViolations({ NODE_ENV: 'production', ALLOW_INSECURE_DEV: '1' })).toEqual(['ALLOW_INSECURE_DEV']);
    expect(
      prodGateViolations({ NODE_ENV: 'production', ALLOW_INSECURE_DEV: '1', RL_DISABLED: '1', ALLOW_DEV_BILLING: '1' }).sort()
    ).toEqual([...DEV_GATES].sort());
  });

  test('production, minden kapu OFF → [] (indulhat)', () => {
    expect(prodGateViolations({ NODE_ENV: 'production' })).toEqual([]);
    expect(prodGateViolations({ NODE_ENV: 'production', ALLOW_INSECURE_DEV: '0' })).toEqual([]);
  });
});

describe('assertProdGates — indulás-refuse', () => {
  test('sértés → log + exit(1) + false', () => {
    let exitCode = null;
    const logs = [];
    const ok = assertProdGates(
      { NODE_ENV: 'production', RL_DISABLED: '1' },
      { exit: (c) => (exitCode = c), log: (m) => logs.push(m) }
    );
    expect(ok).toBe(false);
    expect(exitCode).toBe(1);
    expect(logs[0]).toMatch(/RL_DISABLED/);
  });

  test('tiszta prod → true, nincs exit', () => {
    let exited = false;
    const ok = assertProdGates({ NODE_ENV: 'production' }, { exit: () => (exited = true), log: () => {} });
    expect(ok).toBe(true);
    expect(exited).toBe(false);
  });
});
