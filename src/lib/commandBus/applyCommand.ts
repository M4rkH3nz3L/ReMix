import { retimeTempoDelays } from '@/lib/fxParams';
import type { Project } from '@/types/project';

import {
  reduceAddClip,
  reduceAddClips,
  reduceAddTrack,
  reduceMoveClip,
  reduceRemoveClip,
  reduceRemoveTrack,
  reduceRenameTrack,
  reduceReplaceTrackClips,
  reduceReplaceTracks,
  reduceSplitClip,
  reduceUpdateClip,
} from './trackReducers';
import {
  reduceAddAsset,
  reduceRelinkAsset,
  reduceRelinkUri,
  reduceRemoveAsset,
  reduceUpdateAsset,
} from './assetReducers';
import {
  reduceRenameProject,
  reduceRestoreSnapshot,
  reduceSetAspect,
  reduceSetFps,
  reduceSetParticles,
  reduceSetProjectCover,
  reduceSetProjectFonts,
  reduceSetProjectSeo,
  reduceSetProjectSync,
  reduceSetThumbnailDoc,
  reduceSetWorkflowRun,
} from './projectMetaReducers';
import {
  reduceSetChapters,
  reduceSetLinks,
  reduceSetLockedTracks,
  reduceSetMarkers,
  reduceSetRegions,
} from './timelineMetaReducers';
import {
  reduceApplyAlbum,
  reduceRemoveImageDoc,
  reduceReorderImageDocs,
  reduceSetLiveDoc,
  reduceSetModel3dDoc,
  reduceUpsertImageDoc,
  reduceUpsertInstrumentDoc,
} from './docReducers';
import {
  reduceSetAudioBuses,
  reduceSetAudioMaster,
  reduceSetBpm,
  reduceSetTempoMap,
  reduceSetTimeSignature,
  reduceSetTrackGain,
  reduceSetTrackSend,
  reduceSetTrackSidechain,
} from './audioReducers';
import type { EditorCommand } from './types';

/** 🚌 A command-bus diszpécsere: a parancs típusa szerint a felelős reducerhez irányít. */

/**
 * A command alkalmazása — pure függvény. `null`, ha a command érvénytelen vagy
 * nem változtat semmin (ilyenkor history/event sem íródik).
 */
export function applyCommand(project: Project, cmd: EditorCommand): Project | null {
  const next = applyCommandRaw(project, cmd);
  // 🥁 V7: a tempóhoz kötött delay ms-e a tempó (vagy a klip helye) változásakor ugyanebben az undo-lépésben frissül
  return next ? retimeTempoDelays(next) : next;
}

function applyCommandRaw(project: Project, cmd: EditorCommand): Project | null {
  switch (cmd.type) {
    case 'ADD_CLIP':
      return reduceAddClip(project, cmd);
    case 'ADD_CLIPS':
      return reduceAddClips(project, cmd);
    case 'UPDATE_CLIP':
      return reduceUpdateClip(project, cmd);
    case 'REMOVE_CLIP':
      return reduceRemoveClip(project, cmd);
    case 'MOVE_CLIP':
      return reduceMoveClip(project, cmd);
    case 'SPLIT_CLIP':
      return reduceSplitClip(project, cmd);
    case 'SET_ASPECT':
      return reduceSetAspect(project, cmd);
    case 'SET_FPS':
      return reduceSetFps(project, cmd);
    case 'RENAME_PROJECT':
      return reduceRenameProject(project, cmd);
    case 'SET_PROJECT_SYNC':
      return reduceSetProjectSync(project, cmd);
    case 'SET_PROJECT_SEO':
      return reduceSetProjectSeo(project, cmd);
    case 'SET_PROJECT_COVER':
      return reduceSetProjectCover(project, cmd);
    case 'SET_PROJECT_FONTS':
      return reduceSetProjectFonts(project, cmd);
    case 'SET_THUMBNAIL_DOC':
      return reduceSetThumbnailDoc(project, cmd);
    case 'SET_PARTICLES':
      return reduceSetParticles(project, cmd);
    case 'ADD_ASSET':
      return reduceAddAsset(project, cmd);
    case 'UPDATE_ASSET':
      return reduceUpdateAsset(project, cmd);
    case 'REMOVE_ASSET':
      return reduceRemoveAsset(project, cmd);
    case 'REPLACE_TRACK_CLIPS':
      return reduceReplaceTrackClips(project, cmd);
    case 'UPSERT_IMAGE_DOC':
      return reduceUpsertImageDoc(project, cmd);
    case 'UPSERT_INSTRUMENT_DOC':
      return reduceUpsertInstrumentDoc(project, cmd);
    case 'REMOVE_IMAGE_DOC':
      return reduceRemoveImageDoc(project, cmd);
    case 'REORDER_IMAGE_DOCS':
      return reduceReorderImageDocs(project, cmd);
    case 'SET_LIVE_DOC':
      return reduceSetLiveDoc(project, cmd);
    case 'SET_MODEL3D_DOC':
      return reduceSetModel3dDoc(project, cmd);
    case 'SET_TIME_SIGNATURE':
      return reduceSetTimeSignature(project, cmd);
    case 'SET_TRACK_SIDECHAIN':
      return reduceSetTrackSidechain(project, cmd);
    case 'SET_BPM':
      return reduceSetBpm(project, cmd);
    case 'SET_WORKFLOW_RUN':
      return reduceSetWorkflowRun(project, cmd);
    case 'SET_TEMPO_MAP':
      return reduceSetTempoMap(project, cmd);
    case 'APPLY_ALBUM':
      return reduceApplyAlbum(project, cmd);
    case 'SET_MARKERS':
      return reduceSetMarkers(project, cmd);
    case 'SET_CHAPTERS':
      return reduceSetChapters(project, cmd);
    case 'SET_LOCKED_TRACKS':
      return reduceSetLockedTracks(project, cmd);
    case 'SET_REGIONS':
      return reduceSetRegions(project, cmd);
    case 'SET_AUDIO_MASTER':
      return reduceSetAudioMaster(project, cmd);
    case 'SET_TRACK_GAIN':
      return reduceSetTrackGain(project, cmd);
    case 'ADD_TRACK':
      return reduceAddTrack(project, cmd);
    case 'REMOVE_TRACK':
      return reduceRemoveTrack(project, cmd);
    case 'RENAME_TRACK':
      return reduceRenameTrack(project, cmd);
    case 'SET_AUDIO_BUSES':
      return reduceSetAudioBuses(project, cmd);
    case 'SET_TRACK_SEND':
      return reduceSetTrackSend(project, cmd);
    case 'SET_LINKS':
      return reduceSetLinks(project, cmd);
    case 'RESTORE_SNAPSHOT':
      return reduceRestoreSnapshot(project, cmd);
    case 'REPLACE_TRACKS':
      return reduceReplaceTracks(project, cmd);
    case 'RELINK_URI':
      return reduceRelinkUri(project, cmd);
    case 'RELINK_ASSET':
      return reduceRelinkAsset(project, cmd);
  }
}
