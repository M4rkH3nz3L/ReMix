import { makeId } from '@/lib/id';
import type { Project } from '@/types/project';

/**
 * 🎧→🎬 Hang-projekt „vitele" a videó-editorba: a hang-mű tartalma (music/voiceover/
 * sfx sávok + assetek) átkerül egy ÚJ, `kind: 'video'` projektbe, amelyhez a user
 * képet/videót adhat. Nem-destruktív: az eredeti hang-projekt megmarad.
 *
 * A46: FEHÉRLISTA — csak a hang-tartalom és az időzítés megy át. A hangprojekt identitása
 * (remix-eredet: a saját projekt nem az; album, borító-képek, közzétételi meta, élő adás,
 * telefonos mappa, szinkron, renderelt kimenet) az eredetinél marad.
 */
export function audioProjectToVideo(project: Project, name: string, now: string): Project {
  return {
    id: makeId('prj'),
    kind: 'video',
    name,
    aspectRatio: project.aspectRatio,
    fps: project.fps,
    bpm: project.bpm,
    tracks: project.tracks,
    assets: project.assets,
    markers: project.markers,
    regions: project.regions,
    chapters: project.chapters,
    links: project.links,
    audioMaster: project.audioMaster,
    trackMix: project.trackMix,
    createdAt: now,
    updatedAt: now,
    schemaVersion: project.schemaVersion,
  };
}
