import { setAudioModeAsync, type AudioRecorder } from 'expo-audio';
import { t as tr } from 'i18next';

import { canStartRecording, megabytes } from '@/lib/diskSpace';
import { freeDiskBytes } from '@/lib/diskSpaceClient';
import { snapToFrame } from '@/lib/frames';
import { logCaught } from '@/lib/logCaught';
import { persistToLibrary } from '@/lib/media';
import type { Asset, AudioClip } from '@/types/project';

/**
 * 🎙️ Hangfelvétel a Hang Stúdióban és a videó-szerkesztő Hang paneljén — EGY helyen, hogy a
 * két felület ugyanúgy viselkedjen (PRO-AUDIO A10, A43).
 */
export async function startVoiceRecording(recorder: AudioRecorder): Promise<void> {
  // 💾 kevés helynél el sem indul (a hívó az üzenetet mutatja)
  const free = freeDiskBytes();
  if (!canStartRecording(free)) {
    throw new Error(tr('panels.audio.noSpaceToRecord', { free: megabytes(free) }));
  }
  await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
  await recorder.prepareToRecordAsync();
  recorder.record();
}

/**
 * Leállítás: a hossz a recorder saját idejéből jön (a lekérdezett állapot fél másodpercet
 * késhet), a fájl a projekt-mappába kerül (az OS a cache-t bármikor üríti). A43: a felvételi
 * mód iOS-en a kimenetet a fülhallgató-hangszóróra viszi — utána MINDIG vissza lejátszó-módba,
 * hiba esetén is, különben a lejátszás elnémul.
 */
export async function stopVoiceRecording(recorder: AudioRecorder): Promise<{ uri: string | null; seconds: number }> {
  // minden a leállítás ELŐTT olvasódik ki: a képernyő bezárásakor a recorder a stop
  // után már felszabadulhat, a fájl viszont a helyén marad
  const seconds = Math.max(recorder.getStatus().durationMillis / 1000, 0.5);
  const sourceUri = recorder.uri;
  try {
    await recorder.stop();
  } finally {
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch((caught) => {
      logCaught('lib/voiceRecording.ts:stopVoiceRecording', caught);
    });
  }
  return { uri: sourceUri ? persistToLibrary(sourceUri) : null, seconds };
}

/** A felvételből klip + asset: a kezdet a frame-rácsra ül, a forrás teljes hossza ismert. */
export function voiceoverClip(
  uri: string,
  seconds: number,
  startSec: number,
  fps: number,
  label: string,
  makeId: (prefix: string) => string
): { clip: AudioClip; asset: Asset } {
  return {
    clip: {
      kind: 'audio',
      id: makeId('clip'),
      start: snapToFrame(startSec, fps),
      duration: seconds,
      trimIn: 0,
      sourceDuration: seconds,
      uri,
      label,
      volume: 1,
      fadeIn: 0,
      fadeOut: 0,
      source: 'voiceover',
    },
    asset: { id: makeId('ast'), kind: 'audio', uri, provider: 'local', name: label, duration: seconds },
  };
}
