import {
  MANUAL_FIELDS,
  boostMonthlyCost,
  defaultProviderId,
  fileKindEmoji,
  usageFraction,
} from '@/lib/storageCardOps';
import { addonDef } from '@/lib/subscriptionPlan';

describe('storageCardOps — a tárhely-kártya tiszta magja', () => {
  it('a manuális források mezői: WebDAV 4, S3 6, a titkos mezők jelölve', () => {
    expect(MANUAL_FIELDS.webdav.map((f) => f.key)).toEqual(['baseUrl', 'path', 'username', 'password']);
    expect(MANUAL_FIELDS.s3.map((f) => f.key)).toEqual(['bucket', 'prefix', 'region', 'endpoint', 'accessKeyId', 'secretAccessKey']);
    expect([...MANUAL_FIELDS.webdav, ...MANUAL_FIELDS.s3].filter((f) => f.secret).map((f) => f.key)).toEqual(['password', 'secretAccessKey']);
  });

  it('a bővítés havi ára: blokkszám × a storage_10gb add-on ára', () => {
    const price = addonDef('storage_10gb')?.priceCents ?? 0;
    expect(price).toBeGreaterThan(0);
    expect(boostMonthlyCost(1)).toBe(price);
    expect(boostMonthlyCost(10)).toBe(10 * price);
    expect(boostMonthlyCost(0)).toBe(0);
  });

  it('a kvóta-arány: [0, 1]-be zárva; nincs adat vagy 0 kvóta → 0', () => {
    expect(usageFraction(null)).toBe(0);
    expect(usageFraction({ usedBytes: 5, quotaBytes: 0 })).toBe(0);
    expect(usageFraction({ usedBytes: 1, quotaBytes: 4 })).toBe(0.25);
    expect(usageFraction({ usedBytes: 4, quotaBytes: 4 })).toBe(1);
    expect(usageFraction({ usedBytes: 9, quotaBytes: 4 })).toBe(1);
  });

  it('az aktív cél: az első isDefault provider, egyébként null (= ReMix)', () => {
    expect(defaultProviderId([])).toBeNull();
    expect(defaultProviderId([{ id: 'a', isDefault: false }])).toBeNull();
    expect(defaultProviderId([{ id: 'a', isDefault: false }, { id: 'b', isDefault: true }, { id: 'c', isDefault: true }])).toBe('b');
  });

  it('a fájl-ikon: videó / hang / modell, minden más kép', () => {
    expect(fileKindEmoji('video')).toBe('🎬');
    expect(fileKindEmoji('audio')).toBe('🎵');
    expect(fileKindEmoji('model')).toBe('🧊');
    expect(fileKindEmoji('image')).toBe('🖼️');
    expect(fileKindEmoji('?')).toBe('🖼️');
  });
});
