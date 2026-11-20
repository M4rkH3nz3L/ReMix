import type { TFunction } from 'i18next';
import { Alert } from 'react-native';

import { createModeActions, type ModeActionDeps } from '@/components/studio/image/body/modeActions';
import type { StudioModeState } from '@/components/studio/image/body/useStudioModeState';
import { logCaught } from '@/lib/logCaught';
import type { ImageDoc, ImageLayer } from '@/types/project';

jest.mock('@/lib/logCaught', () => ({ logCaught: jest.fn() }));

/**
 * 🎯 A precíziós módok be-/kilépése és lezárása (REFACTOR: az `ImageStudioBody`-ból kiemelve): a
 * dokumentum-írások undo-címkéi és a mód-váltások — a jelenlegi viselkedés rögzítve.
 */

const t = ((k: string) => k) as unknown as TFunction;
const paint = { kind: 'photo', id: 'pt', uri: 'file:///old.png', paint: true, position: { x: 0.5, y: 0.5 }, w: 1, h: 1 } as unknown as ImageLayer;
const doc: ImageDoc = { id: 'd', name: 'D', aspectRatio: '9:16', width: 1000, height: 2000, layers: [paint] } as ImageDoc;

function setup(over: Partial<ModeActionDeps> = {}, msOver: Record<string, unknown> = {}, brush?: { strokes: boolean; png: string | null }) {
  const fns: Record<string, jest.Mock> = {};
  const ms = new Proxy(msOver, {
    get(target, k: string) {
      if (k in target) return target[k];
      if (k.startsWith('set')) return (fns[k] ??= jest.fn());
      return null;
    },
  }) as unknown as StudioModeState;
  const brushRef = {
    current: brush ? { hasStrokes: () => brush.strokes, exportPng: jest.fn(() => brush.png) } : null,
  } as unknown as ModeActionDeps['brushRef'];
  const deps = {
    t,
    doc,
    commit: jest.fn(),
    captureCanvas: jest.fn(async () => 'file:///cap.png'),
    selectedId: null,
    setSelectedId: jest.fn(),
    setSheet: jest.fn(),
    brushRef,
    ms,
    ...over,
  } as unknown as ModeActionDeps;
  const f = new Proxy(fns, { get: (o, k: string) => (o[k] ??= jest.fn()) });
  return { deps, fns: f, api: createModeActions(deps), brushRef };
}
const commitOf = (deps: ModeActionDeps) => (deps.commit as jest.Mock).mock.calls;

beforeEach(() => jest.spyOn(Alert, 'alert').mockImplementation(() => {}));
afterEach(() => jest.restoreAllMocks());

describe('kivágás, toll, rács', () => {
  it('kivágás: van téglalap → „undoCrop”; a mód mindig bezárul', () => {
    const a = setup({}, { cropRect: { x: 0, y: 0, w: 0.5, h: 0.5 } });
    a.api.applyCrop();
    expect(commitOf(a.deps)[0][1]).toBe('studio.image.undoCrop');
    expect(a.fns.setCropRect).toHaveBeenCalledWith(null);
    const b = setup();
    b.api.applyCrop();
    expect(b.deps.commit).not.toHaveBeenCalled();
    expect(b.fns.setCropRect).toHaveBeenCalledWith(null);
  });
  it('toll: 2 pont alatt nincs réteg; egyébként forma-réteg „undoPen” + kijelölés', () => {
    const a = setup({}, { penPoints: [{ x: 0.1, y: 0.1 }] });
    a.api.commitPen(true);
    expect(a.deps.commit).not.toHaveBeenCalled();
    expect(a.fns.setPenPoints).toHaveBeenCalledWith(null);
    const b = setup({}, { penPoints: [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }, { x: 0.5, y: 0.9 }] });
    b.api.commitPen(true);
    const [next, label] = commitOf(b.deps)[0];
    expect(label).toBe('studio.image.undoPen');
    const added = next.layers[1];
    expect(added).toMatchObject({ kind: 'shape', shape: 'path', closed: true });
    expect(b.deps.setSelectedId).toHaveBeenCalledWith(added.id);
    expect(b.fns.setPenPoints).toHaveBeenCalledWith(null);
  });
  it('rács: az alapértékekre (kikapcsolt megjelenítés/snap) a meglévő, majd a patch kerül — „guides.grid”', () => {
    const a = setup({ doc: { ...doc, grid: { show: true } } as ImageDoc });
    a.api.updateGrid({ snap: true });
    const [next, label] = commitOf(a.deps)[0];
    expect(label).toBe('studio.image.guides.grid');
    expect(next.grid).toMatchObject({ show: true, snap: true });
    const b = setup({ doc: null });
    b.api.updateGrid({ snap: true });
    expect(b.deps.commit).not.toHaveBeenCalled();
  });
});

describe('ecset: lezárás és elvetés', () => {
  it('vonás nélkül csak kilép', () => {
    const a = setup({}, {}, { strokes: false, png: 'file:///x.png' });
    a.api.commitBrush();
    expect(a.deps.commit).not.toHaveBeenCalled();
    expect(a.fns.setBrushActive).toHaveBeenCalledWith(false);
  });
  it('festett maszk: a réteg maszkja lesz „undoMaskPaint”; PNG nélkül hiba-ablak', () => {
    const a = setup({}, { brushMaskMode: true, brushLayerId: 'pt' }, { strokes: true, png: 'file:///m.png' });
    a.api.commitBrush();
    expect(commitOf(a.deps)[0][1]).toBe('studio.image.undoMaskPaint');
    expect(commitOf(a.deps)[0][0].layers[0].mask).toBeDefined();
    expect(a.deps.setSelectedId).toHaveBeenCalledWith('pt');
    const b = setup({}, { brushMaskMode: true, brushLayerId: 'pt' }, { strokes: true, png: null });
    b.api.commitBrush();
    expect(b.deps.commit).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledWith('studio.image.wand.failTitle', 'studio.image.maskPaintFail');
    expect(b.deps.setSelectedId).toHaveBeenCalledWith('pt');
  });
  it('a meglévő festett réteg képe cserélődik; különben új festett réteg — „undoBrush”', () => {
    const a = setup({}, { brushLayerId: 'pt' }, { strokes: true, png: 'file:///new.png' });
    a.api.commitBrush();
    expect(commitOf(a.deps)[0][0].layers[0]).toMatchObject({ id: 'pt', uri: 'file:///new.png', paint: true });
    expect(commitOf(a.deps)[0][1]).toBe('studio.image.undoBrush');
    const b = setup({}, {}, { strokes: true, png: 'file:///new.png' });
    b.api.commitBrush();
    expect(commitOf(b.deps)[0][0].layers).toHaveLength(2);
    expect(commitOf(b.deps)[0][1]).toBe('studio.image.undoBrush');
    expect(b.fns.setBrushActive).toHaveBeenCalledWith(false);
    // a kért méret a vászoné
    expect((b.brushRef.current as unknown as { exportPng: jest.Mock }).exportPng).toHaveBeenCalledWith(1000, 2000);
  });
  it('elvetés: vonás nélkül azonnal; vonásokkal megerősítő ablak (a „confirm” zár)', () => {
    const a = setup({}, {}, { strokes: false, png: null });
    a.api.cancelBrush();
    expect(a.fns.setBrushActive).toHaveBeenCalledWith(false);
    const b = setup({}, {}, { strokes: true, png: null });
    b.api.cancelBrush();
    expect(b.fns.setBrushActive).not.toHaveBeenCalled();
    const buttons = (Alert.alert as jest.Mock).mock.calls[0][2];
    expect(buttons.map((x: { text: string }) => x.text)).toEqual(['common.cancel', 'studio.image.brushDiscard.confirm']);
    buttons[1].onPress();
    expect(b.fns.setBrushActive).toHaveBeenCalledWith(false);
  });
});

describe('kijelölés, lasszó, maszk-rajz', () => {
  it('kijelölő eszköz: a lasszó/pálca kapcsolója követi az eszközt', () => {
    const a = setup();
    a.api.openSelectTool('wand');
    expect(a.fns.setSelectTool).toHaveBeenCalledWith('wand');
    expect(a.fns.setLassoActive).toHaveBeenCalledWith(false);
    expect(a.fns.setWandActive).toHaveBeenCalledWith(true);
  });
  it('kijelölés indítása: a cél a kijelölt réteg, a többi mód bezárul; doc nélkül semmi', () => {
    const a = setup({ selectedId: 'pt' });
    a.api.startSelect('lasso');
    expect(a.fns.setSelectTargetId).toHaveBeenCalledWith('pt');
    expect(a.deps.setSheet).toHaveBeenCalledWith(null);
    expect(a.deps.setSelectedId).toHaveBeenCalledWith(null);
    expect(a.fns.setBrushActive).toHaveBeenCalledWith(false);
    expect(a.fns.setLassoActive).toHaveBeenCalledWith(true);
    const b = setup({ doc: null });
    b.api.startSelect('rect');
    expect(b.fns.setSelectTool).not.toHaveBeenCalled();
  });
  it('a kijelölés törlése az eszközt is bezárja; a lasszó-mégse a maszk-célt is törli', () => {
    const a = setup();
    a.api.clearSelection();
    expect(a.fns.setSelection).toHaveBeenCalledWith(null);
    expect(a.fns.setSelectTool).toHaveBeenCalledWith(null);
    a.api.cancelLasso();
    expect(a.fns.setMaskTarget).toHaveBeenCalledWith(null);
  });
  it('maszk-rajz: festett maszk → ecset a réteg maszkján; különben lasszó a célra (alap: clip)', () => {
    const a = setup();
    a.api.startMaskDraw('pt', 'paint');
    expect(a.fns.setBrushLayerId).toHaveBeenCalledWith('pt');
    expect(a.fns.setBrushMaskMode).toHaveBeenCalledWith(true);
    expect(a.fns.setBrushActive).toHaveBeenCalledWith(true);
    expect(a.fns.setMaskTarget).not.toHaveBeenCalled();
    const b = setup();
    b.api.startMaskDraw('pt');
    expect(b.fns.setMaskTarget).toHaveBeenCalledWith({ id: 'pt', target: 'clip' });
    expect(b.fns.setLassoActive).toHaveBeenCalledWith(true);
    expect(b.deps.setSelectedId).toHaveBeenCalledWith('pt');
  });
});

describe('retus', () => {
  it('foglalt állapotban nem indul', async () => {
    const a = setup({}, { busy: true });
    await a.api.startRetouch();
    expect(a.fns.setBusy).not.toHaveBeenCalled();
  });
  it('ha a Skia (lusta import) nem tölthető be: logCaught az eredeti címkével, hiba-ablak, a mód nem indul, a foglaltság visszaáll', async () => {
    // a jest-környezetben a dinamikus import nem fut — ez pont a „régi dev-kliens” ága
    const a = setup();
    await a.api.startRetouch();
    expect(logCaught).toHaveBeenCalledWith('components/studio/image/ImageStudioBody.tsx:startRetouch', expect.anything());
    expect(Alert.alert).toHaveBeenCalledWith('studio.image.wand.failTitle', 'studio.image.retouch.failBody');
    expect(a.fns.setBrushActive).not.toHaveBeenCalled();
    expect(a.fns.setBusy.mock.calls).toEqual([[true], [false]]);
  });
});
