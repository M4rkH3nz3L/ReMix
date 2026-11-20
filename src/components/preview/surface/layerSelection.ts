/**
 * 🧱 Az előnézet réteg-kiválasztása (tiszta, React/RN/expo nélkül): melyik klip
 * látszik a playheadnél (elrejtett sávok nélkül), a vizuális klip átlátszósága és
 * fekete-áttűnése, a grade-réteg erőssége, a fókusz-scrim és a snap-kontextus.
 * A PreviewSurface-ből kiemelve — viselkedés változatlan.
 */
import { sampleChannel } from '@/lib/keyframes';
import {
  activeAdjustClips,
  activeVisualClip,
  clipsAt,
  findClip,
  trackOf,
} from '@/lib/projectUtils';
import { clamp } from '@/lib/time';
import type { EditorState } from '@/store/editorState';
import type {
  AdjustClip,
  Clip,
  ImageClip,
  InteractiveClip,
  Project,
  ShapeClip,
  TextClip,
  TrackType,
  VideoClip,
} from '@/types/project';

/** 💡 lighting-előnézet tintek — a valódi split-tone grade a renderben ég be */
export const LIGHTING_TINTS: Record<string, { color: string; opacity: number }> = {
  studio: { color: '#fff6e8', opacity: 0.07 },
  sunset: { color: '#ff8a3d', opacity: 0.16 },
  neon: { color: '#c74dff', opacity: 0.14 },
  cyberpunk: { color: '#1ad1c4', opacity: 0.14 },
};

/**
 * 🎙️ ha a JAVÍTOTT hang szól külön lejátszóról (AudioLayer/VideoVoice), a
 * videó saját sávját némítani kell — különben a kettő egyszerre szólna
 */
export function isVideoAudible(
  videoVoiceActive: boolean,
  soloTracks: readonly TrackType[],
  mutedTracks: readonly TrackType[]
): boolean {
  return (
    !videoVoiceActive &&
    (soloTracks.length > 0 ? soloTracks.includes('video') : !mutedTracks.includes('video'))
  );
}

/**
 * A snap-kontextus: a TÖBBI overlay/szöveg-réteg középpontja a playheadnél
 * (a húzott kivételével) — ezekre igazodik és köztük egyenlő térközre ugrik
 * a húzott réteg. A rács a felhasználó kapcsolójától függ.
 */
export function snapContextOf(
  state: Pick<EditorState, 'project' | 'selectedClipId' | 'playhead' | 'snapGrid'>
): { peers: { x: number; y: number }[]; grid: number } {
  const dragged = state.selectedClipId;
  const peers = (state.project?.tracks ?? [])
    .filter((t) => t.type === 'overlay' || t.type === 'text' || t.type === 'captions')
    .flatMap((t) => t.clips)
    .filter(
      (c) =>
        c.id !== dragged &&
        'position' in c &&
        c.start <= state.playhead &&
        c.start + c.duration >= state.playhead
    )
    .map((c) => (c as { position: { x: number; y: number } }).position);
  return { peers, grid: state.snapGrid };
}

/** 👁️ a fő videó/kép sáv elrejtve → nincs vizuális klip az előnézetben */
export function previewVisualClip(
  project: Project | null,
  hiddenTracks: readonly TrackType[],
  playhead: number
): Clip | null {
  return project && !hiddenTracks.includes('video') ? activeVisualClip(project, playhead) : null;
}

/** minden szöveg-jellegű réteg: címek + feliratok + matricák */
export function previewTextClips(
  project: Project | null,
  hiddenTracks: readonly TrackType[],
  playhead: number
): TextClip[] {
  return project
    ? (['text', 'captions', 'overlay'] as const).flatMap((type) => {
        if (hiddenTracks.includes(type)) {
          return []; // 👁️ elrejtett sáv kimarad az előnézetből
        }
        const track = project.tracks.find((t) => t.type === type);
        return track
          ? clipsAt<TextClip>(track, playhead).filter((c) => c.kind === 'text')
          : [];
      })
    : [];
}

export function previewInteractiveClips(
  project: Project | null,
  hiddenTracks: readonly TrackType[],
  playhead: number
): InteractiveClip[] {
  return project && !hiddenTracks.includes('interactive')
    ? clipsAt<InteractiveClip>(trackOf(project, 'interactive'), playhead).filter(
        (c) => c.kind === 'interactive'
      )
    : [];
}

export function previewShapeClips(
  project: Project | null,
  hiddenTracks: readonly TrackType[],
  playhead: number
): ShapeClip[] {
  return project && !hiddenTracks.includes('overlay')
    ? clipsAt<ShapeClip>(trackOf(project, 'overlay'), playhead).filter((c) => c.kind === 'shape')
    : [];
}

/** 🎨 grade-réteg(ek) a playheadnél: a teljes kompozitra ható tint-közelítés */
export function previewAdjustClips(
  project: Project | null,
  hiddenTracks: readonly TrackType[],
  playhead: number
): AdjustClip[] {
  return project && !hiddenTracks.includes('adjust') ? activeAdjustClips(project, playhead) : [];
}

/** 🎞️ átlátszóság-automáció: az opacity-csatorna a playheadből (kf nélkül a statikus opacity) */
export function visualMediaOpacity(
  visualForTransform: VideoClip | ImageClip | null,
  fallbackClip: VideoClip | ImageClip | null,
  playhead: number
): number {
  return visualForTransform
    ? sampleChannel(
        visualForTransform.keyframes?.opacity,
        playhead - visualForTransform.start,
        visualForTransform.opacity ?? 1
      )
    : fallbackClip?.opacity ?? 1;
}

/** áttűnés feketéből/feketébe a vizuális klip szélein (0 = nincs fekete) */
export function visualFadeOpacity(visualClip: VideoClip | ImageClip | null, playhead: number): number {
  let fadeOpacity = 0;
  if (visualClip) {
    const tIn = playhead - visualClip.start;
    const tOut = visualClip.start + visualClip.duration - playhead;
    const fadeIn = visualClip.fadeInSec ?? 0;
    const fadeOut = visualClip.fadeOutSec ?? 0;
    if (fadeIn > 0) {
      fadeOpacity = Math.max(fadeOpacity, 1 - Math.min(Math.max(tIn / fadeIn, 0), 1));
    }
    if (fadeOut > 0) {
      fadeOpacity = Math.max(fadeOpacity, 1 - Math.min(Math.max(tOut / fadeOut, 0), 1));
    }
  }
  return fadeOpacity;
}

/** a grade-réteg effektív erőssége: strength × fade-burkológörbe (a klip elején/végén) */
export function adjustClipStrength(clip: AdjustClip, playhead: number): number {
  const tLocal = playhead - clip.start;
  const inR = clip.fadeInSec ? clamp(tLocal / clip.fadeInSec, 0, 1) : 1;
  const outR = clip.fadeOutSec
    ? clamp((clip.duration - tLocal) / clip.fadeOutSec, 0, 1)
    : 1;
  return (clip.strength ?? 1) * inR * outR;
}

/**
 * 🎯 fókusz mód (#27): diszkrét overlay szerkesztésekor a base média
 * elhalványul — igaz, ha a kijelölt klip overlay-jellegű sávon van
 */
export function shouldDimBase(
  project: Project | null,
  selectedClipId: string | null,
  mode: 'edit' | 'play',
  focusMode: boolean
): boolean {
  const selTrack =
    project && selectedClipId ? findClip(project, selectedClipId)?.track.type : undefined;
  const overlayTracks = ['text', 'captions', 'overlay', 'interactive', 'pip'];
  return mode === 'edit' && focusMode && !!selTrack && overlayTracks.includes(selTrack);
}

/**
 * a szöveg-overlay klip-lokális ideje: szerkesztésben álló lejátszófejnél a
 * belépő-animáció "beállt" állapota látszik — különben a klip elején
 * láthatatlan lenne a szöveg
 */
export function textOverlayTime(
  mode: 'edit' | 'play',
  isPlaying: boolean,
  playhead: number,
  clipStart: number
): number {
  return mode === 'edit' && !isPlaying
    ? Math.max(playhead - clipStart, 0.45)
    : playhead - clipStart;
}
