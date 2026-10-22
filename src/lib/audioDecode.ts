import { Platform } from 'react-native';

import { downmixToMono, resampleLinear, WHISPER_SAMPLE_RATE } from '@/lib/wav';

/**
 * 🎚️ Eszközön történő audio-dekódolás (local-ai Fázis A): média-fájl (mp4/m4a/
 * mp3/wav) → 16 kHz mono Float32 PCM a whisper.rn bemenetéhez — a
 * react-native-audio-api natív dekódereivel, hálózat/worker nélkül. `null`, ha
 * a formátum nem dekódolható / weben fut — a hívó a worker-útra esik vissza.
 */
export async function decodeToMono16k(uri: string): Promise<Float32Array | null> {
  if (Platform.OS === 'web') {
    return null;
  }
  try {
    // dinamikus import: jest alatt nem tölt natív modult
    const { AudioContext } = await import('react-native-audio-api');
    const ctx = new AudioContext({ sampleRate: WHISPER_SAMPLE_RATE });
    try {
      const buffer = await ctx.decodeAudioData(uri.replace(/^file:\/\//, ''));
      const channels: Float32Array[] = [];
      for (let c = 0; c < buffer.numberOfChannels; c += 1) {
        channels.push(buffer.getChannelData(c) as Float32Array);
      }
      const mono = downmixToMono(channels);
      // a dekóder elvben a kontextus rátájára hoz — ha mégsem, itt igazítjuk
      return resampleLinear(mono, buffer.sampleRate, WHISPER_SAMPLE_RATE);
    } finally {
      await ctx.close().catch(() => undefined);
    }
  } catch {
    return null;
  }
}
