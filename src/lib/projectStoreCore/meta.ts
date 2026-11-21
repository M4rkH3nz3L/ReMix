import { projectDuration, projectKind } from '@/lib/projectUtils';
import type { Project, ProjectMeta } from '@/types/project';
import { logCaught } from '@/lib/logCaught';

/** a projekt-lista bejegyzése egy projektből (a mentés és az index-újraépítés közös magja) */
export function metaOf(project: Project): ProjectMeta {
  return {
    id: project.id,
    name: project.name,
    kind: projectKind(project),
    aspectRatio: project.aspectRatio,
    duration: projectDuration(project),
    clipCount: project.tracks.reduce((n, t) => n + t.clips.length, 0),
    updatedAt: project.updatedAt,
    ...(project.folder ? { folder: project.folder } : {}),
    ...(project.syncToRemix ? { syncToRemix: true } : {}),
  };
}

export function folderOf(raw: string | null | undefined): string | null {
  try {
    const folder = raw ? (JSON.parse(raw) as Project).folder : undefined;
    return typeof folder === 'string' && folder ? folder : null;
  } catch (caught) {
    logCaught('lib/storage.ts:folderOf', caught);
    return null;
  }
}
