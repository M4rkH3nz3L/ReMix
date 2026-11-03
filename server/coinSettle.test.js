// 🪙 A tartás-feloldó ütemező: a coin_release_due RPC-t hívja, hibát elnyel (no-op).
const { runCoinSettleOnce } = require('./coinSettle');

describe('runCoinSettleOnce', () => {
  test('service_role nélkül no-op', async () => {
    await expect(runCoinSettleOnce(null)).resolves.toBe(0);
  });
  test('a coin_release_due RPC-t hívja az adott időponttal', async () => {
    const calls = [];
    const sb = { rpc: async (name, args) => { calls.push([name, args]); return { data: 3, error: null }; } };
    const now = new Date('2026-11-03T12:00:00Z');
    await expect(runCoinSettleOnce(sb, now)).resolves.toBe(3);
    expect(calls).toEqual([['coin_release_due', { p_now: '2026-11-03T12:00:00.000Z' }]]);
  });
  test('RPC-hiba → 0, nem dob', async () => {
    const sb = { rpc: async () => ({ data: null, error: { message: 'boom' } }) };
    await expect(runCoinSettleOnce(sb)).resolves.toBe(0);
  });
});
