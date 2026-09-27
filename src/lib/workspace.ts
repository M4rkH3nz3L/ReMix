import {
  emptyLibrary,
  ingestProjectAssets,
  type AssetLibrary,
} from '@/lib/assetLibrary';
import {
  buildGraph,
  type CreativeGraph,
  type GraphProjectInput,
} from '@/lib/creativeGraph';
import {
  emptyMemory,
  observeProject,
  type CreatorMemory,
} from '@/lib/creatorMemory';
import { makeId } from '@/lib/id';
import {
  assetToDoc,
  search,
  type SearchDoc,
  type SearchOptions,
  type SearchResult,
} from '@/lib/universalSearch';
import type { Project, ProjectKind } from '@/types/project';

/**
 * 📁 Workspace-konténer (PM1 — MASTER §16, §26) — a creator „egy otthona":
 * projektek + assetek + memória + jegyzetek + feladatok EGY állapotban, hogy
 * „ne hagyja el az appot". Ez az AGGREGÁTUM-gyökér, amely a négy platform-mag
 * magot ([assetLibrary], [creatorMemory], [creativeGraph], [universalSearch])
 * egyetlen, koherens modellbe komponálja — és megadja a KÖZÖS nézeteket
 * (Creative Graph + ⌘K-index) a teljes workspace fölött.
 *
 * Tiszta, immutábilis reducer — expo-mentes, önmagában tesztelhető. A felhő-
 * perzisztencia (Supabase) külön `*Client.ts` réteg lesz; itt csak a modell + a
 * determinisztikus magok élnek.
 */

/** Creator Planner-pipeline állapotok (E-Planner mag; illeszkedik az ⌘K
 *  „félbehagyott" heurisztikájához — a `published` a kész állapot). */
export type TaskStatus =
  | 'idea'
  | 'backlog'
  | 'production'
  | 'editing'
  | 'review'
  | 'scheduled'
  | 'published';

export const TASK_STATUSES: TaskStatus[] = [
  'idea',
  'backlog',
  'production',
  'editing',
  'review',
  'scheduled',
  'published',
];

export interface WorkspaceProjectRef {
  id: string;
  name: string;
  kind: ProjectKind;
  createdAt?: string;
  updatedAt?: string;
  /** kész/publikált-e (a `⌘K` „félbehagyott" szűrőhöz). */
  published?: boolean;
  remixOf?: { projectId: string; name: string };
}

export interface WorkspaceNote {
  id: string;
  text: string;
  createdAt: string;
}

export interface WorkspaceTask {
  id: string;
  title: string;
  status: TaskStatus;
  /** opcionális projekt-hivatkozás (melyik projekthez tartozik a feladat). */
  projectId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Workspace {
  id: string;
  name: string;
  ownerId?: string;
  ownerName?: string;
  projects: WorkspaceProjectRef[];
  library: AssetLibrary;
  memory: CreatorMemory;
  notes: WorkspaceNote[];
  tasks: WorkspaceTask[];
  brands: { id: string; name: string }[];
  templates: { id: string; name: string }[];
  updatedAt: string;
}

export function emptyWorkspace(
  name: string,
  opts: { ownerId?: string; ownerName?: string } = {},
  now = new Date().toISOString()
): Workspace {
  return {
    id: makeId('ws'),
    name: name.trim() || 'Workspace',
    ...(opts.ownerId ? { ownerId: opts.ownerId } : {}),
    ...(opts.ownerName ? { ownerName: opts.ownerName } : {}),
    projects: [],
    library: emptyLibrary(now),
    memory: emptyMemory(now),
    notes: [],
    tasks: [],
    brands: [],
    templates: [],
    updatedAt: now,
  };
}

// ── Projekt-hivatkozások ─────────────────────────────────────────────────────

/** Projekt-ref beszúrása/frissítése (upsert id-re). */
export function upsertProjectRef(
  ws: Workspace,
  ref: WorkspaceProjectRef,
  now = new Date().toISOString()
): Workspace {
  const idx = ws.projects.findIndex((p) => p.id === ref.id);
  const projects = idx === -1 ? [...ws.projects, ref] : ws.projects.map((p) => (p.id === ref.id ? { ...p, ...ref } : p));
  return { ...ws, projects, updatedAt: now };
}

export function removeProjectRef(ws: Workspace, id: string, now = new Date().toISOString()): Workspace {
  const projects = ws.projects.filter((p) => p.id !== id);
  if (projects.length === ws.projects.length) {
    return ws;
  }
  // a usage-t is takarítsuk a könyvtárban (a projekt eltűnik → nincs több hivatkozás)
  const library = {
    ...ws.library,
    assets: ws.library.assets.map((a) =>
      a.usage.includes(id) ? { ...a, usage: a.usage.filter((u) => u !== id), updatedAt: now } : a
    ),
  };
  return { ...ws, projects, library, updatedAt: now };
}

// ── Jegyzetek ────────────────────────────────────────────────────────────────

export function addNote(ws: Workspace, text: string, now = new Date().toISOString()): Workspace {
  const clean = text.trim();
  if (!clean) {
    return ws;
  }
  const note: WorkspaceNote = { id: makeId('note'), text: clean, createdAt: now };
  return { ...ws, notes: [...ws.notes, note], updatedAt: now };
}

export function removeNote(ws: Workspace, id: string, now = new Date().toISOString()): Workspace {
  const notes = ws.notes.filter((n) => n.id !== id);
  return notes.length === ws.notes.length ? ws : { ...ws, notes, updatedAt: now };
}

// ── Feladatok (Planner-mag) ──────────────────────────────────────────────────

export function addTask(
  ws: Workspace,
  title: string,
  opts: { status?: TaskStatus; projectId?: string } = {},
  now = new Date().toISOString()
): Workspace {
  const clean = title.trim();
  if (!clean) {
    return ws;
  }
  const task: WorkspaceTask = {
    id: makeId('task'),
    title: clean,
    status: opts.status ?? 'idea',
    ...(opts.projectId ? { projectId: opts.projectId } : {}),
    createdAt: now,
    updatedAt: now,
  };
  return { ...ws, tasks: [...ws.tasks, task], updatedAt: now };
}

export function setTaskStatus(
  ws: Workspace,
  id: string,
  status: TaskStatus,
  now = new Date().toISOString()
): Workspace {
  let changed = false;
  const tasks = ws.tasks.map((t) => {
    if (t.id !== id) {
      return t;
    }
    changed = true;
    return { ...t, status, updatedAt: now };
  });
  return changed ? { ...ws, tasks, updatedAt: now } : ws;
}

export function removeTask(ws: Workspace, id: string, now = new Date().toISOString()): Workspace {
  const tasks = ws.tasks.filter((t) => t.id !== id);
  return tasks.length === ws.tasks.length ? ws : { ...ws, tasks, updatedAt: now };
}

/** A feladatok kanban-oszlopokba csoportosítva (Planner-nézet). */
export function tasksByStatus(ws: Workspace): Record<TaskStatus, WorkspaceTask[]> {
  const out = Object.fromEntries(TASK_STATUSES.map((s) => [s, [] as WorkspaceTask[]])) as Record<
    TaskStatus,
    WorkspaceTask[]
  >;
  for (const t of ws.tasks) {
    out[t.status].push(t);
  }
  return out;
}

// ── Brand / sablon ───────────────────────────────────────────────────────────

export function setBrands(ws: Workspace, brands: { id: string; name: string }[], now = new Date().toISOString()): Workspace {
  return { ...ws, brands, updatedAt: now };
}

export function setTemplates(
  ws: Workspace,
  templates: { id: string; name: string }[],
  now = new Date().toISOString()
): Workspace {
  return { ...ws, templates, updatedAt: now };
}

// ── A nagy integráció: projekt behúzása a workspace-be ───────────────────────

/**
 * Egy projekt „elmentése" a workspace-be — a teljes Creator OS-integráció egy
 * hívásban: (1) upsert projekt-ref, (2) az assetjeit az Asset Librarybe húzza
 * usage-gel, (3) opcionálisan TANUL belőle a Creator Memory (a „AI LEARNS" loop).
 * Idempotens: kétszeri behúzás nem duplikál (hash-dedup + kulcs-dedup).
 */
export function ingestProject(
  ws: Workspace,
  project: Project,
  opts: { learn?: boolean } = {},
  now = new Date().toISOString()
): Workspace {
  const ref: WorkspaceProjectRef = {
    id: project.id,
    name: project.name,
    kind: project.kind ?? 'video',
    ...(project.createdAt ? { createdAt: project.createdAt } : {}),
    ...(project.updatedAt ? { updatedAt: project.updatedAt } : {}),
    published: !!project.rendered,
    ...(project.remixOf ? { remixOf: { projectId: project.remixOf.projectId, name: project.remixOf.name } } : {}),
  };
  let next = upsertProjectRef(ws, ref, now);
  next = { ...next, library: ingestProjectAssets(next.library, project, now) };
  if (opts.learn) {
    next = { ...next, memory: observeProject(next.memory, project, now) };
  }
  return { ...next, updatedAt: now };
}

// ── Származtatott, workspace-szintű nézetek ───────────────────────────────────

/** A teljes workspace Creative Graph-ja (person + projektek + assetek + brand + sablon). */
export function workspaceGraph(ws: Workspace): CreativeGraph {
  const projects: GraphProjectInput[] = ws.projects.map((p) => ({
    id: p.id,
    name: p.name,
    kind: p.kind,
    ...(p.remixOf ? { remixOf: p.remixOf } : {}),
  }));
  return buildGraph({
    ...(ws.ownerId ? { personId: ws.ownerId } : {}),
    ...(ws.ownerName ? { personName: ws.ownerName } : {}),
    projects,
    assets: ws.library.assets,
    brands: ws.brands,
    templates: ws.templates,
  });
}

const projectRefToDoc = (p: WorkspaceProjectRef): SearchDoc => ({
  id: p.id,
  scope: 'project',
  title: p.name,
  subtitle: p.kind,
  keywords: [p.kind],
  ...(p.updatedAt ? { updatedAt: p.updatedAt } : {}),
  ...(p.createdAt ? { createdAt: p.createdAt } : {}),
  meta: { kind: p.kind, published: !!p.published },
});

/** A teljes workspace ⌘K-indexe (projektek + assetek + jegyzetek + feladatok + sablonok). */
export function workspaceSearchDocs(ws: Workspace): SearchDoc[] {
  const docs: SearchDoc[] = [];
  for (const p of ws.projects) {
    docs.push(projectRefToDoc(p));
  }
  for (const a of ws.library.assets) {
    docs.push(assetToDoc(a));
  }
  for (const n of ws.notes) {
    docs.push({ id: n.id, scope: 'document', title: n.text, createdAt: n.createdAt, updatedAt: n.createdAt });
  }
  for (const t of ws.tasks) {
    docs.push({
      id: t.id,
      scope: 'document',
      title: t.title,
      subtitle: t.status,
      updatedAt: t.updatedAt,
      createdAt: t.createdAt,
      meta: { status: t.status, published: t.status === 'published' },
    });
  }
  for (const tpl of ws.templates) {
    docs.push({ id: tpl.id, scope: 'template', title: tpl.name });
  }
  return docs;
}

/** ⌘K a teljes workspace fölött (a NL-szűrők a `search`-ből jönnek). */
export function workspaceSearch(ws: Workspace, query: string, opts: SearchOptions = {}): SearchResult[] {
  return search(workspaceSearchDocs(ws), query, opts);
}

// ── Perzisztencia-hasítás (a felhő-kliensekhez) ──────────────────────────────

/**
 * A workspace SAJÁT része (projekt-refek/notes/tasks/brand/sablon) — a globális
 * `library`/`memory` NÉLKÜL. A felhő-perzisztencia ezt a részt külön tárolja a
 * per-user Asset Librarytől és Creator Memorytól (azok minden workspace-re
 * közösek), így a `workspace` sor kicsi marad és nincs adat-duplikáció.
 */
export type WorkspaceDoc = Omit<Workspace, 'library' | 'memory'>;

/** A teljes (memóriabeli) workspace szétbontása a tárolandó részekre. */
export function splitWorkspace(ws: Workspace): {
  doc: WorkspaceDoc;
  library: AssetLibrary;
  memory: CreatorMemory;
} {
  const { library, memory, ...doc } = ws;
  return { doc, library, memory };
}

/** A per-user globális library+memory és a workspace-rész összeállítása egy teljes workspace-szé. */
export function assembleWorkspace(doc: WorkspaceDoc, library: AssetLibrary, memory: CreatorMemory): Workspace {
  return { ...doc, library, memory };
}
