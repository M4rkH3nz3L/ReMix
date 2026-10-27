/**
 * 🗂️ Tárhelyem (ReMix Storage) — a fájlkezelő PURE magja (expo-mentes, tesztelhető).
 *
 * Egységes bejegyzés-modell MINDEN tárhelyhez (eszköz, ReMix Storage, később
 * Drive/Dropbox/NAS): a felület ugyanúgy mutatja őket, de a `location` mindig
 * egyértelművé teszi, HOL van a fájl — egy külső/felhős törlés valódi törlés.
 */

/** A tárhely-helyek. A `device` és a `remix` él; a többi a roadmap (lásd devs/tasks/Storage/06). */
export type StorageLocationId = 'device' | 'remix' | 'gdrive' | 'dropbox' | 'nas';

/** Fájltípus-csoport a szűréshez és a „melyik stúdióba nyíljon" döntéshez. */
export type FileKind = 'video' | 'image' | 'audio' | 'project' | 'document' | 'other';

export interface StorageEntry {
  location: StorageLocationId;
  /** a hely gyökeréhez relatív út (`a/b/c.mp4`); mappánál a mappa útja */
  path: string;
  name: string;
  isFolder: boolean;
  /** bájt (mappánál nincs) */
  size?: number;
  /** ISO-idő */
  modified?: string | null;
  /** eszközön a natív `file://` uri (megnyitáshoz/feltöltéshez) */
  uri?: string;
}

export type SortKey = 'name' | 'size' | 'modified' | 'kind';
export type KindFilter = 'all' | FileKind;

const EXT: Record<string, FileKind> = {};
const add = (kind: FileKind, exts: string) => exts.split(' ').forEach((e) => (EXT[e] = kind));
add('video', 'mp4 mov m4v webm mkv avi 3gp hevc');
add('image', 'jpg jpeg png gif webp heic heif bmp tif tiff svg psd avif');
add('audio', 'mp3 wav m4a aac flac ogg opus aif aiff caf');
add('project', 'remix vided rp');
add('document', 'pdf txt md json srt vtt cube csv doc docx');

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

export function fileKindOf(name: string): FileKind {
  return EXT[extensionOf(name)] ?? 'other';
}

/** Melyik stúdió nyitja meg (null = nincs stúdió hozzá; csak megosztás/letöltés). */
export function studioForKind(kind: FileKind): 'video' | 'image' | 'audio' | null {
  return kind === 'video' || kind === 'image' || kind === 'audio' ? kind : null;
}

export function joinPath(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name;
}

export function parentPath(p: string): string {
  const i = p.lastIndexOf('/');
  return i < 0 ? '' : p.slice(0, i);
}

/** Morzsamenü: `a/b` → [{name:'a',path:'a'},{name:'b',path:'a/b'}] (a gyökér a hívóé). */
export function breadcrumbs(p: string): { name: string; path: string }[] {
  const parts = p.split('/').filter(Boolean);
  return parts.map((name, i) => ({ name, path: parts.slice(0, i + 1).join('/') }));
}

/**
 * Fájl-/mappanév ellenőrzés (a szerver `cleanSegment` tükre) — a hiba-kulcsot adja
 * vissza i18n-hez, vagy null-t, ha jó.
 */
export function validateName(raw: string): 'empty' | 'invalid' | 'tooLong' | null {
  const name = raw.trim();
  if (!name) {
    return 'empty';
  }
  if (name.length > 120) {
    return 'tooLong';
  }
  if (name === '.' || name === '..' || name === '.folder' || /[/\\\u0000-\u001f\u007f]/.test(name)) {
    return 'invalid';
  }
  return null;
}

/** Mappák mindig elöl; utána a kért kulcs szerint (név-egyezésnél név szerint). */
export function sortEntries(entries: StorageEntry[], key: SortKey, desc = false): StorageEntry[] {
  const dir = desc ? -1 : 1;
  const byName = (a: StorageEntry, b: StorageEntry) => a.name.localeCompare(b.name, undefined, { numeric: true });
  return [...entries].sort((a, b) => {
    if (a.isFolder !== b.isFolder) {
      return a.isFolder ? -1 : 1;
    }
    let cmp = 0;
    if (key === 'size') {
      cmp = (a.size ?? 0) - (b.size ?? 0);
    } else if (key === 'modified') {
      cmp = Date.parse(a.modified ?? '') - Date.parse(b.modified ?? '') || 0;
    } else if (key === 'kind') {
      cmp = fileKindOf(a.name).localeCompare(fileKindOf(b.name));
    }
    return (cmp || byName(a, b)) * dir;
  });
}

/** Típus-szűrő + szabad-szöveges keresés (a mappák a keresésben is látszanak). */
export function filterEntries(entries: StorageEntry[], kind: KindFilter, query = ''): StorageEntry[] {
  const q = query.trim().toLowerCase();
  return entries.filter((e) => {
    if (q && !e.name.toLowerCase().includes(q)) {
      return false;
    }
    // a mappák a navigációhoz típus-szűrés mellett is látszanak
    return e.isFolder || kind === 'all' || fileKindOf(e.name) === kind;
  });
}

/** Kvóta-állapot a sávhoz: arány (0–1) + szint. */
export function quotaLevel(used: number, quota: number): { fraction: number; level: 'ok' | 'warn' | 'full' } {
  const fraction = quota > 0 ? Math.min(1, Math.max(0, used / quota)) : 0;
  return { fraction, level: fraction >= 1 ? 'full' : fraction >= 0.8 ? 'warn' : 'ok' };
}

/** Elfér-e a feltöltés a maradék kvótában (a szerver KEMÉNY tiltásának kliens-előszűrője). */
export function fitsQuota(used: number, quota: number, incoming: number): boolean {
  return quota <= 0 || used + incoming <= quota;
}
