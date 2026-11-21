import type { Project } from '@/types/project';

import type { CommandOf } from './types';

/** 🔖 Idővonal-meta reducerek: markerek, fejezetek, zárolt sávok, régiók, klip-linkek (rendezett lista-cserék). */

export function reduceSetMarkers(project: Project, cmd: CommandOf<'SET_MARKERS'>): Project | null {
  const next = [...cmd.markers].sort((a, b) => a.time - b.time);
  const prev = project.markers ?? [];
  if (JSON.stringify(prev) === JSON.stringify(next)) {
    return null;
  }
  return { ...project, markers: next.length > 0 ? next : undefined };
}

export function reduceSetChapters(project: Project, cmd: CommandOf<'SET_CHAPTERS'>): Project | null {
  const next = [...cmd.chapters].sort((a, b) => a.start - b.start);
  const prev = project.chapters ?? [];
  if (JSON.stringify(prev) === JSON.stringify(next)) {
    return null;
  }
  return { ...project, chapters: next.length > 0 ? next : undefined };
}

export function reduceSetLockedTracks(project: Project, cmd: CommandOf<'SET_LOCKED_TRACKS'>): Project | null {
  const next = [...new Set(cmd.lockedTracks)].sort();
  const prev = [...(project.lockedTracks ?? [])].sort();
  if (JSON.stringify(prev) === JSON.stringify(next)) {
    return null;
  }
  return { ...project, lockedTracks: next.length > 0 ? next : undefined };
}

export function reduceSetRegions(project: Project, cmd: CommandOf<'SET_REGIONS'>): Project | null {
  const next = [...cmd.regions].sort((a, b) => a.start - b.start);
  const prev = project.regions ?? [];
  if (JSON.stringify(prev) === JSON.stringify(next)) {
    return null;
  }
  return { ...project, regions: next.length > 0 ? next : undefined };
}

export function reduceSetLinks(project: Project, cmd: CommandOf<'SET_LINKS'>): Project | null {
  // csak a 2+ elemű csoportok érdekesek; rendezve az összehasonlításhoz
  const next = cmd.links.filter((g) => g.length > 1).map((g) => [...g].sort());
  const prev = project.links ?? [];
  if (JSON.stringify(prev) === JSON.stringify(next)) {
    return null;
  }
  return { ...project, links: next.length > 0 ? next : undefined };
}
