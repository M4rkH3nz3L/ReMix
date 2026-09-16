import AsyncStorage from '@react-native-async-storage/async-storage';

import { loadVersions, recordAutoVersion } from '@/lib/storage';
import type { Project } from '@/types/project';

const project = {
  id: 'p1',
  name: 'teszt',
  aspectRatio: '9:16',
  tracks: [{ id: 't', type: 'video', name: 'v', clips: [] }],
  assets: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  schemaVersion: 5,
} as unknown as Project;

const VERSIONS_KEY = 'vided.versions.v1.p1';
const LASTAUTO_KEY = 'vided.versions.lastauto.v1.p1';

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
});

describe('recordAutoVersion — olcsó throttle', () => {
  it('első hívásnál létrehoz egy auto-verziót', async () => {
    await recordAutoVersion(project);
    const versions = await loadVersions('p1');
    expect(versions).toHaveLength(1);
    expect(versions[0].kind).toBe('auto');
  });

  it('beírja az olcsó throttle-időbélyeget', async () => {
    await recordAutoVersion(project);
    const ts = await AsyncStorage.getItem(LASTAUTO_KEY);
    expect(Number(ts)).toBeGreaterThan(0);
  });

  it('⚡ a throttle-on belüli hívás NEM olvassa be a teljes verzió-listát', async () => {
    await recordAutoVersion(project); // első: ír
    jest.clearAllMocks();

    await recordAutoVersion(project); // második: throttle-olva

    const readKeys = (AsyncStorage.getItem as jest.Mock).mock.calls.map((c) => c[0]);
    expect(readKeys).toContain(LASTAUTO_KEY); // az olcsó kulcsot olvassa
    expect(readKeys).not.toContain(VERSIONS_KEY); // a DRÁGA listát NEM
  });

  it('a throttle-on belül nem keletkezik új verzió', async () => {
    await recordAutoVersion(project);
    await recordAutoVersion(project);
    expect(await loadVersions('p1')).toHaveLength(1);
  });

  it('régi adatnál (nincs időbélyeg-kulcs) is helyesen throttle-ol', async () => {
    // olyan állapot, mint a frissítés előtt: van auto-verzió, de nincs kulcs
    await recordAutoVersion(project);
    await AsyncStorage.removeItem(LASTAUTO_KEY);

    await recordAutoVersion(project);
    expect(await loadVersions('p1')).toHaveLength(1); // a listából dönt, nem duplikál
  });

  it('a kézi pillanatképeket nem érinti', async () => {
    await AsyncStorage.setItem(
      VERSIONS_KEY,
      JSON.stringify([
        { id: 'v1', name: 'Kézi', at: '2020-01-01T00:00:00.000Z', project, kind: 'manual' },
      ])
    );
    await recordAutoVersion(project);
    const versions = await loadVersions('p1');
    expect(versions.filter((v) => v.kind === 'manual')).toHaveLength(1);
    expect(versions.filter((v) => v.kind === 'auto')).toHaveLength(1);
  });
});
