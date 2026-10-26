import AsyncStorage from '@react-native-async-storage/async-storage';

import { catalogAvailability, catalogEntry } from '@/lib/modelCatalog';
import { catalogRuntime, downloadModel } from '@/lib/modelRegistryClient';
import { whisperEngineAvailable } from '@/lib/nativeEngines';
import { runWhisperSmokeTest } from '@/lib/whisperClient';

/**
 * 🧩 Helyi AI alapból a telefonon: első induláskor a Whisper (felirat/átirat)
 * modell egyszeri, egykoppintásos jóváhagyással letöltődik, ellenőrződik
 * (sha256) és bepróbálódik — utána minden helyi AI-funkció offline megy. A
 * nyelvi „ReMix Lokál" magok eleve beépítettek (nincs letöltés). Elutasítás után
 * nem kérdez újra (a Profil → Gyári AI-modellekből kézzel letölthető).
 */

export const BOOTSTRAP_MODEL_ID = 'whisper-tiny-q8';
const DECLINED_KEY = 'remix.localAi.bootstrapDeclined.v1';

export type BootstrapAction = 'none' | 'smoke' | 'ask';

/** Tiszta döntés: mit kell tenni a jelenlegi állapotban. */
export function bootstrapDecision(state: {
  engine: boolean;
  /** van-e már HASZNÁLHATÓ (próbázott) whisper-modell */
  usable: boolean;
  /** le van-e töltve a bootstrap-modell, de még nincs bepróbálva */
  downloadedUntested: boolean;
  declined: boolean;
}): BootstrapAction {
  if (!state.engine || state.usable) {
    return 'none';
  }
  if (state.downloadedUntested) {
    return 'smoke'; // letöltve, csak a próba maradt el (pl. megszakadt indítás)
  }
  return state.declined ? 'none' : 'ask';
}

export type BootstrapResult = 'ready' | 'installed' | 'declined' | 'unavailable' | 'failed';

/**
 * A helyi AI előkészítése. Az `ask` a felhasználói jóváhagyás (az UI adja —
 * pl. Alert); `false` → nem kérdez újra. Sosem dob.
 */
export async function ensureLocalAiReady(
  ask: (sizeMb: number) => Promise<boolean>,
): Promise<BootstrapResult> {
  try {
    const entry = catalogEntry(BOOTSTRAP_MODEL_ID);
    if (!entry?.manifest) {
      return 'unavailable';
    }
    const rt = catalogRuntime();
    const availability = catalogAvailability(entry, rt);
    const usableAny = ['whisper-tiny-q8', 'whisper-base-q5'].some((id) => {
      const e = catalogEntry(id);
      return e != null && catalogAvailability(e, rt) === 'validated';
    });
    const declined = (await AsyncStorage.getItem(DECLINED_KEY)) === '1';
    const action = bootstrapDecision({
      engine: whisperEngineAvailable(),
      usable: usableAny,
      downloadedUntested: availability === 'downloaded',
      declined,
    });
    if (action === 'none') {
      return usableAny ? 'ready' : whisperEngineAvailable() ? 'declined' : 'unavailable';
    }
    if (action === 'ask') {
      const ok = await ask(Math.round(entry.manifest.sizeBytes / 1024 / 1024));
      if (!ok) {
        await AsyncStorage.setItem(DECLINED_KEY, '1');
        return 'declined';
      }
      const res = await downloadModel(entry.manifest);
      if (!res.ok) {
        return 'failed';
      }
    }
    return (await runWhisperSmokeTest(BOOTSTRAP_MODEL_ID)) ? 'installed' : 'failed';
  } catch {
    return 'failed';
  }
}
