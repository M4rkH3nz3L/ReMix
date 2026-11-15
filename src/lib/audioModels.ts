import { requireOptionalNativeModule } from 'expo-modules-core';
import { File } from 'expo-file-system';
import { Platform } from 'react-native';

import { DrumRnn, parseDrumRnnWeights } from '@/lib/drumRnn';
import { logCaught } from '@/lib/logCaught';
import { catalogEntry, catalogUsable } from '@/lib/modelCatalog';
import { catalogRuntime, downloadModel, markModelUsed, modelFileUri, setModelSmokeResult } from '@/lib/modelRegistryClient';

/**
 * 🤖 V8 / V5: a telefonos hang-AI modellek (a gyári katalógusból) — letöltés (sha256-tal), használat-előtti
 * önellenőrzés (local-ai 5.3: PASS-ig nem használható), egyszeri betöltés. Letöltés után minden hálózat nélkül
 * (repülő módban) fut; a `audioModelDownloads()` számláló ezt a füstteszthez méri.
 *
 * - `rnnoise-v02` — AI-zajszűrés (RNNoise v0.2, C-mag: `RemixRender.rnnoise*`, iOS + Android)
 * - `magenta-drums` — AI-dob (Magenta Drums RNN, JS: `drumRnn`)
 * - `spleeter-2stems` — ének + kíséret (Core ML: `RemixRender.stem*`, csak iOS)
 */
export type AudioModelId = 'rnnoise-v02' | 'magenta-drums' | 'spleeter-2stems';

type Native = {
  rnnoiseLoad?: (path: string) => Promise<boolean>;
  rnnoiseCreate?: () => number;
  rnnoiseRun?: (h: number, input: Float32Array, output: Float32Array) => number;
  rnnoiseDestroy?: (h: number) => void;
  stemLoad?: (path: string) => Promise<boolean>;
  stemSetInput?: (mag: Float32Array) => boolean;
  stemRun?: () => Promise<number>;
  stemGetOutput?: (v: Float32Array, a: Float32Array) => boolean;
};
export const audioNative: Native | null = Platform.OS === 'web' ? null : requireOptionalNativeModule<Native>('RemixRender');

let downloads = 0;
/** 🧪 a munkamenetben indított modell-letöltések száma (a repülő-módos mérés: használatkor 0 marad) */
export function audioModelDownloads(): number {
  return downloads;
}

const loaded = new Set<AudioModelId>();
let drum: DrumRnn | null = null;

/** a betöltött AI-dob modell (az `ensureAudioModel('magenta-drums')` után) */
export function drumModel(): DrumRnn | null {
  return drum;
}

/** a Core ML a fájl kiterjesztéséből ismeri a formátumot → a letöltött `.bin` egy `.mlmodel` másolaton át töltődik */
function mlmodelCopy(uri: string): string {
  const src = new File(uri);
  const dst = new File(uri.replace(/\.bin$/, '.mlmodel'));
  if (!dst.exists || (dst.size ?? 0) !== (src.size ?? -1)) {
    if (dst.exists) dst.delete();
    src.copy(dst);
  }
  return dst.uri;
}

async function load(id: AudioModelId, uri: string): Promise<boolean> {
  if (id === 'magenta-drums') {
    const h = new File(uri).open();
    try {
      const bytes = h.readBytes(h.size ?? 0);
      drum = new DrumRnn(parseDrumRnnWeights(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer));
    } finally {
      h.close();
    }
    return true;
  }
  if (id === 'rnnoise-v02') return (await audioNative?.rnnoiseLoad?.(uri)) === true;
  return (await audioNative?.stemLoad?.(mlmodelCopy(uri))) === true;
}

/** a modell önellenőrzése: valódi futtatás kis bemenettel, véges kimenettel */
async function selfTest(id: AudioModelId): Promise<boolean> {
  if (id === 'magenta-drums') {
    const r = drum?.continue([1 | 4], 4);
    return !!r && r.labels.length === 4 && r.labels.every((x) => Number.isInteger(x) && x >= 0 && x < 512);
  }
  if (id === 'rnnoise-v02') {
    const n = audioNative;
    const h = n?.rnnoiseCreate?.() ?? -1;
    if (h < 0) return false;
    try {
      let seed = 1;
      const input = Float32Array.from({ length: 480 * 20 }, () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.1);
      const out = new Float32Array(input.length);
      const vad = n!.rnnoiseRun!(h, input, out);
      return vad >= 0 && vad <= 1 && out.every((x) => Number.isFinite(x));
    } finally {
      n!.rnnoiseDestroy!(h);
    }
  }
  const n = audioNative;
  const mag = new Float32Array(2 * 512 * 1024);
  n?.stemSetInput?.(mag);
  const ms = (await n?.stemRun?.()) ?? -1;
  const v = new Float32Array(mag.length);
  const a = new Float32Array(mag.length);
  return ms >= 0 && n!.stemGetOutput!(v, a) && v.every((x) => Number.isFinite(x));
}

/** smoke-test (a Profil-kártya is ezt hívja): betöltés + önellenőrzés → PASS / FAIL a nyilvántartásba */
export async function runAudioModelSmoke(id: AudioModelId): Promise<boolean> {
  const uri = modelFileUri(id);
  let ok = false;
  try {
    ok = !!uri && (loaded.has(id) || (await load(id, uri))) && (await selfTest(id));
  } catch (caught) {
    logCaught('lib/audioModels.ts:smoke', caught);
    ok = false;
  }
  if (ok) loaded.add(id);
  setModelSmokeResult(id, ok ? 'pass' : 'fail');
  return ok;
}

/**
 * A modell használatra kész (ha kell: letöltés + smoke; ha már PASS: csak betöltés, hálózat nélkül).
 * `false`, ha a motor hiányzik a buildből, a letöltés vagy az önellenőrzés nem sikerült.
 */
export async function ensureAudioModel(id: AudioModelId): Promise<boolean> {
  const entry = catalogEntry(id);
  if (!entry?.manifest) return false;
  try {
    let rt = catalogRuntime();
    if (!rt.engines?.[entry.engine]) return false;
    if (!rt.downloaded?.includes(id)) {
      downloads++;
      const res = await downloadModel(entry.manifest);
      if (!res.ok) return false;
      rt = catalogRuntime();
    }
    if (!catalogUsable(entry, rt) || !loaded.has(id)) {
      if (rt.smoke?.[id] === 'pass' && !loaded.has(id)) {
        const uri = modelFileUri(id);
        if (!uri || !(await load(id, uri))) return false;
        loaded.add(id);
      } else if (!(await runAudioModelSmoke(id))) {
        return false;
      }
    }
    markModelUsed(id);
    return true;
  } catch (caught) {
    logCaught('lib/audioModels.ts:ensure', caught);
    return false;
  }
}
