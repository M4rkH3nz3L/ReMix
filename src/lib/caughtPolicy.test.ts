import { caughtVerdict } from './caughtPolicy';

const reported = (e: unknown, where = 'lib/x.ts:f') => caughtVerdict(e, where).report;

describe('caughtVerdict — csak a valódi hiba kerül a naplóba', () => {
  it('a kapcsolat hiánya nem hiba (a napló valós szövegei)', () => {
    expect(reported(new Error('fetch failed: UnexpectedException: A hálózati kapcsolat megszakadt.'))).toBe(false);
    expect(reported(new Error('fetch failed: UnexpectedException: Nem sikerült a szerverhez kapcsolódni.'))).toBe(false);
    expect(reported(new Error('TimeoutError: a kérés 15000 ms alatt nem válaszolt'))).toBe(false);
    expect(reported(new Error('Could not connect to the server.'))).toBe(false);
    expect(reported(new Error('Network request failed'))).toBe(false);
  });

  it('a push-jogosultság nélküli build és a foglalt hangmunkamenet nem hiba', () => {
    expect(reported(new Error('UnexpectedException: az alkalmazáshoz nem található érvényes „aps-environment” meghatalmazási karaktersor'))).toBe(false);
    expect(reported(new Error('A művelet végrehajtása sikertelen volt. (OSStatus hiba 561017449.)'))).toBe(false);
  });

  it('törlésnél a „nincs ilyen” kész állapot, máshol hiba', () => {
    expect(reported(new Error('RemixFilesError: Nincs ilyen fájl vagy mappa.'), 'lib/projectSyncClient.ts:removeRemoteProjectFolder')).toBe(false);
    expect(reported(new Error('Nincs ilyen fájl vagy mappa.'), 'lib/projectSyncClient.ts:readPlan')).toBe(true);
  });

  it('a séma-eltérés és a programhiba valódi hiba', () => {
    expect(reported(new Error('Supabase 404 GET: Could not find the table \'public.referrals\' in the schema cache'))).toBe(true);
    expect(reported(new Error('Supabase 400 GET: column gift_events.creator_cents does not exist'))).toBe(true);
    expect(reported(new TypeError("Cannot read properties of undefined (reading 'clips')"))).toBe(true);
    expect(reported(new Error('Invariant Violation: Tried to register two views with the same name RNCSafeAreaView'))).toBe(true);
  });

  it('az ok megnevezve', () => {
    expect(caughtVerdict(new Error('Network request failed'), 'a')).toEqual({ report: false, reason: 'nincs kapcsolat' });
  });
});
