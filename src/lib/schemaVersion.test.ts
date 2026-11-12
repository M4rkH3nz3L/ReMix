import AsyncStorage from '@react-native-async-storage/async-storage';

import { createEmptyProject, CURRENT_SCHEMA_VERSION, isNewerSchema, migrateProject } from '@/lib/projectUtils';
import { loadProject, saveProject, saveProjectAndEvents } from '@/lib/storage';
import { useEditorStore } from '@/store/editorStore';
import type { Project } from '@/types/project';

/** 📐 AP1: séma v7 + az újabb app-verzió projektje csak olvasható (nem íródik felül). */
describe('📐 projekt-séma', () => {
  it('az új projekt a jelenlegi sémán; a régi (v1–v6) v7-re lép, idempotensen', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(7);
    expect(createEmptyProject('a', '9:16', undefined, 'audio').schemaVersion).toBe(7);
    const v6 = { ...createEmptyProject('b', '9:16'), schemaVersion: 6 } as Project;
    const m = migrateProject(v6);
    expect(m.schemaVersion).toBe(7);
    expect(migrateProject(m)).toEqual(m);
    const v1 = { ...createEmptyProject('c', '9:16'), schemaVersion: 1, assets: undefined } as unknown as Project;
    expect(migrateProject(v1).schemaVersion).toBe(7);
  });

  it('az újabb verzió megmarad, és csak olvasható', () => {
    const v99 = { ...createEmptyProject('d', '9:16'), schemaVersion: 99 } as Project;
    expect(migrateProject(v99).schemaVersion).toBe(99);
    expect(isNewerSchema(v99)).toBe(true);
    expect(isNewerSchema(createEmptyProject('e', '9:16'))).toBe(false);
    expect(isNewerSchema(null)).toBe(false);
  });

  it('a parancs-busz nem írja az újabb verziójú projektet (dispatch és köteg)', () => {
    const p = { ...createEmptyProject('f', '9:16', undefined, 'audio'), schemaVersion: 99 } as Project;
    useEditorStore.getState().loadProject(p);
    expect(useEditorStore.getState().dispatch({ type: 'RENAME_PROJECT', name: 'x' })).toBe(false);
    expect(useEditorStore.getState().applyBatch([{ type: 'RENAME_PROJECT', name: 'x' }])).toBe(0);
    expect(useEditorStore.getState().project).toBe(p);
    expect(useEditorStore.getState().dirty).toBe(false);
  });

  it('a helyi mentés nem írja felül a tárolt újabb verziót', async () => {
    const stored = { ...createEmptyProject('g', '9:16'), id: 'prj_newer', schemaVersion: 99, futureField: 1 } as unknown as Project;
    const raw = JSON.stringify(stored);
    await AsyncStorage.setItem('vided.project.v1.prj_newer', raw);
    const loaded = await loadProject('prj_newer');
    expect(loaded?.schemaVersion).toBe(99);
    await saveProject({ ...loaded!, name: 'felülírva' });
    await saveProjectAndEvents({ ...loaded!, name: 'felülírva' }, []);
    expect(await AsyncStorage.getItem('vided.project.v1.prj_newer')).toBe(raw);
  });
});
