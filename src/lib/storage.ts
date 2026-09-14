import AsyncStorage from '@react-native-async-storage/async-storage';

import type { ProjectEvent } from '@/lib/commands';
import { makeId } from '@/lib/id';
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
  /** kézi pillanatkép vagy automatikus autosave-előzmény (hiányzó = manual) */
  kind?: 'manual' | 'auto';
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

/** 🕓 legfeljebb ennyi AUTO-verziót tartunk (a kézi pillanatképek megmaradnak) */
const MAX_AUTO_VERSIONS = 8;
/** két auto-mentés közti minimum (mp) — ne szemetelje tele a történetet */
const AUTO_VERSION_THROTTLE_MS = 120000;

/**
 * 🕓 Autosave-előzmény: az autosave meghívja — egy időbélyegzett AUTO-verziót
 * fűz a történethez (throttle-olva), a régi autókat nyesve. A kézi (manual)
 * pillanatképeket nem érinti. Így a felhasználónak van visszaállítható előzménye
 * akkor is, ha nem mentett kézzel.
 */
export async function recordAutoVersion(project: Project): Promise<void> {
  try {
    const versions = await loadVersions(project.id);
    const lastAuto = [...versions].reverse().find((v) => v.kind === 'auto');
    if (lastAuto && Date.now() - new Date(lastAuto.at).getTime() < AUTO_VERSION_THROTTLE_MS) {
      return; // túl gyakori — kihagyjuk
    }
    const auto: ProjectVersion = {
      id: makeId('ver'),
      name: '',
      at: new Date().toISOString(),
      project,
      kind: 'auto',
    };
    const manuals = versions.filter((v) => v.kind !== 'auto');
    const autos = [...versions.filter((v) => v.kind === 'auto'), auto].slice(-MAX_AUTO_VERSIONS);
    const next = [...manuals, ...autos].sort((a, b) => a.at.localeCompare(b.at));
    await saveVersions(project.id, next);
  } catch {
    // az autosave-előzmény best-effort — hiba esetén csendben kihagyjuk
  }
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
