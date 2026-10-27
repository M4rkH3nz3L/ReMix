import { vec3, withUniformScale } from '@/lib/model3d';
import { addMesh, createModel3DDoc, setNodeTransform } from '@/lib/model3dDoc';
import { useEditorStore } from '@/store/editorStore';
import type { Project } from '@/types/project';

/** 🧊 SET_MODEL3D_DOC a valódi store-on: undo, no-op, és a húzás egy lépés */

function makeProject(): Project {
  return {
    id: 'p3d', name: '3D', aspectRatio: '1:1', fps: 30, kind: 'model3d',
    tracks: [], assets: [],
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    schemaVersion: 6,
  };
}

const store = () => useEditorStore.getState();
let now = 5_000_000;
beforeEach(() => {
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  store().loadProject(makeProject());
});
afterEach(() => {
  jest.restoreAllMocks();
  store().closeProject();
});

const base = () =>
  addMesh(createModel3DDoc(), {
    id: 'm1', assetId: 'a1', format: 'usdz', triangles: 1000,
    bounds: { min: vec3(), max: vec3(1, 1, 1) }, textured: true,
  }, 'Tárgy');

describe('SET_MODEL3D_DOC', () => {
  it('beírja a dokumentumot, undo-zható, az azonos dokumentum no-op', () => {
    const { doc } = base();
    expect(store().dispatch({ type: 'SET_MODEL3D_DOC', doc })).toBe(true);
    expect(store().project?.model3d?.nodes).toHaveLength(1);
    expect(store().dispatch({ type: 'SET_MODEL3D_DOC', doc })).toBe(false);
    store().undo();
    expect(store().project?.model3d).toBeUndefined();
  });

  it('egy méretezés-húzás (azonos címke, gyors egymásután) = egy undo-lépés', () => {
    const { doc, nodeId } = base();
    store().dispatch({ type: 'SET_MODEL3D_DOC', doc });
    now += 2000;
    let d = doc;
    for (const k of [1.1, 1.2, 1.3, 1.4]) {
      d = setNodeTransform(d, nodeId, withUniformScale(d.nodes[0].transform, k));
      store().dispatch({ type: 'SET_MODEL3D_DOC', doc: d, label: 'Méret' });
      now += 16;
    }
    expect(store().past).toHaveLength(2);
    store().undo();
    expect(store().project?.model3d?.nodes[0].transform.scale.x).toBe(1);
  });
});
