/**
 * 🔷 A Forma-panel szerkesztési útjai valódi komponensen: melyik vezérlő milyen store-műveletet
 * hív (minden a command buson át, undo-val), a boolean-kombináció sorrendje és az
 * objektum-követés ágai. A REFACTOR (szekciók a shape/ alatt) előtti viselkedést rögzíti.
 */
import { Alert } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { ShapePanel } from '@/components/editor/panels/ShapePanel';
import { useEditorStore } from '@/store/editorStore';
import type { ShapeClip } from '@/types/project';

// a vezérlők itt csak a propjaikat hordozzák
jest.mock('@/components/ui/controls', () => ({
  Chip: Object.assign(() => null, { mockName: 'Chip' }),
  ColorDot: Object.assign(() => null, { mockName: 'ColorDot' }),
  Stepper: Object.assign(() => null, { mockName: 'Stepper' }),
  PanelSection: Object.assign(({ children }: { children: unknown }) => children, { mockName: 'PanelSection' }),
}));
jest.mock('@/components/editor/PathEditor', () => ({ PathEditor: Object.assign(() => null, { mockName: 'PathEditor' }) }));
jest.mock('@/lib/id', () => ({ makeId: (p: string) => `${p}_1` }));
jest.mock('@/lib/logCaught', () => ({ logCaught: jest.fn() }));
const mockTrack = jest.fn();
jest.mock('@/lib/track', () => ({ ...jest.requireActual('@/lib/trackPlan'), trackSubject: (...a: unknown[]) => mockTrack(...a) }));

type Node = ReactTestRenderer['root'];

const rect = { kind: 'shape', id: 's1', start: 2, duration: 5, shape: 'rectangle', position: { x: 0.4, y: 0.5 }, w: 0.5, h: 0.3, fill: '#ffffff' } as ShapeClip;
const other = { kind: 'shape', id: 'o1', start: 1, duration: 3, shape: 'ellipse', position: { x: 0.5, y: 0.5 }, w: 0.3, h: 0.3, fill: '#00ff00' };
const video = { kind: 'video', id: 'v1', uri: 'file:///v.mp4', start: 0, duration: 20, trimIn: 1, speed: 2 };
const project = { id: 'p', name: 'P', aspectRatio: '9:16', tracks: [{ id: 'tv', type: 'video', clips: [video] }, { id: 'to', type: 'overlay', clips: [rect, other] }] };

let calls: [string, unknown[]][];
let alerts: unknown[][];
let pick: ((p: { x: number; y: number }) => void) | null;

beforeEach(() => {
  calls = [];
  alerts = [];
  pick = null;
  const rec = (name: string) => (...args: unknown[]) => void calls.push([name, args]);
  useEditorStore.setState({
    project: project as never,
    playhead: 3,
    snapGrid: 6,
    multiSelectIds: [],
    updateClip: rec('updateClip'),
    removeClip: rec('removeClip'),
    addClip: rec('addClip'),
    selectClip: rec('selectClip'),
    setSnapGrid: rec('setSnapGrid'),
    setPickTarget: (fn: typeof pick) => void (pick = fn),
  } as never);
  jest.spyOn(Alert, 'alert').mockImplementation((...a: unknown[]) => void alerts.push(a));
  mockTrack.mockReset();
});

async function mount(clip: ShapeClip) {
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(<ShapePanel clip={clip} />);
  });
  const of = (mock: string) => view.root.findAll((n: Node) => (n.type as { mockName?: string }).mockName === mock);
  const byLabel = (mock: string, label: string) => {
    const hit = of(mock).filter((n: Node) => n.props.label === label);
    expect(hit).toHaveLength(1);
    return hit[0];
  };
  return { view, of, byLabel };
}

describe('ShapePanel — szerkesztési utak', () => {
  it('a szekciók sorrendje és a forma-fajta / méret / rács vezérlői a klip-frissítésen át mennek', async () => {
    const m = await mount(rect);
    expect(m.of('PanelSection').map((n: Node) => n.props.title)).toEqual([
      'panels.shape.shapeTitle',
      'panels.shape.boolTitle',
      'panels.shape.fillTitle',
      'panels.shape.blendTitle',
      'panels.shape.sizeStyleTitle',
      'panels.shape.alignTitle',
      'panels.shape.glowOutlineTitle',
      'panels.shape.trackSectionTitle',
    ]);
    await act(async () => m.byLabel('Chip', 'panels.shape.shapeEllipse').props.onPress());
    await act(async () => m.byLabel('Stepper', 'panels.shape.height').props.onDec());
    await act(async () => m.byLabel('Stepper', 'panels.shape.cornerRadius').props.onInc());
    await act(async () => m.byLabel('Chip', '12×12').props.onPress());
    expect(calls).toEqual([
      ['updateClip', ['s1', { shape: 'ellipse' }]],
      ['updateClip', ['s1', { h: 0.25 }]],
      ['updateClip', ['s1', { cornerRadius: 0.05 }]],
      ['setSnapGrid', [12]],
    ]);
  });

  it('fejlett gradiens: típusváltás alapértékből, szög-léptetés körbe, új stop rendezve', async () => {
    const m = await mount({ ...rect, gradient: { type: 'linear', angle: 350, stops: [{ color: '#000000', at: 0 }, { color: '#ffffff', at: 1 }] } });
    await act(async () => m.byLabel('Stepper', 'panels.shape.gradAngle').props.onInc());
    await act(async () => m.byLabel('Chip', 'panels.shape.gradAddStop').props.onPress());
    expect(calls[0]).toEqual(['updateClip', ['s1', { gradient: { type: 'linear', angle: 5, stops: [{ color: '#000000', at: 0 }, { color: '#ffffff', at: 1 }] } }]]);
    expect((calls[1][1][1] as { gradient: { stops: { at: number }[] } }).gradient.stops.map((s) => s.at)).toEqual([0, 0.5, 1]);
  });

  it('boolean: a két forma törlése, az új path hozzáadása az overlay-sávra, majd kijelölés — ebben a sorrendben', async () => {
    useEditorStore.setState({ multiSelectIds: ['o1'] } as never);
    const m = await mount(rect);
    await act(async () => m.byLabel('Chip', 'panels.shape.bool_union').props.onPress());
    expect(calls.map(([n, a]) => [n, n === 'addClip' ? a[0] : a[0]])).toEqual([
      ['removeClip', 's1'],
      ['removeClip', 'o1'],
      ['addClip', 'overlay'],
      ['selectClip', 'clip_1'],
    ]);
    expect(calls[2][1][1]).toMatchObject({ kind: 'shape', id: 'clip_1', shape: 'path', start: 1, duration: 6, fill: '#ffffff' });
  });

  it('követés: a pick-cél beállítása, sikeres követés → pozíció-kulcskockák egy frissítésben; hibás ablak → csak figyelmeztetés', async () => {
    mockTrack.mockResolvedValue([{ t: 0, x: 0.5, y: 0.5 }, { t: 1, x: 0.6, y: 0.5 }]);
    const m = await mount(rect);
    await act(async () => m.byLabel('Chip', 'panels.shape.trackObject').props.onPress());
    expect(alerts[0]).toEqual(['panels.shape.trackTitle', 'panels.shape.trackPickHint']);
    await act(async () => pick!({ x: 0.3, y: 0.6 }));
    expect(mockTrack).toHaveBeenCalledWith('file:///v.mp4', { startSec: 7, durationSec: 8, cx: 0.3, cy: 0.6, aspectW: 9 / 16, aspectH: 1 });
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe('updateClip');
    expect(Object.keys((calls[0][1][1] as { keyframes: object }).keyframes)).toEqual(['x', 'y']);
    useEditorStore.setState({ playhead: 8 } as never);
    await act(async () => pick!({ x: 0.3, y: 0.6 }));
    expect(alerts.at(-1)).toEqual(['panels.shape.trackTitle', 'panels.shape.trackPlayheadOnClip']);
    expect(mockTrack).toHaveBeenCalledTimes(1);
  });
});
