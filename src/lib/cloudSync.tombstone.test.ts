/**
 * 🪦 Regresszió (user-jelentés 2026-10-26): „töröltem a projekteket véglegesen, és
 * ott vannak a listámban". A felhős törlés elbukott (a Supabase `{ error }`-t ad,
 * nem dob), és a Stúdió induláskori szinkronja a „hiányzó" projektet visszatöltötte.
 *
 * A kamu Supabase-kliens egy memóriabeli `cloud_projects` táblát tart, és a törlést
 * kapcsolhatóan elbuktatja.
 */
import type { Project } from '@/types/project';

const cloud = new Map<string, { project_id: string; data: Project }>();
let failDeletes = false;
/** hány tábla-lekérés indult (a törölt projekt mentése EGYET sem indíthat) */
let mockCalls = 0;

function mockQuery() {
  mockCalls += 1;
  const filters: Record<string, unknown> = {};
  let inIds: string[] | null = null;
  let mode: 'select' | 'delete' = 'select';
  const rows = () =>
    [...cloud.values()].filter(
      (r) => (!filters.project_id || r.project_id === filters.project_id) && (!inIds || inIds.includes(r.project_id))
    );
  const builder = {
    select: () => builder,
    delete: () => {
      mode = 'delete';
      return builder;
    },
    eq: (col: string, v: unknown) => {
      filters[col] = v;
      return builder;
    },
    in: (_col: string, ids: string[]) => {
      inIds = ids;
      return builder;
    },
    upsert: async (row: { project_id: string; data: Project }) => {
      cloud.set(row.project_id, row);
      return { error: null };
    },
    maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
    then: (resolve: (v: unknown) => void) => {
      if (mode === 'delete') {
        if (failDeletes) {
          resolve({ error: { message: 'network' } });
          return;
        }
        rows().forEach((r) => cloud.delete(r.project_id));
        resolve({ error: null });
        return;
      }
      resolve({ data: rows(), error: null });
    },
  };
  return builder;
}

jest.mock('@/lib/supabase', () => ({
  supabase: { from: () => mockQuery() },
  requireSupabase: () => ({ from: () => mockQuery() }),
}));
jest.mock('@/store/authStore', () => ({ useAuth: { getState: () => ({ user: { id: 'u1' } }) } }));
jest.mock('@/store/entitlementStore', () => ({
  useEntitlement: { getState: () => ({ effectiveTier: () => 'free' }) },
}));
jest.mock('@/lib/externalStorage', () => ({ hasOwnStorageTarget: async () => false }));

/* eslint-disable import/first */
import { backupProjectToCloud, deleteCloudProject, syncProjectsFromCloud } from '@/lib/cloudSync';
import { deletedProjectIds, deleteProject, listProjects, saveProject } from '@/lib/storage';
import { createEmptyProject } from '@/lib/projectUtils';
/* eslint-enable import/first */

function project(id: string): Project {
  return { ...createEmptyProject('Teszt', '9:16'), id };
}

beforeEach(() => {
  cloud.clear();
  failDeletes = false;
  mockCalls = 0;
});

describe('törölt projekt nem jön vissza a felhőből', () => {
  it('elbukó felhős törlés után a szinkron NEM tölti vissza, és újrapróbálja a törlést', async () => {
    const p = project('prj_del1');
    await saveProject(p);
    cloud.set(p.id, { project_id: p.id, data: p }); // a korábbi auto-backup felhő-másolata

    failDeletes = true;
    await deleteProject(p.id);
    expect(await deleteCloudProject(p.id)).toBe(false); // a hibát már ÉSZREVESSZÜK
    expect(cloud.has('prj_del1')).toBe(true);

    // következő indulás: a szinkron nem hozza vissza …
    failDeletes = false;
    expect(await syncProjectsFromCloud()).toBe(0);
    expect((await listProjects()).some((m) => m.id === 'prj_del1')).toBe(false);
    // … és a felhőből is kitakarítja (öngyógyulás)
    expect(cloud.has('prj_del1')).toBe(false);
  });

  it('a törlés UTÁN induló háttér-mentés nem tölti vissza a felhőbe', async () => {
    const p = project('prj_del2');
    await saveProject(p);
    await deleteProject(p.id);
    mockCalls = 0;
    await backupProjectToCloud(p); // egy késve induló mentés
    expect(cloud.has('prj_del2')).toBe(false);
    expect(mockCalls).toBe(0); // se lekérés, se média-feltöltés, se upsert
  });

  it('a valóban hiányzó (nem törölt) felhő-projekt továbbra is visszajön', async () => {
    cloud.set('prj_other', { project_id: 'prj_other', data: project('prj_other') });
    expect(await syncProjectsFromCloud()).toBe(1);
    expect((await listProjects()).some((m) => m.id === 'prj_other')).toBe(true);
  });

  it('ugyanazzal az id-vel KIFEJEZETTEN újra elmentett projekt ismét él (pl. .rp-import)', async () => {
    const p = project('prj_del3');
    await saveProject(p);
    await deleteProject(p.id);
    expect((await deletedProjectIds()).has(p.id)).toBe(true);
    await saveProject(p);
    // a sírkő lekerül → a visszatöltés és a háttér-mentés ismét kezeli
    expect((await deletedProjectIds()).has(p.id)).toBe(false);
  });
});
