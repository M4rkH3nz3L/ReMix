/**
 * 🧊 3D-média elhelyezése és asset-regisztrációja (3D-Studio.md §15.8 — a fő buktató).
 *
 * A média-GC és a `.rp` csomag a projekt-JSON-ban hivatkozott `file://…/media/<név>`
 * URI-kat keresi, és a `media/` mappa LAPOS (alkönyvtár nélkül). Ezért:
 *  • a 3D-fájl EGYETLEN fájl (USDZ — a textúrák benne; pontfelhőnél PLY), közvetlenül a
 *    `media/` alatt, egyedi névvel;
 *  • a rögzítési képkészlet (fotogrammetria) IDEIGLENES — nem a `media/`-ban él, a
 *    rekonstrukció után törlődik (különben a GC/.rp nem is látná, csak a tárhelyet foglalná);
 *  • a fájl `Asset`-ként (`kind: 'model'`) kerül a projektbe → felhő-mentés (Pro),
 *    kvóta-könyvelés, adatvesztés-figyelmeztetés és a törlés-életciklus mind látja.
 */
import type { MeshFormat } from '@/types/model3d';
import type { Asset } from '@/types/project';

/** a mindig egy-fájlos formátumok */
export const STORABLE_FORMATS: readonly MeshFormat[] = ['usdz', 'ply', 'glb', 'stl'];

/**
 * Tárolható-e egyetlen fájlként. Az OBJ textúrával több fájl (.obj + .mtl + képek) →
 * csak exportnak megy; TEXTÚRA NÉLKÜL (pl. a szabad szken nyers hálója) egy fájl → tárolható.
 */
export function isStorableFormat(format: MeshFormat, textured = true): boolean {
  return STORABLE_FORMATS.includes(format) || (format === 'obj' && !textured);
}

/** egyedi, lapos fájlnév a `media/` mappában */
export function model3dMediaFileName(assetId: string, format: MeshFormat): string {
  const safe = assetId.replace(/[^a-zA-Z0-9_-]/g, '');
  return `m3d_${safe}.${format}`;
}

/**
 * A 3D-asset bejegyzése. `documentDir`: az app dokumentum-könyvtárának URI-ja
 * (`file:///…/Documents/`), a végén perjellel vagy anélkül.
 */
export function model3dAsset(input: {
  assetId: string;
  format: MeshFormat;
  documentDir: string;
  name: string;
  size?: number;
  /** textúrás-e (alapból igen — a fotogrammetria USDZ-je) */
  textured?: boolean;
  /** 📁 a cél-mappa URI-ja (a projekt mappája); hiányában a régi `<documentDir>/media/` */
  mediaDirUri?: string;
}): Asset {
  if (!isStorableFormat(input.format, input.textured ?? true)) {
    throw new Error(`model3dAsset: a(z) ${input.format} nem tárolható egy fájlként`);
  }
  const base = input.mediaDirUri ?? `${input.documentDir.replace(/\/?$/, '/')}media`;
  const dir = base.endsWith('/') ? base : `${base}/`;
  return {
    id: input.assetId,
    kind: 'model',
    uri: `${dir}${model3dMediaFileName(input.assetId, input.format)}`,
    provider: 'local',
    name: input.name,
    ...(input.size !== undefined ? { size: input.size } : {}),
  };
}
