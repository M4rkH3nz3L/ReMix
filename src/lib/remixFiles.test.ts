import {
  type StorageEntry,
  breadcrumbs,
  extensionOf,
  fileKindOf,
  filterEntries,
  fitsQuota,
  joinPath,
  parentPath,
  quotaLevel,
  sortEntries,
  studioForKind,
  validateName,
} from './remixFiles';

const e = (name: string, extra: Partial<StorageEntry> = {}): StorageEntry => ({
  location: 'remix',
  path: name,
  name,
  isFolder: false,
  ...extra,
});

describe('remixFiles', () => {
  test('fájltípus a kiterjesztésből (kis-nagybetű független)', () => {
    expect(extensionOf('a.B.MP4')).toBe('mp4');
    expect(extensionOf('.rejtett')).toBe('');
    expect(fileKindOf('klip.MOV')).toBe('video');
    expect(fileKindOf('kep.heic')).toBe('image');
    expect(fileKindOf('dal.flac')).toBe('audio');
    expect(fileKindOf('terv.remix')).toBe('project');
    expect(fileKindOf('felirat.srt')).toBe('document');
    expect(fileKindOf('valami')).toBe('other');
  });

  test('stúdió-hozzárendelés', () => {
    expect(studioForKind('video')).toBe('video');
    expect(studioForKind('audio')).toBe('audio');
    expect(studioForKind('document')).toBeNull();
  });

  test('út-segédek + morzsamenü', () => {
    expect(joinPath('', 'a')).toBe('a');
    expect(joinPath('a/b', 'c')).toBe('a/b/c');
    expect(parentPath('a/b/c')).toBe('a/b');
    expect(parentPath('a')).toBe('');
    expect(breadcrumbs('a/b')).toEqual([
      { name: 'a', path: 'a' },
      { name: 'b', path: 'a/b' },
    ]);
    expect(breadcrumbs('')).toEqual([]);
  });

  test('névellenőrzés (a szerver tükre)', () => {
    expect(validateName('  ')).toBe('empty');
    expect(validateName('a/b')).toBe('invalid');
    expect(validateName('..')).toBe('invalid');
    expect(validateName('.folder')).toBe('invalid');
    expect(validateName('x'.repeat(121))).toBe('tooLong');
    expect(validateName('Nyári forgatás 2026')).toBeNull();
  });

  test('rendezés: mappák elöl, majd kulcs szerint (természetes névsor)', () => {
    const list = [
      e('b10.mp4', { size: 5 }),
      e('Mappa', { isFolder: true }),
      e('b2.mp4', { size: 50 }),
      e('a.wav', { size: 10 }),
    ];
    expect(sortEntries(list, 'name').map((x) => x.name)).toEqual(['Mappa', 'a.wav', 'b2.mp4', 'b10.mp4']);
    expect(sortEntries(list, 'size', true).map((x) => x.name)).toEqual(['Mappa', 'b2.mp4', 'a.wav', 'b10.mp4']);
  });

  test('rendezés módosítás szerint', () => {
    const list = [e('ujabb', { modified: '2026-10-02T00:00:00Z' }), e('regi', { modified: '2026-01-01T00:00:00Z' })];
    expect(sortEntries(list, 'modified').map((x) => x.name)).toEqual(['regi', 'ujabb']);
  });

  test('szűrés: típus + keresés; mappák a navigációhoz megmaradnak', () => {
    const list = [e('Klipek', { isFolder: true }), e('a.mp4'), e('b.png'), e('klip2.mov')];
    expect(filterEntries(list, 'video').map((x) => x.name)).toEqual(['Klipek', 'a.mp4', 'klip2.mov']);
    expect(filterEntries(list, 'all', 'KLIP').map((x) => x.name)).toEqual(['Klipek', 'klip2.mov']);
    expect(filterEntries(list, 'image', 'klip').map((x) => x.name)).toEqual(['Klipek']);
  });

  test('kvóta-szint és elférés', () => {
    expect(quotaLevel(0, 0)).toEqual({ fraction: 0, level: 'ok' });
    expect(quotaLevel(85, 100).level).toBe('warn');
    expect(quotaLevel(120, 100)).toEqual({ fraction: 1, level: 'full' });
    expect(fitsQuota(90, 100, 10)).toBe(true);
    expect(fitsQuota(90, 100, 11)).toBe(false);
    expect(fitsQuota(90, 0, 1e12)).toBe(true);
  });
});
