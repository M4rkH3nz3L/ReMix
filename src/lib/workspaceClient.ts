import { loadAssetLibrary, saveAssetLibrary } from '@/lib/assetLibraryClient';
import { loadCreatorMemory, saveCreatorMemory } from '@/lib/creatorMemoryClient';
import { ALL_PROJECT_KINDS } from '@/lib/projectKinds';
import { requireSupabase, supabase } from '@/lib/supabase';
import {
  TASK_STATUSES,
  assembleWorkspace,
  emptyWorkspace,
  splitWorkspace,
  type TaskStatus,
  type Workspace,
  type WorkspaceDoc,
  type WorkspaceNote,
  type WorkspaceProjectRef,
  type WorkspaceTask,
} from '@/lib/workspace';
import { useAuth } from '@/store/authStore';
import type { ProjectKind } from '@/types/project';

/**
 * 📁 Workspace felhő-kliens — a `workspace` (per-user, JSONB) tábla + a per-user
 * globális Asset Library és Creator Memory ÖSSZEKÖTÉSE egy teljes, memóriabeli
 * `Workspace`-szé. A `load` a három forrást összeállítja, a `save` a
 * `splitWorkspace`-szel szétbontva mindhármat elmenti (a library/memory nincs
 * duplikálva a workspace-sorban).
 *
 * A `parseWorkspaceDoc` TISZTA és VÉDETT (hibás sorok kihagyva) — ez van
 * tesztelve; a CRUD thin.
 */

const isKind = (v: unknown): v is ProjectKind => typeof v === 'string' && (ALL_PROJECT_KINDS as string[]).includes(v);
const isStatus = (v: unknown): v is TaskStatus => typeof v === 'string' && (TASK_STATUSES as string[]).includes(v);
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);

function coerceRef(raw: unknown): WorkspaceProjectRef | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== 'string' || typeof o.name !== 'string') {
    return null;
  }
  const remix =
    o.remixOf && typeof o.remixOf === 'object'
      ? (o.remixOf as Record<string, unknown>)
      : null;
  return {
    id: o.id,
    name: o.name,
    kind: isKind(o.kind) ? o.kind : 'video',
    ...(typeof o.createdAt === 'string' ? { createdAt: o.createdAt } : {}),
    ...(typeof o.updatedAt === 'string' ? { updatedAt: o.updatedAt } : {}),
    ...(typeof o.published === 'boolean' ? { published: o.published } : {}),
    ...(remix && typeof remix.projectId === 'string' && typeof remix.name === 'string'
      ? { remixOf: { projectId: remix.projectId, name: remix.name } }
      : {}),
  };
}

function coerceNote(raw: unknown): WorkspaceNote | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== 'string' || typeof o.text !== 'string') {
    return null;
  }
  return { id: o.id, text: o.text, createdAt: str(o.createdAt) };
}

function coerceTask(raw: unknown): WorkspaceTask | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== 'string' || typeof o.title !== 'string') {
    return null;
  }
  return {
    id: o.id,
    title: o.title,
    status: isStatus(o.status) ? o.status : 'idea',
    ...(typeof o.projectId === 'string' ? { projectId: o.projectId } : {}),
    ...(typeof o.platform === 'string' ? { platform: o.platform } : {}),
    ...(typeof o.scheduledFor === 'string' ? { scheduledFor: o.scheduledFor } : {}),
    createdAt: str(o.createdAt),
    updatedAt: str(o.updatedAt),
  };
}

function coerceNamed(raw: unknown): { id: string; name: string } | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== 'string' || typeof o.name !== 'string') {
    return null;
  }
  return { id: o.id, name: o.name };
}

function arr<T>(v: unknown, fn: (r: unknown) => T | null): T[] {
  return Array.isArray(v) ? v.map(fn).filter((x): x is T => x !== null) : [];
}

/** JSONB-dokumentum → `WorkspaceDoc` (védett; a hibás elemek kimaradnak). */
export function parseWorkspaceDoc(doc: unknown): WorkspaceDoc {
  const o = (doc ?? {}) as Record<string, unknown>;
  return {
    id: str(o.id),
    name: str(o.name, 'Workspace'),
    ...(typeof o.ownerId === 'string' ? { ownerId: o.ownerId } : {}),
    ...(typeof o.ownerName === 'string' ? { ownerName: o.ownerName } : {}),
    projects: arr(o.projects, coerceRef),
    notes: arr(o.notes, coerceNote),
    tasks: arr(o.tasks, coerceTask),
    brands: arr(o.brands, coerceNamed),
    templates: arr(o.templates, coerceNamed),
    updatedAt: str(o.updatedAt),
  };
}

function currentUid(): string | null {
  return useAuth.getState().user?.id ?? null;
}

async function fetchWorkspaceDoc(uid: string): Promise<WorkspaceDoc | null> {
  const { data, error } = await supabase!.from('workspace').select('doc').eq('user_id', uid).maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  return data ? parseWorkspaceDoc(data.doc) : null;
}

/**
 * A teljes workspace betöltése: a `workspace` sor (vagy egy friss üres) + a
 * per-user Asset Library + Creator Memory összeállítva. Backend/bejelentkezés
 * nélkül egy üres, memóriabeli workspace-t ad.
 */
export async function loadWorkspace(): Promise<Workspace> {
  const uid = currentUid();
  if (!supabase || !uid) {
    return emptyWorkspace('My Workspace');
  }
  const [docRow, library, memory] = await Promise.all([
    fetchWorkspaceDoc(uid),
    loadAssetLibrary(),
    loadCreatorMemory(),
  ]);
  const doc = docRow ?? splitWorkspace(emptyWorkspace('My Workspace', { ownerId: uid })).doc;
  return assembleWorkspace(doc, library, memory);
}

/**
 * A teljes workspace mentése: szétbontva a `workspace` sorra + az Asset Library
 * + Creator Memory per-user táblákra. No-op backend/bejelentkezés nélkül.
 */
export async function saveWorkspace(ws: Workspace): Promise<void> {
  const uid = currentUid();
  if (!supabase || !uid) {
    return;
  }
  const { doc, library, memory } = splitWorkspace(ws);
  const sb = requireSupabase();
  const saveDoc = sb.from('workspace').upsert({ user_id: uid, doc }, { onConflict: 'user_id' });
  const [{ error }] = await Promise.all([saveDoc, saveAssetLibrary(library), saveCreatorMemory(memory)]);
  if (error) {
    throw new Error(error.message);
  }
}
