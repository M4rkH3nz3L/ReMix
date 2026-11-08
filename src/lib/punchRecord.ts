import { DEFAULT_METER, secPerBeat, type Meter } from '@/lib/audioTransport';
import type { EditorCommand } from '@/lib/commands';
import { MIN_CLIP_DURATION } from '@/constants/editor';
import { cropClip } from '@/lib/projectUtils';
import type { Asset, AudioClip, Clip, Project, TrackType } from '@/types/project';

/**
 * 🎙️⏱️ Count-in és punch-in — tiszta mag (a felület és a füstteszt közös útja).
 *
 * - Count-in: N ütem előszámlálás a projekt tempóján és ütemjelzésén (a BPM negyedre értendő,
 *   /8-nál a beat a nyolcad), a felvétel az előszámlálás végén indul.
 * - Punch-in: az In–Out tartományt veszi fel újra; a lejátszás `preroll`-lal előtte indul, a felvevő
 *   kicsit In előtt (az indulási késés ne vágja le az elejét). A klip helyét NEM a hívás idejéből
 *   számoljuk, hanem a felvevő saját idejéből: felvétel közben (lejátszófej, felvett ms) párok, a
 *   felvétel 0. mintája = medián(lejátszófej − felvett idő). Így a klip pontosan In-től Out-ig ül
 *   (`trimIn` = In − a felvétel kezdete), az alatta lévő klipek ott kivágva (nem törölve) — egy undo.
 */

/** egy beat hossza mp-ben a projekt tempóján és ütemjelzésén */
export function beatSeconds(bpm: number | undefined, meter: Meter = DEFAULT_METER): number {
  return secPerBeat(bpm) * (meter.beatUnit === 8 ? 0.5 : 1);
}

/** az előszámlálás hossza (mp) */
export function countInSeconds(bars: number, bpm: number | undefined, meter: Meter = DEFAULT_METER): number {
  return Math.max(0, Math.round(bars)) * meter.beatsPerBar * beatSeconds(bpm, meter);
}

/** a kattanások időpontjai (az ütem első üteme hangsúlyos) */
export function countInClicks(bars: number, bpm: number | undefined, meter: Meter = DEFAULT_METER): { t: number; accent: boolean }[] {
  const n = Math.max(0, Math.round(bars)) * meter.beatsPerBar;
  const b = beatSeconds(bpm, meter);
  return Array.from({ length: n }, (_, i) => ({ t: i * b, accent: i % meter.beatsPerBar === 0 }));
}

export const PUNCH_PREROLL = 2;
/** a felvevő ennyivel In előtt indul (az indulási késés ne vágja le az elejét) */
export const PUNCH_LEAD = 0.3;
/** ennyivel Out után áll le (a vége se maradjon le) */
export const PUNCH_TAIL = 0.15;

export interface PunchWindow {
  /** a lejátszás innen indul */
  playFrom: number;
  /** a felvevő itt indul (In − lead, de nem a lejátszás előtt) */
  recordAt: number;
  in: number;
  out: number;
  /** a felvevő itt áll le */
  stopAt: number;
}

/** a punch idővonala; érvénytelen (hiányzó / túl rövid) tartománynál null */
export function punchWindow(rangeIn: number | null, rangeOut: number | null, preroll = PUNCH_PREROLL): PunchWindow | null {
  if (rangeIn === null || rangeOut === null || !(rangeOut - rangeIn >= MIN_CLIP_DURATION)) return null;
  const playFrom = Math.max(0, rangeIn - preroll);
  return { playFrom, recordAt: Math.max(playFrom, rangeIn - PUNCH_LEAD), in: rangeIn, out: rangeOut, stopAt: rangeOut + PUNCH_TAIL };
}

/**
 * a felvétel 0. mintájának helye a projekt idejében: medián(lejátszófej − felvett idő); a még 0 ms-os
 * (el sem indult) minták kimaradnak. Nincs használható minta → null.
 */
export function recordingStartFrom(samples: { playhead: number; recordedMs: number }[]): number | null {
  const xs = samples.filter((s) => s.recordedMs > 0).map((s) => s.playhead - s.recordedMs / 1000).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const m = xs.length >> 1;
  return xs.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2;
}

/**
 * a punch parancsai (egy köteg = egy undo): a sáv In–Out közé eső része kivágva (a kilógó darabok
 * maradnak, a kettévágott klip jobb fele új azonosítót kap), és az új klip pontosan In-től.
 * Ha a felvétel In után indult (a felvevő késett), a klip a tényleges kezdettől szól.
 */
export function punchCommands(
  project: Project,
  trackType: TrackType,
  rec: { uri: string; seconds: number; startAt: number; label: string },
  win: { in: number; out: number },
  makeId: (prefix: string) => string
): EditorCommand[] {
  const track = project.tracks.find((t) => t.type === trackType);
  if (!track) return [];
  const start = Math.max(win.in, rec.startAt);
  const trimIn = Math.max(0, start - rec.startAt);
  const duration = Math.min(win.out - start, rec.seconds - trimIn);
  if (!(duration >= MIN_CLIP_DURATION)) return [];
  const carved: Clip[] = [];
  for (const c of track.clips) {
    const s = c.start;
    const e = c.start + c.duration;
    if (e <= win.in + 1e-9 || s >= win.out - 1e-9) {
      carved.push(c);
      continue;
    }
    if (win.in - s >= MIN_CLIP_DURATION) carved.push(cropClip(c, s, win.in));
    if (e - win.out >= MIN_CLIP_DURATION) {
      const right = cropClip(c, win.out, e);
      // ha a bal fele is megmaradt, a jobb fele új klip (két azonos id nem lehet)
      carved.push(win.in - s >= MIN_CLIP_DURATION ? ({ ...right, id: makeId('clip') } as Clip) : right);
    }
  }
  const clip: AudioClip = {
    kind: 'audio',
    id: makeId('clip'),
    start,
    duration,
    trimIn,
    sourceDuration: rec.seconds,
    uri: rec.uri,
    label: rec.label,
    volume: 1,
    fadeIn: 0,
    fadeOut: 0,
    source: 'voiceover',
  };
  const asset: Asset = { id: makeId('ast'), kind: 'audio', uri: rec.uri, provider: 'local', name: rec.label, duration: rec.seconds };
  return [
    { type: 'ADD_ASSET', asset },
    { type: 'REPLACE_TRACK_CLIPS', trackType, clips: [...carved, clip].sort((a, b) => a.start - b.start) },
  ];
}
