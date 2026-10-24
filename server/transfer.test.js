const {
  isTransferExpired,
  sanitizeProjectId,
  TRANSFER_TTL_MS,
} = require('./lib/transfer');

/**
 * 📲 Átviteli tár — tiszta helperek: kulcs-biztonságos projekt-id + lazy TTL.
 */

describe('sanitizeProjectId', () => {
  it('biztonságos id átmegy, kitörős/üres nem', () => {
    expect(sanitizeProjectId('prj_abc-123')).toBe('prj_abc-123');
    expect(sanitizeProjectId('../etc/passwd')).toBeNull();
    expect(sanitizeProjectId('a/b')).toBeNull();
    expect(sanitizeProjectId('')).toBeNull();
    expect(sanitizeProjectId(null)).toBeNull();
    expect(sanitizeProjectId('x'.repeat(81))).toBeNull();
  });
});

describe('isTransferExpired', () => {
  const now = Date.parse('2026-10-24T12:00:00Z');

  it('a TTL-en belüli csomag él, a túli lejárt', () => {
    expect(isTransferExpired('2026-10-24T11:00:00Z', now)).toBe(false);
    expect(isTransferExpired(new Date(now - TRANSFER_TTL_MS - 1000).toISOString(), now)).toBe(true);
  });

  it('hibás/hiányzó időbélyeg = lejárt (sosem tágabb a bizonytalan)', () => {
    expect(isTransferExpired('nem-dátum', now)).toBe(true);
    expect(isTransferExpired(undefined, now)).toBe(true);
  });
});
