import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { File, Paths } from 'expo-file-system';
import { requireOptionalNativeModule } from 'expo-modules-core';

import { to44k } from '@/lib/longSource';
import { logCaught } from '@/lib/logCaught';
import { probeAudioDuration } from '@/lib/media';
import { pcm16, wavHeader16 } from '@/lib/offlineMix';
import { projectMediaDir } from '@/lib/projectFolderClient';

/**
 * 🎬→🎵 Hang videóból a Hang Stúdióban: a Fotókból vagy a Fájlokból választott videó hangsávja
 * külön hangfájlként a projekt-mappába — a videó maga nem kerül a projektbe.
 *
 * 2026-11-14 (tulajdonosi döntés): WAV, mintára pontosan. Az AAC-sáv átmásolása (M4A) megtartotta a kódoló
 * előtöltését (iPhone, iPad és Android: 1303 minta ≈ 30 ms késés a videóhoz képest). A natív ablakos
 * dekóder (`decodeWindow`: iOS AVAssetReader, Android MediaCodec + encoderDelay) az előtöltést levágja,
 * 44,1 kHz-re alakít; 20 s-os szakaszokban (0,1 s ráhagyással a széleken), 16 bites WAV-ba, ditherrel.
 * Régi buildben (nincs `decodeWindow`) a régi M4A-út marad.
 */

interface ExtractModule {
  extractAudio(uri: string, outputPath: string): Promise<{ duration: number; passthrough: boolean }>;
  decodeWindow?(uri: string, start: number, duration: number, outputPath: string): Promise<{ frames: number; channels: number; sampleRate?: number }>;
  supportsDecodeWindow?: boolean;
}
const Native = requireOptionalNativeModule<ExtractModule>('RemixRender');

export function canExtractAudio(): boolean {
  return typeof Native?.extractAudio === 'function' || Native?.supportsDecodeWindow === true;
}

export type VideoAudioResult = { ok: true; uri: string; name: string; duration: number } | { ok: false; reason: 'noAudio' | 'failed'; message?: string };

const SR = 44100;
const SEG_SEC = 20;
const PAD_SEC = 0.1;
/** biztonsági plafon: a telefonos export határa (3 óra) */
const MAX_SEC = 3 * 3600;

const isNoAudio = (msg: string) => /sávot: audio|no audio|nincs hangsáv|noTracks/i.test(msg);

/** a videó hangja WAV-ként (mintára pontosan) a projekt-mappába */
async function extractToWav(videoUri: string, out: File): Promise<number> {
  const decode = Native!.decodeWindow!;
  // a hangsáv hossza: az Android dekóder a fájl végén túl a kért hosszt csenddel tölti ki (iOS-en rövidebb az
  // utolsó ablak) — a kinyerés a valódi hosszig tart (mérve: hossz nélkül a ciklus nem állt meg)
  const probed = await probeAudioDuration(videoUri);
  const total = Math.round(Math.min(MAX_SEC, probed > 0 ? probed : MAX_SEC) * SR);
  out.create();
  const handle = out.open();
  let frames = 0;
  let channels = 0;
  try {
    handle.writeBytes(new Uint8Array(44)); // a fejléc helye (a végén írjuk, a hosszal)
    for (let k = 0; ; k++) {
      const start = k * SEG_SEC;
      const pad = k > 0 ? PAD_SEC : 0;
      const tmp = new File(Paths.cache, `vaw_${k}_${Date.now()}.f32`);
      try {
        const info = await decode(videoUri, start - pad, SEG_SEC + pad + PAD_SEC, tmp.uri.replace('file://', ''));
        const h = tmp.open();
        let bytes: Uint8Array;
        try {
          bytes = h.readBytes(h.size ?? 0);
        } finally {
          h.close();
        }
        const ch = Math.max(1, Math.min(2, info.channels));
        const all = await to44k(new Float32Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 4)), ch, info.sampleRate);
        if (k === 0) channels = ch;
        const skip = Math.round(pad * SR);
        const got = Math.max(0, Math.min(SEG_SEC * SR, Math.floor(all.length / ch) - skip));
        const n = Math.min(got, total - frames);
        if (n > 0) {
          const chans = Array.from({ length: channels }, (_, c) => {
            const x = new Float32Array(n);
            const src = Math.min(c, ch - 1);
            for (let i = 0; i < n; i++) x[i] = all[(i + skip) * ch + src];
            return x;
          });
          handle.writeBytes(pcm16(chans));
          frames += n;
        }
        if (got < SEG_SEC * SR || frames >= total) break; // a forrás vége
      } finally {
        if (tmp.exists) tmp.delete();
      }
      await new Promise((resolve) => setTimeout(resolve, 0)); // a felület ne akadjon
    }
    if (frames === 0) throw new Error('no audio');
    handle.offset = 0;
    handle.writeBytes(wavHeader16(frames, channels, SR));
  } finally {
    handle.close();
  }
  return frames / SR;
}

/** a videó hangja a projekt-mappába (WAV; régi buildben M4A) */
export async function extractVideoAudio(videoUri: string, name: string): Promise<VideoAudioResult> {
  if (!Native) return { ok: false, reason: 'failed', message: 'native' };
  const base = name.replace(/\.[^.]+$/, '').replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 40) || 'video';
  const dir = projectMediaDir();
  if (!dir.exists) dir.create();
  const wav = Native.supportsDecodeWindow === true && typeof Native.decodeWindow === 'function';
  const out = new File(dir, `${Date.now().toString(36)}_${base}_hang.${wav ? 'wav' : 'm4a'}`);
  try {
    if (wav) {
      const duration = await extractToWav(videoUri, out);
      return { ok: true, uri: out.uri, name: base, duration };
    }
    // a `file://` uri százalékkódolt (ékezetes név) — a natív oldal valódi útvonalat vár
    const r = await Native.extractAudio(videoUri, decodeURIComponent(out.uri.replace('file://', '')));
    return { ok: true, uri: out.uri, name: base, duration: r.duration };
  } catch (caught) {
    const msg = caught instanceof Error ? caught.message : String(caught);
    if (out.exists) out.delete();
    if (isNoAudio(msg)) return { ok: false, reason: 'noAudio' };
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
