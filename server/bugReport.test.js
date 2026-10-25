const {
  bugFileName,
  fingerprint,
  mergeBug,
  normalizeMessage,
  sanitizeReport,
  slugify,
  stackSignature,
  MAX_OCCURRENCES,
} = require('./lib/bugReport');

/**
 * 🐞 Hibajelentés-mag: ugyanaz a hiba = ugyanaz az ujjlenyomat (változó részek
 * nélkül), a fájlnév biztonságos, az egyesítés számol/vág, a fixed → regressed.
 */

const STACK_A = `TypeError: Cannot read property 'uri' of undefined
    at buildRenderPlan (address at index.android.bundle:1:345678)
    at canRenderLocally (address at index.android.bundle:1:345999)
    at renderMp4 (address at index.android.bundle:1:401234)`;

// ugyanaz a hiba MÁSIK buildben (más bájt-offsetek)
const STACK_B = STACK_A.replace(/:\d+:\d+/g, ':1:999');

function report(partial = {}) {
  return sanitizeReport({
    kind: 'js-error',
    name: 'TypeError',
    message: "Cannot read property 'uri' of undefined",
    stack: STACK_A,
    platform: 'android',
    appVersion: '1.0.0',
    model: 'SM-A336B',
    route: '/editor/prj_abc123',
    ...partial,
  });
}

describe('sanitizeReport', () => {
  it('üres jelentés → null; ismeretlen enum → biztonságos alap', () => {
    expect(sanitizeReport(null)).toBeNull();
    expect(sanitizeReport({ message: '', stack: '' })).toBeNull();
    const r = sanitizeReport({ message: 'x', kind: 'rm -rf', platform: 'toaster' });
    expect(r.kind).toBe('js-error');
    expect(r.platform).toBe('unknown');
  });

  it('hossz-plafonok és breadcrumb-vágás', () => {
    const r = sanitizeReport({
      message: 'x'.repeat(5000),
      breadcrumbs: Array.from({ length: 50 }, (_, i) => `b${i}`),
      extra: { a: { nested: true } },
    });
    expect(r.message.length).toBeLessThanOrEqual(2001);
    expect(r.breadcrumbs).toHaveLength(30);
    expect(r.breadcrumbs[29]).toBe('b49'); // a legfrissebbek maradnak
    expect(r.extra.a).toBe('{"nested":true}');
  });
});

describe('ujjlenyomat', () => {
  it('a változó azonosítók/számok nem bontják szét a hibát', () => {
    expect(normalizeMessage('Nincs ilyen klip (clip_a8f3e1)')).toBe(
      normalizeMessage('Nincs ilyen klip (clip_77b1c9)'),
    );
    expect(normalizeMessage('timeout after 4500 ms')).toBe(normalizeMessage('timeout after 12 ms'));
  });

  it('két build más offsetekkel → UGYANAZ az ujjlenyomat', () => {
    expect(stackSignature(STACK_A)).toBe(stackSignature(STACK_B));
    expect(fingerprint(report())).toBe(fingerprint(report({ stack: STACK_B })));
  });

  it('a fatális és nem-fatális előfordulás egy hiba; más üzenet más hiba', () => {
    expect(fingerprint(report({ kind: 'js-fatal' }))).toBe(fingerprint(report()));
    expect(fingerprint(report({ message: 'Network request failed' }))).not.toBe(fingerprint(report()));
  });

  it('az ujjlenyomat 12 hex-jegy (fájlnév-biztos)', () => {
    expect(fingerprint(report())).toMatch(/^[0-9a-f]{12}$/);
  });
});

describe('fájlnév', () => {
  it('slug ékezet- és útvonal-mentes', () => {
    expect(slugify('Árvíztűrő ../../etc/passwd')).toBe('arvizturo-etc-passwd');
    expect(slugify('')).toBe('hiba');
    const name = bugFileName('abcdef012345', report());
    expect(name).toMatch(/^abcdef012345_[a-z0-9-]+\.json$/);
    expect(name).not.toContain('/');
  });
});

describe('mergeBug', () => {
  const fp = 'abcdef012345';

  it('új hiba: count 1, open, platform/eszköz statisztika', () => {
    const b = mergeBug(null, report(), fp, '2026-10-25T10:00:00Z', 'user-1');
    expect(b).toMatchObject({ id: fp, count: 1, status: 'open', firstSeen: '2026-10-25T10:00:00Z' });
    expect(b.platforms).toEqual({ android: 1 });
    expect(b.devices).toEqual({ 'SM-A336B': 1 });
    expect(b.affectedUsers).toEqual(['user-1']);
    expect(b.occurrences).toHaveLength(1);
  });

  it('ismétlés: számláló nő, firstSeen marad, az előfordulás-lista vágott', () => {
    let b = null;
    for (let i = 0; i < MAX_OCCURRENCES + 5; i += 1) {
      b = mergeBug(b, report({ platform: i % 2 ? 'ios' : 'android' }), fp, `2026-10-25T10:00:${String(i).padStart(2, '0')}Z`, 'user-1');
    }
    expect(b.count).toBe(MAX_OCCURRENCES + 5);
    expect(b.firstSeen).toBe('2026-10-25T10:00:00Z');
    expect(b.occurrences).toHaveLength(MAX_OCCURRENCES);
    expect(b.platforms.android + b.platforms.ios).toBe(MAX_OCCURRENCES + 5);
    expect(b.affectedUsers).toEqual(['user-1']); // dedup
  });

  it('fixed-re jelölt hiba újra előfordul → regressed (a jegyzet megmarad)', () => {
    const fixed = { ...mergeBug(null, report(), fp, '2026-10-25T10:00:00Z', null), status: 'fixed', notes: 'javítva: 1fe9c2d' };
    const again = mergeBug(fixed, report(), fp, '2026-10-26T10:00:00Z', null);
    expect(again.status).toBe('regressed');
    expect(again.notes).toBe('javítva: 1fe9c2d');
  });
});
