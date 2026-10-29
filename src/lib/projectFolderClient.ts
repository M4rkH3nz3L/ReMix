import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import { extractMediaKeys } from '@/lib/mediaGc';
import {
  OWNER_MARKER,
  PROJECTS_DIR,
  deviceRelativePath,
  isHiddenName,
  planAdoption,
  projectFolderPath,
  slugifyProjectName,
  uniqueFolderName,
} from '@/lib/projectFolder';

/**
 * 📁 Projekt-mappa — FS-oldal (a pure mag a `projectFolder.ts`-ben).
 *
 * Minden projekt saját mappája az Eszközömben: `Paths.document/Files/Projektek/<folder>`.
 * A projekt nyitásakor ez lesz az AKTÍV média-mappa: minden import/felvétel/
 * generált média (`projectMediaDir()`) ide kerül. A mappa neve a létrehozáskor
 * rögzül (`project.folder`) — átnevezéskor NEM változik, mert a projekt az
 * abszolút fájl-uri-kra hivatkozik.
 */

let activeFolder: string | null = null;

/** Az Eszközöm `Projektek` gyűjtő-mappája (létrehozza, ha kell). */
export function projectsRoot(): Directory {
  const root = new Directory(Paths.document, 'Files', PROJECTS_DIR);
  if (!root.exists) {
    root.create({ intermediates: true, idempotent: true });
  }
  return root;
}

export function projectFolderDir(folder: string): Directory {
  return new Directory(projectsRoot(), folder);
}

/** Új, ütközésmentes projekt-mappa a projekt nevéből (tulajdonos-jelölővel) → a mappanév. */
function createProjectFolder(projectName: string, projectId: string): string | null {
  const root = projectsRoot();
  const folder = uniqueFolderName(
    slugifyProjectName(projectName),
    root.list().map((n) => n.name)
  );
  const dir = new Directory(root, folder);
  dir.create({ intermediates: true, idempotent: true });
  writeOwner(dir, projectId);
  return folder;
}

function writeOwner(dir: Directory, projectId: string): void {
  const marker = new File(dir, OWNER_MARKER);
  if (!marker.exists) {
    marker.create();
  }
  marker.write(projectId);
}

function ownerOf(dir: Directory | File): string | null {
  if (!(dir instanceof Directory)) {
    return null;
  }
  try {
    const marker = new File(dir, OWNER_MARKER);
    return marker.exists ? marker.textSync().trim() || null : null;
  } catch {
    return null;
  }
}

/**
 * A projekt SAJÁT mappájának biztosítása (a betöltéskor, MIELŐTT a szerkesztő
 * megkapná): nincs `folder` → új mappa; a mappa eltűnt → újra létrejön ugyanazon
 * a néven; a mappa MÁSIK projekté (importált / duplikált projekt hozta a nevet) →
 * új mappa. A tulajdonost a rejtett `.remix-project` jelölő rögzíti.
 * Visszaadja a (módosult) projektet és hogy változott-e a `folder`.
 */
function ensureOwnedFolder<T extends { id: string; name: string; folder?: string }>(
  project: T
): { project: T; changed: boolean } {
  if (project.folder) {
    const dir = projectFolderDir(project.folder);
    if (!dir.exists) {
      dir.create({ intermediates: true, idempotent: true });
      writeOwner(dir, project.id);
      return { project, changed: false };
    }
    const owner = ownerOf(dir);
    if (owner === project.id) {
      return { project, changed: false };
    }
    if (owner === null) {
      writeOwner(dir, project.id);
      return { project, changed: false };
    }
  }
  // a projekt mappája már létezhet (a `folder` mező nélküli régebbi példány tért vissza,
  // pl. felhőből) → a tulajdonos-jelölő alapján visszakeressük, nem nyitunk másodikat
  const existing = projectsRoot()
    .list()
    .find((n) => n instanceof Directory && ownerOf(n) === project.id);
  if (existing) {
    return { project: { ...project, folder: existing.name }, changed: true };
  }
  const folder = createProjectFolder(project.name, project.id);
  return folder ? { project: { ...project, folder }, changed: true } : { project, changed: false };
}

/** Ütközésmentes fájlnév a mappában: `a.mp4` → `a (1).mp4` … */
export function freeFileName(dir: Directory, name: string): string {
  const taken = new Set(dir.list().map((n) => n.name));
  if (!taken.has(name)) {
    return name;
  }
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let i = 1;
  while (taken.has(`${stem} (${i})${ext}`)) {
    i++;
  }
  return `${stem} (${i})${ext}`;
}

/**
 * 📁 A projekt felkészítése a saját mappájára: mappa biztosítása + minden hivatkozott,
 * de a mappán KÍVÜL fekvő app-fájl átvétele (a régi közös `media`-ból mozgatva, ha
 * más nem hivatkozik rá; másik projekt/user-mappa fájljából másolva), a projekt-JSON
 * uri-jainak átírásával. `otherDocs` = a TÖBBI tárolt dokumentum nyers JSON-ja
 * (lustán kérjük, csak ha van mit átvenni). Weben / hibánál a projekt változatlan.
 */
export async function prepareProjectFolder<T extends { id: string; name: string; folder?: string }>(
  project: T,
  otherDocs: () => Promise<(string | null | undefined)[]>
): Promise<{ project: T; changed: boolean }> {
  if (Platform.OS === 'web') {
    return { project, changed: false };
  }
  try {
    const owned = ensureOwnedFolder(project);
    let next = owned.project;
    let changed = owned.changed;
    const folder = next.folder;
    if (!folder) {
      return { project, changed: false };
    }
    let raw = JSON.stringify(next);
    const plan = planAdoption(raw.match(/file:\/\/[^"\\]+/g) ?? [], folder);
    if (plan.length === 0) {
      return { project: next, changed };
    }
    const others = plan.some((p) => !p.shared) ? await otherDocs() : [];
    const dir = projectFolderDir(folder);
    for (const item of plan) {
      try {
        const src = new File(item.uri);
        if (!src.exists) {
          continue; // hiányzó média — a relink-útvonal intézi
        }
        const target = new File(dir, freeFileName(dir, item.name));
        const sharedElsewhere = item.shared || others.some((d) => d?.includes(item.uri));
        if (sharedElsewhere) {
          src.copySync(target);
        } else {
          src.moveSync(target);
        }
        raw = raw.split(item.uri).join(target.uri);
        changed = true;
      } catch {
        // egy fájl hibája nem állítja meg a többit
      }
    }
    next = JSON.parse(raw) as T;
    return { project: next, changed };
  } catch {
    return { project, changed: false };
  }
}

/** A megnyitott projekt mappája lesz az aktív média-cél (null = nincs nyitott projekt). */
export function setActiveProjectFolder(folder: string | null | undefined): void {
  activeFolder = folder || null;
}

export function activeProjectFolder(): string | null {
  return activeFolder;
}

/**
 * 🎯 Az a mappa, AHOVÁ az új projekt-média kerül: a nyitott projekt mappája, vagy
 * (projekten kívül, pl. profil-kép) a régi közös `media` mappa. Mindig létezik.
 */
export function projectMediaDir(): Directory {
  if (activeFolder) {
    try {
      const dir = projectFolderDir(activeFolder);
      if (!dir.exists) {
        dir.create({ intermediates: true, idempotent: true });
      }
      return dir;
    } catch {
      // esés a közös mappára
    }
  }
  const dir = new Directory(Paths.document, 'media');
  if (!dir.exists) {
    dir.create({ intermediates: true, idempotent: true });
  }
  return dir;
}

export interface FolderFile {
  /** a projekt-mappán belüli relatív út */
  path: string;
  size: number;
  uri: string;
}

/** A projekt-mappa összes fájlja (rekurzív). */
export function listProjectFolderFiles(folder: string): FolderFile[] {
  const out: FolderFile[] = [];
  const walk = (dir: Directory, prefix: string) => {
    for (const n of dir.list()) {
      if (n instanceof Directory) {
        walk(n, `${prefix}${n.name}/`);
      } else if (!n.name.endsWith('.part') && !isHiddenName(n.name)) {
        out.push({ path: `${prefix}${n.name}`, size: n.size ?? 0, uri: n.uri });
      }
    }
  };
  try {
    const dir = projectFolderDir(folder);
    if (dir.exists) {
      walk(dir, '');
    }
  } catch {
    // nem olvasható mappa → üres
  }
  return out;
}

/**
 * 🧊 A 3D-projekt mappájából a már SEHOL nem hivatkozott 3D-fájlok törlése (régi szken
 * „Új szken" után, elavult poszter, korábbi export-állókép). Csak az `m3d_` előtagú
 * fájlok; a név bármely megadott dokumentumban (projekt / verziók / recovery) megtalálható
 * → marad. Best-effort, a felszabadított bájtokat adja.
 */
export function pruneUnreferencedModelFiles(folder: string, docs: readonly (string | null | undefined)[]): number {
  if (Platform.OS === 'web' || !folder) {
    return 0;
  }
  let freed = 0;
  for (const f of listProjectFolderFiles(folder)) {
    const name = f.path.split('/').pop() ?? '';
    if (!name.startsWith('m3d_') || docs.some((d) => d?.includes(name))) {
      continue;
    }
    try {
      new File(f.uri).delete();
      freed += f.size;
    } catch {
      // a takarítás nem kritikus
    }
  }
  return freed;
}

/** A projekt-mappa mérete (bájt). */
export function projectFolderBytes(folder: string): number {
  return listProjectFolderFiles(folder).reduce((a, f) => a + f.size, 0);
}

/**
 * 🗑️ A projekt-mappa eltávolítása a projekt TÖRLÉSEKOR. Ami a megmaradó
 * dokumentumokban (másik projekt/verzió/recovery) még hivatkozott, az marad —
 * így egy duplikált projekt fájljai sem vesznek el; ha semmi nem marad, a mappa
 * is törlődik. Best-effort.
 */
export function removeProjectFolder(folder: string, remainingDocs: readonly (string | null | undefined)[]): void {
  if (Platform.OS === 'web' || !folder) {
    return;
  }
  const referenced = new Set<string>();
  for (const raw of remainingDocs) {
    for (const k of extractMediaKeys(raw)) {
      referenced.add(k);
    }
  }
  const base = projectFolderPath(folder);
  let kept = 0;
  for (const f of listProjectFolderFiles(folder)) {
    if (referenced.has(`Files/${base}/${f.path}`)) {
      kept += 1;
      continue;
    }
    try {
      new File(f.uri).delete();
    } catch {
      kept += 1;
    }
  }
  if (kept === 0) {
    try {
      projectFolderDir(folder).delete();
    } catch {
      // zárolt — a következő törlés elviszi
    }
  }
}

/**
 * A projekt által HIVATKOZOTT fájlok Tárhelyem-relatív útjai (a törlés-védelemhez):
 * `Projektek/<folder>/…` formában.
 */
export function referencedDevicePaths(projectJson: string): Set<string> {
  const out = new Set<string>();
  for (const uri of projectJson.match(/file:\/\/[^"\\]+/g) ?? []) {
    const rel = deviceRelativePath(uri);
    if (rel) {
      out.add(rel);
    }
  }
  return out;
}
