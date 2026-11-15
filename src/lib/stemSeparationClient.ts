import { requireOptionalNativeModule } from 'expo-modules-core';
import { File } from 'expo-file-system';

import { ensureAudioModel } from '@/lib/audioModels';
import { Platform } from 'react-native';

import { decodeSample } from '@/lib/instrumentClient';
import { logCaught } from '@/lib/logCaught';
import { encodeWav16, OFFLINE_SAMPLE_RATE } from '@/lib/offlineMix';
import { projectMediaDir } from '@/lib/projectFolderClient';
import { jsStemKernels, separateTwoStems, STEM_F, STEM_T, type StemKernels } from '@/lib/stemSeparation';

/**
 * 🎚️ V5 (prototípus): a stem-szétválasztás a telefonon — a Core ML modell (Spleeter 2stems) letöltve a
 * dokumentumok közé, a natív modul fordítja és futtatja (Neural Engine is), a jelút JS (`stemSeparation`).
 * Csak iOS (a natív rész); a funkció rejtve, amíg a modell-licenc jogi megerősítése és a mérés nincs kész.
 */
type StemNative = {
  stemLoad?: (path: string) => Promise<boolean>;
  stemSetInput?: (mag: Float32Array) => boolean;
  stemRun?: () => Promise<number>;
  stemGetOutput?: (v: Float32Array, a: Float32Array) => boolean;
  stemUnload?: () => boolean;
  stemForward?: StemKernels['forward'];
  stemInverse?: StemKernels['inverse'];
};
const mod = Platform.OS === 'ios' ? requireOptionalNativeModule<StemNative>('RemixRender') : null;

/**
 * ✅ kiadásban is bekapcsolva — a modell-licenc megerősítve (tulajdonosi jóváhagyás 2026-11-15): a Spleeter kódja és
 * a vele kiadott modellek MIT alatt (a Deezer felsorolja a modelleket használó kereskedelmi szoftvereket); a
 * közlemény az appban (`legal?doc=licenses`)
 */
export const STEM_ON_DEVICE_ENABLED = true;
export const STEM_MAX_SEC = 15 * 60;

export function stemOnDeviceSupported(): boolean {
  return !!mod && typeof mod.stemLoad === 'function' && typeof mod.stemRun === 'function';
}

/** látszik-e a gomb: a build tudja, és (kiadásban) a kapcsoló be van kapcsolva */
export function stemOnDeviceVisible(): boolean {
  return stemOnDeviceSupported() && (STEM_ON_DEVICE_ENABLED || __DEV__);
}

let loaded = false;

/** ⚡ a jelút natívan (vDSP), ha a build tudja; különben a JS (lassú: ~1,2× valós idő iPaden) */
export function stemKernels(): StemKernels {
  if (mod && typeof mod.stemForward === 'function' && typeof mod.stemInverse === 'function') {
    const f = mod.stemForward.bind(mod);
    const i = mod.stemInverse.bind(mod);
    return { forward: (...a) => f(...a), inverse: (...a) => i(...a) };
  }
  return jsStemKernels;
}

/** a modell a telefonon a gyári katalógusból (`spleeter-2stems`: letöltés sha256-tal + önellenőrzés), betöltve */
export async function ensureStemModel(): Promise<boolean> {
  if (!stemOnDeviceSupported()) return false;
  loaded = await ensureAudioModel('spleeter-2stems');
  return loaded;
}

export interface StemResult {
  vocalsUri: string;
  accompanimentUri: string;
  durationSec: number;
  timings: { decodeMs: number; modelMs: number; totalMs: number; blocks: number };
}

function writeWav(stereo: Float32Array[], prefix: string): string {
  const dir = projectMediaDir();
  if (!dir.exists) dir.create();
  const f = new File(dir, `${prefix}_${Date.now().toString(36)}.wav`);
  f.create();
  f.write(encodeWav16(stereo, OFFLINE_SAMPLE_RATE));
  return f.uri;
}

/** ének + kíséret a telefonon; a két stem új WAV a projekt mappájában (az eredeti marad) */
export async function separateOnDevice(sourceUri: string, onRatio?: (r: number) => void): Promise<StemResult | null> {
  if (!loaded || !mod) return null;
  const t0 = Date.now();
  try {
    const src = await decodeSample(sourceUri);
    if (!src || src[0].length === 0) return null;
    const sr = OFFLINE_SAMPLE_RATE;
    const l = src[0];
    const r = src[1] ?? src[0];
    if (l.length > STEM_MAX_SEC * sr) return null;
    const decodeMs = Date.now() - t0;
    const v = new Float32Array(2 * STEM_T * STEM_F);
    const a = new Float32Array(2 * STEM_T * STEM_F);
    let modelMs = 0;
    let blocks = 0;
    const res = await separateTwoStems(
      l,
      r,
      async (mag) => {
        mod.stemSetInput!(mag);
        modelMs += await mod.stemRun!();
        mod.stemGetOutput!(v, a);
        blocks++;
        return [v, a];
      },
      onRatio,
      stemKernels()
    );
    const vocalsUri = writeWav(res.vocals, 'stem_vocals');
    const accompanimentUri = writeWav(res.accompaniment, 'stem_accomp');
    return { vocalsUri, accompanimentUri, durationSec: l.length / sr, timings: { decodeMs, modelMs: Math.round(modelMs), totalMs: Date.now() - t0, blocks } };
  } catch (caught) {
    logCaught('lib/stemSeparationClient.ts:separateOnDevice', caught);
    return null;
  }
}
