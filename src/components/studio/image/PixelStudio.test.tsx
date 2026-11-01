/** 👾 A valódi ujj-útvonal: a húzás pixelt fest, a tükör és az undo él, a második ujj nem hagy foltot. */
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { State } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';

import { PixelStudio } from '@/components/studio/image/PixelStudio';
import { decodeFrame, type PixelArt } from '@/lib/pixelArt';

jest.mock('@shopify/react-native-skia', () => {
  const path = { moveTo: () => path, lineTo: () => path };
  return {
    Canvas: () => null,
    Group: () => null,
    Image: () => null,
    Path: () => null,
    Rect: () => null,
    FilterMode: {},
    MipmapMode: {},
    AlphaType: {},
    ColorType: {},
    ImageFormat: {},
    Skia: { Path: { Make: () => path }, Data: { fromBytes: () => ({}) }, Image: { MakeImage: () => ({}) } },
  };
});
jest.mock('react-native-gesture-handler', () => ({
  ...jest.requireActual('react-native-gesture-handler'),
  GestureHandlerRootView: ({ children }: { children: unknown }) => children,
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('@/lib/pixelArtClient', () => ({
  rgbaImage: () => ({}),
  writeLayerPng: () => 'file:///p.png',
  writePixelGif: () => '',
  writeSpriteSheet: () => '',
}));
jest.mock('@/lib/media', () => ({ saveImageToPhotos: async () => 'saved' }));
jest.mock('@/lib/projectFolderClient', () => ({ projectMediaDir: () => ({}) }));

const pressable = (view: ReactTestRenderer, testID: string) =>
  view.root.findAll((n) => n.props.testID === testID && typeof n.props.onPress === 'function')[0];

async function mount() {
  const done = jest.fn<void, [PixelArt, string]>();
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(<PixelStudio initial={null} onDone={done} onClose={() => {}} />);
  });
  await act(async () => pressable(view, 'pixel-size-16').props.onPress());
  // a vászon 160 pont: egy pixel 10 pont
  const stage = view.root.findAll((n) => typeof n.props.onLayout === 'function')[0];
  await act(async () => stage.props.onLayout({ nativeEvent: { layout: { width: 160, height: 160 } } }));
  const finish = async () => {
    await act(async () => pressable(view, 'pixel-done').props.onPress());
    const art = done.mock.calls[done.mock.calls.length - 1][0];
    return art;
  };
  return { view, finish };
}

const drag = (points: [number, number][], end: (typeof State)[keyof typeof State] = State.END) =>
  act(async () => {
    const [first, ...rest] = points;
    fireGestureHandler(getByGestureTestId('pixel-draw'), [
      { state: State.BEGAN, x: first[0], y: first[1] },
      { state: State.ACTIVE, x: first[0], y: first[1] },
      ...rest.map(([x, y]) => ({ state: State.ACTIVE, x, y })),
      { state: end, x: points[points.length - 1][0], y: points[points.length - 1][1] },
    ]);
  });

const lit = (art: PixelArt, frame = 0) => {
  const f = decodeFrame(art.frames[frame], art.width, art.height);
  return [...f.keys()].filter((i) => f[i] !== 0);
};

describe('PixelStudio', () => {
  it('a húzás folytonos vonalat fest', async () => {
    const { finish } = await mount();
    await drag([[5, 5], [95, 5]]);
    expect(lit(await finish())).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('a vászon mellé húzás nem fest és nem dob hibát', async () => {
    const { finish } = await mount();
    await drag([[-20, 5], [5, 5]]);
    expect(lit(await finish())).toEqual([]);
  });

  it('a megszakított vonás (második ujj) nem marad a rajzon', async () => {
    const { finish } = await mount();
    await drag([[5, 5], [45, 5]], State.FAILED);
    expect(lit(await finish())).toEqual([]);
  });

  it('a tükör a másik oldalra is fest', async () => {
    const { view, finish } = await mount();
    await act(async () => pressable(view, 'pixel-mirror-x').props.onPress());
    await drag([[5, 5], [5, 5]]);
    expect(lit(await finish())).toEqual([0, 15]);
  });

  it('a radír töröl', async () => {
    const { view, finish } = await mount();
    await drag([[5, 5], [25, 5]]);
    await act(async () => pressable(view, 'pixel-tool-eraser').props.onPress());
    await drag([[15, 5], [15, 5]]);
    expect(lit(await finish())).toEqual([0, 2]);
  });

  it('a kitöltés az egész üres rácsot kitölti', async () => {
    const { view, finish } = await mount();
    await act(async () => pressable(view, 'pixel-tool-fill').props.onPress());
    await drag([[5, 5], [5, 5]]);
    expect(lit(await finish())).toHaveLength(256);
  });

  it('a szín a kiválasztott palettahely', async () => {
    const { view, finish } = await mount();
    await act(async () => pressable(view, 'pixel-color-9').props.onPress());
    await drag([[5, 5], [5, 5]]);
    expect(decodeFrame((await finish()).frames[0], 16, 16)[0]).toBe(9);
  });

  it('a kocka másolása megtartja a rajzot, és az új kockára fest', async () => {
    const { view, finish } = await mount();
    await drag([[5, 5], [5, 5]]);
    await act(async () => pressable(view, 'pixel-copy-frame').props.onPress());
    await drag([[25, 5], [25, 5]]);
    const art = await finish();
    expect(art.frames).toHaveLength(2);
    expect(lit(art, 0)).toEqual([0]);
    expect(lit(art, 1)).toEqual([0, 2]);
  });
});
