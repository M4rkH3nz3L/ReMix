import { extractMediaKeys, mediaFileKeyOf, planMediaDeletion } from '@/lib/mediaGc';

/**
 * 🧹 Projekt-média GC (ADR-013 kiegészítés): a fájl a PROJEKTTEL törlődik, de a
 * máshol (duplikátum/remix/verzió/napló) hivatkozott fájl marad; az összevetés
 * konténer-útvonal-független.
 */

const DOC = 'file:///var/mobile/Containers/Data/Application/AAAA-1111/Documents';
const OLD_DOC = 'file:///var/mobile/Containers/Data/Application/BBBB-2222/Documents';

function projectJson(uris: string[]): string {
  return JSON.stringify({
    id: 'p',
    assets: uris.map((uri, i) => ({ id: `a${i}`, kind: 'video', uri, provider: 'local' })),
  });
}

describe('mediaFileKeyOf', () => {
  it('media/ és mediacache/ fájlokra ad kulcsot, másra nem', () => {
    expect(mediaFileKeyOf(`${DOC}/media/abc_video.mp4`)).toEqual({
      dir: 'media',
      name: 'abc_video.mp4',
    });
    expect(mediaFileKeyOf(`${DOC}/mediacache/yt_x.mp4`)).toEqual({
      dir: 'mediacache',
      name: 'yt_x.mp4',
    });
    expect(mediaFileKeyOf(`${DOC}/renders/out.mp4`)).toBeNull();
    expect(mediaFileKeyOf('https://cdn.example.com/media/abc.mp4')).toBeNull();
    expect(mediaFileKeyOf('ph://ASSET-ID')).toBeNull();
  });

  it('konténer-útvonal-független: két külön prefix ugyanarra a kulcsra képez', () => {
    expect(mediaFileKeyOf(`${DOC}/media/rec_1.mp4`)).toEqual(
      mediaFileKeyOf(`${OLD_DOC}/media/rec_1.mp4`),
    );
  });
});

describe('extractMediaKeys', () => {
  it('nyers JSON-ból minden app-média hivatkozást kigyűjt (asset+klip+nested)', () => {
    const raw = JSON.stringify({
      assets: [{ uri: `${DOC}/media/a.mp4` }],
      tracks: [{ clips: [{ uri: `${DOC}/media/b.mp4`, matte: { uri: `${DOC}/media/c.png` } }] }],
      other: 'https://x.y/media/no.mp4',
    });
    expect([...extractMediaKeys(raw)].sort()).toEqual(['media/a.mp4', 'media/b.mp4', 'media/c.png']);
  });

  it('null/üres bemenet → üres halmaz', () => {
    expect(extractMediaKeys(null).size).toBe(0);
    expect(extractMediaKeys('').size).toBe(0);
  });
});

describe('planMediaDeletion', () => {
  it('a csak a törölt projektben hivatkozott fájl törlődik, a megosztott marad', () => {
    const deleted = projectJson([`${DOC}/media/only_here.mp4`, `${DOC}/media/shared.mp4`]);
    const remaining = projectJson([`${DOC}/media/shared.mp4`]);
    expect(planMediaDeletion([deleted], [remaining])).toEqual([
      { dir: 'media', name: 'only_here.mp4' },
    ]);
  });

  it('régi konténer-prefixű hivatkozás is VÉDI a fájlt (relink-kompat)', () => {
    const deleted = projectJson([`${DOC}/media/kept.mp4`]);
    const remaining = projectJson([`${OLD_DOC}/media/kept.mp4`]);
    expect(planMediaDeletion([deleted], [remaining])).toEqual([]);
  });

  it('verzió-pillanatkép és eseménynapló is hivatkozásnak számít', () => {
    const deleted = projectJson([`${DOC}/media/v.mp4`]);
    const versionSnapshot = JSON.stringify([{ project: { assets: [{ uri: `${DOC}/media/v.mp4` }] } }]);
    expect(planMediaDeletion([deleted], [versionSnapshot])).toEqual([]);
  });

  it('utolsó hivatkozó projekt törlése → a fájl megy („csak a projekttel törölhető")', () => {
    const deleted = projectJson([`${DOC}/media/last.mp4`, `${DOC}/mediacache/r2_copy.mp4`]);
    expect(planMediaDeletion([deleted, null], [])).toEqual([
      { dir: 'media', name: 'last.mp4' },
      { dir: 'mediacache', name: 'r2_copy.mp4' },
    ]);
  });

  it('determinista és duplikátum-mentes', () => {
    const deleted = projectJson([`${DOC}/media/x.mp4`, `${DOC}/media/x.mp4`]);
    const a = planMediaDeletion([deleted], []);
    expect(a).toEqual(planMediaDeletion([deleted], []));
    expect(a).toHaveLength(1);
  });
});
