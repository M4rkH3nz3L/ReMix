/**
 * 🎛️ Hang Stúdió transport/idővonal mag (AUDIOT §1) — pure + tesztelt.
 *
 * A zenei időzítés (BPM → ütem:beat, beat-snap, beat-rács) a `musicTime.ts`-re épül; itt a
 * TRANSPORT-hoz szükséges vékony, UI-barát réteg él: bars:beats címke, beat-re igazítás,
 * ugrás a köv./előző beatre, és a zoom-szintek (px/mp) kezelése. SZÁNDÉKOSAN expo-mentes.
 */
import {
  beatAtTime,
  beatGridTimes,
  beatToBarsBeats,
  createTiming,
  quantizeTime,
  timeAtBeat,
  type MusicTiming,
} from './musicTime';

export const DEFAULT_BPM = 120;

/** Állandó-tempójú időzítés a projekt BPM-jéből (hiányzó/érvénytelen = 120, 4/4). */
export function timingForBpm(bpm?: number): MusicTiming {
  return createTiming(Number.isFinite(bpm) && (bpm as number) > 0 ? (bpm as number) : DEFAULT_BPM);
}

/** „ütem.beat" címke (1-alapú), pl. 3.2 — a transport-kijelzőhöz. */
export function barsBeatsLabel(bpm: number | undefined, sec: number): string {
  const timing = timingForBpm(bpm);
  const bb = beatToBarsBeats(timing, Math.max(0, beatAtTime(timing, Math.max(0, sec))));
  return `${bb.bar}.${bb.beat}`;
}

/** Zoom-szintek: px/mp (a klipek vízszintes sűrűsége). */
export const ZOOM_LEVELS = [16, 28, 44, 56, 88, 140, 220] as const;
export const DEFAULT_ZOOM_INDEX = 3; // 56 px/mp (a jelenlegi alap)

export function zoomIn(index: number): number {
  return Math.min(ZOOM_LEVELS.length - 1, index + 1);
}
export function zoomOut(index: number): number {
  return Math.max(0, index - 1);
}
export function pxPerSecAt(index: number): number {
  return ZOOM_LEVELS[Math.max(0, Math.min(ZOOM_LEVELS.length - 1, index))];
}

export type SnapMode = 'off' | 'frame' | 'beat';

/**
 * Egy időpont igazítása a snap-mód szerint: 'off' = nincs, 'frame' = a frame-rácsra (fps),
 * 'beat' = a legközelebbi beatre (a BPM szerint, 1/1 felbontás).
 */
export function snapSec(sec: number, mode: SnapMode, fps: number, bpm?: number): number {
  const t = Math.max(0, sec);
  if (mode === 'frame') {
    const f = fps > 0 ? fps : 30;
    return Math.round(t * f) / f;
  }
  if (mode === 'beat') {
    return Math.max(0, quantizeTime(timingForBpm(bpm), t, { subdivision: 1 }));
  }
  return t;
}

/** A következő beat időpontja (ugrás-előre a transporton). */
export function nextBeatSec(bpm: number | undefined, sec: number): number {
  const timing = timingForBpm(bpm);
  const beat = beatAtTime(timing, Math.max(0, sec));
  return timeAtBeat(timing, Math.floor(beat + 1e-6) + 1);
}

/** Az előző beat időpontja (ugrás-vissza); a beaten belül az aktuális beat elejére ugrik. */
export function prevBeatSec(bpm: number | undefined, sec: number): number {
  const timing = timingForBpm(bpm);
  const beat = beatAtTime(timing, Math.max(0, sec));
  const whole = Math.floor(beat - 1e-6);
  // ha már (közel) a beat elején vagyunk, az előző beatre; különben az aktuális beat elejére
  const target = beat - whole < 1e-3 ? Math.max(0, whole - 1) : Math.max(0, whole);
  return timeAtBeat(timing, target);
}

/** A látható tartományba eső beat-rács időpontjai (ütem-vonalak rajzolásához). */
export function beatLines(bpm: number | undefined, fromSec: number, toSec: number): number[] {
  return beatGridTimes(timingForBpm(bpm), Math.max(0, fromSec), Math.max(fromSec, toSec), 1);
}

/** Egy beat hossza mp-ben (metronóm-ütem / rács-sűrűség). */
export function secPerBeat(bpm?: number): number {
  const b = Number.isFinite(bpm) && (bpm as number) > 0 ? (bpm as number) : DEFAULT_BPM;
  return 60 / b;
}
