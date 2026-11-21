/**
 * 💬 A videó-szerkesztő felirat-paneljének szerkesztési útjai valódi komponensen: a feliratok
 * egyetlen commandként mennek a command busra (undo), a pontos command-típussal és aktorral; a
 * gyors felirat időzítése, az AI-felirat, a fordítás Pro-kapuja és a hibák eredeti logCaught-
 * címkéi. A REFACTOR (szekciók és akció-gyárak a captions/ alatt) előtti viselkedést rögzíti.
 */
import { Alert } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { CaptionsPanel } from '@/components/editor/panels/CaptionsPanel';
import { useEditorStore } from '@/store/editorStore';
import { usePaywall } from '@/store/paywallStore';

jest.mock('@/components/ui/controls', () => ({
  Chip: Object.assign(() => null, { mockName: 'Chip' }),
  PrimaryButton: Object.assign(() => null, { mockName: 'PrimaryButton' }),
  PanelSection: Object.assign(({ children }: { children: unknown }) => children, { mockName: 'PanelSection' }),
}));
jest.mock('@/components/editor/AiProviderPicker', () => ({ AiProviderPicker: () => null }));
let mockIdn = 0;
jest.mock('@/lib/id', () => ({ makeId: (p: string) => `${p}_${++mockIdn}` }));
jest.mock('@/lib/logCaught', () => ({ logCaught: jest.fn() }));
const mockTranscribe = jest.fn();
jest.mock('@/lib/render', () => ({ transcribeToSrt: (u: string) => mockTranscribe(u) }));
const mockPick = jest.fn();
jest.mock('@/lib/media', () => ({ pickSrt: () => mockPick() }));
const mockTranslate = jest.fn();
jest.mock('@/lib/captionStudioClient', () => ({
  fetchCaptionSuggestions: async () => null,
  fetchCaptionTranslations: (segs: unknown, lang: string) => mockTranslate(segs, lang),
}));
jest.mock('@/lib/transcripts', () => ({ getProjectWordCues: async () => new Map() }));
jest.mock('@/lib/faceClient', () => ({ fetchFaces: async () => null, pickPrimaryFace: () => null }));
jest.mock('@/store/progressStore', () => ({ withProgress: (_l: string, fn: (r: () => void) => Promise<unknown>) => fn(() => undefined) }));

type Node = ReactTestRenderer['root'];

const cap = (id: string, start: number, text: string, y = 0.78) => ({
  kind: 'text', id, start, duration: 1.5, text, color: '#ffffff', backgroundColor: null, fontSize: 5, fontWeight: 'bold', position: { x: 0.5, y }, animation: 'pop',
});
const video = { kind: 'video', id: 'v1', uri: 'file:///a.mp4', start: 0, duration: 10, trimIn: 0, speed: 1 };
const project = (caps: unknown[] | null) => ({
  id: 'p', name: 'P', fps: 25, aspectRatio: '9:16',
  tracks: [{ id: 'tv', type: 'video', clips: [video] }, ...(caps ? [{ id: 'tc', type: 'captions', clips: caps }] : [])],
});

let calls: [string, unknown[]][];
let alerts: unknown[][];
let mounted: ReactTestRenderer | null = null;

beforeEach(() => {
  calls = [];
  alerts = [];
  mockIdn = 0;
  const rec = (name: string) => (...args: unknown[]) => void calls.push([name, args]);
  useEditorStore.setState({ project: project(null) as never, playhead: 1, dispatch: rec('dispatch'), setPanel: rec('setPanel') } as never);
  usePaywall.setState({ open: rec('paywall') } as never);
  jest.spyOn(Alert, 'alert').mockImplementation((...a: unknown[]) => void alerts.push(a));
  jest.mocked(jest.requireMock('@/lib/logCaught').logCaught).mockClear();
  [mockTranscribe, mockPick, mockTranslate].forEach((m) => m.mockReset());
});

afterEach(() => {
  act(() => mounted?.unmount());
  mounted = null;
});

async function mount() {
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(<CaptionsPanel />);
  });
  mounted = view;
  const of = (mock: string) => view.root.findAll((n: Node) => (n.type as { mockName?: string }).mockName === mock);
  const byLabel = (mock: string, label: string) => {
    const hit = of(mock).filter((n: Node) => n.props.label === label);
    expect(hit.length).toBeGreaterThan(0);
    return hit[0];
  };
  const press = async (fn: () => unknown) => {
    await act(async () => {
      await fn();
    });
  };
  return { view, of, byLabel, press };
}

describe('CaptionsPanel — szerkesztési utak', () => {
  it('a szekciók sorrendje', async () => {
    const m = await mount();
    expect(m.of('PanelSection').map((n: Node) => n.props.title)).toEqual([
      'panels.captions.autoCaptionSectionTitle',
      '✨ Caption Studio',
      'panels.captions.styleSectionTitle',
      'panels.captions.manualSectionTitle',
      'panels.captions.srtSectionTitle',
      'panels.captions.translateSectionTitle',
      'panels.captions.bilingualSectionTitle',
      'panels.captions.profanitySectionTitle',
    ]);
  });

  it('kézi felirat: soronként egy, a lejátszófejtől egyenletesen, a választott presettel, egy ADD_CLIPS-ként', async () => {
    const m = await mount();
    const input = m.view.root.findAll((n: Node) => typeof n.props.onChangeText === 'function')[0];
    await m.press(() => input.props.onChangeText(' egy \n\nkettő\nhárom'));
    await m.press(() => m.byLabel('Chip', 'panels.captions.preset_neon').props.onPress());
    await m.press(() => m.byLabel('PrimaryButton', 'panels.captions.addCaptionsFromPlayhead').props.onPress());
    const clip = (id: string, start: number, text: string) => ({
      kind: 'text', id, start, duration: 3, text, color: '#ffffff', backgroundColor: null, fontSize: 5, fontWeight: 'bold', position: { x: 0.5, y: 0.78 }, animation: 'pop', stylePreset: 'neon',
    });
    expect(calls).toEqual([
      ['dispatch', [{ type: 'ADD_CLIPS', trackType: 'captions', clips: [clip('clip_1', 1, 'egy'), clip('clip_2', 4, 'kettő'), clip('clip_3', 7, 'három')] }]],
      ['setPanel', [null]],
    ]);
  });

  it('AI-felirat: Pro-hiba → paywall; egyéb hiba → eredeti logCaught-címke + alert', async () => {
    mockTranscribe
      .mockRejectedValueOnce(Object.assign(new Error('pro'), { name: 'ProRequiredError', capability: 'transcribe' }))
      .mockRejectedValueOnce(new Error('whisper'));
    const m = await mount();
    await m.press(() => m.byLabel('PrimaryButton', 'panels.captions.captionFromSpeech').props.onPress());
    await m.press(() => m.byLabel('PrimaryButton', 'panels.captions.captionFromSpeech').props.onPress());
    expect(mockTranscribe).toHaveBeenCalledWith('file:///a.mp4');
    expect(calls).toEqual([['paywall', ['transcribe']]]);
    expect(alerts).toEqual([['panels.captions.aiCaption', 'whisper']]);
    expect(jest.requireMock('@/lib/logCaught').logCaught).toHaveBeenCalledWith('components/editor/panels/CaptionsPanel.tsx:CaptionsPanel', expect.any(Error));
  });

  it('fordítás: a lefordított szövegek egy REPLACE_TRACK_CLIPS-ként, „ai" aktorral', async () => {
    useEditorStore.setState({ project: project([cap('c1', 0, 'Szia'), cap('c2', 2, 'Világ')]) as never });
    mockTranslate.mockResolvedValue([{ id: 'c2', text: 'World' }]);
    const m = await mount();
    await m.press(() => m.of('Chip').filter((n: Node) => n.props.label === 'English')[0].props.onPress());
    expect(mockTranslate).toHaveBeenCalledWith([{ id: 'c1', text: 'Szia' }, { id: 'c2', text: 'Világ' }], 'English');
    expect(calls).toEqual([
      ['dispatch', [{ type: 'REPLACE_TRACK_CLIPS', trackType: 'captions', clips: [cap('c1', 0, 'Szia'), { ...cap('c2', 2, 'Világ'), text: 'World' }] }, 'ai']],
    ]);
  });

  it('káromkodás-maszk és safe-zone: aktor nélküli REPLACE_TRACK_CLIPS; SRT-hiba → eredeti címke', async () => {
    useEditorStore.setState({ project: project([cap('c1', 0, 'oh shit', 0.97)]) as never });
    mockPick.mockRejectedValue(new Error('picker'));
    const m = await mount();
    await m.press(() => m.byLabel('Chip', 'panels.captions.profanityStars').props.onPress());
    await m.press(() => m.byLabel('Chip', 'panels.captions.safeZoneChip').props.onPress());
    await m.press(() => m.byLabel('PrimaryButton', 'panels.captions.importSrtButton').props.onPress());
    expect(calls.map(([name, args]) => [name, (args[0] as { type: string }).type, args.length])).toEqual([
      ['dispatch', 'REPLACE_TRACK_CLIPS', 1],
      ['dispatch', 'REPLACE_TRACK_CLIPS', 1],
    ]);
    expect(alerts.map((a) => a[0])).toEqual(['panels.captions.profanityTitle', 'panels.captions.safeZoneTitle', 'common.error']);
    expect(jest.requireMock('@/lib/logCaught').logCaught).toHaveBeenCalledWith('components/editor/panels/CaptionsPanel.tsx:CaptionsPanel', expect.any(Error));
  });
});
