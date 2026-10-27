import {
  PROJECTS_DIR,
  canEnableSync,
  deviceRelativePath,
  isHiddenName,
  planAdoption,
  planProjectSync,
  projectFolderPath,
  protectionOf,
  slugifyProjectName,
  uniqueFolderName,
} from './projectFolder';

describe('projectFolder', () => {
  test('ékezetmentes, fájlrendszer-biztos mappanév', () => {
    expect(slugifyProjectName('Nyári Forgatás – 2026!')).toBe('nyari-forgatas-2026');
    expect(slugifyProjectName('Árvíztűrő tükörfúrógép')).toBe('arvizturo-tukorfurogep');
    expect(slugifyProjectName('ŐSZI   ünnep / ../ teszt')).toBe('oszi-unnep-teszt');
    expect(slugifyProjectName('Größe Ærø Łódź')).toBe('grosse-aero-lodz');
    expect(slugifyProjectName('   ')).toBe('projekt');
    expect(slugifyProjectName('🎬🎬')).toBe('projekt');
    expect(slugifyProjectName('a'.repeat(200))).toHaveLength(60);
    expect(slugifyProjectName(`${'a'.repeat(59)} b`)).toBe('a'.repeat(59));
  });

  test('ütközésmentes név', () => {
    expect(uniqueFolderName('klip', [])).toBe('klip');
    expect(uniqueFolderName('klip', ['klip'])).toBe('klip-2');
    expect(uniqueFolderName('klip', ['klip', 'klip-2'])).toBe('klip-3');
    expect(uniqueFolderName('a'.repeat(60), ['a'.repeat(60)])).toHaveLength(60);
  });

  test('védett utak', () => {
    const folders = new Set(['nyar']);
    const used = new Set([`${PROJECTS_DIR}/nyar/a.mp4`]);
    expect(projectFolderPath('nyar')).toBe('Projektek/nyar');
    expect(protectionOf('Projektek', folders, used)).toBe('container');
    expect(protectionOf('Projektek/nyar', folders, used)).toBe('project');
    expect(protectionOf('Projektek/nyar/a.mp4', folders, used)).toBe('inUse');
    expect(protectionOf('Projektek/nyar/b.mp4', folders, used)).toBeNull();
    expect(protectionOf('Projektek/torolt', folders, used)).toBeNull();
    expect(protectionOf('Sajat/a.mp4', folders, used)).toBeNull();
  });

  test('uri → Tárhelyem-relatív út (konténer-függetlenül)', () => {
    expect(deviceRelativePath('file:///var/mobile/X/Documents/Files/Projektek/nyar/a%20b.mp4')).toBe(
      'Projektek/nyar/a b.mp4'
    );
    expect(deviceRelativePath('file:///var/Documents/media/x.mp4')).toBeNull();
  });

  test('szinkron-terv: új/eltérő fel, felhőből nem törlünk', () => {
    const plan = planProjectSync(
      [
        { path: 'a.mp4', size: 10 },
        { path: 'b.wav', size: 5 },
        { path: 'c.png', size: 7 },
      ],
      [
        { path: 'a.mp4', size: 10 },
        { path: 'b.wav', size: 4 },
        { path: 'regi.mov', size: 99 },
      ]
    );
    expect(plan.upload.map((u) => u.path)).toEqual(['b.wav', 'c.png']);
    expect(plan.uploadBytes).toBe(12);
    expect(plan.inSync).toBe(1);
    expect(plan.remoteOnly).toEqual(['regi.mov']);
  });

  test('kvóta-kapu', () => {
    expect(canEnableSync(10, 80, 100)).toEqual({ ok: true, missingBytes: 0 });
    expect(canEnableSync(30, 80, 100)).toEqual({ ok: false, missingBytes: 10 });
    expect(canEnableSync(1e12, 0, 0).ok).toBe(true);
  });
});

describe('planAdoption', () => {
  test('közös media → mozgatható; másik projekt mappája → másolat; saját → marad', () => {
    const plan = planAdoption(
      [
        'file:///X/Documents/media/abc_klip%201.mp4',
        'file:///X/Documents/mediacache/r.wav',
        'file:///X/Documents/Files/Projektek/masik/kep.png',
        'file:///X/Documents/Files/Projektek/sajat/ok.mp4',
        'file:///X/Documents/media/abc_klip%201.mp4',
        'https://cdn/x.mp4',
      ],
      'sajat'
    );
    expect(plan).toEqual([
      { uri: 'file:///X/Documents/media/abc_klip%201.mp4', name: 'abc_klip 1.mp4', shared: false },
      { uri: 'file:///X/Documents/mediacache/r.wav', name: 'r.wav', shared: false },
      { uri: 'file:///X/Documents/Files/Projektek/masik/kep.png', name: 'kep.png', shared: true },
    ]);
    expect(isHiddenName('.remix-project')).toBe(true);
    expect(isHiddenName('a.mp4')).toBe(false);
  });
});
