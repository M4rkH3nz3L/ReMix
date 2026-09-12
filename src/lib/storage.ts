import AsyncStorage from '@react-native-async-storage/async-storage';

import type { ProjectEvent } from '@/lib/commands';
import { migrateProject, projectDuration } from '@/lib/projectUtils';
import type { Project, ProjectMeta } from '@/types/project';

const INDEX_KEY = 'vided.projects.v1';
const projectKey = (id: string) => `vided.project.v1.${id}`;
const eventsKey = (id: string) => `vided.events.v1.${id}`;
const versionsKey = (id: string) => `vided.versions.v1.${id}`;

/** 🕓 Projekt-verzió (pillanatkép): a projekt TELJES állapota egy néven, on-device. */
export interface ProjectVersion {
  id: string;
  name: string;
  /** ISO időbélyeg */
  at: string;
  project: Project;
}

export async function listProjects(): Promise<ProjectMeta[]> {
  const raw = await AsyncStorage.getItem(INDEX_KEY);
  if (!raw) {
    return [];
  }
  try {
    const metas = JSON.parse(raw) as ProjectMeta[];
    return metas.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } catch {
    return [];
  }
}

export async function loadProject(id: string): Promise<Project | null> {
  const raw = await AsyncStorage.getItem(projectKey(id));
  if (!raw) {
    return null;
  }
  try {
    // régi sémák automatikus felhozása (v1 → v2: asset-registry)
    return migrateProject(JSON.parse(raw) as Project);
  } catch {
    return null;
  }
}

export async function saveProject(project: Project): Promise<void> {
  const stamped: Project = { ...project, updatedAt: new Date().toISOString() };
  const metas = await listProjects();
  const meta: ProjectMeta = {
    id: stamped.id,
    name: stamped.name,
    aspectRatio: stamped.aspectRatio,
    duration: projectDuration(stamped),
    clipCount: stamped.tracks.reduce((n, t) => n + t.clips.length, 0),
    updatedAt: stamped.updatedAt,
  };
  const nextIndex = [meta, ...metas.filter((m) => m.id !== stamped.id)];
  await AsyncStorage.multiSet([
    [projectKey(stamped.id), JSON.stringify(stamped)],
    [INDEX_KEY, JSON.stringify(nextIndex)],
  ]);
}

export async function deleteProject(id: string): Promise<void> {
  const metas = await listProjects();
  await AsyncStorage.multiSet([[INDEX_KEY, JSON.stringify(metas.filter((m) => m.id !== id))]]);
  await AsyncStorage.multiRemove([projectKey(id), eventsKey(id), versionsKey(id)]);
}

/** 🕓 A projekt mentett verziói (külön kulcson, mint az események). */
export async function loadVersions(projectId: string): Promise<ProjectVersion[]> {
  const raw = await AsyncStorage.getItem(versionsKey(projectId));
  if (!raw) {
    return [];
  }
  try {
    const list = JSON.parse(raw) as ProjectVersion[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export async function saveVersions(projectId: string, versions: ProjectVersion[]): Promise<void> {
  // védőkorlát: legfeljebb 20 verzió / projekt (a legújabbak)
  await AsyncStorage.setItem(versionsKey(projectId), JSON.stringify(versions.slice(-20)));
}

/** Az eseménynapló a projekt mellett, külön kulcson él — az undo nem érinti. */
export async function saveEvents(projectId: string, events: ProjectEvent[]): Promise<void> {
  await AsyncStorage.setItem(eventsKey(projectId), JSON.stringify(events));
}

export async function loadEvents(projectId: string): Promise<ProjectEvent[]> {
  const raw = await AsyncStorage.getItem(eventsKey(projectId));
  if (!raw) {
    return [];
  }
  try {
    return JSON.parse(raw) as ProjectEvent[];
  } catch {
    return [];
  }
}
