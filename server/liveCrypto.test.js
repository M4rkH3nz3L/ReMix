// 🔐 F2 — RTMP stream-kulcs titkosítás tesztjei (liveCrypto.js).
const { encryptStreamKey, decryptStreamKey, encryptionEnabled, isEncrypted } = require('./liveCrypto');

const SECRET = 'test-secret-🔑-abc123';

describe('liveCrypto — titkosítással (LIVE_STREAM_KEY_SECRET beállítva)', () => {
  const prev = process.env.LIVE_STREAM_KEY_SECRET;
  beforeAll(() => {
    process.env.LIVE_STREAM_KEY_SECRET = SECRET;
  });
  afterAll(() => {
    if (prev === undefined) {
      delete process.env.LIVE_STREAM_KEY_SECRET;
    } else {
      process.env.LIVE_STREAM_KEY_SECRET = prev;
    }
  });

  test('encryptionEnabled igaz, ha van secret', () => {
    expect(encryptionEnabled()).toBe(true);
  });

  test('round-trip: titkosít → visszafejt ugyanaz', () => {
    const key = 'live_abcd-1234-xyz';
    const enc = encryptStreamKey(key);
    expect(enc).not.toBe(key);
    expect(enc.startsWith('enc:v1:')).toBe(true);
    expect(isEncrypted(enc)).toBe(true);
    expect(decryptStreamKey(enc)).toBe(key);
  });

  test('ugyanaz a kulcs kétszer KÜLÖNBÖZŐ ciphertextet ad (random IV)', () => {
    const a = encryptStreamKey('same-key');
    const b = encryptStreamKey('same-key');
    expect(a).not.toBe(b);
    expect(decryptStreamKey(a)).toBe('same-key');
    expect(decryptStreamKey(b)).toBe('same-key');
  });

  test('unicode + hosszú kulcs round-trip', () => {
    const key = 'kulcs-áéíőű-' + 'x'.repeat(400);
    expect(decryptStreamKey(encryptStreamKey(key))).toBe(key);
  });

  test('hamisított ciphertext dob (GCM auth-tag)', () => {
    const enc = encryptStreamKey('secret');
    const parts = enc.split(':'); // enc : v1 : iv : tag : ct
    const tampered = parts.slice(0, 4).join(':') + ':' + Buffer.from('rossz-ct').toString('base64url');
    expect(() => decryptStreamKey(tampered)).toThrow();
  });

  test('érvénytelen formátum dob', () => {
    expect(() => decryptStreamKey('enc:v1:csak-ketto:resz')).toThrow(/formátum/);
  });

  test('nyers (nem enc:) érték változatlanul megy vissza — backward-compat', () => {
    expect(decryptStreamKey('plain-legacy-key')).toBe('plain-legacy-key');
  });

  test('üres bemenet → üres kimenet', () => {
    expect(encryptStreamKey('')).toBe('');
    expect(decryptStreamKey('')).toBe('');
  });
});

describe('liveCrypto — secret NÉLKÜL (dev fallback)', () => {
  const prev = process.env.LIVE_STREAM_KEY_SECRET;
  beforeAll(() => {
    delete process.env.LIVE_STREAM_KEY_SECRET;
  });
  afterAll(() => {
    if (prev !== undefined) {
      process.env.LIVE_STREAM_KEY_SECRET = prev;
    }
  });

  test('encryptionEnabled hamis', () => {
    expect(encryptionEnabled()).toBe(false);
  });

  test('encrypt → nyers kulcs (nincs titkosítás, de nem is tör el)', () => {
    expect(encryptStreamKey('my-key')).toBe('my-key');
    expect(isEncrypted('my-key')).toBe(false);
  });

  test('nyers kulcs dekódolása változatlan', () => {
    expect(decryptStreamKey('my-key')).toBe('my-key');
  });

  test('titkosított érték secret nélkül dob (nem némán rossz kulcs)', () => {
    process.env.LIVE_STREAM_KEY_SECRET = SECRET;
    const enc = encryptStreamKey('x');
    delete process.env.LIVE_STREAM_KEY_SECRET;
    expect(() => decryptStreamKey(enc)).toThrow(/LIVE_STREAM_KEY_SECRET/);
  });
});
