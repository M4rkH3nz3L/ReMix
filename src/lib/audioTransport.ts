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
/** 🎼 ütemjelzés: a BPM negyedhangra értendő — /8-nál a beat-egység a nyolcad (kétszeres ütemben) */
export interface Meter {
  beatsPerBar: number;
  beatUnit: 4 | 8;
}
export const DEFAULT_METER: Meter = { beatsPerBar: 4, beatUnit: 4 };
/** a kapcsoló sorrendje */
export const METERS: Meter[] = [
  { beatsPerBar: 4, beatUnit: 4 },
  { beatsPerBar: 3, beatUnit: 4 },
  { beatsPerBar: 2, beatUnit: 4 },
  { beatsPerBar: 6, beatUnit: 8 },
  { beatsPerBar: 5, beatUnit: 4 },
  { beatsPerBar: 7, beatUnit: 8 },
  { beatsPerBar: 12, beatUnit: 8 },
];
export function nextMeter(cur: Meter | undefined): Meter {
  const m = cur ?? DEFAULT_METER;
  const i = METERS.findIndex((x) => x.beatsPerBar === m.beatsPerBar && x.beatUnit === m.beatUnit);
  return METERS[(i + 1) % METERS.length];
}
export function meterLabel(m: Meter | undefined): string {
  const x = m ?? DEFAULT_METER;
  return `${x.beatsPerBar}/${x.beatUnit}`;
}

export function timingForBpm(bpm?: number, meter: Meter = DEFAULT_METER): MusicTiming {
  const q = Number.isFinite(bpm) && (bpm as number) > 0 ? (bpm as number) : DEFAULT_BPM;
  return createTiming((q * meter.beatUnit) / 4, { beatsPerBar: meter.beatsPerBar, beatUnit: meter.beatUnit });
}

/** „ütem.beat" címke (1-alapú), pl. 3.2 — a transport-kijelzőhöz (az ütemjelzés szerint). */
export function barsBeatsLabel(bpm: number | undefined, sec: number, meter: Meter = DEFAULT_METER): string {
  const timing = timingForBpm(bpm, meter);
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
export function snapSec(sec: number, mode: SnapMode, fps: number, bpm?: number, meter: Meter = DEFAULT_METER): number {
  const t = Math.max(0, sec);
  if (mode === 'frame') {
    const f = fps > 0 ? fps : 30;
    return Math.round(t * f) / f;
  }
  if (mode === 'beat') {
    return Math.max(0, quantizeTime(timingForBpm(bpm, meter), t, { subdivision: 1 }));
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

const TICK_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600];
const MIN_TICK_PX = 12;
const MIN_LABEL_PX = 56;

export interface RulerTick {
  sec: number;
  /** feliratozott (nagy) jel */
  major: boolean;
}

/**
 * 📏 Vonalzó-jelek a LÁTHATÓ ablakra (PRO-AUDIO A42): a lépés a zoomhoz igazodik (a jelek
 * legalább 12 px-re, a feliratok legalább 56 px-re), így tetszőleges hosszú projekt végig
 * vonalzót kap, és a kirajzolt elemek száma a képernyő szélességével arányos, nem a hosszal.
 */
export function rulerTicks(fromSec: number, toSec: number, pxPerSec: number): RulerTick[] {
  const pps = Math.max(1e-6, pxPerSec);
  const step = TICK_STEPS.find((s) => s * pps >= MIN_TICK_PX) ?? TICK_STEPS[TICK_STEPS.length - 1];
  const labelStep = TICK_STEPS.find((s) => s >= step && s % step === 0 && s * pps >= MIN_LABEL_PX) ?? step * 10;
  const out: RulerTick[] = [];
  const start = Math.max(0, Math.floor(fromSec / step) * step);
  for (let sec = start; sec <= toSec; sec += step) {
    out.push({ sec, major: sec % labelStep === 0 });
  }
  return out;
}

export interface BeatGridLine {
  sec: number;
  downbeat: boolean;
}

/**
 * 🎵 Ütem-rács a látható ablakra (A42): ha a beatek túl sűrűk (< 6 px), csak az ütem-kezdők,
 * ha azok is, négyütemenként egy vonal — a rács a teljes hosszon megmarad.
 */
export function beatGridForView(
  bpm: number | undefined,
  beatsPerBar: number,
  fromSec: number,
  toSec: number,
  pxPerSec: number,
  beatUnit: 4 | 8 = 4
): BeatGridLine[] {
  // /8-nál a rács-egység a nyolcad (a BPM negyedre értendő)
  const beat = (secPerBeat(bpm) * 4) / beatUnit;
  const bar = beat * Math.max(1, beatsPerBar);
  const stride = beat * pxPerSec >= 6 ? beat : bar * pxPerSec >= 6 ? bar : bar * 4;
  const out: BeatGridLine[] = [];
  const first = Math.max(0, Math.ceil(fromSec / stride - 1e-9));
  for (let i = first; i * stride <= toSec + 1e-9; i++) {
    const sec = Math.round(i * stride * 1e6) / 1e6;
    const inBar = sec / bar;
    out.push({ sec, downbeat: Math.abs(inBar - Math.round(inBar)) < 1e-6 });
  }
  return out;
}

/**
 * 🔍 „Illeszd” nagyítás (PRO-AUDIO 17/2): a teljes projekt kifér a látható szélességbe. Folytonos
 * px/mp (a lépcsők legkisebbje, 16 px/mp, egy órás projektnél 57 600 px volna); alsó határ, hogy
 * egy üres vagy rövid projekt se nyúljon szét értelmetlenül.
 */
export function fitPxPerSec(viewWidth: number, durationSec: number, padding = 40): number {
  if (durationSec <= 0 || viewWidth <= padding) {
    return ZOOM_LEVELS[DEFAULT_ZOOM_INDEX];
  }
  return Math.max(0.05, Math.min(ZOOM_LEVELS[ZOOM_LEVELS.length - 1], (viewWidth - padding) / durationSec));
}

/** Az „illeszd” után a nagyítás-gomb innen lép: a px/mp-hez legközelebbi lépcső. */
export function nearestZoomIndex(pxPerSec: number): number {
  let best = 0;
  for (let i = 1; i < ZOOM_LEVELS.length; i++) {
    if (Math.abs(Math.log(ZOOM_LEVELS[i] / pxPerSec)) < Math.abs(Math.log(ZOOM_LEVELS[best] / pxPerSec))) {
      best = i;
    }
  }
  return best;
}

/** Scrub: a vonalzón az ujj x-e (tartalom-koordináta) → idő, a projekt hosszára vágva. */
export function scrubTime(contentX: number, pxPerSec: number, durationSec: number): number {
  return Math.max(0, Math.min(durationSec, contentX / Math.max(1e-6, pxPerSec)));
}

/**
 * Lejátszófej-követés: ha a lejátszófej a látható sáv jobb 15%-ába ér (vagy kiesik balra),
 * a nézet úgy lapoz, hogy a lejátszófej a bal 15%-ra kerüljön. `null` = nem kell görgetni.
 */
export function followScrollX(playheadX: number, viewX: number, viewWidth: number, contentWidth: number): number | null {
  if (viewWidth <= 0) {
    return null;
  }
  const inView = playheadX >= viewX && playheadX <= viewX + viewWidth * 0.85;
  if (inView) {
    return null;
  }
  const target = playheadX - viewWidth * 0.15;
  return Math.max(0, Math.min(Math.max(0, contentWidth - viewWidth), target));
}

