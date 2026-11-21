/**
 * 🙂 A matrica-panel szerkesztési útjai valódi komponensen: melyik vezérlő milyen store-hívást
 * (klip-beszúrás, SET_PARTICLES a command buson, rajz-ecset) ad, az arc-matrica és a 3D objektum
 * ágai, a logó hibája. A REFACTOR (szekciók a sticker/ alatt) előtti viselkedést rögzíti.
 */
import { Alert, Image as RNImage } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { StickerPanel } from '@/components/editor/panels/StickerPanel';
import { palette } from '@/constants/editor';
import { useEditorStore } from '@/store/editorStore';

jest.mock('@/components/ui/controls', () => ({
  Chip: Object.assign(() => null, { mockName: 'Chip' }),
  Stepper: Object.assign(() => null, { mockName: 'Stepper' }),
  PanelSection: Object.assign(({ children }: { children: unknown }) => children, { mockName: 'PanelSection' }),
}));
jest.mock('@/components/editor/panels/My3DModelsSection', () => ({
  My3DModelsSection: Object.assign(() => null, { mockName: 'My3DModelsSection' }),
}));
jest.mock('expo-image', () => ({ Image: Object.assign(() => null, { mockName: 'ExpoImage' }) }));
jest.mock('@/lib/id', () => ({ makeId: (p: string) => `${p}_1` }));
jest.mock('@/lib/logCaught', () => ({ logCaught: jest.fn() }));
jest.mock('@/lib/render', () => ({ ...jest.requireActual('@/lib/render'), renderServerUrl: () => 'http://w' }));
const mockDownload = jest.fn();
jest.mock('@/lib/stickers3d', () => ({
  ...jest.requireActual('@/lib/stickers3d'),
  listStickers3d: async () => [{ id: 'cube', label: 'Kocka', url: '/s/cube.glb' }],
  downloadSticker3d: (...a: unknown[]) => mockDownload(...a),
}));
const mockPick = jest.fn();
jest.mock('@/lib/media', () => ({ ...jest.requireActual('@/lib/media'), pickImage: () => mockPick() }));
const mockFaces = jest.fn();
jest.mock('@/lib/faceClient', () => ({
  pickPrimaryFace: jest.requireActual('@/lib/faceClient').pickPrimaryFace,
  fetchFaces: (...a: unknown[]) => mockFaces(...a),
}));

type Node = ReactTestRenderer['root'];

const video = { kind: 'video', id: 'v1', uri: 'file:///v.mp4', start: 0, duration: 20, trimIn: 1, speed: 2 };
const project = { id: 'p', name: 'P', fps: 30, aspectRatio: '9:16', tracks: [{ id: 'tv', type: 'video', clips: [video] }] };

let calls: [string, unknown[]][];
let alerts: unknown[][];
let mounted: ReactTestRenderer | null = null;

beforeEach(() => {
  calls = [];
  alerts = [];
  const rec = (name: string) => (...args: unknown[]) => void calls.push([name, args]);
  useEditorStore.setState({
    project: project as never,
    playhead: 3,
    drawBrush: null,
    addClip: rec('addClip'),
    selectClip: rec('selectClip'),
    setPanel: rec('setPanel'),
    dispatch: rec('dispatch'),
    setDrawBrush: rec('setDrawBrush'),
  } as never);
  jest.spyOn(Alert, 'alert').mockImplementation((...a: unknown[]) => void alerts.push(a));
  jest.mocked(jest.requireMock('@/lib/logCaught').logCaught).mockClear();
  mockDownload.mockReset();
  mockPick.mockReset();
  mockFaces.mockReset();
});

afterEach(() => {
  act(() => mounted?.unmount());
  mounted = null;
});

async function mount() {
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(<StickerPanel />);
  });
  mounted = view;
  const pressWith = (text: string) =>
    view.root.findAll(
      (n: Node) => typeof n.props.onPress === 'function' && n.findAll((c: Node) => c.props.children === text).length > 0
    )[0];
  const chip = (label: string) =>
    view.root.findAll((n: Node) => (n.type as { mockName?: string }).mockName === 'Chip' && n.props.label === label)[0];
  return { view, pressWith, chip };
}

describe('StickerPanel', () => {
  it('a csillag-forma a saját geometriájával kerül a playheadre, kijelölve, a Forma panellel', async () => {
    const { pressWith } = await mount();
    await act(async () => pressWith('panels.sticker.shapeStar').props.onPress());
    expect(calls).toEqual([
      ['addClip', ['overlay', { kind: 'shape', id: 'clip_1', start: 3, duration: 3, shape: 'star', position: { x: 0.5, y: 0.5 }, w: 0.3, h: 0.17, fill: '#ffd166', cornerRadius: 0 }]],
      ['selectClip', ['clip_1']],
      ['setPanel', ['shape']],
    ]);
    calls = [];
    await act(async () => pressWith('panels.sticker.shapeRectangle').props.onPress());
    expect(calls[0][1][1]).toMatchObject({ w: 0.42, h: 0.2, fill: palette.accent, cornerRadius: 0.15 });
  });

  it('a részecske-chip SET_PARTICLES parancsot küld user actorral', async () => {
    const { chip } = await mount();
    await act(async () => chip('panels.sticker.particle_snow').props.onPress());
    await act(async () => chip('common.none').props.onPress());
    expect(calls).toEqual([
      ['dispatch', [{ type: 'SET_PARTICLES', particles: { preset: 'snow', beatSync: true, intensity: 1 } }, 'user']],
      ['dispatch', [{ type: 'SET_PARTICLES', particles: null }, 'user']],
    ]);
  });

  it('az emoji-matrica a playheadre kerül és bezárja a panelt', async () => {
    const { pressWith } = await mount();
    await act(async () => pressWith('🚀').props.onPress());
    expect(calls).toEqual([
      ['addClip', ['overlay', expect.objectContaining({ kind: 'text', text: '🚀', start: 3, duration: 3, fontSize: 12, position: { x: 0.5, y: 0.35 } })]],
      ['setPanel', [null]],
    ]);
  });

  it('az arc-matrica a detektált arc fölé kerül; arc nélkül figyelmeztet', async () => {
    mockFaces.mockResolvedValueOnce([{ x: 0.3, y: 0.35, w: 0.1, h: 0.12, score: 1 }]).mockResolvedValueOnce([]);
    const { pressWith } = await mount();
    await act(async () => pressWith('👑').props.onPress());
    expect(mockFaces).toHaveBeenCalledWith('file:///v.mp4', { atSec: 7, aspectW: 9 / 16, aspectH: 1 });
    expect(calls[0][1][1]).toMatchObject({ kind: 'text', text: '👑', duration: 4, fontSize: 11, position: { x: 0.3, y: 0.35 - 0.09 } });
    expect(alerts).toEqual([['panels.sticker.faceStickerDoneTitle', 'panels.sticker.faceStickerDoneBody']]);
    await act(async () => pressWith('👑').props.onPress());
    expect(alerts[1]).toEqual(['panels.sticker.faceStickerTitle', 'panels.sticker.faceNotFound']);
  });

  it('a 3D objektum a választott anyaggal töltődik le, sikertelen letöltésnél figyelmeztet', async () => {
    mockDownload.mockResolvedValueOnce('file:///cube.png').mockResolvedValueOnce(null);
    const { chip, pressWith } = await mount();
    await act(async () => chip('lib.stickers3d.material.gold').props.onPress());
    await act(async () => pressWith('Kocka').props.onPress());
    expect(mockDownload).toHaveBeenCalledWith(expect.objectContaining({ id: 'cube' }), { material: 'gold', environment: 'studio' });
    expect(calls[0][1][1]).toMatchObject({ kind: 'shape', imageUri: 'file:///cube.png', shadow: true, w: 0.34 });
    expect(calls[0][1][2]).toMatchObject({ kind: 'image', name: 'Kocka', provider: 'local' });
    await act(async () => pressWith('Kocka').props.onPress());
    expect(alerts).toEqual([['panels.sticker.object3dTitle', 'panels.sticker.object3dDownloadFailed']]);
  });

  it('a logó a kép arányával kerül be; a választó hibája naplózva, figyelmeztetéssel', async () => {
    jest.spyOn(RNImage, 'getSize').mockImplementation((_u, ok) => ok(1600, 900));
    mockPick.mockResolvedValueOnce({ uri: 'file:///logo.png' }).mockRejectedValueOnce(new Error('pick'));
    const { pressWith } = await mount();
    await act(async () => pressWith('panels.sticker.shapeLogo').props.onPress());
    expect(calls[0][1][1]).toMatchObject({ kind: 'shape', imageUri: 'file:///logo.png', w: 0.3, h: (0.3 / (16 / 9)) * 0.5625 });
    await act(async () => pressWith('panels.sticker.shapeLogo').props.onPress());
    expect(jest.requireMock('@/lib/logCaught').logCaught).toHaveBeenCalledWith('components/editor/panels/StickerPanel.tsx:StickerPanel', expect.any(Error));
    expect(alerts).toEqual([['panels.sticker.logoName', 'panels.sticker.logoLoadFailed']]);
  });

  it('a rajz-ecset stílus-chipje ecsetet kapcsol, a vastagság-lépés 6-nál megáll', async () => {
    useEditorStore.setState({ drawBrush: { color: '#ffffff', width: 5.95, style: 'marker', glow: false } } as never);
    const { view, chip } = await mount();
    await act(async () => chip('lib.draw.brush.marker').props.onPress());
    await act(async () => chip('lib.draw.brush.neon').props.onPress());
    const stepper = view.root.findAll((n: Node) => (n.type as { mockName?: string }).mockName === 'Stepper')[0];
    await act(async () => stepper.props.onInc());
    expect(calls).toEqual([
      ['setDrawBrush', [null]],
      ['setDrawBrush', [{ color: '#ffffff', width: 0.8, style: 'neon', glow: true }]],
      ['setDrawBrush', [{ color: '#ffffff', width: 6, style: 'marker', glow: false }]],
    ]);
  });
});
