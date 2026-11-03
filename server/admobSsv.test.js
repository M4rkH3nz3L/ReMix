// 🎬 AdMob SSV (C2.2): az aláírást egy saját P-256 kulccsal, a Google által leírt módon állítjuk elő.
const crypto = require('crypto');
const { parseSsvQuery, verifySsv, verifierKeys, resetKeyCache } = require('./admobSsv');

const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pem = publicKey.export({ type: 'spki', format: 'pem' });
const websafe = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function signedQuery(fields, keyId = '1234') {
  const msg = new URLSearchParams(fields).toString();
  const sig = websafe(crypto.sign('sha256', Buffer.from(msg), privateKey));
  return `${msg}&signature=${sig}&key_id=${keyId}`;
}

const fields = {
  ad_network: '5450213213286189855',
  ad_unit: '1234567890',
  reward_amount: '1',
  reward_item: 'coin',
  timestamp: '1800000000000',
  transaction_id: 'tx-abc',
  user_id: 'a1000000-0000-0000-0000-000000000001',
};

describe('AdMob SSV', () => {
  test('érvényes aláírás → elfogadva, a mezők kiolvasva', () => {
    const p = parseSsvQuery(signedQuery(fields));
    expect(p).toMatchObject({ keyId: '1234', userId: fields.user_id, transactionId: 'tx-abc', adUnit: '1234567890' });
    expect(verifySsv(p, { 1234: pem })).toBe(true);
  });
  test('módosított user_id / ismeretlen kulcs / aláírás nélkül → elutasítva', () => {
    const q = signedQuery(fields).replace('a1000000', 'b1000000');
    expect(verifySsv(parseSsvQuery(q), { 1234: pem })).toBe(false);
    expect(verifySsv(parseSsvQuery(signedQuery(fields, '999')), { 1234: pem })).toBe(false);
    expect(parseSsvQuery('user_id=x&transaction_id=y')).toBeNull();
  });
  test('más kulccsal aláírt üzenet → elutasítva', () => {
    const other = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const msg = new URLSearchParams(fields).toString();
    const sig = websafe(crypto.sign('sha256', Buffer.from(msg), other.privateKey));
    expect(verifySsv(parseSsvQuery(`${msg}&signature=${sig}&key_id=1234`), { 1234: pem })).toBe(false);
  });
  test('a kulcslistát cache-eli (24 óra)', async () => {
    resetKeyCache();
    const fetchImpl = jest.fn(async () => ({ ok: true, json: async () => ({ keys: [{ keyId: 1234, pem, base64: 'x' }] }) }));
    await expect(verifierKeys(fetchImpl, 1000)).resolves.toEqual({ 1234: pem });
    await verifierKeys(fetchImpl, 2000);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await verifierKeys(fetchImpl, 1000 + 25 * 3600 * 1000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
