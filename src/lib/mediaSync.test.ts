import {
  classifyMissingMedia,
  mediaRemoteMap,
  needsBackup,
  recoveryOutcome,
} from '@/lib/mediaSync';
import type { MissingMedia, RelinkPair } from '@/lib/videdFile';
import type { Asset, Project } from '@/types/project';

const asset = (over: Partial<Asset>): Asset => ({
  id: 'a',
  kind: 'video',
  uri: 'file:///x.mp4',
  provider: 'local',
  ...over,
});

describe('mediaRemoteMap', () => {
  it('csak a remoteUrl-lel bíró asseteket teszi a térképbe', () => {
    const p = {
      assets: [
        asset({ uri: 'file:///a.mp4', remoteUrl: 'https://s/a.mp4' }),
        asset({ uri: 'file:///b.mp4' }),
      ],
    } as unknown as Project;
    expect(mediaRemoteMap(p)).toEqual({ 'file:///a.mp4': 'https://s/a.mp4' });
  });
});

describe('needsBackup', () => {
  it('helyi / library asset remote nélkül → kell', () => {
    expect(needsBackup(asset({ provider: 'local' }), {})).toBe(true);
    expect(needsBackup(asset({ provider: 'library' }), {})).toBe(true);
  });
  it('már van remoteUrl VAGY ismert (known) remote → nem kell', () => {
    expect(needsBackup(asset({ remoteUrl: 'https://s/x' }), {})).toBe(false);
    expect(needsBackup(asset({ uri: 'file:///x.mp4' }), { 'file:///x.mp4': 'https://s/x' })).toBe(
      false
    );
  });
  it('http-forrás → nem kell (streamelhető, már a szerveren)', () => {
    expect(needsBackup(asset({ uri: 'https://cdn/x.mp4' }), {})).toBe(false);
    expect(needsBackup(asset({ provider: 'remote', uri: 'https://cdn/x.mp4' }), {})).toBe(false);
  });
  it('remote-provider DE helyi file:// uri → KELL (letöltött másolat, mentendő)', () => {
    expect(needsBackup(asset({ provider: 'remote', uri: 'file:///dl.mp4' }), {})).toBe(true);
  });
});

const missingItem = (over: Partial<MissingMedia>): MissingMedia => ({
  uri: 'file:///x.mp4',
  kind: 'video',
  label: 'x.mp4',
  ...over,
});

describe('classifyMissingMedia (CORE §2.8 — granuláris helyreállítás-terv)', () => {
  it('az asset.remoteUrl-lel bíró hiányzó média RESTORABLE, a forrás nélküli ORPHANED', () => {
    const project = {
      assets: [
        asset({ uri: 'file:///a.mp4', remoteUrl: 'https://cdn/a.mp4' }),
        asset({ uri: 'file:///b.mp4' }), // nincs remote → árva
      ],
    } as unknown as Project;
    const missing = [missingItem({ uri: 'file:///a.mp4' }), missingItem({ uri: 'file:///b.mp4' })];
    const plan = classifyMissingMedia(project, missing);
    expect(plan.restorable.map((m) => m.uri)).toEqual(['file:///a.mp4']);
    expect(plan.orphaned.map((m) => m.uri)).toEqual(['file:///b.mp4']);
  });

  it('a felhő-projekt remoteByUri térképe is forrás (akkor is, ha a helyi assetnek nincs remoteUrl-je)', () => {
    const project = { assets: [asset({ uri: 'file:///b.mp4' })] } as unknown as Project;
    const missing = [missingItem({ uri: 'file:///b.mp4' })];
    const plan = classifyMissingMedia(project, missing, { 'file:///b.mp4': 'https://cdn/b.mp4' });
    expect(plan.restorable).toHaveLength(1);
    expect(plan.orphaned).toHaveLength(0);
  });

  it('üres hiányzó-lista → üres terv', () => {
    const plan = classifyMissingMedia({ assets: [] } as unknown as Project, []);
    expect(plan).toEqual({ restorable: [], orphaned: [] });
  });
});

describe('recoveryOutcome (CORE §2.8 — egy visszaállítási kör eredménye)', () => {
  const missing = [
    missingItem({ uri: 'file:///a.mp4' }),
    missingItem({ uri: 'file:///b.mp4' }),
    missingItem({ uri: 'file:///c.mp4' }),
  ];

  it('a relink-párral bíró uri RESTORED, a többi FAILED (per-fájl újrapróba alanya)', () => {
    const pairs: RelinkPair[] = [
      { oldUri: 'file:///a.mp4', newUri: 'file:///cache/a.mp4' },
      { oldUri: 'file:///c.mp4', newUri: 'file:///cache/c.mp4' },
    ];
    const out = recoveryOutcome(missing, pairs);
    expect(out.restored.map((m) => m.uri)).toEqual(['file:///a.mp4', 'file:///c.mp4']);
    expect(out.failed.map((m) => m.uri)).toEqual(['file:///b.mp4']);
  });

  it('nincs pár → minden failed; minden pár → minden restored', () => {
    expect(recoveryOutcome(missing, []).failed).toHaveLength(3);
    const all = missing.map((m) => ({ oldUri: m.uri, newUri: m.uri + '.new' }));
    expect(recoveryOutcome(missing, all).restored).toHaveLength(3);
    expect(recoveryOutcome(missing, all).failed).toHaveLength(0);
  });
});
