import {
  assetDisplayState,
  assetLocallyAvailable,
  assetStateBadge,
  assetStateOf,
  canDownload,
  canEvict,
  canTransition,
  isLocallyAvailable,
  needsFetch,
  nextState,
  type AssetState,
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
