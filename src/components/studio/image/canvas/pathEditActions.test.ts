/**
 * 🧪 A node-szerkesztő műveletei (a REFACTOR előtti ImageCanvas-viselkedés rögzítve): az élő
 * húzás csak setLive, a rögzítés a commit-on megy a pontos címkével ('node' / 'handle' /
 * 'node-insert'); path-forma nélkül minden művelet néma.
 */
import { createPathEditActions } from '@/components/studio/image/canvas/pathEditActions';
import { resolvePathEdit } from '@/lib/imageCanvasStage';
import type { ImageDoc, PathPoint, ShapeLayer } from '@/types/project';

const pts: PathPoint[] = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }];
const pathLayer = (extra: Record<string, unknown> = {}) =>
  ({ id: 'p', kind: 'shape', shape: 'path', points: pts, closed: false, position: { x: 0.5, y: 0.5 }, w: 0.5, h: 0.5, color: '#fff', ...extra }) as unknown as ShapeLayer;
const docOf = (layer: ShapeLayer, extra: Partial<ImageDoc> = {}): ImageDoc =>
  ({ id: 'd', name: 'd', aspectRatio: '1:1', width: 1000, height: 1000, layers: [layer], ...extra }) as ImageDoc;

function setup(layer = pathLayer(), ring = 0, extra: Partial<ImageDoc> = {}, editId: string | null = 'p') {
  const doc = docOf(layer, extra);
  const commit = jest.fn();
  const setLive = jest.fn();
  const { rawPathShape, pathEditShape } = resolvePathEdit(doc, editId, ring, null);
  const a = createPathEditActions({ doc, commit, setLive, rawPathShape, pathEditShape, pathEditRing: ring });
  const committed = () => commit.mock.calls[0][0].layers[0] as ShapeLayer;
  return { a, commit, setLive, committed };
}

describe('node-szerkesztő műveletek', () => {
  it('élő node-húzás: csak setLive, a horgony elmozdul, nincs commit', () => {
    const { a, commit, setLive } = setup();
    a.onNodeLive(1, 0.8, 0.2);
    expect(commit).not.toHaveBeenCalled();
    expect(setLive).toHaveBeenCalledTimes(1);
    const live = setLive.mock.calls[0][0];
    expect(live.id).toBe('p');
    expect(live.patch.points[1]).toMatchObject({ x: 0.8, y: 0.2 });
  });
  it("node rögzítése: előbb setLive(null), majd commit 'node' címkével, a doboz újranormálva", () => {
    const { a, commit, setLive, committed } = setup();
    a.onNodeCommit(1, 0.5, 0.5);
    expect(setLive).toHaveBeenCalledWith(null);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit.mock.calls[0][1]).toBe('node');
    const l = committed();
    expect(Object.keys(l)).toEqual(expect.arrayContaining(['points', 'position', 'w', 'h']));
    expect(setLive.mock.invocationCallOrder[0]).toBeLessThan(commit.mock.invocationCallOrder[0]);
  });
  it('összetett útvonalnál a rögzítés a gyűrűt patcheli, a dobozt nem normálja újra', () => {
    const ring1: PathPoint[] = [{ x: 0, y: 1 }, { x: 1, y: 1 }];
    const { a, commit, committed } = setup(pathLayer({ subpaths: [ring1] }), 1);
    a.onNodeCommit(0, 0.25, 0.75);
    expect(commit.mock.calls[0][1]).toBe('node');
    const l = committed();
    expect(l.position).toEqual({ x: 0.5, y: 0.5 });
    expect(l.w).toBe(0.5);
    expect(l.points).toBe(pts);
  });
  it("bezier-fogó: élő húzás setLive, rögzítés 'handle' címkével", () => {
    const { a, commit, setLive } = setup();
    a.onHandleLive(1, 'h2', 0.9, 0.1);
    expect(setLive).toHaveBeenCalledTimes(1);
    expect(commit).not.toHaveBeenCalled();
    a.onHandleCommit(1, 'h2', 0.9, 0.1);
    expect(setLive).toHaveBeenLastCalledWith(null);
    expect(commit.mock.calls[0][1]).toBe('handle');
  });
  it("koppintás az élre: közel a vonalhoz új node ('node-insert'), messze semmi", () => {
    const { a, commit, committed } = setup();
    a.onInsertNode(0.5, 0.01);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit.mock.calls[0][1]).toBe('node-insert');
    expect(committed().points).toHaveLength(4);
    const far = setup();
    far.a.onInsertNode(0.2, 0.5);
    expect(far.commit).not.toHaveBeenCalled();
  });
  it('path-forma nélkül minden művelet néma', () => {
    const { a, commit, setLive } = setup(pathLayer(), 0, {}, null);
    a.onNodeLive(0, 0.1, 0.1);
    a.onNodeCommit(0, 0.1, 0.1);
    a.onHandleLive(0, 'h1', 0.1, 0.1);
    a.onHandleCommit(0, 'h1', 0.1, 0.1);
    a.onInsertNode(0.5, 0);
    expect(commit).not.toHaveBeenCalled();
    expect(setLive).not.toHaveBeenCalled();
  });
});
