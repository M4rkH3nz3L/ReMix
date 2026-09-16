import AsyncStorage from '@react-native-async-storage/async-storage';

import { listProjects, saveProject } from '@/lib/storage';
import type { Project } from '@/types/project';

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
