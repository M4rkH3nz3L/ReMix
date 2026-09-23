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
  /** a fájl VALÓS hossza másodpercben (0 = nem sikerült kiolvasni) */
  duration: number;
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

/**
 * 🎵 Egy hangfájl VALÓS hosszának kiolvasása (másodperc). A DocumentPicker NEM ad
 * hosszt, ezért egy ideiglenes (néma, nem lejátszó) lejátszóval kiolvassuk a
 * betöltött státuszból. `0`, ha nem sikerül (időkorlát/olvashatatlan) — a hívó
 * ilyenkor eshet vissza egy alapértelmezésre.
 */
export async function probeAudioDuration(uri: string): Promise<number> {
  // lazy (dinamikus) import: az expo-audio natív modult NE húzzuk be modul-szinten,
  // különben minden, a media.ts-t tranzitívan importáló teszt betöltéskor elhasal
  let createAudioPlayer: typeof import('expo-audio').createAudioPlayer;
  try {
    ({ createAudioPlayer } = await import('expo-audio'));
  } catch {
    return 0;
  }
  return new Promise<number>((resolve) => {
    let player: ReturnType<typeof createAudioPlayer> | null = null;
    let sub: { remove: () => void } | null = null;
    let done = false;
    const finish = (d: number) => {
      if (done) {
        return;
      }
      done = true;
      try {
        sub?.remove();
      } catch {
        // már eltávolítva
      }
      try {
        player?.remove();
      } catch {
        // már felszabadítva
      }
      resolve(Number.isFinite(d) && d > 0 ? d : 0);
    };
    try {
      player = createAudioPlayer(uri);
    } catch {
      finish(0);
      return;
    }
    sub = player.addListener('playbackStatusUpdate', (status) => {
      if (status.isLoaded && status.duration > 0) {
        finish(status.duration);
      }
    });
    // ha a metaadat már kész (cache), rögtön kiolvassuk
    if (player.isLoaded && player.duration > 0) {
      finish(player.duration);
    }
    // biztonsági időkorlát — ne lógjon, ha valamiért nem érkezik státusz
    setTimeout(() => finish(player?.duration ?? 0), 5000);
  });
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
  const uri = persistToLibrary(asset.uri);
  // a VALÓS hossz kiolvasása → a teljes fájl importálható (nem fix 10 mp)
  const duration = await probeAudioDuration(uri).catch(() => 0);
  return { uri, name: asset.name, duration };
}

export interface PickedLut {
  uri: string;
  name: string;
}

/**
 * .cube 3D LUT kiválasztása. A `.cube`-nak nincs egységes MIME-ja, ezért szélesre
 * nyitunk, és kiterjesztés alapján validálunk. `null` = elvetve; `'invalid'` =
 * nem .cube (a hívó jelezzen). A fájlt az app tárába másoljuk (stabil uri).
 */
export async function pickLut(): Promise<PickedLut | 'invalid' | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['application/octet-stream', 'text/plain', 'text/*', '*/*'],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled || result.assets.length === 0) {
    return null;
  }
  const asset = result.assets[0];
  if (!/\.cube$/i.test(asset.name)) {
    return 'invalid';
  }
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
