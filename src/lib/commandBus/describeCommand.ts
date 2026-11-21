import { t as tr } from 'i18next';

import type { EditorCommand } from './types';

/** Rövid, ember-olvasható összefoglaló az event loghoz / AI-kontextushoz. */
export function describeCommand(cmd: EditorCommand): string {
  switch (cmd.type) {
    case 'ADD_CLIP':
      return tr('lib.commands.addClip', { kind: cmd.clip.kind, trackType: cmd.trackType });
    case 'ADD_CLIPS':
      return tr('lib.commands.addClips', { count: cmd.clips.length, trackType: cmd.trackType });
    case 'UPDATE_CLIP':
      return tr('lib.commands.updateClip', { keys: Object.keys(cmd.patch).join(', ') });
    case 'REMOVE_CLIP':
      return tr('lib.commands.removeClip');
    case 'MOVE_CLIP':
      return tr('lib.commands.moveClip', { trackType: cmd.toTrackType, defaultValue: `Move clip → ${cmd.toTrackType}` });
    case 'SPLIT_CLIP':
      return tr('lib.commands.splitClip', { time: cmd.time.toFixed(2) });
    case 'SET_ASPECT':
      return tr('lib.commands.setAspect', { aspectRatio: cmd.aspectRatio });
    case 'SET_FPS':
      return tr('lib.commands.setFps', { fps: cmd.fps });
    case 'RENAME_PROJECT':
      return tr('lib.commands.renameProject', { name: cmd.name });
    case 'SET_PROJECT_SYNC':
      return tr(cmd.enabled ? 'lib.commands.projectSyncOn' : 'lib.commands.projectSyncOff');
    case 'SET_PROJECT_COVER':
      return tr(cmd.asset ? 'lib.commands.setCover' : 'lib.commands.clearCover');
    case 'SET_PROJECT_SEO':
      return tr('lib.commands.setSeo');
    case 'SET_THUMBNAIL_DOC':
      return tr(cmd.docId ? 'lib.commands.setThumbnail' : 'lib.commands.clearThumbnail');
    case 'SET_PROJECT_FONTS':
      return tr('lib.commands.setFonts', { count: cmd.fonts.length });
    case 'SET_PARTICLES':
      return cmd.particles
        ? tr('lib.commands.setParticles', {
            preset: cmd.particles.preset,
            beatSync: cmd.particles.beatSync ? tr('lib.commands.beatSyncSuffix') : '',
          })
        : tr('lib.commands.particlesOff');
    case 'RELINK_ASSET':
      return tr('lib.commands.relinkAsset', { defaultValue: 'Relink asset' });
    case 'ADD_ASSET':
      return tr('lib.commands.addAsset', { name: cmd.asset.name ?? cmd.asset.kind });
    case 'UPDATE_ASSET':
      return tr('lib.commands.updateAsset', { keys: Object.keys(cmd.patch).join(', ') });
    case 'REMOVE_ASSET':
      return tr('lib.commands.removeAsset');
    case 'REPLACE_TRACK_CLIPS':
      return tr('lib.commands.replaceTrackClips', {
        trackType: cmd.trackType,
        count: cmd.clips.length,
      });
    case 'SET_MARKERS':
      return tr('lib.commands.setMarkers', { count: cmd.markers.length });
    case 'SET_CHAPTERS':
      return tr('lib.commands.setChapters', { count: cmd.chapters.length });
    case 'SET_AUDIO_MASTER':
      return tr('lib.commands.setAudioMaster', {
        target: cmd.audioMaster?.target ?? 'off',
        defaultValue: `Master: ${cmd.audioMaster?.target ?? 'off'}`,
      });
    case 'SET_TRACK_GAIN':
      return tr('lib.commands.setTrackGain', {
        track: cmd.trackType,
        defaultValue: `Track gain: ${cmd.trackType}`,
      });
    case 'ADD_TRACK':
      return tr('lib.commands.addTrack', { name: cmd.track.name, defaultValue: `Sáv hozzáadva: ${cmd.track.name}` });
    case 'REMOVE_TRACK':
      return tr('lib.commands.removeTrack', { defaultValue: 'Sáv törölve' });
    case 'RENAME_TRACK':
      return tr('lib.commands.renameTrack', { name: cmd.name, defaultValue: `Sáv átnevezve: ${cmd.name}` });
    case 'SET_AUDIO_BUSES':
      return tr('lib.commands.setAudioBuses', { count: cmd.buses.length, defaultValue: `Buszok: ${cmd.buses.length}` });
    case 'SET_TRACK_SEND':
      return tr('lib.commands.setTrackSend', { defaultValue: 'Küldés' });
    case 'SET_REGIONS':
      return tr('lib.commands.setRegions', { count: cmd.regions.length });
    case 'SET_LOCKED_TRACKS':
      return tr('lib.commands.setLockedTracks', { count: cmd.lockedTracks.length, defaultValue: `Zárolt sávok: ${cmd.lockedTracks.length}` });
    case 'SET_LINKS':
      return tr('lib.commands.setLinks', { count: cmd.links.filter((g) => g.length > 1).length });
    case 'UPSERT_IMAGE_DOC':
      return (
        cmd.label ??
        tr('lib.commands.upsertImageDoc', {
          name: cmd.doc.name,
          count: cmd.doc.layers.length,
        })
      );
    case 'REMOVE_IMAGE_DOC':
      return tr('lib.commands.removeImageDoc');
    case 'UPSERT_INSTRUMENT_DOC':
      return tr('lib.commands.upsertInstrumentDoc', { defaultValue: cmd.doc.kind === 'drums' ? 'Dobminta' : cmd.doc.kind === 'sampler' ? 'Sampler-minta' : 'Dallam' });
    case 'REORDER_IMAGE_DOCS':
      return tr('lib.commands.reorderImageDocs', {
        count: cmd.order.length,
        defaultValue: `Lapok átrendezése (${cmd.order.length})`,
      });
    case 'SET_MODEL3D_DOC':
      return (
        cmd.label ??
        tr('lib.commands.setModel3dDoc', {
          nodes: cmd.doc.nodes.length,
          defaultValue: `3D: ${cmd.doc.nodes.length} objektum`,
        })
      );
    case 'SET_LIVE_DOC':
      return (
        cmd.label ??
        tr('lib.commands.setLiveDoc', {
          scenes: cmd.doc.scenes.length,
          defaultValue: `Live: ${cmd.doc.scenes.length} scene(s)`,
        })
      );
    case 'SET_TIME_SIGNATURE':
      return tr('lib.commands.setTimeSignature', { defaultValue: `Ütemjelzés: ${cmd.timeSignature.beatsPerBar}/${cmd.timeSignature.beatUnit}` });
    case 'SET_TRACK_SIDECHAIN':
      return tr('lib.commands.setTrackSidechain', { defaultValue: 'Sidechain' });
    case 'SET_BPM':
      return tr('lib.commands.setBpm', { bpm: cmd.bpm, defaultValue: `BPM: ${cmd.bpm}` });
    case 'SET_WORKFLOW_RUN':
      return tr('lib.commands.setWorkflowRun', { defaultValue: cmd.run ? `Munkafolyamat: ${cmd.run.name}` : 'Munkafolyamat vége' });
    case 'SET_TEMPO_MAP':
      return tr('lib.commands.setTempoMap', { count: cmd.tempoMap.length, defaultValue: cmd.tempoMap.length > 0 ? `Tempóváltás (${cmd.tempoMap.length})` : 'Tempóváltások törölve' });
    case 'APPLY_ALBUM':
      return (
        cmd.label ??
        tr('lib.commands.applyAlbum', {
          count: cmd.album.songs.length,
          defaultValue: `Album (${cmd.album.songs.length} szám)`,
        })
      );
    case 'REPLACE_TRACKS':
      return cmd.label ?? tr('lib.commands.replaceTracks', { count: cmd.tracks.length });
    case 'RESTORE_SNAPSHOT':
      return cmd.label ?? tr('lib.commands.restoreSnapshot');
    case 'RELINK_URI':
      return tr('lib.commands.relinkUri', {
        file: cmd.newUri.split('/').pop() ?? cmd.newUri,
      });
  }
}
