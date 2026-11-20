import { createPathEditActions } from '@/components/studio/image/body/pathEditActions';
import type { ImageDoc, ImageLayer, PathPoint, ShapeLayer } from '@/types/project';

/**
 * ✏️ A vektor-toll pont-szerkesztés akciói (REFACTOR: az `ImageStudioBody`-ból kiemelve): melyik írás
 * milyen undo-címkével megy a command-busra — a nyers technikai címkék ('path-closed', 'node-…') is.
 */

const P = (x: number, y: number): PathPoint => ({ x, y });
const tri = [P(0, 0), P(1, 0), P(1, 1)];
const open = { kind: 'shape', id: 'p', shape: 'path', points: tri, closed: false } as unknown as ImageLayer;
const closedStroked = { kind: 'shape', id: 'p', shape: 'path', points: tri, closed: true, strokeWidth: 2 } as unknown as ImageLayer;
const compound = { kind: 'shape', id: 'p', shape: 'path', subpaths: [tri, [P(0.2, 0.2), P(0.4, 0.2), P(0.4, 0.4), P(0.2, 0.4)]] } as unknown as ImageLayer;
const docOf = (l: ImageLayer): ImageDoc => ({ id: 'd', name: 'D', aspectRatio: '9:16', layers: [l] }) as ImageDoc;

function setup(layer: ImageLayer, over: { ring?: number; node?: number | null; id?: string | null; doc?: ImageDoc | null } = {}) {
  const commit = jest.fn();
  const setPathEditNode = jest.fn();
  const api = createPathEditActions({
    doc: over.doc === undefined ? docOf(layer) : over.doc,
    commit,
    pathEditId: over.id === undefined ? 'p' : over.id,
    pathEditRing: over.ring ?? 0,
    pathEditNode: over.node === undefined ? null : over.node,
    setPathEditNode,
  });
  const written = () => commit.mock.calls[0][0].layers[0] as ShapeLayer;
  return { commit, setPathEditNode, api, written };
}

describe('createPathEditActions', () => {
  it('a szerkesztett forma és a gyűrűk száma a nézetből', () => {
    expect(setup(open).api.ringCount).toBe(0);
    expect(setup(open).api.pathEditShape?.id).toBe('p');
    expect(setup(compound, { ring: 1 }).api.ringCount).toBe(2);
    expect(setup(open, { id: null }).api.pathEditShape).toBeNull();
  });
  it('zárás/nyitás: „path-closed”; a nyitott útvonal vonalat kap (0.9), a meglévő vonal marad', () => {
    const a = setup(open);
    a.api.togglePathClosed();
    expect(a.commit.mock.calls[0][1]).toBe('path-closed');
    expect(a.written()).toMatchObject({ closed: true, strokeWidth: undefined });
    const b = setup(closedStroked);
    b.api.togglePathClosed();
    expect(b.written()).toMatchObject({ closed: false, strokeWidth: 2 });
    const c = setup({ ...closedStroked, strokeWidth: undefined } as unknown as ImageLayer);
    c.api.togglePathClosed();
    expect(c.written()).toMatchObject({ closed: false, strokeWidth: 0.9 });
  });
  it('irány-fordítás: „path-reverse”, a node-kijelölés törlődik', () => {
    const a = setup(open, { node: 1 });
    a.api.reverseEditedPath();
    expect(a.commit.mock.calls[0][1]).toBe('path-reverse');
    expect(a.written().points?.map((p) => p.x)).toEqual([1, 1, 0]);
    expect(a.setPathEditNode).toHaveBeenCalledWith(null);
  });
  it('összetett path: az írás a szerkesztett gyűrűbe megy (subpaths)', () => {
    const a = setup(compound, { ring: 1 });
    a.api.reverseEditedPath();
    const w = a.written();
    expect(w.subpaths?.[0]).toEqual(tri);
    expect(w.subpaths?.[1].map((p) => p.y)).toEqual([0.4, 0.4, 0.2, 0.2]);
  });
  it('node-típus: „node-<típus>” címke, csak kijelölt node-dal', () => {
    const a = setup(open, { node: 1 });
    a.api.setNodeKind('smooth');
    expect(a.commit.mock.calls[0][1]).toBe('node-smooth');
    expect(a.written().points?.[1].h1).toBeDefined();
    const b = setup(open, { node: null });
    b.api.setNodeKind('corner');
    expect(b.commit).not.toHaveBeenCalled();
  });
  it('node-törlés: „node-delete”, csak ha 2-nél több pont marad előtte', () => {
    const a = setup(open, { node: 0 });
    a.api.deleteNode();
    expect(a.commit.mock.calls[0][1]).toBe('node-delete');
    expect(a.written().points).toEqual([P(1, 0), P(1, 1)]);
    expect(a.setPathEditNode).toHaveBeenCalledWith(null);
    const two = { ...open, points: [P(0, 0), P(1, 1)] } as unknown as ImageLayer;
    const b = setup(two, { node: 0 });
    b.api.deleteNode();
    expect(b.commit).not.toHaveBeenCalled();
    expect(b.setPathEditNode).not.toHaveBeenCalled();
  });
  it('doc nélkül egyik akció sem ír', () => {
    const a = setup(open, { doc: null, node: 1 });
    a.api.togglePathClosed();
    a.api.reverseEditedPath();
    a.api.setNodeKind('smooth');
    a.api.deleteNode();
    expect(a.commit).not.toHaveBeenCalled();
  });
});
