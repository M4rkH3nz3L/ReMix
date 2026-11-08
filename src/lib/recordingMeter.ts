/**
 * 🎙️📊 Felvételi szintmérő — tiszta mag (expo-mentes). A felvevő `metering` értéke dBFS-ben
 * jön: iOS-en az átlagteljesítmény (`averagePower`), Androidon a csúcs (`getMaxAmplitude`); csend
 * −160. A kijelző −60…0 dB-t mutat; a „túl hangos” jelzés a felvétel végéig megmarad (a pillanatnyi
 * túlvezérlést utólag is látni kell).
 *
 * A küszöb −3 dBFS: iOS-en a teljes kivezérlésű szinusz átlagteljesítménye −3 dB, Androidon a
 * csúcs −3 dBFS fölött már a túlvezérlés határán jár — mindkettőn a mikrofon túl közel / túl hangos.
 */
export const METER_FLOOR_DB = -60;
export const HOT_DB = -3;

/** dBFS → kijelző-szint (0–1); hiányzó / csend → 0 */
export function meterLevel(db: number | null | undefined): number {
  if (db === null || db === undefined || !Number.isFinite(db)) return 0;
  return Math.max(0, Math.min(1, (db - METER_FLOOR_DB) / -METER_FLOOR_DB));
}

/** a „túl hangos” jelzés: egyszer bekapcsol, a felvétel végéig marad */
export function nextHot(held: boolean, db: number | null | undefined): boolean {
  return held || (typeof db === 'number' && Number.isFinite(db) && db >= HOT_DB);
}

/** a kijelzett felvételi idő (mm:ss) — szünet alatt nem halad */
export function recordingClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
