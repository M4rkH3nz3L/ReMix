import * as DocumentPicker from 'expo-document-picker';
import { classifyAudioIntake, type AudioIntakeResult } from '@/lib/audioIntake';
import { Directory, File, Paths } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

import { bakeImage } from '@/lib/imageEditor';
import { intakeOps } from '@/lib/imageIntake';
import { parseCubeLut } from '@/lib/lutImport';
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
  /** bevételi osztályozás (barátságos hiba/figyelmeztetés — a UI-nak) */
  intake: AudioIntakeResult;
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

/**
 * 🡇 Egy ABSZOLÚT http(s) URL letöltése a média-mappába → a helyi uri (offline-cache).
 * A külső (felhő) forrás helyi másolatához (08-storage §2.2). Weben / nem-http uri-nál
 * null (nincs natív FS). Hiba vagy nem-ok válasz → null. A hívó a kapott uri-ból ad
 * egy helyi `Asset`-et a projekt forrás-mappájába.
 */
export async function downloadToCache(url: string, name?: string): Promise<string | null> {
  if (Platform.OS === 'web' || !/^https?:\/\//i.test(url)) {
    return null;
  }
  try {
    const dir = new Directory(Paths.document, 'media');
    if (!dir.exists) {
      dir.create();
    }
    const res = await fetch(url);
    if (!res.ok) {
      return null;
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    const base = (name || url.split('/').pop() || 'media').split('?')[0];
    const target = new File(dir, `${Date.now().toString(36)}_${base}`);
    if (!target.exists) {
      target.create();
    }
    target.write(buf);
    return target.uri;
  } catch {
    return null;
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

/**
 * 🧼 Bevitt kép normalizálása (prod-robusztusság): re-encode (JPEG/PNG) → az EXIF-
 * tájolás BEÉGED (az álló/fekvő telefon-fotó helyesen áll) és a HEIC/HEIF JPEG-re
 * konvertálódik (a worker-ffmpeg nem feltétlen dekódol HEIC-et), a nagy-felbontású
 * kép pedig a szerkesztéshez/exporthoz elég méretre (`INTAKE_MAX_DIM`) kicsinyedik.
 * Hiba esetén az eredeti (tartós) uri megy tovább — a felvétel ne vesszen el.
 */
export async function normalizePickedImage(
  uri: string,
  width?: number,
  height?: number
): Promise<{ uri: string; width?: number; height?: number }> {
  try {
    const baked = await bakeImage(uri, intakeOps(width, height), { persist: true });
    return { uri: baked.uri, width: baked.width, height: baked.height };
  } catch {
    return { uri: persistToLibrary(uri), width, height };
  }
}

export async function pickImage(): Promise<{ uri: string; width?: number; height?: number } | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: false,
    quality: 1,
  });
  if (result.canceled || result.assets.length === 0) {
    return null;
  }
  const asset = result.assets[0];
  return normalizePickedImage(asset.uri, asset.width, asset.height);
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
  // 🎵 §5 bevételi osztályozás: barátságos hiba/figyelmeztetés a néma kudarc helyett
  const intake = classifyAudioIntake({ uri, name: asset.name, durationSec: duration });
  return { uri, name: asset.name, duration, intake };
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

/**
 * 🎞️ `.cube` 3D LUT kiválasztása + tartalmi validálás (`parseCubeLut`). A fájlt a
 * cache-be másoljuk (a render feltölti), a nevet a UI mutatja. Visszatérés:
 *  - `{ uri, name }` ha érvényes LUT,
 *  - `'invalid'` ha a fájl nem értelmezhető .cube,
 *  - `null` ha a felhasználó elvetette.
 */
export async function pickCubeLut(): Promise<{ uri: string; name: string } | 'invalid' | null> {
  const result = await DocumentPicker.getDocumentAsync({
    // a .cube-nak nincs egységes MIME-ja → szélesre nyitunk, tartalom alapján validálunk
    type: ['text/plain', 'application/octet-stream', '*/*'],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled || result.assets.length === 0) {
    return null;
  }
  const asset = result.assets[0];
  try {
    const text = await new File(asset.uri).text();
    const parsed = parseCubeLut(text);
    if (!parsed.ok) {
      return 'invalid';
    }
    return { uri: asset.uri, name: asset.name ?? 'LUT.cube' };
  } catch {
    return 'invalid';
  }
}

/** SVG-fájl kiválasztása és beolvasása (nyers XML-szöveg); null, ha elvetve. */
export async function pickSvg(): Promise<string | null> {
  const result = await DocumentPicker.getDocumentAsync({
    // sok picker nem ad pontos MIME-t az SVG-re → szélesre nyitunk, a
    // `parseSvg` úgyis tartalom alapján dolgozik
    type: ['image/svg+xml', 'text/xml', 'application/xml', 'text/plain', 'application/octet-stream'],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled || result.assets.length === 0) {
    return null;
  }
  return new File(result.assets[0].uri).text();
}
