/**
 * 🧪 Gesztus-tesztek a VALÓDI komponenseken: a `react-native-gesture-handler` teszt-segédje a
 * tényleges callback-láncot futtatja (a natív felismerést nem — az eszközös próba része).
 */
import { useState } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { State } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';

import { StyleSheet } from 'react-native';

import { ImageCanvas } from '@/components/studio/image/ImageCanvas';
import { LayerPanel } from '@/components/studio/image/LayerPanel';
import { LayerThumb } from '@/components/studio/image/LayerThumb';
import { PhotoLayerView } from '@/components/studio/image/PhotoLayerView';
import { SelectionFrame } from '@/components/studio/image/SelectionFrame';
import type { LivePatch } from '@/lib/imageLayerClip';
import de from '@/i18n/locales/de.json';
import en from '@/i18n/locales/en.json';
import hu from '@/i18n/locales/hu.json';
import { RAIL_GROUPS, selectionMenu, TOOL_ICONS } from '@/lib/imageMenu';
import { boxToImage, imageToBox } from '@/lib/wandMapping';
import { layerRowLabels, moveLayerTo, removeLayer, reorderLayer, toggleLayerLocked } from '@/lib/imageDoc';
import { applyLayerBoxPx, layerBoxPx, normalizeRotation } from '@/lib/imageLayerGeometry';
import type { ImageDoc, ImageLayer, PhotoLayer } from '@/types/project';

// a natív Skia nem fut Jest alatt; a kép a telefonos füstteszten mért
jest.mock('@/components/studio/image/SkiaPhotoLayer', () => ({ needsSkiaPreview: () => false, SkiaPhotoLayer: () => null }));
jest.mock('@/components/studio/image/ShapeEffects', () => ({ ShapeEffects: () => null }));
jest.mock('@/components/studio/image/DocVignette', () => ({ DocVignette: () => null, DocGrain: () => null }));
jest.mock('react-native-worklets', () => ({ runOnJS: (fn: unknown) => fn, scheduleOnRN: (fn: (...a: unknown[]) => void, ...a: unknown[]) => fn(...a) }));
jest.mock('react-native-reanimated', () => {
  const RN = jest.requireActual('react-native');
  return {
    __esModule: true,
    default: { View: RN.View, createAnimatedComponent: (c: unknown) => c },
    runOnJS: (fn: unknown) => fn,
    // a design-rendszer modul-szinten olvassa a görbéket és az animáció-építőket
    Easing: new Proxy({}, { get: () => () => () => 0 }),
    withTiming: (v: unknown) => v,
    withSpring: (v: unknown) => v,
    useSharedValue: (value: unknown) => ({ value }),
    useAnimatedStyle: (fn: () => object) => fn(),
    useDerivedValue: (fn: () => unknown) => ({ value: fn() }),
    useEvent: () => () => {},
    useComposedEventHandler: () => undefined,
    setGestureState: () => {},
  };
});

const layer: PhotoLayer = { kind: 'photo', id: 'p', uri: 'file:///a.png', position: { x: 0.5, y: 0.5 }, w: 0.5, h: 0.5, fit: 'cover' };
const box = { w: 300, h: 300 };

function render(el: React.ReactElement) {
  act(() => {
    create(el);
  });
}

function drag(dx: number, success = true) {
  fireGestureHandler(getByGestureTestId('photo-pan-p'), [
    { state: State.BEGAN, translationX: 0, translationY: 0 },
    { state: State.ACTIVE, translationX: dx, translationY: 0 },
    { state: success ? State.END : State.FAILED, translationX: dx, translationY: 0 },
  ]);
}

describe('I35/I36 — réteg-húzás', () => {
  it('1:1-en a húzás a teljes elmozdulás', () => {
    const onMove = jest.fn();
    render(<PhotoLayerView canvas={{ width: 300, height: 300 }} layer={layer} box={box} selected onMove={onMove} />);
    drag(30);
    expect(onMove.mock.calls[0][1].x).toBeCloseTo(0.6);
  });
  it('3× nagyításnál ugyanaz a húzás harmadannyi', () => {
    const onMove = jest.fn();
    render(<PhotoLayerView canvas={{ width: 300, height: 300 }} layer={layer} box={box} selected zoom={3} onMove={onMove} />);
    drag(30);
    expect(onMove.mock.calls[0][1].x).toBeCloseTo(0.5 + 10 / 300);
  });
  it('a kijelöletlen fotó nem mozdul', () => {
    const onMove = jest.fn();
    render(<PhotoLayerView canvas={{ width: 300, height: 300 }} layer={layer} box={box} selected={false} onMove={onMove} />);
    drag(30);
    expect(onMove).not.toHaveBeenCalled();
  });
  it('a megszakított húzás (második ujj) nem ment', () => {
    const onMove = jest.fn();
    render(<PhotoLayerView canvas={{ width: 300, height: 300 }} layer={layer} box={box} selected onMove={onMove} />);
    drag(30, false);
    expect(onMove).not.toHaveBeenCalled();
  });
});

describe('méretezés a kijelölő keretben', () => {
  /** a valódi szülő viselkedése: az élő patch visszakerül a keretbe (ez okozta a halmozódást) */
  function Harness({ onCommit }: { onCommit: (p: LivePatch) => void }) {
    const [live, setLive] = useState<LivePatch>({});
    return <SelectionFrame layer={{ ...layer, ...live } as PhotoLayer} box={box} onLive={setLive} onCommit={onCommit} />;
  }
  /**
   * Lépésenként külön `act`: minden frissítés után újrarajzol a keret, és a legfrissebb
   * callback fut — mint az eszközön. (A `fireGestureHandler` egy menetben futtatná le.)
   */
  const dragCorner = async (corner: string, steps: number[]) => {
    type Handlers = { onStart: (e: object) => void; onUpdate: (e: object) => void; onEnd: (e: object, ok: boolean) => void; onFinalize: (e: object, ok: boolean) => void };
    const handlers = () => (getByGestureTestId(`scale-${corner}`) as unknown as { handlers: Handlers }).handlers;
    // az RNGH az új callbackeket mikrotaszkban cseréli le — ezért aszinkron az `act`
    const step = (fn: () => void) => act(async () => { fn(); await Promise.resolve(); });
    await step(() => handlers().onStart({}));
    for (const d of steps) {
      await step(() => handlers().onUpdate({ translationX: d, translationY: d }));
    }
    const last = steps[steps.length - 1];
    await step(() => handlers().onEnd({ translationX: last, translationY: last }, true));
    await step(() => handlers().onFinalize({}, true));
  };

  it('sok kis lépés sem halmozódik: 75 px húzás = 1,5× (nem elszálló)', async () => {
    const onCommit = jest.fn();
    render(<Harness onCommit={onCommit} />);
    await dragCorner('br', [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75]);
    const p = onCommit.mock.calls[0][0] as LivePatch;
    expect(p.w).toBeCloseTo(0.75, 2);
    expect(p.h).toBeCloseTo(0.75, 2);
  });
  it('a szemközti sarok a helyén marad', async () => {
    const onCommit = jest.fn();
    render(<Harness onCommit={onCommit} />);
    await dragCorner('br', [75]);
    const p = onCommit.mock.calls[0][0] as LivePatch;
    expect(p.position!.x - p.w! / 2).toBeCloseTo(0.25, 2); // bal széle eredetileg 0,25
    expect(p.position!.y - p.h! / 2).toBeCloseTo(0.25, 2);
  });
  it('mind a négy sarok fogható', () => {
    render(<Harness onCommit={() => {}} />);
    for (const c of ['tl', 'tr', 'bl', 'br']) {
      expect(getByGestureTestId(`scale-${c}`)).toBeTruthy();
    }
  });
});

describe('réteg-sorrend húzással', () => {
  const docOf = (layers: object[], extra = {}) => ({ id: 'd', name: 'D', aspectRatio: '1:1', width: 100, height: 100, layers, ...extra }) as unknown as ImageDoc;
  const l = (id: string, groupId?: string) => ({ kind: 'shape', id, shape: 'rectangle', position: { x: 0.5, y: 0.5 }, w: 0.1, h: 0.1, fill: '#000', groupId });
  const ids = (d: ImageDoc) => d.layers.map((x) => x.id).join('');

  it('a sor lefelé húzva a rétegek közt lejjebb kerül', async () => {
    const commit = jest.fn();
    const doc = docOf([l('a'), l('b'), l('c')]);
    render(<LayerPanel doc={doc} selectedId={null} onSelect={() => {}} onMergeDown={() => {}} onRasterize={() => {}} onFlatten={() => {}} commit={commit} onClose={() => {}} />);
    const h = (getByGestureTestId('layer-drag-c') as unknown as { handlers: { onEnd: (e: object, ok: boolean) => void } }).handlers;
    await act(async () => h.onEnd({ translationY: 110 }, true));
    expect(ids(commit.mock.calls[0][0])).toBe('cab'); // a lista fölül a legfelső, 2 sorral lejjebb
  });
  it('húzás közben a vászon a várható sorrendet kapja, a végén visszaáll', async () => {
    const preview = jest.fn();
    const commit = jest.fn();
    const doc = docOf([l('a'), l('b'), l('c')]);
    render(<LayerPanel doc={doc} selectedId={null} onSelect={() => {}} onMergeDown={() => {}} onRasterize={() => {}} onFlatten={() => {}} onOrderPreview={preview} commit={commit} onClose={() => {}} />);
    const h = (getByGestureTestId('layer-drag-c') as unknown as { handlers: { onUpdate: (e: object) => void; onEnd: (e: object, ok: boolean) => void } }).handlers;
    await act(async () => h.onUpdate({ translationY: 60 }));
    expect(preview).toHaveBeenLastCalledWith({ id: 'c', to: 1 });
    await act(async () => h.onEnd({ translationY: 60 }, true));
    expect(preview).toHaveBeenLastCalledWith(null);
    expect(ids(commit.mock.calls[0][0])).toBe('acb');
  });
  it('az azonos nevű rétegek sorszámot kapnak, a saját név érintetlen', () => {
    const photo2 = (id: string, name?: string) => ({ ...layer, id, name });
    const labels = layerRowLabels(docOf([photo2('a'), photo2('b'), photo2('c', 'Portré'), photo2('d')]));
    expect(labels.get('a')).not.toEqual(labels.get('b'));
    expect(labels.get('b')).toMatch(/ 2$/);
    expect(labels.get('c')).toBe('Portré');
    expect(labels.get('d')).toMatch(/ 3$/);
  });
  it('minden fajtának van előnézete: a fotó a saját képét mutatja', () => {
    let tree: ReturnType<typeof create> | undefined;
    const kinds = [
      layer,
      { kind: 'text', id: 't', text: 'Hello', color: '#ff0000', fontSize: 8, position: { x: 0.5, y: 0.5 } },
      { kind: 'shape', id: 's', shape: 'ellipse', position: { x: 0.5, y: 0.5 }, w: 0.5, h: 0.5, fill: '#00ff00' },
      { kind: 'shape', id: 's2', shape: 'star', position: { x: 0.5, y: 0.5 }, w: 0.5, h: 0.5, fill: '#00ff00' },
      { kind: 'fill', id: 'f', fill: '#0000ff' },
      { kind: 'fill', id: 'g', fill: '#000', fillGradient: { from: '#111111', to: '#222222' } },
      { kind: 'adjust', id: 'j' },
    ] as ImageLayer[];
    for (const k of kinds) {
      act(() => {
        tree = create(<LayerThumb layer={k} />);
      });
      expect(tree!.toJSON()).toBeTruthy();
    }
    act(() => {
      tree = create(<LayerThumb layer={layer} />);
    });
    expect(JSON.stringify(tree!.toJSON())).toContain('file:///a.png');
  });
  it('a csoport egyben marad: kívülálló nem kerül a tagok közé', () => {
    const d = docOf([l('a'), l('x', 'g'), l('y', 'g'), l('b')]);
    expect(ids(moveLayerTo(d, 'b', 2))).toBe('abxy');
    expect(ids(moveLayerTo(d, 'a', 1))).toBe('xyab');
  });
  it('a tag a csoportján belül marad', () => {
    const d = docOf([l('a'), l('x', 'g'), l('y', 'g'), l('b')]);
    expect(ids(moveLayerTo(d, 'x', 3))).toBe('ayxb');
    expect(ids(moveLayerTo(d, 'y', 0))).toBe('ayxb');
  });
  it('a fel/le lépés a csoportot egyben ugorja át', () => {
    expect(ids(reorderLayer(docOf([l('a'), l('x', 'g'), l('y', 'g')]), 'a', 1))).toBe('xya');
  });
});

describe('zárolás', () => {
  it('a zárolt réteg nem törölhető', () => {
    const doc = { layers: [{ ...layer, locked: true }] } as unknown as ImageDoc;
    expect(removeLayer(doc, 'p')).toBe(doc);
  });
  it('a zárolás oda-vissza kapcsol', () => {
    const doc = { layers: [layer] } as unknown as ImageDoc;
    const locked = toggleLayerLocked(doc, 'p');
    expect(locked.layers[0].locked).toBe(true);
    expect(toggleLayerLocked(locked, 'p').layers[0].locked).toBe(false);
  });
});

describe('pontos számértékek', () => {
  const canvas = { width: 1000, height: 500 };
  const l2 = { position: { x: 0.5, y: 0.5 }, w: 0.2, h: 0.4, rotation: 190 };
  it('képpontban mutat', () => {
    expect(layerBoxPx(l2, canvas)).toEqual({ x: 400, y: 150, w: 200, h: 200, rotation: -170 });
  });
  it('az X a bal szélt állítja', () => {
    const p = applyLayerBoxPx(l2, { x: 0 }, canvas, false);
    expect(p.position.x).toBeCloseTo(0.1);
    expect(p.w).toBeCloseTo(0.2);
  });
  it('aránytartással a másik oldal követi', () => {
    const p = applyLayerBoxPx(l2, { w: 400 }, canvas, true);
    expect([p.w * 1000, p.h * 500]).toEqual([400, 400]);
  });
  it('arány nélkül csak az az oldal változik; a bal felső sarok áll', () => {
    const p = applyLayerBoxPx(l2, { w: 400 }, canvas, false);
    expect(p.h * 500).toBeCloseTo(200);
    expect(p.position.x * 1000 - (p.w * 1000) / 2).toBeCloseTo(400);
  });
  it('nulla / érvénytelen méretet nem fogad el', () => {
    expect(applyLayerBoxPx(l2, { w: 0 }, canvas, false).w).toBeCloseTo(0.2);
  });
});

describe('I33 — varázspálca-leképezés', () => {
  it('stretch: azonos', () => {
    expect(boxToImage({ x: 0.2, y: 0.7 }, 2, 1, 'stretch')).toEqual({ x: 0.2, y: 0.7 });
  });
  it('cover: széles kép négyzet dobozban — csak a közepe látszik', () => {
    const p = boxToImage({ x: 0, y: 0.5 }, 2, 1, 'cover')!;
    expect(p.x).toBeCloseTo(0.25);
    expect(p.y).toBeCloseTo(0.5);
  });
  it('contain: a margóra koppintás nem kép', () => {
    expect(boxToImage({ x: 0.5, y: 0.05 }, 2, 1, 'contain')).toBeNull();
    const p = boxToImage({ x: 0.5, y: 0.5 }, 2, 1, 'contain')!;
    expect(p).toEqual({ x: 0.5, y: 0.5 });
  });
  it.each([['cover'], ['contain'], ['stretch']] as const)('%s: oda-vissza pontos', (fit) => {
    const start = { x: 0.45, y: 0.55 };
    const img = boxToImage(start, 1.5, 0.8, fit)!;
    const back = imageToBox(img, 1.5, 0.8, fit);
    expect(back.x).toBeCloseTo(start.x);
    expect(back.y).toBeCloseTo(start.y);
  });
  it('a kontúr a dobozon belül marad', () => {
    expect(imageToBox({ x: 0, y: 0.5 }, 2, 1, 'cover').x).toBe(0);
  });
});

describe('I38 — forgatás', () => {
  it.each([[0, 0], [190, -170], [359, -1], [-190, 170], [720, 0], [180, 180], [-180, 180]])('%d° → %d°', (from, to) => {
    expect(normalizeRotation(from)).toBe(to);
  });
});

describe('menüszerkezet', () => {
  const ctx = { canAlign: true, canBoolean: false };
  const shape = { kind: 'shape', id: 's', shape: 'rectangle', position: { x: 0.5, y: 0.5 }, w: 0.5, h: 0.5, fill: '#000' } as unknown as ImageLayer;
  const text = { kind: 'text', id: 't', text: 'A', fontSize: 8, position: { x: 0.5, y: 0.5 } } as unknown as ImageLayer;
  const fill = { kind: 'fill', id: 'f', fill: '#000' } as unknown as ImageLayer;
  const rail = RAIL_GROUPS.flatMap((g) => g.tools) as string[];

  it('a bal sínen csak szerszám van: semmi, ami kijelölt elemre hat', () => {
    for (const l of [layer, shape, text, fill]) {
      const { actions } = selectionMenu(l, ctx);
      expect(actions.filter((a) => rail.includes(a))).toEqual([]);
    }
    for (const notTool of ['delete', 'duplicate', 'rotate', 'flipH', 'style', 'layers']) {
      expect(rail).not.toContain(notTool);
    }
  });
  it('minden elemnél elérhető a törlés, a zároltnál nem', () => {
    for (const l of [layer, shape, text, fill]) {
      expect(selectionMenu(l, ctx).canDelete).toBe(true);
    }
    const locked = selectionMenu({ ...layer, locked: true }, ctx);
    expect(locked.canDelete).toBe(false);
    expect(locked.actions).toEqual(['unlock', 'duplicate']);
  });
  it('a sorrend: beállítás → elrendezés → másolás → export', () => {
    const { actions } = selectionMenu(layer, ctx);
    expect(actions.indexOf('adjust')).toBeLessThan(actions.indexOf('align'));
    expect(actions.indexOf('rotate')).toBeLessThan(actions.indexOf('duplicate'));
    expect(actions.slice(-2)).toEqual(['duplicate', 'exportLayer']);
  });
  it('csak a fajtájához illő műveletek', () => {
    expect(selectionMenu(layer, ctx).actions).toContain('develop');
    expect(selectionMenu(layer, ctx).actions).not.toContain('fx');
    expect(selectionMenu(shape, ctx).actions).toContain('fx');
    expect(selectionMenu(shape, ctx).actions).not.toContain('editPath');
    expect(selectionMenu({ ...shape, shape: 'path', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] } as unknown as ImageLayer, ctx).actions).toContain('editPath');
    expect(selectionMenu(fill, ctx).actions).not.toContain('rotate');
  });
  it('minden sín-szerszámnak és műveletnek van felirata és ikonja', () => {
    const all = [...rail, ...selectionMenu({ ...shape, shape: 'path', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] } as unknown as ImageLayer, { canAlign: true, canBoolean: true }).actions, 'adjust', 'develop', 'unlock', 'delete'];
    for (const key of all) {
      expect(TOOL_ICONS[key as keyof typeof TOOL_ICONS]).toBeTruthy();
      for (const dict of [hu, en, de]) {
        expect((dict.studio.imageTools as Record<string, string>)[key]).toBeTruthy();
      }
    }
  });
});

describe('kétujjas koppintás és dupla koppintás', () => {
  const doc = { id: 'd', name: 'D', aspectRatio: '1:1', width: 100, height: 100, layers: [] } as unknown as ImageDoc;
  it('a kétujjas koppintás visszavon, a megszakított nem', async () => {
    const onUndo = jest.fn();
    render(<ImageCanvas doc={doc} selectedId={null} onSelect={() => {}} commit={() => {}} onUndo={onUndo} />);
    const tap = (getByGestureTestId('canvas-undo-tap') as unknown as { handlers: { onEnd: (e: object, ok: boolean) => void } }).handlers;
    await act(async () => tap.onEnd({}, false));
    expect(onUndo).not.toHaveBeenCalled();
    await act(async () => tap.onEnd({}, true));
    expect(onUndo).toHaveBeenCalledTimes(1);
  });
});

describe('≥44 pt célterület', () => {
  it('a réteg-panel minden gombja legalább 44 pt', () => {
    let tree: ReturnType<typeof create> | undefined;
    const doc = { id: 'd', name: 'D', aspectRatio: '1:1', width: 100, height: 100, layers: [layer] } as unknown as ImageDoc;
    act(() => {
      tree = create(<LayerPanel doc={doc} selectedId={null} onSelect={() => {}} onMergeDown={() => {}} onRasterize={() => {}} onFlatten={() => {}} commit={() => {}} onClose={() => {}} />);
    });
    const icons = tree!.root.findAll((n) => typeof n.type === 'string' && n.props.accessibilityRole === 'button');
    const sized = icons.map((n) => StyleSheet.flatten(n.props.style)).filter((s) => s?.width != null);
    expect(sized.length).toBeGreaterThanOrEqual(2); // szem + zár a sorban
    for (const s of sized) {
      expect(Number(s.width)).toBeGreaterThanOrEqual(44);
      expect(Number(s.height)).toBeGreaterThanOrEqual(44);
    }
  });
});

describe('rács-illesztés a vásznon', () => {
  const docWith = (grid?: ImageDoc['grid']) => ({ id: 'd', name: 'n', aspectRatio: '1:1', width: 320, height: 320, layers: [{ ...layer, w: 0.25, h: 0.25, position: { x: 0.5, y: 0.5 } }], grid }) as unknown as ImageDoc;
  const moved = (grid?: ImageDoc['grid']) => {
    let last: ImageDoc | null = null;
    let root: ReactTestRenderer | undefined;
    act(() => {
      root = create(<ImageCanvas doc={docWith(grid)} selectedId="p" onSelect={() => {}} commit={(d) => (last = d)} />);
    });
    const host = root!.root.findAll((n) => typeof n.props.onLayout === 'function')[0];
    act(() => host.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 320, height: 320 } } }));
    drag(40);
    const l = (last as ImageDoc | null)?.layers[0] as PhotoLayer | undefined;
    return l?.position;
  };
  it('bekapcsolva a réteg bal felső sarka rácsponton áll meg', () => {
    const pos = moved({ size: 32, show: false, snap: true });
    expect(pos).toBeDefined();
    const left = (pos!.x - 0.125) * 320;
    expect(Math.abs(left / 32 - Math.round(left / 32))).toBeLessThan(1e-6);
  });
  it('kikapcsolva nem igazít a rácshoz', () => {
    const pos = moved({ size: 32, show: true, snap: false });
    expect(pos).toBeDefined();
    const left = (pos!.x - 0.125) * 320;
    expect(Math.abs(left / 32 - Math.round(left / 32))).toBeGreaterThan(1e-3);
  });
});
