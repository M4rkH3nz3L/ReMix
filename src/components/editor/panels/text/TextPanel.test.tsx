/**
 * 🔤 A videó-szerkesztő szöveg-paneljének szerkesztési útjai valódi komponensen: melyik vezérlő
 * milyen klip-frissítést hív (a store-on, azaz a command buson át, undo-val), a tabok, a
 * granuláris stílus, a szöveg → forma és a követés ágai. A REFACTOR (szekciók a text/ alatt)
 * előtti viselkedést rögzíti.
 */
import { Alert } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { TextPanel } from '@/components/editor/panels/TextPanel';
import { textAnimations } from '@/constants/editor';
import { useEditorStore } from '@/store/editorStore';
import type { TextClip } from '@/types/project';

jest.mock('@/components/ui/controls', () => ({
  Chip: Object.assign(() => null, { mockName: 'Chip' }),
  ColorDot: Object.assign(() => null, { mockName: 'ColorDot' }),
  Stepper: Object.assign(() => null, { mockName: 'Stepper' }),
  PrimaryButton: Object.assign(() => null, { mockName: 'PrimaryButton' }),
  PanelSection: Object.assign(({ children }: { children: unknown }) => children, { mockName: 'PanelSection' }),
}));
jest.mock('@/lib/id', () => ({ makeId: (p: string) => `${p}_1` }));
jest.mock('@/lib/logCaught', () => ({ logCaught: jest.fn() }));
const mockTrack = jest.fn();
jest.mock('@/lib/track', () => ({ ...jest.requireActual('@/lib/trackPlan'), trackSubject: (...a: unknown[]) => mockTrack(...a) }));
const mockBake = jest.fn();
jest.mock('@/lib/textBake', () => ({ bakeTextToImage: (...a: unknown[]) => mockBake(...a) }));
jest.mock('@/lib/faceClient', () => ({ fetchFaces: async () => null, pickPrimaryFace: () => null }));

type Node = ReactTestRenderer['root'];

const clip = {
  kind: 'text', id: 't1', start: 2, duration: 6, text: 'Hello', color: '#ffffff', backgroundColor: null, fontSize: 6,
  fontWeight: 'bold', position: { x: 0.5, y: 0.5 }, animation: 'none', letterSpacing: 0.04,
  textStyle: { glow: { color: '#ffffff', size: 0.4 } },
} as TextClip;
const video = { kind: 'video', id: 'v1', uri: 'file:///v.mp4', start: 0, duration: 20, trimIn: 1, speed: 2 };
const project = { id: 'p', name: 'P', fps: 30, aspectRatio: '9:16', tracks: [{ id: 'tv', type: 'video', clips: [video] }, { id: 'tt', type: 'text', clips: [clip] }] };

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
    updateClip: rec('updateClip'),
    addClip: rec('addClip'),
    selectClip: rec('selectClip'),
    setPanel: rec('setPanel'),
    setPickTarget: rec('setPickTarget'),
  } as never);
  jest.spyOn(Alert, 'alert').mockImplementation((...a: unknown[]) => void alerts.push(a));
  jest.mocked(jest.requireMock('@/lib/logCaught').logCaught).mockClear();
  mockTrack.mockReset();
  mockBake.mockReset();
});

afterEach(() => {
  act(() => mounted?.unmount());
  mounted = null;
});

async function mount(tab?: 'anim' | 'extra') {
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(<TextPanel clip={clip} />);
  });
  mounted = view;
  if (tab) {
    const tabBtn = view.root.findAll(
      (n: Node) => typeof n.props.onPress === 'function' && n.findAll((c: Node) => c.props.children === `panels.text.tab_${tab}`).length > 0
    );
    await act(async () => tabBtn[0].props.onPress());
  }
  const of = (mock: string) => view.root.findAll((n: Node) => (n.type as { mockName?: string }).mockName === mock);
  const byLabel = (mock: string, label: string) => {
    const hit = of(mock).filter((n: Node) => n.props.label === label);
    expect(hit).toHaveLength(1);
    return hit[0];
  };
  return { view, of, byLabel };
}

describe('TextPanel — szerkesztési utak', () => {
  it('a Stílus tab szekciói sorrendben', async () => {
    const m = await mount();
    expect(m.of('PanelSection').map((n: Node) => n.props.title)).toEqual([
      'panels.text.sectionText',
      'panels.text.sectionTemplates',
      'panels.text.sectionStylePreset',
      'panels.text.sectionFont',
      'panels.text.sectionColor',
      'panels.text.sectionBackground',
      'panels.text.sectionTypography',
      'panels.text.sectionTextStyle',
      'panels.text.section3d',
      'panels.text.sectionSize',
    ]);
  });

  it('tipográfia és granuláris stílus: pontos értékek, az utolsó stílus kikapcsolása törli a textStyle-t', async () => {
    const m = await mount();
    expect(m.byLabel('Stepper', 'panels.text.tracking').props.value).toBe('+4');
    m.byLabel('Stepper', 'panels.text.tracking').props.onInc();
    m.byLabel('Stepper', 'panels.text.styleGlowSize').props.onInc();
    m.byLabel('Chip', 'panels.text.styleGlow').props.onPress();
    m.byLabel('Chip', 'panels.text.material_gold').props.onPress();
    expect(calls).toEqual([
      ['updateClip', ['t1', { letterSpacing: 0.06 }]],
      ['updateClip', ['t1', { textStyle: { glow: { color: '#ffffff', size: 0.5 } } }]],
      ['updateClip', ['t1', { textStyle: undefined }]],
      ['updateClip', ['t1', { text3d: { depth: 0.5, tiltX: 10, tiltY: -12, material: 'gold' } }]],
    ]);
  });

  it('Animáció tab: kinetikus preset szó-bontással, az animáció-chip törli a textMotiont', async () => {
    const m = await mount('anim');
    m.byLabel('Chip', 'panels.text.kinetic_wave').props.onPress();
    m.byLabel('Chip', textAnimations[1].label).props.onPress();
    expect(calls).toEqual([
      ['updateClip', ['t1', { textMotion: { by: 'word', preset: 'wave' } }]],
      ['updateClip', ['t1', { animation: textAnimations[1].id, textMotion: undefined }]],
    ]);
  });

  it('szöveg → forma: kép-kitöltésű forma-klip az overlay sávon, majd kijelölés', async () => {
    mockBake.mockResolvedValue({ uri: 'file:///b.png', w: 540, h: 96, canvasW: 1080, canvasH: 1920 });
    const m = await mount('extra');
    await act(async () => m.byLabel('PrimaryButton', 'panels.text.toShape').props.onPress());
    expect(mockBake).toHaveBeenCalledWith(clip, 9 / 16);
    expect(calls).toEqual([
      ['addClip', ['overlay',
        { kind: 'shape', id: 'clip_1', start: 2, duration: 6, shape: 'rectangle', position: { x: 0.5, y: 0.5 }, w: 0.5, h: 0.05, fill: 'transparent', imageUri: 'file:///b.png', keyframes: undefined },
        { id: 'ast_1', kind: 'image', uri: 'file:///b.png', provider: 'local', name: 'text-shape' }]],
      ['selectClip', ['clip_1']],
    ]);
  });

  it('követés: a worker-hiba az eredeti logCaught-címkével és alerttel; a pont-kijelölő bezárja a panelt', async () => {
    mockTrack.mockRejectedValue(new Error('net'));
    const m = await mount('extra');
    await act(async () => m.byLabel('PrimaryButton', 'panels.text.trackFromPlayhead').props.onPress());
    expect(mockTrack).toHaveBeenCalledWith('file:///v.mp4', { startSec: 7, durationSec: 10, cx: 0.5, cy: 0.5, aspectW: 9 / 16, aspectH: 1 });
    expect(jest.requireMock('@/lib/logCaught').logCaught).toHaveBeenCalledWith('components/editor/panels/TextPanel.tsx:TextPanel', expect.any(Error));
    expect(alerts).toEqual([['panels.text.trackTitle', 'net']]);
    await act(async () => m.byLabel('PrimaryButton', 'panels.text.pickPoint').props.onPress());
    expect(calls.map(([name, args]) => [name, typeof args[0]])).toEqual([
      ['setPanel', 'object'],
      ['setPickTarget', 'function'],
    ]);
  });
});
