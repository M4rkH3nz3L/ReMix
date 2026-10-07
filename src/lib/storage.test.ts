import AsyncStorage from '@react-native-async-storage/async-storage';

import type { ProjectEvent } from '@/lib/commands';
import {
  clearRecovery,
  duplicateProject,
  estimateProjectBytes,
  isProjectTooLarge,
  listProjects,
  loadEvents,
  loadProject,
  readRecovery,
  recoveryIsFresher,
  saveProject,
  saveProjectAndEvents,
  writeRecovery,
} from '@/lib/storage';
import type { Project } from '@/types/project';

const evt = (id: string): ProjectEvent => ({
  id, at: '2026-01-01T00:00:00.000Z', actor: 'user', command: { type: 'SET_FPS', fps: 24 },
});

const INDEX_KEY = 'vided.projects.v1';

const mkProject = (id: string, name: string): Project =>
  ({
    id,
    name,
    aspectRatio: '9:16',
    tracks: [
      {
        id: 't1',
        type: 'video',
        name: 'v',
        clips: [{ id: 'c1', kind: 'video', start: 0, duration: 5 }],
      },
    ],
    assets: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    schemaVersion: 5,
  }) as unknown as Project;

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('storage — a projekt-index sérülése NEM okozhat adatvesztést', () => {
  it('normál működés: a mentett projektek listázhatók', async () => {
    await saveProject(mkProject('p1', 'Első'));
    await saveProject(mkProject('p2', 'Második'));
    expect((await listProjects()).map((m) => m.name).sort()).toEqual(['Első', 'Második']);
  });

  it('SÉRÜLT index → újraépítés a tárolt projektekből (nem üres lista)', async () => {
    await saveProject(mkProject('p1', 'Első'));
    await saveProject(mkProject('p2', 'Második'));
    await saveProject(mkProject('p3', 'Harmadik'));

    await AsyncStorage.setItem(INDEX_KEY, '{"csonka JSON');

    const list = await listProjects();
    expect(list).toHaveLength(3);
    expect(list.map((m) => m.name).sort()).toEqual(['Első', 'Harmadik', 'Második']);
  });

  it('a sérült index vissza is íródik épen', async () => {
    await saveProject(mkProject('p1', 'Első'));
    await AsyncStorage.setItem(INDEX_KEY, 'szemét!!!');
    await listProjects();
    const raw = await AsyncStorage.getItem(INDEX_KEY);
    expect(() => JSON.parse(raw!)).not.toThrow();
    expect(JSON.parse(raw!)).toHaveLength(1);
  });

  it('⚠️ A KRITIKUS ESET: mentés sérült index után MEGTARTJA a régi projekteket', async () => {
    await saveProject(mkProject('p1', 'Első'));
    await saveProject(mkProject('p2', 'Második'));
    await saveProject(mkProject('p3', 'Harmadik'));

    await AsyncStorage.setItem(INDEX_KEY, 'szemét!!!');
    await saveProject(mkProject('p4', 'Negyedik')); // korábban ez elárvította a többit

    const list = await listProjects();
    expect(list).toHaveLength(4);
    expect(list.map((m) => m.name).sort()).toEqual(['Első', 'Harmadik', 'Második', 'Negyedik']);
  });

  it('nem-tömb index is sérülésnek számít', async () => {
    await saveProject(mkProject('p1', 'Első'));
    await AsyncStorage.setItem(INDEX_KEY, '{"a":1}');
    expect(await listProjects()).toHaveLength(1);
  });

  it('EGY olvashatatlan projekt kimarad, a többi megmarad', async () => {
    await saveProject(mkProject('p1', 'Első'));
    await saveProject(mkProject('p2', 'Második'));
    await AsyncStorage.setItem('vided.project.v1.p2', '{{{ tört');
    await AsyncStorage.setItem(INDEX_KEY, 'szemét');

    const list = await listProjects();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('p1');
  });

  it('üres tár → üres lista (ez NEM hiba, ez az első indítás)', async () => {
    expect(await listProjects()).toEqual([]);
  });

  it('a lista a legfrissebbel kezdődik', async () => {
    await saveProject({ ...mkProject('a', 'Régi'), updatedAt: '2020-01-01T00:00:00.000Z' });
    await new Promise((r) => setTimeout(r, 5));
    await saveProject(mkProject('b', 'Új'));
    expect((await listProjects())[0].id).toBe('b');
  });
});

describe('CORE §2.7 — atomi mentés (saveProjectAndEvents)', () => {
  it('a projekt + az események EGYÜTT mentődnek + visszatölthetők', async () => {
    await saveProjectAndEvents(mkProject('p1', 'Atomi'), [evt('e1'), evt('e2')]);
    expect((await loadProject('p1'))?.name).toBe('Atomi');
    expect((await loadEvents('p1')).map((e) => e.id)).toEqual(['e1', 'e2']);
    expect((await listProjects()).map((m) => m.id)).toContain('p1');
  });

  it('ha a multiSet elhasal, SEMMI nem íródik (vagy mind, vagy semmi)', async () => {
    const store = AsyncStorage as unknown as { multiSet: unknown };
    const orig = store.multiSet;
    store.multiSet = jest.fn(() => Promise.reject(new Error('disk full')));
    try {
      await expect(saveProjectAndEvents(mkProject('p1', 'Bukó'), [evt('e1')])).rejects.toThrow();
      expect(await loadProject('p1')).toBeNull(); // a loadok getItem-et használnak, nem multiSet-et
      expect(await loadEvents('p1')).toEqual([]);
    } finally {
      store.multiSet = orig; // garantált, pontos visszaállítás → nincs szivárgás
    }
  });
});

describe('CORE §2.7 — duplicateProject (Mentés másként)', () => {
  it('új id + „… másolat" név + friss dátumok; a forrás változatlan', async () => {
    await saveProject({ ...mkProject('src', 'Klip'), createdAt: '2020-01-01T00:00:00.000Z' });
    const copy = await duplicateProject('src', 'másolat');
    expect(copy).not.toBeNull();
    expect(copy!.id).not.toBe('src');
    expect(copy!.name).toBe('Klip másolat');
    expect(copy!.createdAt).not.toBe('2020-01-01T00:00:00.000Z');
    // a forrás érintetlen
    expect((await loadProject('src'))?.name).toBe('Klip');
    // a másolat is listázódik
    expect((await listProjects()).map((m) => m.id)).toContain(copy!.id);
  });

  it('null, ha a forrás nem létezik', async () => {
    expect(await duplicateProject('nincs')).toBeNull();
  });
});

describe('CORE §2.7 — crash-recovery', () => {
  it('write → read round-trip + clear', async () => {
    await writeRecovery(mkProject('p1', 'Mentetlen'), [evt('e1')]);
    const snap = await readRecovery('p1');
    expect(snap?.project.name).toBe('Mentetlen');
    expect(snap?.events.map((e) => e.id)).toEqual(['e1']);
    await clearRecovery('p1');
    expect(await readRecovery('p1')).toBeNull();
  });

  it('recoveryIsFresher: csak akkor igaz, ha a recovery ÚJABB a mentettnél', () => {
    expect(recoveryIsFresher('2026-01-02T00:00:00.000Z', '2026-01-01T00:00:00.000Z')).toBe(true);
    expect(recoveryIsFresher('2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z')).toBe(false);
    expect(recoveryIsFresher('2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')).toBe(false);
    expect(recoveryIsFresher('2026-01-01T00:00:00.000Z', undefined)).toBe(true); // nincs mentett → van mentetlen
  });
});

describe('CORE §2.7 — látható limitek', () => {
  it('kis projekt a méret-küszöb alatt', () => {
    const p = mkProject('p1', 'Kicsi');
    expect(estimateProjectBytes(p)).toBeGreaterThan(0);
    expect(isProjectTooLarge(p)).toBe(false);
  });
});
