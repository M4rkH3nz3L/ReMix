import { File } from 'expo-file-system';
import { requireOptionalNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

import { makeId } from '@/lib/id';
import { logCaught } from '@/lib/logCaught';
import { projectMediaDir } from '@/lib/projectFolderClient';

/**
 * 🗣️ AI-hang a telefonon (AP5, offline): a rendszer beszédmotorja (iOS `AVSpeechSynthesizer`, Android
 * `TextToSpeech`) a szöveget WAV-fájlba írja a projekt-mappába — net és szerver nélkül, minden szinten
 * (a telefon dolgozik). A szerveres TTS csak tartalék (web, vagy ha a telefonnak nincs hangja).
 */

export interface DeviceVoice {
  id: string;
  name: string;
  /** BCP-47 (pl. `hu-HU`) */
  language: string;
  /** iOS: 1 alap · 2 javított · 3 prémium; Android: 100–500 */
  quality: number;
}

interface SpeechNative {
  ttsVoices(): Promise<DeviceVoice[]>;
  synthesizeSpeech(text: string, voiceId: string | null, language: string | null, rate: number, outputPath: string): Promise<unknown>;
}

const Native = Platform.OS === 'web' ? null : requireOptionalNativeModule<SpeechNative>('RemixRender');

/** van-e a buildben telefonos beszéd (a régi build még nem tudja) */
export const canSpeakOnDevice = (): boolean => !!Native && typeof Native.synthesizeSpeech === 'function';

/** a szöveg leghosszabb megengedett hossza (egy klip) */
export const TTS_MAX_CHARS = 4000;

/**
 * a választható hangok: nyelvenként a legjobb minőségű, az app nyelve és a gyakori nyelvek elöl
 * (pure — tesztelhető)
 */
export function curateDeviceVoices(voices: DeviceVoice[], appLang: string): DeviceVoice[] {
  const best = new Map<string, DeviceVoice>();
  for (const v of voices) {
    const cur = best.get(v.language);
    if (!cur || v.quality > cur.quality || (v.quality === cur.quality && v.name < cur.name)) best.set(v.language, v);
  }
  const order = [appLang, 'hu', 'en', 'de', 'fr', 'es', 'it'];
  const rank = (lang: string) => {
    const i = order.findIndex((o) => lang.toLowerCase().startsWith(o.toLowerCase()));
    return i < 0 ? order.length : i;
  };
  return [...best.values()].sort((a, b) => rank(a.language) - rank(b.language) || a.language.localeCompare(b.language)).slice(0, 12);
}

export async function deviceVoices(appLang: string): Promise<DeviceVoice[]> {
  if (!canSpeakOnDevice()) return [];
  try {
    return curateDeviceVoices(await Native!.ttsVoices(), appLang);
  } catch (caught) {
    logCaught('lib/ttsOnDevice.ts:deviceVoices', caught);
    return [];
  }
}

/** szöveg → WAV a projekt-mappába; a hossz a fájlból (mp) */
export async function speakToFile(text: string, voice: DeviceVoice | null, rate = 0.5): Promise<{ uri: string; duration: number }> {
  if (!canSpeakOnDevice()) throw new Error('native');
  const value = text.trim().slice(0, TTS_MAX_CHARS);
  const dir = projectMediaDir();
  if (!dir.exists) dir.create();
  const out = new File(dir, `tts_${makeId('v')}.wav`);
  await Native!.synthesizeSpeech(value, voice?.id ?? null, voice?.language ?? null, rate, decodeURIComponent(out.uri.replace('file://', '')));
  const { probeAudioDuration } = await import('@/lib/media');
  const duration = await probeAudioDuration(out.uri);
  if (!(duration > 0)) throw new Error('empty');
  return { uri: out.uri, duration };
}
