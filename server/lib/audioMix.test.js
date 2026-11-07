const { bindAudioMix } = require('./audioMix');

describe('bindAudioMix', () => {
  test('a kliens által küldött útvonal eldobva (nem égethető be a worker fájlja)', () => {
    const p = bindAudioMix({ audioMixUri: '/etc/passwd', tracks: [] }, new Map());
    expect(p.audioMixUri).toBeUndefined();
  });
  test('a feltöltött keverés kötődik', () => {
    const p = bindAudioMix({ audioMixUri: '/etc/passwd' }, new Map([['audioMix', '/tmp/up/abc']]));
    expect(p.audioMixUri).toBe('/tmp/up/abc');
  });
});
