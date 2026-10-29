/**
 * 📂 iOS app-konténer útvonal-újraalapozás (pure, expo-mentes → önmagában tesztelhető).
 *
 * A projektek ABSZOLÚT `file://` uri-kkal hivatkoznak a médiájukra (lásd
 * `projectFolderClient.ts`). iOS-en ezekben benne van az app ADAT-konténerének
 * azonosítója (`…/Containers/Data/Application/<UUID>/Documents/…`), ami újratelepítés /
 * frissítés után MEGVÁLTOZHAT — a fájlok átkerülnek az új konténerbe, de a tárolt uri a
 * régire mutat → a média (pl. a LiDAR-szkennelt 3D-modell) „eltűnik", pedig ott van.
 *
 * A betöltéskor ezért a régi Documents-előtagot az AKTUÁLIS Documents-mappára írjuk át.
 * Ha a konténer nem változott, a szöveg változatlan (no-op). Androidon az útvonal stabil,
 * és a cél nem iOS-konténer → szintén no-op.
 */

const CONTAINER_MARK = '/Containers/Data/Application/';

/** egy (bármely korábbi) iOS-konténer Documents-előtagja egy `file://` uri-ban */
const IOS_DOCUMENTS_PREFIX = /file:\/\/[^"\s]*?\/Containers\/Data\/Application\/[0-9A-Fa-f-]{36}\/Documents\//g;

/** a cél valóban egy iOS-konténer Documents-mappája-e */
const IOS_DOCUMENTS_DIR = /\/Containers\/Data\/Application\/[0-9A-Fa-f-]{36}\/Documents\/$/;

/**
 * A nyers (JSON-)szövegben minden régi iOS-konténeres Documents-előtagot a
 * `currentDocUri`-ra (az aktuális `Paths.document.uri`) cserél.
 */
export function rebaseDocumentUris(raw: string, currentDocUri: string): string {
  if (!raw || !currentDocUri || !raw.includes(CONTAINER_MARK)) {
    return raw;
  }
  const target = currentDocUri.endsWith('/') ? currentDocUri : `${currentDocUri}/`;
  if (!IOS_DOCUMENTS_DIR.test(target)) {
    return raw;
  }
  return raw.replace(IOS_DOCUMENTS_PREFIX, target);
}
