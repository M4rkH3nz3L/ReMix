/**
 * 🧪 Gesztus-tesztek a VALÓDI komponenseken: a `react-native-gesture-handler` teszt-segédje a
 * tényleges callback-láncot futtatja (a natív felismerést nem — az eszközös próba része).
 */
import { useState } from 'react';
import { act, create } from 'react-test-renderer';
import { State } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';

import { LayerPanel } from '@/components/studio/image/LayerPanel';
import { PhotoLayerView } from '@/components/studio/image/PhotoLayerView';
import { SelectionFrame } from '@/components/studio/image/SelectionFrame';
import type { LivePatch } from '@/lib/imageLayerClip';
import { boxToImage, imageToBox } from '@/lib/wandMapping';
import { moveLayerTo, removeLayer, reorderLayer, toggleLayerLocked } from '@/lib/imageDoc';
import { applyLayerBoxPx, layerBoxPx, normalizeRotation } from '@/lib/imageLayerGeometry';
import type { ImageDoc, PhotoLayer } from '@/types/project';

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
    render(<PhotoLayerView layer={layer} box={box} selected onMove={onMove} />);
    drag(30);
    expect(onMove.mock.calls[0][1].x).toBeCloseTo(0.6);
  });
  it('3× nagyításnál ugyanaz a húzás harmadannyi', () => {
    const onMove = jest.fn();
    render(<PhotoLayerView layer={layer} box={box} selected zoom={3} onMove={onMove} />);
    drag(30);
    expect(onMove.mock.calls[0][1].x).toBeCloseTo(0.5 + 10 / 300);
  });
  it('a kijelöletlen fotó nem mozdul', () => {
    const onMove = jest.fn();
    render(<PhotoLayerView layer={layer} box={box} selected={false} onMove={onMove} />);
    drag(30);
    expect(onMove).not.toHaveBeenCalled();
  });
  it('a megszakított húzás (második ujj) nem ment', () => {
    const onMove = jest.fn();
    render(<PhotoLayerView layer={layer} box={box} selected onMove={onMove} />);
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
    render(<LayerPanel doc={doc} selectedId={null} onSelect={() => {}} onAdd={() => {}} onMergeDown={() => {}} onRasterize={() => {}} onFlatten={() => {}} commit={commit} onClose={() => {}} onOpenAdjust={() => {}} />);
    const h = (getByGestureTestId('layer-drag-c') as unknown as { handlers: { onEnd: (e: object, ok: boolean) => void } }).handlers;
    await act(async () => h.onEnd({ translationY: 110 }, true));
    expect(ids(commit.mock.calls[0][0])).toBe('cab'); // a lista fölül a legfelső, 2 sorral lejjebb
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
