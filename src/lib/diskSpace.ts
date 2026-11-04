/**
 * 💾 Tárhelyhiány (PRO-AUDIO 17/18): a telefonos export és a felvétel a szabad helyhez igazodik.
 * Pure döntések — a szabad helyet a hívó adja (`Paths.availableDiskSpace`).
 *
 * - export: indulás ELŐTT kiszámolható a WAV mérete → ha nem fér el, a dekódolás el sem indul;
 * - felvétel: kevés helynél nem indul; felvétel közben a hely fogyásakor a take MAGÁTÓL lezárul,
 *   mielőtt a lemez betelne (a betelt lemezen a fájl vége sérülhet, és a rendszer is akadozik);
 * - ha mégis betelik (más app is írt), az írási hiba érthető üzenetet kap.
 */

const MB = 1024 * 1024;

/** az export után is maradjon ennyi (a rendszernek és a projekt-mentésnek) */
export const EXPORT_SPACE_MARGIN = 50 * MB;
/** ennyi szabad hely alatt felvétel nem indul */
export const RECORD_START_MIN_FREE = 100 * MB;
/** felvétel közben ennyi alatt a take lezárul (HIGH_QUALITY AAC ~16 KB/s → bőven van idő) */
export const RECORD_STOP_FREE = 30 * MB;

/** 16 bites PCM WAV mérete (44 bájt fejléc) */
export function wavBytes(frames: number, channels: number): number {
  return 44 + frames * channels * 2;
}

/** ismeretlen szabad hely (web, hibás lekérdezés) nem tilt */
function known(free: number): boolean {
  return Number.isFinite(free) && free > 0;
}

export function hasRoomFor(needed: number, free: number, margin = EXPORT_SPACE_MARGIN): boolean {
  return !known(free) || free >= needed + margin;
}

export function canStartRecording(free: number): boolean {
  return !known(free) || free >= RECORD_START_MIN_FREE;
}

export function mustStopRecording(free: number): boolean {
  return known(free) && free < RECORD_STOP_FREE;
}

/** megabájt a felhasználónak (felfelé kerekítve, hogy a „kell” ne tűnjön kevesebbnek) */
export function megabytes(bytes: number): number {
  return Math.max(1, Math.ceil(bytes / MB));
}

/** a betelt lemez írási hibája (iOS NSFileWriteOutOfSpaceError / POSIX ENOSPC, magyar és angol) */
export function isDiskFullError(e: unknown): boolean {
  const s = (e instanceof Error ? e.message : String(e ?? '')).toLowerCase();
  return /(no space left|enospc|out of space|not enough (free )?space|disk (is )?full|nincs elég (szabad )?hely|betelt a tárhely|\b640\b)/.test(s);
}
