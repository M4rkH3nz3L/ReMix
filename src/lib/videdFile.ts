import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { t as tr } from 'i18next';
import { Alert, Platform } from 'react-native';

import { fingerprintFile, withFingerprints } from '@/lib/fingerprint';
import { makeId } from '@/lib/id';
import { pickAudio, pickImage, pickVideo } from '@/lib/media';
import { migrateProject, relinkUri } from '@/lib/projectUtils';
import type { Clip, Project } from '@/types/project';

/**
 * `.vided` projektfájl (full-plan F2): a projekt + asset-referenciák, nyers
 * média NÉLKÜL — átadható, verziózott formátum. Az import validál, migrál
 * (régi sémák is jönnek), a hiányzó médiát felismeri és felajánlja az
 * újracsatolást (Relink). A médiával együtt csomagolt archívumot a worker
 * /collect végpontja adja (lásd lib/render.ts collectAndShareProject).
 */

export const VIDED_FORMAT = 'vided-project';

interface VidedFileV1 {
  format: typeof VIDED_FORMAT;
  version: 1;
  exportedAt: string;
  project: Project;
}

function safeName(name: string): string {
  return name.replace(/[^\p{L}\p{N}_-]+/gu, '-') || 'projekt';
}

/** `.vided` fájl megosztása (projekt + asset-referenciák, média nélkül). */
export async function shareVidedFile(project: Project): Promise<void> {
  const payload: VidedFileV1 = {
    format: VIDED_FORMAT,
    version: 1,
    exportedAt: new Date().toISOString(),
    // md5+méret identitás minden assethez — a fogadó eszköz tartalom szerint
    // tudja majd újracsatolni a médiát (autoRelink)
    project: await withFingerprints(project),
  };
  const file = new File(Paths.cache, `${safeName(project.name)}.remix`);
  file.write(JSON.stringify(payload, null, 2));
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, {
      mimeType: 'application/json',
      dialogTitle: `${safeName(project.name)}.remix`,
    });
  }
}

/** Elfogadja a `.vided` borítékot ÉS a korábbi nyers projekt-JSON-t is. */
function parseVided(text: string): Project {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(tr('lib.videdFile.invalidJson'));
  }
  const wrapper = parsed as Partial<VidedFileV1>;
  const raw = (wrapper?.format === VIDED_FORMAT ? wrapper.project : parsed) as Project;
  if (!raw || !Array.isArray(raw.tracks) || typeof raw.name !== 'string') {
    throw new Error(tr('lib.videdFile.invalidProject'));
  }
  return migrateProject(raw);
}

export interface MissingMedia {
  uri: string;
  kind: 'video' | 'image' | 'audio';
  label: string;
}

type MediaClip = Extract<Clip, { uri: string }>;

function mediaClips(project: Project): MediaClip[] {
  return project.tracks.flatMap((t) =>
    t.clips.filter(
      (c): c is MediaClip => c.kind === 'video' || c.kind === 'image' || c.kind === 'audio'
    )
  );
}

/** Az eszközön nem elérhető médiafájlok (a http-forrásokat elérhetőnek vesszük). */
export function findMissingMedia(project: Project): MissingMedia[] {
  const seen = new Map<string, MissingMedia>();
  const check = (uri: string, kind: MissingMedia['kind'], fallbackLabel: string) => {
    if (seen.has(uri) || uri.startsWith('http')) {
      return;
    }
    let exists = false;
    try {
      exists = new File(uri).exists;
    } catch {
      exists = false;
    }
    if (!exists) {
      const asset = project.assets.find((a) => a.uri === uri);
      seen.set(uri, {
        uri,
        kind,
        label: asset?.name ?? fallbackLabel,
      });
    }
  };
  for (const clip of mediaClips(project)) {
    check(
      clip.uri,
      clip.kind,
      'label' in clip && clip.label ? clip.label : (clip.uri.split('/').pop() ?? clip.uri)
    );
  }
  // kép-kitöltésű formák (logó / AI-kivágás / 3D objektum / vízjel) is médiák
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      if (clip.kind === 'shape' && clip.imageUri) {
        check(clip.imageUri, 'image', clip.imageUri.split('/').pop() ?? clip.imageUri);
      }
    }
  }
  return [...seen.values()];
}

export interface RelinkPair {
  oldUri: string;
  newUri: string;
}

export interface ImportResult {
  project: Project;
  missing: MissingMedia[];
  /** hash/méret alapján automatikusan újracsatolt fájlok száma */
  relinked: number;
}

/**
 * Automatikus relink tartalom-azonosság alapján: az app médiatárának
 * (Documents/media) fájljait előbb méret szerint szűrjük, majd — ha az asset
 * hordoz hash-t — md5-tel igazoljuk az egyezést. Ami itt nem talál párt,
 * arra marad a kézi választó (relinkInteractive).
 */
/**
 * A tartalom-azonosság alapján (méret-előszűrés + md5) automatikusan
 * párosítható tételek — a hívó dönt az alkalmazásról (dispatch vagy relinkUri).
 */
export async function findAutoRelinkPairs(
  project: Project,
  missing: MissingMedia[]
): Promise<RelinkPair[]> {
  if (missing.length === 0 || Platform.OS === 'web') {
    return [];
  }
  let dir: Directory;
  try {
    dir = new Directory(Paths.document, 'media');
    if (!dir.exists) {
      return [];
    }
  } catch {
    return [];
  }
  const candidates = dir.list().filter((entry): entry is File => entry instanceof File);
  // egy jelölt md5-ét csak egyszer számoljuk ki
  const candidateHash = new Map<string, string | undefined>();
  const pairs: RelinkPair[] = [];

  for (const item of missing) {
    const asset = project.assets.find((a) => a.uri === item.uri);
    if (!asset || (!asset.hash && !asset.size)) {
      // nincs tartalom-azonosság — konténer-költözésnél (pl. Expo Go frissítés
      // után) a fájlnév változatlan marad, így a névazonos médiatár-fájl
      // biztonságos pár (a media/ nevei determinisztikusak: lib_/st3d_/cutout_…)
      const fileName = item.uri.split('/').pop();
      const byName = fileName
        ? candidates.find((c) => c.uri.split('/').pop() === fileName)
        : undefined;
      if (byName) {
        pairs.push({ oldUri: item.uri, newUri: byName.uri });
      }
      continue;
    }
    for (const cand of candidates) {
      if (asset.size && cand.size !== asset.size) {
        continue;
      }
      if (asset.hash) {
        if (!candidateHash.has(cand.uri)) {
          const fp = await fingerprintFile(cand.uri);
          candidateHash.set(cand.uri, fp?.hash);
        }
        if (candidateHash.get(cand.uri) !== asset.hash) {
          continue;
        }
      } else if (!asset.size) {
        continue;
      }
      pairs.push({ oldUri: item.uri, newUri: cand.uri });
      break;
    }
  }
  return pairs;
}

export async function autoRelink(
  project: Project,
  missing: MissingMedia[]
): Promise<{ project: Project; relinked: number; missing: MissingMedia[] }> {
  const pairs = await findAutoRelinkPairs(project, missing);
  let next = project;
  for (const pair of pairs) {
    next = relinkUri(next, pair.oldUri, pair.newUri);
  }
  return { project: next, relinked: pairs.length, missing: findMissingMedia(next) };
}

/**
 * `.vided` (vagy projekt-JSON) kiválasztása és beolvasása. Új projekt-azonosítót
 * kap (nem ír felül meglévőt); a mentés a hívó dolga — így a relink még a
 * mentés előtt lefuthat.
 */
export async function pickAndParseVided(): Promise<ImportResult | null> {
  if (Platform.OS === 'web') {
    throw new Error(tr('lib.videdFile.importNativeOnly'));
  }
  const result = await DocumentPicker.getDocumentAsync({
    copyToCacheDirectory: true,
    multiple: false,
    type: ['application/json', 'application/octet-stream', 'text/plain', '*/*'],
  });
  if (result.canceled || result.assets.length === 0) {
    return null;
  }
  const text = await new File(result.assets[0].uri).text();
  const source = parseVided(text);
  const now = new Date().toISOString();
  const imported: Project = {
    ...source,
    id: makeId('prj'),
    createdAt: now,
    updatedAt: now,
  };
  // tartalom-alapú auto-relink; kézi választó csak a maradékra kell
  const relink = await autoRelink(imported, findMissingMedia(imported));
  return { project: relink.project, missing: relink.missing, relinked: relink.relinked };
}

/**
 * Kézi újracsatolás sorban: minden tételhez rákérdez, majd a típusnak
 * megfelelő választót nyitja — az összegyűlt párokról a hívó dönt
 * (dispatch vagy relinkUri). A kihagyott tételek kimaradnak.
 */
export async function pickRelinkPairs(missing: MissingMedia[]): Promise<RelinkPair[]> {
  const pairs: RelinkPair[] = [];
  for (const item of missing) {
    const choice = await new Promise<'pick' | 'skip'>((resolve) => {
      Alert.alert(
        tr('lib.videdFile.relinkTitle'),
        tr('lib.videdFile.relinkMessage', { label: item.label }),
        [
          { text: tr('lib.videdFile.skip'), style: 'cancel', onPress: () => resolve('skip') },
          { text: tr('lib.videdFile.select'), onPress: () => resolve('pick') },
        ],
        { cancelable: false }
      );
    });
    if (choice === 'skip') {
      continue;
    }
    try {
      const picked =
        item.kind === 'video'
          ? await pickVideo()
          : item.kind === 'image'
            ? await pickImage()
            : await pickAudio();
      if (picked) {
        pairs.push({ oldUri: item.uri, newUri: picked.uri });
      }
    } catch {
      // a választó hibája nem szakítja meg a többi tétel újracsatolását
    }
  }
  return pairs;
}

/** A régi, projektet visszaadó változat — az import-flow használja. */
export async function relinkInteractive(
  project: Project,
  missing: MissingMedia[]
): Promise<Project> {
  const pairs = await pickRelinkPairs(missing);
  let next = project;
  for (const pair of pairs) {
    next = relinkUri(next, pair.oldUri, pair.newUri);
  }
  return next;
}
