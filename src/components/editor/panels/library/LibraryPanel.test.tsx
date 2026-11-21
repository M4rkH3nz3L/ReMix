/**
 * 📚 A Tár-panel útjai valódi komponensen: a források állapota, a tétel → klip (a megfelelő
 * sávra, durable remoteUrl-lel), az URL-import fajtái, a Pro-kapu és a hibák. A REFACTOR
 * (szekciók a library/ alatt) előtti viselkedést rögzíti.
 */
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { LibraryPanel } from '@/components/editor/panels/LibraryPanel';
import { useEditorStore } from '@/store/editorStore';
import { usePaywall } from '@/store/paywallStore';

jest.mock('@/components/ui/controls', () => ({
  PanelSection: Object.assign(({ children }: { children: unknown }) => children, { mockName: 'PanelSection' }),
}));
jest.mock('@/lib/id', () => ({ makeId: (p: string) => `${p}_1` }));
jest.mock('@/lib/logCaught', () => ({ logCaught: jest.fn() }));
jest.mock('@/lib/proxy', () => ({ ensureProxy: async () => undefined }));
jest.mock('@/lib/backend', () => ({ ...jest.requireActual('@/lib/backend'), renderServerUrl: () => 'http://w' }));
jest.mock('@/store/progressStore', () => ({
  withProgress: (_l: string, fn: (r: () => void) => Promise<unknown>) => fn(() => undefined),
}));
const mockYt = jest.fn();
jest.mock('@/lib/youtube', () => ({ importYouTubeMedia: (...a: unknown[]) => mockYt(...a) }));
const mockResolve = jest.fn();
jest.mock('@/lib/storageProviders', () => {
  const p = {
    id: 'cloud',
    label: 'lbl.cloud',
    description: 'desc.cloud',
    isAvailable: () => Promise.resolve(true),
    list: () =>
      Promise.resolve([
        { id: 'e1', name: 'Clip.mp4', kind: 'video', duration: 9, url: '/files/e1' },
        { id: 'e2', name: 'Song.mp3', kind: 'audio', url: '/files/e2' },
        { id: 'e3', name: 'Box.glb', kind: 'model', url: '/files/e3' },
      ]),
    resolve: (e: unknown) => mockResolve(e),
  };
  const off = { ...p, id: 'off', label: 'lbl.off', isAvailable: () => Promise.resolve(false) };
  return { storageProviders: [p, off], loadStorageProviders: async () => [p, off] };
});

type Node = ReactTestRenderer['root'];

const video = { kind: 'video', id: 'v1', uri: 'file:///v.mp4', start: 0, duration: 20, trimIn: 0, speed: 1 };
const project = { id: 'p', name: 'P', fps: 30, aspectRatio: '9:16', tracks: [{ id: 'tv', type: 'video', clips: [video] }] };

let calls: [string, unknown[]][];
let mounted: ReactTestRenderer | null = null;

beforeEach(() => {
  calls = [];
  const rec = (name: string) => (...args: unknown[]) => void calls.push([name, args]);
  useEditorStore.setState({ project: project as never, playhead: 4, addClip: rec('addClip') } as never);
  usePaywall.setState({ open: rec('paywall') } as never);
  mockYt.mockReset();
  mockResolve.mockReset();
});

afterEach(() => {
  act(() => mounted?.unmount());
  mounted = null;
});

const flush = async () => {
  for (let i = 0; i < 6; i++) await act(async () => undefined);
};

async function mount() {
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(<LibraryPanel />);
  });
  mounted = view;
  await flush();
  const texts = () => view.root.findAll((n: Node) => (n.type as unknown) === 'Text').map((n: Node) => [n.props.children].flat().join(''));
  const pressWith = (text: string) =>
    view.root.findAll(
      (n: Node) => typeof n.props.onPress === 'function' && typeof n.type !== 'string' && n.findAll((c: Node) => c.props.children === text).length > 0
    )[0];
  const input = (placeholder: string) =>
    view.root.findAll((n: Node) => typeof n.props.onChangeText === 'function' && n.props.placeholder === placeholder)[0];
  return { view, texts, pressWith, input };
}

describe('LibraryPanel', () => {
  it('a forrás tételei látszanak (3D-modell nélkül), az elérhetetlen forrás offline', async () => {
    const { texts } = await mount();
    expect(texts()).toEqual(expect.arrayContaining(['Clip.mp4', 'Song.mp3', 'panels.library.workerOffline']));
    expect(texts()).not.toContain('Box.glb');
  });

  it('a videó-tétel a vizuális sáv végére kerül, a worker-URL-lel mint remoteUrl', async () => {
    mockResolve.mockResolvedValue({ uri: 'file:///imp/e1.mp4', provider: 'local' });
    const { pressWith } = await mount();
    await act(async () => pressWith('Clip.mp4').props.onPress());
    await flush();
    expect(calls).toEqual([
      [
        'addClip',
        [
          'video',
          { kind: 'video', id: 'clip_1', start: 20, duration: 9, uri: 'file:///imp/e1.mp4', trimIn: 0, sourceDuration: 9, speed: 1, volume: 1, filterId: 'none' },
          { id: 'ast_1', kind: 'video', uri: 'file:///imp/e1.mp4', provider: 'local', name: 'Clip.mp4', duration: 9, size: undefined, remoteUrl: 'http://w/files/e1' },
        ],
      ],
    ]);
  });

  it('a feloldási hiba a forrás hiba-állapotába kerül', async () => {
    mockResolve.mockRejectedValue(new Error('x'));
    const { pressWith, texts } = await mount();
    await act(async () => pressWith('Song.mp3').props.onPress());
    await flush();
    expect(calls).toEqual([]);
    expect(texts()).toContain('panels.library.downloadFailed');
  });

  it('a szűrő elrejti a nem egyező forrásokat', async () => {
    const { input, texts } = await mount();
    await act(async () => input('panels.library.searchPlaceholder').props.onChangeText('  SONG '));
    expect(texts()).toContain('Song.mp3');
    expect(texts()).not.toContain('Clip.mp4');
  });

  it('az URL-import a levágott linket és a képkocka-időpontot küldi; a hang a playheadre megy', async () => {
    mockYt.mockResolvedValueOnce({ kind: 'audio', uri: 'file:///yt.m4a', duration: 0 });
    const { input, pressWith } = await mount();
    await act(async () => input('panels.library.urlPlaceholder').props.onChangeText('  https://youtu.be/x '));
    await act(async () => pressWith('panels.library.importKind_audio').props.onPress());
    await flush();
    expect(mockYt).toHaveBeenCalledWith('https://youtu.be/x', 'audio', undefined, expect.any(Function));
    expect(calls[0][1][0]).toBe('music');
    expect(calls[0][1][1]).toMatchObject({ kind: 'audio', start: 4, duration: 10, label: 'panels.library.urlAudioLabel' });
  });

  it('a Pro-igényes import a paywallt nyitja, más hiba a szövegét mutatja', async () => {
    mockYt
      .mockRejectedValueOnce(Object.assign(new Error('pro'), { name: 'ProRequiredError', capability: 'youtubeImport' }))
      .mockRejectedValueOnce(new Error('yt down'));
    const { input, pressWith, texts } = await mount();
    await act(async () => input('panels.library.urlPlaceholder').props.onChangeText('https://youtu.be/x'));
    await act(async () => input('1').props.onChangeText('3'));
    await act(async () => pressWith('panels.library.importKind_image').props.onPress());
    await flush();
    expect(mockYt).toHaveBeenCalledWith('https://youtu.be/x', 'image', 3, expect.any(Function));
    expect(calls).toEqual([['paywall', ['youtubeImport']]]);
    await act(async () => pressWith('panels.library.importKind_video').props.onPress());
    await flush();
    expect(texts()).toContain('yt down');
  });
});
