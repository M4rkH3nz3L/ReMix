import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';

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

const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

export function audioApiState(): State {
  return state;
}

/**
 * Szabad-e most a natív dekódert hívni. `background`: nem user-indította (pl. waveform
 * a megnyitáskor) — iOS-en ilyenkor csak bizonyított (ok) állapotban.
 */
export function canUseAudioApi(opts: { background?: boolean } = {}): boolean {
  if (Platform.OS === 'web' || isExpoGo || state === 'missing') return false;
  if (opts.background && Platform.OS === 'ios') return state === 'ok';
  return true;
}

export function markAudioApi(ok: boolean): void {
  // a bizonyított működés nem vész el egy formátum-hiba miatt (az csak az adott fájl)
  if (ok) state = 'ok';
  else if (state !== 'ok') state = 'missing';
}

/** a lusta import EGY helyen (a natív modul import-kori install-ja itt fut le) */
export async function loadAudioApi(opts: { background?: boolean } = {}): Promise<typeof import('react-native-audio-api') | null> {
  if (!canUseAudioApi(opts)) return null;
  try {
    return await import('react-native-audio-api');
  } catch {
    markAudioApi(false);
    return null;
  }
}

/** csak teszthez: az állapot visszaállítása (a modul-szintű állapot jest-ben megmarad) */
export function resetAudioApiStateForTests(): void {
  state = 'unknown';
}
