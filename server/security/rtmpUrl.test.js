// 🔐 PRO-LIVE L7 — rtmpUrl: a privát-tartományok, a szintaktikai kapuk és a DNS-ág részletei.
// (Az alap-forgatókönyvek a liveSecurity.test.js-ben.)
const { validateRtmpUrl, resolveSafe, isPrivateIp } = require('./rtmpUrl');

const INTERNAL = 'Belső hálózati cím nem adható meg.';

describe('isPrivateIp — IPv4 tartományok', () => {
  it.each([
    ['0.1.2.3', true],
    ['100.64.0.1', true], // CGNAT alja
    ['100.127.255.255', true], // CGNAT teteje
    ['100.63.0.1', false],
    ['100.128.0.1', false],
    ['172.16.0.1', true],
    ['172.31.255.255', true],
    ['172.15.0.1', false],
    ['172.32.0.1', false],
    ['192.0.2.1', true],
    ['198.18.0.1', true],
    ['198.19.0.1', true],
    ['198.20.0.1', false],
    ['224.0.0.1', true], // multicast
    ['255.255.255.255', true],
    ['223.255.255.255', false],
    ['169.253.0.1', false],
    ['192.169.0.1', false],
  ])('%s → %s', (ip, expected) => {
    expect(isPrivateIp(ip)).toBe(expected);
  });
});

describe('isPrivateIp — IPv6 és nem-IP', () => {
  it.each([
    ['::', true],
    ['::1', true],
    ['fc00::1', true],
    ['FD12:3456::1', true], // kisbetűsítve vizsgál
    ['fe80::1', true],
    ['fe9f::1', true],
    ['fea0::1', true],
    ['febf::1', true],
    ['fec0::1', false],
    ['::ffff:10.0.0.1', true],
    ['::ffff:8.8.8.8', false],
    ['2001:4860:4860::8888', false],
  ])('%s → %s', (ip, expected) => {
    expect(isPrivateIp(ip)).toBe(expected);
  });

  it('nem IP-cím (hostnév, üres) → true (fail-closed)', () => {
    expect(isPrivateIp('example.com')).toBe(true);
    expect(isPrivateIp('')).toBe(true);
  });

  it('hex-alakú IPv4-mapped IPv6: a v4-szabály dönt (a URL-parser erre normalizál)', () => {
    expect(isPrivateIp('::ffff:7f00:1')).toBe(true); // = 127.0.0.1
    expect(isPrivateIp('::ffff:a9fe:a9fe')).toBe(true); // = 169.254.169.254 (felhő-metadata)
    expect(isPrivateIp('::ffff:a00:1')).toBe(true); // = 10.0.0.1
    expect(isPrivateIp('::ffff:808:808')).toBe(false); // = 8.8.8.8 (nyilvános)
    expect(isPrivateIp('::ffff:0:0:1')).toBe(true); // ismeretlen ::ffff:-alak → fail-closed
  });
});

describe('validateRtmpUrl — szintaktikai kapuk', () => {
  it('üres, null és túl hosszú cím → elutasítva', () => {
    const msg = { ok: false, error: 'Üres vagy túl hosszú RTMP-cím.' };
    expect(validateRtmpUrl('')).toEqual(msg);
    expect(validateRtmpUrl(null)).toEqual(msg);
    expect(validateRtmpUrl('   ')).toEqual(msg);
    expect(validateRtmpUrl(`rtmp://a.example.com/${'x'.repeat(1010)}`)).toEqual(msg);
  });

  it('nem értelmezhető URL → "Érvénytelen RTMP-cím."', () => {
    expect(validateRtmpUrl('nem egy url')).toEqual({ ok: false, error: 'Érvénytelen RTMP-cím.' });
  });

  it('rossz séma pontos hibaüzenettel', () => {
    expect(validateRtmpUrl('https://example.com/live')).toEqual({
      ok: false,
      error: 'Csak rtmp:// vagy rtmps:// cím adható meg.',
    });
  });

  it('csak felhasználónév (jelszó nélkül) is tiltott', () => {
    expect(validateRtmpUrl('rtmp://user@host.com/x')).toEqual({
      ok: false,
      error: 'Az RTMP-cím nem tartalmazhat felhasználót/jelszót.',
    });
  });

  it('host nélküli, .localhost és .local végű cím → belső', () => {
    expect(validateRtmpUrl('rtmp:///x')).toEqual({ ok: false, error: INTERNAL });
    expect(validateRtmpUrl('rtmp://app.localhost/x')).toEqual({ ok: false, error: INTERNAL });
    expect(validateRtmpUrl('rtmp://printer.local/x')).toEqual({ ok: false, error: INTERNAL });
  });

  it('privát IPv6-literál → belső; nyilvános IPv6-literál szögletes zárójel nélküli host-tal átmegy', () => {
    expect(validateRtmpUrl('rtmp://[fd00::1]/x')).toEqual({ ok: false, error: INTERNAL });
    expect(validateRtmpUrl('rtmp://[2001:4860:4860::8888]/x')).toEqual({ ok: true, host: '2001:4860:4860::8888' });
  });

  it('alapport: rtmp → 1935, rtmps → 443 (mindkettő engedett)', () => {
    expect(validateRtmpUrl('rtmp://a.example.com/x')).toEqual({ ok: true, host: 'a.example.com' });
    expect(validateRtmpUrl('rtmps://a.example.com/x')).toEqual({ ok: true, host: 'a.example.com' });
  });

  it('explicit port: az engedett listán kívül pontos hibaüzenet', () => {
    expect(validateRtmpUrl('rtmps://a.example.com:8443/x').ok).toBe(true);
    expect(validateRtmpUrl('rtmp://a.example.com:1936/x').ok).toBe(true);
    expect(validateRtmpUrl('rtmp://a.example.com:8080/x')).toEqual({ ok: false, error: 'Nem engedélyezett port: 8080.' });
  });

  it('IPv4-mapped loopback / metadata szögletes literálként is tiltott (SSRF)', async () => {
    const blocked = { ok: false, error: 'Belső hálózati cím nem adható meg.' };
    expect(validateRtmpUrl('rtmp://[::ffff:127.0.0.1]/x')).toEqual(blocked);
    expect(validateRtmpUrl('rtmp://[::ffff:169.254.169.254]/x')).toEqual(blocked);
    const lookup = jest.fn();
    expect(await resolveSafe('rtmp://[::ffff:127.0.0.1]/x', lookup)).toEqual(blocked);
    expect(lookup).not.toHaveBeenCalled();
  });

  // KÉRDÉS: a rövidített / hex IPv4 (127.1, 0x7f000001) nem IP-literál a net.isIP szerint, így a
  // statikus validáció átengedi; csak a resolveSafe DNS-lépése fogja meg (ha a feloldó loopbackot ad).
  // Ha valahol csak a validateRtmpUrl fut, ez rés — döntés: elég-e a resolveSafe kötelező használata.
  it('rövidített / hex IPv4-alak a statikus validáción átmegy, a DNS-lépés fogja meg', async () => {
    expect(validateRtmpUrl('rtmp://127.1/x')).toEqual({ ok: true, host: '127.1' });
    expect(validateRtmpUrl('rtmp://0x7f000001/x')).toEqual({ ok: true, host: '0x7f000001' });
    const lookup = jest.fn(async () => [{ address: '127.0.0.1', family: 4 }]);
    expect(await resolveSafe('rtmp://127.1/x', lookup)).toEqual({ ok: false, error: 'Az RTMP-cél belső hálózatra mutat.' });
    expect(lookup).toHaveBeenCalledWith('127.1');
  });
});

describe('resolveSafe — DNS-ág', () => {
  it('a statikus hibát változatlanul adja vissza, DNS nélkül', async () => {
    const lookup = jest.fn();
    expect(await resolveSafe('http://x.com/', lookup)).toEqual({
      ok: false,
      error: 'Csak rtmp:// vagy rtmps:// cím adható meg.',
    });
    expect(lookup).not.toHaveBeenCalled();
  });

  it('nyilvános IP-literál → DNS nélkül ok (az alapértelmezett feloldó sem fut)', async () => {
    expect(await resolveSafe('rtmp://8.8.8.8/live')).toEqual({ ok: true, host: '8.8.8.8' });
  });

  it('üres feloldás → elutasítva', async () => {
    expect(await resolveSafe('rtmp://a.example.com/x', async () => [])).toEqual({
      ok: false,
      error: 'Az RTMP-cél belső hálózatra mutat.',
    });
  });

  it('ha BÁRMELY feloldott cím privát → elutasítva', async () => {
    const lookup = async () => [{ address: '142.250.1.1' }, { address: 'fd00::5' }];
    expect((await resolveSafe('rtmp://a.example.com/x', lookup)).ok).toBe(false);
  });

  it('a feloldás hibája → elutasítva (fail-closed)', async () => {
    const lookup = async () => {
      throw new Error('ENOTFOUND');
    };
    expect(await resolveSafe('rtmp://nincs.example.com/x', lookup)).toEqual({
      ok: false,
      error: 'Az RTMP-cél hostja nem oldható fel.',
    });
  });

  it('a feloldó a hostnevet kapja (port és útvonal nélkül)', async () => {
    const lookup = jest.fn(async () => [{ address: '142.250.1.1' }]);
    expect(await resolveSafe('rtmps://a.example.com:443/app/key', lookup)).toEqual({ ok: true, host: 'a.example.com' });
    expect(lookup).toHaveBeenCalledWith('a.example.com');
  });
});
