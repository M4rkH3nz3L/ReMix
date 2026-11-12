import { DEFAULT_METER, secPerBeat, type Meter } from '@/lib/audioTransport';
import type { EditorCommand } from '@/lib/commands';
import { MIN_CLIP_DURATION } from '@/constants/editor';
import { cropClip } from '@/lib/projectUtils';
import type { Asset, AudioClip, AudioTake, Clip, Project, TrackType } from '@/types/project';

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
 * ⏱️🎙️ metronómos felvétel (AP4): a lejátszás `countInBars` ütemmel a lejátszófej előtt indul (a
 * metronóm ezalatt számol be), a felvevő kicsit a lejátszófej előtt; nyitott vég (kézi leállításig).
 */
export function metronomeWindow(playhead: number, countInBars: number, bpm: number | undefined, meter: Meter = DEFAULT_METER): PunchWindow {
  const playFrom = Math.max(0, playhead - countInSeconds(countInBars, bpm, meter));
  return { playFrom, recordAt: Math.max(playFrom, playhead - PUNCH_LEAD), in: playhead, out: Number.POSITIVE_INFINITY, stopAt: Number.POSITIVE_INFINITY };
}

/** a nyitott take helye: a lejátszófejtől (In) szól, az előtte felvett rész levágva; túl rövid → null */
export function openTakePlacement(rec: { seconds: number; startAt: number }, inSec: number): { start: number; trimIn: number; duration: number } | null {
  const start = Math.max(inSec, rec.startAt);
  const trimIn = Math.max(0, start - rec.startAt);
  const duration = rec.seconds - trimIn;
  return duration >= MIN_CLIP_DURATION ? { start, trimIn, duration } : null;
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
 * maradnak, a kettévágott klip jobb fele új azonosítót kap), és az új klip pontosan In-től. Ha ott
 * már egy korábbi punch take-je ül (`takeSlot`), nem vág: új take lesz belőle, az lesz az aktív.
 * Ha a felvétel In után indult (a felvevő késett), a klip a tényleges kezdettől szól.
 */
/** a klip, amely már ennek a punch-tartománynak egy take-je (ugyanott kezdődik — a felvevő késése miatt legfeljebb kicsit később — és Out-nál ér véget) */
export function takeSlot(project: Project, trackType: TrackType, win: { in: number; out: number }): AudioClip | null {
  const track = project.tracks.find((t) => t.type === trackType);
  const c = track?.clips.find(
    (x): x is AudioClip =>
      x.kind === 'audio' && x.source === 'voiceover' && x.start >= win.in - 1e-6 && x.start <= win.in + 0.25 && Math.abs(x.start + x.duration - win.out) <= 0.01
  );
  return c ?? null;
}

/** a klip mostani (aktív) felvétele take-ként */
export function takeOf(clip: AudioClip, id: string): AudioTake {
  return { id, uri: clip.uri, label: clip.label, start: clip.start, duration: clip.duration, trimIn: clip.trimIn ?? 0, sourceDuration: clip.sourceDuration ?? clip.duration };
}

/** take választása: a klip mezői a take-éi (egy parancs = egy undo); ismeretlen take → null */
export function selectTakeCommand(clip: AudioClip, takeId: string): EditorCommand | null {
  const t = clip.takes?.find((x) => x.id === takeId);
  if (!t || clip.activeTake === takeId) return null;
  return { type: 'UPDATE_CLIP', clipId: clip.id, patch: { uri: t.uri, label: t.label, start: t.start, duration: t.duration, trimIn: t.trimIn, sourceDuration: t.sourceDuration, activeTake: t.id } };
}

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
  const asset0: Asset = { id: makeId('ast'), kind: 'audio', uri: rec.uri, provider: 'local', name: rec.label, duration: rec.seconds };
  // 🔁 ugyanarra a helyre ismételt punch: új take (a régiek megmaradnak, az új az aktív) — nem vág
  const slot = takeSlot(project, trackType, win);
  if (slot) {
    const prior = slot.takes && slot.takes.length > 0 ? slot.takes : [takeOf(slot, slot.activeTake ?? makeId('take'))];
    const take: AudioTake = { id: makeId('take'), uri: rec.uri, label: rec.label, start, duration, trimIn, sourceDuration: rec.seconds, at: new Date().toISOString() };
    return [
      { type: 'ADD_ASSET', asset: asset0 },
      {
        type: 'UPDATE_CLIP',
        clipId: slot.id,
        patch: { uri: take.uri, label: take.label, start, duration, trimIn, sourceDuration: rec.seconds, takes: [...prior, take], activeTake: take.id },
      },
    ];
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
  return [
    { type: 'ADD_ASSET', asset: asset0 },
    { type: 'REPLACE_TRACK_CLIPS', trackType, clips: [...carved, clip].sort((a, b) => a.start - b.start) },
  ];
}
