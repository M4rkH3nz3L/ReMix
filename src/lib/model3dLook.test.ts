import { createModel3DDoc, addMesh, addMeasurement } from '@/lib/model3dDoc';
import {
  bakeProcessedMesh,
  cutRange,
  displayBounds,
  hasRotation,
  lookOptionsJson,
  modelRotation,
  resetRotation,
  rotate90,
  simplifyCell,
} from '@/lib/model3dLook';
import type { Model3DDoc, Model3DMesh } from '@/types/model3d';

const mesh: Model3DMesh = {
  id: 'mesh1',
  assetId: 'a1',
  format: 'obj',
  triangles: 100,
  bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 2, y: 1, z: 1 } },
  textured: false,
};

function docWithMesh(): Model3DDoc {
  return addMesh(createModel3DDoc(), mesh, 'm').doc;
}

const close = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-6);

describe('model3dLook', () => {
  it('alapból nincs forgatás; a lookOptionsJson a natív formát adja', () => {
    const d = docWithMesh();
    expect(hasRotation(d)).toBe(false);
    const o = JSON.parse(lookOptionsJson(d));
    expect(o.rotation).toEqual([0, 0, 0, 1]);
    expect(o.preset).toBe(d.environment.preset);
    expect(o.exposure).toBe(d.environment.exposure);
  });

  it('rotate90: négyszer ugyanazon tengely körül = alaphelyzet; resetRotation visszaállít', () => {
    let d = docWithMesh();
    d = rotate90(d, 'x');
    expect(hasRotation(d)).toBe(true);
    d = rotate90(rotate90(rotate90(d, 'x'), 'x'), 'x');
    const q = modelRotation(d);
    close(Math.abs(q.w), 1);
    expect(hasRotation(resetRotation(rotate90(d, 'y')))).toBe(false);
  });

  it('displayBounds: 90° X körül a Y és Z mérete felcserélődik, a közép marad', () => {
    const d = rotate90(docWithMesh(), 'x');
    const b = displayBounds(mesh.bounds, modelRotation(d));
    close(b.max.y - b.min.y, 1);
    close(b.max.z - b.min.z, 1);
    close(b.max.x - b.min.x, 2);
    close((b.min.y + b.max.y) / 2, 0.5);
  });

  it('cutRange az alsó 40%; simplifyCell az átlóhoz arányos (erős > enyhe)', () => {
    const r = cutRange(mesh.bounds, { x: 0, y: 0, z: 0, w: 1 });
    close(r.min, 0);
    close(r.max, 0.4);
    expect(simplifyCell(mesh.bounds, 'strong')).toBeGreaterThan(simplifyCell(mesh.bounds, 'light'));
  });

  it('bakeProcessedMesh: a forgatás nullázódik, a mérési pontok a közép körül elfordulnak', () => {
    let d = docWithMesh();
    d = addMeasurement(d, { kind: 'distance', points: [{ x: 1, y: 1, z: 0.5 }, { x: 1, y: 0, z: 0.5 }] });
    d = rotate90(d, 'x');
    const baked = bakeProcessedMesh(d, mesh, modelRotation(d));
    expect(baked.nodes[0].transform.rotation).toEqual({ x: 0, y: 0, z: 0, w: 1 });
    // közép (1, 0.5, 0.5); +90° X körül: (y, z) → (−z, y) a középhez képest
    const [a] = baked.measurements[0].points;
    close(a.x, 1);
    close(a.y, 0.5);
    close(a.z, 1);
  });
});
