/**
 * 🗂️ Universal Asset Library (PM2 — MASTER §14) — a MINDEN alkotó közös „My
 * Assets" rétege: típusonként (videó/fotó/zene/voice/SFX/grafika/font/3D/
 * dokumentum/kód/AI) egy asset, gazdag metaadattal (tags · collections ·
 * favorites · versions · source · license · creator · project-usage · embedding).
 *
 * A projekt-`Asset` (média-referencia — [types/project]) és ez a réteg
 * kiegészítik egymást: az `ingestProjectAssets` a projekt asseteit BEHÚZZA ide,
 * usage-gel. Innentől a keresés/usage/dedup a teljes könyvtár fölött megy.
 *
 * Az app DNS-e szerint eszközön futó, INGYENES infrastruktúra (nincs Pro-gate).
 * Tiszta, immutábilis reducer — expo-mentes, önmagában tesztelhető.
 */

// Barrel — a tiszta mag az assetLibraryCore/ alatt: modell, immutábilis reducer (asset / tag /
// kollekció / verzió / usage), lekérdezések (szűrés, keresés, duplikátum), projekt-híd
export {
  ASSET_KIND_ICON,
  ASSET_KINDS,
  type AssetInput,
  type AssetKind,
  type AssetLibrary,
  type AssetVersion,
  type Collection,
  type LibraryAsset,
} from '@/lib/assetLibraryCore/model';
export {
  addAsset,
  addTag,
  addToCollection,
  addVersion,
  clearUsage,
  createCollection,
  deleteCollection,
  emptyLibrary,
  rateAsset,
  recordUsage,
  removeAsset,
  removeFromCollection,
  removeTag,
  renameAsset,
  toggleFavorite,
} from '@/lib/assetLibraryCore/reducer';
export {
  assetsByKind,
  assetsInProject,
  filterAssets,
  findDuplicates,
  findMissing,
  searchAssets,
  usageOf,
  type AssetFilter,
} from '@/lib/assetLibraryCore/queries';
export { assetKindFromProject, ingestProjectAssets } from '@/lib/assetLibraryCore/projectBridge';
