import { File } from 'expo-file-system';

import { StreamingDenoiser } from '@/lib/aiDenoise';
import { audioNative, ensureAudioModel } from '@/lib/audioModels';
import { logCaught } from '@/lib/logCaught';
import { LongSource } from '@/lib/longSource';
import { probeAudioDuration } from '@/lib/media';
import { makeResampler } from '@/lib/nativeResampler';
import { OFFLINE_SAMPLE_RATE, pcm16, wavHeader16 } from '@/lib/offlineMix';
import { projectMediaDir } from '@/lib/projectFolderClient';

/**
 * 🔇 V8: AI-zajszűrés a telefonon — a forrás darabonként (`LongSource`), a modell (RNNoise, C) csatornánként, az
 * eredmény folyamatosan egy új WAV-ba a projekt mappájában (az eredeti megmarad). Órás felvétel is mehet: a
 * memória a darab méretével arányos. Ingyenes (a telefonon fut), a modell letöltése után hálózat nélkül.
 */
export const AI_DENOISE_MAX_SEC = 3 * 60 * 60;
const BLOCK = OFFLINE_SAMPLE_RATE * 4;

export interface AiDenoiseResult {
  uri: string;
  durationSec: number;
  /** átlagos beszéd-valószínűség (0–1) */
  vad: number;
  ms: number;
  /** 🧪 a lépések ideje (ms) */
  timings: Record<string, number>;
}

export async function aiDenoiseFile(sourceUri: string, strength: number, onRatio?: (r: number) => void): Promise<AiDenoiseResult | null> {
  const t0 = Date.now();
  const n = audioNative;
  if (!(await ensureAudioModel('rnnoise-v02')) || !n?.rnnoiseCreate || !n.rnnoiseRun || !n.rnnoiseDestroy) return null;
  const handles: number[] = [];
  let handle: ReturnType<File['open']> | null = null;
  let out: File | null = null;
  try {
    const dur = await probeAudioDuration(sourceUri);
    if (!(dur > 0) || dur > AI_DENOISE_MAX_SEC) return null;
    const total = Math.round(dur * OFFLINE_SAMPLE_RATE);
    const long = new LongSource(sourceUri);
    await long.ensure(0, Math.min(total, BLOCK));
    const first = long.read(0, Math.min(total, BLOCK));
    if (!first) return null;
    // kétcsatornás mono (a telefonos beszéd-felvétel gyakran ilyen): egy előzetes olvasással felismerve → egyszer
    // szűrünk, és mindkét csatornára ugyanaz kerül (a modell ideje a felére)
    let dualMono = first.length === 2;
    for (let a = 0; dualMono && a < total; a += BLOCK) {
      const b = Math.min(total, a + BLOCK);
      await long.ensure(a, b);
      const blk = long.read(a, b);
      if (!blk) return null;
      const [l, r] = blk;
      for (let i = 0; i < l.length; i++) {
        if (l[i] !== r[i]) {
          dualMono = false;
          break;
        }
      }
    }
    const fileChannels = first.length;
    const channels = dualMono ? 1 : fileChannels;
    for (let c = 0; c < channels; c++) {
      const h = n.rnnoiseCreate();
      if (h < 0) return null;
      handles.push(h);
    }
    const inBuf = new Float32Array(480 * 200);
    const outBuf = new Float32Array(480 * 200);
    const den = new StreamingDenoiser(channels, strength, (c, input, output) => {
      // a natív hívás saját, újrahasznált pufferben (a JS-nézetek eltolása platformfüggő)
      let vad = 0;
      let k = 0;
      for (let at = 0; at < input.length; at += inBuf.length) {
        const m = Math.min(inBuf.length, input.length - at);
        inBuf.set(input.subarray(at, at + m));
        if (m < inBuf.length) inBuf.fill(0, m);
        vad += n.rnnoiseRun!(handles[c], inBuf.subarray(0, m), outBuf);
        output.set(outBuf.subarray(0, m), at);
        k++;
      }
      return k > 0 ? vad / k : 0;
    }, OFFLINE_SAMPLE_RATE, undefined, makeResampler);
    const dir = projectMediaDir();
    if (!dir.exists) dir.create();
    out = new File(dir, `ai_denoised_${Date.now().toString(36)}.wav`);
    out.create();
    handle = out.open();
    handle.writeBytes(wavHeader16(total, fileChannels, OFFLINE_SAMPLE_RATE));
    let written = 0;
    const timingsExtra: Record<string, number> = {};
    let readMs = 0;
    let writeMs = 0;
    const write = (chunk: Float32Array[]) => {
      const m = Math.min(chunk[0]?.length ?? 0, total - written);
      if (m <= 0) return;
      const tw = Date.now();
      const chs = chunk.map((ch) => ch.subarray(0, m));
      handle!.writeBytes(pcm16(dualMono ? [chs[0], chs[0]] : chs));
      writeMs += Date.now() - tw;
      written += m;
    };
    for (let a = 0; a < total; a += BLOCK) {
      const b = Math.min(total, a + BLOCK);
      const tr = Date.now();
      await long.ensure(a, b);
      const block = long.read(a, b);
      readMs += Date.now() - tr;
      if (!block) throw new Error('aiDenoise: a forrás egy szakasza nem olvasható');
      write(den.push(dualMono ? [block[0]] : block));
      onRatio?.(b / total);
      // a felület lélegezhet
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    write(den.finish());
    if (written < total) write(Array.from({ length: channels }, () => new Float32Array(total - written)));
    timingsExtra.dualMono = dualMono ? 1 : 0;
    handle.close();
    handle = null;
    return { uri: out.uri, durationSec: total / OFFLINE_SAMPLE_RATE, vad: den.vad, ms: Date.now() - t0, timings: { ...den.timings, read: readMs, write: writeMs, ...timingsExtra } };
  } catch (caught) {
    logCaught('lib/aiDenoiseClient.ts', caught);
    try {
      handle?.close();
      if (out?.exists) out.delete();
    } catch (cleanup) {
      logCaught('lib/aiDenoiseClient.ts:cleanup', cleanup);
    }
    return null;
  } finally {
    for (const h of handles) n.rnnoiseDestroy!(h);
  }
}
