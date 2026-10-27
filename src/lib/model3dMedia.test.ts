import { extractMediaKeys, planMediaDeletion } from '@/lib/mediaGc';
import { isStorableFormat, model3dAsset, model3dMediaFileName } from '@/lib/model3dMedia';

const DOC = 'file:///var/mobile/Containers/Data/Application/ABC/Documents/';

describe('model3dMedia — a 3D-fájlt a GC és a .rp is látja (§15.8)', () => {
  it('lapos, egyedi fájlnév a media/ alatt', () => {
    expect(model3dMediaFileName('ast_1/../x', 'usdz')).toBe('m3d_ast_1x.usdz');
    const a = model3dAsset({ assetId: 'ast_9', format: 'usdz', documentDir: DOC, name: 'Cipő', size: 1234 });
    expect(a).toMatchObject({ id: 'ast_9', kind: 'model', provider: 'local', name: 'Cipő', size: 1234 });
    expect(a.uri).toBe(`${DOC}media/m3d_ast_9.usdz`);
  });

  it('a valódi média-GC kulcsa megtalálja a projekt-JSON-ban', () => {
    const a = model3dAsset({ assetId: 'ast_9', format: 'usdz', documentDir: DOC.slice(0, -1), name: 'x' });
    const raw = JSON.stringify({ assets: [a] });
    expect(extractMediaKeys(raw).has('media/m3d_ast_9.usdz')).toBe(true);
  });

  it('a projekt törlésekor a 3D-fájl is törlés-jelölt, ha más nem hivatkozza', () => {
    const a = model3dAsset({ assetId: 'ast_9', format: 'usdz', documentDir: DOC, name: 'x' });
    const plan = planMediaDeletion([JSON.stringify({ assets: [a] })], [JSON.stringify({ assets: [] })]);
    expect(plan.map((p) => `${p.dir}/${p.name}`)).toContain('media/m3d_ast_9.usdz');
  });

  it('a textúrás OBJ (több fájl) nem tárolható; a textúra nélküli (szabad szken) igen', () => {
    expect(isStorableFormat('obj')).toBe(false);
    expect(() => model3dAsset({ assetId: 'a', format: 'obj', documentDir: DOC, name: 'x' })).toThrow();
    expect(isStorableFormat('obj', false)).toBe(true);
    expect(model3dAsset({ assetId: 'a', format: 'obj', documentDir: DOC, name: 'x', textured: false }).uri).toBe(`${DOC}media/m3d_a.obj`);
  });
});
