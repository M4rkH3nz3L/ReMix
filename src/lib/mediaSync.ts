import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import { reachableMediaUrl } from '@/lib/mediaUrl';
import { uploadMediaResult } from '@/lib/render';
import { findMissingMedia, type MissingMedia, type RelinkPair } from '@/lib/videdFile';
import type { Asset, Project } from '@/types/project';

/**
 * 🗄️ Média-szinkron — a projekt médiafájljainak SZERVER-tárolása és a hiányzó
 * fájlok automatikus visszaállítása.
 *
 * MIÉRT: a klipek helyi `file://` utakra hivatkoznak. Konténer-váltáskor (Expo Go
 * frissítés/újratelepítés, eszközváltás) ezek elszakadnak → „hiányzó fájl". Ezért
 * minden helyi asset EGYSZER feltöltődik a szerverre (`remoteUrl`), a felhő-projekt-
 * másolat hordozza, és betöltéskor a hiányzó fájl innen automatikusan visszaáll.
 *
 * A feltöltés/relink IO; a kiválasztó helperek (`mediaRemoteMap`, `needsBackup`)
 * tiszták → tesztelhetők.
 */

/** asset.uri → remoteUrl azoknál az asseteknél, amiknek van szerver-másolatuk. */
export function mediaRemoteMap(project: Project): Record<string, string> {
  const map: Record<string, string> = {};
  for (const a of project.assets) {
    if (a.remoteUrl) {
      map[a.uri] = a.remoteUrl;
    }
  }
  return map;
}

/** Egy asset szerver-backupra szorul-e (helyi fájl, még nincs szerver-másolata). */
export function needsBackup(asset: Asset, known: Record<string, string>): boolean {
  if (!asset.uri || /^https?:\/\//i.test(asset.uri)) {
    return false;
  }
  if (asset.remoteUrl || known[asset.uri]) {
    return false;
  }
  // Bármely HELYI fájl (nem-http uri) mentendő — a `remote` provider is, ha a
  // háttere letöltött file:// (a streamelhető http-t a fenti guard már kizárta).
  return asset.provider === 'local' || asset.provider === 'library' || asset.provider === 'remote';
}

function fileExists(uri: string): boolean {
  try {
    return new File(uri).exists;
  } catch {
    return false;
  }
}

/**
 * 🩹 Granuláris helyreállítás-TERV (pure, tesztelhető — CORE §2.8). A hiányzó
 * médiákat két csoportra bontja: amelyikhez VAN elérhető szerver-másolat
 * (`restorable` → a `restoreMissingMedia` automatikusan letölti), és amelyik
 * ÁRVA (`orphaned` → nincs felhő-forrás, csak KÉZI relink segít). Így a UI
 * világosan tud üzenni: „3/5 visszaállítva a felhőből, 2 fájlhoz nincs másolat
 * → csatold újra". A `missing` listát a HÍVÓ adja (`findMissingMedia` — fájl-IO),
 * hogy EZ a mag tiszta/tesztelhető maradjon; a `remoteByUri` a felhő-projekt-
 * másolatból jövő uri→remoteUrl térkép.
 */
export interface MediaRecoveryPlan {
  restorable: MissingMedia[];
  orphaned: MissingMedia[];
}

export function classifyMissingMedia(
  project: Project,
  missing: MissingMedia[],
  remoteByUri: Record<string, string> = {}
): MediaRecoveryPlan {
  const restorable: MissingMedia[] = [];
  const orphaned: MissingMedia[] = [];
  for (const m of missing) {
    const asset = project.assets.find((a) => a.uri === m.uri);
    const source = reachableMediaUrl(asset?.remoteUrl ?? remoteByUri[m.uri] ?? null);
    (source ? restorable : orphaned).push(m);
  }
  return { restorable, orphaned };
}

/**
 * 🩹 Egy visszaállítási KÖR eredménye (pure): a kezdeti `missing` listából mi
 * állt vissza (van rá relink-pár) és mi maradt hiányzó (bukott letöltés / nincs
 * forrás). A `failed` a per-fájl ÚJRAPRÓBA alanya — egy fájl bukása sosem
 * buktatja a többit. (A pár-illesztés az `oldUri`-ra megy.)
 */
export interface MediaRecoveryOutcome {
  restored: MissingMedia[];
  failed: MissingMedia[];
}

export function recoveryOutcome(
  missing: MissingMedia[],
  pairs: RelinkPair[]
): MediaRecoveryOutcome {
  const done = new Set(pairs.map((p) => p.oldUri));
  const restored: MissingMedia[] = [];
  const failed: MissingMedia[] = [];
  for (const m of missing) {
    (done.has(m.uri) ? restored : failed).push(m);
  }
  return { restored, failed };
}

/**
 * A projekt médiafájljainak szerver-backupja: minden helyi asset EGYSZER töltődik
 * fel (idempotens a `known` remote-térkép alapján) és megkapja a `remoteUrl`-t.
 * Best-effort: egy-egy feltöltés hibája nem állítja meg a többit. A `known` a
 * felhő-másolat már ismert remote-jai (a duplán-feltöltés ellen).
 */
export async function backupProjectMedia(
  project: Project,
  known: Record<string, string> = {}
): Promise<{ project: Project; uploaded: number }> {
  if (Platform.OS === 'web') {
    return { project, uploaded: 0 };
  }
  let uploaded = 0;
  let changed = false;
  const assets: Asset[] = [];
  for (const a of project.assets) {
    const existing = a.remoteUrl ?? known[a.uri];
    if (existing) {
      if (a.remoteUrl) {
        assets.push(a);
      } else {
        assets.push({ ...a, remoteUrl: existing });
        changed = true;
      }
      continue;
    }
    if (!needsBackup(a, known) || !fileExists(a.uri)) {
      assets.push(a);
      continue;
    }
    try {
      const { url: remoteUrl, size } = await uploadMediaResult(a.uri, {
        projectId: project.id,
        kind: 'media',
        name: a.name,
      });
      // a szerver-mért bájt → asset.size (a per-projekt/kvóta elszámoláshoz)
      assets.push({ ...a, remoteUrl, ...(size > 0 ? { size } : {}) });
      uploaded += 1;
      changed = true;
    } catch {
      assets.push(a); // a feltöltés bukása nem állítja meg a többit
    }
  }
  return { project: changed ? { ...project, assets } : project, uploaded };
}

/**
 * 🎯 Kiválasztható visszaállítás cél-listája (pure): a KÉRT asset-urikból azok,
 * amikhez van elérhető felhő-forrás — fájlonkénti user-visszaállításhoz
 * (nem csak a hiányzókra: a felülírt/sérült helyi fájl is visszahozható).
 */
export function selectableRestoreTargets(
  project: Project,
  selectedUris: readonly string[],
  remoteByUri: Record<string, string> = {}
): { uri: string; url: string; name: string }[] {
  const out: { uri: string; url: string; name: string }[] = [];
  for (const uri of new Set(selectedUris)) {
    const asset = project.assets.find((a) => a.uri === uri);
    const url = reachableMediaUrl(asset?.remoteUrl ?? remoteByUri[uri] ?? null);
    if (url) {
      out.push({ uri, url, name: asset?.name ?? (uri.split('/').pop() ?? uri) });
    }
  }
  return out;
}

/**
 * 🎯 A user által KIVÁLASZTOTT fájlok visszaállítása a felhő-másolatból (akkor
 * is, ha helyben létezik — pl. sérült/felülírt fájl). A letöltés a determinista
 * `mediacache` névre megy (újratöltésnél FELÜLÍR — ez a visszaállítás értelme),
 * az eredmény relink-PÁR, amit a hívó a command-buson visz át.
 */
export async function restoreSelectedMedia(
  project: Project,
  selectedUris: readonly string[],
  remoteByUri: Record<string, string> = {}
): Promise<{ pairs: RelinkPair[]; failed: string[] }> {
  if (Platform.OS === 'web') {
    return { pairs: [], failed: [...selectedUris] };
  }
  const targets = selectableRestoreTargets(project, selectedUris, remoteByUri);
  let dir: Directory;
  try {
    dir = new Directory(Paths.document, 'mediacache');
    if (!dir.exists) {
      dir.create({ intermediates: true });
    }
  } catch {
    return { pairs: [], failed: targets.map((t) => t.uri) };
  }
  const pairs: RelinkPair[] = [];
  const failed: string[] = [];
  for (const t of targets) {
    const base = t.url.split('?')[0].split('/').pop() || t.name;
    const file = new File(dir, base);
    try {
      // explicit visszaállítás → a meglévő cache-példányt is frissítjük
      if (file.exists) {
        file.delete();
      }
      await File.downloadFileAsync(t.url, file);
      if ((file.size ?? 0) === 0) {
        failed.push(t.uri);
        continue;
      }
      pairs.push({ oldUri: t.uri, newUri: file.uri });
    } catch {
      failed.push(t.uri);
    }
  }
  return { pairs, failed };
}

/**
 * A hiányzó (helyileg nem elérhető) médiafájlok letöltése a szerver-másolatból egy
 * determinisztikus cache-fájlba, és a `oldUri→newUri` relink-PÁROK visszaadása.
 *
 * FONTOS: NEM alkalmazza magát a relinket a projektre — a párokat a HÍVÓ a
 * command-buson (`RELINK_URI` dispatch) viszi a JELENLEGI store-projektre, hogy a
 * több másodperces letöltés alatt tett szerkesztések ne vesszenek el, és az
 * undo/playhead ne nullázódjon (nem `loadProject`). A `remoteByUri` a felhő-
 * projekt-másolatból származó uri→remoteUrl térkép, ha a helyi assetnek nincs
 * `remoteUrl`-je.
 */
export async function restoreMissingMedia(
  project: Project,
  remoteByUri: Record<string, string> = {}
): Promise<{ pairs: RelinkPair[] } & MediaRecoveryOutcome> {
  if (Platform.OS === 'web') {
    return { pairs: [], restored: [], failed: [] };
  }
  const missing = findMissingMedia(project);
  if (missing.length === 0) {
    return { pairs: [], restored: [], failed: [] };
  }
  let dir: Directory;
  try {
    dir = new Directory(Paths.document, 'mediacache');
    if (!dir.exists) {
      dir.create({ intermediates: true });
    }
  } catch {
    // a cache-mappa se jött létre → semmit sem tudtunk visszaállítani
    return { pairs: [], restored: [], failed: missing };
  }
  const pairs: RelinkPair[] = [];
  for (const m of missing) {
    const asset = project.assets.find((a) => a.uri === m.uri);
    const url = reachableMediaUrl(asset?.remoteUrl ?? remoteByUri[m.uri] ?? null);
    if (!url) {
      continue;
    }
    // determinisztikus cache-név (a storage-kulcs uuid-je) → újratöltés újrahasznál
    const base = url.split('?')[0].split('/').pop() || `${m.kind}-${asset?.id ?? 'media'}`;
    const target = new File(dir, base);
    try {
      // A downloadFileAsync ATOMIKUS (temp → move CSAK siker után), így megszakadt
      // letöltés NEM hagy csonka fájlt a cél-néven. A 0-bájtos cache-t (pl. hibás
      // szerver-válasz) újratöltjük, és üres eredményt NEM relinkelünk.
      if (!target.exists || (target.size ?? 0) === 0) {
        await File.downloadFileAsync(url, target);
      }
      if ((target.size ?? 0) === 0) {
        try {
          target.delete();
        } catch {
          // takarítás best-effort
        }
        continue;
      }
      pairs.push({ oldUri: m.uri, newUri: target.uri });
    } catch {
      // egy fájl bukása nem állítja meg a többi visszaállítását
    }
  }
  return { pairs, ...recoveryOutcome(missing, pairs) };
}
