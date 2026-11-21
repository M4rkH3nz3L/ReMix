/**
 * 🔌 Őr: a `client` jest-projektben a forráskód dinamikus `import('…')`-ja TÉNYLEGESEN lefut
 * (tools/jest/babel-plugin-dynamic-import.js, a jest.config.js client-transzformjában). Enélkül a jest
 * „A dynamic import callback was invoked without --experimental-vm-modules” hibát dob, és minden
 * `await import()` mögötti ág csendben a catch/logCaught ágba esik — tesztelhetetlenül.
 */
jest.mock('./dynamicImport/mocked', () => ({ __esModule: true, VALUE: 'mockolt' }));

describe('dinamikus import a jestben', () => {
  it('a dinamikusan importált modul feloldódik, a nevesített és az alapértelmezett export is elérhető', async () => {
    const mod = await import('./dynamicImport/probe');
    expect(mod.PROBE).toBe('dinamikusan betöltve');
    expect(mod.default()).toBe('alapértelmezett export');
  });

  it('a dinamikus import ugyanazt a modulpéldányt adja, mint a statikus require (közös registry)', async () => {
    const dynamic = await import('./dynamicImport/probe');
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- a két betöltési út összevetése
    const required = require('./dynamicImport/probe');
    expect(dynamic.PROBE).toBe(required.PROBE);
    expect(dynamic.default).toBe(required.default);
  });

  it('a jest.mock a dinamikusan importált modulra is érvényes', async () => {
    const mod = await import('./dynamicImport/mocked');
    expect(mod.VALUE).toBe('mockolt');
  });

  it('nem létező modul dinamikus importja elutasított Promise (nem szinkron dobás)', async () => {
    const load = () => import('./dynamicImport/nincs-ilyen' as string);
    await expect(load()).rejects.toThrow(/Cannot find module/);
  });
});
