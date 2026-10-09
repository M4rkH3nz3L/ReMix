import {
  assetForClip,
  assetIdForUri,
  ensureClipAssets,
  flattenClipUris,
  relinkAsset,
  resolveClipUri,
} from '@/lib/assetResolve';
import type { Asset, Clip, Project } from '@/types/project';

const asset = (id: string, uri: string): Asset => ({ id, kind: 'video', uri, provider: 'local' });

const vClip = (id: string, over: Partial<{ uri: string; assetId: string }> = {}): Clip =>
  ({
    id,
    kind: 'video',
    start: 0,
    duration: 4,
    uri: 'file:///a.mp4',
    trimIn: 0,
    sourceDuration: 10,
    speed: 1,
    volume: 1,
    ...over,
  }) as unknown as Clip;

const textClip = (id: string): Clip =>
  ({ id, kind: 'text', start: 0, duration: 2, text: 'hi' }) as unknown as Clip;

const proj = (over: Partial<Project> = {}): Project =>
  ({
    id: 'p',
    name: 't',
    aspectRatio: '9:16',
    tracks: [{ id: 't1', type: 'video', name: 'v', clips: [] }],
    assets: [],
    schemaVersion: 6,
    ...over,
  }) as unknown as Project;

const withClips = (clips: Clip[], assets: Asset[] = []): Project =>
  proj({ tracks: [{ id: 't1', type: 'video', name: 'v', clips } as never], assets });

describe('assetForClip — klip → forrás-asset (ADR-012)', () => {
  it('assetId-n át old fel (elsődleges)', () => {
    const p = withClips([vClip('c', { assetId: 'ast1', uri: 'file:///stale.mp4' })], [asset('ast1', 'file:///fresh.mp4')]);
    expect(assetForClip(p, p.tracks[0].clips[0])?.id).toBe('ast1');
  });

  it('visszaesik uri-egyezésre, ha nincs assetId', () => {
    const p = withClips([vClip('c', { uri: 'file:///a.mp4' })], [asset('ast1', 'file:///a.mp4')]);
    expect(assetForClip(p, p.tracks[0].clips[0])?.id).toBe('ast1');
  });

  it('null, ha semmi nem egyezik / nem-media klip', () => {
    expect(assetForClip(withClips([vClip('c', { uri: 'file:///x.mp4' })]), vClip('c', { uri: 'file:///x.mp4' }))).toBeNull();
    expect(assetForClip(withClips([textClip('t')]), textClip('t'))).toBeNull();
  });
});

describe('resolveClipUri — az ASSET a forrás-igazság', () => {
  it('az asset uri-ját adja (a klip elavult uri-cache-e felett)', () => {
    const p = withClips([vClip('c', { assetId: 'ast1', uri: 'file:///stale.mp4' })], [asset('ast1', 'file:///fresh.mp4')]);
    expect(resolveClipUri(p, p.tracks[0].clips[0])).toBe('file:///fresh.mp4');
  });

  it('visszaesik a klip uri-jára, ha nincs asset', () => {
    const p = withClips([vClip('c', { uri: 'file:///only.mp4' })]);
    expect(resolveClipUri(p, p.tracks[0].clips[0])).toBe('file:///only.mp4');
  });
});

describe('relinkAsset — egy hívás → minden rá hivatkozó klip', () => {
  it('az asset uri-ját cseréli ÉS a linkelt klipek uri-cache-ét szinkronizálja', () => {
    const p = withClips(
      [
        vClip('c1', { assetId: 'ast1', uri: 'file:///old.mp4' }),
        vClip('c2', { assetId: 'ast1', uri: 'file:///old.mp4' }),
        vClip('c3', { assetId: 'ast2', uri: 'file:///other.mp4' }),
      ],
      [asset('ast1', 'file:///old.mp4'), asset('ast2', 'file:///other.mp4')]
    );
    const next = relinkAsset(p, 'ast1', 'file:///new.mp4');
    expect(next.assets.find((a) => a.id === 'ast1')?.uri).toBe('file:///new.mp4');
    const clips = next.tracks[0].clips as unknown as { id: string; uri: string }[];
    expect(clips.find((c) => c.id === 'c1')?.uri).toBe('file:///new.mp4');
    expect(clips.find((c) => c.id === 'c2')?.uri).toBe('file:///new.mp4');
    expect(clips.find((c) => c.id === 'c3')?.uri).toBe('file:///other.mp4'); // más asset — érintetlen
  });

  it('assetId nélküli klipet a régi uri-egyezés alapján relinkel', () => {
    const p = withClips([vClip('c', { uri: 'file:///old.mp4' })], [asset('ast1', 'file:///old.mp4')]);
    const next = relinkAsset(p, 'ast1', 'file:///new.mp4');
    expect((next.tracks[0].clips[0] as unknown as { uri: string }).uri).toBe('file:///new.mp4');
  });

  it('ismeretlen asset / azonos uri → változatlan (ugyanaz a referencia)', () => {
    const p = withClips([vClip('c', { assetId: 'ast1' })], [asset('ast1', 'file:///a.mp4')]);
    expect(relinkAsset(p, 'nincs', 'file:///x.mp4')).toBe(p);
    expect(relinkAsset(p, 'ast1', 'file:///a.mp4')).toBe(p);
  });
});

describe('assetIdForUri — determinisztikus, tartalom-címzett id (ADR-012)', () => {
  it('ugyanaz az uri → ugyanaz az id (round-trip + collab determinizmus)', () => {
    expect(assetIdForUri('file:///a.mp4')).toBe(assetIdForUri('file:///a.mp4'));
  });

  it('eltérő uri → eltérő id', () => {
    expect(assetIdForUri('file:///a.mp4')).not.toBe(assetIdForUri('file:///b.mp4'));
    expect(assetIdForUri('file:///a.mp4')).not.toBe(assetIdForUri('file:///a.mp5'));
  });

  it('`ast_` prefixszel kezdődik', () => {
    expect(assetIdForUri('file:///a.mp4')).toMatch(/^ast_/);
  });
});

describe('flattenClipUris — felhő-render előtti uri-lapítás (ADR-012)', () => {
  it('a media-klip uri-ját az asset feloldott uri-jára írja (desync → flatten)', () => {
    const p = withClips([vClip('c', { assetId: 'ast1', uri: 'file:///stale.mp4' })], [
      asset('ast1', 'file:///fresh.mp4'),
    ]);
    const flat = flattenClipUris(p);
    expect((flat.tracks[0].clips[0] as unknown as { uri: string }).uri).toBe('file:///fresh.mp4');
  });

  it('idempotens: szinkronban lévő projektre UGYANAZT a referenciát adja (no-op)', () => {
    const p = withClips([vClip('c', { assetId: 'ast1', uri: 'file:///a.mp4' })], [asset('ast1', 'file:///a.mp4')]);
    expect(flattenClipUris(p)).toBe(p);
  });

  it('nem-media klipet nem érint', () => {
    const p = withClips([textClip('t')]);
    expect(flattenClipUris(p)).toBe(p);
  });
});

describe('ensureClipAssets — betöltéskori backfill (idempotens)', () => {
  it('a backfillelt asset-id determinisztikus (kétszer futtatva ugyanaz)', () => {
    const mk = () => withClips([vClip('c', { uri: 'file:///det.mp4' })]);
    const a = ensureClipAssets(mk()).assets[0].id;
    const b = ensureClipAssets(mk()).assets[0].id;
    expect(a).toBe(b);
    expect(a).toBe(assetIdForUri('file:///det.mp4'));
  });

  it('a linkeletlen media-klipeknek assetet ad + linkeli', () => {
    const p = withClips([vClip('c', { uri: 'file:///a.mp4' })]);
    const next = ensureClipAssets(p);
    expect(next.assets).toHaveLength(1);
    expect(next.assets[0].uri).toBe('file:///a.mp4');
    expect((next.tracks[0].clips[0] as unknown as { assetId: string }).assetId).toBe(next.assets[0].id);
  });

  it('azonos uri → egy asset, több klip ugyanarra linkel (dedup)', () => {
    const p = withClips([vClip('c1', { uri: 'file:///a.mp4' }), vClip('c2', { uri: 'file:///a.mp4' })]);
    const next = ensureClipAssets(p);
    expect(next.assets).toHaveLength(1);
    const clips = next.tracks[0].clips as unknown as { assetId: string }[];
    expect(clips[0].assetId).toBe(clips[1].assetId);
  });

  it('idempotens: már linkelt projektre UGYANAZT a referenciát adja', () => {
    const p = withClips([vClip('c', { assetId: 'ast1', uri: 'file:///a.mp4' })], [asset('ast1', 'file:///a.mp4')]);
    expect(ensureClipAssets(p)).toBe(p);
  });

  it('a nem-media klipeket békén hagyja', () => {
    const p = withClips([textClip('t')]);
    expect(ensureClipAssets(p)).toBe(p);
  });

  it('a meglévő asseteket újrahasználja uri szerint (nem duplikál)', () => {
    const p = withClips([vClip('c', { uri: 'file:///a.mp4' })], [asset('ast1', 'file:///a.mp4')]);
    const next = ensureClipAssets(p);
    expect(next.assets).toHaveLength(1);
    expect((next.tracks[0].clips[0] as unknown as { assetId: string }).assetId).toBe('ast1');
  });
});
