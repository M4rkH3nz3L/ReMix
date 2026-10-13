import { albumPagerItems, buildAlbum, formatAlbumDuration, type AlbumTrack } from './album';

const tracks = (n: number): AlbumTrack[] =>
  Array.from({ length: n }, (_, i) => ({ id: `t${i}`, uri: `file://song${i}.m4a`, title: `Dal ${i}`, durationSec: 60 + i }));

describe('album — hang-album mag (TECH-TOP §2.3)', () => {
  test('buildAlbum: szám-lista + borító + össz-hossz', () => {
    const a = buildAlbum(tracks(3), 'file://cover.png');
    expect(a.count).toBe(3);
    expect(a.coverUri).toBe('file://cover.png');
    expect(a.totalSec).toBe(60 + 61 + 62);
  });

  test('buildAlbum: üres/érvénytelen uri kiszűrve', () => {
    const a = buildAlbum([{ id: 'x', uri: '', durationSec: 10 }, { id: 'y', uri: 'file://ok.m4a', durationSec: 20 }]);
    expect(a.count).toBe(1);
    expect(a.totalSec).toBe(20);
  });

  test('albumPagerItems: borító elöl, majd számonként egy lap (remix-pager)', () => {
    const pages = albumPagerItems(buildAlbum(tracks(2), 'file://cover.png'));
    expect(pages[0]).toEqual({ kind: 'cover', uri: 'file://cover.png' });
    expect(pages[1]).toMatchObject({ kind: 'track', id: 't0', title: 'Dal 0', index: 0 });
    expect(pages).toHaveLength(3); // cover + 2 szám
  });

  test('albumPagerItems: borító nélkül csak a számok', () => {
    const pages = albumPagerItems(buildAlbum(tracks(2)));
    expect(pages).toHaveLength(2);
    expect(pages.every((p) => p.kind === 'track')).toBe(true);
  });

  test('cím-fallback: „N. szám", ha nincs title', () => {
    const pages = albumPagerItems(buildAlbum([{ id: 'a', uri: 'file://a.m4a', durationSec: 5 }]));
    expect(pages[0]).toMatchObject({ kind: 'track', title: '1. szám' });
  });

  test('formatAlbumDuration mm:ss', () => {
    expect(formatAlbumDuration(0)).toBe('0:00');
    expect(formatAlbumDuration(65)).toBe('1:05');
    expect(formatAlbumDuration(600)).toBe('10:00');
  });
});
