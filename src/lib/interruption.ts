/**
 * 📞 Megszakítás (PRO-AUDIO 17/18): hívás, Siri, fülhallgató kihúzása vagy háttér — a rendszer
 * natívan megállítja a lejátszókat és a felvevőt (az expo-audio `pause()`/`pauseRecording()`),
 * a JS erről nem kap eseményt. Pure döntések, hogy a hang-réteg és a felvétel ezt felismerje:
 *
 * - a felvevő „szünetel, de van felvett része” → a rendszer szakította meg → a take klip lesz;
 * - a lejátszó egyszer már szólt, most áll, és az ideje sem halad → a rendszer némította el →
 *   a transzport is megáll (különben a lejátszófej néma hangra futna tovább).
 *
 * A seek utáni várakozás (`timeControlStatus = waiting`) rövid, és közben a lejátszó-idő ugrik;
 * a pufferelés külön jelzés — egyik sem számít rendszer-szünetnek.
 */

export interface RecorderStatusLike {
  canRecord: boolean;
  isRecording: boolean;
  durationMillis: number;
}

/**
 * idle = nincs take · recording = felvesz · paused = a felhasználó szüneteltette (folytatható) ·
 * interrupted = szünetel, de nem a felhasználó állította meg (a rendszer) — a take klip lesz
 */
export type RecordingPhase = 'idle' | 'recording' | 'paused' | 'interrupted';

export function recordingPhase(status: RecorderStatusLike, userPaused = false): RecordingPhase {
  if (status.isRecording) {
    return 'recording';
  }
  if (userPaused && status.durationMillis > 0) {
    return 'paused';
  }
  // a leállítás után a felvevő nullázza a hosszt; az előkészített, de el nem indított is 0
  return status.canRecord && status.durationMillis > 0 ? 'interrupted' : 'idle';
}

/** ennyi ideig álló, nem pufferelő lejátszó = a rendszer állította meg (seek-várakozás ennél jóval rövidebb) */
export const SYSTEM_PAUSE_MS = 700;

export interface StallState {
  /** a mostani indítás óta szólt-e már (betöltés közbeni állás nem szünet) */
  confirmed: boolean;
  frozenSince: number | null;
  lastTime: number;
}

export const INITIAL_STALL: StallState = { confirmed: false, frozenSince: null, lastTime: -1 };

export interface PlayerSample {
  playing: boolean;
  buffering: boolean;
  /** a lejátszó forrás-ideje (mp) */
  time: number;
  nowMs: number;
  /** a forrás vége közel — ott a magától leálló lejátszó nem szünet */
  nearEnd: boolean;
}

export function detectSystemPause(st: StallState, s: PlayerSample): { next: StallState; stopped: boolean } {
  if (s.playing) {
    return { next: { confirmed: true, frozenSince: null, lastTime: s.time }, stopped: false };
  }
  if (!st.confirmed || s.buffering || s.nearEnd || Math.abs(s.time - st.lastTime) > 0.001) {
    return { next: { ...st, frozenSince: null, lastTime: s.time }, stopped: false };
  }
  const frozenSince = st.frozenSince ?? s.nowMs;
  return { next: { ...st, frozenSince }, stopped: s.nowMs - frozenSince >= SYSTEM_PAUSE_MS };
}
