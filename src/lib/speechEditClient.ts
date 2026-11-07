import { decodeToMono16k } from '@/lib/audioDecode';
import { canSegment, isLongSource, LongSource } from '@/lib/longSource';
import { autoThresholdDb, levelsDb } from '@/lib/audioSilence';
import { alignWordsToIslands, speechIslands, type SrcWord } from '@/lib/speechEdit';
import { resampleLinear, WHISPER_SAMPLE_RATE } from '@/lib/wav';
import { transcribeWordsOnDevice } from '@/lib/whisperClient';

/**
 * 💬 A beszédvágás átirata az eszközön: a klip FORRÁS-ablakának 16 kHz-es mono hangja megy a
 * whisperbe (hosszú forrásnál a szakaszos natív dekóderrel, 20 s-onként átmintavételezve). Az
 * eredmény fájlonként tárolódik a lefedett ablakkal — amíg a kért ablak benne van, nincs új futás.
 */

const cache = new Map<string, { from: number; to: number; words: SrcWord[] }>();

/** 🧪 a füstteszt tiszta lappal indul */
export function clearSpeechWordCache(): void {
  cache.clear();
}

async function windowPcm16k(uri: string, from: number, to: number, sourceDuration?: number): Promise<Float32Array | null> {
  if (canSegment() && isLongSource(sourceDuration)) {
    const SR = 44100;
    const src = new LongSource(uri);
    const parts: Float32Array[] = [];
    for (let a = Math.round(from * SR); a < Math.round(to * SR); a += 20 * SR) {
      const b = Math.min(Math.round(to * SR), a + 20 * SR);
      await src.ensure(a, b);
      const ch = src.read(a, b);
      if (!ch) return null;
      const mono = new Float32Array(b - a);
      for (const c of ch) for (let i = 0; i < mono.length; i++) mono[i] += c[i] / ch.length;
      parts.push(resampleLinear(mono, SR, WHISPER_SAMPLE_RATE));
    }
    const out = new Float32Array(parts.reduce((s, p) => s + p.length, 0));
    let at = 0;
    for (const p of parts) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  }
  const pcm = await decodeToMono16k(uri);
  return pcm ? pcm.subarray(Math.round(from * WHISPER_SAMPLE_RATE), Math.round(to * WHISPER_SAMPLE_RATE)) : null;
}

/**
 * A fájl szavai legalább a `[from, to)` forrás-ablakon. `null`: nincs használható modell, vagy
 * a hang nem olvasható / a futás elbukott.
 */
export async function speechWordsFor(uri: string, from: number, to: number, sourceDuration?: number, language?: string): Promise<SrcWord[] | null> {
  const hit = cache.get(uri);
  if (hit && hit.from <= from + 1e-6 && hit.to >= to - 1e-6) return hit.words;
  const pcm = await windowPcm16k(uri, from, to, sourceDuration);
  if (!pcm || pcm.length === 0) return null;
  const r = await transcribeWordsOnDevice(pcm, from, { language });
  if (!r) return null;
  // 🎯 a whisper token-idői pontatlanok: a szavak a hang valódi beszéd-szigeteihez igazodnak
  const levels = levelsDb(pcm, WHISPER_SAMPLE_RATE);
  const words = alignWordsToIslands(r.words, speechIslands(levels, from, autoThresholdDb(levels) - 5), { data: levels, from, win: 0.01 });
  cache.set(uri, { from, to, words });
  return words;
}
