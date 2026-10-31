// 🔐 PRO-LIVE 1. lépés — RTMP-validáció (L7) + titok-kitakarás (L11)
const { validateRtmpUrl, resolveSafe, isPrivateIp } = require('./rtmpUrl');
const { redactSecrets } = require('./redact');

describe('validateRtmpUrl (L7 — SSRF)', () => {
  test('a valódi platform-ingest címek átmennek', () => {
    expect(validateRtmpUrl('rtmp://a.rtmp.youtube.com/live2').ok).toBe(true);
    expect(validateRtmpUrl('rtmps://live-api-s.facebook.com:443/rtmp/').ok).toBe(true);
    expect(validateRtmpUrl('rtmp://live.twitch.tv/app').ok).toBe(true);
  });
  test('belső hálózat, rossz séma, jelszó, furcsa port → elutasítva', () => {
    for (const bad of [
      'http://example.com/live',
      'rtmp://localhost/live',
      'rtmp://127.0.0.1/live',
      'rtmp://10.0.0.5/live',
      'rtmp://169.254.169.254/latest',
      'rtmp://192.168.1.2:1935/x',
      'rtmp://[::1]/x',
      'rtmp://user:pw@host.com/x',
      'rtmp://host.com:22/x',
      'rtmp://svc.internal/x',
    ]) {
      expect(validateRtmpUrl(bad).ok).toBe(false);
    }
  });
  test('DNS-rebinding: a nyilvános név privát IP-re oldódik → elutasítva', async () => {
    const lookupPrivate = async () => [{ address: '10.1.2.3' }];
    const lookupPublic = async () => [{ address: '142.250.1.1' }];
    expect((await resolveSafe('rtmp://evil.example.com/x', lookupPrivate)).ok).toBe(false);
    expect((await resolveSafe('rtmp://a.rtmp.youtube.com/live2', lookupPublic)).ok).toBe(true);
  });
  test('isPrivateIp: IPv4-mapped IPv6 is', () => {
    expect(isPrivateIp('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateIp('8.8.8.8')).toBe(false);
  });
});

describe('redactSecrets (L11)', () => {
  test('az RTMP-útvonal (kulccsal) és a kulcs-minták kitakarva', () => {
    const s = 'push failed: rtmp://a.rtmp.youtube.com/live2/abcd-efgh-ijkl-mnop-qrst (timeout)';
    expect(redactSecrets(s)).toBe('push failed: rtmp://a.rtmp.youtube.com/*** (timeout)');
    expect(redactSecrets('key live_123456789_abcdefghij')).toBe('key live_***');
    expect(redactSecrets('stored enc:v1:abc:def:ghi')).toBe('stored enc:v1:***');
  });
});
