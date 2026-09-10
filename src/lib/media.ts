import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';

import { parseSrt } from '@/lib/srt';
import type { SrtCue } from '@/lib/srt';

export interface PickedVideo {
  uri: string;
  /** mp */
  duration: number;
  width: number;
  height: number;
}

export interface PickedAudio {
  uri: string;
  name: string;
}

/**
 * A picker-ek cache-URI-t adnak, amit az OS bármikor kitakaríthat — a kiválasztott
 * médiát ezért átmásoljuk az app dokumentum-mappájába. Hiba esetén az eredeti
 * URI-val megyünk tovább (a draft attól még működik).
 */
function persistToLibrary(uri: string): string {
  try {
    const dir = new Directory(Paths.document, 'media');
    if (!dir.exists) {
      dir.create();
    }
    const source = new File(uri);
    const target = new File(dir, `${Date.now().toString(36)}_${source.name}`);
    source.copy(target);
    return target.uri;
  } catch {
    return uri;
  }
}

export async function pickVideo(): Promise<PickedVideo | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['videos'],
    allowsMultipleSelection: false,
    quality: 1,
  });
  if (result.canceled || result.assets.length === 0) {
    return null;
  }
  const asset = result.assets[0];
  return {
    uri: persistToLibrary(asset.uri),
    duration: (asset.duration ?? 0) / 1000,
    width: asset.width,
    height: asset.height,
  };
}

export async function pickImage(): Promise<{ uri: string } | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: false,
    quality: 1,
  });
  if (result.canceled || result.assets.length === 0) {
    return null;
  }
  return { uri: persistToLibrary(result.assets[0].uri) };
}

export async function pickAudio(): Promise<PickedAudio | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: 'audio/*',
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled || result.assets.length === 0) {
    return null;
  }
  const asset = result.assets[0];
  return { uri: persistToLibrary(asset.uri), name: asset.name };
}

/** SRT-fájl kiválasztása és beolvasása; null, ha a felhasználó elvetette. */
export async function pickSrt(): Promise<SrtCue[] | null> {
  const result = await DocumentPicker.getDocumentAsync({
    // az SRT-nek nincs egységes MIME-ja, ezért szélesre nyitunk, és tartalom
    // alapján validálunk
    type: ['application/x-subrip', 'text/plain', 'text/*', 'application/octet-stream'],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled || result.assets.length === 0) {
    return null;
  }
  const content = await new File(result.assets[0].uri).text();
  const cues = parseSrt(content);
  return cues.length > 0 ? cues : [];
}
