import { parseWorkspaceDoc } from '@/lib/workspaceClient';
import { addNote, addTask, emptyWorkspace, splitWorkspace, upsertProjectRef } from '@/lib/workspace';

const T0 = '2026-01-01T00:00:00.000Z';
const jsonRoundtrip = <T>(x: T): unknown => JSON.parse(JSON.stringify(x));

describe('workspaceClient — parseWorkspaceDoc', () => {
  it('round-trip: a WorkspaceDoc (refek/notes/tasks) hiánytalanul visszaolvasható', () => {
    let ws = emptyWorkspace('W', { ownerId: 'u1', ownerName: 'H3nz3L' }, T0);
    ws = upsertProjectRef(ws, { id: 'p1', name: 'Vlog', kind: 'video', remixOf: { projectId: 'p0', name: 'Ős' } }, T0);
    ws = addNote(ws, 'ötlet', T0);
    ws = addTask(ws, 'Vágás', { status: 'editing', projectId: 'p1' }, T0);
    const { doc } = splitWorkspace(ws);
    expect(parseWorkspaceDoc(jsonRoundtrip(doc))).toEqual(doc);
  });

  it('hibás/hiányzó doc → biztonságos üres WorkspaceDoc', () => {
    expect(parseWorkspaceDoc(null)).toEqual({
      id: '',
      name: 'Workspace',
      projects: [],
      notes: [],
      tasks: [],
      brands: [],
      templates: [],
      updatedAt: '',
    });
  });

  it('a hibás refeket/taskokat kihagyja, a rossz kind/status alapértékre esik', () => {
    const doc = {
      id: 'w',
      name: 'W',
      projects: [
        { id: 'p1', name: 'jó', kind: 'ismeretlen' }, // rossz kind → video
        { id: 'p2' }, // nincs name → kihagyva
      ],
      tasks: [{ id: 't1', title: 'ok', status: 'ufo' }], // rossz status → idea
      notes: [{ text: 'nincs id' }],
    };
    const parsed = parseWorkspaceDoc(doc);
    expect(parsed.projects).toHaveLength(1);
    expect(parsed.projects[0].kind).toBe('video');
    expect(parsed.tasks[0].status).toBe('idea');
    expect(parsed.notes).toHaveLength(0);
  });
});
