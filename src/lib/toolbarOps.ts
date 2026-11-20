import { duplicateOffset } from '@/lib/batchEdit';
import { makeId } from '@/lib/id';
import { findClip, trackEnd } from '@/lib/projectUtils';
import type { ToolbarLayout, ToolId } from '@/lib/toolbarSpec';
import type { Clip, Project, Track, TrackType } from '@/types/project';

/**
 * 🧰 A szerkesztő-eszköztár (`components/editor/Toolbar.tsx`) tiszta, expo-mentes
 * magja: PiP-sarok, adjust-kezdés, beillesztési cél-sáv, kötegelt duplikálás/
 * törlés sáv-listája és a tutorial-előléptetés — önmagukban tesztelhetők.
 */

/** több PiP esetén a következő másik sarokba kerül (ne fedjék pontosan egymást) */
export const PIP_CORNERS = [
  { x: 0.3, y: -0.32 },
  { x: -0.3, y: -0.32 },
  { x: 0.3, y: 0.32 },
  { x: -0.3, y: 0.32 },
];

/** a pip-sáv klipszáma alapján a következő PiP sarka */
export function pipCornerFor(project: Project): { x: number; y: number } {
  const pipCount = project.tracks.find((t) => t.type === 'pip')?.clips.length ?? 0;
  return PIP_CORNERS[pipCount % PIP_CORNERS.length];
}

/** 🎨 az új grade-réteg kezdete: a lejátszófej, vagy ha az adjust-sáv tovább tart, annak vége */
export function adjustStartFor(track: Track, playhead: number): number {
  return Math.max(playhead, trackEnd(track) > playhead ? trackEnd(track) : playhead);
}

/** 📋 beillesztési cél-sáv kijelölés nélkül: a vágólap fajtájához illő alap */
export const PASTE_FALLBACK_TRACK: Record<Clip['kind'], TrackType> = {
  video: 'video', image: 'video', audio: 'music', text: 'text',
  shape: 'overlay', adjust: 'adjust', interactive: 'interactive',
};

/**
 * 🧩 kötegelt duplikálás: a másolatok a kijelölés UTÁN, a saját relatív
 * távolságukat megtartva — a ritmus nem borul fel; egy undo-lépés
 * (a `REPLACE_TRACKS` parancs `tracks` mezője).
 */
export function duplicatedTracks(
  project: Project,
  ids: string[]
): { trackType: TrackType; clips: Clip[] }[] {
  const picked = ids
    .map((id) => findClip(project, id))
    .filter((f): f is NonNullable<typeof f> => f != null);
  const offset = duplicateOffset(picked.map((f) => f.clip));
  const byTrack = new Map<TrackType, Clip[]>();
  for (const { track, clip } of picked) {
    const list = byTrack.get(track.type) ?? [...track.clips];
    list.push({ ...clip, id: makeId('clip'), start: clip.start + offset });
    byTrack.set(track.type, list);
  }
  return [...byTrack.entries()].map(([trackType, clips]) => ({
    trackType,
    clips: clips.sort((a, b) => a.start - b.start),
  }));
}

/** 🧩 kötegelt törlés — egy undo-lépésben, minden érintett sávról */
export function tracksWithoutClips(
  project: Project,
  ids: Set<string>
): { trackType: TrackType; clips: Clip[] }[] {
  return project.tracks
    .filter((t) => t.clips.some((c) => ids.has(c.id)))
    .map((t) => ({
      trackType: t.type,
      clips: t.clips.filter((c) => !ids.has(c.id)),
    }));
}

/**
 * 🎓 tutorial: ha az aktív lecke-lépés egy „Több" alá került eszközre mutat, az
 * eszköz IDEIGLENESEN előrekerül a sorba — így a spotlight mindig ráül.
 */
export function promoteTutorialTool<T>(
  layout: ToolbarLayout,
  tutorialIdOf: (id: ToolId) => T | undefined,
  activeTutorialTarget: T | null
): { rowTools: ToolId[]; moreTools: ToolId[] } {
  const promoted = activeTutorialTarget
    ? layout.overflow.find((id) => tutorialIdOf(id) === activeTutorialTarget)
    : undefined;
  const rowTools = promoted ? [...layout.primary, promoted] : layout.primary;
  const moreTools = promoted ? layout.overflow.filter((id) => id !== promoted) : layout.overflow;
  return { rowTools, moreTools };
}
