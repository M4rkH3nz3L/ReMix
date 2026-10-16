import {
  normalizeHash,
  verifyChecksum,
  compareVersions,
  isOutdated,
  resolveModel,
  planModelEviction,
  type ModelManifestEntry,
  type CachedModel,
} from '@/lib/modelRegistry';

const entry = (over: Partial<ModelManifestEntry> = {}): ModelManifestEntry => ({
  id: 'whisper-base',
  version: '1.2.0',
  url: 'https://models/whisper-base.bin',
  sha256: 'ABC123',
  sizeBytes: 100,
  kind: 'whisper',
  ...over,
});

describe('verifyChecksum — sha256 (§06.2 checksum-elutasítás)', () => {
  it('egyezés case-insensitive; eltérés/üres → false', () => {
    expect(verifyChecksum('ABC123', 'abc123')).toBe(true);
    expect(verifyChecksum(' abc123 ', 'abc123')).toBe(true);
    expect(verifyChecksum('abc123', 'deadbeef')).toBe(false);
    expect(verifyChecksum('', '')).toBe(false); // üres → nem fogadjuk el
    expect(verifyChecksum('abc', '')).toBe(false);
  });
  it('normalizeHash: trim + kisbetű', () => {
    expect(normalizeHash('  DEAD ')).toBe('dead');
  });
});

describe('compareVersions / isOutdated — verzió-összevetés', () => {
  it('numerikus szegmensenként (nem lexikális)', () => {
    expect(compareVersions('1.2.0', '1.10.0')).toBe(-1); // 10 > 2
    expect(compareVersions('2.0', '1.9.9')).toBe(1);
    expect(compareVersions('1.2', '1.2.0')).toBe(0); // hiányzó szegmens = 0
    expect(compareVersions('1.2.0', '1.2.0')).toBe(0);
  });
  it('isOutdated: cached < manifest', () => {
    expect(isOutdated('1.1.0', '1.2.0')).toBe(true);
    expect(isOutdated('1.2.0', '1.2.0')).toBe(false);
    expect(isOutdated('1.3.0', '1.2.0')).toBe(false);
  });
});

describe('resolveModel — download / update / use_cached', () => {
  it('nincs cache → download', () => {
    expect(resolveModel(entry(), undefined)).toEqual({ action: 'download', reason: 'not_cached' });
  });
  it('elavult cache → update', () => {
    expect(resolveModel(entry({ version: '2.0.0' }), { id: 'whisper-base', version: '1.0.0' })).toEqual({
      action: 'update',
      reason: 'outdated',
    });
  });
  it('aktuális cache → use_cached', () => {
    expect(resolveModel(entry({ version: '1.2.0' }), { id: 'whisper-base', version: '1.2.0' }).action).toBe(
      'use_cached',
    );
  });
});

describe('planModelEviction — LRU + byte-cap, pinned védett (§06.2 LRU)', () => {
  const m = (over: Partial<CachedModel>): CachedModel => ({ id: 'x', version: '1', sizeBytes: 100, lastUsedMs: 0, ...over });

  it('cap alatt → nincs eviction', () => {
    expect(planModelEviction([m({ id: 'a', sizeBytes: 50 })], { maxBytes: 100 })).toEqual([]);
  });

  it('cap felett → a legrégebben használt nem-pinned modelleket dobja, amíg belefér', () => {
    const cached = [
      m({ id: 'new', sizeBytes: 100, lastUsedMs: 1000 }),
      m({ id: 'old', sizeBytes: 100, lastUsedMs: 10 }),
      m({ id: 'mid', sizeBytes: 100, lastUsedMs: 500 }),
    ]; // total 300, cap 150 → 2 legrégebbit
    expect(planModelEviction(cached, { maxBytes: 150 }).map((x) => x.id)).toEqual(['old', 'mid']);
  });

  it('a pinned (használatban lévő) modellt SOHA nem dobja, akkor sem ha cap fölött marad', () => {
    const cached = [
      m({ id: 'inuse', sizeBytes: 500, pinned: true, lastUsedMs: 0 }),
      m({ id: 'free', sizeBytes: 100, lastUsedMs: 5 }),
    ]; // total 600, cap 50
    expect(planModelEviction(cached, { maxBytes: 50 }).map((x) => x.id)).toEqual(['free']);
  });
});
