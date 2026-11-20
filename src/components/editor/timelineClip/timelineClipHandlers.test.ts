import { createTimelineClipHandlers } from '@/components/editor/timelineClip/timelineClipHandlers';
import { useEditorStore } from '@/store/editorStore';
import type { TrimMode } from '@/store/editorStore';
import type { VideoClip } from '@/types/project';
import type { TFunction } from 'i18next';

// a modul a design-réteg haptikáját húzza be (Reanimated) — itt csak a hívás számít
jest.mock('@/design', () => ({ haptics: { selection: jest.fn(), impact: jest.fn() } }));

/**
 * 🖐️ A TimelineClip gesztus-célpontjai: melyik STORE-AKCIÓ fut, milyen
 * argumentumokkal (ez az undo alapja) — a jelenlegi viselkedés rögzítve.
 */

const clip: VideoClip = {
  id: 'c1', kind: 'video', start: 2, duration: 4,
  uri: 'file:///v.mp4', trimIn: 1, sourceDuration: 10,
  speed: 1, volume: 1, filterId: 'none',
};

const sv = () => ({ value: 7 }) as never;
const t = ((k: string) => k) as unknown as TFunction;

function setup(trimMode: TrimMode = 'normal', storeOver: Record<string, unknown> = {}) {
  const actions = {
    slipEdit: jest.fn(),
    slideEdit: jest.fn(),
    rollEdit: jest.fn(),
    rippleResize: jest.fn(() => false),
    nudgeClipsBy: jest.fn(),
    nudgeSelectedBy: jest.fn(),
    moveClipByTrackStep: jest.fn(() => false),
    linkGroupOf: jest.fn(() => null),
  };
  useEditorStore.setState({
    ...actions,
    snapStrength: 'off',
    multiSelectIds: [],
    selectedClipId: null,
    rippleMode: false,
    ...storeOver,
  } as never);
  const params = {
    clip,
    trackType: 'video' as const,
    pps: 100,
    height: 60,
    locked: false,
    trimMode,
    multiSelectMode: false,
    selectClip: jest.fn(),
    toggleMultiSelect: jest.fn(),
    toggleTrackFlag: jest.fn(),
    updateClip: jest.fn(),
    t,
    setEdge: jest.fn(),
    moveDX: sv(),
    leftDelta: sv(),
    rightDelta: sv(),
  };
  return { actions, params, h: createTimelineClipHandlers(params) };
}

describe('createTimelineClipHandlers — commitMove', () => {
  it('sima húzás → updateClip a pps-sel átváltott új kezdettel, a moveDX nullázva', () => {
    const { params, h } = setup();
    h.commitMove(150);
    expect(params.moveDX).toEqual({ value: 0 });
    expect(params.updateClip).toHaveBeenCalledWith('c1', { start: 3.5 });
  });

  it('🧲 a kezdet vagy a vég a küszöbön (SNAP_PX × erősség / pps) belüli célponthoz illeszkedik, haptikával', () => {
    const { haptics } = jest.requireMock('@/design') as { haptics: { selection: jest.Mock } };
    haptics.selection.mockClear();
    const snapTargets = { playhead: true, clips: false, markers: false, beats: false, regions: false };
    // normal: 8 px / 100 pps = 0,08 mp küszöb. JELENLEGI viselkedés: ha a kezdet NEM
    // illeszkedik, az ő elmozdulása 0, így ő nyer — a vég (7,45 → 7,5) illesztése
    // hatástalan, a haptika viszont megszólal (rögzítve, nem javítva)
    const end = setup('normal', { snapStrength: 'normal', snapTargets, playhead: 7.5, beatTimes: [] });
    end.h.commitMove(145);
    expect(end.params.updateClip).toHaveBeenCalledWith('c1', { start: 3.45 });
    expect(haptics.selection).toHaveBeenCalledTimes(1);
    // küszöbön kívül (0,1 mp) nincs illesztés
    const far = setup('normal', { snapStrength: 'normal', snapTargets, playhead: 7.6, beatTimes: [] });
    far.h.commitMove(150);
    expect(far.params.updateClip).toHaveBeenCalledWith('c1', { start: 3.5 });
    // strong: 0,16 mp küszöb — a kezdet (3,5 → 3,6) illeszkedne, de a nem illeszkedő vég
    // elmozdulása 0, így az nyer (ugyanaz a jelenlegi viselkedés)
    const strong = setup('normal', { snapStrength: 'strong', snapTargets, playhead: 3.6, beatTimes: [] });
    strong.h.commitMove(150);
    expect(strong.params.updateClip).toHaveBeenCalledWith('c1', { start: 3.5 });
    // ha MINDKÉT él illeszkedik, a kisebb elmozdulású nyer (vég: 7,5 → 7,55)
    const both = setup('normal', {
      snapStrength: 'strong',
      snapTargets: { ...snapTargets, playhead: false, beats: true },
      beatTimes: [3.6, 7.55],
    });
    both.h.commitMove(150);
    expect(both.params.updateClip).toHaveBeenCalledWith('c1', { start: expect.closeTo(3.55, 9) });
  });

  it('negatív kezdet 0-ra vágódik', () => {
    const { params, h } = setup();
    h.commitMove(-1000);
    expect(params.updateClip).toHaveBeenCalledWith('c1', { start: 0 });
  });

  it('slip/slide módban a forrást/szomszédot csúsztatja', () => {
    const slip = setup('slip');
    slip.h.commitMove(50);
    expect(slip.actions.slipEdit).toHaveBeenCalledWith('c1', 0.5);
    const slide = setup('slide');
    slide.h.commitMove(-50);
    expect(slide.actions.slideEdit).toHaveBeenCalledWith('c1', -0.5);
    expect(slide.params.updateClip).not.toHaveBeenCalled();
  });

  it('domináns függőleges húzás → sávváltás; ha nincs hova, vízszintes mozgatás', () => {
    const ok = setup('normal', { moveClipByTrackStep: jest.fn(() => true) });
    ok.h.commitMove(0, -50);
    expect(useEditorStore.getState().moveClipByTrackStep).toHaveBeenCalledWith('c1', -1);
    expect(ok.params.updateClip).not.toHaveBeenCalled();
    const none = setup();
    none.h.commitMove(0, 50);
    expect(none.actions.moveClipByTrackStep).toHaveBeenCalledWith('c1', 1);
    expect(none.params.updateClip).toHaveBeenCalledWith('c1', { start: 2 });
  });

  it('linkelt klip → a link-csoport együtt mozog; több-kijelölés → a köteg', () => {
    const link = setup('normal', { linkGroupOf: jest.fn(() => ['c1', 'c2']) });
    link.h.commitMove(100, 0);
    expect(useEditorStore.getState().nudgeClipsBy).toHaveBeenCalledWith(['c1', 'c2'], 1);
    const multi = setup('normal', { multiSelectIds: ['c2'], selectedClipId: 'c1' });
    multi.h.commitMove(100, 200);
    expect(multi.actions.moveClipByTrackStep).not.toHaveBeenCalled();
    expect(multi.actions.nudgeSelectedBy).toHaveBeenCalledWith(1);
  });
});

describe('createTimelineClipHandlers — trim-commit', () => {
  it('bal él: roll módban rollEdit, különben updateClip a trimClipLeft patch-csel', () => {
    const roll = setup('roll');
    roll.h.commitTrimLeft(100);
    expect(roll.actions.rollEdit).toHaveBeenCalledWith('c1', 'left', 1);
    expect(roll.params.setEdge).toHaveBeenCalledWith(null);
    const normal = setup();
    normal.h.commitTrimLeft(100);
    expect(normal.params.leftDelta).toEqual({ value: 0 });
    expect(normal.params.updateClip).toHaveBeenCalledWith('c1', { start: 3, duration: 3, trimIn: 2 });
  });

  it('jobb él: roll → rollEdit; ripple → rippleResize; különben updateClip (trimIn csak ha van)', () => {
    const roll = setup('roll');
    roll.h.commitTrimRight(-100);
    expect(roll.actions.rollEdit).toHaveBeenCalledWith('c1', 'right', -1);
    const ripple = setup('ripple', { rippleResize: jest.fn(() => true) });
    ripple.h.commitTrimRight(100);
    expect(useEditorStore.getState().rippleResize).toHaveBeenCalledWith('c1', 5);
    expect(ripple.params.updateClip).not.toHaveBeenCalled();
    const globalRipple = setup('normal', { rippleMode: true });
    globalRipple.h.commitTrimRight(100);
    expect(globalRipple.actions.rippleResize).toHaveBeenCalledWith('c1', 5);
    expect(globalRipple.params.updateClip).toHaveBeenCalledWith('c1', { duration: 5, trimIn: 1 });
    const normal = setup();
    normal.h.commitTrimRight(100);
    expect(normal.actions.rippleResize).not.toHaveBeenCalled();
    expect(normal.params.rightDelta).toEqual({ value: 0 });
  });
});

describe('createTimelineClipHandlers — koppintás', () => {
  it('köteg-módban hozzáad/elvesz, egyébként kijelöl', () => {
    const { params, h } = setup();
    h.handleTap();
    expect(params.selectClip).toHaveBeenCalledWith('c1');
    const multi = setup();
    const hm = createTimelineClipHandlers({ ...multi.params, multiSelectMode: true });
    hm.handleTap();
    expect(multi.params.toggleMultiSelect).toHaveBeenCalledWith('c1');
    expect(multi.params.selectClip).not.toHaveBeenCalled();
  });
});
