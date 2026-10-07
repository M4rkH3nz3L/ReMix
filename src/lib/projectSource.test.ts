import { assetFromPicked, assetInUse, sourceSummary, supportedSourceKinds } from '@/lib/projectSource';
import type { Asset, Project } from '@/types/project';

describe('supportedSourceKinds', () => {
  it('video fogad mindent, kép csak képet, hang csak hangot', () => {
    expect(supportedSourceKinds('image')).toEqual(['image']);
    expect(supportedSourceKinds('audio')).toEqual(['audio']);
    expect(supportedSourceKinds('video')).toEqual(['video', 'image', 'audio']);
    expect(supportedSourceKinds(undefined)).toEqual(['video', 'image', 'audio']);
  });
});

describe('assetFromPicked', () => {
  it('picker-eredmény → Asset (local, névvel, metával)', () => {
    const a = assetFromPicked('video', { uri: 'file:///x/clip.mp4', duration: 3, width: 1920, height: 1080 });
    expect(a).toMatchObject({ kind: 'video', uri: 'file:///x/clip.mp4', provider: 'local', name: 'clip.mp4', duration: 3, width: 1920 });
    expect(a.id).toMatch(/^ast/);
  });
  it('név az uri-ból, ha nincs megadva', () => {
    expect(assetFromPicked('image', { uri: 'file:///a/b/pic.png' }).name).toBe('pic.png');
  });
});

describe('assetInUse', () => {
  const asset: Asset = { id: 'a1', kind: 'image', uri: 'file:///x/pic.png', provider: 'local' };
  it('igaz, ha klip hivatkozza az uri-t', () => {
    const p = { tracks: [{ clips: [{ uri: 'file:///x/pic.png' }] }], imageDocs: [] } as unknown as Project;
    expect(assetInUse(p, asset)).toBe(true);
  });
  it('igaz, ha fotó-réteg hivatkozza', () => {
    const p = { tracks: [], imageDocs: [{ layers: [{ kind: 'photo', uri: 'file:///x/pic.png' }] }] } as unknown as Project;
    expect(assetInUse(p, asset)).toBe(true);
  });
  it('hamis, ha senki nem hivatkozza', () => {
    const p = { tracks: [{ clips: [{ uri: 'file:///other.png' }] }], imageDocs: [] } as unknown as Project;
    expect(assetInUse(p, asset)).toBe(false);
  });
});

describe('sourceSummary', () => {
  it('fajtánként számol, rögzített sorrendben', () => {
    const assets = [
      { id: '1', kind: 'video', uri: 'a', provider: 'local' },
      { id: '2', kind: 'image', uri: 'b', provider: 'local' },
      { id: '3', kind: 'image', uri: 'c', provider: 'local' },
    ] as Asset[];
    expect(sourceSummary(assets, (k) => k)).toBe('1 video · 2 image');
  });
});
