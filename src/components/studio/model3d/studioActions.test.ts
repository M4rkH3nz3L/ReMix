/**
 * 🧊 A 3D Stúdió hook nélküli akció-gyárai (REFACTOR: capture/, processing/, export/): a natív
 * rögzítés vezérlése, a fázis-váltások, a tárolási formátum command-busa és az export-őrök.
 */
import { Alert } from 'react-native';

import { createCaptureActions } from '@/components/studio/model3d/capture/captureActions';
import { createExportActions } from '@/components/studio/model3d/export/exportActions';
import { createModelProcessActions } from '@/components/studio/model3d/processing/modelProcessActions';
import { useEditorStore } from '@/store/editorStore';

jest.mock('expo-file-system', () => ({
  Directory: class {
    uri: string;
    constructor(base: { uri: string }, name: string) {
      this.uri = `${base.uri}${name}`;
    }
    delete() {
      throw new Error('nincs');
    }
  },
  File: class {
    uri: string;
    constructor(base: { uri: string }, name: string) {
      this.uri = `${base.uri}${name}`;
    }
  },
  Paths: { cache: { uri: 'file:///cache/' }, document: { uri: 'file:///doc/' } },
}));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/design', () => ({ haptics: { success: jest.fn(), selection: jest.fn() } }));
jest.mock('@/lib/logCaught', () => ({ logCaught: jest.fn() }));
jest.mock('@/lib/id', () => ({ makeId: (p: string) => `${p}_1` }));
jest.mock('@/lib/remix3dNative', () => ({
  Remix3D: null,
  remix3dErrorKey: jest.requireActual('@/lib/remix3dNative').remix3dErrorKey,
}));

const t = ((k: string) => k) as never;
const asset = { id: 'ast_a', kind: 'model', uri: 'file:///doc/media/m3d_ast_a.usdz', provider: 'local', name: 'A' } as never;

function captureDeps(over: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const rec = (name: string) => (v?: unknown) => void calls.push(`${name}:${JSON.stringify(v)}`);
  const command = jest.fn(async (n: string) => {
    calls.push(`command:${n}`);
    return true;
  });
  const deps = {
    t,
    projectId: 'p1',
    asset: undefined,
    capState: { state: 'ready', feedback: [] },
    captureRef: { current: { start: jest.fn(async () => undefined), command } },
    meshRef: { current: { pause: jest.fn(async () => calls.push('pause')) } },
    roomRef: { current: { cancel: jest.fn(async () => calls.push('cancel')) } },
    scanStartedAt: { current: 'x' },
    setPhase: rec('phase'),
    setPicking: rec('picking'),
    setScanMode: rec('scanMode'),
    setScanState: rec('scanState'),
    setCapState: rec('capState'),
    reconstruct: jest.fn(async () => void calls.push('reconstruct')),
    ...over,
  };
  return { deps: deps as never as Parameters<typeof createCaptureActions>[0], calls, command };
}

describe('3D Stúdió — rögzítés akciói', () => {
  it('a fő gomb állapotonként a megfelelő natív parancsot küldi (egyébként semmit)', () => {
    for (const [state, cmd] of [['ready', 'detect'], ['detecting', 'capture'], ['capturing', 'finish'], ['finishing', null]] as const) {
      const { deps, command } = captureDeps({ capState: { state, feedback: [] } });
      createCaptureActions(deps).primaryAction();
      expect(command.mock.calls.map((c) => c[0])).toEqual(cmd ? [cmd] : []);
    }
  });

  it('a kész rögzítés („completed”) indítja a rekonstrukciót, más állapot csak eltárolódik', () => {
    const { deps, calls } = captureDeps();
    const a = createCaptureActions(deps);
    a.onCaptureState({ state: 'capturing', feedback: [] });
    a.onCaptureState({ state: 'completed', feedback: [] });
    expect(calls).toEqual(['capState:{"state":"capturing","feedback":[]}', 'capState:{"state":"completed","feedback":[]}', 'reconstruct']);
  });

  it('a szoba- és hálós szken megszakítása modell nélkül a módválasztóra, modellel a nézőbe visz', () => {
    const empty = captureDeps();
    createCaptureActions(empty.deps).cancelRoomScan();
    createCaptureActions(empty.deps).cancelMeshScan();
    expect(empty.calls).toEqual(['cancel', 'phase:"empty"', 'pause', 'phase:"empty"']);
    const withModel = captureDeps({ asset });
    createCaptureActions(withModel.deps).cancelRoomScan();
    expect(withModel.calls).toEqual(['cancel', 'phase:"viewer"']);
  });

  it('a rögzítés elvetésének megerősítése: megtartás (cancel) + elvetés (destructive)', () => {
    const spy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { deps } = captureDeps();
    createCaptureActions(deps).confirmCancel();
    const buttons = spy.mock.calls[0][2]!;
    expect(spy.mock.calls[0].slice(0, 2)).toEqual(['model3d.capture.cancelTitle', 'model3d.capture.cancelBody']);
    expect(buttons.map((b) => [b.text, b.style])).toEqual([
      ['model3d.capture.keep', 'cancel'],
      ['model3d.capture.discard', 'destructive'],
    ]);
    spy.mockRestore();
  });
});

describe('3D Stúdió — feldolgozás és export őrei', () => {
  it('natív modul nélkül a tárolási formátum csak beállítás: egy SET_MODEL3D_DOC a command buson', async () => {
    const dispatch = jest.fn();
    useEditorStore.setState({ dispatch } as never);
    const doc = { id: 'd', meshes: [], storageFormat: 'usdz' } as never;
    const mesh = { id: 'm', assetId: 'ast_a', format: 'usdz', triangles: 1, bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } }, textured: true } as never;
    await createModelProcessActions({ t, projectId: 'p1', project: { id: 'p1', name: 'P' } as never, doc, mesh, asset }).changeStorageFormat('glb');
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_MODEL3D_DOC', doc: { id: 'd', meshes: [], storageFormat: 'glb' }, label: 'model3d.storage.title' }, 'user');
  });

  it('natív modul nélkül az AR „új build kell” üzenetet ad; látható néző nélkül a nézet-kép dob', async () => {
    const spy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const a = createExportActions({ t, project: null, doc: undefined, mesh: undefined, asset, viewRef: { current: null } });
    await a.openAR();
    expect(spy).toHaveBeenCalledWith('model3d.ar.title', 'model3d.error.needsNewBuild');
    await expect(a.snapshotCurrentView()).rejects.toThrow('model3d.error.unsupported');
    await a.exportFloorPlan();
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
