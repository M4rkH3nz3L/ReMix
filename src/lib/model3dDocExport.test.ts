import { quatFromAxisAngle, vec3 } from '@/lib/model3d';
import {
  addAnnotation,
  addMeasurement,
  addMesh,
  createModel3DDoc,
  docStats,
  referencedAssetIds,
  removeNode,
  removeView,
  saveView,
  sceneBounds,
  setCapture,
  setEnvironment,
  setMaterial,
  setNodeFlags,
  setNodeTransform,
} from '@/lib/model3dDoc';
import { defaultOrbit } from '@/lib/model3dOrbit';
import {
  decimationRatio,
  EXPORT_FORMATS,
  exportFileName,
  exportWarnings,
  targetTriangles,
} from '@/lib/model3dExport';
import { floorPolygon, roomStats, shoelaceArea, summarizeRoom, type RawRoom } from '@/lib/roomPlanSummary';
import type { Model3DMesh } from '@/types/model3d';

const mesh = (id: string, triangles = 50_000): Model3DMesh => ({
  id,
  assetId: `ast_${id}`,
  format: 'usdz',
  triangles,
  bounds: { min: vec3(-0.1, 0, -0.1), max: vec3(0.1, 0.3, 0.1) },
  textured: true,
});

describe('model3dDoc', () => {
  it('háló + csomópont hozzáadása, statisztika, hivatkozott assetek', () => {
    const { doc, nodeId } = addMesh(createModel3DDoc(), mesh('m1'), 'Cipő');
    expect(doc.nodes[0]).toMatchObject({ id: nodeId, name: 'Cipő', visible: true, locked: false });
    expect(docStats(doc)).toMatchObject({ nodes: 1, triangles: 50_000 });
    expect(referencedAssetIds(doc)).toEqual(['ast_m1']);
  });

  it('zárolt csomópont nem mozdul; feloldva igen', () => {
    const { doc, nodeId } = addMesh(createModel3DDoc(), mesh('m1'), 'A');
    const locked = setNodeFlags(doc, nodeId, { locked: true });
    const moved = setNodeTransform(locked, nodeId, { position: vec3(1, 0, 0), rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: vec3(1, 1, 1) });
    expect(moved.nodes[0].transform.position.x).toBe(0);
    const unlocked = setNodeTransform(setNodeFlags(moved, nodeId, { locked: false }), nodeId, moved.nodes[0].transform);
    expect(unlocked.nodes[0].locked).toBe(false);
  });

  it('törlés: az árva háló és anyag is kiesik, a közös háló marad', () => {
    let d = createModel3DDoc();
    const a = addMesh(d, mesh('m1'), 'A');
    d = a.doc;
    const b = { ...d, nodes: [...d.nodes, { ...d.nodes[0], id: 'node_b', name: 'B' }] };
    const withMat = setMaterial(b, { nodeId: a.nodeId, tint: '#ff0000' });
    const r1 = removeNode(withMat, a.nodeId);
    expect(r1.meshes).toHaveLength(1);
    expect(r1.materials).toHaveLength(0);
    const r2 = removeNode(r1, 'node_b');
    expect(r2.meshes).toHaveLength(0);
    expect(referencedAssetIds(r2)).toEqual([]);
  });

  it('anyag és környezet: értékek korlátozva', () => {
    const d = setMaterial(createModel3DDoc(), { nodeId: 'n', roughness: 3, metallic: -1 });
    expect(d.materials[0]).toEqual({ nodeId: 'n', roughness: 1, metallic: 0 });
    expect(setEnvironment(createModel3DDoc(), { exposure: 9 }).environment.exposure).toBe(2);
  });

  it('nézet törlésekor a ráhivatkozó címke nézet nélkül marad', () => {
    const v = saveView(createModel3DDoc(), 'Elöl', defaultOrbit());
    const withNote = addAnnotation(v.doc, { at: vec3(), text: 'Talp', viewId: v.viewId });
    const r = removeView(withNote, v.viewId);
    expect(r.views).toHaveLength(0);
    expect(r.annotations[0].viewId).toBeUndefined();
  });

  it('jelenet-befoglaló: csak a látható csomópontok, transzformációval', () => {
    const { doc, nodeId } = addMesh(createModel3DDoc(), mesh('m1'), 'A');
    const rotated = setNodeTransform(doc, nodeId, { position: vec3(1, 0, 0), rotation: quatFromAxisAngle(vec3(0, 1, 0), 0), scale: vec3(2, 2, 2) });
    const b = sceneBounds(rotated)!;
    expect(b.max.y).toBeCloseTo(0.6);
    expect(b.min.x).toBeCloseTo(0.8);
    expect(sceneBounds(setNodeFlags(rotated, nodeId, { visible: false }))).toBeNull();
  });

  it('mérés hozzáadása; rögzítési haladás korlátozva', () => {
    const d = addMeasurement(createModel3DDoc({ mode: 'object', quality: 'medium', status: 'reconstructing', device: 'iPhone', startedAt: 'x' }), { kind: 'distance', points: [vec3(), vec3(1, 0, 0)] });
    expect(d.measurements[0].id).toMatch(/^meas/);
    expect(setCapture(d, { progress: 1.7 }).capture!.progress).toBe(1);
    expect(setCapture(createModel3DDoc(), { progress: 0.5 }).capture).toBeUndefined();
  });
});

describe('model3dExport', () => {
  it('helyi formátumok ingyenesek, a GLB felhős', () => {
    expect(EXPORT_FORMATS.usdz.local).toBe(true);
    expect(EXPORT_FORMATS.stl.local).toBe(true);
    expect(EXPORT_FORMATS.glb.local).toBe(false);
  });
  it('háromszög-keret felhasználás szerint, sosem több az eredetinél', () => {
    expect(targetTriangles(500_000, 'feed')).toBe(100_000);
    expect(targetTriangles(20_000, 'feed')).toBe(20_000);
    expect(targetTriangles(500_000, 'original')).toBe(500_000);
    expect(decimationRatio(200_000, 'feed')).toBeCloseTo(0.5);
    expect(decimationRatio(0, 'feed')).toBe(1);
  });
  it('figyelmeztetések: STL textúra nélkül, pontfelhő hálóba, túl nehéz nyomtatás', () => {
    expect(exportWarnings({ textured: true, triangles: 10 }, 'stl')).toContain('model3d.export.warnNoTexture');
    expect(exportWarnings({ textured: false, triangles: 10, points: 5000 }, 'usdz')).toContain('model3d.export.warnPointCloudToMesh');
    expect(exportWarnings({ textured: false, triangles: 2_000_000 }, 'stl')).toContain('model3d.export.warnHeavyPrint');
    expect(exportWarnings({ textured: true, triangles: 10 }, 'usdz')).toEqual([]);
  });
  it('biztonságos fájlnév, ékezettel', () => {
    expect(exportFileName('Cipő / bal: "teszt"', 'usdz')).toBe('Cipő bal teszt.usdz');
    expect(exportFileName('   ', 'stl')).toBe('model.stl');
  });
});

describe('roomPlanSummary', () => {
  const wall = (id: string, x: number, z: number, yaw: number, width: number) => ({
    id, width, height: 2.6, center: { x, y: 1.3, z }, yaw,
  });
  // 4×3 m-es szoba a (0,0) körül: falak a négy oldalon
  const room: RawRoom = {
    walls: [wall('n', 0, -1.5, 0, 4), wall('s', 0, 1.5, 0, 4), wall('e', 2, 0, Math.PI / 2, 3), wall('w', -2, 0, Math.PI / 2, 3)],
    doors: [{ id: 'd1', width: 0.9, height: 2.1, center: { x: 0, y: 1, z: 1.5 }, yaw: 0 }],
    windows: [],
    openings: [],
    objects: [{ id: 'o1', category: 'sofa', dimensions: { x: 2, y: 0.8, z: 0.9 } }],
  };
  it('shoelace', () => {
    expect(shoelaceArea([{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 3 }, { x: 0, z: 3 }])).toBeCloseTo(12);
    expect(shoelaceArea([{ x: 0, z: 0 }])).toBe(0);
  });
  it('alaprajz a falakból → 12 m²; falak, nyílások, objektumok, statisztika', () => {
    const s = summarizeRoom(room);
    expect(floorPolygon(room)).toHaveLength(4);
    expect(s.floorArea).toBeCloseTo(12, 1);
    expect(s.openings).toEqual([{ id: 'd1', kind: 'door', width: 0.9, height: 2.1 }]);
    expect(roomStats(s)).toEqual({ wallLength: 14, ceilingHeight: 2.6 });
  });
  it('ha a natív padló adott, azt használja', () => {
    const floor = [{ x: 0, z: 0 }, { x: 5, z: 0 }, { x: 5, z: 2 }, { x: 0, z: 2 }];
    expect(summarizeRoom({ ...room, floor }).floorArea).toBeCloseTo(10);
  });
});
