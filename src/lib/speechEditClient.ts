import { decodeMono16kWindowed, decodeToMono16k } from '@/lib/audioDecode';
import { canSegment, isLongSource } from '@/lib/longSource';
import { autoThresholdDb, levelsDb } from '@/lib/audioSilence';
import { alignWordsToIslands, speechIslands, type SrcWord } from '@/lib/speechEdit';
import { WHISPER_SAMPLE_RATE } from '@/lib/wav';
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

export async function windowPcm16k(uri: string, from: number, to: number, sourceDuration?: number): Promise<Float32Array | null> {
  if (canSegment() && isLongSource(sourceDuration)) {
    return decodeMono16kWindowed(uri, from, to);
  }
  const pcm = await decodeToMono16k(uri, { sourceDurationSec: sourceDuration });
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
