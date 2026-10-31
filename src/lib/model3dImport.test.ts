import { importExtOf, importProblem, nameFromFile, storableSourceFormat } from '@/lib/model3dImport';

describe('model3dImport', () => {
  it('felismeri az olvasott formátumokat (kis/nagybetű, query nélkül)', () => {
    expect(importExtOf('Chair.GLB')).toBe('glb');
    expect(importExtOf('file:///x/scene.gltf?x=1')).toBe('gltf');
    expect(importExtOf('pack.zip')).toBe('zip');
    expect(importExtOf('a.fbx')).toBe('fbx');
    expect(importExtOf('a.blend')).toBeNull();
  });

  it('a natív szerkesztő-fájlra megmondja, mi az (export kell)', () => {
    expect(importProblem('scene.blend')).toEqual({ code: 'nativeApp', app: 'Blender' });
    expect(importProblem('x.docx')).toEqual({ code: 'unsupported', ext: 'docx' });
    expect(importProblem('ok.obj')).toBeNull();
  });

  it('csak a tárolható formátum másolható változatlanul', () => {
    expect(storableSourceFormat('usdz')).toBe('usdz');
    expect(storableSourceFormat('fbx')).toBeNull();
    expect(storableSourceFormat('gltf')).toBeNull();
  });

  it('olvasható név a fájlnévből', () => {
    expect(nameFromFile('file:///tmp/my_old-chair.glb')).toBe('my old chair');
    expect(nameFromFile('.glb')).toBe('Model');
  });
});
