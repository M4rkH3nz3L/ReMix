import { usageOf } from '@/lib/assetLibrary';
import { memoryContextLines } from '@/lib/creatorMemory';
import { projectsUsingAsset } from '@/lib/creativeGraph';
import {
  addNote,
  addTask,
  assembleWorkspace,
  emptyWorkspace,
  ingestProject,
  removeNote,
  removeProjectRef,
  removeTask,
  scheduleTask,
  setTaskStatus,
  splitWorkspace,
  tasksByStatus,
  upsertProjectRef,
  workspaceGraph,
  workspaceSearch,
  workspaceSearchDocs,
  type Workspace,
} from '@/lib/workspace';
import type { Project } from '@/types/project';

const T0 = '2026-01-01T00:00:00.000Z';
const T1 = '2026-01-02T00:00:00.000Z';
const NOW = '2026-09-27T12:00:00.000Z';

const mkProject = (over: Partial<Project> & { id: string; name: string }): Project =>
  ({
    kind: 'video',
    aspectRatio: '9:16',
    tracks: [
      {
        id: 't-cap',
        type: 'captions',
        name: 'felirat',
        clips: [{ id: 'c1', kind: 'text', start: 0, duration: 1, fontFamily: 'Inter', color: '#FFD400' }],
      },
    ],
    assets: [
      { id: 'a1', kind: 'audio', uri: 'm://1', provider: 'library', name: 'Neon Intro', hash: 'h1' },
      { id: 'a2', kind: 'image', uri: 'g://1', provider: 'local', name: 'H3nz3L logo', hash: 'h2' },
    ],
    createdAt: T0,
    updatedAt: T0,
    schemaVersion: 6,
    ...over,
  }) as unknown as Project;

describe('workspace — projekt-refek', () => {
  it('upsert beszúr és frissít (id-re)', () => {
    let ws = emptyWorkspace('W', {}, T0);
    ws = upsertProjectRef(ws, { id: 'p1', name: 'Vlog', kind: 'video' }, T0);
    expect(ws.projects).toHaveLength(1);
    ws = upsertProjectRef(ws, { id: 'p1', name: 'Vlog v2', kind: 'video', published: true }, T1);
    expect(ws.projects).toHaveLength(1);
    expect(ws.projects[0].name).toBe('Vlog v2');
    expect(ws.projects[0].published).toBe(true);
  });

  it('removeProjectRef törli a refet ÉS tisztítja az asset-usage-et', () => {
    let ws = emptyWorkspace('W', {}, T0);
    ws = ingestProject(ws, mkProject({ id: 'p1', name: 'Vlog' }), {}, T0);
    const logo = ws.library.assets.find((a) => a.name === 'H3nz3L logo')!;
    expect(usageOf(ws.library, logo.id)).toEqual(['p1']);
    ws = removeProjectRef(ws, 'p1', T1);
    expect(ws.projects).toHaveLength(0);
    expect(usageOf(ws.library, logo.id)).toEqual([]);
  });
});

describe('workspace — jegyzetek + feladatok (Planner-mag)', () => {
  it('addNote / removeNote, üres no-op', () => {
    let ws = emptyWorkspace('W', {}, T0);
    expect(addNote(ws, '   ', T0)).toBe(ws);
    ws = addNote(ws, 'ötlet: nyári vlog', T0);
    expect(ws.notes).toHaveLength(1);
    ws = removeNote(ws, ws.notes[0].id, T1);
    expect(ws.notes).toHaveLength(0);
  });

  it('scheduleTask platformot + tervezett időpontot + státuszt állít', () => {
    let ws = emptyWorkspace('W', {}, T0);
    ws = addTask(ws, 'Vlog', {}, T0);
    const id = ws.tasks[0].id;
    ws = scheduleTask(ws, id, { scheduledFor: '2026-09-29T10:00:00.000Z', platform: 'youtube', status: 'scheduled' }, T1);
    expect(ws.tasks[0]).toMatchObject({ platform: 'youtube', scheduledFor: '2026-09-29T10:00:00.000Z', status: 'scheduled' });
    expect(scheduleTask(ws, 'nope', { platform: 'x' }, T1)).toBe(ws);
  });

  it('addTask / setTaskStatus / tasksByStatus / removeTask', () => {
    let ws = emptyWorkspace('W', {}, T0);
    ws = addTask(ws, 'Forgatás', { status: 'production' }, T0);
    ws = addTask(ws, 'Vágás', {}, T0); // default 'idea'
    expect(tasksByStatus(ws).production).toHaveLength(1);
    expect(tasksByStatus(ws).idea).toHaveLength(1);
    const cut = ws.tasks.find((t) => t.title === 'Vágás')!;
    ws = setTaskStatus(ws, cut.id, 'published', T1);
    expect(tasksByStatus(ws).published).toHaveLength(1);
    ws = removeTask(ws, cut.id, T1);
    expect(ws.tasks).toHaveLength(1);
  });
});

describe('workspace — ingestProject (a nagy integráció)', () => {
  const build = (learn = true): Workspace => {
    let ws = emptyWorkspace('H3nz3L', { ownerId: 'u1', ownerName: 'H3nz3L' }, T0);
    ws = ingestProject(ws, mkProject({ id: 'p1', name: 'Vlog' }), { learn }, T0);
    return ws;
  };

  it('behúzza a projekt-refet, az asseteket usage-gel, és tanul a memóriába', () => {
    const ws = build();
    expect(ws.projects.map((p) => p.name)).toEqual(['Vlog']);
    expect(ws.library.assets).toHaveLength(2);
    const music = ws.library.assets.find((a) => a.name === 'Neon Intro')!;
    expect(music.kind).toBe('music');
    expect(usageOf(ws.library, music.id)).toEqual(['p1']);
    // Creator Memory tanult (felirat-szín, betűtípus, képarány)
    const lines = memoryContextLines(ws.memory, 'video');
    expect(lines).toEqual(expect.arrayContaining([expect.stringContaining('#FFD400')]));
  });

  it('learn:false esetén NEM tanul, de az asseteket behúzza', () => {
    const ws = build(false);
    expect(ws.memory.facts).toHaveLength(0);
    expect(ws.library.assets).toHaveLength(2);
  });

  it('idempotens: kétszeri behúzás nem duplikál', () => {
    let ws = build();
    ws = ingestProject(ws, mkProject({ id: 'p1', name: 'Vlog' }), { learn: true }, T1);
    expect(ws.projects).toHaveLength(1);
    expect(ws.library.assets).toHaveLength(2);
  });
});

describe('workspace — származtatott nézetek (Graph + ⌘K)', () => {
  const build = (): Workspace => {
    let ws = emptyWorkspace('H3nz3L', { ownerId: 'u1', ownerName: 'H3nz3L' }, T0);
    // két projekt osztozik ugyanazon a logón (közös hash → egy asset, két usage)
    ws = ingestProject(ws, mkProject({ id: 'p1', name: 'Vlog', updatedAt: '2026-09-01T00:00:00.000Z' }), {}, T0);
    ws = ingestProject(
      ws,
      mkProject({ id: 'p2', name: 'Remix vlog', remixOf: { projectId: 'p1', name: 'Vlog' }, updatedAt: '2026-08-01T00:00:00.000Z' }),
      {},
      T0
    );
    return ws;
  };

  it('workspaceGraph válaszol a „hol használtam?" kérdésre a teljes workspace fölött', () => {
    const ws = build();
    const g = workspaceGraph(ws);
    const logo = ws.library.assets.find((a) => a.name === 'H3nz3L logo')!;
    expect(projectsUsingAsset(g, logo.id).map((n) => n.label).sort()).toEqual(['Remix vlog', 'Vlog']);
  });

  it('workspaceSearchDocs a projekteket/asseteket/jegyzeteket/feladatokat is indexeli', () => {
    let ws = build();
    ws = addNote(ws, 'ötlet: aszfalt', T0);
    ws = addTask(ws, 'Thumbnail', {}, T0);
    const docs = workspaceSearchDocs(ws);
    const scopes = new Set(docs.map((d) => d.scope));
    expect(scopes.has('project')).toBe(true);
    expect(scopes.has('music')).toBe(true);
    expect(scopes.has('document')).toBe(true);
  });

  it('workspaceSearch NL-szűrője a teljes workspace fölött megy („projektek" → recency)', () => {
    const ws = build();
    const r = workspaceSearch(ws, 'projektek', { now: NOW });
    expect(r.map((x) => x.id)).toEqual(['p1', 'p2']); // p1 újabb updatedAt
  });

  it('workspaceSearch szabad-szavas: „neon" a zene-assetet találja', () => {
    const ws = build();
    const r = workspaceSearch(ws, 'neon', { now: NOW });
    expect(r.some((x) => x.scope === 'music')).toBe(true);
  });
});

describe('workspace — split/assemble (perzisztencia-hasítás)', () => {
  const build = (): Workspace => {
    let ws = emptyWorkspace('H3nz3L', { ownerId: 'u1', ownerName: 'H3nz3L' }, T0);
    ws = ingestProject(ws, mkProject({ id: 'p1', name: 'Vlog' }), { learn: true }, T0);
    ws = addNote(ws, 'ötlet', T0);
    ws = addTask(ws, 'Vágás', {}, T0);
    return ws;
  };

  it('splitWorkspace kiemeli a globális library/memory-t a workspace-részből', () => {
    const { doc, library, memory } = splitWorkspace(build());
    expect((doc as unknown as { library?: unknown }).library).toBeUndefined();
    expect((doc as unknown as { memory?: unknown }).memory).toBeUndefined();
    expect(doc.projects).toHaveLength(1);
    expect(doc.notes).toHaveLength(1);
    expect(doc.tasks).toHaveLength(1);
    expect(library.assets).toHaveLength(2);
    expect(memory.facts.length).toBeGreaterThan(0);
  });

  it('assemble(split(ws)) visszaállítja az eredeti workspace-t (round-trip)', () => {
    const ws = build();
    const { doc, library, memory } = splitWorkspace(ws);
    expect(assembleWorkspace(doc, library, memory)).toEqual(ws);
  });
});
