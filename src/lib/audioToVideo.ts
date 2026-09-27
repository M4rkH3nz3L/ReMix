import { makeId } from '@/lib/id';
import type { Project } from '@/types/project';

/**
 * 🎧→🎬 Hang-projekt „vitele" a videó-editorba: a hang-mű tartalma (music/voiceover/
 * sfx sávok + assetek) átkerül egy ÚJ, `kind: 'video'` projektbe, amelyhez a user
 * képet/videót adhat. Nem-destruktív: az eredeti hang-projekt megmarad, az újnak
 * remix-lineage-e mutat rá. (A `rendered` nem öröklődik — az a hang-kimeneté volt.)
 */
export function audioProjectToVideo(project: Project, name: string, now: string): Project {
  return {
    ...project,
    id: makeId('prj'),
    kind: 'video',
    name,
    rendered: undefined,
    remixOf: { projectId: project.id, name: project.name },
    createdAt: now,
    updatedAt: now,
  };
}
