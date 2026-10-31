import { imageDocContentKey, isRenderFresh } from '@/lib/imageExport';
import { createEmptyProject } from '@/lib/projectUtils';
import { useEditorStore } from '@/store/editorStore';
import type { ImageDoc } from '@/types/project';

const doc = { id: 'd', name: 'D', aspectRatio: '1:1', width: 100, height: 100, layers: [] } as unknown as ImageDoc;

describe('I41 — elavult render', () => {
  it('friss, amíg a tartalom ugyanaz', () => {
    const rendered = { ...doc, renderedUri: 'file:///a.png', renderedKey: imageDocContentKey(doc) };
    expect(isRenderFresh(rendered)).toBe(true);
  });
  it('szerkesztés után elavult', () => {
    const rendered = { ...doc, renderedUri: 'file:///a.png', renderedKey: imageDocContentKey(doc) };
    expect(isRenderFresh({ ...rendered, vignette: 0.3 })).toBe(false);
  });
  it('a kulcs nélküli régi render elavultnak számít', () => {
    expect(isRenderFresh({ ...doc, renderedUri: 'file:///a.png' })).toBe(false);
  });
  it('a bélyegkép nem undo-lépés, de mentendő', () => {
    const p = { ...createEmptyProject('T', '1:1', undefined, 'image'), imageDocs: [doc] };
    const s = useEditorStore.getState();
    s.loadProject(p, []);
    useEditorStore.getState().setDocThumb('d', 'file:///t.png', 'k');
    const after = useEditorStore.getState();
    expect(after.project!.imageDocs![0]).toMatchObject({ thumbUri: 'file:///t.png', thumbKey: 'k' });
    expect(after.dirty).toBe(true);
    expect(after.past).toHaveLength(0);
    after.closeProject();
  });
});
