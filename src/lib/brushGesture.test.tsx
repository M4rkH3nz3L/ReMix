/** 🖌️ A valódi ujj-útvonal: a húzás vonássá válik, a megszakított nem marad a rajzon. A Skia ki van váltva, a rajz a telefonos füstteszt dolga. */
import { createRef } from 'react';
import { act, create } from 'react-test-renderer';
import { State } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';

import { BrushOverlay, type BrushHandle } from '@/components/studio/image/BrushOverlay';
import { DEFAULT_BRUSH } from '@/lib/brushEngine';

jest.mock('@shopify/react-native-skia', () => {
  const paint = () => new Proxy({}, { get: () => () => undefined });
  const image = { width: () => 1, height: () => 1, makeNonTextureImage: () => image, encodeToBytes: () => new Uint8Array() };
  const canvas = new Proxy({}, { get: () => () => undefined });
  return {
    BlendMode: {},
    ClipOp: {},
    FilterMode: {},
    MipmapMode: {},
    PathOp: {},
    Canvas: () => null,
    Picture: () => null,
    ImageFormat: {},
    PaintStyle: {},
    StrokeCap: {},
    StrokeJoin: {},
    TileMode: {},
    useImage: () => null,
    createPicture: () => ({}),
    Skia: {
      Paint: paint,
      Color: () => 0,
      XYWHRect: () => ({}),
      ImageFilter: { MakeBlur: () => ({}) },
      Surface: { MakeOffscreen: () => ({ getCanvas: () => canvas, flush: () => undefined, makeImageSnapshot: () => image }) },
    },
  };
});
jest.mock('@/lib/projectFolderClient', () => ({ projectMediaDir: () => ({ exists: true }) }));
jest.mock('expo-file-system', () => ({ File: class { uri = 'file:///brush.png'; write() {} } }));

const box = { w: 200, h: 100 };

function setup() {
  const ref = createRef<BrushHandle>();
  const history: string[] = [];
  act(() => {
    create(<BrushOverlay ref={ref} box={box} settings={{ ...DEFAULT_BRUSH, smoothing: 0 }} onHistory={(u, r) => history.push(`${u}/${r}`)} gestureTestId="brush" />);
  });
  return { ref, history };
}

const drag = (end: State) =>
  act(() => {
    fireGestureHandler(getByGestureTestId('brush'), [
      { state: State.BEGAN, x: 20, y: 10 },
      { state: State.ACTIVE, x: 40, y: 20 },
      { state: State.ACTIVE, x: 60, y: 30 },
      { state: end, x: 60, y: 30 },
    ]);
  });

describe('ecset-gesztus', () => {
  it('a befejezett húzás egy vonás, ami visszavonható és újra megcsinálható', () => {
    const { ref, history } = setup();
    expect(ref.current!.hasStrokes()).toBe(false);
    drag(State.END);
    expect(ref.current!.hasStrokes()).toBe(true);
    expect(history[history.length - 1]).toBe('true/false');
    act(() => ref.current!.undo());
    expect(ref.current!.hasStrokes()).toBe(false);
    expect(history[history.length - 1]).toBe('false/true');
    act(() => ref.current!.redo());
    expect(history[history.length - 1]).toBe('true/false');
  });

  it('a megszakított húzás (második ujj) nem marad a rajzon', () => {
    const { ref } = setup();
    drag(State.CANCELLED);
    expect(ref.current!.hasStrokes()).toBe(false);
  });

  it('két húzás két külön vonás', () => {
    const { ref } = setup();
    drag(State.END);
    drag(State.END);
    act(() => ref.current!.undo());
    expect(ref.current!.hasStrokes()).toBe(true);
  });
});

describe('klón forráspontja', () => {
  const setupClone = () => {
    const ref = createRef<BrushHandle>();
    const need: boolean[] = [];
    act(() => {
      create(<BrushOverlay ref={ref} box={box} settings={{ ...DEFAULT_BRUSH, smoothing: 0, tool: 'clone' }} onNeedSource={(n) => need.push(n)} gestureTestId="clone" />);
    });
    return { ref, need };
  };
  const tap = (x: number, y: number) =>
    act(() => {
      fireGestureHandler(getByGestureTestId('clone'), [{ state: State.BEGAN, x, y }, { state: State.END, x, y }]);
    });

  it('az első koppintás a forrás, nem vonás; utána fest', () => {
    const { ref, need } = setupClone();
    expect(need).toEqual([true]);
    tap(40, 20);
    expect(ref.current!.hasStrokes()).toBe(false);
    expect(need[need.length - 1]).toBe(false);
    act(() => {
      fireGestureHandler(getByGestureTestId('clone'), [
        { state: State.BEGAN, x: 100, y: 50 },
        { state: State.ACTIVE, x: 110, y: 50 },
        { state: State.ACTIVE, x: 120, y: 50 },
        { state: State.END, x: 120, y: 50 },
      ]);
    });
    expect(ref.current!.hasStrokes()).toBe(true);
  });
  it('új forrás kérhető', () => {
    const { ref, need } = setupClone();
    tap(40, 20);
    act(() => ref.current!.pickSource());
    expect(need[need.length - 1]).toBe(true);
  });
});
