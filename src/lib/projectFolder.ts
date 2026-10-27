/**
 * 📁 Projekt-mappa — PURE mag (expo-mentes, tesztelhető).
 *
 * Alapelv: a projekt a TELEFON tárhelyén él. Minden projekt kap egy saját mappát az
 * Eszközömben (`Files/Projektek/<slug>`), a projekt nevéből képzett ékezetmentes,
 * fájlrendszer-biztos névvel; a projekt médiája ide kerül. A mappát a user CSAK a
 * projekt törlésével tudja törölni (a Tárhelyem védi), és innen — a projekt
 * beállításában bekapcsolva, ha elég a kvóta — a ReMix Storage-ba szinkronizálható
 * (egyirányú: telefon → felhő; a felhőben `Projektek/<slug>` alá).
 */

/** Az Eszközöm (és a ReMix Storage) projekt-gyűjtő mappája. */
export const PROJECTS_DIR = 'Projektek';

const MAX_SLUG = 60;

/**
 * Projekt-név → mappanév: ékezetmentes (NFD + kombináló jelek ki; ő/ű is), kisbetűs,
 * csak `a-z0-9`, a többi elválasztó `-`; üres → `projekt`.
 * „Nyári Forgatás – 2026!” → `nyari-forgatas-2026`.
 */
export function slugifyProjectName(name: string): string {
  const base = String(name ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/[æÆ]/g, 'ae')
    .replace(/[øØ]/g, 'o')
    .replace(/[łŁ]/g, 'l')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG)
    .replace(/-+$/g, '');
  return base || 'projekt';
}

/** Ütközésmentes mappanév: `slug`, `slug-2`, `slug-3` … (a `taken` a már létezők). */
export function uniqueFolderName(slug: string, taken: Iterable<string>): string {
  const set = new Set(taken);
  if (!set.has(slug)) {
    return slug;
  }
  for (let i = 2; ; i++) {
    const candidate = `${slug.slice(0, MAX_SLUG - String(i).length - 1)}-${i}`;
    if (!set.has(candidate)) {
      return candidate;
    }
  }
}

/** A projekt mappájának útja az Eszközöm gyökeréhez (és a ReMix Storage gyökeréhez) képest. */
export function projectFolderPath(folder: string): string {
  return `${PROJECTS_DIR}/${folder}`;
}

/**
 * Védett-e egy út a Tárhelyemben:
 *  - `'container'` — maga a `Projektek` gyűjtő-mappa (nem törölhető/átnevezhető);
 *  - `'project'`   — egy élő projekt mappája (csak a projekt törlésével tűnik el);
 *  - `'inUse'`     — a projekt által HASZNÁLT fájl a projekt mappájában;
 *  - `null`        — szabadon kezelhető.
 * A `folders` az élő projektek mappanevei, a `usedPaths` a projektek által hivatkozott
 * fájlok (a Tárhelyem-gyökérhez relatív) útjai.
 */
export function protectionOf(
  path: string,
  folders: ReadonlySet<string>,
  usedPaths: ReadonlySet<string> = new Set()
): 'container' | 'project' | 'inUse' | null {
  if (path === PROJECTS_DIR) {
    return 'container';
  }
  if (!path.startsWith(`${PROJECTS_DIR}/`)) {
    return null;
  }
  const rest = path.slice(PROJECTS_DIR.length + 1);
  const folder = rest.split('/')[0];
  if (!folders.has(folder)) {
    return null;
  }
  if (rest === folder) {
    return 'project';
  }
  return usedPaths.has(path) ? 'inUse' : null;
}

/**
 * Egy `file://…/Files/<rel>` uri → a Tárhelyem-gyökérhez relatív út, ha az Eszközöm
 * alatt van (különben null). A konténer-útvonal iOS-en frissítéskor változhat, ezért
 * a `/Files/` jelölőre vágunk, nem a teljes prefixre.
 */
export function deviceRelativePath(uri: string): string | null {
  const marker = '/Files/';
  const i = uri.indexOf(marker);
  if (i < 0) {
    return null;
  }
  try {
    return decodeURIComponent(uri.slice(i + marker.length).split(/[?#]/)[0]);
  } catch {
    return uri.slice(i + marker.length).split(/[?#]/)[0];
  }
}

export interface SyncFileState {
  /** a projekt-mappán BELÜLI relatív út (`klipek/a.mp4`) */
  path: string;
  size: number;
}

/**
 * Egyirányú (telefon → ReMix Storage) szinkron-terv: mit kell feltölteni. Új vagy
 * eltérő méretű fájl → feltöltés (a szerver MD5-tel dedupol, így a téves riasztás
 * olcsó). A felhőből NEM törlünk automatikusan (adatvesztés-védelem) — ami csak a
 * felhőben van, az `remoteOnly`-ként látszik.
 */
export function planProjectSync(
  local: SyncFileState[],
  remote: SyncFileState[]
): { upload: SyncFileState[]; uploadBytes: number; inSync: number; remoteOnly: string[] } {
  const remoteBy = new Map(remote.map((r) => [r.path, r.size]));
  const localSet = new Set(local.map((l) => l.path));
  const upload = local.filter((l) => remoteBy.get(l.path) !== l.size);
  return {
    upload,
    uploadBytes: upload.reduce((a, b) => a + b.size, 0),
    inSync: local.length - upload.length,
    remoteOnly: remote.filter((r) => !localSet.has(r.path)).map((r) => r.path),
  };
}

/**
 * Bekapcsolható-e a szinkron: a feltöltendő bájt belefér-e a maradék kvótába.
 * `quota <= 0` = nincs ismert kvóta (dev) → engedjük; a szerver úgyis keményen tilt.
 */
export function canEnableSync(
  uploadBytes: number,
  usedBytes: number,
  quotaBytes: number
): { ok: boolean; missingBytes: number } {
  if (quotaBytes <= 0) {
    return { ok: true, missingBytes: 0 };
  }
  const missing = usedBytes + uploadBytes - quotaBytes;
  return { ok: missing <= 0, missingBytes: Math.max(0, missing) };
}

/** A projekt-mappa tulajdonos-jelölője (rejtett; a projekt id-jét tartalmazza). */
export const OWNER_MARKER = '.remix-project';

/** Rejtett (pont-kezdetű) név — a Tárhelyem nem mutatja, a szinkron kihagyja. */
export function isHiddenName(name: string): boolean {
  return name.startsWith('.');
}

/**
 * Melyik hivatkozott fájlt kell a projekt SAJÁT mappájába átvenni: minden app-kezelt
 * fájl (`media/`, `mediacache/`, vagy az Eszközöm bármely más mappája, pl. egy
 * másik projekté), ami NEM a saját mappájában van. `move` = a régi közös
 * `media`/`mediacache` fájl (átmozgatható, ha más nem hivatkozik rá); a másik
 * projekt / user-mappa fájlját mindig MÁSOLJUK (azt nem vehetjük el).
 */
export function planAdoption(
  uris: readonly string[],
  ownFolder: string
): { uri: string; name: string; shared: boolean }[] {
  const own = `${projectFolderPath(ownFolder)}/`;
  const seen = new Set<string>();
  const out: { uri: string; name: string; shared: boolean }[] = [];
  for (const uri of uris) {
    if (seen.has(uri) || !/^file:\/\//i.test(uri)) {
      continue;
    }
    seen.add(uri);
    const rel = deviceRelativePath(uri);
    if (rel !== null) {
      if (!rel.startsWith(own)) {
        out.push({ uri, name: rel.slice(rel.lastIndexOf('/') + 1), shared: true });
      }
      continue;
    }
    const m = uri.match(/\/(media|mediacache)\/([^/\\"']+)$/);
    if (m) {
      let name = m[2];
      try {
        name = decodeURIComponent(name);
      } catch {
        // marad a nyers név
      }
      out.push({ uri, name, shared: false });
    }
  }
  return out;
}
