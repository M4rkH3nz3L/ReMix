import { loadAudioApi, markAudioApi } from '@/lib/audioApiGuard';
import { detectSilenceRanges } from '@/lib/silenceDetect';
import type { SilenceRange } from '@/lib/cutplan';
import { downmixToMono, resampleLinear, WHISPER_SAMPLE_RATE } from '@/lib/wav';
import { logCaught } from '@/lib/logCaught';
import { canSegment, isLongSource, LongSource } from '@/lib/longSource';

/**
 * 🧠 AUDIO-PROD S17: a forrás `[from, to)` ablaka 16 kHz monóban a SZAKASZOS natív dekóderrel (20 s-onként,
 * 44,1 kHz → mono → 16 kHz). A memóriában sosem a teljes sztereó fájl: egy 60 perces forrásnál a teljes
 * dekódolás ~1,3 GB volna, így csak a 16 kHz-es kimenet (~230 MB) és egy-két szakasz. `null`: egy szakasz hiányzik.
 */
export async function decodeMono16kWindowed(uri: string, from: number, to: number): Promise<Float32Array | null> {
  const SR = 44100;
  const src = new LongSource(uri);
  const total = Math.max(0, Math.round((to - from) * WHISPER_SAMPLE_RATE));
  const out = new Float32Array(total);
  let at = 0;
  for (let a = Math.round(from * SR); a < Math.round(to * SR) && at < total; a += 20 * SR) {
    const b = Math.min(Math.round(to * SR), a + 20 * SR);
    await src.ensure(a, b);
    const ch = src.read(a, b);
    if (!ch) return null;
    const mono = new Float32Array(b - a);
    for (const c of ch) for (let i = 0; i < mono.length; i++) mono[i] += c[i] / ch.length;
    const part = resampleLinear(mono, SR, WHISPER_SAMPLE_RATE);
    const n = Math.min(part.length, total - at);
    out.set(part.subarray(0, n), at);
    at += n;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return at < total ? out.subarray(0, at) : out;
}

/**
 * 🎚️ Eszközön történő audio-dekódolás (local-ai Fázis A): média-fájl (mp4/m4a/
 * mp3/wav) → 16 kHz mono Float32 PCM a whisper.rn bemenetéhez — a
 * react-native-audio-api natív dekódereivel, hálózat/worker nélkül. `null`, ha
 * a formátum nem dekódolható / weben fut — a hívó a worker-útra esik vissza.
 */
export async function decodeToMono16k(uri: string, opts: { sourceDurationSec?: number } = {}): Promise<Float32Array | null> {
  // 🧠 S17: hosszú (10 percnél hosszabb) forrásnál szakaszosan — a hívó hossz nélkül is (a hossz mérve)
  if (canSegment()) {
    let dur = opts.sourceDurationSec;
    if (dur === undefined) {
      const { probeAudioDuration } = await import('@/lib/media');
      dur = await probeAudioDuration(uri).catch((caught) => {
        logCaught('lib/audioDecode.ts:probe', caught);
        return 0;
      });
    }
    if (isLongSource(dur)) {
      const windowed = await decodeMono16kWindowed(uri, 0, dur!);
      if (windowed) return windowed;
    }
  }
  // a közös guard (B24): ugyanaz az állapot, mint a waveform-é — a user-indította hívás
  // (átirat / csend-keresés) iOS-en is próbálkozhat, a sikere „bizonyítja" a modult
  const api = await loadAudioApi();
  if (!api) {
    return null;
  }
  try {
    const ctx = new api.AudioContext({ sampleRate: WHISPER_SAMPLE_RATE });
    try {
      const buffer = await ctx.decodeAudioData(uri.replace(/^file:\/\//, ''));
      const channels: Float32Array[] = [];
      for (let c = 0; c < buffer.numberOfChannels; c += 1) {
        channels.push(buffer.getChannelData(c) as Float32Array);
      }
      markAudioApi(true);
      const mono = downmixToMono(channels);
      // a dekóder elvben a kontextus rátájára hoz — ha mégsem, itt igazítjuk
      return resampleLinear(mono, buffer.sampleRate, WHISPER_SAMPLE_RATE);
    } finally {
      await ctx.close().catch((caught) => { logCaught('lib/audioDecode.ts:decodeToMono16k', caught); });
    }
  } catch (caught) {
    logCaught('lib/audioDecode.ts:decodeToMono16k', caught);
    return null;
  }
}

/**
 * 🔇 Csend-felismerés az ESZKÖZÖN (a worker FFmpeg silencedetect megfelelője):
 * natív dekódolás → hangenergia-alapú csend-tartományok, forrás-időben. `null`,
 * ha a fájl nem dekódolható / weben — a hívó a workerre esik vissza.
 */
export async function detectSilenceOnDevice(uri: string): Promise<SilenceRange[] | null> {
  const pcm = await decodeToMono16k(uri);
  if (!pcm || pcm.length === 0) {
    return null;
  }
  return detectSilenceRanges(pcm, WHISPER_SAMPLE_RATE);
}
