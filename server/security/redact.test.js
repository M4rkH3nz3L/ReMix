// 🔐 redactSecrets — bemenet-típusok és a kulcs-minták pontos kimenete.
const { redactSecrets } = require('./redact');

describe('redactSecrets — nem-szöveges bemenet', () => {
  it('null / undefined változatlanul visszajön', () => {
    expect(redactSecrets(null)).toBeNull();
    expect(redactSecrets(undefined)).toBeUndefined();
  });

  it('szám → szöveggé alakítva', () => {
    expect(redactSecrets(42)).toBe('42');
  });

  it('Error-objektum → a String() alakja, kitakarva', () => {
    expect(redactSecrets(new Error('Bearer abc.def'))).toBe('Error: Bearer ***');
  });

  it('objektum: a toString() kimenete kerül kitakarásra', () => {
    const obj = { toString: () => 'token=titok123' };
    expect(redactSecrets(obj)).toBe('token=***');
  });

  it('üres szöveg → üres szöveg', () => {
    expect(redactSecrets('')).toBe('');
  });
});

describe('redactSecrets — pontos csere-minták', () => {
  it.each([
    ['rtmps://live-api-s.facebook.com:443/rtmp/FB-123', 'rtmps://live-api-s.facebook.com:443/***'],
    ['kulcs FB-1234567890abc', 'kulcs FB-***'],
    ['yt abcd-1234-efgh-5678-ijkl vége', 'yt ****-****-****-****-**** vége'],
    ['h: Bearer eyJhbGciOi.x', 'h: Bearer ***'],
    ['jwt eyJhbGciOiJI.eyJzdWIiOiIx.sig', 'jwt ***jwt***'],
    ['rk_live_ABCDEFGHIJKLMNOPQRS', '***key***'],
    ['{"refresh_token": "abc"}', '{"refresh_token": "***"}'],
    ['secret=xyz&a=1', 'secret=***&a=1'],
    ['mail: a.b+c@example.co.uk', 'mail: ***@***'],
  ])('%s', (input, expected) => {
    expect(redactSecrets(input)).toBe(expected);
  });

  it('többszöri hívás ugyanazt adja (a globális regexek lastIndex-e nem szivárog)', () => {
    const s = 'Bearer aaa és Bearer bbb';
    expect(redactSecrets(s)).toBe('Bearer *** és Bearer ***');
    expect(redactSecrets(s)).toBe('Bearer *** és Bearer ***');
  });
});
