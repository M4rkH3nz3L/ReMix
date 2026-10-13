import {
  activeSong,
  addSong,
  albumManifest,
  canRemoveSong,
  initAlbum,
  makeSong,
  removeSong,
  renameSong,
  renderedSongCount,
  reorderSongs,
  setActiveSong,
  setCover,
  setSongRender,
  songCount,
} from '@/lib/albumDoc';
import type { AlbumDoc, Track } from '@/types/project';

const tracks = (n: string): Track[] => [{ id: `trk-${n}`, type: 'music', name: 'Music', clips: [] }];
const song = (id: string, name = id) => makeSong(id, name, tracks(id));

const album = (): AlbumDoc => addSong(addSong(initAlbum(song('a', 'Dal A')), song('b', 'Dal B')), song('c', 'Dal C'));

describe('albumDoc — album-manifeszt CRUD', () => {
  it('initAlbum + addSong: az új szám a végén + aktív lesz', () => {
    const a = album();
    expect(a.songs.map((s) => s.id)).toEqual(['a', 'b', 'c']);
    expect(a.activeSongId).toBe('c');
    expect(songCount(a)).toBe(3);
  });

  it('activeSong / canRemoveSong', () => {
    const a = album();
    expect(activeSong(a)?.id).toBe('c');
    expect(canRemoveSong(a)).toBe(true);
    expect(canRemoveSong(initAlbum(song('x')))).toBe(false);
  });

  it('removeSong: az aktívat törölve a szomszéd lesz aktív', () => {
    const a = album(); // active = c
    const r = removeSong(a, 'c');
    expect(r.songs.map((s) => s.id)).toEqual(['a', 'b']);
    expect(r.activeSongId).toBe('b'); // előző szomszéd
  });

  it('removeSong: nem-aktívat törölve az aktív marad', () => {
    const a = setActiveSong(album(), 'a');
    const r = removeSong(a, 'b');
    expect(r.songs.map((s) => s.id)).toEqual(['a', 'c']);
    expect(r.activeSongId).toBe('a');
  });

  it('removeSong: utolsó szám nem törölhető (no-op)', () => {
    const one = initAlbum(song('x'));
    expect(removeSong(one, 'x')).toBe(one);
  });

  it('reorderSongs: mozgat + no-op érvénytelenre', () => {
    const a = album();
    expect(reorderSongs(a, 0, 2).songs.map((s) => s.id)).toEqual(['b', 'c', 'a']);
    expect(reorderSongs(a, 1, 1)).toBe(a);
    expect(reorderSongs(a, 9, 0)).toBe(a);
  });

  it('renameSong: átnevez, üresre no-op', () => {
    const a = album();
    expect(renameSong(a, 'a', 'Intro').songs[0].name).toBe('Intro');
    expect(renameSong(a, 'a', '  ')).toBe(a);
  });

  it('setActiveSong: vált, ismeretlenre/azonosra no-op', () => {
    const a = album();
    expect(setActiveSong(a, 'a').activeSongId).toBe('a');
    expect(setActiveSong(a, 'c')).toBe(a);
    expect(setActiveSong(a, 'nope')).toBe(a);
  });

  it('setCover: borító-doc id be/ki', () => {
    const a = album();
    expect(setCover(a, 'cover1').coverDocId).toBe('cover1');
    expect(setCover(setCover(a, 'cover1'), null).coverDocId).toBeUndefined();
  });

  it('setSongRender + renderedSongCount', () => {
    let a = album();
    expect(renderedSongCount(a)).toBe(0);
    a = setSongRender(a, 'a', 'file://a.m4a', 120);
    a = setSongRender(a, 'b', 'file://b.m4a', 90);
    expect(renderedSongCount(a)).toBe(2);
    expect(a.songs[0]).toMatchObject({ renderedUri: 'file://a.m4a', durationSec: 120 });
  });

  it('albumManifest: csak a renderelt számok + borító + össz-hossz', () => {
    let a = album();
    a = setSongRender(a, 'a', 'file://a.m4a', 120);
    a = setSongRender(a, 'c', 'file://c.m4a', 60);
    const m = albumManifest(a, 'file://cover.png');
    expect(m.count).toBe(2); // csak a renderelt a + c
    expect(m.coverUri).toBe('file://cover.png');
    expect(m.totalSec).toBe(180);
    expect(m.tracks.map((t) => t.title)).toEqual(['Dal A', 'Dal C']);
  });
});
