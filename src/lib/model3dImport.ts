/**
 * 📥 3D-fájl import döntései (pure) — mit nyit meg a 3D Stúdió a KÉSZÜLÉKEN.
 *
 * Olvasott formátumok (remix-3d natív): GLB / glTF 2.0 (saját olvasó), FBX bináris 7.x
 * (saját olvasó, beágyazott textúrával), OBJ (+MTL), USDZ / USD(A/C), PLY (háló és
 * pontfelhő), STL — és bármelyik zip-be csomagolva (pl. OBJ + MTL + textúrák, glTF + .bin).
 * Az importált modell a projekt TÁROLÁSI formátumába kerül (`storedFormatFor`).
 */
export const IMPORT_EXTENSIONS = ['glb', 'gltf', 'fbx', 'obj', 'usdz', 'usd', 'usda', 'usdc', 'ply', 'stl', 'zip'] as const;
export type ImportExt = (typeof IMPORT_EXTENSIONS)[number];

/** natív szerkesztő-formátumok, amiket nem olvasunk — a hiba megmondja, mibe exportáld */
const NATIVE_APP_FORMATS: Record<string, string> = {
  blend: 'Blender',
  max: '3ds Max',
  ma: 'Maya',
  mb: 'Maya',
  c4d: 'Cinema 4D',
  skp: 'SketchUp',
  '3dm': 'Rhino',
  dae: 'Collada',
  '3ds': '3DS',
  abc: 'Alembic',
};

export function extOf(name: string): string {
  const clean = name.split('?')[0].split('#')[0];
  const m = /\.([a-z0-9]+)$/i.exec(clean);
  return m ? m[1].toLowerCase() : '';
}

export function importExtOf(name: string): ImportExt | null {
  const e = extOf(name);
  return (IMPORT_EXTENSIONS as readonly string[]).includes(e) ? (e as ImportExt) : null;
}

export type ImportProblem =
  | { code: 'nativeApp'; app: string }
  | { code: 'unsupported'; ext: string }
  | { code: 'gltfExternal' };

/**
 * Mi a gond az import előtt (null = mehet). A különálló `.gltf` a mellette lévő
 * `.bin`/képek nélkül csonka lenne → a hívó a BEOLVASÁS után ellenőrzi (`gltfExternal`);
 * itt csak a kiterjesztés-szintű döntés van.
 */
export function importProblem(name: string): ImportProblem | null {
  const e = extOf(name);
  if (importExtOf(name)) return null;
  if (NATIVE_APP_FORMATS[e]) return { code: 'nativeApp', app: NATIVE_APP_FORMATS[e] };
  return { code: 'unsupported', ext: e || '?' };
}

/** az import-forrás „natív" tárolható formátuma (ha másolható változatlanul) */
export function storableSourceFormat(ext: ImportExt): 'usdz' | 'glb' | 'obj' | 'ply' | 'stl' | null {
  return ext === 'usdz' || ext === 'glb' || ext === 'obj' || ext === 'ply' || ext === 'stl' ? ext : null;
}

/** a projekt neve az importált fájlból (kiterjesztés nélkül, olvashatóan) */
export function nameFromFile(name: string): string {
  const base = name.split('/').pop() ?? name;
  return (
    decodeURIComponent(base)
      .replace(/\.[^.]+$/, '')
      .replace(/[_-]+/g, ' ')
      .trim() || 'Model'
  );
}
