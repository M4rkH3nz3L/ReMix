import { initialSheetDetent, isPrecisionMode, pathEditTarget } from '@/lib/imageStudioOps';
import type { ImageDoc, ImageLayer } from '@/types/project';

/**
 * 🖼️ A Kép Stúdió törzsének tiszta magja — a jelenlegi viselkedés rögzítve (REFACTOR: az
 * `ImageStudioBody`-ból kiemelve).
 */

const NONE = { cropRect: null, penPoints: null, pathEditId: null, selectTool: null, lassoActive: false, wandActive: false, brushActive: false, guidesActive: false };

const P = (x: number, y: number) => ({ x, y });
const doc = (layers: ImageLayer[]): ImageDoc => ({ id: 'd', name: 'D', aspectRatio: '9:16', layers }) as ImageDoc;
const path = { kind: 'shape', id: 'p', shape: 'path', points: [P(0, 0), P(1, 0), P(1, 1)], closed: true } as unknown as ImageLayer;
const compound = {
  kind: 'shape',
  id: 'c',
  shape: 'path',
  points: [P(0, 0)],
  subpaths: [[P(0, 0), P(1, 0), P(1, 1)], [P(0.2, 0.2), P(0.4, 0.2), P(0.4, 0.4)]],
  closed: false,
} as unknown as ImageLayer;
const rect = { kind: 'shape', id: 'r', shape: 'rect' } as unknown as ImageLayer;
const photo = { kind: 'photo', id: 'f', uri: 'file:///a.png' } as unknown as ImageLayer;

describe('initialSheetDetent — a lap induló detentje', () => {
  it('a felhasználó utolsó választása nyer a lap alapja fölött', () => {
    expect(initialSheetDetent({ adjust: 'full' }, 'adjust')).toBe('full');
  });
  it('emlék nélkül a lap saját induló detentje (adjust → half)', () => {
    expect(initialSheetDetent({}, 'adjust')).toBe('half');
  });
  it('a tábla értéke laponként (modális lap → full, kis lap → peek)', () => {
    expect(initialSheetDetent({}, 'canvas')).toBe('full');
    expect(initialSheetDetent({}, 'align')).toBe('peek');
    expect(initialSheetDetent({}, 'history')).toBe('half');
  });
  it('egy MÁSIK lap emléke nem számít', () => {
    expect(initialSheetDetent({ develop: 'full' }, 'adjust')).toBe('half');
  });
});

describe('isPrecisionMode — a precíziós mód', () => {
  it('semmi aktív → nem precíziós', () => {
    expect(isPrecisionMode(NONE)).toBe(false);
  });
  it.each([
    ['cropRect', { x: 0, y: 0, w: 1, h: 1 }],
    ['penPoints', []],
    ['pathEditId', 'p'],
    ['selectTool', 'rect'],
    ['lassoActive', true],
    ['wandActive', true],
    ['brushActive', true],
    ['guidesActive', true],
  ])('%s önmagában precíziós módot jelent', (key, value) => {
    expect(isPrecisionMode({ ...NONE, [key]: value })).toBe(true);
  });
  it('az ÜRES toll-pontlista is precíziós (a rajz már elindult)', () => {
    expect(isPrecisionMode({ ...NONE, penPoints: [] })).toBe(true);
  });
  it('az üres path-id nem precíziós (hamis érték)', () => {
    expect(isPrecisionMode({ ...NONE, pathEditId: '' })).toBe(false);
  });
});

describe('pathEditTarget — a szerkesztett path levezetése', () => {
  it('nincs doc vagy nincs id → minden üres', () => {
    expect(pathEditTarget(null, 'p', 0)).toEqual({ rawPathShape: null, pathEditShape: null, ringCount: 0 });
    expect(pathEditTarget(doc([path]), null, 0)).toEqual({ rawPathShape: null, pathEditShape: null, ringCount: 0 });
  });
  it('nem path-forma (téglalap, fotó) vagy hiányzó réteg → nincs szerkesztett path', () => {
    expect(pathEditTarget(doc([rect]), 'r', 0).pathEditShape).toBeNull();
    expect(pathEditTarget(doc([photo]), 'f', 0).pathEditShape).toBeNull();
    expect(pathEditTarget(doc([path]), 'nincs', 0).pathEditShape).toBeNull();
  });
  it('egyszerű path: a réteg maga a nézet, 0 gyűrű', () => {
    const r = pathEditTarget(doc([path]), 'p', 3);
    expect(r.rawPathShape).toBe(path);
    expect(r.pathEditShape).toBe(path);
    expect(r.ringCount).toBe(0);
  });
  it('összetett path: a kért gyűrű a nézet (zárt), a túlcímzés az utolsóra esik', () => {
    const r1 = pathEditTarget(doc([compound]), 'c', 1);
    expect(r1.ringCount).toBe(2);
    expect(r1.pathEditShape?.points).toEqual([P(0.2, 0.2), P(0.4, 0.2), P(0.4, 0.4)]);
    expect(r1.pathEditShape?.closed).toBe(true);
    expect(pathEditTarget(doc([compound]), 'c', 9).pathEditShape?.points).toEqual([P(0.2, 0.2), P(0.4, 0.2), P(0.4, 0.4)]);
  });
});
