/**
 * 📐 Az idővonal tiszta geometriája és sáv-szabályai (React/RN-mentes → tesztelhető).
 *
 * A `Timeline.tsx`-ből kiemelt számítások: sáv-láthatóság, sáv-magasság,
 * vonalzó-osztások, videósáv-hézagok, borotva-cél, virtualizációs küszöbök.
 */
import { trackHeights, trackOrder } from '@/constants/editor';
import { AUDIO_TRACKS } from '@/lib/audioTracks';
import type { AudioClip, Project, TrackType } from '@/types/project';

/** ezeken a sávokon van hang — csak ezek kapnak némítás/solo gombot */
export const AUDIBLE_TRACKS: TrackType[] = ['video', ...AUDIO_TRACKS];

/** vizuális sávok — ezek kapnak láthatóság (szem) kapcsolót az előnézethez */
export const VISUAL_TRACKS: TrackType[] = [
  'video',
  'pip',
  'adjust',
  'text',
  'captions',
  'overlay',
  'interactive',
];

/**
 * 📏 Automatikus sáv-magasság szorzói: a hang-sávok magasabbak a hullámformának,
 * a videó/PiP a filmstripnek, a vékony overlay/felirat/grade alacsonyabb.
 */
export const AUTO_HEIGHT_FACTOR: Record<TrackType, number> = {
  video: 1.3,
  pip: 1.1,
  adjust: 0.8,
  text: 0.8,
  captions: 0.8,
  overlay: 0.8,
  interactive: 0.8,
  music: 1.4,
  voiceover: 1.3,
  sfx: 1,
  aux1: 1,
  aux2: 1,
  aux3: 1,
  aux4: 1,
  aux5: 1,
};

/**
 * 🪟 Klip-virtualizáció küszöbei. Ennyi klip FÖLÖTT kapcsol be a windowing (ez
 * alatt a rövid projekt a régi, „mindent renderel + nulla re-render" úton marad),
 * és ennyi viewport-nyi overscan puffer van az ablak két szélén.
 */
export const VIRTUALIZE_MIN_CLIPS = 60;
export const OVERSCAN_FACTOR = 1.5;

/** a vonalzó magassága (px) — a teljes-magas vonalak ehhez adják a sávokat */
export const RULER_HEIGHT = 22;

// 🔽 összecsukott sáv: vékony „lane" marad (a klip-terület elrejtve)
export const COLLAPSED_H = 18;

/**
 * A video-sáv klipek közti (és vezető) hézagai — CSAK a fő videósávon jelent ez
 * fekete képkockát az exportban (overlay/text/audio sávon a hézag szándékos).
 */
export function videoTrackGaps(
  clips: { id: string; start: number; duration: number }[]
): { start: number; end: number; nextId: string }[] {
  const sorted = [...clips].sort((a, b) => a.start - b.start);
  const gaps: { start: number; end: number; nextId: string }[] = [];
  let cursor = 0;
  for (const c of sorted) {
    if (c.start - cursor > 0.2) {
      gaps.push({ start: cursor, end: c.start, nextId: c.id });
    }
    cursor = Math.max(cursor, c.start + c.duration);
  }
  return gaps;
}

/**
 * A zenesáv legkorábbi hangklipje — a beat-rács forrása. Azért van a komponensen
 * KÍVÜL, hogy a render és a beat-effekt ugyanazt a szabályt használja anélkül,
 * hogy az effektnek a render-beli objektum-referenciára kellene hivatkoznia.
 */
export function firstMusicClip(project: Project | null | undefined): AudioClip | undefined {
  const clip = project?.tracks
    .find((t) => t.type === 'music')
    ?.clips.filter((c) => c.kind === 'audio')
    .sort((a, b) => a.start - b.start)[0];
  return clip?.kind === 'audio' ? clip : undefined;
}

/** a görgethető tartalom szélessége (px): a projekt + 3 mp ráhagyás, legalább 8 mp */
export function contentWidthFor(duration: number, pps: number): number {
  return Math.max(duration + 3, 8) * pps;
}

/** a vonalzó-osztások (mp) — a lépésköz a zoomhoz (pps) igazodik */
export function rulerMarksFor(duration: number, pps: number): number[] {
  const rulerStep = pps >= 90 ? 1 : pps >= 40 ? 2 : pps >= 18 ? 5 : 10;
  const rulerMarks: number[] = [];
  for (let t = 0; t <= Math.max(duration + 3, 8); t += rulerStep) {
    rulerMarks.push(t);
  }
  return rulerMarks;
}

/**
 * csak a videó sáv + a tartalommal bíró sávok látszanak — 8 üres sáv helyett
 * kompakt idővonal, a sávok használatba vételkor jelennek meg
 */
export function visibleTrackTypes(project: Project): TrackType[] {
  return trackOrder.filter((type) => {
    if (type === 'video') {
      return true;
    }
    return (project.tracks.find((t) => t.type === type)?.clips.length ?? 0) > 0;
  });
}

/** a sáv-magasság bemenetei (a store + a layout `trackScale`-je) */
export interface TrackHeightInput {
  collapsedTracks: TrackType[];
  trackScale: number;
  autoTrackHeight: boolean;
  trackHeightScale: Partial<Record<TrackType, number>>;
}

/** nagyobb kijelzőn vastagabb sávok — könnyebb célozni és olvasni */
export function trackHeightFor(t: TrackType, input: TrackHeightInput): number {
  const { collapsedTracks, trackScale, autoTrackHeight, trackHeightScale } = input;
  return collapsedTracks.includes(t)
    ? COLLAPSED_H
    : Math.round(
        trackHeights[t] *
          trackScale *
          (autoTrackHeight ? AUTO_HEIGHT_FACTOR[t] : trackHeightScale[t] ?? 1)
      );
}

/** az összes klip száma a projektben (a virtualizációs küszöbhöz) */
export function countClips(project: Project | null | undefined): number {
  return project ? project.tracks.reduce((n, tk) => n + tk.clips.length, 0) : 0;
}

/**
 * ✂️ borotva-vágás célja: az adott sávon a `time`-ot lefedő klip (a széleitől
 * 0,05 mp-en belül nem vág) + a századra kerekített vágási idő. Zárolt sávon null.
 */
export function razorCutTarget(
  project: Project | null | undefined,
  lockedTracks: TrackType[],
  type: TrackType,
  time: number
): { clipId: string; time: number } | null {
  if (lockedTracks.includes(type)) {
    return null;
  }
  const track = project?.tracks.find((tk) => tk.type === type);
  const clip = track?.clips.find((c) => c.start + 0.05 < time && time < c.start + c.duration - 0.05);
  if (clip) {
    return { clipId: clip.id, time: Math.round(time * 100) / 100 };
  }
  return null;
}
