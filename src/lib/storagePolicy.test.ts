import {
  canCloudBackupMedia,
  MEDIA_BACKUP_MIN_TIER,
  projectMediaSafety,
  storageBillingBasis,
} from '@/lib/storagePolicy';
import type { Asset, Project } from '@/types/project';

const asset = (over: Partial<Asset>): Asset => ({
  id: over.id ?? 'a',
  kind: 'video',
  uri: 'file:///x.mp4',
  provider: 'local',
  ...over,
});

const proj = (assets: Asset[]): Project =>
  ({ id: 'p', name: 't', aspectRatio: '9:16', tracks: [], assets, schemaVersion: 6 }) as unknown as Project;

describe('canCloudBackupMedia — free = lokál, fizetős = R2 (ADR-013)', () => {
  it('free NEM kap auto-felhő-média-backupot', () => {
    expect(canCloudBackupMedia('free')).toBe(false);
  });
  it('a min. szint (pro) és felette IGEN', () => {
    expect(canCloudBackupMedia('pro')).toBe(true);
    expect(canCloudBackupMedia('ultra')).toBe(true);
  });
  it('a basic a szabály szerint (MEDIA_BACKUP_MIN_TIER=pro) → nem', () => {
    expect(canCloudBackupMedia('basic')).toBe(MEDIA_BACKUP_MIN_TIER === 'basic');
    expect(canCloudBackupMedia('basic')).toBe(false);
  });
});

describe('projectMediaSafety — csak-eszközön lévő média = kockázat', () => {
  it('felhő-mentett (remoteUrl) assetek nem kockázatosak', () => {
    const s = projectMediaSafety(proj([asset({ id: 'a', remoteUrl: 'https://r2/a.mp4' })]));
    expect(s).toMatchObject({ backedUp: 1, localOnly: 0, atRisk: false });
  });

  it('csak-lokális (file://, nincs remoteUrl) média → atRisk', () => {
    const s = projectMediaSafety(proj([asset({ id: 'a', uri: 'file:///a.mp4' })]));
    expect(s).toMatchObject({ localOnly: 1, atRisk: true });
  });

  it('http-forrás (stream-import) se nem lokál-kockázat, se nem a mi tárunk', () => {
    const s = projectMediaSafety(proj([asset({ id: 'a', uri: 'https://cdn/a.m3u8' })]));
    expect(s).toMatchObject({ remote: 1, localOnly: 0, atRisk: false });
  });

  it('vegyes projekt helyesen számol + a nem-media asset kimarad', () => {
    const s = projectMediaSafety(
      proj([
        asset({ id: '1', uri: 'file:///a.mp4' }),
        asset({ id: '2', remoteUrl: 'https://r2/b.mp4' }),
        asset({ id: '3', uri: 'file:///c.jpg', kind: 'image' }),
      ])
    );
    expect(s).toMatchObject({ backedUp: 1, localOnly: 2, atRisk: true });
  });
});

describe('storageBillingBasis — a fizetős R2 beárazás-alapja', () => {
  const GB = 1024 * 1024 * 1024;

  it('a befoglaltságon belül nincs overage', () => {
    const b = storageBillingBasis(3 * GB, 5 * GB, 100);
    expect(b.overageGB).toBe(0);
    expect(b.estimatedCoinPerMonth).toBe(0);
  });

  it('a felüli rész GB-enként (felfelé kerekítve) díjköteles', () => {
    const b = storageBillingBasis(7.2 * GB, 5 * GB, 100);
    expect(b.usedGB).toBeCloseTo(7.2);
    expect(b.overageGB).toBeCloseTo(2.2);
    expect(b.estimatedCoinPerMonth).toBe(300); // ceil(2.2)=3 × 100
  });

  it('negatív/0 bemenet biztonságos', () => {
    expect(storageBillingBasis(-5, 0, 100)).toMatchObject({ usedGB: 0, overageGB: 0, estimatedCoinPerMonth: 0 });
  });
});
