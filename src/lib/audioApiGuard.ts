import Constants, { ExecutionEnvironment } from 'expo-constants';
import { File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import { logCaught } from '@/lib/logCaught';

/**
 * 🎚️ A `react-native-audio-api` natív dekóder KÖZÖS állapota (PRO-VIDEO B24).
 *
 * Eddig a waveform iOS-en kihagyta a modult (egy régi worklets-ABI szegfault miatt), a
 * transzkript/csend-dekódolás viszont iOS-en is használta — két ellentmondó szabály.
 * Most EGY állapot dönt mindkettőről:
 *  • Expo Go / web: nincs natív modul → sosem próbáljuk;
 *  • az első sikertelen import után végleg lemondunk róla (nincs hibaspam);
 *  • iOS-en a HÁTTÉRBEN induló hívó (waveform a projekt megnyitásakor) csak akkor
 *    használja, ha a modul ebben a munkamenetben MÁR bizonyítottan működött (egy
 *    user-indította dekódolás után) — így a projekt-megnyitás sosem lehet az első,
 *    natívan összeomló install (a 0.13.6 + worklets 0.10.1 build ezt elvben már nem teszi).
 */
type State = 'unknown' | 'ok' | 'missing';
let state: State = 'unknown';

/**
 * A bizonyított működés ugyanazon a buildön megmarad (PRO-AUDIO A20): enélkül iOS-en minden
 * új munkamenet hullámforma nélkül indul. A kulcs a build és a natív modul verziója — egy új
 * natív build újra bizonyítani kénytelen.
 */
export interface AudioApiProofStore {
  has(): boolean;
  save(): void;
}

function fileProofStore(): AudioApiProofStore {
  const name = () => {
    let lib = '?';
    try {
      lib = (require('react-native-audio-api/package.json') as { version: string }).version;
    } catch (caught) {
      logCaught('lib/audioApiGuard.ts:proofName', caught);
    }
    return `.audioapi-ok-${Constants.nativeBuildVersion ?? 'dev'}-${Constants.nativeAppVersion ?? '0'}-${lib}`;
  };
  return {
    has: () => new File(Paths.document, name()).exists,
    save: () => {
      const file = new File(Paths.document, name());
      if (!file.exists) {
        file.create();
      }
    },
  };
}

let proofStore: AudioApiProofStore | null = null;
let proofChecked = false;

function restoreProof(): void {
  if (proofChecked || Platform.OS === 'web' || isExpoGo) {
    return;
  }
  proofChecked = true;
  try {
    proofStore = proofStore ?? fileProofStore();
    if (state === 'unknown' && proofStore.has()) {
      state = 'ok';
    }
  } catch (caught) {
    logCaught('lib/audioApiGuard.ts:restoreProof', caught);
  }
}

const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

export function audioApiState(): State {
  return state;
}

/**
 * Szabad-e most a natív dekódert hívni. `background`: nem user-indította (pl. waveform
 * a megnyitáskor) — iOS-en ilyenkor csak bizonyított (ok) állapotban.
 */
export function canUseAudioApi(opts: { background?: boolean } = {}): boolean {
  restoreProof();
  if (Platform.OS === 'web' || isExpoGo || state === 'missing') return false;
  if (opts.background && Platform.OS === 'ios') return state === 'ok';
  return true;
}

export function markAudioApi(ok: boolean): void {
  // a bizonyított működés nem vész el egy formátum-hiba miatt (az csak az adott fájl)
  if (ok) {
    if (state !== 'ok') {
      try {
        (proofStore = proofStore ?? fileProofStore()).save();
      } catch (caught) {
        logCaught('lib/audioApiGuard.ts:markAudioApi', caught);
      }
    }
    state = 'ok';
  } else if (state !== 'ok') state = 'missing';
}

/** a lusta import EGY helyen (a natív modul import-kori install-ja itt fut le) */
export async function loadAudioApi(opts: { background?: boolean } = {}): Promise<typeof import('react-native-audio-api') | null> {
  if (!canUseAudioApi(opts)) return null;
  try {
    return await import('react-native-audio-api');
  } catch (caught) {
    logCaught('lib/audioApiGuard.ts:loadAudioApi', caught);
    markAudioApi(false);
    return null;
  }
}

/** csak teszthez: az állapot visszaállítása (a modul-szintű állapot jest-ben megmarad) */
export function resetAudioApiStateForTests(store: AudioApiProofStore | null = null): void {
  state = 'unknown';
  proofStore = store;
  proofChecked = false;
}
