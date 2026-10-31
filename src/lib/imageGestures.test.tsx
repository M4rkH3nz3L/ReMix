/**
 * 🧪 Gesztus-tesztek a VALÓDI komponenseken: a `react-native-gesture-handler` teszt-segédje a
 * tényleges callback-láncot futtatja (a natív felismerést nem — az eszközös próba része).
 */
import { act, create } from 'react-test-renderer';
import { State } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';

import { PhotoLayerView } from '@/components/studio/image/PhotoLayerView';
import { boxToImage, imageToBox } from '@/lib/wandMapping';
import { normalizeRotation } from '@/lib/imageLayerGeometry';
import type { PhotoLayer } from '@/types/project';

jest.mock('react-native-worklets', () => ({ runOnJS: (fn: unknown) => fn, scheduleOnRN: (fn: (...a: unknown[]) => void, ...a: unknown[]) => fn(...a) }));
jest.mock('react-native-reanimated', () => {
  const RN = jest.requireActual('react-native');
  return {
    __esModule: true,
    default: { View: RN.View, createAnimatedComponent: (c: unknown) => c },
    runOnJS: (fn: unknown) => fn,
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
