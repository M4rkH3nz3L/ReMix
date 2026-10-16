import {
  assetDisplayState,
  assetLocallyAvailable,
  assetStateBadge,
  assetStateOf,
  canDownload,
  canEvict,
  canTransition,
  isCacheEvictable,
  isLocallyAvailable,
  needsFetch,
  nextState,
  remoteChangeDecision,
  remoteChanged,
  selectForEviction,
  type AssetState,
  type CacheEntry,
} from '@/lib/assetState';

const local = { provider: 'local' as const };
const remote = { provider: 'remote' as const };
const library = { provider: 'library' as const };

describe('assetStateOf — állapot a valós mezőkből (audit §8.2)', () => {
  it('device-saját (local) → mindig imported', () => {
    expect(assetStateOf(local)).toBe('imported');
    expect(assetStateOf(local, { localAvailable: false })).toBe('imported');
  });

  it('külső forrás: helyi másolat nélkül external, vele cached', () => {
    expect(assetStateOf(remote)).toBe('external');
    expect(assetStateOf(remote, { localAvailable: true })).toBe('cached');
    expect(assetStateOf(library, { localAvailable: true })).toBe('cached');
  });

  it('remoteChanged → stale (ha van helyi), invalidated felülír mindent', () => {
    expect(assetStateOf(remote, { localAvailable: true, remoteChanged: true })).toBe('stale');
    expect(assetStateOf(remote, { localAvailable: true, invalidated: true })).toBe('invalidated');
    expect(assetStateOf(local, { invalidated: true })).toBe('invalidated');
  });
});

describe('nextState / canTransition — átmenet-gép', () => {
  it('fő életciklus: external → cached → imported', () => {
    expect(nextState('external', 'download')).toBe('cached');
    expect(nextState('cached', 'import')).toBe('imported');
  });

  it('eviction + elavulás + frissítés', () => {
    expect(nextState('cached', 'evict')).toBe('external');
    expect(nextState('cached', 'remoteChanged')).toBe('stale');
    expect(nextState('stale', 'refresh')).toBe('cached');
    expect(nextState('imported', 'invalidate')).toBe('invalidated');
    expect(nextState('invalidated', 'download')).toBe('cached');
  });

  it('nem-megengedett átmenet → változatlan', () => {
    expect(nextState('external', 'import')).toBe('external'); // előbb le kell tölteni
    expect(nextState('imported', 'import')).toBe('imported');
    expect(canTransition('external', 'import')).toBe(false);
    expect(canTransition('external', 'download')).toBe(true);
  });
});

describe('helperek', () => {
  it('isLocallyAvailable: cached/imported igen, a többi nem', () => {
    const avail: AssetState[] = ['cached', 'imported'];
    const not: AssetState[] = ['external', 'stale', 'invalidated'];
    avail.forEach((s) => expect(isLocallyAvailable(s)).toBe(true));
    not.forEach((s) => expect(isLocallyAvailable(s)).toBe(false));
  });

  it('needsFetch: external/stale/invalidated igen', () => {
    expect(needsFetch('external')).toBe(true);
    expect(needsFetch('stale')).toBe(true);
    expect(needsFetch('invalidated')).toBe(true);
    expect(needsFetch('cached')).toBe(false);
    expect(needsFetch('imported')).toBe(false);
  });
});

describe('UI megjelenítés-állapot + badge', () => {
  it('assetLocallyAvailable: helyi uri igen, http stream nem', () => {
    expect(assetLocallyAvailable({ uri: 'file:///x/a.mp4' })).toBe(true);
    expect(assetLocallyAvailable({ uri: '/data/a.mov' })).toBe(true);
    expect(assetLocallyAvailable({ uri: 'https://cdn/a.mp4' })).toBe(false);
    expect(assetLocallyAvailable({ uri: 'http://x/a.mp4' })).toBe(false);
  });

  it('assetDisplayState: local→imported, remote+helyi→cached, remote+http→external', () => {
    expect(assetDisplayState({ provider: 'local', uri: 'file:///a.mp4' })).toBe('imported');
    expect(assetDisplayState({ provider: 'remote', uri: 'file:///a.mp4' })).toBe('cached');
    expect(assetDisplayState({ provider: 'remote', uri: 'https://cdn/a.mp4' })).toBe('external');
    expect(assetDisplayState({ provider: 'library', uri: 'https://cdn/a.mp4' })).toBe('external');
  });

  it('assetStateBadge: minden állapotra ikon + i18n-kulcs + tone', () => {
    const states: AssetState[] = ['imported', 'cached', 'external', 'stale', 'invalidated'];
    for (const s of states) {
      const b = assetStateBadge(s);
      expect(b.labelKey).toBe(`asset.state.${s}`);
      expect(b.icon.length).toBeGreaterThan(0);
      expect(['ok', 'dim', 'warn']).toContain(b.tone);
    }
    expect(assetStateBadge('external').tone).toBe('dim');
    expect(assetStateBadge('imported').tone).toBe('ok');
    expect(assetStateBadge('stale').tone).toBe('warn');
  });

  it('canDownload a külső/nem-helyi forrásra; canEvict csak a cached-re', () => {
    expect(canDownload('external')).toBe(true);
    expect(canDownload('stale')).toBe(true);
    expect(canDownload('invalidated')).toBe(true);
    expect(canDownload('cached')).toBe(false);
    expect(canDownload('imported')).toBe(false);
    expect(canEvict('cached')).toBe(true);
    expect(canEvict('imported')).toBe(false); // device-saját → nincs mit visszatölteni
    expect(canEvict('external')).toBe(false);
  });
});

describe('selectForEviction — LRU + byte-cap, adatvesztés-védett (§03.2)', () => {
  const entry = (over: Partial<CacheEntry>): CacheEntry => ({ state: 'cached', bytes: 100, lastAccessMs: 0, ...over });

  it('cap alatt → nincs eviction', () => {
    const entries = [entry({ id: 'a', bytes: 50 }), entry({ id: 'b', bytes: 40 })];
    expect(selectForEviction(entries, { maxBytes: 200 })).toEqual([]);
  });

  it('cap felett → a legrégebben használt dobható bejegyzéseket dobja, amíg a cap alá ér', () => {
    const entries = [
      entry({ id: 'new', bytes: 100, lastAccessMs: 1000 }),
      entry({ id: 'old', bytes: 100, lastAccessMs: 10 }),
      entry({ id: 'mid', bytes: 100, lastAccessMs: 500 }),
    ]; // total 300, cap 150 → 150-nyit kell dobni → 2 legrégebbi
    const out = selectForEviction(entries, { maxBytes: 150 });
    expect(out.map((e) => e.id)).toEqual(['old', 'mid']);
  });

  it('a device-saját `imported`-ot SOHA nem dobja, akkor sem, ha emiatt a cap fölött marad (ADR-013)', () => {
    const entries = [
      entry({ id: 'own', state: 'imported', bytes: 500, lastAccessMs: 0 }),
      entry({ id: 'cache', state: 'cached', bytes: 100, lastAccessMs: 5 }),
    ]; // total 600, cap 50
    const out = selectForEviction(entries, { maxBytes: 50 });
    expect(out.map((e) => e.id)).toEqual(['cache']); // csak a cached megy, az imported marad
  });

  it('stale is dobható (újra-letölthető), external nem foglal helyet', () => {
    expect(isCacheEvictable('stale')).toBe(true);
    expect(isCacheEvictable('imported')).toBe(false);
    const entries = [
      entry({ id: 's', state: 'stale', bytes: 100, lastAccessMs: 0 }),
      entry({ id: 'e', state: 'external', bytes: 9999 }), // nem helyi → nem számít a méretbe
    ];
    expect(selectForEviction(entries, { maxBytes: 50 }).map((e) => e.id)).toEqual(['s']);
  });
});

describe('remoteChangeDecision — ETag / Last-Modified (§03.3)', () => {
  it('ETag-elsőbbség: azonos → unchanged, eltérő → changed', () => {
    expect(remoteChangeDecision({ etag: 'W/"abc"' }, { etag: 'W/"abc"' })).toBe('unchanged');
    expect(remoteChangeDecision({ etag: 'W/"abc"' }, { etag: 'W/"xyz"' })).toBe('changed');
  });
  it('ETag híján Last-Modified: távoli újabb → changed', () => {
    expect(
      remoteChangeDecision({ lastModified: '2026-01-01T00:00:00Z' }, { lastModified: '2026-02-01T00:00:00Z' }),
    ).toBe('changed');
    expect(
      remoteChangeDecision({ lastModified: '2026-02-01T00:00:00Z' }, { lastModified: '2026-01-01T00:00:00Z' }),
    ).toBe('unchanged');
  });
  it('nincs összevethető validátor → unknown', () => {
    expect(remoteChangeDecision({}, {})).toBe('unknown');
    expect(remoteChangeDecision({ etag: 'a' }, {})).toBe('unknown'); // csak egy oldalon ETag + nincs LM
  });
  it('remoteChanged: csak a biztos "changed" igaz (unknown → false)', () => {
    expect(remoteChanged({ etag: 'a' }, { etag: 'b' })).toBe(true);
    expect(remoteChanged({}, {})).toBe(false);
  });
  it('a changed → a hívó assetStateOf-ja stale-t ad', () => {
    const changed = remoteChanged({ etag: 'a' }, { etag: 'b' });
    expect(assetStateOf(remote, { localAvailable: true, remoteChanged: changed })).toBe('stale');
  });
});
