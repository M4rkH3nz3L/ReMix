import type { Project } from '@/types/project';

import type { CommandOf } from './types';

/** ⚙️ Projekt-meta reducerek: képarány, fps, név, szinkron, borító, SEO, betűk, thumbnail, részecskék, munkafolyamat, snapshot. */

export function reduceSetAspect(project: Project, cmd: CommandOf<'SET_ASPECT'>): Project | null {
  if (project.aspectRatio === cmd.aspectRatio) {
    return null;
  }
  return { ...project, aspectRatio: cmd.aspectRatio };
}

export function reduceSetFps(project: Project, cmd: CommandOf<'SET_FPS'>): Project | null {
  const fps = Math.round(cmd.fps);
  if (!(fps > 0) || (project.fps ?? 30) === fps) {
    return null;
  }
  return { ...project, fps };
}

export function reduceRenameProject(project: Project, cmd: CommandOf<'RENAME_PROJECT'>): Project | null {
  const name = cmd.name.trim();
  if (!name || name === project.name) {
    return null;
  }
  return { ...project, name };
}

export function reduceSetProjectSync(project: Project, cmd: CommandOf<'SET_PROJECT_SYNC'>): Project | null {
  if (Boolean(project.syncToRemix) === cmd.enabled) {
    return null;
  }
  return { ...project, syncToRemix: cmd.enabled };
}

export function reduceSetProjectSeo(project: Project, cmd: CommandOf<'SET_PROJECT_SEO'>): Project | null {
  return { ...project, seo: cmd.seo };
}

export function reduceSetProjectCover(project: Project, cmd: CommandOf<'SET_PROJECT_COVER'>): Project | null {
  if (!cmd.asset) {
    if (!project.coverAssetId) {
      return null;
    }
    // a régi borító-asset kikerül (más nem hivatkozik rá), a fájlt a média-GC takarítja
    const oldId = project.coverAssetId;
    const { coverAssetId: _removed, ...rest } = project;
    return { ...rest, assets: project.assets.filter((a) => a.id !== oldId) };
  }
  if (cmd.asset.kind !== 'image' || project.coverAssetId === cmd.asset.id) {
    return null;
  }
  const prevId = project.coverAssetId;
  const assets = project.assets.filter((a) => a.id !== prevId && a.id !== cmd.asset!.id);
  return { ...project, coverAssetId: cmd.asset.id, assets: [...assets, cmd.asset] };
}

export function reduceSetProjectFonts(project: Project, cmd: CommandOf<'SET_PROJECT_FONTS'>): Project | null {
  if (JSON.stringify(cmd.fonts) === JSON.stringify(project.fonts ?? [])) {
    return null;
  }
  if (cmd.fonts.length === 0) {
    const { fonts: _gone, ...rest } = project;
    return rest;
  }
  return { ...project, fonts: cmd.fonts };
}

export function reduceSetThumbnailDoc(project: Project, cmd: CommandOf<'SET_THUMBNAIL_DOC'>): Project | null {
  const docId = cmd.docId ?? undefined;
  if (docId === project.thumbnailDocId || (docId && !project.imageDocs?.some((d) => d.id === docId))) {
    return null;
  }
  if (!docId) {
    const { thumbnailDocId: _removed, ...rest } = project;
    return rest;
  }
  return { ...project, thumbnailDocId: docId };
}

export function reduceSetParticles(project: Project, cmd: CommandOf<'SET_PARTICLES'>): Project | null {
  const next = cmd.particles ?? undefined;
  if (JSON.stringify(next) === JSON.stringify(project.particles)) {
    return null;
  }
  return { ...project, particles: next };
}

export function reduceSetWorkflowRun(project: Project, cmd: CommandOf<'SET_WORKFLOW_RUN'>): Project | null {
  if (JSON.stringify(project.workflowRun ?? null) === JSON.stringify(cmd.run)) return null;
  if (!cmd.run) {
    const { workflowRun: _drop, ...rest } = project;
    return rest as Project;
  }
  return { ...project, workflowRun: cmd.run };
}

export function reduceRestoreSnapshot(project: Project, cmd: CommandOf<'RESTORE_SNAPSHOT'>): Project | null {
  if (cmd.project.id !== project.id) {
    return null;
  }
  return { ...cmd.project, folder: project.folder, syncToRemix: project.syncToRemix };
}
