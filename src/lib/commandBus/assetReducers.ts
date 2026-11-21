import { relinkAsset } from '@/lib/assetResolve';
import { imageDocsReference } from '@/lib/imageDocMedia';
import { relinkUri } from '@/lib/projectUtils';
import type { Asset, Project } from '@/types/project';

import type { CommandOf } from './types';

/** 🗂️ Asset-reducerek: hozzáadás, Organize-metaadat, törlés, relink (uri / asset-centrikus). */

export function reduceAddAsset(project: Project, cmd: CommandOf<'ADD_ASSET'>): Project | null {
  // azonos uri-jú asset nem duplikálódik
  if (project.assets.some((a) => a.id === cmd.asset.id || a.uri === cmd.asset.uri)) {
    return null;
  }
  return { ...project, assets: [...project.assets, cmd.asset] };
}

export function reduceUpdateAsset(project: Project, cmd: CommandOf<'UPDATE_ASSET'>): Project | null {
  // csak az Organize-metaadatokat engedjük (rating/favorite/tags/name)
  const allowed: (keyof Asset)[] = ['favorite', 'rating', 'tags', 'name'];
  const patch = Object.fromEntries(
    Object.entries(cmd.patch).filter(([k]) => allowed.includes(k as keyof Asset))
  );
  if (Object.keys(patch).length === 0 || !project.assets.some((a) => a.id === cmd.assetId)) {
    return null;
  }
  return {
    ...project,
    assets: project.assets.map((a) => (a.id === cmd.assetId ? { ...a, ...patch } : a)),
  };
}

export function reduceRemoveAsset(project: Project, cmd: CommandOf<'REMOVE_ASSET'>): Project | null {
  // a forrás-mappából elvett asset (a hívó csak a NEM használtat kínálja törlésre)
  if (!project.assets.some((a) => a.id === cmd.assetId)) {
    return null;
  }
  return { ...project, assets: project.assets.filter((a) => a.id !== cmd.assetId) };
}

export function reduceRelinkUri(project: Project, cmd: CommandOf<'RELINK_URI'>): Project | null {
  if (cmd.oldUri === cmd.newUri) {
    return null;
  }
  const touches =
    project.assets.some((a) => a.uri === cmd.oldUri) ||
    imageDocsReference(project, cmd.oldUri) ||
    project.tracks.some((t) =>
      t.clips.some(
        (c) =>
          ('uri' in c && c.uri === cmd.oldUri) ||
          (c.kind === 'shape' && c.imageUri === cmd.oldUri)
      )
    );
  if (!touches) {
    return null;
  }
  return relinkUri(project, cmd.oldUri, cmd.newUri);
}

export function reduceRelinkAsset(project: Project, cmd: CommandOf<'RELINK_ASSET'>): Project | null {
  // asset-centrikus relink (ADR-012): egy asset uri-cseréje → minden rá
  // hivatkozó klip követi. Nincs változás (ismeretlen asset / azonos uri) → null.
  const relinked = relinkAsset(project, cmd.assetId, cmd.newUri);
  // 🔗 linked asset (C2): az új forrás-verzió és a fájl hossza is az assetre kerül
  const extra = cmd.source || cmd.duration != null;
  if (!extra) return relinked === project ? null : relinked;
  if (!relinked.assets.some((a) => a.id === cmd.assetId)) return null;
  const next = {
    ...relinked,
    assets: relinked.assets.map((a) =>
      a.id === cmd.assetId ? { ...a, ...(cmd.source ? { source: cmd.source } : {}), ...(cmd.duration != null ? { duration: cmd.duration } : {}) } : a
    ),
  };
  return JSON.stringify(next.assets) === JSON.stringify(project.assets) && relinked === project ? null : next;
}
