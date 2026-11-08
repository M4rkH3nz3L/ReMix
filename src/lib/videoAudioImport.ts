import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { File } from 'expo-file-system';
import { requireOptionalNativeModule } from 'expo-modules-core';

import { logCaught } from '@/lib/logCaught';
import { projectMediaDir } from '@/lib/projectFolderClient';

/**
 * 🎬→🎵 Hang videóból a Hang Stúdióban: a Fotókból vagy a Fájlokból választott videó hangsávja
 * külön M4A-ként a projekt-mappába (átkódolás nélkül, ha AAC) — a videó maga nem kerül a projektbe.
 */

interface ExtractModule {
  extractAudio(uri: string, outputPath: string): Promise<{ duration: number; passthrough: boolean }>;
}
const Native = requireOptionalNativeModule<ExtractModule>('RemixRender');

export function canExtractAudio(): boolean {
  return typeof Native?.extractAudio === 'function';
}

export type VideoAudioResult = { ok: true; uri: string; name: string; duration: number } | { ok: false; reason: 'noAudio' | 'failed'; message?: string };

/** a videó hangja M4A-ként a projekt-mappába */
export async function extractVideoAudio(videoUri: string, name: string): Promise<VideoAudioResult> {
  if (!Native) return { ok: false, reason: 'failed', message: 'native' };
  const base = name.replace(/\.[^.]+$/, '').replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 40) || 'video';
  const dir = projectMediaDir();
  if (!dir.exists) dir.create();
  const out = new File(dir, `${Date.now().toString(36)}_${base}_hang.m4a`);
  try {
    // a `file://` uri százalékkódolt (ékezetes név) — a natív oldal valódi útvonalat vár
    const r = await Native.extractAudio(videoUri, decodeURIComponent(out.uri.replace('file://', '')));
    return { ok: true, uri: out.uri, name: base, duration: r.duration };
  } catch (caught) {
    const msg = caught instanceof Error ? caught.message : String(caught);
    if (out.exists) out.delete();
    if (/sávot: audio|no audio/i.test(msg)) return { ok: false, reason: 'noAudio' };
    logCaught('lib/videoAudioImport.ts:extract', caught);
    return { ok: false, reason: 'failed', message: msg };
  }
}

/** videó választása (Fotók vagy Fájlok); a választott fájl a cache-ben marad (csak a hangja kell) */
export async function pickVideoForAudio(from: 'photos' | 'files'): Promise<{ uri: string; name: string } | null> {
  if (from === 'photos') {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'], allowsMultipleSelection: false, quality: 1 });
    if (r.canceled || r.assets.length === 0) return null;
    return { uri: r.assets[0].uri, name: r.assets[0].fileName ?? 'video' };
  }
  const r = await DocumentPicker.getDocumentAsync({ type: 'video/*', copyToCacheDirectory: true, multiple: false });
  if (r.canceled || r.assets.length === 0) return null;
  return { uri: r.assets[0].uri, name: r.assets[0].name };
}
