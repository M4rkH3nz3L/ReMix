import { isLoopbackHost, isSecureForRelease, resolvePublicUrl } from '@/lib/envConfig';

/**
 * A DEV↔PROD config-guardok (fő vonal: dev és prod ugyanaz a kód, csak env dönt).
 * Azt biztosítjuk, hogy az éles build sose fusson lokális címmel / titkosítatlan
 * HTTP-n, dev-ben viszont fizikai eszközön is elérje a helyi backendet.
 */

describe('isLoopbackHost', () => {
  it('igaz a loopback-hosztokra', () => {
    expect(isLoopbackHost('http://127.0.0.1:54421')).toBe(true);
    expect(isLoopbackHost('http://localhost:8787')).toBe(true);
    expect(isLoopbackHost('http://0.0.0.0:8081')).toBe(true);
    expect(isLoopbackHost('http://[::1]:54421')).toBe(true);
  });

  it('hamis a hosztolt / LAN címekre', () => {
    expect(isLoopbackHost('https://abc.supabase.co')).toBe(false);
    expect(isLoopbackHost('https://x.trycloudflare.com')).toBe(false);
    expect(isLoopbackHost('http://192.168.0.34:54421')).toBe(false);
  });

  it('hamis üres / érvénytelen bemenetre', () => {
    expect(isLoopbackHost(undefined)).toBe(false);
    expect(isLoopbackHost(null)).toBe(false);
    expect(isLoopbackHost('')).toBe(false);
    expect(isLoopbackHost('nem-url')).toBe(false);
  });
});

describe('resolvePublicUrl', () => {
  it('PROD + loopback → undefined (nincs érvényes config)', () => {
    expect(resolvePublicUrl({ raw: 'http://127.0.0.1:54421', isDev: false })).toBeUndefined();
    expect(resolvePublicUrl({ raw: 'http://localhost:54421', isDev: false })).toBeUndefined();
  });

  it('PROD + hosztolt URL → változatlan', () => {
    expect(resolvePublicUrl({ raw: 'https://abc.supabase.co', isDev: false })).toBe(
      'https://abc.supabase.co'
    );
  });

  it('DEV + loopback + VALÓDI metró-hoszt → LAN-IP-re átírva', () => {
    expect(
      resolvePublicUrl({ raw: 'http://127.0.0.1:54421', isDev: true, metroHost: '192.168.0.34' })
    ).toBe('http://192.168.0.34:54421');
  });

  it('DEV + loopback + loopback metró-hoszt (szimulátor) → változatlan', () => {
    expect(
      resolvePublicUrl({ raw: 'http://127.0.0.1:54421', isDev: true, metroHost: 'localhost' })
    ).toBe('http://127.0.0.1:54421');
  });

  it('DEV + loopback, metró-hoszt nélkül → változatlan', () => {
    expect(resolvePublicUrl({ raw: 'http://127.0.0.1:54421', isDev: true })).toBe(
      'http://127.0.0.1:54421'
    );
  });

  it('hosztolt URL-t soha nem ír át (dev-ben sem)', () => {
    expect(
      resolvePublicUrl({ raw: 'https://abc.supabase.co', isDev: true, metroHost: '192.168.0.34' })
    ).toBe('https://abc.supabase.co');
  });

  it('üres / hiányzó → undefined', () => {
    expect(resolvePublicUrl({ raw: undefined, isDev: true })).toBeUndefined();
    expect(resolvePublicUrl({ raw: '   ', isDev: false })).toBeUndefined();
  });
});

describe('isSecureForRelease', () => {
  it('DEV-ben minden biztonságos (helyi worker)', () => {
    expect(isSecureForRelease('http://192.168.0.34:8787', true)).toBe(true);
    expect(isSecureForRelease('http://localhost:8787', true)).toBe(true);
  });

  it('PROD: https + nem-loopback → ok', () => {
    expect(isSecureForRelease('https://render.remix.app', false)).toBe(true);
    expect(isSecureForRelease('https://x.trycloudflare.com', false)).toBe(true);
  });

  it('PROD: sima http → tiltott', () => {
    expect(isSecureForRelease('http://192.168.0.34:8787', false)).toBe(false);
    expect(isSecureForRelease('http://render.remix.app', false)).toBe(false);
  });

  it('PROD: https DE loopback → tiltott (hardening)', () => {
    expect(isSecureForRelease('https://localhost:8787', false)).toBe(false);
    expect(isSecureForRelease('https://127.0.0.1', false)).toBe(false);
  });
});
