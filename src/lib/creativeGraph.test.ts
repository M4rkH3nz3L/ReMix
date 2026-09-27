import { addAsset, emptyLibrary, recordUsage } from '@/lib/assetLibrary';
import {
  addEdge,
  addNode,
  assetNodeType,
  assetsUsedInProject,
  buildGraph,
  descendants,
  emptyGraph,
  lineage,
  neighbors,
  node,
  nodesOfType,
  projectNode,
  projectsUsingAsset,
  usageCount,
} from '@/lib/creativeGraph';
import type { Project } from '@/types/project';

const T0 = '2026-01-01T00:00:00.000Z';

const mkProject = (over: Partial<Project> & { id: string; name: string }): Project =>
  ({
    aspectRatio: '9:16',
    kind: 'video',
    tracks: [],
    assets: [],
    createdAt: T0,
    updatedAt: T0,
    schemaVersion: 6,
    ...over,
  }) as unknown as Project;

const buildScenario = () => {
  let lib = emptyLibrary(T0);
  lib = addAsset(lib, { kind: 'graphic', name: 'H3nz3L logo', uri: 'g', hash: 'hg' }, T0);
  lib = addAsset(lib, { kind: 'music', name: 'Neon Intro', uri: 'm', hash: 'hm' }, T0);
  const logo = lib.assets.find((a) => a.name === 'H3nz3L logo')!;
  const music = lib.assets.find((a) => a.name === 'Neon Intro')!;
  lib = recordUsage(lib, logo.id, 'pA', T0);
  lib = recordUsage(lib, logo.id, 'pB', T0);
  lib = recordUsage(lib, music.id, 'pC', T0);
  lib = recordUsage(lib, music.id, 'pB', T0);

  const projects = [
    mkProject({ id: 'pA', name: 'Vlog' }),
    mkProject({ id: 'pB', name: 'Remix vlog', remixOf: { projectId: 'pA', name: 'Vlog' } }),
    mkProject({ id: 'pC', name: 'Zenei projekt', kind: 'audio' }),
  ];

  const g = buildGraph({ personId: 'u1', personName: 'H3nz3L', projects, assets: lib.assets });
  return { g, logo, music };
};

describe('creativeGraph — alap reducerek', () => {
  it('addNode dedupál id-re, a meglévő label nyer, a meta összefésül', () => {
    let g = emptyGraph();
    g = addNode(g, { id: projectNode('p'), type: 'project', label: 'Vlog', meta: { kind: 'video' } });
    g = addNode(g, { id: projectNode('p'), type: 'project', label: 'p', meta: { extra: 1 } });
    expect(g.nodes).toHaveLength(1);
    expect(node(g, projectNode('p'))!.label).toBe('Vlog');
    expect(node(g, projectNode('p'))!.meta).toEqual({ kind: 'video', extra: 1 });
  });

  it('addEdge dedupál (from,to,type)-ra', () => {
    let g = emptyGraph();
    g = addNode(g, { id: 'a', type: 'project', label: 'a' });
    g = addNode(g, { id: 'b', type: 'asset', label: 'b' });
    g = addEdge(g, { from: 'a', to: 'b', type: 'uses' });
    g = addEdge(g, { from: 'a', to: 'b', type: 'uses' });
    expect(g.edges).toHaveLength(1);
  });

  it('assetNodeType leképez', () => {
    expect(assetNodeType('music')).toBe('music');
    expect(assetNodeType('photo')).toBe('image');
    expect(assetNodeType('graphic')).toBe('design');
    expect(assetNodeType('voice')).toBe('audio');
    expect(assetNodeType('code')).toBe('asset');
  });
});

describe('creativeGraph — buildGraph + usage-kérdések', () => {
  it('„Hol használtam ezt a logót?" → a logót használó projektek', () => {
    const { g, logo } = buildScenario();
    expect(projectsUsingAsset(g, logo.id).map((n) => n.label).sort()).toEqual(['Remix vlog', 'Vlog']);
  });

  it('„Mely projektek használják ezt a zenét?" → a zenét használó projektek', () => {
    const { g, music } = buildScenario();
    expect(projectsUsingAsset(g, music.id).map((n) => n.label).sort()).toEqual(['Remix vlog', 'Zenei projekt']);
  });

  it('assetsUsedInProject a projekt asseteit adja', () => {
    const { g } = buildScenario();
    expect(assetsUsedInProject(g, 'pB').map((n) => n.label).sort()).toEqual(['H3nz3L logo', 'Neon Intro']);
  });

  it('usageCount a hivatkozó projektek száma', () => {
    const { g, logo } = buildScenario();
    expect(usageCount(g, logo.id)).toBe(2);
  });

  it('a stub-project label nem írja felül a valódit', () => {
    const { g } = buildScenario();
    expect(node(g, projectNode('pA'))!.label).toBe('Vlog');
  });

  it('a person birtokolja az összes projektet és assetet', () => {
    const { g } = buildScenario();
    const owned = neighbors(g, 'person:u1', { edgeType: 'owns', direction: 'out' });
    // 3 projekt + 2 asset
    expect(owned).toHaveLength(5);
  });

  it('nodesOfType a típus szerinti node-okat adja', () => {
    const { g } = buildScenario();
    expect(nodesOfType(g, 'music')).toHaveLength(1);
    expect(nodesOfType(g, 'design')).toHaveLength(1);
    expect(nodesOfType(g, 'project')).toHaveLength(3);
  });
});

describe('creativeGraph — lineage (remix)', () => {
  it('a remix őse a forrás-projekt', () => {
    const { g } = buildScenario();
    expect(lineage(g, 'pB').map((n) => n.label)).toEqual(['Vlog']);
  });

  it('több lépcsős lineage sorrendben (legközelebbi elöl), ciklus-védve', () => {
    const projects = [
      mkProject({ id: 'g1', name: 'Gen1' }),
      mkProject({ id: 'g2', name: 'Gen2', remixOf: { projectId: 'g1', name: 'Gen1' } }),
      mkProject({ id: 'g3', name: 'Gen3', remixOf: { projectId: 'g2', name: 'Gen2' } }),
    ];
    const g = buildGraph({ projects });
    expect(lineage(g, 'g3').map((n) => n.label)).toEqual(['Gen2', 'Gen1']);
  });

  it('nem-remix projektnek üres a lineage-e', () => {
    const { g } = buildScenario();
    expect(lineage(g, 'pA')).toEqual([]);
  });
});

describe('creativeGraph — descendants (általános BFS)', () => {
  it('a person „owns" leszármazottjai az összes birtokolt node', () => {
    const { g } = buildScenario();
    expect(descendants(g, 'person:u1', 'owns')).toHaveLength(5);
  });
});
