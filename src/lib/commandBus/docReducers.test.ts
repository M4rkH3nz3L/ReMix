import { applyCommand, describeCommand } from '@/lib/commands';
import { createImageDoc } from '@/lib/imageDoc';
import { createLiveDoc } from '@/lib/liveDoc';
import { audioClip, expectChanged, makeProject } from '@/test-utils/projectFixtures';

/**
 * 🧱 CORE §2.1 — a command-bus magjának (applyCommand reducer) regressziós pajzsa — kép/live dokumentum és album (docReducers).
 * Minden parancs happy-path + `null` (no-op/érvénytelen) ág + immutabilitás (a
 * bemeneti projekt referenciája nem változik), valamint a `describeCommand` címke.
 * A mag expo-mentes → a jest közvetlenül importálja (mint a contract-tesztek).
 * (A korábbi egyetlen commands.test.ts reducer-tartományonként bontva; a fixture-ök: src/test-utils.)
 */

describe('applyCommand — kép/live dokumentum', () => {
  it('UPSERT_IMAGE_DOC: hozzáad, frissít, null ha változatlan', () => {
    const p = makeProject();
    const doc = createImageDoc('Kép', '9:16', () => 'lyr1');
    const added = expectChanged(p, applyCommand(p, { type: 'UPSERT_IMAGE_DOC', doc }));
    expect(added.imageDocs).toHaveLength(1);
    expect(applyCommand(added, { type: 'UPSERT_IMAGE_DOC', doc })).toBeNull();
    const updated = expectChanged(added, applyCommand(added, { type: 'UPSERT_IMAGE_DOC', doc: { ...doc, name: 'Új név' } }));
    expect(updated.imageDocs![0].name).toBe('Új név');
  });
  it('REMOVE_IMAGE_DOC: töröl + null ha nincs ilyen', () => {
    const doc = createImageDoc('Kép', '9:16', () => 'lyr1');
    const p = makeProject({ imageDocs: [doc] });
    expect(expectChanged(p, applyCommand(p, { type: 'REMOVE_IMAGE_DOC', docId: doc.id })).imageDocs).toBeUndefined();
    expect(applyCommand(p, { type: 'REMOVE_IMAGE_DOC', docId: 'nincs' })).toBeNull();
  });
  it('SET_LIVE_DOC: beállít + null ha változatlan', () => {
    const p = makeProject();
    const live = createLiveDoc('Live', () => 'live1');
    const next = expectChanged(p, applyCommand(p, { type: 'SET_LIVE_DOC', doc: live }));
    expect(next.live).toEqual(live);
    expect(applyCommand(next, { type: 'SET_LIVE_DOC', doc: live })).toBeNull();
  });
});

describe('applyCommand — REORDER_IMAGE_DOCS', () => {
  const doc = (id: string) =>
    createImageDoc(id, '1:1', () => `lyr-${id}`, { width: 100, height: 100 }) as unknown as import('@/types/project').ImageDoc;

  it('új sorrend az id-lista szerint', () => {
    const [a, b, c] = [doc('a'), doc('b'), doc('c')].map((d, i) => ({ ...d, id: ['a', 'b', 'c'][i] }));
    const p = makeProject({ imageDocs: [a, b, c] });
    const next = expectChanged(p, applyCommand(p, { type: 'REORDER_IMAGE_DOCS', order: ['c', 'a', 'b'] }));
    expect(next.imageDocs!.map((d) => d.id)).toEqual(['c', 'a', 'b']);
    expect(p.imageDocs!.map((d) => d.id)).toEqual(['a', 'b', 'c']); // immutábilis
  });

  it('hiányzó id-k a végükön maradnak (stabil)', () => {
    const [a, b, c] = ['a', 'b', 'c'].map((id) => ({ ...doc(id), id }));
    const p = makeProject({ imageDocs: [a, b, c] });
    const next = expectChanged(p, applyCommand(p, { type: 'REORDER_IMAGE_DOCS', order: ['c'] }));
    expect(next.imageDocs!.map((d) => d.id)).toEqual(['c', 'a', 'b']);
  });

  it('változatlan sorrend / <2 lap → null (no-op)', () => {
    const [a, b] = ['a', 'b'].map((id) => ({ ...doc(id), id }));
    const p = makeProject({ imageDocs: [a, b] });
    expect(applyCommand(p, { type: 'REORDER_IMAGE_DOCS', order: ['a', 'b'] })).toBeNull();
    const one = makeProject({ imageDocs: [a] });
    expect(applyCommand(one, { type: 'REORDER_IMAGE_DOCS', order: ['a'] })).toBeNull();
  });

  it('describeCommand címke', () => {
    expect(describeCommand({ type: 'REORDER_IMAGE_DOCS', order: ['a', 'b'] })).toContain('2');
  });
});

describe('applyCommand — APPLY_ALBUM (szám-swap + történet)', () => {
  const musicTrack = (clipId?: string): import('@/types/project').Track => ({
    id: 'trk-music',
    type: 'music',
    name: 'Music',
    clips: clipId ? [audioClip(clipId)] : [],
  });
  const song = (id: string, clipId?: string): import('@/types/project').AlbumSong => ({
    id,
    name: id,
    tracks: [musicTrack(clipId)],
    assets: [],
  });

  it('album inicializálás (prev nélkül): az aktív szám sávjai töltődnek', () => {
    const p = makeProject();
    const album = { songs: [song('s1', 'c1')], activeSongId: 's1' };
    const next = expectChanged(p, applyCommand(p, { type: 'APPLY_ALBUM', album }));
    expect(next.album!.activeSongId).toBe('s1');
    expect(next.tracks.find((t) => t.type === 'music')!.clips.map((c) => c.id)).toEqual(['c1']);
  });

  it('szám-váltás: a JELENLEGI idővonal az ELŐZŐ aktívba mentődik, az ÚJ töltődik', () => {
    // album 2 számmal, aktív = s1
    let p = makeProject({ album: { songs: [song('s1'), song('s2', 'c2')], activeSongId: 's1' } });
    // „élőben" szerkesztjük az s1-et: a project.tracks music-sávjára teszünk egy klipet
    p = {
      ...p,
      tracks: p.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [audioClip('live1')] } : t)),
    };
    // váltás s2-re
    const album2 = { ...p.album!, activeSongId: 's2' };
    const next = expectChanged(p, applyCommand(p, { type: 'APPLY_ALBUM', album: album2 }));
    // a project.tracks most az s2 sávjait tükrözi
    expect(next.tracks.find((t) => t.type === 'music')!.clips.map((c) => c.id)).toEqual(['c2']);
    // s1 pedig megőrizte az élő szerkesztést
    const s1 = next.album!.songs.find((s) => s.id === 's1')!;
    expect(s1.tracks.find((t) => t.type === 'music')!.clips.map((c) => c.id)).toEqual(['live1']);
  });

  it('változatlan album + tracks → null (no-op)', () => {
    const album = { songs: [song('s1', 'c1')], activeSongId: 's1' };
    const p = makeProject({ album, tracks: [musicTrack('c1')] });
    expect(applyCommand(p, { type: 'APPLY_ALBUM', album })).toBeNull();
  });

  it('describeCommand címke', () => {
    expect(describeCommand({ type: 'APPLY_ALBUM', album: { songs: [song('a'), song('b')], activeSongId: 'a' } })).toContain('2');
  });
});
