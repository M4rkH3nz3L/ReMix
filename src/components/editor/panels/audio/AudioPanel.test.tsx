/**
 * 🎛️ A videó-szerkesztő hang-paneljének szerkesztési útjai valódi komponensen: melyik vezérlő
 * milyen store-műveletet hív (a klip-frissítés a command buson át, undo-val), a keverő- és FX-
 * értékek pontosan, a beat-, könyvtár-, dub- és felvétel-ágak. A REFACTOR (szekciók az audio/
 * alatt) előtti viselkedést rögzíti.
 */
import { Alert } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { AudioPanel } from '@/components/editor/panels/AudioPanel';
import { useEditorStore } from '@/store/editorStore';
import type { AudioClip } from '@/types/project';

jest.mock('@/components/ui/controls', () => ({
  Chip: Object.assign(() => null, { mockName: 'Chip' }),
  Stepper: Object.assign(() => null, { mockName: 'Stepper' }),
  PrimaryButton: Object.assign(() => null, { mockName: 'PrimaryButton' }),
  PanelSection: Object.assign(({ children }: { children: unknown }) => children, { mockName: 'PanelSection' }),
}));
jest.mock('@/components/editor/KeyframeGraphEditor', () => ({ KeyframeGraphEditor: Object.assign(() => null, { mockName: 'KeyframeGraphEditor' }) }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/lib/id', () => ({ makeId: (p: string) => `${p}_1` }));
jest.mock('@/lib/logCaught', () => ({ logCaught: jest.fn() }));
const mockPerm = jest.fn();
const mockStart = jest.fn();
jest.mock('expo-audio', () => ({
  RecordingPresets: { HIGH_QUALITY: {} },
  useAudioRecorder: () => ({}),
  useAudioRecorderState: () => ({ isRecording: false, durationMillis: 0 }),
  AudioModule: { requestRecordingPermissionsAsync: () => mockPerm() },
}));
jest.mock('@/hooks/useFinishRecordingOnLeave', () => ({ useFinishRecordingOnLeave: () => undefined }));
const mockGenerate = jest.fn();
jest.mock('@/hooks/useTtsEngine', () => ({
  useTtsEngine: () => ({ available: true, needsPro: false, choices: [], selected: undefined, setSelected: () => undefined, generate: (s: string) => mockGenerate(s) }),
}));
const mockDownload = jest.fn();
jest.mock('@/lib/render', () => ({
  fetchSoundLibrary: async () => [{ id: 'sfx1', kind: 'sfx', name: 'Boom', duration: 0.26 }],
  downloadTrack: (t: unknown) => mockDownload(t),
}));
const mockDetect = jest.fn();
jest.mock('@/lib/beats', () => ({ timelineBeats: jest.requireActual('@/lib/cutplan').timelineBeats, detectBeats: (u: string) => mockDetect(u) }));
jest.mock('@/lib/media', () => ({ pickAudio: async () => null }));
jest.mock('@/lib/voiceRecording', () => ({
  ...jest.requireActual('@/lib/voiceRecording'),
  startVoiceRecording: () => mockStart(),
  stopVoiceRecording: async () => ({ uri: null, seconds: 0 }),
}));
jest.mock('@/store/paywallStore', () => ({ guardPro: async (fn: () => Promise<unknown>, onError?: (e: Error) => void) => fn().catch((e: Error) => onError?.(e)) }));

type Node = ReactTestRenderer['root'];

const music = { kind: 'audio', id: 'a1', start: 1, duration: 3, uri: 'file:///m.mp3', label: 'Song', volume: 1, fadeIn: 1.4, fadeOut: 0, source: 'imported', pan: -0.4, assetId: 'as1', audioFx: { highpass: 80, lowpass: 16000, eq: { low: 12, mid: 0, high: -3 }, reverb: 0.9 } } as AudioClip;
const caps = { id: 'tc', type: 'captions', clips: [{ kind: 'text', id: 'c2', start: 3, duration: 1, text: 'world' }, { kind: 'text', id: 'c1', start: 2, duration: 1, text: 'hello' }] };
const project = { id: 'p', name: 'P', fps: 25, aspectRatio: '9:16', assets: [{ id: 'as1', kind: 'audio', uri: 'x', source: { projectId: 'ap1', name: 'Mix' } }], tracks: [{ id: 'tm', type: 'music', clips: [music] }, caps] };

let calls: [string, unknown[]][];
let mounted: ReactTestRenderer | null = null;
let alerts: unknown[][];

beforeEach(() => {
  calls = [];
  alerts = [];
  const rec = (name: string, ret?: unknown) => (...args: unknown[]) => { calls.push([name, args]); return ret; };
  useEditorStore.setState({
    project: project as never,
    playhead: 2,
    suggestedCuts: [],
    beatTimes: [],
    updateClip: rec('updateClip'),
    addClip: rec('addClip'),
    setBeatGrid: rec('setBeatGrid'),
    markersFromBeats: rec('markersFromBeats', 3),
    cutsFromBeats: rec('cutsFromBeats'),
    setPlayhead: rec('setPlayhead'),
    openAudioStudio: rec('openAudioStudio'),
  } as never);
  jest.spyOn(Alert, 'alert').mockImplementation((...a: unknown[]) => void alerts.push(a));
  jest.mocked(jest.requireMock('@/lib/logCaught').logCaught).mockClear();
  [mockPerm, mockStart, mockGenerate, mockDownload, mockDetect].forEach((m) => m.mockReset());
});

afterEach(() => {
  act(() => mounted?.unmount());
  mounted = null;
});

async function mount(clip: AudioClip | null) {
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(<AudioPanel clip={clip} />);
  });
  mounted = view;
  const of = (mock: string) => view.root.findAll((n: Node) => (n.type as { mockName?: string }).mockName === mock);
  const byLabel = (mock: string, label: string) => {
    const hit = of(mock).filter((n: Node) => n.props.label === label);
    expect(hit).toHaveLength(1);
    return hit[0];
  };
  const press = async (fn: () => unknown) => {
    await act(async () => {
      await fn();
    });
  };
  return { view, of, byLabel, press };
}

describe('AudioPanel — szerkesztési utak', () => {
  it('a szekciók sorrendje kijelölt klippel, hang-sávval és linkelt forrással', async () => {
    const m = await mount(music);
    expect(m.of('PanelSection').map((n: Node) => n.props.title)).toEqual([
      'panels.audio.libraryTitle',
      'panels.audio.ownFileTitle',
      'panels.audio.voiceoverTitle',
      'panels.audio.ttsTitle',
      'panels.audio.beatTitle',
      'panels.audio.source.linked',
      'panels.audio.mixTitle',
      'panels.audio.fxTitle',
    ]);
  });

  it('a keverő és az FX léptetői pontos értékkel a klip-frissítésen át mennek', async () => {
    const m = await mount(music);
    const step = (label: string, dir: 'onDec' | 'onInc') => m.byLabel('Stepper', label).props[dir]();
    step('Fade in', 'onInc');
    step('Fade out', 'onDec');
    step('panels.audio.pan', 'onDec');
    step('panels.audio.fxHighpass', 'onDec');
    step('panels.audio.fxLowpass', 'onInc');
    step('panels.audio.fxEqLow', 'onInc');
    step('panels.audio.fxReverb', 'onInc');
    m.byLabel('Chip', 'panels.audio.autoDuck').props.onPress();
    expect(calls).toEqual([
      ['updateClip', ['a1', { fadeIn: 1.5 }]],
      ['updateClip', ['a1', { fadeOut: 0 }]],
      ['updateClip', ['a1', { pan: -0.6 }]],
      ['updateClip', ['a1', { audioFx: { ...music.audioFx, highpass: 60 } }]],
      ['updateClip', ['a1', { audioFx: { ...music.audioFx, lowpass: 0 } }]],
      ['updateClip', ['a1', { audioFx: { ...music.audioFx, eq: { low: 12, mid: 0, high: -3 } } }]],
      ['updateClip', ['a1', { audioFx: { ...music.audioFx, reverb: 1 } }]],
      ['updateClip', ['a1', { autoDuck: true }]],
    ]);
  });

  it('beat → marker: a zenesávból detektál, rácsot ír, a választott módban jelöl', async () => {
    mockDetect.mockResolvedValue({ beats: [0.5, 1], downbeats: [0.5] });
    const m = await mount(music);
    await m.press(() => m.byLabel('Chip', 'panels.audio.beatEveryBeat').props.onPress());
    await m.press(() => m.byLabel('Chip', 'panels.audio.beatToMarkers').props.onPress());
    expect(mockDetect).toHaveBeenCalledWith('file:///m.mp3');
    expect(calls).toEqual([
      ['setBeatGrid', [[1.5, 2], [1.5]]],
      ['markersFromBeats', ['beat']],
    ]);
    expect(alerts).toEqual([['panels.audio.beatTitle', 'panels.audio.beatMarkersDone']]);
  });

  it('könyvtár: az SFX a saját sávjára kerül; letöltési hiba → eredeti logCaught-címke + alert', async () => {
    mockDownload.mockResolvedValueOnce('file:///boom.mp3').mockRejectedValueOnce(new Error('net'));
    const m = await mount(null);
    const row = () => m.view.root.findAll((n: Node) => typeof n.props.onPress === 'function' && n.props.style?.paddingVertical === 8 && n.props.hitSlop === undefined)[0];
    await m.press(() => row().props.onPress());
    expect(calls).toEqual([
      ['addClip', ['sfx',
        { kind: 'audio', id: 'clip_1', start: 2, duration: 0.3, uri: 'file:///boom.mp3', label: 'Boom', volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported' },
        { id: 'ast_1', kind: 'audio', uri: 'file:///boom.mp3', provider: 'library', name: 'Boom', duration: 0.3 }]],
    ]);
    await m.press(() => row().props.onPress());
    expect(jest.requireMock('@/lib/logCaught').logCaught).toHaveBeenCalledWith('components/editor/panels/AudioPanel.tsx:addFromLibrary', expect.any(Error));
    expect(alerts).toEqual([['common.error', 'panels.audio.downloadFailed']]);
  });

  it('dub: a feliratok időrendben, a lejátszófej a beszéd elejére, a voiceover-sávra kerül', async () => {
    mockGenerate.mockResolvedValue({ uri: 'file:///dub.m4a', duration: 4 });
    const m = await mount(null);
    await m.press(() => m.byLabel('PrimaryButton', 'panels.audio.dubBtn').props.onPress());
    expect(mockGenerate).toHaveBeenCalledWith('hello world');
    expect(calls.map(([name, args]) => [name, args[0]])).toEqual([
      ['setPlayhead', 2],
      ['addClip', 'voiceover'],
    ]);
    expect(alerts).toEqual([['panels.audio.dubTitle', 'panels.audio.dubDone']]);
  });

  it('felvétel: megtagadott mikrofon → alert; indítási hiba → toggleRecord-címke + üzenet', async () => {
    mockPerm.mockResolvedValueOnce({ granted: false }).mockResolvedValueOnce({ granted: true });
    mockStart.mockRejectedValueOnce(new Error('no space'));
    const m = await mount(null);
    const btn = () => m.byLabel('PrimaryButton', 'panels.audio.startRecording');
    await m.press(() => btn().props.onPress());
    await m.press(() => btn().props.onPress());
    expect(alerts).toEqual([
      ['panels.audio.micPermissionTitle', 'panels.audio.micPermissionMessage'],
      ['panels.audio.recordFailedTitle', 'no space'],
    ]);
    expect(jest.requireMock('@/lib/logCaught').logCaught).toHaveBeenCalledWith('components/editor/panels/AudioPanel.tsx:toggleRecord', expect.any(Error));
  });
});
