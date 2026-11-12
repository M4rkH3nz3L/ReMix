/**
 * 🔊 Klip-erősítés dB-ben — tiszta mag. A klip `volume` lineáris szorzó (0 = néma, 1 = 0 dB); a
 * csúszka −60 … +12 dB-t mutat (+12 dB ≈ ×3,98). A keverő (előnézet-motor, telefonos és szerveres
 * export) a szorzót korlát nélkül alkalmazza, így a 0 dB fölötti erősítés hallható és exportálható.
 */
export const CLIP_DB_MIN = -60;
export const CLIP_DB_MAX = 12;
/** a 0 dB „mágnes” (a csúszka itt megáll) */
const SNAP_DB = 0.3;

export function volumeToDb(volume: number): number {
  if (!(volume > 0)) return CLIP_DB_MIN;
  return Math.max(CLIP_DB_MIN, Math.min(CLIP_DB_MAX, 20 * Math.log10(volume)));
}

export function dbToVolume(db: number): number {
  if (db <= CLIP_DB_MIN + 1e-9) return 0;
  const d = Math.abs(db) < SNAP_DB ? 0 : Math.min(CLIP_DB_MAX, db);
  return Math.pow(10, d / 20);
}

/** a felirat: „−∞”, „0,0 dB”, „+6,0 dB” */
export function formatDb(volume: number): string {
  if (!(volume > 0)) return '−∞ dB';
  const db = 20 * Math.log10(volume);
  const r = Math.round(db * 10) / 10;
  return `${r > 0 ? '+' : r < 0 ? '−' : ''}${Math.abs(r).toFixed(1)} dB`;
}

/** a legnagyobb lineáris szorzó (+12 dB) */
export const CLIP_VOLUME_MAX = Math.pow(10, CLIP_DB_MAX / 20);

/**
 * a gyors (léptető) hangerő-vezérlő egy lépése dB-ben: a jelenlegi szintről `deltaDb`-vel, a csúszka
 * tartományában (−60 … +12 dB); a −60 alatti a néma (0). Így a 0 dB fölötti klip sem esik vissza 0 dB-re.
 */
export function stepClipVolume(volume: number, deltaDb: number): number {
  if (!(volume > 0)) return deltaDb > 0 ? dbToVolume(CLIP_DB_MIN + deltaDb) : 0;
  const db = Math.round((20 * Math.log10(volume) + deltaDb) * 10) / 10;
  if (db <= CLIP_DB_MIN) return 0;
  return Math.pow(10, Math.min(CLIP_DB_MAX, db) / 20);
}

/** a fade felső határa a klipszerkesztővel azonos szabállyal: legfeljebb 5 s és a klip fele */
export const maxClipFade = (duration: number): number => Math.max(0, Math.min(5, duration / 2));
