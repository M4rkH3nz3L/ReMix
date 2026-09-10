import { t as tr } from 'i18next';
import { Directory, File, Paths } from 'expo-file-system';

import { makeId } from '@/lib/id';
import { cloudBaseUrl, ensureCloud } from '@/lib/backend';

/**
 * TTS-kliens (AI-hang): a dev-worker `say`-alapú szöveg→beszéd végpontja.
 * A generált m4a az eszközre töltődik, és voiceover-klipként az idővonalra kerül.
 */

export interface TtsVoice {
  name: string;
  locale: string;
}

// preferált nyelvek — nyelvenként egy hang, hogy a választó rövid maradjon
const PREFERRED = ['hu_HU', 'en_US', 'en_GB', 'de_DE', 'fr_FR', 'es_ES', 'it_IT'];

function curate(voices: TtsVoice[]): TtsVoice[] {
  const out: TtsVoice[] = [];
  for (const loc of PREFERRED) {
    const v = voices.find((x) => x.locale === loc);
    if (v) {
      out.push(v);
    }
  }
  return out.length ? out : voices.slice(0, 6);
}

export async function fetchTtsVoices(): Promise<{ available: boolean; voices: TtsVoice[] }> {
  try {
    const res = await fetch(`${cloudBaseUrl()}/tts/voices`);
    if (!res.ok) {
      return { available: false, voices: [] };
    }
    const body = await res.json();
    return { available: Boolean(body.available), voices: curate(body.voices ?? []) };
  } catch {
    return { available: false, voices: [] };
  }
}

/** Szöveg → m4a a workeren, letöltve az eszközre. { uri, duration }. */
export async function generateTts(
  text: string,
  voice?: string
): Promise<{ uri: string; duration: number }> {
  const base = ensureCloud('tts');
  const res = await fetch(`${base}/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voice }),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.error ?? tr('lib.tts.generateFailed'));
  }
  const dir = new Directory(Paths.document, 'media');
  try {
    dir.create();
  } catch {
    /* már létezik */
  }
  const target = new File(dir, `tts_${makeId('v')}.m4a`);
  await File.downloadFileAsync(`${base}/tts/${body.id}/${body.name}`, target);
  return { uri: target.uri, duration: body.duration ?? 0 };
}
