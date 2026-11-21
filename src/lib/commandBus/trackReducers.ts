import { canHostClip, findClip, replaceClip, splitClip } from '@/lib/projectUtils';
import type { Clip, Project, TrackType } from '@/types/project';

import type { CommandOf } from './types';

/** 🎬 Klip- és sáv-reducerek: klip hozzáadás/frissítés/törlés/mozgatás/vágás, sáv-újraépítés, sáv-CRUD. */

export function reduceAddClip(project: Project, cmd: CommandOf<'ADD_CLIP'>): Project | null {
  let base = project;
  let clip = cmd.clip;
  if (cmd.asset) {
    // azonos uri → a meglévő assetre mutatunk, nem duplikálunk
    const existing = project.assets.find((a) => a.uri === cmd.asset!.uri);
    if (existing) {
      clip = { ...clip, assetId: existing.id } as Clip;
    } else {
      base = { ...project, assets: [...project.assets, cmd.asset] };
      clip = { ...clip, assetId: cmd.asset.id } as Clip;
    }
  }
  return addClips(base, cmd.trackType, [clip]);
}

export function reduceAddClips(project: Project, cmd: CommandOf<'ADD_CLIPS'>): Project | null {
  if (cmd.clips.length === 0) {
    return null;
  }
  return addClips(project, cmd.trackType, cmd.clips);
}

export function reduceUpdateClip(project: Project, cmd: CommandOf<'UPDATE_CLIP'>): Project | null {
  const found = findClip(project, cmd.clipId);
  if (!found) {
    return null;
  }
  return replaceClip(project, { ...found.clip, ...cmd.patch } as Clip);
}

export function reduceRemoveClip(project: Project, cmd: CommandOf<'REMOVE_CLIP'>): Project | null {
  if (!findClip(project, cmd.clipId)) {
    return null;
  }
  return {
    ...project,
    tracks: project.tracks.map((track) => ({
      ...track,
      clips: track.clips.filter((c) => c.id !== cmd.clipId),
    })),
  };
}

export function reduceMoveClip(project: Project, cmd: CommandOf<'MOVE_CLIP'>): Project | null {
  const found = findClip(project, cmd.clipId);
  if (!found) {
    return null;
  }
  // inkompatibilis cél-sáv VAGY nem létező sáv → no-op
  if (!canHostClip(cmd.toTrackType, found.clip.kind) ||
    !project.tracks.some((t) => t.type === cmd.toTrackType)) {
    return null;
  }
  // no-op: ugyanazon a sávon, ugyanarra a kezdetre
  if (found.track.type === cmd.toTrackType && found.clip.start === cmd.start) {
    return null;
  }
  const moved = { ...found.clip, start: cmd.start } as Clip;
  return {
    ...project,
    tracks: project.tracks.map((track) => {
      // a cél-sáv: kivesszük (ha ugyanaz) + betesszük az új kezdettel
      if (track.type === cmd.toTrackType) {
        return { ...track, clips: [...track.clips.filter((c) => c.id !== cmd.clipId), moved] };
      }
      // a forrás-sáv (más, mint a cél): kivesszük
      if (track.id === found.track.id) {
        return { ...track, clips: track.clips.filter((c) => c.id !== cmd.clipId) };
      }
      return track;
    }),
  };
}

export function reduceSplitClip(project: Project, cmd: CommandOf<'SPLIT_CLIP'>): Project | null {
  const found = findClip(project, cmd.clipId);
  if (!found) {
    return null;
  }
  const parts = splitClip(found.clip, cmd.time);
  if (!parts) {
    return null;
  }
  return {
    ...project,
    tracks: project.tracks.map((track) =>
      track.id === found.track.id
        ? {
            ...track,
            clips: track.clips.flatMap((c) => (c.id === cmd.clipId ? parts : [c])),
          }
        : track
    ),
  };
}

export function reduceReplaceTrackClips(project: Project, cmd: CommandOf<'REPLACE_TRACK_CLIPS'>): Project | null {
  if (!project.tracks.some((t) => t.type === cmd.trackType)) {
    return null;
  }
  return {
    ...project,
    tracks: project.tracks.map((track) =>
      track.type === cmd.trackType ? { ...track, clips: cmd.clips } : track
    ),
  };
}

export function reduceReplaceTracks(project: Project, cmd: CommandOf<'REPLACE_TRACKS'>): Project | null {
  const byType = new Map(cmd.tracks.map((t) => [t.trackType, t.clips]));
  if (byType.size === 0) {
    return null;
  }
  const newAssets = (cmd.assets ?? []).filter(
    (a) => !project.assets.some((existing) => existing.id === a.id)
  );
  return {
    ...project,
    assets: [...project.assets, ...newAssets],
    tracks: project.tracks.map((track) =>
      byType.has(track.type)
        ? { ...track, clips: byType.get(track.type)! }
        : track
    ),
  };
}

export function reduceAddTrack(project: Project, cmd: CommandOf<'ADD_TRACK'>): Project | null {
  // csak új típus (a sávokat a típus azonosítja)
  if (project.tracks.some((t) => t.type === cmd.track.type)) {
    return null;
  }
  return { ...project, tracks: [...project.tracks, { ...cmd.track, clips: cmd.track.clips ?? [] }] };
}

export function reduceRemoveTrack(project: Project, cmd: CommandOf<'REMOVE_TRACK'>): Project | null {
  // csak az üres, hozzáadott sáv törölhető (klip nem vész el csendben)
  const track = project.tracks.find((t) => t.type === cmd.trackType);
  if (!track || track.clips.length > 0 || !cmd.trackType.startsWith('aux')) {
    return null;
  }
  const { [cmd.trackType]: _gain, ...trackMix } = project.trackMix ?? {};
  const { [cmd.trackType]: _sends, ...audioSends } = project.audioSends ?? {};
  void _gain;
  void _sends;
  return { ...project, tracks: project.tracks.filter((t) => t.type !== cmd.trackType), trackMix, audioSends };
}

export function reduceRenameTrack(project: Project, cmd: CommandOf<'RENAME_TRACK'>): Project | null {
  const name = cmd.name.trim();
  const track = project.tracks.find((t) => t.type === cmd.trackType);
  if (!track || !name || track.name === name) {
    return null;
  }
  return { ...project, tracks: project.tracks.map((t) => (t.type === cmd.trackType ? { ...t, name } : t)) };
}

function addClips(project: Project, trackType: TrackType, clips: Clip[]): Project | null {
  if (!project.tracks.some((t) => t.type === trackType)) {
    return null;
  }
  return {
    ...project,
    tracks: project.tracks.map((track) =>
      track.type === trackType ? { ...track, clips: [...track.clips, ...clips] } : track
    ),
  };
}
