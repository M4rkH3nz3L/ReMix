import {
  activeScene,
  addDestination,
  addScene,
  addSource,
  createLiveDoc,
  defaultTransformFor,
  enabledExternalDestinations,
  newSource,
  removeDestination,
  removeScene,
  removeSource,
  renameScene,
  reorderSource,
  setActiveScene,
  setTitle,
  setVisibility,
  sortedSources,
  toggleDestination,
  toggleSourceVisible,
  updateSource,
  type GenId,
} from '@/lib/liveDoc';
import { applyCommand } from '@/lib/commands';
import { createEmptyProject } from '@/lib/projectUtils';

/** determinisztikus id-generátor a tesztekhez. */
function idGen(): GenId {
  let n = 0;
  return () => `id_${++n}`;
}

describe('liveDoc — createLiveDoc', () => {
  it('egy Main jelenetet ad teljes-vászon kamerával + aktív ReMix-céllal', () => {
    const g = idGen();
    const doc = createLiveDoc('Esti adás', g);
    expect(doc.title).toBe('Esti adás');
    expect(doc.visibility).toBe('public');
    expect(doc.scenes).toHaveLength(1);
    expect(doc.activeSceneId).toBe(doc.scenes[0].id);
    const scene = doc.scenes[0];
    expect(scene.name).toBe('Main');
    expect(scene.sources).toHaveLength(1);
    expect(scene.sources[0].kind).toBe('camera');
    expect(scene.sources[0].transform).toMatchObject({ x: 0, y: 0, w: 1, h: 1 });
    expect(doc.destinations).toHaveLength(1);
    expect(doc.destinations[0]).toMatchObject({ platform: 'remix', enabled: true });
  });

  it('üres címből „Live" lesz', () => {
    expect(createLiveDoc('   ', idGen()).title).toBe('Live');
  });
});

describe('liveDoc — jelenetek', () => {
  it('addScene hozzáad, az aktív marad', () => {
    const g = idGen();
    let doc = createLiveDoc('x', g);
    const firstActive = doc.activeSceneId;
    doc = addScene(doc, 'Intro', g);
    expect(doc.scenes).toHaveLength(2);
    expect(doc.scenes[1].name).toBe('Intro');
    expect(doc.activeSceneId).toBe(firstActive);
  });

  it('removeScene az utolsót nem törli', () => {
    const g = idGen();
    const doc = createLiveDoc('x', g);
    expect(removeScene(doc, doc.scenes[0].id)).toBe(doc);
  });

  it('removeScene az aktívat törölve másikra vált', () => {
    const g = idGen();
    let doc = createLiveDoc('x', g);
    doc = addScene(doc, 'Intro', g);
    const first = doc.scenes[0].id;
    const second = doc.scenes[1].id;
    doc = setActiveScene(doc, second);
    doc = removeScene(doc, second);
    expect(doc.scenes).toHaveLength(1);
    expect(doc.activeSceneId).toBe(first);
  });

  it('renameScene trimmel, üresre nem vált', () => {
    const g = idGen();
    const doc = createLiveDoc('x', g);
    expect(renameScene(doc, doc.scenes[0].id, '  Kezdő  ').scenes[0].name).toBe('Kezdő');
    expect(renameScene(doc, doc.scenes[0].id, '   ')).toBe(doc);
  });

  it('setActiveScene ismeretlenre / ugyanarra no-op (ref azonos)', () => {
    const g = idGen();
    const doc = createLiveDoc('x', g);
    expect(setActiveScene(doc, 'nincs')).toBe(doc);
    expect(setActiveScene(doc, doc.activeSceneId)).toBe(doc);
  });
});

describe('liveDoc — források', () => {
  it('addSource a tetejére kerül (z = max+1), defaultTransform a fajtából', () => {
    const g = idGen();
    let doc = createLiveDoc('x', g); // camera z=0
    const sceneId = doc.scenes[0].id;
    doc = addSource(doc, sceneId, 'logo', g, { label: 'Logó' });
    const scene = activeScene(doc)!;
    expect(scene.sources).toHaveLength(2);
    const logo = scene.sources[1];
    expect(logo.kind).toBe('logo');
    expect(logo.transform.z).toBe(1);
    expect(logo.transform).toMatchObject(defaultTransformFor('logo', 1));
    expect(logo.label).toBe('Logó');
  });

  it('updateSource transform-patch klampol 0–1-re, méret pozitív', () => {
    const g = idGen();
    let doc = createLiveDoc('x', g);
    const sceneId = doc.scenes[0].id;
    const camId = doc.scenes[0].sources[0].id;
    doc = updateSource(doc, sceneId, camId, { transform: { x: -0.5, w: 2, h: 0 } });
    const t = doc.scenes[0].sources[0].transform;
    expect(t.x).toBe(0);
    expect(t.w).toBe(1);
    expect(t.h).toBe(0.01);
  });

  it('toggleSourceVisible átváltja a láthatóságot', () => {
    const g = idGen();
    let doc = createLiveDoc('x', g);
    const sceneId = doc.scenes[0].id;
    const camId = doc.scenes[0].sources[0].id;
    expect(doc.scenes[0].sources[0].visible).toBe(true);
    doc = toggleSourceVisible(doc, sceneId, camId);
    expect(doc.scenes[0].sources[0].visible).toBe(false);
  });

  it('removeSource kiveszi a forrást', () => {
    const g = idGen();
    let doc = createLiveDoc('x', g);
    const sceneId = doc.scenes[0].id;
    const camId = doc.scenes[0].sources[0].id;
    doc = removeSource(doc, sceneId, camId);
    expect(doc.scenes[0].sources).toHaveLength(0);
  });

  it('reorderSource front/back újra-sorszámozza a z-t', () => {
    const g = idGen();
    let doc = createLiveDoc('x', g); // cam z=0
    const sceneId = doc.scenes[0].id;
    doc = addSource(doc, sceneId, 'logo', g); // z=1
    doc = addSource(doc, sceneId, 'text', g); // z=2
    const camId = doc.scenes[0].sources[0].id;
    // a kamerát előre → z a legnagyobb lesz
    doc = reorderSource(doc, sceneId, camId, 'front');
    const ordered = sortedSources(doc.scenes[0]);
    expect(ordered[ordered.length - 1].id).toBe(camId);
    expect(ordered.map((s) => s.transform.z)).toEqual([0, 1, 2]);
  });
});

describe('liveDoc — célok', () => {
  it('addDestination külső célt ad (alapból letiltva)', () => {
    const g = idGen();
    let doc = createLiveDoc('x', g);
    doc = addDestination(doc, 'youtube', 'YouTube', g);
    expect(doc.destinations).toHaveLength(2);
    expect(doc.destinations[1]).toMatchObject({ platform: 'youtube', enabled: false });
  });

  it('a ReMix-cél nem törölhető, külső igen', () => {
    const g = idGen();
    let doc = createLiveDoc('x', g);
    const remixId = doc.destinations[0].id;
    doc = addDestination(doc, 'twitch', 'Twitch', g);
    const twitchId = doc.destinations[1].id;
    expect(removeDestination(doc, remixId)).toBe(doc); // védett
    doc = removeDestination(doc, twitchId);
    expect(doc.destinations).toHaveLength(1);
  });

  it('toggleDestination + enabledExternalDestinations', () => {
    const g = idGen();
    let doc = createLiveDoc('x', g);
    doc = addDestination(doc, 'youtube', 'YouTube', g);
    const ytId = doc.destinations[1].id;
    expect(enabledExternalDestinations(doc)).toHaveLength(0);
    doc = toggleDestination(doc, ytId, true);
    expect(enabledExternalDestinations(doc).map((d) => d.platform)).toEqual(['youtube']);
    // a ReMix nem külső, hiába enabled
    expect(enabledExternalDestinations(doc).some((d) => d.platform === 'remix')).toBe(false);
  });
});

describe('liveDoc — meta', () => {
  it('setTitle trimmel, üres/azonos no-op', () => {
    const doc = createLiveDoc('x', idGen());
    expect(setTitle(doc, '  Új  ').title).toBe('Új');
    expect(setTitle(doc, '   ')).toBe(doc);
    expect(setTitle(doc, 'x')).toBe(doc);
  });

  it('setVisibility vált, azonos no-op', () => {
    const doc = createLiveDoc('x', idGen());
    expect(setVisibility(doc, 'followers').visibility).toBe('followers');
    expect(setVisibility(doc, 'public')).toBe(doc);
  });
});

describe('liveDoc — newSource factory', () => {
  it('kamera/képernyő teljes vászon, logó sarok', () => {
    const g = idGen();
    expect(newSource('camera', g).transform).toMatchObject({ x: 0, y: 0, w: 1, h: 1 });
    expect(newSource('screen', g).transform).toMatchObject({ x: 0, y: 0, w: 1, h: 1 });
    const logo = newSource('logo', g);
    expect(logo.transform.x).toBeGreaterThan(0.5);
    expect(logo.transform.w).toBeLessThan(0.5);
  });
});

describe('liveDoc — SET_LIVE_DOC command + kind:live projekt', () => {
  it('kind:live projekt kiinduló live-docot kap', () => {
    const p = createEmptyProject('Élő', '16:9', undefined, 'live');
    expect(p.kind).toBe('live');
    expect(p.live).toBeDefined();
    expect(p.live!.scenes).toHaveLength(1);
    expect(p.live!.destinations[0].platform).toBe('remix');
  });

  it('SET_LIVE_DOC beírja a project.live-ba, azonos doc → no-op (null)', () => {
    const p = createEmptyProject('Élő', '16:9', undefined, 'live');
    const doc = addScene(p.live!, 'Intro', idGen());
    const next = applyCommand(p, { type: 'SET_LIVE_DOC', doc });
    expect(next).not.toBeNull();
    expect(next!.live!.scenes).toHaveLength(2);
    expect(applyCommand(next!, { type: 'SET_LIVE_DOC', doc })).toBeNull();
  });

  it('nem-live projekt is kaphat live-docot a paranccsal (additív)', () => {
    const p = createEmptyProject('Videó', '16:9', undefined, 'video');
    expect(p.live).toBeUndefined();
    const doc = createLiveDoc('x', idGen());
    const next = applyCommand(p, { type: 'SET_LIVE_DOC', doc });
    expect(next!.live).toEqual(doc);
  });
});
