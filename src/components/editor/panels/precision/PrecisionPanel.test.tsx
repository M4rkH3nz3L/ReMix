/**
 * 🎯 A Precíziós panel szerkesztési útjai valódi komponensen: a timebase a command buson
 * (`SET_FPS`), a kezdet/hossz és a lejátszófej léptetése a lépés-mód szerint (mp / frame-rács),
 * a Graph Editor csatornái és a compound-proxy. A REFACTOR (szekciók a precision/ alatt) előtti
 * viselkedést rögzíti.
 */
import { Alert } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { PrecisionPanel } from '@/components/editor/panels/PrecisionPanel';
import { useEditorStore } from '@/store/editorStore';
import type { Clip } from '@/types/project';

// a vezérlők itt csak a propjaikat hordozzák
jest.mock('@/components/ui/controls', () => ({
  Chip: Object.assign(() => null, { mockName: 'Chip' }),
  Stepper: Object.assign(() => null, { mockName: 'Stepper' }),
  PanelSection: Object.assign(({ children }: { children: unknown }) => children, { mockName: 'PanelSection' }),
}));
jest.mock('@/components/editor/KeyframeGraphEditor', () => ({ KeyframeGraphEditor: Object.assign(() => null, { mockName: 'KeyframeGraphEditor' }) }));
jest.mock('@/lib/logCaught', () => ({ logCaught: jest.fn() }));
const mockRender = jest.fn();
jest.mock('@/lib/render', () => ({
  renderMp4: (...a: unknown[]) => mockRender(...a),
  isRenderCancelledError: (e: unknown) => (e as { name?: string })?.name === 'RenderCancelledError',
}));

type Node = ReactTestRenderer['root'];

const video = {
  kind: 'video', id: 'v1', uri: 'file:///v.mp4', start: 1.234, duration: 4, trimIn: 0, speed: 1, sourceDuration: 5.3,
  transform: { scale: 1, x: 0, y: 0, rotation: 357 },
  keyframes: { rotation: [{ t: 1, v: 30 }] },
  comp: { aspectRatio: '1:1', tracks: [{ id: 'a', type: 'video', clips: [] }], assets: [] },
} as unknown as Clip;

let calls: [string, unknown[]][];
let alerts: unknown[][];

beforeEach(() => {
  calls = [];
  alerts = [];
  const rec = (name: string) => (...args: unknown[]) => void calls.push([name, args]);
  useEditorStore.setState({
    project: { id: 'p', fps: 25, tracks: [] } as never,
    playhead: 2,
    updateClip: rec('updateClip'),
    setPlayhead: rec('setPlayhead'),
    dispatch: rec('dispatch'),
    setPickTarget: rec('setPickTarget'),
  } as never);
  jest.spyOn(Alert, 'alert').mockImplementation((...a: unknown[]) => void alerts.push(a));
  mockRender.mockReset();
});

async function mount(clip: Clip) {
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(<PrecisionPanel clip={clip} />);
  });
  const of = (mock: string) => view.root.findAll((n: Node) => (n.type as { mockName?: string }).mockName === mock);
  const byLabel = (mock: string, label: string) => {
    const hit = of(mock).filter((n: Node) => n.props.label === label);
    expect(hit).toHaveLength(1);
    return hit[0];
  };
  return { view, of, byLabel };
}

describe('PrecisionPanel — szerkesztési utak', () => {
  it('timebase: a fps-chip a command buson megy (SET_FPS); a timecode a projekt fps-ével', async () => {
    const m = await mount(video);
    expect(m.of('Chip').slice(0, 5).map((n: Node) => [n.props.label, n.props.active])).toEqual([
      ['24', false], ['25', true], ['30', false], ['50', false], ['60', false],
    ]);
    expect(m.byLabel('Stepper', 'panels.precision.start').props.value).toBe('00:00:01:06');
    await act(async () => m.byLabel('Chip', '60').props.onPress());
    expect(calls).toEqual([['dispatch', [{ type: 'SET_FPS', fps: 60 }]]]);
  });

  it('mp-mód: századra kerekít, a hossz a forrás végénél megáll; frame-mód: a frame-rácsra ül', async () => {
    const m = await mount(video);
    await act(async () => m.byLabel('Stepper', 'panels.precision.start').props.onInc());
    await act(async () => m.byLabel('Stepper', 'panels.precision.length').props.onInc());
    await act(async () => m.byLabel('Chip', 'panels.precision.nudgeFwdSec').props.onPress());
    await act(async () => m.byLabel('Chip', 'panels.precision.stepFrame').props.onPress());
    await act(async () => m.byLabel('Stepper', 'panels.precision.start').props.onInc());
    await act(async () => m.byLabel('Chip', 'panels.precision.nudgeBackFrame').props.onPress());
    expect(calls).toEqual([
      ['updateClip', ['v1', { start: 1.33 }]],
      ['updateClip', ['v1', { duration: 4.1 }]],
      ['setPlayhead', [2.1]],
      ['updateClip', ['v1', { start: 1.28 }]],
      ['setPlayhead', [1.96]],
    ]);
  });

  it('Graph Editor: a csatorna-váltás a görbét cseréli, az üres görbe törli a csatornát', async () => {
    const m = await mount(video);
    await act(async () => m.byLabel('Chip', 'panels.precision.chRotation').props.onPress());
    const g = m.of('KeyframeGraphEditor')[0];
    expect([g.props.keyframes, g.props.min, g.props.max, g.props.fallback, g.props.playhead]).toEqual([[{ t: 1, v: 30 }], -180, 180, 357, 2 - 1.234]);
    await act(async () => g.props.onChange([]));
    await act(async () => g.props.onSeek(0.5));
    expect(calls).toEqual([
      ['updateClip', ['v1', { keyframes: { rotation: undefined } }]],
      ['setPlayhead', [1.734]],
    ]);
  });

  it('megjelenés: a forgatás 360°-on körbefordul; compound-proxy: a klip uri-ja a proxyra cserélődik', async () => {
    mockRender.mockResolvedValue({ uri: 'file:///proxy.mp4' });
    const m = await mount(video);
    await act(async () => m.byLabel('Stepper', 'panels.precision.rotation').props.onInc());
    expect(calls[0]).toEqual(['updateClip', ['v1', { transform: { scale: 1, x: 0, y: 0, rotation: 2 } }]]);
    await act(async () => m.byLabel('Chip', 'panels.precision.compoundRender').props.onPress());
    expect(mockRender.mock.calls[0][0]).toMatchObject({ id: 'v1-comp', name: 'comp', aspectRatio: '1:1', schemaVersion: 4 });
    expect(calls[1]).toEqual(['updateClip', ['v1', { uri: 'file:///proxy.mp4' }]]);
    expect(alerts).toEqual([['panels.precision.compoundDoneTitle', 'panels.precision.compoundDoneBody']]);
  });
});
