// 🎵 Bemeneti hang-robusztusság (AUDIO-STUDIO-PROD §5) — pure, expo-mentes → tesztelhető.
//
// A prod-userek tetszőleges hangot dobnak be (letöltött zene, hangjegyzet, videóból
// leválasztott sáv): változó formátum/konténer, néha néma vagy korrupt, néha ismeretlen
// hosszal (a DocumentPicker nem ad hosszt). A bevételi ponton (`media.pickAudio`) EGYSZER
// osztályozzuk a bemenetet, hogy a UI BARÁTSÁGOS hibát/figyelmeztetést adhasson a néma
// „nem történik semmi" helyett. A tényleges dekódolás a natív player / worker ffmpeg dolga;
// itt csak a DÖNTÉS/üzenet él, hogy a mag önmagában tesztelhető maradjon (vö. `imageIntake`).

/** a lejátszó/worker által megbízhatóan dekódolható hang-kiterjesztések (konténer is) */
const SUPPORTED_EXT = ['mp3', 'm4a', 'aac', 'wav', 'flac', 'opus', 'ogg', 'oga', 'aiff', 'aif', 'caf'];

/**
 * Beszédes felső hossz-határ: efölött a render-idő/memória már kockázatos (a §5 „beszédes
 * határ"); nem hard-blokk, csak figyelmeztetés. 3 óra = egy hosszú podcast/élő-felvétel is belefér.
 */
export const AUDIO_INTAKE_WARN_SEC = 3 * 60 * 60;

/** az uri kiterjesztése kisbetűvel, query/hash nélkül ('' = nincs) */
export function audioExtOf(uri: string): string {
  const m = /\.([a-z0-9]+)(?:\?|#|$)/i.exec(uri || '');
  return m ? m[1].toLowerCase() : '';
}

/** támogatott hang-kiterjesztés? ('' / ismeretlen protokoll — pl. content:// — → true, a natív réteg dönt) */
export function isSupportedAudio(uri: string): boolean {
  const ext = audioExtOf(uri);
  return ext === '' || SUPPORTED_EXT.includes(ext);
}

export type AudioIntakeReason = 'unsupported' | 'unknownDuration' | 'tooLong';

export interface AudioIntakeResult {
  /** behozható-e (true akkor is, ha csak figyelmeztetés van) */
  ok: boolean;
  /** hard-stop ok (ok=false), vagy a figyelmeztetés oka (ok=true) */
  reason?: AudioIntakeReason;
  /** a felhasználónak szánt barátságos (magyar) üzenet */
  message?: string;
  /** csak figyelmeztetés (behozható, de szólunk) — ok marad true */
  warning: boolean;
}

export interface AudioIntakeInput {
  uri: string;
  name?: string;
  /** a kiolvasott valós hossz mp-ben (0 = nem sikerült kiolvasni) */
  durationSec?: number;
}

/**
 * A bevitt hang osztályozása BARÁTSÁGOS üzenettel. Hard-stop (ok=false) csak a
 * nem támogatott formátumra; az ismeretlen hossz és a túl-hosszú fájl behozható,
 * de FIGYELMEZTETÉST kap (ok=true, warning=true), hogy a timeline-pozíció/render-idő
 * meglepetés ne legyen néma.
 */
export function classifyAudioIntake(input: AudioIntakeInput): AudioIntakeResult {
  const { uri, name, durationSec } = input;
  const label = name || audioExtOf(uri).toUpperCase() || 'fájl';
  if (!isSupportedAudio(uri)) {
    return {
      ok: false,
      warning: false,
      reason: 'unsupported',
      message: `Ezt a hangformátumot nem tudjuk beolvasni (${label}). Próbáld MP3/M4A/WAV/FLAC/OGG/Opus formátumban.`,
    };
  }
  const dur = Number(durationSec);
  if (!Number.isFinite(dur) || dur <= 0) {
    return {
      ok: true,
      warning: true,
      reason: 'unknownDuration',
      message: 'A hang hossza nem olvasható ki — a klip alap-hosszal kerül az idővonalra, és kézzel igazítható.',
    };
  }
  if (dur > AUDIO_INTAKE_WARN_SEC) {
    const hours = Math.round((dur / 3600) * 10) / 10;
    return {
      ok: true,
      warning: true,
      reason: 'tooLong',
      message: `Nagyon hosszú hang (~${hours} óra) — a feldolgozás/render lassabb és több memóriát igényel.`,
    };
  }
  return { ok: true, warning: false };
}
