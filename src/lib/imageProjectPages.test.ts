import {
  canRemovePage,
  clampPageIndex,
  duplicatePage,
  imagePages,
  orderIds,
  pageCount,
  pageIndexAfterRemoval,
  reorderPages,
} from '@/lib/imageProjectPages';
import type { ImageDoc, Project } from '@/types/project';

const d = (id: string, name = id): ImageDoc =>
  ({ id, name, aspectRatio: '1:1', layers: [{ kind: 'fill', id: `f-${id}`, fill: '#000' }] }) as unknown as ImageDoc;

const proj = (docs?: ImageDoc[]): Pick<Project, 'imageDocs'> => ({ imageDocs: docs });

describe('imageProjectPages — lap-logika', () => {
  it('imagePages / pageCount', () => {
    expect(imagePages(proj())).toEqual([]);
    expect(pageCount(proj([d('a'), d('b')]))).toBe(2);
  });

  it('canRemovePage: legalább egy marad', () => {
    expect(canRemovePage(proj([d('a')]))).toBe(false);
    expect(canRemovePage(proj([d('a'), d('b')]))).toBe(true);
  });

  it('clampPageIndex: tartományba szorít', () => {
    expect(clampPageIndex(-2, 3)).toBe(0);
    expect(clampPageIndex(5, 3)).toBe(2);
    expect(clampPageIndex(1, 3)).toBe(1);
    expect(clampPageIndex(0, 0)).toBe(0);
    expect(clampPageIndex(NaN, 3)).toBe(0);
  });

  it('pageIndexAfterRemoval: a törölt helyén lévő, különben az előző', () => {
    expect(pageIndexAfterRemoval(1, 3)).toBe(1); // 3→2, a 1. index marad
    expect(pageIndexAfterRemoval(2, 3)).toBe(1); // az utolsót töröltük → az új utolsó
    expect(pageIndexAfterRemoval(0, 1)).toBe(0); // az egyetlen → 0
  });

  it('reorderPages: mozgat + no-op érvénytelenre', () => {
    const docs = [d('a'), d('b'), d('c')];
    expect(orderIds(reorderPages(docs, 0, 2))).toEqual(['b', 'c', 'a']);
    expect(orderIds(reorderPages(docs, 2, 0))).toEqual(['c', 'a', 'b']);
    expect(reorderPages(docs, 1, 1)).toBe(docs); // azonos → eredeti referencia
    expect(reorderPages(docs, 5, 0)).toBe(docs); // érvénytelen → eredeti
  });

  it('duplicatePage: új id + „másolat" név + renderedUri ürítve + mély-másolat', () => {
    const src = { ...d('a', 'Borító'), renderedUri: 'file://old.png' } as ImageDoc;
    const dup = duplicatePage(src, 'a2');
    expect(dup.id).toBe('a2');
    expect(dup.name).toBe('Borító másolat');
    expect(dup.renderedUri).toBeUndefined();
    expect(dup.layers).not.toBe(src.layers); // mély-másolat
    expect(dup.layers[0].id).toBe(src.layers[0].id);
  });
});
