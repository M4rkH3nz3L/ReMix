import type { TFunction } from 'i18next';

import { createToolDispatch, type ToolDispatchDeps } from '@/components/studio/image/body/toolDispatch';
import type { StudioModeState } from '@/components/studio/image/body/useStudioModeState';
import { haptics } from '@/design';
import type { ImageDoc, ImageLayer } from '@/types/project';

// a design-réteg haptikája (Reanimated) — itt csak a hívás számít
jest.mock('@/design', () => ({ haptics: { selection: jest.fn(), impact: jest.fn() } }));

/**
 * 🧰 A Kép Stúdió szerszám-útválasztása (REFACTOR: az `ImageStudioBody`-ból kiemelve): melyik szerszám
 * milyen dokumentum-írást (`commit` + undo-címke) vagy mód-váltást indít — a jelenlegi viselkedés rögzítve.
 */

const t = ((k: string) => k) as unknown as TFunction;
const photo = { kind: 'photo', id: 'f', uri: 'file:///a.png', position: { x: 0.5, y: 0.5 }, w: 0.5, h: 0.5 } as unknown as ImageLayer;
const shape = { kind: 'shape', id: 's', shape: 'rectangle', position: { x: 0.5, y: 0.5 }, w: 0.4, h: 0.2, rotation: 270 } as unknown as ImageLayer;
const fill = { kind: 'fill', id: 'bg', color: '#000' } as unknown as ImageLayer;
const doc: ImageDoc = { id: 'd', name: 'D', aspectRatio: '9:16', width: 1080, height: 1920, layers: [fill, photo, shape] } as ImageDoc;

/** módállapot-hamisítvány: minden `set*` egy jest.fn, a többi érték a felülírásból (különben null) */
function fakeMs(over: Record<string, unknown> = {}) {
  const fns: Record<string, jest.Mock> = {};
  const ms = new Proxy(over, {
    get(target, k: string) {
      if (k in target) return target[k];
      if (k.startsWith('set')) return (fns[k] ??= jest.fn());
      return null;
    },
  }) as unknown as StudioModeState;
  return { ms, fns: new Proxy(fns, { get: (f, k: string) => (f[k] ??= jest.fn()) }) };
}

function setup(over: Partial<ToolDispatchDeps> = {}, msOver: Record<string, unknown> = {}) {
  const { ms, fns } = fakeMs(msOver);
  const deps = {
    t,
    doc,
    selectedId: null,
    selectedLayer: null,
    commit: jest.fn(),
    setSheet: jest.fn(),
    setSelectedId: jest.fn(),
    ms,
    precisionMode: false,
    add: jest.fn(),
    fillPlaceholder: jest.fn(),
    startSelect: jest.fn(),
    startRetouch: jest.fn(async () => {}),
    pathOperation: jest.fn(async () => {}),
    removeBackground: jest.fn(async () => {}),
    exportPart: jest.fn(async () => {}),
    importImageFile: jest.fn(async () => {}),
    importSvg: jest.fn(async () => {}),
    importPsdDoc: jest.fn(async () => {}),
    importPdfDocs: jest.fn(async () => {}),
    ...over,
  } as unknown as ToolDispatchDeps;
  return { deps, fns, api: createToolDispatch(deps) };
}

const layerOf = (d: ImageDoc, id: string) => d.layers.find((l) => l.id === id) as unknown as Record<string, unknown>;

describe('onTool — dokumentum-írások (commit + undo-címke)', () => {
  it('doc nélkül semmi nem történik', () => {
    const { deps, api } = setup({ doc: null, selectedLayer: shape });
    api.onTool('delete');
    api.onTool('templates');
    expect(deps.commit).not.toHaveBeenCalled();
    expect(deps.setSheet).not.toHaveBeenCalled();
  });
  it('forgatás: +90° modulo 360, „undoRotate” címkével; kitöltésre nem hat', () => {
    const { deps, api } = setup({ selectedLayer: shape });
    api.onTool('rotate');
    const [next, label] = (deps.commit as jest.Mock).mock.calls[0];
    expect(layerOf(next, 's').rotation).toBe(0);
    expect(label).toBe('studio.image.undoRotate');
    const f = setup({ selectedLayer: fill });
    f.api.onTool('rotate');
    f.api.onTool('flipH');
    expect(f.deps.commit).not.toHaveBeenCalled();
  });
  it('tükrözés vízszintesen / függőlegesen: „undoFlip”', () => {
    const { deps, api } = setup({ selectedLayer: photo });
    api.onTool('flipH');
    api.onTool('flipV');
    const calls = (deps.commit as jest.Mock).mock.calls;
    expect(layerOf(calls[0][0], 'f').flipH).toBe(true);
    expect(layerOf(calls[1][0], 'f').flipV).toBe(true);
    expect(calls.map((c) => c[1])).toEqual(['studio.image.undoFlip', 'studio.image.undoFlip']);
  });
  it('sorrend előre / hátra: „undoOrder”', () => {
    const { deps, api } = setup({ selectedLayer: photo });
    api.onTool('forward');
    api.onTool('back');
    const calls = (deps.commit as jest.Mock).mock.calls;
    expect(calls[0][0].layers.map((l: ImageLayer) => l.id)).toEqual(['bg', 's', 'f']);
    expect(calls[1][0].layers.map((l: ImageLayer) => l.id)).toEqual(['f', 'bg', 's']);
    expect(calls.map((c) => c[1])).toEqual(['studio.image.undoOrder', 'studio.image.undoOrder']);
  });
  it('duplikálás, zár, törlés — a törlés a kijelölést is üríti', () => {
    const { deps, api } = setup({ selectedLayer: photo });
    api.onTool('duplicate');
    api.onTool('unlock');
    api.onTool('delete');
    const calls = (deps.commit as jest.Mock).mock.calls;
    expect(calls.map((c) => c[1])).toEqual(['studio.image.undoDuplicate', 'studio.image.undoLock', 'studio.image.undoDelete']);
    expect(calls[0][0].layers).toHaveLength(4);
    expect(layerOf(calls[1][0], 'f').locked).toBe(true);
    expect(calls[2][0].layers.map((l: ImageLayer) => l.id)).toEqual(['bg', 's']);
    expect(deps.setSelectedId).toHaveBeenCalledWith(null);
  });
  it('kijelölt réteg nélkül a réteg-műveletek nem írnak', () => {
    const { deps, api } = setup();
    for (const k of ['duplicate', 'unlock', 'delete', 'forward', 'back', 'rotate', 'flipH', 'flipV', 'toPath', 'exportLayer'] as const) {
      api.onTool(k);
    }
    expect(deps.commit).not.toHaveBeenCalled();
    expect(deps.exportPart).not.toHaveBeenCalled();
  });
  it('forma → path: zárt path, a sarok-sugár törölve, „imageTools.toPath” címke', () => {
    const { deps, api } = setup({ selectedLayer: shape });
    api.onTool('toPath');
    const [next, label] = (deps.commit as jest.Mock).mock.calls[0];
    expect(layerOf(next, 's')).toMatchObject({ shape: 'path', closed: true, cornerRadius: undefined });
    expect(layerOf(next, 's').points).toEqual([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]);
    expect(label).toBe('studio.imageTools.toPath');
  });
  it('forma → path: ha a formának nincs pont-alakja (már path), nincs írás', () => {
    const p = { ...shape, shape: 'path', points: [] } as unknown as ImageLayer;
    const { deps, api } = setup({ selectedLayer: p });
    api.onTool('toPath');
    expect(deps.commit).not.toHaveBeenCalled();
  });
});

describe('onTool — lapok, módok, delegált műveletek', () => {
  it.each([
    ['templates', 'templates'],
    ['size', 'canvas'],
    ['import', 'import'],
    ['source', 'source'],
    ['shape', 'shapePicker'],
    ['style', 'style'],
    ['develop', 'develop'],
    ['fx', 'fx'],
    ['pattern', 'pattern'],
    ['align', 'align'],
    ['boolean', 'boolean'],
  ] as const)('%s → a(z) %s lap nyílik', (tool, sheet) => {
    const { deps, api } = setup();
    api.onTool(tool);
    expect(deps.setSheet).toHaveBeenCalledWith(sheet);
  });
  it.each([
    ['addFill', 'fill'],
    ['addAdjust', 'adjust'],
    ['photo', 'photo'],
    ['text', 'text'],
  ] as const)('%s → új %s réteg', (tool, kind) => {
    const { deps, api } = setup();
    api.onTool(tool);
    expect(deps.add).toHaveBeenCalledWith(kind);
  });
  it.each([
    ['marquee', 'rect'],
    ['lasso', 'lasso'],
    ['wand', 'wand'],
  ] as const)('%s → kijelölés indul (%s)', (tool, sel) => {
    const { deps, api } = setup();
    api.onTool(tool);
    expect(deps.startSelect).toHaveBeenCalledWith(sel);
  });
  it.each([
    ['file', 'importImageFile'],
    ['svg', 'importSvg'],
    ['psd', 'importPsdDoc'],
    ['pdf', 'importPdfDocs'],
    ['retouch', 'startRetouch'],
  ] as const)('%s → %s', (tool, fn) => {
    const { deps, api } = setup();
    api.onTool(tool);
    expect(deps[fn]).toHaveBeenCalledTimes(1);
  });
  it('kivágás: induló, behúzott téglalap; a lap, a kijelölés és a vonalzó bezárva', () => {
    const { deps, fns, api } = setup({ selectedLayer: photo });
    api.onTool('crop');
    expect(fns.setCropRect).toHaveBeenCalledWith({ x: 0.05, y: 0.05, w: 0.9, h: 0.9 });
    expect(deps.setSheet).toHaveBeenCalledWith(null);
    expect(deps.setSelectedId).toHaveBeenCalledWith(null);
    expect(fns.setGuidesActive).toHaveBeenCalledWith(false);
  });
  it('vonalzó: kapcsoló (frissítő függvény), a többi mód bezárva', () => {
    const { fns, api } = setup();
    api.onTool('guides');
    const toggle = fns.setGuidesActive.mock.calls[0][0] as (v: boolean) => boolean;
    expect([toggle(false), toggle(true)]).toEqual([true, false]);
    expect(fns.setBrushActive).toHaveBeenCalledWith(false);
    expect(fns.setPenPoints).toHaveBeenCalledWith(null);
  });
  it('toll: üres pontlista indul, a kijelölés és a node-szerkesztés bezárva', () => {
    const { deps, fns, api } = setup();
    api.onTool('pen');
    expect(fns.setPenPoints).toHaveBeenCalledWith([]);
    expect(fns.setPathEditId).toHaveBeenCalledWith(null);
    expect(deps.setSelectedId).toHaveBeenCalledWith(null);
  });
  it('pontok szerkesztése: a kijelölt réteg, az első gyűrű, node nélkül', () => {
    const { fns, api } = setup({ selectedLayer: shape });
    api.onTool('editPath');
    expect(fns.setPathEditId).toHaveBeenCalledWith('s');
    expect(fns.setPathEditRing).toHaveBeenCalledWith(0);
    expect(fns.setPathEditNode).toHaveBeenCalledWith(null);
  });
  it('gyors korrekció és asszisztens: a lap bezárul', () => {
    const { deps, fns, api } = setup();
    api.onTool('adjust');
    api.onTool('assistant');
    expect(fns.setQuickAdjust).toHaveBeenCalledWith(true);
    expect(fns.setAssistantOpen).toHaveBeenCalledWith(true);
    expect(deps.setSheet).toHaveBeenCalledWith(null);
  });
  it('pixel: a pixel-munkás fotó-réteget folytatja, máskülönben új munka', () => {
    const art = { ...photo, id: 'px', pixelArt: { width: 8, height: 8 } } as unknown as ImageLayer;
    const d = { ...doc, layers: [...doc.layers, art] };
    const a = setup({ doc: d, selectedId: 'px' });
    a.api.onTool('pixel');
    expect(a.fns.setPixelLayerId).toHaveBeenCalledWith('px');
    expect(a.fns.setPixelOpen).toHaveBeenCalledWith(true);
    const b = setup({ doc: d, selectedId: 'f' });
    b.api.onTool('pixel');
    expect(b.fns.setPixelLayerId).toHaveBeenCalledWith(null);
  });
  it('sarokpontok csak fotón; háttér-eltávolítás csak fotón; útvonal-művelet csak formán', () => {
    const p = setup({ selectedLayer: photo });
    p.api.onTool('cornerPin');
    p.api.onTool('bgRemove');
    p.api.onTool('outlineStroke');
    expect(p.fns.setCornerPinId).toHaveBeenCalledWith('f');
    expect(p.deps.removeBackground).toHaveBeenCalledWith(photo);
    expect(p.deps.pathOperation).not.toHaveBeenCalled();
    const s = setup({ selectedLayer: shape });
    s.api.onTool('offsetIn');
    s.api.onTool('cornerPin');
    s.api.onTool('bgRemove');
    expect(s.deps.pathOperation).toHaveBeenCalledWith(shape, 'offsetIn');
    expect(s.fns.setCornerPinId).not.toHaveBeenCalled();
    expect(s.deps.removeBackground).not.toHaveBeenCalled();
  });
  it('réteg exportja: csak a kijelölt réteg dokumentuma', () => {
    const { deps, api } = setup({ selectedLayer: photo });
    api.onTool('exportLayer');
    const part = (deps.exportPart as jest.Mock).mock.calls[0][0] as ImageDoc;
    expect(part.layers.map((l) => l.id)).toEqual(['f']);
  });
});

describe('vászon, hosszú nyomás, réteg-menü, asszisztens', () => {
  it('hosszú nyomás: haptika + kijelölés + réteg-menü; precíziós vagy többes módban semmi', () => {
    const a = setup();
    a.api.onLayerLongPress('f');
    expect(haptics.impact).toHaveBeenCalled();
    expect(a.deps.setSelectedId).toHaveBeenCalledWith('f');
    expect(a.deps.setSheet).toHaveBeenCalledWith('layerMenu');
    const b = setup({ precisionMode: true });
    b.api.onLayerLongPress('f');
    const c = setup({}, { multiIds: [] });
    c.api.onLayerLongPress('f');
    expect(b.deps.setSheet).not.toHaveBeenCalled();
    expect(c.deps.setSheet).not.toHaveBeenCalled();
  });
  it('koppintás: kijelöl; a zárolatlan helyőrzőn a galéria nyílik; többes módban gyűjt', () => {
    const ph = { ...photo, id: 'ph', placeholder: true } as unknown as ImageLayer;
    const locked = { ...photo, id: 'lk', placeholder: true, locked: true } as unknown as ImageLayer;
    const d = { ...doc, layers: [...doc.layers, ph, locked] };
    const a = setup({ doc: d });
    a.api.onCanvasSelect('ph');
    a.api.onCanvasSelect('lk');
    a.api.onCanvasSelect(null);
    expect(a.deps.fillPlaceholder).toHaveBeenCalledTimes(1);
    expect(a.deps.fillPlaceholder).toHaveBeenCalledWith('ph');
    expect((a.deps.setSelectedId as jest.Mock).mock.calls).toEqual([['ph'], ['lk'], [null]]);
    const m = setup({ doc: d }, { multiIds: ['f'] });
    m.api.onCanvasSelect('s');
    m.api.onCanvasSelect(null);
    expect(m.fns.setMultiIds.mock.calls).toEqual([[['f', 's']]]);
    expect(m.deps.setSelectedId).not.toHaveBeenCalled();
  });
  it('réteg-menü: „Több” → többes mód a kijelölttel; más → a szerszám', () => {
    const a = setup({ selectedId: 'f' });
    a.api.onLayerMenu('multi');
    expect(a.fns.setMultiIds).toHaveBeenCalledWith(['f']);
    expect(a.deps.setSelectedId).toHaveBeenCalledWith(null);
    const b = setup();
    b.api.onLayerMenu('multi');
    expect(b.fns.setMultiIds).toHaveBeenCalledWith([]);
    const c = setup({ selectedLayer: photo });
    c.api.onLayerMenu('delete');
    expect(c.deps.setSheet).toHaveBeenCalledWith(null);
    expect((c.deps.commit as jest.Mock).mock.calls[0][1]).toBe('studio.image.undoDelete');
  });
  it('asszisztens: egy undo-lépés; az export a lapot nyitja, a háttér-eltávolítás utána fut', () => {
    const { deps, fns, api } = setup();
    api.applyAssistant([{ type: 'SET_OPACITY', layerId: 'f', opacity: 0.5 }, { type: 'REMOVE_BG', layerId: 'f' }, { type: 'EXPORT' }]);
    expect(deps.commit).toHaveBeenCalledTimes(1);
    expect((deps.commit as jest.Mock).mock.calls[0][1]).toBe('studio.image.assistant.undo');
    expect((deps.removeBackground as jest.Mock).mock.calls[0][0]).toMatchObject({ id: 'f', opacity: 0.5 });
    expect(deps.setSheet).toHaveBeenCalledWith('export');
    expect(fns.setAssistantOpen).toHaveBeenCalledWith(false);
  });
  it('asszisztens: változás nélkül nincs commit, de a sáv bezárul', () => {
    const { deps, fns, api } = setup();
    api.applyAssistant([]);
    expect(deps.commit).not.toHaveBeenCalled();
    expect(fns.setAssistantOpen).toHaveBeenCalledWith(false);
  });
});
